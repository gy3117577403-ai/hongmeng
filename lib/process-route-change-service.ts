import {
  Prisma,
  ProcessCompletionCoverageStatus,
  ProcessCompletionReportMode,
  ProcessCompletionSource,
  ProcessLaborClaimStatus,
  ProcessLaborPoolStatus,
  ProcessMovementType,
  ProcessRouteChangeDiffKind,
  ProcessRouteChangeScope,
  ProcessRouteChangeStatus,
  ProcessRouteChangeStepSource,
  ProcessStepExecutionMode,
  ProcessSupplementObligationStatus,
} from '@prisma/client';
import {
  calculateCompletionLaborSnapshot,
  redistributeStandardLaborByExistingShares,
} from '@/lib/process-completion-domain';
import { ProductionControlError } from '@/lib/production-control';
import { assertProductionMayRun, isProductionSerializationConflict, type ProductionBackfillAuthorization } from '@/lib/production-pause-guard';
import {
  autoAssignCompletionLaborPool,
  ProcessCompletionServiceError,
  reconcileSupplementRouteCompletion,
} from '@/lib/process-completion-service';
import { chinaTodayDateKey } from '@/lib/attendance';
import {
  assertActionFlowDoesNotExceedReportedOutput,
  processReportTargetQuantity,
  resolveProcessReportQuantities,
} from '@/lib/process-report-quantity';
import { materializeProcessActionConsumptions } from '@/lib/process-action-consumption';
import { normalizeWorkDate } from '@/lib/daily-plan-domain';
import { calculateAttainmentBasisPoints } from '@/lib/process-time';
import { prisma } from '@/lib/prisma';
import {
  ProcessDefinitionResolutionError,
  resolveOrCreateProcessDefinition,
} from '@/lib/process-definition-resolver';
import { productionEmployeeWhere } from '@/lib/production-workforce';
import {
  ProductTimeDeploymentError,
  deployPublishedProductTimeRoutesInTransaction,
} from '@/lib/product-time-deployment-service';
import {
  ProcessRouteChangeDailyTaskSyncError,
  syncDailyTasksAfterProcessRouteChange,
} from '@/lib/process-route-change-daily-task-sync';
import { syncUnfinishedDailyTasksFromPublishedProductTime } from '@/lib/product-time-task-sync';
import {
  processSupplementActualRequiredQty,
  processSupplementRemainingQty,
} from '@/lib/process-supplement-coverage';

export const PROCESS_SUPPLEMENT_RELEASE_POLICY = 'NONE' as const;

export class ProcessRouteChangeServiceError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, unknown> | null;

  constructor(
    message: string,
    status = 400,
    code = 'PROCESS_ROUTE_CHANGE_INVALID',
    details: Record<string, unknown> | null = null,
  ) {
    super(message);
    this.name = 'ProcessRouteChangeServiceError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function synchronizeRouteChangeDailyTasks(
  tx: Prisma.TransactionClient,
  input: Parameters<typeof syncDailyTasksAfterProcessRouteChange>[1],
) {
  try {
    return await syncDailyTasksAfterProcessRouteChange(tx, input);
  } catch (error) {
    if (error instanceof ProcessRouteChangeDailyTaskSyncError) {
      throw new ProcessRouteChangeServiceError(error.message, 409, error.code);
    }
    throw error;
  }
}

export type InsertStepAfterData = {
  processCode?: string;
  processName?: string;
  stageGroup?: string;
  insertBeforeStepId?: string | null;
  standardMillisecondsPerUnit: number;
  timeBasis?: 'per_unit' | 'per_batch';
  unitLabel?: string;
  setupMilliseconds?: number;
  unitsPerProduct?: number;
  reportQuantityBasis?: 'product' | 'action';
  reportUnitLabel?: string;
  countsForEfficiency?: boolean;
  requiredQty?: number;
};

export type UpdateTimeAfterData = {
  standardMillisecondsPerUnit: number;
  timeBasis?: 'per_unit' | 'per_batch';
  unitLabel?: string;
  setupMilliseconds?: number;
  unitsPerProduct?: number;
  countsForEfficiency?: boolean;
};

export type MoveStepAfterData = {
  position: number;
  sequenceGroup?: number;
  beforeStepId?: string | null;
};

export type ProcessRouteChangeDiffInput =
  | {
      kind: 'INSERT_STEP';
      processDefinitionId?: string | null;
      targetStepId?: string | null;
      afterData: InsertStepAfterData;
    }
  | {
      kind: 'UPDATE_TIME';
      targetStepId: string;
      processDefinitionId?: string | null;
      afterData: UpdateTimeAfterData;
    }
  | {
      kind: 'MOVE_STEP';
      targetStepId: string;
      processDefinitionId?: string | null;
      afterData: MoveStepAfterData;
    };

export type NormalizedProcessRouteChangeDiff = {
  kind: 'INSERT_STEP' | 'UPDATE_TIME' | 'MOVE_STEP';
  source: 'NEW' | 'EXISTING';
  position: number;
  targetStepId: string | null;
  processDefinitionId: string | null;
  afterData: Partial<InsertStepAfterData & UpdateTimeAfterData & MoveStepAfterData> & Record<string, unknown>;
};

type MutationIdentity = {
  userId: string;
  actor: unknown;
  idempotencyKey: unknown;
  expectedVersion: unknown;
};

export type CreateProcessRouteChangeProposalCommand = MutationIdentity & {
  workOrderId?: string;
  routeId: string;
  title?: string;
  reason?: unknown;
  description?: string | null;
  scope?: ProcessRouteChangeScope | keyof typeof ProcessRouteChangeScope;
  diffs?: ProcessRouteChangeDiffInput[];
  publicCode?: unknown;
  changeType?: unknown;
  insertBeforeStepId?: unknown;
  moveStepId?: unknown;
  moveBeforeStepId?: unknown;
  movePosition?: unknown;
  newProcessName?: unknown;
  newStandardMillisecondsPerUnit?: unknown;
  newTimeBasis?: unknown;
  newUnitLabel?: unknown;
  newUnitsPerProduct?: unknown;
  newReportQuantityBasis?: unknown;
  newReportUnitLabel?: unknown;
  affectedQty?: unknown;
  timeChanges?: unknown;
  expectedRouteVersion?: unknown;
};

export type SubmitProcessRouteChangeCommand = MutationIdentity & { changeId: string };

export type ReviewProcessRouteChangeCommand = MutationIdentity & {
  changeId: string;
  decision?: 'approve' | 'reject';
  action?: 'approve' | 'reject';
  note?: unknown;
  reviewReason?: unknown;
  newProcessDefinitionId?: unknown;
  affectedQty?: unknown;
  newStandardMillisecondsPerUnit?: unknown;
  timeChanges?: unknown;
};

export type ReevaluateProcessRouteChangeCommand = MutationIdentity & {
  changeId: string;
};

export type ActivateProcessRouteChangeCommand = MutationIdentity & {
  changeId: string;
  expectedRouteVersion?: unknown;
};

export type CompleteProcessSupplementObligationCommand = MutationIdentity & {
  obligationId: string;
  routeId?: unknown;
  publicCode?: unknown;
  expectedRouteVersion?: unknown;
  processedQty: unknown;
  defectQty?: unknown;
  reportedUnitQty?: unknown;
  reportedDefectUnitQty?: unknown;
  defectDisposition?: unknown;
  workDate: unknown;
  employeeIds: string[];
  principalEmployeeId?: string | null;
  workStartedAt?: Date | string | null;
  workEndedAt?: Date | string | null;
  team?: unknown;
  workstation?: unknown;
  remark?: unknown;
  reportSource?: ProcessCompletionSource;
};

export type ListProcessRouteChangesQuery = {
  workOrderId?: string;
  routeId?: string;
  status?: ProcessRouteChangeStatus | keyof typeof ProcessRouteChangeStatus | string;
  take?: number;
  skip?: number;
};

export type GetProcessRouteChangeQuery = { changeId: string };

export type LaborCorrectionSummary = {
  affectedCompletionCount: number;
  affectedExecutionCount: number;
  affectedPoolCount: number;
  replacedActiveClaimCount: number;
  reversalClaimCount: number;
  affectedEmployeeCount: number;
  affectedStepCount: number;
};

export type ProcessSupplementCompletionReleasePlan = {
  releasePolicy: typeof PROCESS_SUPPLEMENT_RELEASE_POLICY;
  createQuantityMovement: false;
  completedQtyDelta: 0;
  releasedGoodQtyDelta: 0;
};

export function deriveProcessRouteChangeDiffSource(
  kind: ProcessRouteChangeDiffInput['kind'] | ProcessRouteChangeDiffKind,
): 'NEW' | 'EXISTING' {
  return kind === 'INSERT_STEP' ? 'NEW' : 'EXISTING';
}

export function processSupplementCompletionReleasePlan(): ProcessSupplementCompletionReleasePlan {
  return {
    releasePolicy: PROCESS_SUPPLEMENT_RELEASE_POLICY,
    createQuantityMovement: false,
    completedQtyDelta: 0,
    releasedGoodQtyDelta: 0,
  };
}

export function previewProcessRouteTimeChangeImpact(input: {
  previousStandardMillisecondsPerUnit: unknown;
  nextStandardMillisecondsPerUnit: unknown;
  affectedQty: unknown;
  affectedCompletionCount?: unknown;
  affectedClaimCount?: unknown;
  affectedEmployeeCount?: unknown;
}) {
  const previousStandardMillisecondsPerUnit = positiveMilliseconds(input.previousStandardMillisecondsPerUnit);
  const nextStandardMillisecondsPerUnit = positiveMilliseconds(input.nextStandardMillisecondsPerUnit);
  const affectedQty = nonnegativeInteger(input.affectedQty, '受影响数量');
  const previousStandardLaborMilliseconds = previousStandardMillisecondsPerUnit * affectedQty;
  const nextStandardLaborMilliseconds = nextStandardMillisecondsPerUnit * affectedQty;
  if (!Number.isSafeInteger(previousStandardLaborMilliseconds) || !Number.isSafeInteger(nextStandardLaborMilliseconds)) {
    throw new ProcessRouteChangeServiceError(
      '工时影响值超出安全范围',
      400,
      'PROCESS_ROUTE_CHANGE_LABOR_IMPACT_TOO_LARGE',
    );
  }
  return {
    previousStandardMillisecondsPerUnit,
    nextStandardMillisecondsPerUnit,
    affectedQty,
    previousStandardLaborMilliseconds,
    nextStandardLaborMilliseconds,
    deltaStandardLaborMilliseconds: nextStandardLaborMilliseconds - previousStandardLaborMilliseconds,
    affectedCompletionCount: nonnegativeInteger(input.affectedCompletionCount ?? 0, '受影响报工数'),
    affectedClaimCount: nonnegativeInteger(input.affectedClaimCount ?? 0, '受影响工时领取数'),
    affectedEmployeeCount: nonnegativeInteger(input.affectedEmployeeCount ?? 0, '受影响员工数'),
  };
}

export function processSupplementObligationState(input: {
  requiredQty: unknown;
  reportedQty: unknown;
  status?: 'ACTIVE' | 'FULFILLED' | 'CANCELLED';
}) {
  const requiredQty = positiveInteger(input.requiredQty, '补充工序应报数量');
  const reportedQty = nonnegativeInteger(input.reportedQty, '补充工序已报数量');
  if (reportedQty > requiredQty) {
    throw new ProcessRouteChangeServiceError(
      '补充工序已报数量不能超过应报数量',
      409,
      'PROCESS_SUPPLEMENT_REPORTED_QTY_EXCEEDED',
    );
  }
  const remainingQty = requiredQty - reportedQty;
  const status = input.status === 'CANCELLED'
    ? 'CANCELLED'
    : remainingQty === 0
      ? 'FULFILLED'
      : 'ACTIVE';
  return {
    requiredQty,
    reportedQty,
    remainingQty,
    status,
    releasePolicy: PROCESS_SUPPLEMENT_RELEASE_POLICY,
  } as const;
}

export function normalizeProcessRouteChangeDiffs(
  input: readonly ProcessRouteChangeDiffInput[],
): NormalizedProcessRouteChangeDiff[] {
  if (!Array.isArray(input) || input.length === 0 || input.length > 50) {
    throw new ProcessRouteChangeServiceError(
      '工艺变更至少包含一项且不能超过 50 项',
      400,
      'PROCESS_ROUTE_CHANGE_DIFFS_INVALID',
    );
  }
  return input.map((raw, position) => {
    const kind = clean(raw.kind, 40) as ProcessRouteChangeDiffInput['kind'];
    if (!['INSERT_STEP', 'UPDATE_TIME', 'MOVE_STEP'].includes(kind)) {
      throw new ProcessRouteChangeServiceError('工艺变更差异类型不正确', 400, 'PROCESS_ROUTE_CHANGE_DIFF_KIND_INVALID');
    }
    const targetStepId = clean(raw.targetStepId, 80) || null;
    const processDefinitionId = clean(raw.processDefinitionId, 80) || null;
    if (kind === 'INSERT_STEP') {
      const after = raw.afterData as InsertStepAfterData;
      if (!processDefinitionId && !clean(after?.processName, 120)) invalidDiff('新增工序缺少工序名称');
      const insertBeforeStepId = clean(after?.insertBeforeStepId ?? targetStepId, 80) || null;
      const normalizedTimeBasis = timeBasis(after?.timeBasis);
      const normalizedUnitsPerProduct = positiveInteger(after?.unitsPerProduct ?? 1, '单套工序次数');
      const normalizedReportQuantityBasis = after?.reportQuantityBasis === 'action' ? 'action' : 'product';
      const normalizedReportUnitLabel = clean(after?.reportUnitLabel, 20) || undefined;
      if (normalizedReportQuantityBasis === 'action'
        && (normalizedTimeBasis !== 'per_unit' || normalizedUnitsPerProduct <= 1 || !normalizedReportUnitLabel)) {
        invalidDiff('按动作数量报工仅适用于按件计时、每套次数大于 1 且已填写动作单位的工序');
      }
      return {
        kind,
        source: 'NEW',
        position,
        targetStepId: insertBeforeStepId,
        processDefinitionId,
        afterData: {
          processCode: clean(after?.processCode, 80) || undefined,
          processName: clean(after?.processName, 120) || undefined,
          stageGroup: clean(after?.stageGroup, 80) || undefined,
          insertBeforeStepId,
          standardMillisecondsPerUnit: positiveMilliseconds(after?.standardMillisecondsPerUnit),
          timeBasis: normalizedTimeBasis,
          unitLabel: clean(after?.unitLabel, 20) || '件',
          setupMilliseconds: nonnegativeInteger(after?.setupMilliseconds ?? 0, '准备工时'),
          unitsPerProduct: normalizedUnitsPerProduct,
          reportQuantityBasis: normalizedReportQuantityBasis,
          reportUnitLabel: normalizedReportUnitLabel,
          countsForEfficiency: after?.countsForEfficiency !== false,
          requiredQty: after?.requiredQty == null ? undefined : positiveInteger(after.requiredQty, '补充工序应报数量'),
        },
      } as NormalizedProcessRouteChangeDiff;
    }
    if (!targetStepId) invalidDiff(kind === 'UPDATE_TIME' ? '工时变更缺少目标工序' : '工序移动缺少目标工序');
    if (kind === 'UPDATE_TIME') {
      const after = raw.afterData as UpdateTimeAfterData;
      const normalizedAfter: Record<string, unknown> = {
        standardMillisecondsPerUnit: positiveMilliseconds(after?.standardMillisecondsPerUnit),
      };
      if (after?.timeBasis != null) normalizedAfter.timeBasis = timeBasis(after.timeBasis);
      if (after?.unitLabel != null) normalizedAfter.unitLabel = clean(after.unitLabel, 20) || '件';
      if (after?.setupMilliseconds != null) {
        normalizedAfter.setupMilliseconds = nonnegativeInteger(after.setupMilliseconds, '准备工时');
      }
      if (after?.unitsPerProduct != null) {
        normalizedAfter.unitsPerProduct = positiveInteger(after.unitsPerProduct, '单套工序次数');
      }
      if (after?.countsForEfficiency != null) normalizedAfter.countsForEfficiency = after.countsForEfficiency !== false;
      return {
        kind,
        source: 'EXISTING',
        position,
        targetStepId,
        processDefinitionId,
        afterData: normalizedAfter,
      } as NormalizedProcessRouteChangeDiff;
    }
    const after = raw.afterData as MoveStepAfterData;
    return {
      kind,
      source: 'EXISTING',
      position,
      targetStepId,
      processDefinitionId,
      afterData: {
        position: nonnegativeInteger(after?.position, '目标位置'),
        sequenceGroup: after?.sequenceGroup == null
          ? undefined
          : positiveInteger(after.sequenceGroup, '目标顺序组'),
        beforeStepId: clean(after?.beforeStepId, 80) || null,
      },
    } as NormalizedProcessRouteChangeDiff;
  });
}

export type ProcessRouteGroupMoveStep = {
  id: string;
  position: number;
  sequenceGroup: number;
  executionMode?: ProcessStepExecutionMode | keyof typeof ProcessStepExecutionMode | string;
};

export type ProcessRouteGroupMovePlan<T extends ProcessRouteGroupMoveStep> = {
  sourceSequenceGroup: number;
  beforeSequenceGroup: number | null;
  affectedSequenceGroups: number[];
  affectedStepIds: string[];
  orderedSteps: Array<T & { position: number; sequenceGroup: number }>;
};

/**
 * Reorders a complete sequence group and preserves the route's existing
 * position/sequence number sets.  A parallel group is never split into two
 * accounting boundaries.
 */
export function planProcessRouteGroupMove<T extends ProcessRouteGroupMoveStep>(input: {
  steps: readonly T[];
  stepId: string;
  beforeStepId?: string | null;
}): ProcessRouteGroupMovePlan<T> {
  const sorted = [...input.steps].sort((left, right) => (
    left.sequenceGroup - right.sequenceGroup || left.position - right.position
  ));
  if (!sorted.length) {
    throw new ProcessRouteChangeServiceError('当前路线没有可调整的工序', 409, 'PROCESS_ROUTE_CHANGE_MOVE_STEPS_REQUIRED');
  }
  if (sorted.some(step => step.executionMode && step.executionMode !== ProcessStepExecutionMode.NORMAL)) {
    throw new ProcessRouteChangeServiceError(
      '当前路线包含补充报工义务，不能通过顺序调整改写其展示位置',
      409,
      'PROCESS_ROUTE_CHANGE_MOVE_SUPPLEMENT_CONFLICT',
    );
  }
  const target = sorted.find(step => step.id === input.stepId);
  if (!target) {
    throw new ProcessRouteChangeServiceError('移动目标工序不存在', 409, 'PROCESS_ROUTE_CHANGE_TARGET_STEP_INVALID');
  }
  const before = input.beforeStepId
    ? sorted.find(step => step.id === input.beforeStepId)
    : null;
  if (input.beforeStepId && !before) {
    throw new ProcessRouteChangeServiceError('移动落点工序不存在', 409, 'PROCESS_ROUTE_CHANGE_MOVE_ANCHOR_INVALID');
  }
  if (before?.sequenceGroup === target.sequenceGroup) {
    throw new ProcessRouteChangeServiceError(
      '移动目标与落点属于同一顺序组，无法调整',
      409,
      'PROCESS_ROUTE_CHANGE_MOVE_SAME_GROUP',
    );
  }
  const sequenceNumbers = [...new Set(sorted.map(step => step.sequenceGroup))].sort((left, right) => left - right);
  const groups = sequenceNumbers.map(sequenceGroup => sorted.filter(step => step.sequenceGroup === sequenceGroup));
  const sourceIndex = groups.findIndex(group => group[0]?.sequenceGroup === target.sequenceGroup);
  const sourceGroup = groups[sourceIndex];
  const remainingGroups = groups.filter((_, index) => index !== sourceIndex);
  const destinationIndex = before
    ? remainingGroups.findIndex(group => group[0]?.sequenceGroup === before.sequenceGroup)
    : remainingGroups.length;
  if (destinationIndex < 0) {
    throw new ProcessRouteChangeServiceError('移动落点顺序组不存在', 409, 'PROCESS_ROUTE_CHANGE_MOVE_ANCHOR_INVALID');
  }
  remainingGroups.splice(destinationIndex, 0, sourceGroup);

  const positions = sorted.map(step => step.position).sort((left, right) => left - right);
  let positionIndex = 0;
  const orderedSteps = remainingGroups.flatMap((group, groupIndex) => group.map(step => ({
    ...step,
    position: positions[positionIndex++],
    sequenceGroup: sequenceNumbers[groupIndex],
  })));
  const previousById = new Map(sorted.map(step => [step.id, step] as const));
  const affectedSteps = orderedSteps.filter(step => {
    const previous = previousById.get(step.id);
    return previous?.position !== step.position || previous.sequenceGroup !== step.sequenceGroup;
  });
  if (!affectedSteps.length) {
    throw new ProcessRouteChangeServiceError(
      '目标顺序与当前路线相同，无需提交变更',
      409,
      'PROCESS_ROUTE_CHANGE_MOVE_NOOP',
    );
  }
  return {
    sourceSequenceGroup: target.sequenceGroup,
    beforeSequenceGroup: before?.sequenceGroup ?? null,
    affectedSequenceGroups: [...new Set(affectedSteps.flatMap(step => {
      const previous = previousById.get(step.id);
      return previous ? [previous.sequenceGroup, step.sequenceGroup] : [step.sequenceGroup];
    }))].sort((left, right) => left - right),
    affectedStepIds: affectedSteps.map(step => step.id),
    orderedSteps,
  };
}

function invalidDiff(message: string): never {
  throw new ProcessRouteChangeServiceError(message, 400, 'PROCESS_ROUTE_CHANGE_DIFF_INVALID');
}

function clean(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function positiveInteger(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new ProcessRouteChangeServiceError(`${label}必须是正整数`, 400, 'PROCESS_ROUTE_CHANGE_NUMBER_INVALID');
  }
  return parsed;
}

function nonnegativeInteger(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new ProcessRouteChangeServiceError(`${label}必须是非负整数`, 400, 'PROCESS_ROUTE_CHANGE_NUMBER_INVALID');
  }
  return parsed;
}

function positiveMilliseconds(value: unknown): number {
  const parsed = positiveInteger(value, '单位标准工时');
  if (parsed > 72 * 60 * 60 * 1_000) {
    throw new ProcessRouteChangeServiceError(
      '单位标准工时不能超过 72 小时',
      400,
      'PROCESS_ROUTE_CHANGE_TIME_TOO_LARGE',
    );
  }
  return parsed;
}

function timeBasis(value: unknown): 'per_unit' | 'per_batch' {
  if (value == null || value === '' || value === 'per_unit') return 'per_unit';
  if (value === 'per_batch') return 'per_batch';
  throw new ProcessRouteChangeServiceError('计时方式不正确', 400, 'PROCESS_ROUTE_CHANGE_TIME_BASIS_INVALID');
}

function expectedVersion(value: unknown): number {
  return nonnegativeInteger(value, '数据版本');
}

function mutationIdentity(command: MutationIdentity) {
  const userId = clean(command.userId, 80);
  const actor = clean(command.actor, 120);
  const idempotencyKey = clean(command.idempotencyKey, 120);
  if (!userId || !actor) {
    throw new ProcessRouteChangeServiceError('缺少操作人信息', 400, 'PROCESS_ROUTE_CHANGE_ACTOR_REQUIRED');
  }
  if (idempotencyKey.length < 8) {
    throw new ProcessRouteChangeServiceError('请求标识无效，请重新提交', 400, 'PROCESS_ROUTE_CHANGE_IDEMPOTENCY_INVALID');
  }
  return { userId, actor, idempotencyKey, expectedVersion: expectedVersion(command.expectedVersion) };
}

const changeDetailInclude = Prisma.validator<Prisma.ProcessRouteChangeInclude>()({
  changeRequest: { include: { attachments: { where: { deletedAt: null } } } },
  workOrder: { select: { id: true, code: true, productName: true, productionTargetQty: true } },
  route: { select: { id: true, status: true, version: true } },
  createdBy: { select: { id: true, displayName: true } },
  reviewedBy: { select: { id: true, displayName: true } },
  activatedBy: { select: { id: true, displayName: true } },
  diffs: { orderBy: { position: 'asc' } },
  supplementObligations: { orderBy: { displayPosition: 'asc' } },
  events: { orderBy: { createdAt: 'asc' } },
  outbox: { orderBy: { createdAt: 'asc' } },
});

type ChangeDetail = Prisma.ProcessRouteChangeGetPayload<{ include: typeof changeDetailInclude }>;

function record(value: Prisma.JsonValue | null | undefined): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

type InsertedProcessDefinition = {
  id: string;
  code: string;
  name: string;
  stageGroup: string;
};

function sameProcessName(left: string, right: string): boolean {
  return left.trim().toLocaleLowerCase('zh-CN') === right.trim().toLocaleLowerCase('zh-CN');
}

function assertInsertedDefinitionNameMatches(
  definition: InsertedProcessDefinition,
  requestedName: string,
) {
  if (requestedName.trim() && !sameProcessName(definition.name, requestedName)) {
    throw new ProcessRouteChangeServiceError(
      `新增工序名称“${requestedName}”与所选工序定义“${definition.name}”不一致`,
      409,
      'PROCESS_ROUTE_CHANGE_PROCESS_DEFINITION_NAME_MISMATCH',
    );
  }
}

async function findUniqueActiveDefinitionByName(
  tx: Prisma.TransactionClient,
  processName: string,
) {
  const matches = await tx.processDefinition.findMany({
    where: { name: { equals: processName, mode: 'insensitive' }, isActive: true },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    take: 2,
  });
  if (matches.length > 1) {
    throw new ProcessRouteChangeServiceError(
      `存在多个名为“${processName}”的有效工序，请工艺审核明确选择工序定义`,
      409,
      'PROCESS_ROUTE_CHANGE_PROCESS_DEFINITION_AMBIGUOUS',
    );
  }
  return matches[0] || null;
}

function serializeChange(change: ChangeDetail) {
  const insert = change.diffs.find(diff => diff.kind === ProcessRouteChangeDiffKind.INSERT_STEP);
  const timeDiffs = change.diffs.filter(diff => diff.kind === ProcessRouteChangeDiffKind.UPDATE_TIME);
  const move = change.diffs.find(diff => diff.kind === ProcessRouteChangeDiffKind.MOVE_STEP);
  const insertAfter = record(insert?.afterData);
  const moveAfter = record(move?.afterData);
  const moveBefore = clean(moveAfter.beforeStepId, 80) || null;
  const routeSnapshot = record(change.routeSnapshot);
  const snapshotSteps = Array.isArray(routeSnapshot.steps)
    ? routeSnapshot.steps.map(item => record(item))
    : [];
  const moveBeforeSnapshot = moveBefore
    ? snapshotSteps.find(step => step.id === moveBefore)
    : null;
  const movedSnapshot = move?.targetStepId
    ? snapshotSteps.find(step => step.id === move.targetStepId)
    : null;
  const impact = record(change.impactSnapshot);
  const changeType = move
    ? 'MOVE_STEP'
    : insert && timeDiffs.length
    ? 'BOTH'
    : insert
      ? 'INSERT_STEP'
      : 'UPDATE_TIME';
  return {
    ...change,
    currentRouteVersion: change.route.version,
    routeVersionConflict: change.status === ProcessRouteChangeStatus.APPROVED
      && change.route.version !== change.baseRouteVersion,
    payload: {
      changeType,
      insertBeforeStepId: insert?.targetStepId ?? null,
      insertAfterStepId: null,
      newStepId: change.supplementObligations[0]?.displayStepId ?? null,
      newProcessDefinitionId: insert?.processDefinitionId ?? null,
      newProcessName: typeof insertAfter.processName === 'string' ? insertAfter.processName : null,
      newProcessCode: typeof insertAfter.processCode === 'string' ? insertAfter.processCode : null,
      newStandardMillisecondsPerUnit: Number(insertAfter.standardMillisecondsPerUnit) || null,
      affectedQty: Number(insertAfter.requiredQty || impact.affectedQty) || null,
      moveStepId: move?.targetStepId ?? null,
      moveBeforeStepId: moveBefore,
      movedProcessName: typeof movedSnapshot?.processName === 'string' ? movedSnapshot.processName : null,
      moveBeforeProcessName: typeof moveBeforeSnapshot?.processName === 'string' ? moveBeforeSnapshot.processName : null,
      timeChanges: timeDiffs.map(diff => {
        const after = record(diff.afterData);
        const before = record(diff.beforeData);
        return {
          stepId: diff.targetStepId || '',
          processName: typeof before.processName === 'string' ? before.processName : null,
          previousStandardMillisecondsPerUnit: Number(before.standardMillisecondsPerUnit) || null,
          standardMillisecondsPerUnit: Number(after.standardMillisecondsPerUnit) || 0,
        };
      }),
      reason: change.changeRequest.reason,
    },
    impact: {
      ...impact,
      warnings: Array.isArray(impact.warnings) ? impact.warnings : [],
    },
    requesterName: change.createdBy?.displayName ?? null,
    reviewerName: change.reviewedBy?.displayName ?? null,
    reviewReason: change.reviewNote,
    createdAt: change.createdAt.toISOString(),
    updatedAt: change.updatedAt.toISOString(),
    submittedAt: change.submittedAt?.toISOString() ?? null,
    reviewedAt: change.reviewedAt?.toISOString() ?? null,
    activationStartedAt: change.activationStartedAt?.toISOString() ?? null,
    activatedAt: change.activatedAt?.toISOString() ?? null,
    changeRequest: {
      ...change.changeRequest,
      createdAt: change.changeRequest.createdAt.toISOString(),
      updatedAt: change.changeRequest.updatedAt.toISOString(),
      effectiveAt: change.changeRequest.effectiveAt?.toISOString() ?? null,
      dueAt: change.changeRequest.dueAt?.toISOString() ?? null,
      closedAt: change.changeRequest.closedAt?.toISOString() ?? null,
      attachments: change.changeRequest.attachments.map(attachment => ({
        ...attachment,
        size: attachment.size.toString(),
        createdAt: attachment.createdAt.toISOString(),
        updatedAt: attachment.updatedAt.toISOString(),
        deletedAt: attachment.deletedAt?.toISOString() ?? null,
      })),
    },
    diffs: change.diffs.map(diff => ({ ...diff, createdAt: diff.createdAt.toISOString() })),
    supplementObligations: change.supplementObligations.map(item => ({
      ...item,
      actualRequiredQty: processSupplementActualRequiredQty(item),
      remainingQty: processSupplementRemainingQty(item),
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
      lastReportedAt: item.lastReportedAt?.toISOString() ?? null,
      fulfilledAt: item.fulfilledAt?.toISOString() ?? null,
    })),
    events: change.events.map(event => ({ ...event, createdAt: event.createdAt.toISOString() })),
    outbox: change.outbox.map(item => ({
      ...item,
      availableAt: item.availableAt.toISOString(),
      processedAt: item.processedAt?.toISOString() ?? null,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
    })),
  };
}

async function loadChangeDetail(changeId: string): Promise<ChangeDetail> {
  const change = await prisma.processRouteChange.findUnique({
    where: { id: clean(changeId, 80) },
    include: changeDetailInclude,
  });
  if (!change) {
    throw new ProcessRouteChangeServiceError('工艺变更不存在', 404, 'PROCESS_ROUTE_CHANGE_NOT_FOUND');
  }
  return change;
}

async function serializable<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5_000,
        timeout: 30_000,
      });
    } catch (error) {
      if (error instanceof ProductionControlError) throw new ProcessRouteChangeServiceError(error.message, error.status, error.code);
      if (
        attempt < 2
        && isProductionSerializationConflict(error)
      ) continue;
      if (isProductionSerializationConflict(error)) throw new ProcessRouteChangeServiceError('生产状态或工艺刚被更新，请刷新后重试', 409, 'PROCESS_ROUTE_CHANGE_CONFLICT');
      throw error;
    }
  }
  throw new ProcessRouteChangeServiceError('工艺变更事务发生并发冲突', 409, 'PROCESS_ROUTE_CHANGE_CONFLICT');
}

function json(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function routeSnapshot(route: {
  id: string;
  status: string;
  version: number;
  productTimeProfileId: string | null;
  productTimeProfileVersion: number | null;
  steps: Array<{
    id: string;
    processDefinitionId: string | null;
    processCode: string;
    processName: string;
    stageGroup: string;
    position: number;
    sequenceGroup: number;
    status: string;
    standardMillisecondsPerUnit: number | null;
  }>;
}) {
  return {
    routeId: route.id,
    status: route.status,
    version: route.version,
    productTimeProfileId: route.productTimeProfileId,
    productTimeProfileVersion: route.productTimeProfileVersion,
    steps: route.steps.map(step => ({ ...step })),
  };
}

async function replayChangeId(
  tx: Prisma.TransactionClient,
  idempotencyKey: string,
  action: string,
  expectedChangeId?: string,
): Promise<string | null> {
  const existing = await tx.processRouteChangeEvent.findUnique({
    where: { idempotencyKey },
    select: { changeId: true, action: true },
  });
  if (!existing) return null;
  if (existing.action !== action || (expectedChangeId && existing.changeId !== expectedChangeId)) {
    throw new ProcessRouteChangeServiceError(
      '请求标识已用于其他工艺变更操作',
      409,
      'PROCESS_ROUTE_CHANGE_IDEMPOTENCY_CONFLICT',
    );
  }
  return existing.changeId;
}

export async function createProcessRouteChangeProposal(
  command: CreateProcessRouteChangeProposalCommand,
) {
  const identity = mutationIdentity({
    ...command,
    expectedVersion: command.expectedVersion ?? command.expectedRouteVersion,
  });
  const workOrderId = clean(command.workOrderId, 80);
  const routeId = clean(command.routeId, 80);
  const rawChangeType = clean(command.changeType, 40);
  const rawNewProcessName = clean(command.newProcessName, 120);
  const title = clean(command.title, 160)
    || (rawChangeType === 'UPDATE_TIME'
      ? '现场工序工时变更'
      : rawChangeType === 'MOVE_STEP'
        ? '现场工序顺序调整'
        : `现场补充工序${rawNewProcessName ? `：${rawNewProcessName}` : ''}`);
  const reason = clean(command.reason, 1_000) || null;
  const description = clean(command.description, 4_000) || null;
  const scope = command.scope || ProcessRouteChangeScope.CURRENT_WORK_ORDER_AND_FUTURE_PRODUCT;
  if (!routeId || title.length < 2) {
    throw new ProcessRouteChangeServiceError(
      '工单、路线和变更标题不能为空',
      400,
      'PROCESS_ROUTE_CHANGE_REQUIRED',
    );
  }
  if (!Object.values(ProcessRouteChangeScope).includes(scope as ProcessRouteChangeScope)) {
    throw new ProcessRouteChangeServiceError('变更适用范围不正确', 400, 'PROCESS_ROUTE_CHANGE_SCOPE_INVALID');
  }
  let submittedDiffs = command.diffs;
  if (!submittedDiffs) {
    const timeChanges = Array.isArray(command.timeChanges) ? command.timeChanges : [];
    const translated: ProcessRouteChangeDiffInput[] = timeChanges.map((value) => {
      const item = value && typeof value === 'object' ? value as Record<string, unknown> : {};
      return {
        kind: 'UPDATE_TIME',
        targetStepId: clean(item.stepId, 80),
        afterData: {
          standardMillisecondsPerUnit: positiveMilliseconds(item.standardMillisecondsPerUnit),
        },
      };
    });
    if (rawChangeType === 'INSERT_STEP' || rawChangeType === 'BOTH') {
      translated.unshift({
        kind: 'INSERT_STEP',
        processDefinitionId: null,
        targetStepId: clean(command.insertBeforeStepId, 80) || null,
        afterData: {
          processName: rawNewProcessName,
          standardMillisecondsPerUnit: positiveMilliseconds(command.newStandardMillisecondsPerUnit),
          timeBasis: command.newTimeBasis === 'per_batch' ? 'per_batch' : 'per_unit',
          unitLabel: clean(command.newUnitLabel, 20) || '件',
          unitsPerProduct: positiveInteger(command.newUnitsPerProduct ?? 1, '单套工序次数'),
          reportQuantityBasis: command.newReportQuantityBasis === 'action' ? 'action' : 'product',
          reportUnitLabel: clean(command.newReportUnitLabel, 20) || undefined,
          requiredQty: command.affectedQty == null ? undefined : positiveInteger(command.affectedQty, '补充工序应报数量'),
        },
      });
    }
    if (rawChangeType === 'MOVE_STEP') {
      const moveStepId = clean(command.moveStepId, 80);
      if (!moveStepId) invalidDiff('工序移动缺少目标工序');
      translated.push({
        kind: 'MOVE_STEP',
        targetStepId: moveStepId,
        afterData: {
          position: nonnegativeInteger(command.movePosition, '目标位置'),
          beforeStepId: clean(command.moveBeforeStepId, 80) || null,
        },
      });
    }
    submittedDiffs = translated;
  }
  const diffs = normalizeProcessRouteChangeDiffs(submittedDiffs);
  const moveDiffs = diffs.filter(diff => diff.kind === ProcessRouteChangeDiffKind.MOVE_STEP);
  if (moveDiffs.length && (moveDiffs.length !== 1 || diffs.length !== 1)) {
    throw new ProcessRouteChangeServiceError(
      '一次变更只能调整一个完整顺序组，不能与新增或工时变更混合启用',
      400,
      'PROCESS_ROUTE_CHANGE_MOVE_COMBINATION_INVALID',
    );
  }
  const changeId = await serializable(async tx => {
    const replay = await replayChangeId(tx, identity.idempotencyKey, 'create');
    if (replay) return replay;
    const route = await tx.workOrderProcessRoute.findFirst({
      where: { id: routeId, ...(workOrderId ? { workOrderId } : {}) },
      include: {
        workOrder: {
          select: {
            id: true,
            code: true,
            drawingLibraryItemId: true,
            productionTargetQty: true,
            completedQty: true,
            qrTicket: { select: { publicCode: true } },
          },
        },
        steps: { where: { retiredAt: null }, orderBy: { position: 'asc' } },
      },
    });
    if (!route) {
      throw new ProcessRouteChangeServiceError(
        '工艺路线不存在或不属于当前工单',
        404,
        'PROCESS_ROUTE_CHANGE_ROUTE_NOT_FOUND',
      );
    }
    if (route.version !== identity.expectedVersion) {
      throw new ProcessRouteChangeServiceError(
        '工艺路线已更新，请刷新后重新发起',
        409,
        'PROCESS_ROUTE_VERSION_CONFLICT',
      );
    }
    const publicCode = clean(command.publicCode, 120);
    if (publicCode && route.workOrder.qrTicket?.publicCode !== publicCode) {
      throw new ProcessRouteChangeServiceError(
        '二维码与当前工艺路线不匹配',
        409,
        'PROCESS_ROUTE_CHANGE_QR_CONFLICT',
      );
    }
    if (
      scope !== ProcessRouteChangeScope.CURRENT_WORK_ORDER_ONLY
      && !route.workOrder.drawingLibraryItemId
    ) {
      throw new ProcessRouteChangeServiceError(
        '工单尚未关联产品资料，不能同步未来工单工艺',
        409,
        'PROCESS_ROUTE_CHANGE_PRODUCT_REQUIRED',
      );
    }
    const stepById = new Map(route.steps.map(step => [step.id, step]));
    const definitionIds = [...new Set(diffs.map(diff => diff.processDefinitionId).filter(Boolean))] as string[];
    const definitions = await tx.processDefinition.findMany({
      where: { id: { in: definitionIds }, isActive: true },
    });
    const definitionById = new Map(definitions.map(item => [item.id, item]));
    if (definitions.length !== definitionIds.length) {
      throw new ProcessRouteChangeServiceError(
        '所选工序定义不存在或已停用',
        409,
        'PROCESS_ROUTE_CHANGE_PROCESS_DEFINITION_INVALID',
      );
    }
    const prepared = diffs.map(diff => {
      const target = diff.targetStepId ? stepById.get(diff.targetStepId) : null;
      if (diff.targetStepId && !target) {
        throw new ProcessRouteChangeServiceError(
          '目标工序不存在或不属于当前路线',
          409,
          'PROCESS_ROUTE_CHANGE_TARGET_STEP_INVALID',
        );
      }
      const definition = diff.processDefinitionId ? definitionById.get(diff.processDefinitionId) : null;
      if (diff.kind === ProcessRouteChangeDiffKind.INSERT_STEP && definition) {
        assertInsertedDefinitionNameMatches(
          definition,
          clean((diff.afterData as InsertStepAfterData).processName, 120),
        );
      }
      return {
        kind: diff.kind as ProcessRouteChangeDiffKind,
        source: diff.source as ProcessRouteChangeStepSource,
        position: diff.position,
        targetStepId: diff.targetStepId,
        processDefinitionId: diff.kind === ProcessRouteChangeDiffKind.INSERT_STEP
          ? diff.processDefinitionId
          : diff.processDefinitionId || target?.processDefinitionId || null,
        beforeData: target ? json({
          id: target.id,
          processDefinitionId: target.processDefinitionId,
          processCode: target.processCode,
          processName: target.processName,
          stageGroup: target.stageGroup,
          position: target.position,
          sequenceGroup: target.sequenceGroup,
          standardMillisecondsPerUnit: target.standardMillisecondsPerUnit,
          timeBasis: target.timeBasis,
          setupMilliseconds: target.setupMilliseconds,
          unitsPerProduct: target.unitsPerProduct,
          countsForEfficiency: target.countsForEfficiency,
        }) : undefined,
        afterData: json(diff.kind === 'INSERT_STEP' ? {
          ...diff.afterData,
          processCode: (diff.afterData as InsertStepAfterData).processCode || definition?.code,
          processName: (diff.afterData as InsertStepAfterData).processName || definition?.name,
          stageGroup: (diff.afterData as InsertStepAfterData).stageGroup || definition?.stageGroup,
        } : diff.kind === 'MOVE_STEP' ? {
          ...diff.afterData,
          beforeProcessName: stepById.get(clean(diff.afterData.beforeStepId, 80))?.processName || null,
        } : diff.afterData),
      };
    });
    const moveDiff = diffs.find(diff => diff.kind === ProcessRouteChangeDiffKind.MOVE_STEP);
    const movePlan = moveDiff?.targetStepId
      ? scope === ProcessRouteChangeScope.FUTURE_PRODUCT_ONLY
        ? planProcessRouteGroupMove({
            steps: route.steps,
            stepId: moveDiff.targetStepId,
            beforeStepId: clean(moveDiff.afterData.beforeStepId, 80) || null,
          })
        : (await assessCurrentRouteGroupMove(
            tx,
            route.id,
            moveDiff.targetStepId,
            clean(moveDiff.afterData.beforeStepId, 80) || null,
          )).plan
      : null;
    // Only UPDATE_TIME diffs have a historical-labor impact.  INSERT_STEP and
    // MOVE_STEP may point at a boundary step, but that must never make a pure
    // route edit look like a time recalculation.
    const timeStepIds = [...new Set(diffs
      .filter(diff => diff.kind === ProcessRouteChangeDiffKind.UPDATE_TIME && diff.targetStepId)
      .map(diff => diff.targetStepId as string))];
    const insertBoundaryStepIds = new Set<string>();
    for (const diff of diffs.filter(item => item.kind === ProcessRouteChangeDiffKind.INSERT_STEP)) {
      const target = diff.targetStepId ? stepById.get(diff.targetStepId) : null;
      if (!target) continue;
      for (const step of route.steps) {
        if (step.sequenceGroup >= target.sequenceGroup) insertBoundaryStepIds.add(step.id);
      }
    }
    const [affectedCompletions, affectedClaims, affectedExecutions, boundaryCompletions, boundaryExecutions] = await Promise.all([
      timeStepIds.length
        ? tx.processCompletion.findMany({
            where: { stepId: { in: timeStepIds }, voidedAt: null },
            select: {
              stepId: true,
              goodQty: true,
              completedAt: true,
              laborPool: { select: { eligibleQty: true, status: true } },
            },
          })
        : Promise.resolve([]),
      timeStepIds.length
        ? tx.processLaborClaim.findMany({
            where: {
              status: ProcessLaborClaimStatus.ACTIVE,
              pool: { stepId: { in: timeStepIds }, completion: { voidedAt: null } },
            },
            select: { employeeId: true },
          })
        : Promise.resolve([]),
      timeStepIds.length
        ? tx.processExecution.findMany({
            where: { stepId: { in: timeStepIds }, voidedAt: null },
            select: { stepId: true, employeeId: true, goodQty: true },
          })
        : Promise.resolve([]),
      insertBoundaryStepIds.size
        ? tx.processCompletion.findMany({
            where: { stepId: { in: [...insertBoundaryStepIds] }, voidedAt: null },
            select: { stepId: true },
            distinct: ['stepId'],
          })
        : Promise.resolve([]),
      insertBoundaryStepIds.size
        ? tx.processExecution.findMany({
            where: { stepId: { in: [...insertBoundaryStepIds] }, voidedAt: null },
            select: { stepId: true },
            distinct: ['stepId'],
          })
        : Promise.resolve([]),
    ]);
    const reportedBoundaryStepIds = new Set([
      ...route.steps
        .filter(step => insertBoundaryStepIds.has(step.id) && (
          step.processedQty > 0
          || step.goodOutputQty > 0
          || step.defectOutputQty > 0
          || step.releasedGoodQty > 0
        ))
        .map(step => step.id),
      ...boundaryCompletions.map(item => item.stepId),
      ...boundaryExecutions.map(item => item.stepId),
    ]);
    let previousStandardLaborMilliseconds = 0n;
    let nextStandardLaborMilliseconds = 0n;
    for (const diff of diffs.filter(item => item.kind === ProcessRouteChangeDiffKind.UPDATE_TIME)) {
      if (!diff.targetStepId) continue;
      const step = stepById.get(diff.targetStepId);
      if (!step?.standardMillisecondsPerUnit) continue;
      const after = diff.afterData as Record<string, unknown>;
      const previousBasis = timeBasis(step.timeBasis);
      const nextBasis = timeBasis(after.timeBasis ?? step.timeBasis);
      const previousStandard = step.standardMillisecondsPerUnit;
      const nextStandard = positiveMilliseconds(after.standardMillisecondsPerUnit);
      const previousSetup = step.setupMilliseconds;
      const nextSetup = after.setupMilliseconds == null
        ? step.setupMilliseconds
        : nonnegativeInteger(after.setupMilliseconds, '准备工时');
      const previousUnits = step.unitsPerProduct;
      const nextUnits = after.unitsPerProduct == null
        ? step.unitsPerProduct
        : positiveInteger(after.unitsPerProduct, '单套工序次数');
      const completions = affectedCompletions
        .filter(item => item.stepId === diff.targetStepId)
        .sort((left, right) => left.completedAt.getTime() - right.completedAt.getTime());
      if (completions.length) {
        const quantities = completions.map(item => (
          item.laborPool && item.laborPool.status !== ProcessLaborPoolStatus.VOIDED
            ? item.laborPool.eligibleQty
            : item.goodQty
        ));
        const previousVariable = previousBasis === 'per_batch'
          ? BigInt(previousStandard) * BigInt(quantities.length)
          : BigInt(previousStandard) * BigInt(quantities.reduce((sum, value) => sum + value, 0)) * BigInt(previousUnits);
        const nextVariable = nextBasis === 'per_batch'
          ? BigInt(nextStandard) * BigInt(quantities.length)
          : BigInt(nextStandard) * BigInt(quantities.reduce((sum, value) => sum + value, 0)) * BigInt(nextUnits);
        previousStandardLaborMilliseconds += BigInt(previousSetup) + previousVariable;
        nextStandardLaborMilliseconds += BigInt(nextSetup) + nextVariable;
      }
      for (const execution of affectedExecutions.filter(item => item.stepId === diff.targetStepId)) {
        previousStandardLaborMilliseconds += BigInt(previousSetup) + (
          previousBasis === 'per_batch'
            ? BigInt(previousStandard)
            : BigInt(previousStandard) * BigInt(execution.goodQty) * BigInt(previousUnits)
        );
        nextStandardLaborMilliseconds += BigInt(nextSetup) + (
          nextBasis === 'per_batch'
            ? BigInt(nextStandard)
            : BigInt(nextStandard) * BigInt(execution.goodQty) * BigInt(nextUnits)
        );
      }
    }
    const laborJsonValue = (value: bigint): number | string => (
      value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= BigInt(Number.MIN_SAFE_INTEGER)
        ? Number(value)
        : value.toString()
    );
    const affectedEmployeeIds = new Set([
      ...affectedClaims.map(item => item.employeeId),
      ...affectedExecutions.map(item => item.employeeId),
    ]);
    const changeRequest = await tx.changeRequest.create({
      data: {
        title,
        type: 'process',
        priority: 'normal',
        status: 'draft',
        reason,
        description,
        impactAreas: ['process_route', 'production_execution', 'qr_field_report', 'labor_standard'],
        impactScope: scope,
        workOrderId: route.workOrder.id,
        requesterId: identity.userId,
        ownerId: identity.userId,
      },
    });
    const created = await tx.processRouteChange.create({
      data: {
        changeRequestId: changeRequest.id,
        workOrderId: route.workOrder.id,
        routeId,
        scope: scope as ProcessRouteChangeScope,
        baseRouteVersion: route.version,
        sourceProductTimeProfileId: route.productTimeProfileId,
        baseProductProfileVersion: route.productTimeProfileVersion,
        routeSnapshot: json(routeSnapshot(route)),
        impactSnapshot: json({
          downstreamReportedStepCount: Math.max(
            reportedBoundaryStepIds.size,
            diffs.some(diff => diff.kind === ProcessRouteChangeDiffKind.INSERT_STEP)
              && Number(route.workOrder.completedQty) > 0
              ? 1
              : 0,
          ),
          affectedCompletionCount: affectedCompletions.length,
          affectedClaimCount: affectedClaims.length,
          affectedExecutionCount: affectedExecutions.length,
          affectedEmployeeCount: affectedEmployeeIds.size,
          affectedQty: route.workOrder.productionTargetQty,
          moveAffectedStepCount: movePlan?.affectedStepIds.length || 0,
          moveAffectedSequenceGroups: movePlan?.affectedSequenceGroups || [],
          warnings: movePlan ? [
            '启用时将再次校验完整顺序组、报工、在制数量与移动账本；任一事实变化都会拒绝启用。',
          ] : [],
          previousStandardLaborMilliseconds: laborJsonValue(previousStandardLaborMilliseconds),
          nextStandardLaborMilliseconds: laborJsonValue(nextStandardLaborMilliseconds),
          deltaStandardLaborMilliseconds: laborJsonValue(
            nextStandardLaborMilliseconds - previousStandardLaborMilliseconds,
          ),
        }),
        createdById: identity.userId,
        updatedById: identity.userId,
        diffs: { create: prepared },
      },
    });
    await tx.processRouteChangeEvent.create({
      data: {
        changeId: created.id,
        action: 'create',
        idempotencyKey: identity.idempotencyKey,
        toStatus: ProcessRouteChangeStatus.DRAFT,
        actorId: identity.userId,
        actorSnapshot: identity.actor,
        detail: json({ title, scope, diffCount: prepared.length }),
      },
    });
    return created.id;
  });
  return serializeChange(await loadChangeDetail(changeId));
}

async function transitionProcessRouteChange(input: {
  changeId: string;
  identity: ReturnType<typeof mutationIdentity>;
  action: string;
  from: ProcessRouteChangeStatus;
  to: ProcessRouteChangeStatus;
  changeRequestStatus: string;
  detail?: Prisma.InputJsonValue;
  data?: Prisma.ProcessRouteChangeUncheckedUpdateManyInput;
  outboxEventType: string;
  alreadyApplied?: (current: {
    status: ProcessRouteChangeStatus;
    reviewDecision: string | null;
  }) => boolean;
  beforeTransition?: (
    tx: Prisma.TransactionClient,
    current: {
      id: string;
      changeRequestId: string;
      status: ProcessRouteChangeStatus;
      version: number;
      workOrderId: string;
      routeId: string;
      impactSnapshot: Prisma.JsonValue | null;
      reviewDecision: string | null;
      updatedAt: Date;
    },
  ) => Promise<void>;
}) {
  const changeId = clean(input.changeId, 80);
  if (!changeId) {
    throw new ProcessRouteChangeServiceError('缺少工艺变更标识', 400, 'PROCESS_ROUTE_CHANGE_ID_REQUIRED');
  }
  const id = await serializable(async tx => {
    const replay = await replayChangeId(tx, input.identity.idempotencyKey, input.action, changeId);
    if (replay) return replay;
    const current = await tx.processRouteChange.findUnique({
      where: { id: changeId },
      select: {
        id: true,
        changeRequestId: true,
        status: true,
        version: true,
        workOrderId: true,
        routeId: true,
        impactSnapshot: true,
        reviewDecision: true,
        updatedAt: true,
      },
    });
    if (!current) {
      throw new ProcessRouteChangeServiceError('工艺变更不存在', 404, 'PROCESS_ROUTE_CHANGE_NOT_FOUND');
    }
    if (current.status !== input.from) {
      if (input.alreadyApplied?.(current)) return changeId;
      throw new ProcessRouteChangeServiceError(
        `当前状态不能执行${input.action}`,
        409,
        'PROCESS_ROUTE_CHANGE_STATUS_CONFLICT',
        {
          currentStatus: current.status,
          currentVersion: current.version,
          expectedStatus: input.from,
          updatedAt: current.updatedAt.toISOString(),
        },
      );
    }
    if (current.version !== input.identity.expectedVersion) {
      throw new ProcessRouteChangeServiceError(
        '工艺变更已被其他人更新，请刷新后重试',
        409,
        'PROCESS_ROUTE_CHANGE_VERSION_CONFLICT',
        {
          currentStatus: current.status,
          currentVersion: current.version,
          expectedStatus: input.from,
          updatedAt: current.updatedAt.toISOString(),
        },
      );
    }
    await input.beforeTransition?.(tx, current);
    const updated = await tx.processRouteChange.updateMany({
      where: { id: changeId, version: current.version, status: input.from },
      data: {
        ...input.data,
        status: input.to,
        updatedById: input.identity.userId,
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) {
      throw new ProcessRouteChangeServiceError(
        '工艺变更已被其他人更新，请刷新后重试',
        409,
        'PROCESS_ROUTE_CHANGE_VERSION_CONFLICT',
      );
    }
    await tx.changeRequest.update({
      where: { id: current.changeRequestId },
      data: { status: input.changeRequestStatus, version: { increment: 1 } },
    });
    await tx.processRouteChangeEvent.create({
      data: {
        changeId,
        action: input.action,
        idempotencyKey: input.identity.idempotencyKey,
        fromStatus: input.from,
        toStatus: input.to,
        actorId: input.identity.userId,
        actorSnapshot: input.identity.actor,
        detail: input.detail,
      },
    });
    await tx.processRouteChangeOutbox.create({
      data: {
        changeId,
        eventType: input.outboxEventType,
        dedupeKey: `${input.outboxEventType}:${input.identity.idempotencyKey}`.slice(0, 180),
        payload: json({
          changeId,
          workOrderId: current.workOrderId,
          fromStatus: input.from,
          toStatus: input.to,
          actor: input.identity.actor,
          detail: input.detail || null,
        }),
      },
    });
    return changeId;
  });
  return serializeChange(await loadChangeDetail(id));
}

export async function submitProcessRouteChange(command: SubmitProcessRouteChangeCommand) {
  const identity = mutationIdentity(command);
  return transitionProcessRouteChange({
    changeId: command.changeId,
    identity,
    action: 'submit',
    from: ProcessRouteChangeStatus.DRAFT,
    to: ProcessRouteChangeStatus.SUBMITTED,
    changeRequestStatus: 'assessing',
    data: { submittedAt: new Date() },
    outboxEventType: 'PROCESS_ROUTE_CHANGE_SUBMITTED',
  });
}

async function calculateReviewedTimeImpactSnapshot(
  tx: Prisma.TransactionClient,
  routeId: string,
  diffs: Array<{
    kind: ProcessRouteChangeDiffKind;
    targetStepId: string | null;
    afterData: Prisma.JsonValue;
  }>,
) {
  const timeDiffs = diffs.filter(diff => (
    diff.kind === ProcessRouteChangeDiffKind.UPDATE_TIME && Boolean(diff.targetStepId)
  ));
  const stepIds = [...new Set(timeDiffs.map(diff => diff.targetStepId as string))];
  if (!stepIds.length) {
    return {
      affectedCompletionCount: 0,
      affectedClaimCount: 0,
      affectedExecutionCount: 0,
      affectedEmployeeCount: 0,
      previousStandardLaborMilliseconds: 0,
      nextStandardLaborMilliseconds: 0,
      deltaStandardLaborMilliseconds: 0,
    };
  }
  const [steps, completions, claims, executions] = await Promise.all([
    tx.workOrderProcessStep.findMany({
      where: { routeId, id: { in: stepIds } },
      select: {
        id: true,
        timeBasis: true,
        standardMillisecondsPerUnit: true,
        setupMilliseconds: true,
        unitsPerProduct: true,
      },
    }),
    tx.processCompletion.findMany({
      where: { routeId, stepId: { in: stepIds }, voidedAt: null },
      select: {
        stepId: true,
        goodQty: true,
        completedAt: true,
        laborPool: { select: { eligibleQty: true, status: true } },
      },
    }),
    tx.processLaborClaim.findMany({
      where: {
        status: ProcessLaborClaimStatus.ACTIVE,
        pool: { stepId: { in: stepIds }, completion: { routeId, voidedAt: null } },
      },
      select: { employeeId: true },
    }),
    tx.processExecution.findMany({
      where: { stepId: { in: stepIds }, step: { routeId }, voidedAt: null },
      select: { stepId: true, employeeId: true, goodQty: true },
    }),
  ]);
  const stepById = new Map(steps.map(step => [step.id, step]));
  let previousStandardLaborMilliseconds = 0n;
  let nextStandardLaborMilliseconds = 0n;
  for (const diff of timeDiffs) {
    const stepId = diff.targetStepId as string;
    const step = stepById.get(stepId);
    if (!step) {
      throw new ProcessRouteChangeServiceError(
        '审核工时目标工序不存在',
        409,
        'PROCESS_ROUTE_CHANGE_TARGET_STEP_INVALID',
      );
    }
    const after = record(diff.afterData);
    const previousBasis = timeBasis(step.timeBasis);
    const nextBasis = timeBasis(after.timeBasis ?? step.timeBasis);
    const previousStandard = step.standardMillisecondsPerUnit ?? 0;
    const nextStandard = positiveMilliseconds(after.standardMillisecondsPerUnit);
    const previousSetup = step.setupMilliseconds;
    const nextSetup = after.setupMilliseconds == null
      ? step.setupMilliseconds
      : nonnegativeInteger(after.setupMilliseconds, '准备工时');
    const previousUnits = step.unitsPerProduct;
    const nextUnits = after.unitsPerProduct == null
      ? step.unitsPerProduct
      : positiveInteger(after.unitsPerProduct, '单套工序次数');
    const stepCompletions = completions
      .filter(item => item.stepId === stepId)
      .sort((left, right) => left.completedAt.getTime() - right.completedAt.getTime());
    if (stepCompletions.length) {
      const quantities = stepCompletions.map(item => (
        item.laborPool && item.laborPool.status !== ProcessLaborPoolStatus.VOIDED
          ? item.laborPool.eligibleQty
          : item.goodQty
      ));
      const previousVariable = previousBasis === 'per_batch'
        ? BigInt(previousStandard) * BigInt(quantities.length)
        : BigInt(previousStandard) * BigInt(quantities.reduce((sum, value) => sum + value, 0)) * BigInt(previousUnits);
      const nextVariable = nextBasis === 'per_batch'
        ? BigInt(nextStandard) * BigInt(quantities.length)
        : BigInt(nextStandard) * BigInt(quantities.reduce((sum, value) => sum + value, 0)) * BigInt(nextUnits);
      previousStandardLaborMilliseconds += BigInt(previousSetup) + previousVariable;
      nextStandardLaborMilliseconds += BigInt(nextSetup) + nextVariable;
    }
    for (const execution of executions.filter(item => item.stepId === stepId)) {
      previousStandardLaborMilliseconds += BigInt(previousSetup) + (
        previousBasis === 'per_batch'
          ? BigInt(previousStandard)
          : BigInt(previousStandard) * BigInt(execution.goodQty) * BigInt(previousUnits)
      );
      nextStandardLaborMilliseconds += BigInt(nextSetup) + (
        nextBasis === 'per_batch'
          ? BigInt(nextStandard)
          : BigInt(nextStandard) * BigInt(execution.goodQty) * BigInt(nextUnits)
      );
    }
  }
  const jsonInteger = (value: bigint): number | string => (
    value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= BigInt(Number.MIN_SAFE_INTEGER)
      ? Number(value)
      : value.toString()
  );
  return {
    affectedCompletionCount: completions.length,
    affectedClaimCount: claims.length,
    affectedExecutionCount: executions.length,
    affectedEmployeeCount: new Set([
      ...claims.map(item => item.employeeId),
      ...executions.map(item => item.employeeId),
    ]).size,
    previousStandardLaborMilliseconds: jsonInteger(previousStandardLaborMilliseconds),
    nextStandardLaborMilliseconds: jsonInteger(nextStandardLaborMilliseconds),
    deltaStandardLaborMilliseconds: jsonInteger(
      nextStandardLaborMilliseconds - previousStandardLaborMilliseconds,
    ),
  };
}

type RouteChangeReevaluationStep = {
  id: string;
  processDefinitionId: string | null;
  processCode: string;
  processName: string;
  stageGroup: string;
  position: number;
  sequenceGroup: number;
  status: string;
  processedQty: number;
  goodOutputQty: number;
  defectOutputQty: number;
  releasedGoodQty: number;
  standardMillisecondsPerUnit: number | null;
  timeBasis: string | null;
  setupMilliseconds: number;
  unitsPerProduct: number;
  unitLabel: string | null;
  countsForEfficiency: boolean;
};

type RouteChangeReevaluationDiff = {
  id: string;
  kind: ProcessRouteChangeDiffKind;
  targetStepId: string | null;
  afterData: Prisma.JsonValue;
};

type RouteChangeReevaluationInput = {
    route: {
      id: string;
      workOrder: { productionTargetQty: number | null; completedQty: number | string | null };
      steps: RouteChangeReevaluationStep[];
    };
    diffs: RouteChangeReevaluationDiff[];
};

async function calculateRouteChangeImpactSnapshot(
  tx: Prisma.TransactionClient,
  input: RouteChangeReevaluationInput,
) {
  const stepById = new Map(input.route.steps.map(step => [step.id, step]));
  const insertBoundaryStepIds = new Set<string>();
  for (const diff of input.diffs.filter(item => item.kind === ProcessRouteChangeDiffKind.INSERT_STEP)) {
    const target = diff.targetStepId ? stepById.get(diff.targetStepId) : null;
    if (!target) continue;
    for (const step of input.route.steps) {
      if (step.sequenceGroup >= target.sequenceGroup) insertBoundaryStepIds.add(step.id);
    }
  }
  const boundaryIds = [...insertBoundaryStepIds];
  const [boundaryCompletions, boundaryExecutions, reviewedTimeImpact] = await Promise.all([
    boundaryIds.length
      ? tx.processCompletion.findMany({
          where: { routeId: input.route.id, stepId: { in: boundaryIds }, voidedAt: null },
          select: { stepId: true },
          distinct: ['stepId'],
        })
      : Promise.resolve([]),
    boundaryIds.length
      ? tx.processExecution.findMany({
          where: { stepId: { in: boundaryIds }, step: { routeId: input.route.id }, voidedAt: null },
          select: { stepId: true },
          distinct: ['stepId'],
        })
      : Promise.resolve([]),
    calculateReviewedTimeImpactSnapshot(tx, input.route.id, input.diffs),
  ]);
  const reportedBoundaryStepIds = new Set([
    ...input.route.steps
      .filter(step => insertBoundaryStepIds.has(step.id) && (
        step.processedQty > 0
        || step.goodOutputQty > 0
        || step.defectOutputQty > 0
        || step.releasedGoodQty > 0
      ))
      .map(step => step.id),
    ...boundaryCompletions.map(item => item.stepId),
    ...boundaryExecutions.map(item => item.stepId),
  ]);
  return {
    ...reviewedTimeImpact,
    downstreamReportedStepCount: Math.max(
      reportedBoundaryStepIds.size,
      input.diffs.some(diff => diff.kind === ProcessRouteChangeDiffKind.INSERT_STEP)
        && Number(input.route.workOrder.completedQty || 0) > 0
        ? 1
        : 0,
    ),
    affectedQty: input.route.workOrder.productionTargetQty || 0,
  };
}

async function refreshProcessRouteChangeDiffBaselines(
  tx: Prisma.TransactionClient,
  input: RouteChangeReevaluationInput,
) {
  const stepById = new Map(input.route.steps.map(step => [step.id, step]));
  for (const diff of input.diffs) {
    if (!diff.targetStepId || diff.kind === ProcessRouteChangeDiffKind.INSERT_STEP) continue;
    const step = stepById.get(diff.targetStepId);
    if (!step) continue;
    await tx.processRouteChangeDiff.update({
      where: { id: diff.id },
      data: {
        processDefinitionId: step.processDefinitionId || null,
        beforeData: json({
          id: step.id,
          processDefinitionId: step.processDefinitionId || null,
          processCode: step.processCode,
          processName: step.processName,
          stageGroup: step.stageGroup,
          position: step.position,
          sequenceGroup: step.sequenceGroup,
          status: step.status,
          standardMillisecondsPerUnit: step.standardMillisecondsPerUnit,
          timeBasis: step.timeBasis,
          setupMilliseconds: step.setupMilliseconds,
          unitsPerProduct: step.unitsPerProduct,
          unitLabel: step.unitLabel,
          countsForEfficiency: step.countsForEfficiency,
        }),
      },
    });
  }
}

async function bindInsertedDefinitionForReview(
  tx: Prisma.TransactionClient,
  input: {
    routeId: string;
    diff: { id: string };
    requestedDefinitionId: string | null;
  },
) {
  const storedDiff = await tx.processRouteChangeDiff.findUniqueOrThrow({
    where: { id: input.diff.id },
    select: {
      id: true,
      targetStepId: true,
      processDefinitionId: true,
      afterData: true,
    },
  });
  const after = record(storedDiff.afterData);
  const processName = clean(after.processName, 120);
  let definition: InsertedProcessDefinition | null = null;

  if (input.requestedDefinitionId) {
    definition = await tx.processDefinition.findFirst({
      where: { id: input.requestedDefinitionId, isActive: true },
      select: { id: true, code: true, name: true, stageGroup: true },
    });
    if (!definition) {
      throw new ProcessRouteChangeServiceError(
        '审核所选工序定义不存在或已停用',
        409,
        'PROCESS_ROUTE_CHANGE_PROCESS_DEFINITION_INVALID',
      );
    }
    assertInsertedDefinitionNameMatches(definition, processName);
  } else if (storedDiff.processDefinitionId) {
    const boundDefinition = await tx.processDefinition.findFirst({
      where: { id: storedDiff.processDefinitionId, isActive: true },
      select: { id: true, code: true, name: true, stageGroup: true },
    });
    if (!boundDefinition) {
      throw new ProcessRouteChangeServiceError(
        '新增工序定义不存在或已停用',
        409,
        'PROCESS_ROUTE_CHANGE_PROCESS_DEFINITION_INVALID',
      );
    }
    if (processName && !sameProcessName(boundDefinition.name, processName)) {
      const target = storedDiff.targetStepId
        ? await tx.workOrderProcessStep.findFirst({
            where: { id: storedDiff.targetStepId, routeId: input.routeId },
            select: { processDefinitionId: true },
          })
        : null;
      if (target?.processDefinitionId !== boundDefinition.id) {
        assertInsertedDefinitionNameMatches(boundDefinition, processName);
      }
      // Compatibility with proposals created before the INSERT binding fix:
      // those rows inherited the insertion anchor's definition id. Treat that
      // exact signature as unbound and resolve the employee-entered name below.
    } else {
      definition = boundDefinition;
    }
  }

  if (!definition) {
    if (!processName) {
      throw new ProcessRouteChangeServiceError(
        '新增工序缺少名称',
        409,
        'PROCESS_ROUTE_CHANGE_PROCESS_NAME_REQUIRED',
      );
    }
    definition = await findUniqueActiveDefinitionByName(tx, processName);
  }

  if (!definition) {
    if (storedDiff.processDefinitionId) {
      await tx.processRouteChangeDiff.update({
        where: { id: storedDiff.id },
        data: { processDefinitionId: null },
      });
    }
    return;
  }

  await tx.processRouteChangeDiff.update({
    where: { id: storedDiff.id },
    data: {
      processDefinitionId: definition.id,
      afterData: json({
        ...after,
        processCode: definition.code,
        processName: definition.name,
        stageGroup: definition.stageGroup,
      }),
    },
  });
}

export async function reviewProcessRouteChange(command: ReviewProcessRouteChangeCommand) {
  const identity = mutationIdentity(command);
  const decision = command.decision || command.action;
  if (decision !== 'approve' && decision !== 'reject') {
    throw new ProcessRouteChangeServiceError('审核结论不正确', 400, 'PROCESS_ROUTE_CHANGE_REVIEW_INVALID');
  }
  const approved = decision === 'approve';
  const note = clean(command.note ?? command.reviewReason, 2_000) || null;
  if (!approved) {
    const changeId = clean(command.changeId, 80);
    if (!changeId) {
      throw new ProcessRouteChangeServiceError('缺少工艺变更标识', 400, 'PROCESS_ROUTE_CHANGE_ID_REQUIRED');
    }
    const id = await serializable(async tx => {
      const replay = await replayChangeId(tx, identity.idempotencyKey, 'reject', changeId);
      if (replay) return replay;
      const current = await tx.processRouteChange.findUnique({
        where: { id: changeId },
        select: {
          id: true,
          changeRequestId: true,
          status: true,
          version: true,
          workOrderId: true,
          routeId: true,
          reviewDecision: true,
          updatedAt: true,
        },
      });
      if (!current) {
        throw new ProcessRouteChangeServiceError('工艺变更不存在', 404, 'PROCESS_ROUTE_CHANGE_NOT_FOUND');
      }
      if (current.status === ProcessRouteChangeStatus.REJECTED && current.reviewDecision === 'REJECTED') {
        return changeId;
      }
      if (
        current.status !== ProcessRouteChangeStatus.SUBMITTED
        && current.status !== ProcessRouteChangeStatus.APPROVED
      ) {
        throw new ProcessRouteChangeServiceError(
          '只有待审核或已通过但尚未启用的工艺变更可以驳回',
          409,
          'PROCESS_ROUTE_CHANGE_STATUS_CONFLICT',
          {
            currentStatus: current.status,
            currentVersion: current.version,
            expectedStatus: `${ProcessRouteChangeStatus.SUBMITTED}|${ProcessRouteChangeStatus.APPROVED}`,
            updatedAt: current.updatedAt.toISOString(),
          },
        );
      }
      if (current.version !== identity.expectedVersion) {
        throw new ProcessRouteChangeServiceError(
          '工艺变更已被其他人更新，请刷新后重试',
          409,
          'PROCESS_ROUTE_CHANGE_VERSION_CONFLICT',
          {
            currentStatus: current.status,
            currentVersion: current.version,
            updatedAt: current.updatedAt.toISOString(),
          },
        );
      }
      const updated = await tx.processRouteChange.updateMany({
        where: { id: changeId, version: current.version, status: current.status },
        data: {
          status: ProcessRouteChangeStatus.REJECTED,
          reviewDecision: 'REJECTED',
          reviewNote: note,
          reviewedAt: new Date(),
          reviewedById: identity.userId,
          activationError: null,
          activationStartedAt: null,
          updatedById: identity.userId,
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) {
        throw new ProcessRouteChangeServiceError(
          '工艺变更已被其他人更新，请刷新后重试',
          409,
          'PROCESS_ROUTE_CHANGE_VERSION_CONFLICT',
        );
      }
      await tx.changeRequest.update({
        where: { id: current.changeRequestId },
        data: { status: 'closed', closedAt: new Date(), version: { increment: 1 } },
      });
      await tx.processRouteChangeEvent.create({
        data: {
          changeId,
          action: 'reject',
          idempotencyKey: identity.idempotencyKey,
          fromStatus: current.status,
          toStatus: ProcessRouteChangeStatus.REJECTED,
          actorId: identity.userId,
          actorSnapshot: identity.actor,
          detail: json({ decision: 'reject', note, approvalRevoked: current.status === ProcessRouteChangeStatus.APPROVED }),
        },
      });
      await tx.processRouteChangeOutbox.create({
        data: {
          changeId,
          eventType: 'PROCESS_ROUTE_CHANGE_REJECTED',
          dedupeKey: `PROCESS_ROUTE_CHANGE_REJECTED:${identity.idempotencyKey}`.slice(0, 180),
          payload: json({
            changeId,
            workOrderId: current.workOrderId,
            fromStatus: current.status,
            toStatus: ProcessRouteChangeStatus.REJECTED,
            actor: identity.actor,
            detail: { decision: 'reject', note, approvalRevoked: current.status === ProcessRouteChangeStatus.APPROVED },
          }),
        },
      });
      return changeId;
    });
    return serializeChange(await loadChangeDetail(id));
  }
  return transitionProcessRouteChange({
    changeId: command.changeId,
    identity,
    action: 'approve',
    from: ProcessRouteChangeStatus.SUBMITTED,
    to: ProcessRouteChangeStatus.APPROVED,
    changeRequestStatus: 'implementing',
    data: {
      reviewDecision: 'APPROVED',
      reviewNote: note,
      reviewedAt: new Date(),
      reviewedById: identity.userId,
    },
    detail: json({ decision, note }),
    outboxEventType: 'PROCESS_ROUTE_CHANGE_APPROVED',
    alreadyApplied: current => current.reviewDecision === 'APPROVED' && ([
          ProcessRouteChangeStatus.APPROVED,
          ProcessRouteChangeStatus.ACTIVATING,
          ProcessRouteChangeStatus.ACTIVE,
          ProcessRouteChangeStatus.FAILED,
        ] as ProcessRouteChangeStatus[]).includes(current.status),
    beforeTransition: async (tx, current) => {
      const diffs = await tx.processRouteChangeDiff.findMany({
        where: { changeId: current.id },
        orderBy: { position: 'asc' },
      });
      const inserts = diffs.filter(diff => diff.kind === ProcessRouteChangeDiffKind.INSERT_STEP);
      const insert = inserts[0];
      const requestedDefinitionId = clean(command.newProcessDefinitionId, 80) || null;
      if (requestedDefinitionId && !insert) {
        throw new ProcessRouteChangeServiceError(
          '当前变更不包含新增工序，不能绑定新增工序定义',
          409,
          'PROCESS_ROUTE_CHANGE_REVIEW_INSERT_MISSING',
        );
      }
      if (requestedDefinitionId && inserts.length > 1) {
        throw new ProcessRouteChangeServiceError(
          '当前变更包含多个新增工序，必须逐项明确绑定工序定义',
          409,
          'PROCESS_ROUTE_CHANGE_PROCESS_DEFINITION_BINDING_INVALID',
        );
      }
      const affectedQty = command.affectedQty == null ? null : positiveInteger(command.affectedQty, '补充工序应报数量');
      const newStandard = command.newStandardMillisecondsPerUnit == null
        ? null
        : positiveMilliseconds(command.newStandardMillisecondsPerUnit);
      if ((affectedQty != null || newStandard != null) && !insert) {
        throw new ProcessRouteChangeServiceError(
          '当前变更不包含新增工序，不能调整新增工序数量或工时',
          409,
          'PROCESS_ROUTE_CHANGE_REVIEW_INSERT_MISSING',
        );
      }
      if (insert && (affectedQty != null || newStandard != null)) {
        const after = record(insert.afterData);
        await tx.processRouteChangeDiff.update({
          where: { id: insert.id },
          data: {
            afterData: json({
              ...after,
              ...(affectedQty != null ? { requiredQty: affectedQty } : {}),
              ...(newStandard != null ? { standardMillisecondsPerUnit: newStandard } : {}),
            }),
          },
        });
      }
      const submittedTimeChanges = Array.isArray(command.timeChanges) ? command.timeChanges : [];
      let nextDiffPosition = diffs.length;
      for (const raw of submittedTimeChanges) {
        const item = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
        const stepId = clean(item.stepId, 80);
        const milliseconds = positiveMilliseconds(item.standardMillisecondsPerUnit);
        if (!stepId) {
          throw new ProcessRouteChangeServiceError('审核工时变更缺少目标工序', 400, 'PROCESS_ROUTE_CHANGE_DIFF_INVALID');
        }
        const existing = diffs.find(diff => (
          diff.kind === ProcessRouteChangeDiffKind.UPDATE_TIME && diff.targetStepId === stepId
        ));
        if (existing) {
          await tx.processRouteChangeDiff.update({
            where: { id: existing.id },
            data: { afterData: json({ ...record(existing.afterData), standardMillisecondsPerUnit: milliseconds }) },
          });
          continue;
        }
        const step = await tx.workOrderProcessStep.findFirst({
          where: { id: stepId, routeId: current.routeId },
        });
        if (!step) {
          throw new ProcessRouteChangeServiceError('审核工时目标工序不存在', 409, 'PROCESS_ROUTE_CHANGE_TARGET_STEP_INVALID');
        }
        await tx.processRouteChangeDiff.create({
          data: {
            changeId: current.id,
            kind: ProcessRouteChangeDiffKind.UPDATE_TIME,
            source: ProcessRouteChangeStepSource.EXISTING,
            position: nextDiffPosition,
            targetStepId: step.id,
            processDefinitionId: step.processDefinitionId,
            beforeData: json({
              processName: step.processName,
              standardMillisecondsPerUnit: step.standardMillisecondsPerUnit,
              timeBasis: step.timeBasis,
              setupMilliseconds: step.setupMilliseconds,
              unitsPerProduct: step.unitsPerProduct,
              unitLabel: step.unitLabel,
              countsForEfficiency: step.countsForEfficiency,
            }),
            afterData: json({ standardMillisecondsPerUnit: milliseconds }),
          },
        });
        nextDiffPosition += 1;
      }
      for (const insertDiff of inserts) {
        await bindInsertedDefinitionForReview(tx, {
          routeId: current.routeId,
          diff: insertDiff,
          requestedDefinitionId: insertDiff.id === insert?.id ? requestedDefinitionId : null,
        });
      }
      const reviewedDiffs = await tx.processRouteChangeDiff.findMany({
        where: { changeId: current.id },
        orderBy: { position: 'asc' },
        select: { kind: true, targetStepId: true, afterData: true },
      });
      const reviewedTimeImpact = await calculateReviewedTimeImpactSnapshot(
        tx,
        current.routeId,
        reviewedDiffs,
      );
      await tx.processRouteChange.update({
        where: { id: current.id },
        data: {
          impactSnapshot: json({
            ...record(current.impactSnapshot),
            ...reviewedTimeImpact,
            ...(affectedQty != null ? { affectedQty } : {}),
          }),
        },
      });
    },
  });
}

export async function reevaluateProcessRouteChange(command: ReevaluateProcessRouteChangeCommand) {
  const identity = mutationIdentity(command);
  const changeId = clean(command.changeId, 80);
  if (!changeId) {
    throw new ProcessRouteChangeServiceError('缺少工艺变更标识', 400, 'PROCESS_ROUTE_CHANGE_ID_REQUIRED');
  }
  const id = await serializable(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`process-route-change:${changeId}`}))`;
    const replay = await replayChangeId(tx, identity.idempotencyKey, 'reevaluate', changeId);
    if (replay) return replay;
    const change = await tx.processRouteChange.findUnique({
      where: { id: changeId },
      include: {
        diffs: { orderBy: { position: 'asc' } },
        route: {
          include: {
            workOrder: {
              select: {
                productionTargetQty: true,
                completedQty: true,
                drawingLibraryItemId: true,
              },
            },
            steps: { where: { retiredAt: null }, orderBy: { position: 'asc' } },
          },
        },
      },
    });
    if (!change) {
      throw new ProcessRouteChangeServiceError('工艺变更不存在', 404, 'PROCESS_ROUTE_CHANGE_NOT_FOUND');
    }
    if (change.status === ProcessRouteChangeStatus.SUBMITTED && change.baseRouteVersion === change.route.version) {
      return change.id;
    }
    if (change.status !== ProcessRouteChangeStatus.APPROVED) {
      throw new ProcessRouteChangeServiceError(
        '只有已通过但尚未启用的工艺变更可以重新评估',
        409,
        'PROCESS_ROUTE_CHANGE_STATUS_CONFLICT',
        {
          currentStatus: change.status,
          currentVersion: change.version,
          expectedStatus: ProcessRouteChangeStatus.APPROVED,
          updatedAt: change.updatedAt.toISOString(),
        },
      );
    }
    if (change.version !== identity.expectedVersion) {
      throw new ProcessRouteChangeServiceError(
        '工艺变更已被其他人更新，请刷新后重试',
        409,
        'PROCESS_ROUTE_CHANGE_VERSION_CONFLICT',
        {
          currentStatus: change.status,
          currentVersion: change.version,
          updatedAt: change.updatedAt.toISOString(),
        },
      );
    }
    if (change.route.version === change.baseRouteVersion) {
      throw new ProcessRouteChangeServiceError(
        '当前工艺路线没有变化，无需重新评估',
        409,
        'PROCESS_ROUTE_REEVALUATION_NOT_REQUIRED',
      );
    }
    const stepById = new Map(change.route.steps.map(step => [step.id, step]));
    for (const diff of change.diffs) {
      if (diff.targetStepId && !stepById.has(diff.targetStepId)) {
        throw new ProcessRouteChangeServiceError(
          '原申请引用的工序已不存在，无法自动重新评估；请驳回后重新提交',
          409,
          'PROCESS_ROUTE_CHANGE_REEVALUATION_TARGET_MISSING',
        );
      }
      if (diff.kind === ProcessRouteChangeDiffKind.MOVE_STEP) {
        const beforeStepId = clean(record(diff.afterData).beforeStepId, 80);
        if (beforeStepId && !stepById.has(beforeStepId)) {
          throw new ProcessRouteChangeServiceError(
            '原申请的移动位置已不存在，无法自动重新评估；请驳回后重新提交',
            409,
            'PROCESS_ROUTE_CHANGE_REEVALUATION_TARGET_MISSING',
          );
        }
        if (diff.targetStepId) {
          await assessCurrentRouteGroupMove(tx, change.route.id, diff.targetStepId, beforeStepId || null);
        }
      }
    }
    const impactSnapshot = await calculateRouteChangeImpactSnapshot(tx, {
      route: change.route,
      diffs: change.diffs,
    });
    await refreshProcessRouteChangeDiffBaselines(tx, {
      route: change.route,
      diffs: change.diffs,
    });
    const now = new Date();
    const latestPublishedProfile = change.scope === ProcessRouteChangeScope.CURRENT_WORK_ORDER_ONLY
      || !change.route.workOrder.drawingLibraryItemId
      ? null
      : await tx.productTimeProfile.findFirst({
          where: {
            drawingLibraryItemId: change.route.workOrder.drawingLibraryItemId,
            status: 'published',
          },
          orderBy: { version: 'desc' },
          select: { id: true, version: true },
        });
    const updated = await tx.processRouteChange.updateMany({
      where: { id: change.id, status: ProcessRouteChangeStatus.APPROVED, version: change.version },
      data: {
        status: ProcessRouteChangeStatus.SUBMITTED,
        baseRouteVersion: change.route.version,
        sourceProductTimeProfileId: latestPublishedProfile?.id ?? change.sourceProductTimeProfileId,
        baseProductProfileVersion: latestPublishedProfile?.version ?? change.baseProductProfileVersion,
        routeSnapshot: json(routeSnapshot(change.route)),
        impactSnapshot: json({
          ...record(change.impactSnapshot),
          ...impactSnapshot,
          warnings: ['路线已按最新版本重新评估，请工艺重新审核后再启用。'],
        }),
        reviewDecision: null,
        reviewNote: null,
        reviewedAt: null,
        reviewedById: null,
        activationError: null,
        activationStartedAt: null,
        submittedAt: now,
        updatedById: identity.userId,
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) {
      throw new ProcessRouteChangeServiceError(
        '工艺变更已被其他人更新，请刷新后重试',
        409,
        'PROCESS_ROUTE_CHANGE_VERSION_CONFLICT',
      );
    }
    await tx.changeRequest.update({
      where: { id: change.changeRequestId },
      data: { status: 'assessing', closedAt: null, effectiveAt: null, version: { increment: 1 } },
    });
    await tx.processRouteChangeEvent.create({
      data: {
        changeId: change.id,
        action: 'reevaluate',
        idempotencyKey: identity.idempotencyKey,
        fromStatus: ProcessRouteChangeStatus.APPROVED,
        toStatus: ProcessRouteChangeStatus.SUBMITTED,
        actorId: identity.userId,
        actorSnapshot: identity.actor,
        detail: json({ fromRouteVersion: change.baseRouteVersion, toRouteVersion: change.route.version }),
      },
    });
    await tx.processRouteChangeOutbox.create({
      data: {
        changeId: change.id,
        eventType: 'PROCESS_ROUTE_CHANGE_REEVALUATED',
        dedupeKey: `PROCESS_ROUTE_CHANGE_REEVALUATED:${identity.idempotencyKey}`.slice(0, 180),
        payload: json({
          changeId: change.id,
          workOrderId: change.workOrderId,
          routeId: change.routeId,
          fromRouteVersion: change.baseRouteVersion,
          toRouteVersion: change.route.version,
          actor: identity.actor,
        }),
      },
    });
    return change.id;
  });
  return serializeChange(await loadChangeDetail(id));
}

export async function listProcessRouteChanges(query: ListProcessRouteChangesQuery = {}) {
  const take = Math.min(100, Math.max(1, Number(query.take) || 30));
  const skip = Math.max(0, Number(query.skip) || 0);
  const changes = await prisma.processRouteChange.findMany({
    where: {
      ...(clean(query.workOrderId, 80) ? { workOrderId: clean(query.workOrderId, 80) } : {}),
      ...(clean(query.routeId, 80) ? { routeId: clean(query.routeId, 80) } : {}),
      ...(query.status ? { status: query.status as ProcessRouteChangeStatus } : {}),
    },
    include: changeDetailInclude,
    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    take,
    skip,
  });
  return changes.map(serializeChange);
}

export async function getProcessRouteChange(query: GetProcessRouteChangeQuery | string) {
  const changeId = typeof query === 'string' ? query : query.changeId;
  return serializeChange(await loadChangeDetail(changeId));
}

type ActivationChange = Prisma.ProcessRouteChangeGetPayload<{
  include: {
    changeRequest: true;
    diffs: { orderBy: { position: 'asc' } };
    route: {
      include: {
        workOrder: true;
        steps: { where: { retiredAt: null }, orderBy: { position: 'asc' } };
      };
    };
  };
}>;

async function resolveInsertedDefinition(
  tx: Prisma.TransactionClient,
  change: ActivationChange,
  diff: ActivationChange['diffs'][number],
) {
  const after = record(diff.afterData);
  if (diff.processDefinitionId) {
    const definition = await tx.processDefinition.findFirst({
      where: { id: diff.processDefinitionId, isActive: true },
    });
    if (!definition) {
      throw new ProcessRouteChangeServiceError(
        '新增工序定义不存在或已停用',
        409,
        'PROCESS_ROUTE_CHANGE_PROCESS_DEFINITION_INVALID',
      );
    }
    const processName = clean(after.processName, 120);
    if (!processName || sameProcessName(definition.name, processName)) return definition;
    const target = diff.targetStepId
      ? change.route.steps.find(step => step.id === diff.targetStepId)
      : null;
    if (target?.processDefinitionId !== definition.id) {
      assertInsertedDefinitionNameMatches(definition, processName);
    }
    // Legacy compatibility: old INSERT rows inherited the insertion anchor's
    // definition id. If the employee-entered name differs, ignore that polluted
    // binding and uniquely resolve the requested process below.
  }
  const processName = clean(after.processName, 120);
  if (!processName) {
    throw new ProcessRouteChangeServiceError('新增工序缺少名称', 409, 'PROCESS_ROUTE_CHANGE_PROCESS_NAME_REQUIRED');
  }
  const maxSort = await tx.processDefinition.aggregate({ _max: { sortOrder: true } });
  const baseCode = `RC-${change.id.replaceAll('-', '').slice(0, 10)}-${diff.position + 1}`.toUpperCase();
  let processCode = clean(after.processCode, 80) || baseCode;
  const codeExists = await tx.processDefinition.findUnique({ where: { code: processCode }, select: { id: true } });
  if (codeExists) processCode = `${baseCode}-${Date.now().toString(36).slice(-4)}`;
  const target = diff.targetStepId
    ? change.route.steps.find(step => step.id === diff.targetStepId)
    : null;
  let definition: Awaited<ReturnType<typeof resolveOrCreateProcessDefinition>>['definition'];
  try {
    ({ definition } = await resolveOrCreateProcessDefinition(tx, {
      code: processCode,
      name: processName,
      stageGroup: clean(after.stageGroup, 80) || target?.stageGroup || 'frontend',
      sortOrder: (maxSort._max.sortOrder || 0) + 1,
    }));
  } catch (error) {
    if (error instanceof ProcessDefinitionResolutionError) {
      throw new ProcessRouteChangeServiceError(
        error.message,
        error.status,
        'PROCESS_ROUTE_CHANGE_PROCESS_DEFINITION_AMBIGUOUS',
      );
    }
    throw error;
  }
  await tx.processRouteChangeDiff.update({
    where: { id: diff.id },
    data: {
      processDefinitionId: definition.id,
      afterData: json({
        ...after,
        processCode: definition.code,
        processName: definition.name,
        stageGroup: definition.stageGroup,
      }),
    },
  });
  return definition;
}

async function insertionRequiresSupplementObligation(
  tx: Prisma.TransactionClient,
  change: ActivationChange,
  diff: ActivationChange['diffs'][number],
) {
  const steps = await tx.workOrderProcessStep.findMany({
    where: { routeId: change.routeId },
    orderBy: { position: 'asc' },
  });
  const target = diff.targetStepId ? steps.find(step => step.id === diff.targetStepId) : null;
  if (diff.targetStepId && !target) {
    throw new ProcessRouteChangeServiceError(
      '插入位置对应的工序已不存在',
      409,
      'PROCESS_ROUTE_CHANGE_INSERT_TARGET_MISSING',
    );
  }
  // Appending after the current final group uses that final group as the
  // boundary.  Once it has production facts, retroactively wiring a normal
  // successor would require reversing finished-goods effects, so it remains a
  // supplemental obligation.
  const boundarySequenceGroup = target?.sequenceGroup
    ?? (steps.length ? Math.max(...steps.map(step => step.sequenceGroup)) : null);
  const boundarySteps = boundarySequenceGroup == null
    ? []
    : steps.filter(step => step.sequenceGroup >= boundarySequenceGroup);
  const boundaryStepIds = boundarySteps.map(step => step.id);
  const [completionStepIds, executionStepIds] = boundaryStepIds.length
    ? await Promise.all([
        tx.processCompletion.findMany({
          where: { stepId: { in: boundaryStepIds }, voidedAt: null },
          select: { stepId: true },
          distinct: ['stepId'],
        }),
        tx.processExecution.findMany({
          where: { stepId: { in: boundaryStepIds }, voidedAt: null },
          select: { stepId: true },
          distinct: ['stepId'],
        }),
      ])
    : [[], []];
  const hasStepFacts = boundarySteps.some(step => (
    step.processedQty > 0
    || step.goodOutputQty > 0
    || step.defectOutputQty > 0
    || step.releasedGoodQty > 0
  ));
  return hasStepFacts
    || completionStepIds.length > 0
    || executionStepIds.length > 0
    || Number(change.route.workOrder.completedQty) > 0
    || change.route.status === 'completed';
}

function validateWholeWorkOrderInsertQuantity(change: ActivationChange, after: Record<string, unknown>) {
  const fallbackQty = positiveInteger(change.route.workOrder.productionTargetQty, '工单生产数量');
  const requiredQty = after.requiredQty == null
    ? fallbackQty
    : positiveInteger(after.requiredQty, '新增工序应报数量');
  if (requiredQty !== fallbackQty) {
    throw new ProcessRouteChangeServiceError(
      '当前版本的新增工序必须覆盖整张工单，不能在没有批次或单件追踪时只选择部分数量',
      409,
      'PROCESS_SUPPLEMENT_WHOLE_WORK_ORDER_REQUIRED',
    );
  }
  return requiredQty;
}

async function insertNormalRouteStep(
  tx: Prisma.TransactionClient,
  change: ActivationChange,
  diff: ActivationChange['diffs'][number],
) {
  const after = record(diff.afterData);
  validateWholeWorkOrderInsertQuantity(change, after);
  const definition = await resolveInsertedDefinition(tx, change, diff);
  const steps = await tx.workOrderProcessStep.findMany({
    where: { routeId: change.routeId },
    orderBy: { position: 'asc' },
  });
  const target = diff.targetStepId ? steps.find(step => step.id === diff.targetStepId) : null;
  if (diff.targetStepId && !target) {
    throw new ProcessRouteChangeServiceError(
      '插入位置对应的工序已不存在',
      409,
      'PROCESS_ROUTE_CHANGE_INSERT_TARGET_MISSING',
    );
  }
  const targetGroup = target
    ? steps.filter(step => step.sequenceGroup === target.sequenceGroup)
    : [];
  if (targetGroup.some(step => (
    step.processedQty > 0
    || step.goodOutputQty > 0
    || step.defectOutputQty > 0
    || step.releasedGoodQty > 0
  ))) {
    throw new ProcessRouteChangeServiceError(
      '插入边界已产生报工或释放事实，必须按补充工序启用',
      409,
      'PROCESS_ROUTE_CHANGE_INSERT_FACT_CONFLICT',
    );
  }
  const targetInputs = [...new Set(targetGroup.map(step => step.inputQty))];
  if (targetInputs.length > 1) {
    throw new ProcessRouteChangeServiceError(
      '目标并行工序组的投入数量不一致，无法安全插入正常工序',
      409,
      'PROCESS_ROUTE_CHANGE_INSERT_INPUT_CONFLICT',
    );
  }
  const transferredInputQty = targetInputs[0] || 0;
  const position = target
    ? Math.min(...targetGroup.map(step => step.position))
    : (steps.length ? Math.max(...steps.map(step => step.position)) + 1 : 0);
  const sequenceGroup = target?.sequenceGroup
    ?? (steps.length ? Math.max(...steps.map(step => step.sequenceGroup)) + 1 : 1);
  const offset = 100_000 + diff.position * 1_000;
  await tx.workOrderProcessStep.updateMany({
    where: { routeId: change.routeId, position: { gte: position } },
    data: { position: { increment: offset } },
  });
  await tx.workOrderProcessStep.updateMany({
    where: { routeId: change.routeId, sequenceGroup: { gte: sequenceGroup } },
    data: { sequenceGroup: { increment: offset } },
  });
  const now = new Date();
  const timeBasisValue = timeBasis(after.timeBasis);
  const standardMillisecondsPerUnit = positiveMilliseconds(after.standardMillisecondsPerUnit);
  const setupMilliseconds = nonnegativeInteger(after.setupMilliseconds ?? 0, '准备工时');
  const unitsPerProduct = positiveInteger(after.unitsPerProduct ?? 1, '单套工序次数');
  const reportQuantityBasis = after.reportQuantityBasis === 'action'
    && timeBasisValue === 'per_unit'
    && unitsPerProduct > 1
    ? 'action'
    : 'product';
  const reportUnitLabel = reportQuantityBasis === 'action'
    ? clean(after.reportUnitLabel, 20) || '个'
    : clean(after.unitLabel, 20) || '件';
  const insertedStep = await tx.workOrderProcessStep.create({
    data: {
      routeId: change.routeId,
      processDefinitionId: definition.id,
      processCode: definition.code,
      processName: definition.name,
      stageGroup: clean(after.stageGroup, 80) || target?.stageGroup || definition.stageGroup,
      position,
      sequenceGroup,
      standardSource: 'route_change',
      timeBasis: timeBasisValue,
      unitLabel: clean(after.unitLabel, 20) || '件',
      standardMillisecondsPerUnit,
      setupMilliseconds,
      unitsPerProduct,
      reportQuantityBasis,
      reportUnitLabel,
      countsForEfficiency: after.countsForEfficiency !== false,
      executionMode: ProcessStepExecutionMode.NORMAL,
      changeSource: ProcessRouteChangeStepSource.NEW,
      inputQty: transferredInputQty,
      processedQty: 0,
      goodOutputQty: 0,
      defectOutputQty: 0,
      releasedGoodQty: 0,
      status: transferredInputQty > 0 ? 'current' : 'pending',
      startedAt: transferredInputQty > 0 ? now : null,
      remark: `工艺变更 ${change.id} 正常插入；按原路线继续数量流转`,
    },
  });
  await tx.workOrderProcessStep.updateMany({
    where: { routeId: change.routeId, position: { gte: position + offset } },
    data: { position: { decrement: offset - 1 } },
  });
  await tx.workOrderProcessStep.updateMany({
    where: { routeId: change.routeId, sequenceGroup: { gte: sequenceGroup + offset } },
    data: { sequenceGroup: { decrement: offset - 1 } },
  });

  if (targetGroup.length && transferredInputQty > 0) {
    const targetIds = targetGroup.map(step => step.id);
    const hasPriorGroup = steps.some(step => step.sequenceGroup < (target?.sequenceGroup || sequenceGroup));
    if (hasPriorGroup) {
      const incomingMovements = await tx.processQuantityMovement.findMany({
        where: {
          workOrderId: change.workOrderId,
          targetStepId: { in: targetIds },
          type: ProcessMovementType.GOOD_TRANSFER,
          voidedAt: null,
        },
        include: {
          reversals: {
            where: { voidedAt: null },
            select: { quantity: true },
          },
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
      const effectiveMovements = incomingMovements
        .map(movement => ({
          movement,
          quantity: movement.quantity - movement.reversals.reduce((sum, reversal) => sum + reversal.quantity, 0),
        }))
        .filter(item => item.quantity > 0);
      for (const targetStep of targetGroup) {
        const ledgerInput = effectiveMovements
          .filter(item => item.movement.targetStepId === targetStep.id)
          .reduce((sum, item) => sum + item.quantity, 0);
        if (ledgerInput !== targetStep.inputQty) {
          throw new ProcessRouteChangeServiceError(
            `${targetStep.processName} 的有效入站移动与投入数量不一致，无法安全改接`,
            409,
            'PROCESS_ROUTE_CHANGE_INSERT_LEDGER_CONFLICT',
          );
        }
      }
      const events = new Map<string, typeof effectiveMovements>();
      for (const item of effectiveMovements) {
        const movement = item.movement;
        const key = [
          movement.completionId,
          movement.sourceStepId,
          movement.branchWorkOrderId || '',
          movement.sourceSequenceGroup,
        ].join(':');
        const group = events.get(key) || [];
        group.push(item);
        events.set(key, group);
      }
      for (const [eventIndex, eventMovements] of [...events.values()].entries()) {
        const quantitiesByTarget = targetIds.map(targetStepId => eventMovements
          .filter(item => item.movement.targetStepId === targetStepId)
          .reduce((sum, item) => sum + item.quantity, 0));
        if (!quantitiesByTarget[0] || quantitiesByTarget.some(quantity => quantity !== quantitiesByTarget[0])) {
          throw new ProcessRouteChangeServiceError(
            '目标并行工序组的入站事件不对称，无法安全改接新增工序',
            409,
            'PROCESS_ROUTE_CHANGE_INSERT_LEDGER_CONFLICT',
          );
        }
        for (const item of eventMovements) {
          await tx.processQuantityMovement.create({
            data: {
              completionId: item.movement.completionId,
              workOrderId: item.movement.workOrderId,
              sourceStepId: item.movement.sourceStepId,
              targetStepId: item.movement.targetStepId,
              branchWorkOrderId: item.movement.branchWorkOrderId,
              type: ProcessMovementType.REVERSAL,
              quantity: item.quantity,
              sourceSequenceGroup: item.movement.sourceSequenceGroup,
              targetSequenceGroup: item.movement.targetSequenceGroup,
              reversalOfId: item.movement.id,
              idempotencyKey: `route-change:${change.id}:${diff.id}:rewire-reversal:${item.movement.id}`.slice(0, 190),
            },
          });
        }
        const source = eventMovements[0].movement;
        await tx.processQuantityMovement.create({
          data: {
            completionId: source.completionId,
            workOrderId: source.workOrderId,
            sourceStepId: source.sourceStepId,
            targetStepId: insertedStep.id,
            branchWorkOrderId: source.branchWorkOrderId,
            type: ProcessMovementType.GOOD_TRANSFER,
            quantity: quantitiesByTarget[0],
            sourceSequenceGroup: source.sourceSequenceGroup,
            targetSequenceGroup: insertedStep.sequenceGroup,
            idempotencyKey: `route-change:${change.id}:${diff.id}:rewire-good:${eventIndex}`.slice(0, 190),
          },
        });
      }
    }
  }
  for (const targetStep of targetGroup) {
      const updated = await tx.workOrderProcessStep.updateMany({
        where: {
          id: targetStep.id,
          quantityVersion: targetStep.quantityVersion,
          inputQty: targetStep.inputQty,
          processedQty: 0,
          goodOutputQty: 0,
          defectOutputQty: 0,
          releasedGoodQty: 0,
        },
        data: {
          inputQty: 0,
          status: 'pending',
          startedAt: null,
          completedAt: null,
          completedById: null,
          quantityVersion: { increment: 1 },
        },
      });
      if (updated.count !== 1) {
        throw new ProcessRouteChangeServiceError(
          '目标工序数量已变化，请刷新后重新启用',
          409,
          'PROCESS_STEP_QUANTITY_CONFLICT',
        );
      }
  }
  return { displayStep: insertedStep, processDefinitionId: definition.id };
}

async function insertSupplementObligation(
  tx: Prisma.TransactionClient,
  change: ActivationChange,
  diff: ActivationChange['diffs'][number],
) {
  const after = record(diff.afterData);
  const definition = await resolveInsertedDefinition(tx, change, diff);
  const steps = await tx.workOrderProcessStep.findMany({
    where: { routeId: change.routeId },
    orderBy: { position: 'asc' },
  });
  const target = diff.targetStepId ? steps.find(step => step.id === diff.targetStepId) : null;
  if (diff.targetStepId && !target) {
    throw new ProcessRouteChangeServiceError(
      '插入位置对应的工序已不存在',
      409,
      'PROCESS_ROUTE_CHANGE_INSERT_TARGET_MISSING',
    );
  }
  // A process group is the smallest routing boundary.  Inserting before one
  // member of a parallel group must insert before the whole group; splitting a
  // group would make display order and quantity-flow order disagree.
  const position = target
    ? Math.min(...steps.filter(step => step.sequenceGroup === target.sequenceGroup).map(step => step.position))
    : (steps.length ? Math.max(...steps.map(step => step.position)) + 1 : 0);
  const sequenceGroup = target?.sequenceGroup
    ?? (steps.length ? Math.max(...steps.map(step => step.sequenceGroup)) + 1 : 1);
  const offset = 100_000 + diff.position * 1_000;
  await tx.workOrderProcessStep.updateMany({
    where: { routeId: change.routeId, position: { gte: position } },
    data: { position: { increment: offset } },
  });
  await tx.workOrderProcessStep.updateMany({
    where: { routeId: change.routeId, sequenceGroup: { gte: sequenceGroup } },
    data: { sequenceGroup: { increment: offset } },
  });
  const timeBasisValue = timeBasis(after.timeBasis);
  const standardMillisecondsPerUnit = positiveMilliseconds(after.standardMillisecondsPerUnit);
  const setupMilliseconds = nonnegativeInteger(after.setupMilliseconds ?? 0, '准备工时');
  const unitsPerProduct = positiveInteger(after.unitsPerProduct ?? 1, '单套工序次数');
  const reportQuantityBasis = after.reportQuantityBasis === 'action'
    && timeBasisValue === 'per_unit'
    && unitsPerProduct > 1
    ? 'action'
    : 'product';
  const reportUnitLabel = reportQuantityBasis === 'action'
    ? clean(after.reportUnitLabel, 20) || '个'
    : clean(after.unitLabel, 20) || '件';
  const displayStep = await tx.workOrderProcessStep.create({
    data: {
      routeId: change.routeId,
      processDefinitionId: definition.id,
      processCode: definition.code,
      processName: definition.name,
      stageGroup: definition.stageGroup,
      position,
      sequenceGroup,
      standardSource: 'route_change',
      timeBasis: timeBasisValue,
      unitLabel: clean(after.unitLabel, 20) || '件',
      standardMillisecondsPerUnit,
      setupMilliseconds,
      unitsPerProduct,
      reportQuantityBasis,
      reportUnitLabel,
      countsForEfficiency: after.countsForEfficiency !== false,
      executionMode: ProcessStepExecutionMode.SUPPLEMENTAL_OBLIGATION,
      changeSource: ProcessRouteChangeStepSource.NEW,
      inputQty: 0,
      processedQty: 0,
      goodOutputQty: 0,
      defectOutputQty: 0,
      releasedGoodQty: 0,
      status: 'current',
      startedAt: new Date(),
      remark: `工艺变更 ${change.id} 补充义务；不参与数量转移`,
    },
  });
  await tx.workOrderProcessStep.updateMany({
    where: { routeId: change.routeId, position: { gte: position + offset } },
    data: { position: { decrement: offset - 1 } },
  });
  await tx.workOrderProcessStep.updateMany({
    where: { routeId: change.routeId, sequenceGroup: { gte: sequenceGroup + offset } },
    data: { sequenceGroup: { decrement: offset - 1 } },
  });
  const fallbackQty = change.route.workOrder.productionTargetQty;
  const requiredQty = after.requiredQty == null
    ? positiveInteger(fallbackQty, '工单生产数量')
    : positiveInteger(after.requiredQty, '补充工序应报数量');
  if (requiredQty !== fallbackQty) {
    throw new ProcessRouteChangeServiceError(
      '当前版本的补充工序必须覆盖整张工单，不能在没有批次或单件追踪时只选择部分数量',
      409,
      'PROCESS_SUPPLEMENT_WHOLE_WORK_ORDER_REQUIRED',
    );
  }
  const obligation = await tx.processSupplementObligation.create({
    data: {
      changeId: change.id,
      diffId: diff.id,
      workOrderId: change.workOrderId,
      routeId: change.routeId,
      displayStepId: displayStep.id,
      insertBeforeStepId: target?.id || null,
      processDefinitionId: definition.id,
      source: ProcessRouteChangeStepSource.NEW,
      processCode: definition.code,
      processName: definition.name,
      stageGroup: definition.stageGroup,
      displayPosition: position,
      intendedSequenceGroup: sequenceGroup,
      requiredQty,
      reportedQty: 0,
      reportedUnitQty: 0,
      reportedGoodUnitQty: 0,
      reportedDefectUnitQty: 0,
      reportQuantityBasis,
      reportUnitLabel,
      status: ProcessSupplementObligationStatus.ACTIVE,
      releasePolicy: PROCESS_SUPPLEMENT_RELEASE_POLICY,
      timeBasis: timeBasisValue,
      unitLabel: clean(after.unitLabel, 20) || '件',
      standardMillisecondsPerUnit,
      setupMilliseconds,
      unitsPerProduct,
      countsForEfficiency: after.countsForEfficiency !== false,
    },
  });
  return { obligation, displayStep };
}

function emptyLaborCorrectionSummary(): LaborCorrectionSummary {
  return {
    affectedCompletionCount: 0,
    affectedExecutionCount: 0,
    affectedPoolCount: 0,
    replacedActiveClaimCount: 0,
    reversalClaimCount: 0,
    affectedEmployeeCount: 0,
    affectedStepCount: 0,
  };
}

function mergeLaborCorrectionSummary(
  target: LaborCorrectionSummary,
  source: LaborCorrectionSummary,
) {
  target.affectedCompletionCount += source.affectedCompletionCount;
  target.affectedExecutionCount += source.affectedExecutionCount;
  target.affectedPoolCount += source.affectedPoolCount;
  target.replacedActiveClaimCount += source.replacedActiveClaimCount;
  target.reversalClaimCount += source.reversalClaimCount;
  target.affectedEmployeeCount += source.affectedEmployeeCount;
  target.affectedStepCount += source.affectedStepCount;
}

async function correctStepHistoricalLabor(
  tx: Prisma.TransactionClient,
  input: {
    changeId: string;
    stepId: string;
    after: Record<string, unknown>;
    userId: string;
  },
): Promise<LaborCorrectionSummary> {
  const step = await tx.workOrderProcessStep.findUnique({ where: { id: input.stepId } });
  if (!step) {
    throw new ProcessRouteChangeServiceError('工时变更目标工序不存在', 409, 'PROCESS_ROUTE_CHANGE_TARGET_STEP_INVALID');
  }
  const standardMillisecondsPerUnit = positiveMilliseconds(input.after.standardMillisecondsPerUnit);
  const nextTimeBasis = timeBasis(input.after.timeBasis ?? step.timeBasis);
  const nextUnitLabel = clean(input.after.unitLabel, 20) || step.unitLabel || '件';
  const nextSetup = input.after.setupMilliseconds == null
    ? step.setupMilliseconds
    : nonnegativeInteger(input.after.setupMilliseconds, '准备工时');
  const nextUnitsPerProduct = input.after.unitsPerProduct == null
    ? step.unitsPerProduct
    : positiveInteger(input.after.unitsPerProduct, '单套工序次数');
  const nextCountsForEfficiency = input.after.countsForEfficiency == null
    ? step.countsForEfficiency
    : input.after.countsForEfficiency !== false;
  const completions = await tx.processCompletion.findMany({
    where: { stepId: input.stepId, voidedAt: null },
    include: {
      laborPool: {
        include: {
          claims: {
            where: { status: ProcessLaborClaimStatus.ACTIVE, standardLaborMilliseconds: { gt: 0 } },
            orderBy: [{ claimedAt: 'asc' }, { id: 'asc' }],
          },
        },
      },
    },
  });
  const executions = await tx.processExecution.findMany({
    where: { stepId: input.stepId, voidedAt: null },
  });
  const affectedEmployees = new Set(executions.map(item => item.employeeId));
  const now = new Date();
  const eligiblePools = completions
    .filter(completion => completion.laborPool && completion.laborPool.status !== ProcessLaborPoolStatus.VOIDED)
    .sort((left, right) => left.completedAt.getTime() - right.completedAt.getTime() || left.id.localeCompare(right.id));
  const setupPoolId = nextTimeBasis === 'per_batch'
    ? eligiblePools.at(-1)?.laborPool?.id || null
    : eligiblePools[0]?.laborPool?.id || null;
  let affectedPoolCount = 0;
  let replacedActiveClaimCount = 0;
  for (const completion of completions) {
    await tx.processCompletion.update({
      where: { id: completion.id },
      data: {
        standardMillisecondsPerUnit,
        timeBasis: nextTimeBasis,
        unitLabel: nextUnitLabel,
        setupMilliseconds: nextSetup,
        unitsPerProduct: nextUnitsPerProduct,
        standardSource: 'route_change_recalculation',
      },
    });
    const pool = completion.laborPool;
    if (!pool || pool.status === ProcessLaborPoolStatus.VOIDED) continue;
    // Setup time is a once-per-step (or once-per-batch) allowance.  A time
    // correction must not multiply it across every partial historical report.
    const effectiveSetup = pool.id === setupPoolId ? nextSetup : 0;
    const snapshot = calculateCompletionLaborSnapshot({
      timeBasis: nextTimeBasis,
      eligibleQty: pool.eligibleQty,
      standardMillisecondsPerUnit,
      setupMilliseconds: effectiveSetup,
      unitsPerProduct: nextUnitsPerProduct,
    });
    let claimedQty = 0;
    let claimedLabor = 0n;
    const replacements: Array<{ claim: (typeof pool.claims)[number]; labor: bigint }> = [];
    const replacementLaborByClaim = redistributeStandardLaborByExistingShares({
      totalStandardLaborMilliseconds: snapshot.totalStandardLaborMilliseconds,
      existingStandardLaborMilliseconds: pool.claims.map(claim => claim.standardLaborMilliseconds),
    });
    for (const [claimIndex, claim] of pool.claims.entries()) {
      const labor = replacementLaborByClaim[claimIndex];
      claimedQty += claim.quantity;
      claimedLabor += labor;
      replacements.push({ claim, labor });
      affectedEmployees.add(claim.employeeId);
    }
    for (const replacement of replacements) {
      const keyBase = `route-change:${input.changeId}:${replacement.claim.id}`;
      await tx.processLaborClaim.update({
        where: { id: replacement.claim.id },
        data: {
          status: ProcessLaborClaimStatus.VOIDED,
          voidedAt: now,
          voidedById: input.userId,
          voidReason: '工艺变更追溯调整标准工时',
        },
      });
      await tx.processLaborClaim.create({
        data: {
          poolId: pool.id,
          employeeId: replacement.claim.employeeId,
          quantity: -replacement.claim.quantity,
          standardLaborMilliseconds: -replacement.claim.standardLaborMilliseconds,
          workDate: replacement.claim.workDate,
          status: ProcessLaborClaimStatus.REVERSAL,
          source: 'route_change_recalculation',
          idempotencyKey: `${keyBase}:reverse`.slice(0, 120),
          claimedById: input.userId,
          claimedAt: now,
          reversalOfId: replacement.claim.id,
        },
      });
      await tx.processLaborClaim.create({
        data: {
          poolId: pool.id,
          employeeId: replacement.claim.employeeId,
          quantity: replacement.claim.quantity,
          standardLaborMilliseconds: replacement.labor,
          workDate: replacement.claim.workDate,
          status: ProcessLaborClaimStatus.ACTIVE,
          source: 'route_change_recalculation',
          idempotencyKey: `${keyBase}:replacement`.slice(0, 120),
          claimedById: input.userId,
          claimedAt: now,
        },
      });
    }
    const status = claimedQty <= 0
      ? ProcessLaborPoolStatus.OPEN
      : claimedQty >= pool.eligibleQty
        ? ProcessLaborPoolStatus.EXHAUSTED
        : ProcessLaborPoolStatus.PARTIAL;
    await tx.processLaborPool.update({
      where: { id: pool.id },
      data: {
        claimedQty,
        remainingQty: pool.eligibleQty - claimedQty,
        status,
        standardMillisecondsPerUnit,
        setupMilliseconds: effectiveSetup,
        unitsPerProduct: nextUnitsPerProduct,
        totalStandardLaborMilliseconds: snapshot.totalStandardLaborMilliseconds,
        claimedStandardLaborMilliseconds: claimedLabor,
        remainingStandardLaborMilliseconds: snapshot.totalStandardLaborMilliseconds - claimedLabor,
        standardSource: 'route_change_recalculation',
        version: { increment: 1 },
      },
    });
    affectedPoolCount += 1;
    replacedActiveClaimCount += replacements.length;
  }
  for (const execution of executions) {
    const variable = nextTimeBasis === 'per_batch'
      ? standardMillisecondsPerUnit
      : standardMillisecondsPerUnit * execution.goodQty * nextUnitsPerProduct;
    const standardLaborMilliseconds = nextSetup + variable;
    if (!Number.isSafeInteger(standardLaborMilliseconds) || standardLaborMilliseconds <= 0) {
      throw new ProcessRouteChangeServiceError(
        '历史报工重算标准工时超出安全范围',
        409,
        'PROCESS_ROUTE_CHANGE_RECALCULATION_INVALID',
      );
    }
    await tx.processExecution.update({
      where: { id: execution.id },
      data: {
        timeBasis: nextTimeBasis,
        unitLabel: nextUnitLabel,
        standardMillisecondsPerUnit,
        setupMilliseconds: nextSetup,
        unitsPerProduct: nextUnitsPerProduct,
        standardLaborMilliseconds,
        attainmentBasisPoints: calculateAttainmentBasisPoints(
          standardLaborMilliseconds,
          execution.actualLaborMilliseconds,
        ),
        standardSource: 'route_change_recalculation',
      },
    });
  }
  await tx.workOrderProcessStep.update({
    where: { id: input.stepId },
    data: {
      standardMillisecondsPerUnit,
      timeBasis: nextTimeBasis,
      unitLabel: nextUnitLabel,
      setupMilliseconds: nextSetup,
      unitsPerProduct: nextUnitsPerProduct,
      countsForEfficiency: nextCountsForEfficiency,
      standardSource: 'route_change',
      quantityVersion: { increment: 1 },
    },
  });
  const activeObligation = await tx.processSupplementObligation.findUnique({
    where: { displayStepId: input.stepId },
    select: { id: true, version: true, status: true },
  });
  if (activeObligation?.status === ProcessSupplementObligationStatus.ACTIVE) {
    const obligationUpdate = await tx.processSupplementObligation.updateMany({
      where: {
        id: activeObligation.id,
        version: activeObligation.version,
        status: ProcessSupplementObligationStatus.ACTIVE,
      },
      data: {
        timeBasis: nextTimeBasis,
        standardMillisecondsPerUnit,
        setupMilliseconds: nextSetup,
        unitsPerProduct: nextUnitsPerProduct,
        unitLabel: nextUnitLabel,
        countsForEfficiency: nextCountsForEfficiency,
        version: { increment: 1 },
      },
    });
    if (obligationUpdate.count !== 1) {
      throw new ProcessRouteChangeServiceError(
        '补充工序义务版本已变化，请刷新后重试',
        409,
        'PROCESS_SUPPLEMENT_VERSION_CONFLICT',
      );
    }
  }
  return {
    affectedCompletionCount: completions.length,
    affectedExecutionCount: executions.length,
    affectedPoolCount,
    replacedActiveClaimCount,
    reversalClaimCount: replacedActiveClaimCount,
    affectedEmployeeCount: affectedEmployees.size,
    affectedStepCount: 1,
  };
}

type ProductEntryDraft = {
  processDefinitionId: string;
  occurrenceKey: string;
  sourceProductTimeEntryId: string | null;
  sourceRouteStepId: string | null;
  position: number;
  sequenceGroup: number;
  timeBasis: string;
  unitMilliseconds: number;
  actionMilliseconds: number | null;
  occurrences: number;
  setupMilliseconds: number;
  unitLabel: string;
  reportQuantityBasis: string;
  reportUnitLabel: string;
  countsForEfficiency: boolean;
  isCritical: boolean;
  remark: string | null;
};

function productEntryIndexForRouteStep(
  entries: ProductEntryDraft[],
  routeSteps: ActivationChange['route']['steps'],
  stepId: string | null | undefined,
): number {
  if (!stepId) return -1;
  const step = routeSteps.find(item => item.id === stepId);
  if (!step) return -1;

  const identityIndex = entries.findIndex(entry => (
    entry.sourceRouteStepId === step.id
    || (Boolean(step.productTimeEntryId) && entry.sourceProductTimeEntryId === step.productTimeEntryId)
  ));
  if (identityIndex >= 0) return identityIndex;

  const structuralIndex = entries.findIndex(entry => (
    entry.processDefinitionId === step.processDefinitionId
    && entry.position === step.position
    && entry.sequenceGroup === step.sequenceGroup
  ));
  if (structuralIndex >= 0) return structuralIndex;

  if (!step.processDefinitionId) return -1;
  const routeOccurrences = routeSteps
    .filter(item => item.processDefinitionId === step.processDefinitionId)
    .sort((left, right) => left.position - right.position || left.id.localeCompare(right.id));
  const occurrenceIndex = routeOccurrences.findIndex(item => item.id === step.id);
  if (occurrenceIndex < 0) return -1;
  const entryOccurrences = entries
    .map((entry, index) => ({ entry, index }))
    .filter(item => item.entry.processDefinitionId === step.processDefinitionId)
    .sort((left, right) => left.entry.position - right.entry.position || left.index - right.index);
  return entryOccurrences[occurrenceIndex]?.index ?? -1;
}

async function publishChangedProductProfile(
  tx: Prisma.TransactionClient,
  change: ActivationChange,
  resolvedDefinitionIds: Map<string, string>,
  userId: string,
) {
  const drawingLibraryItemId = change.route.workOrder.drawingLibraryItemId;
  if (!drawingLibraryItemId) {
    throw new ProcessRouteChangeServiceError(
      '工单未关联产品资料，无法发布未来工单工艺版本',
      409,
      'PROCESS_ROUTE_CHANGE_PRODUCT_REQUIRED',
    );
  }
  const published = await tx.productTimeProfile.findFirst({
    where: { drawingLibraryItemId, status: 'published' },
    include: { entries: { orderBy: { position: 'asc' } } },
    orderBy: { version: 'desc' },
  });
  let entries: ProductEntryDraft[] = published
    ? published.entries.map(entry => ({
        processDefinitionId: entry.processDefinitionId,
        occurrenceKey: entry.occurrenceKey,
        sourceProductTimeEntryId: entry.id,
        sourceRouteStepId: null,
        position: entry.position,
        sequenceGroup: entry.sequenceGroup,
        timeBasis: entry.timeBasis,
        unitMilliseconds: entry.unitMilliseconds,
        actionMilliseconds: entry.actionMilliseconds,
        occurrences: entry.occurrences,
        setupMilliseconds: entry.setupMilliseconds,
        unitLabel: entry.unitLabel,
        reportQuantityBasis: entry.reportQuantityBasis,
        reportUnitLabel: entry.reportUnitLabel,
        countsForEfficiency: entry.countsForEfficiency,
        isCritical: entry.isCritical,
        remark: entry.remark,
      }))
    : change.route.steps
        .filter(step => step.executionMode === ProcessStepExecutionMode.NORMAL)
        .map(step => {
          if (!step.processDefinitionId || !step.standardMillisecondsPerUnit) {
            throw new ProcessRouteChangeServiceError(
              '当前路线存在缺少工序定义或标准工时的步骤，无法生成产品工艺版本',
              409,
              'PROCESS_ROUTE_CHANGE_PROFILE_SOURCE_INCOMPLETE',
            );
          }
          return {
            processDefinitionId: step.processDefinitionId,
            occurrenceKey: `route-step:${step.id}`,
            sourceProductTimeEntryId: step.productTimeEntryId,
            sourceRouteStepId: step.id,
            position: step.position,
            sequenceGroup: step.sequenceGroup,
            timeBasis: step.timeBasis || 'per_unit',
            unitMilliseconds: step.timeBasis === 'per_unit'
              ? step.standardMillisecondsPerUnit * step.unitsPerProduct
              : step.standardMillisecondsPerUnit,
            actionMilliseconds: step.timeBasis === 'per_unit' && step.unitsPerProduct > 1
              ? step.standardMillisecondsPerUnit
              : null,
            occurrences: step.unitsPerProduct,
            setupMilliseconds: step.setupMilliseconds,
            unitLabel: step.unitLabel || '件',
            reportQuantityBasis: step.reportQuantityBasis,
            reportUnitLabel: step.reportUnitLabel,
            countsForEfficiency: step.countsForEfficiency,
            isCritical: step.isCritical,
            remark: step.remark,
          };
        });
  for (const diff of change.diffs) {
    const after = record(diff.afterData);
    if (diff.kind === ProcessRouteChangeDiffKind.INSERT_STEP) {
      const processDefinitionId = resolvedDefinitionIds.get(diff.id) || diff.processDefinitionId;
      if (!processDefinitionId) {
        throw new ProcessRouteChangeServiceError('新增工序定义未解析', 409, 'PROCESS_ROUTE_CHANGE_PROCESS_DEFINITION_INVALID');
      }
      const rawTargetIndex = productEntryIndexForRouteStep(entries, change.route.steps, diff.targetStepId);
      const insertIndex = rawTargetIndex >= 0
        ? entries.findIndex(entry => entry.sequenceGroup === entries[rawTargetIndex].sequenceGroup)
        : entries.length;
      const targetSequence = entries[insertIndex]?.sequenceGroup
        ?? (entries.length ? Math.max(...entries.map(entry => entry.sequenceGroup)) + 1 : 1);
      entries = entries.map(entry => ({
        ...entry,
        sequenceGroup: entry.sequenceGroup >= targetSequence ? entry.sequenceGroup + 1 : entry.sequenceGroup,
      }));
      const insertedTimeBasis = timeBasis(after.timeBasis);
      const insertedActionMilliseconds = positiveMilliseconds(after.standardMillisecondsPerUnit);
      const insertedOccurrences = positiveInteger(after.unitsPerProduct ?? 1, '单套工序次数');
      entries.splice(insertIndex, 0, {
        processDefinitionId,
        occurrenceKey: `route-change:${change.id}:${diff.id}`,
        sourceProductTimeEntryId: null,
        sourceRouteStepId: null,
        position: insertIndex,
        sequenceGroup: targetSequence,
        timeBasis: insertedTimeBasis,
        unitMilliseconds: insertedTimeBasis === 'per_unit'
          ? insertedActionMilliseconds * insertedOccurrences
          : insertedActionMilliseconds,
        actionMilliseconds: insertedTimeBasis === 'per_unit' ? insertedActionMilliseconds : null,
        occurrences: insertedOccurrences,
        setupMilliseconds: nonnegativeInteger(after.setupMilliseconds ?? 0, '准备工时'),
        unitLabel: clean(after.unitLabel, 20) || '件',
        reportQuantityBasis: after.reportQuantityBasis === 'action'
          && insertedTimeBasis === 'per_unit'
          && insertedOccurrences > 1
          ? 'action'
          : 'product',
        reportUnitLabel: after.reportQuantityBasis === 'action'
          ? clean(after.reportUnitLabel, 20) || '个'
          : clean(after.unitLabel, 20) || '件',
        countsForEfficiency: after.countsForEfficiency !== false,
        isCritical: after.isCritical === true,
        remark: `由工艺变更 ${change.id} 新增`,
      });
    } else if (diff.kind === ProcessRouteChangeDiffKind.UPDATE_TIME) {
      const entryIndex = diff.targetStepId
        ? productEntryIndexForRouteStep(entries, change.route.steps, diff.targetStepId)
        : entries.findIndex(item => item.processDefinitionId === diff.processDefinitionId);
      const entry = entryIndex >= 0 ? entries[entryIndex] : null;
      if (!entry) {
        throw new ProcessRouteChangeServiceError(
          '产品工艺版本中找不到工时变更目标工序',
          409,
          'PROCESS_ROUTE_CHANGE_PROFILE_TARGET_MISSING',
        );
      }
      entry.timeBasis = timeBasis(after.timeBasis ?? entry.timeBasis);
      if (after.unitsPerProduct != null) entry.occurrences = positiveInteger(after.unitsPerProduct, '单套工序次数');
      const nextActionMilliseconds = positiveMilliseconds(after.standardMillisecondsPerUnit);
      entry.actionMilliseconds = entry.timeBasis === 'per_unit' ? nextActionMilliseconds : null;
      entry.unitMilliseconds = entry.timeBasis === 'per_unit'
        ? nextActionMilliseconds * entry.occurrences
        : nextActionMilliseconds;
      if (after.setupMilliseconds != null) entry.setupMilliseconds = nonnegativeInteger(after.setupMilliseconds, '准备工时');
      if (after.unitLabel != null) entry.unitLabel = clean(after.unitLabel, 20) || entry.unitLabel;
      if (after.countsForEfficiency != null) entry.countsForEfficiency = after.countsForEfficiency !== false;
    } else {
      const targetIndex = diff.targetStepId
        ? productEntryIndexForRouteStep(entries, change.route.steps, diff.targetStepId)
        : entries.findIndex(item => item.processDefinitionId === diff.processDefinitionId);
      if (targetIndex < 0) {
        throw new ProcessRouteChangeServiceError('产品工艺版本中找不到移动目标工序', 409, 'PROCESS_ROUTE_CHANGE_PROFILE_TARGET_MISSING');
      }
      const beforeStepId = clean(after.beforeStepId, 80) || null;
      const beforeIndex = beforeStepId
        ? productEntryIndexForRouteStep(entries, change.route.steps, beforeStepId)
        : -1;
      if (beforeStepId && beforeIndex < 0) {
        throw new ProcessRouteChangeServiceError('产品工艺版本中找不到移动落点工序', 409, 'PROCESS_ROUTE_CHANGE_PROFILE_TARGET_MISSING');
      }
      const plan = planProcessRouteGroupMove({
        steps: entries.map(entry => ({
          ...entry,
          id: entry.occurrenceKey,
        })),
        stepId: entries[targetIndex].occurrenceKey,
        beforeStepId: beforeIndex >= 0 ? entries[beforeIndex].occurrenceKey : null,
      });
      entries = plan.orderedSteps.map(({ id: _id, ...entry }) => entry);
    }
  }
  entries = entries.map((entry, position) => ({ ...entry, position: position + 1 }));
  const maxVersion = await tx.productTimeProfile.aggregate({
    where: { drawingLibraryItemId },
    _max: { version: true },
  });
  await tx.productTimeProfile.updateMany({
    where: { drawingLibraryItemId, status: 'published' },
    data: { status: 'archived', updatedById: userId },
  });
  const version = (maxVersion._max.version || 0) + 1;
  const created = await tx.productTimeProfile.create({
    data: {
      drawingLibraryItemId,
      version,
      revision: 0,
      status: 'published',
      sourceType: 'process_route_change',
      reportingPolicy: published?.reportingPolicy || change.route.reportingPolicy,
      remark: `工艺变更 ${change.id} 自动发布`,
      publishedAt: new Date(),
      createdById: userId,
      updatedById: userId,
      publishedById: userId,
      entries: {
        create: entries.map(({ sourceProductTimeEntryId: _sourceEntryId, sourceRouteStepId: _sourceStepId, ...entry }) => entry),
      },
    },
    include: { entries: { orderBy: { position: 'asc' } } },
  });
  return {
    id: created.id,
    version,
    entries: created.entries,
    sourceId: published?.id || null,
    sourceVersion: published?.version || null,
  };
}

async function assessCurrentRouteGroupMove(
  tx: Prisma.TransactionClient,
  routeId: string,
  stepId: string,
  beforeStepId: string | null,
) {
  const route = await tx.workOrderProcessRoute.findUnique({
    where: { id: routeId },
    include: {
      workOrder: {
        select: {
          id: true,
          productionTargetQty: true,
          completedQty: true,
        },
      },
      steps: { where: { retiredAt: null }, orderBy: [{ sequenceGroup: 'asc' }, { position: 'asc' }] },
    },
  });
  if (!route) {
    throw new ProcessRouteChangeServiceError('工艺路线不存在', 404, 'PROCESS_ROUTE_CHANGE_ROUTE_NOT_FOUND');
  }
  const plan = planProcessRouteGroupMove({ steps: route.steps, stepId, beforeStepId });
  const routeStepIds = route.steps.map(step => step.id);
  const [routeCompletionCount, routeExecutionCount, routeMovementCount] = await Promise.all([
    tx.processCompletion.count({ where: { stepId: { in: routeStepIds } } }),
    tx.processExecution.count({ where: { stepId: { in: routeStepIds } } }),
    tx.processQuantityMovement.count({
      where: {
        OR: [
          { sourceStepId: { in: routeStepIds } },
          { targetStepId: { in: routeStepIds } },
        ],
      },
    }),
  ]);
  const firstSequenceGroup = Math.min(...route.steps.map(step => step.sequenceGroup));
  const targetQty = Math.max(0, route.workOrder.productionTargetQty ?? 0);
  const routeHasNonInitialInput = route.steps.some(step => (
    step.inputQty > 0
    && (step.sequenceGroup !== firstSequenceGroup || step.inputQty !== targetQty)
  ));
  const routeHasProductionFacts = routeCompletionCount > 0
    || routeExecutionCount > 0
    || routeMovementCount > 0
    || route.status === 'completed'
    || Number(route.workOrder.completedQty) > 0
    || routeHasNonInitialInput
    || route.steps.some(step => (
      step.processedQty > 0
      || step.goodOutputQty > 0
      || step.defectOutputQty > 0
      || step.releasedGoodQty > 0
      || Boolean(step.completedAt)
      || (Boolean(step.startedAt) && step.sequenceGroup !== firstSequenceGroup)
      || (step.status === 'current' && step.sequenceGroup !== firstSequenceGroup)
      || step.status === 'completed'
      || step.status === 'skipped'
    ));
  if (!routeHasProductionFacts) return { plan, route, routeHasProductionFacts };

  const affectedSteps = route.steps.filter(step => plan.affectedStepIds.includes(step.id));
  const affectedStepIds = affectedSteps.map(step => step.id);
  const [completionCount, executionCount, movementCount] = await Promise.all([
    tx.processCompletion.count({ where: { stepId: { in: affectedStepIds } } }),
    tx.processExecution.count({ where: { stepId: { in: affectedStepIds } } }),
    tx.processQuantityMovement.count({
      where: {
        OR: [
          { sourceStepId: { in: affectedStepIds } },
          { targetStepId: { in: affectedStepIds } },
        ],
      },
    }),
  ]);
  if (movementCount > 0) {
    throw new ProcessRouteChangeServiceError(
      '调整范围已有数量移动账本（含入站/出站/冲销），不能改写历史顺序',
      409,
      'PROCESS_ROUTE_CHANGE_MOVE_LEDGER_CONFLICT',
    );
  }
  if (completionCount > 0 || executionCount > 0) {
    throw new ProcessRouteChangeServiceError(
      '调整范围已有报工或执行记录，只能调整尚未生产的未来顺序组',
      409,
      'PROCESS_ROUTE_CHANGE_MOVE_PRODUCTION_FACT_CONFLICT',
    );
  }
  if (affectedSteps.some(step => (
    step.inputQty > 0
    || step.processedQty > 0
    || step.goodOutputQty > 0
    || step.defectOutputQty > 0
    || step.releasedGoodQty > 0
  ))) {
    throw new ProcessRouteChangeServiceError(
      '调整范围已有在制、产出、放行或入站数量，不能破坏数量链路',
      409,
      'PROCESS_ROUTE_CHANGE_MOVE_QUANTITY_FACT_CONFLICT',
    );
  }
  if (affectedSteps.some(step => (
    step.status !== 'pending'
    || Boolean(step.startedAt)
    || Boolean(step.completedAt)
  ))) {
    throw new ProcessRouteChangeServiceError(
      '调整范围包含已开始或已关闭工序，只能移动完整的未来顺序组',
      409,
      'PROCESS_ROUTE_CHANGE_MOVE_NOT_FUTURE',
    );
  }
  return { plan, route, routeHasProductionFacts };
}

async function moveCurrentRouteStep(
  tx: Prisma.TransactionClient,
  routeId: string,
  stepId: string,
  after: Record<string, unknown>,
  userId: string,
) {
  const beforeStepId = clean(after.beforeStepId, 80) || null;
  const assessment = await assessCurrentRouteGroupMove(tx, routeId, stepId, beforeStepId);
  await tx.workOrderProcessStep.updateMany({
    where: { routeId },
    data: { position: { increment: 200_000 } },
  });
  const previousById = new Map(assessment.route.steps.map(step => [step.id, step] as const));
  const firstSequenceGroup = Math.min(...assessment.plan.orderedSteps.map(step => step.sequenceGroup));
  const targetQty = Math.max(0, assessment.route.workOrder.productionTargetQty ?? 0);
  const routeStarted = Boolean(assessment.route.startedAt)
    || assessment.route.status === 'in_progress'
    || assessment.route.steps.some(step => step.status === 'current');
  const currentStartedAt = assessment.route.startedAt
    || assessment.route.steps.find(step => step.status === 'current')?.startedAt
    || new Date();
  for (const step of assessment.plan.orderedSteps) {
    const previous = previousById.get(step.id);
    const nextInputQty = assessment.routeHasProductionFacts
      ? previous?.inputQty ?? 0
      : step.sequenceGroup === firstSequenceGroup ? targetQty : 0;
    await tx.workOrderProcessStep.update({
      where: { id: step.id },
      data: {
        position: step.position,
        sequenceGroup: step.sequenceGroup,
        ...(!assessment.routeHasProductionFacts ? {
          inputQty: nextInputQty,
          quantityVersion: nextInputQty !== previous?.inputQty ? { increment: 1 } : undefined,
          status: routeStarted && step.sequenceGroup === firstSequenceGroup ? 'current' : 'pending',
          startedAt: routeStarted && step.sequenceGroup === firstSequenceGroup ? currentStartedAt : null,
          completedAt: null,
          completedById: null,
        } : {}),
      },
    });
  }
  if (!assessment.routeHasProductionFacts && routeStarted) {
    const firstGroup = assessment.plan.orderedSteps.filter(step => step.sequenceGroup === firstSequenceGroup);
    await tx.workOrder.update({
      where: { id: assessment.route.workOrder.id },
      data: {
        stage: firstGroup[0]?.stageGroup || undefined,
        processName: firstGroup.map(step => step.processName).join('、') || undefined,
        lastProgressAt: new Date(),
        latestProgressRemark: `工艺顺序调整，当前工序：${firstGroup.map(step => step.processName).join('、')}`,
        executionVersion: { increment: 1 },
      },
    });
  }
  await tx.processRouteActivity.create({
    data: {
      routeId,
      stepId,
      action: 'route_change_move_group',
      content: `工艺变更整组调整顺序组 ${assessment.plan.sourceSequenceGroup}`,
      detail: json({
        sourceSequenceGroup: assessment.plan.sourceSequenceGroup,
        beforeSequenceGroup: assessment.plan.beforeSequenceGroup,
        affectedSequenceGroups: assessment.plan.affectedSequenceGroups,
        initialInputTransferred: !assessment.routeHasProductionFacts,
      }),
      actorId: userId,
    },
  });
  return assessment.plan;
}

export async function activateProcessRouteChange(command: ActivateProcessRouteChangeCommand) {
  const identity = mutationIdentity(command);
  const changeId = clean(command.changeId, 80);
  if (!changeId) throw new ProcessRouteChangeServiceError('缺少工艺变更标识', 400, 'PROCESS_ROUTE_CHANGE_ID_REQUIRED');
  try {
    const id = await serializable(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`process-route-change:${changeId}`}))`;
      const replay = await replayChangeId(tx, identity.idempotencyKey, 'activate', changeId);
      if (replay) return replay;
      const change = await tx.processRouteChange.findUnique({
        where: { id: changeId },
        include: {
          changeRequest: true,
          diffs: { orderBy: { position: 'asc' } },
          route: {
            include: {
              workOrder: true,
              steps: { where: { retiredAt: null }, orderBy: { position: 'asc' } },
            },
          },
        },
      });
      if (!change) throw new ProcessRouteChangeServiceError('工艺变更不存在', 404, 'PROCESS_ROUTE_CHANGE_NOT_FOUND');
      if (change.status === ProcessRouteChangeStatus.ACTIVE) return change.id;
      if (change.status !== ProcessRouteChangeStatus.APPROVED) {
        throw new ProcessRouteChangeServiceError(
          '只有已审核通过的工艺变更可以启用',
          409,
          'PROCESS_ROUTE_CHANGE_STATUS_CONFLICT',
          {
            currentStatus: change.status,
            currentVersion: change.version,
            expectedStatus: ProcessRouteChangeStatus.APPROVED,
            updatedAt: change.updatedAt.toISOString(),
          },
        );
      }
      if (change.version !== identity.expectedVersion) {
        throw new ProcessRouteChangeServiceError(
          '工艺变更版本已更新，请刷新后重试',
          409,
          'PROCESS_ROUTE_CHANGE_VERSION_CONFLICT',
          {
            currentStatus: change.status,
            currentVersion: change.version,
            expectedStatus: ProcessRouteChangeStatus.APPROVED,
            updatedAt: change.updatedAt.toISOString(),
          },
        );
      }
      const requestedRouteVersion = command.expectedRouteVersion == null
        ? change.baseRouteVersion
        : expectedVersion(command.expectedRouteVersion);
      if (change.route.version !== change.baseRouteVersion || change.route.version !== requestedRouteVersion) {
        throw new ProcessRouteChangeServiceError(
          '工艺路线在审核期间已变化，需要重新评估后再启用',
          409,
          'PROCESS_ROUTE_VERSION_CONFLICT',
        );
      }
      const starting = await tx.processRouteChange.updateMany({
        where: { id: changeId, status: ProcessRouteChangeStatus.APPROVED, version: change.version },
        data: {
          status: ProcessRouteChangeStatus.ACTIVATING,
          activationStartedAt: new Date(),
          updatedById: identity.userId,
          version: { increment: 1 },
        },
      });
      if (starting.count !== 1) {
        throw new ProcessRouteChangeServiceError('工艺变更版本冲突', 409, 'PROCESS_ROUTE_CHANGE_VERSION_CONFLICT');
      }
      const appliesCurrent = change.scope !== ProcessRouteChangeScope.FUTURE_PRODUCT_ONLY;
      const appliesFuture = change.scope !== ProcessRouteChangeScope.CURRENT_WORK_ORDER_ONLY;
      if (appliesFuture && change.route.workOrder.drawingLibraryItemId) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`product-time-deployment:${change.route.workOrder.drawingLibraryItemId}`}))`;
      }
      const summary = emptyLaborCorrectionSummary();
      const resolvedDefinitionIds = new Map<string, string>();
      let insertedStep: { id: string; stageGroup: string } | null = null;
      const insertedDailySteps: Array<{ stepId: string; insertBeforeStepId: string | null }> = [];
      const timeChangedStepIds = change.diffs
        .filter(item => item.kind === ProcessRouteChangeDiffKind.UPDATE_TIME && item.targetStepId)
        .map(item => item.targetStepId as string);
      if (appliesCurrent) {
        for (const diff of change.diffs) {
          if (diff.kind === ProcessRouteChangeDiffKind.INSERT_STEP) {
            const requiresSupplement = await insertionRequiresSupplementObligation(tx, change, diff);
            const inserted = requiresSupplement
              ? await insertSupplementObligation(tx, change, diff)
              : await insertNormalRouteStep(tx, change, diff);
            resolvedDefinitionIds.set(
              diff.id,
              'obligation' in inserted
                ? inserted.obligation.processDefinitionId
                : inserted.processDefinitionId,
            );
            insertedStep = { id: inserted.displayStep.id, stageGroup: inserted.displayStep.stageGroup };
            insertedDailySteps.push({
              stepId: inserted.displayStep.id,
              insertBeforeStepId: diff.targetStepId || null,
            });
          } else if (diff.kind === ProcessRouteChangeDiffKind.UPDATE_TIME) {
            if (!diff.targetStepId) throw new ProcessRouteChangeServiceError('工时变更缺少目标工序', 409);
            mergeLaborCorrectionSummary(summary, await correctStepHistoricalLabor(tx, {
              changeId,
              stepId: diff.targetStepId,
              after: record(diff.afterData),
              userId: identity.userId,
            }));
          } else {
            if (!diff.targetStepId) throw new ProcessRouteChangeServiceError('工序移动缺少目标工序', 409);
            await moveCurrentRouteStep(tx, change.routeId, diff.targetStepId, record(diff.afterData), identity.userId);
          }
        }
        if (timeChangedStepIds.length) {
          const [executionEmployees, claimEmployees] = await Promise.all([
            tx.processExecution.findMany({
              where: { stepId: { in: timeChangedStepIds }, voidedAt: null },
              select: { employeeId: true },
            }),
            tx.processLaborClaim.findMany({
              where: {
                pool: { stepId: { in: timeChangedStepIds }, completion: { voidedAt: null } },
                source: 'route_change_recalculation',
                status: ProcessLaborClaimStatus.ACTIVE,
              },
              select: { employeeId: true },
            }),
          ]);
          summary.affectedEmployeeCount = new Set([
            ...executionEmployees.map(item => item.employeeId),
            ...claimEmployees.map(item => item.employeeId),
          ]).size;
        }
      } else {
        for (const diff of change.diffs.filter(item => item.kind === ProcessRouteChangeDiffKind.INSERT_STEP)) {
          const definition = await resolveInsertedDefinition(tx, change, diff);
          resolvedDefinitionIds.set(diff.id, definition.id);
        }
      }
      const profile = appliesFuture
        ? await publishChangedProductProfile(tx, change, resolvedDefinitionIds, identity.userId)
        : null;
      let routeSync = null;
      if (profile) {
        try {
          routeSync = await deployPublishedProductTimeRoutesInTransaction(tx, {
            itemId: change.route.workOrder.drawingLibraryItemId as string,
            profileId: profile.id,
            actorId: identity.userId,
            sourceChangeId: change.id,
            excludeRouteId: change.routeId,
          });
        } catch (error) {
          if (error instanceof ProductTimeDeploymentError) {
            throw new ProcessRouteChangeServiceError(error.message, error.status, error.code);
          }
          throw error;
        }
      }
      let activatedRouteVersion: number | null = null;
      if (appliesCurrent) {
        const keepCompleted = !insertedStep && change.route.status === 'completed';
        const routeUpdate = await tx.workOrderProcessRoute.updateMany({
          where: { id: change.routeId, version: change.route.version },
          data: {
            version: { increment: 1 },
            status: keepCompleted ? 'completed' : 'in_progress',
            completedAt: keepCompleted ? change.route.completedAt : null,
            ...(profile ? {
              templateId: null,
              templateName: `${change.route.workOrder.specification || '当前产品'} 产品工时`,
              templateVersion: profile.version,
              productTimeProfileId: profile.id,
              productTimeProfileVersion: profile.version,
              routeSource: 'product_time_profile',
            } : {}),
          },
        });
        if (routeUpdate.count !== 1) throw new ProcessRouteChangeServiceError('工艺路线版本冲突', 409, 'PROCESS_ROUTE_VERSION_CONFLICT');
        activatedRouteVersion = change.route.version + 1;
        if (profile) {
          const changedStepIds = new Set([
            ...change.diffs.flatMap(diff => diff.targetStepId ? [diff.targetStepId] : []),
            ...(insertedStep ? [insertedStep.id] : []),
          ]);
          const currentSteps = await tx.workOrderProcessStep.findMany({
            where: { routeId: change.routeId },
            orderBy: { position: 'asc' },
            select: {
              id: true,
              processDefinitionId: true,
              productTimeEntryId: true,
              position: true,
              sequenceGroup: true,
              status: true,
              processedQty: true,
              _count: { select: { completions: true } },
            },
          });
          const previousEntryIds = currentSteps
            .map(step => step.productTimeEntryId)
            .filter((id): id is string => Boolean(id));
          const previousEntries = previousEntryIds.length
            ? await tx.productProcessTimeEntry.findMany({
                where: { id: { in: previousEntryIds } },
                select: { id: true, occurrenceKey: true },
              })
            : [];
          const previousOccurrenceByEntryId = new Map(
            previousEntries.map(entry => [entry.id, entry.occurrenceKey] as const),
          );
          const claimedEntryIds = new Set<string>();
          const entriesByStepId = new Map<string, (typeof profile.entries)[number]>();
          for (const step of currentSteps) {
            const previousOccurrenceKey = step.productTimeEntryId
              ? previousOccurrenceByEntryId.get(step.productTimeEntryId)
              : null;
            if (!previousOccurrenceKey) continue;
            const entry = profile.entries.find(item => (
              item.occurrenceKey === previousOccurrenceKey && !claimedEntryIds.has(item.id)
            ));
            if (!entry) continue;
            claimedEntryIds.add(entry.id);
            entriesByStepId.set(step.id, entry);
          }
          for (const step of currentSteps) {
            if (entriesByStepId.has(step.id)) continue;
            const entry = profile.entries.find(item => (
              item.processDefinitionId === step.processDefinitionId
              && item.position === step.position
              && item.sequenceGroup === step.sequenceGroup
              && !claimedEntryIds.has(item.id)
            )) || profile.entries.find(item => (
              item.processDefinitionId === step.processDefinitionId
              && !claimedEntryIds.has(item.id)
            ));
            if (!entry) continue;
            claimedEntryIds.add(entry.id);
            entriesByStepId.set(step.id, entry);
          }
          for (const step of currentSteps) {
            if (!step.processDefinitionId) continue;
            const entry = entriesByStepId.get(step.id);
            if (!entry) continue;
            const closed = step.status === 'completed' || step.status === 'skipped';
            if (closed && !changedStepIds.has(step.id)) continue;
            const usesActionCount = entry.timeBasis !== 'per_batch'
              && Boolean(entry.actionMilliseconds)
              && entry.occurrences > 1;
            await tx.workOrderProcessStep.update({
              where: { id: step.id },
              data: {
                standardTimeId: null,
                standardVersion: null,
                productTimeProfileId: profile.id,
                productTimeEntryId: entry.id,
                productTimeProfileVersion: profile.version,
                standardSource: 'product_profile',
                timeBasis: entry.timeBasis === 'per_batch' ? 'per_batch' : 'per_unit',
                unitLabel: entry.unitLabel || '套',
                standardMillisecondsPerUnit: usesActionCount
                  ? entry.actionMilliseconds as number
                  : entry.unitMilliseconds,
                setupMilliseconds: entry.setupMilliseconds,
                unitsPerProduct: usesActionCount ? entry.occurrences : 1,
                ...(step.processedQty > 0 || step._count.completions > 0 ? {} : {
                  reportQuantityBasis: entry.reportQuantityBasis === 'action' && usesActionCount
                    ? 'action'
                    : 'product',
                  reportUnitLabel: entry.reportUnitLabel || '个',
                }),
                countsForEfficiency: entry.countsForEfficiency,
              },
            });
          }
        }
        if (insertedStep && (change.route.status === 'completed' || change.route.workOrder.stage === 'completed')) {
          await tx.workOrder.update({
            where: { id: change.workOrderId },
            data: {
              stage: insertedStep.stageGroup,
              status: 'processing',
              completedAt: null,
              lastProgressAt: new Date(),
              latestProgressRemark: '已启用补充工序义务，原完成数量保持不变',
              executionVersion: { increment: 1 },
            },
          });
        }
      }
      const taskSync = profile
        ? await syncUnfinishedDailyTasksFromPublishedProductTime(tx, {
            drawingLibraryItemId: change.route.workOrder.drawingLibraryItemId as string,
            profileId: profile.id,
            profileVersion: profile.version,
            actorId: identity.userId,
            ...(appliesCurrent ? {} : { excludeRouteId: change.routeId }),
            reason: `工艺变更 ${change.id} 已启用`,
          })
        : null;
      const dailyTaskSync = appliesCurrent
        ? await synchronizeRouteChangeDailyTasks(tx, {
            changeId: change.id,
            routeId: change.routeId,
            actorId: identity.userId,
            insertedSteps: insertedDailySteps,
            timeChangedStepIds,
            reason: `工艺变更 ${change.id} 已启用`,
          })
        : null;
      const now = new Date();
      const laborSummary = json(summary);
      await tx.processRouteChange.update({
        where: { id: changeId },
        data: {
          status: ProcessRouteChangeStatus.ACTIVE,
          version: { increment: 1 },
          activatedAt: now,
          activatedById: identity.userId,
          updatedById: identity.userId,
          activatedRouteVersion,
          sourceProductTimeProfileId: profile?.sourceId ?? change.sourceProductTimeProfileId,
          baseProductProfileVersion: profile?.sourceVersion ?? change.baseProductProfileVersion,
          publishedProductTimeProfileId: profile?.id || null,
          publishedProductProfileVersion: profile?.version || null,
          laborCorrectionSummary: laborSummary,
          historicalLaborRecalculationPending: false,
          activationError: null,
        },
      });
      await tx.changeRequest.update({
        where: { id: change.changeRequestId },
        data: {
          status: 'closed',
          effectiveAt: now,
          closedAt: now,
          implementationResult: '工艺路线、补充报工义务、产品工艺版本及历史工时已在同一事务启用',
          version: { increment: 1 },
        },
      });
      await tx.processRouteChangeEvent.create({
        data: {
          changeId,
          action: 'activate',
          idempotencyKey: identity.idempotencyKey,
          fromStatus: ProcessRouteChangeStatus.APPROVED,
          toStatus: ProcessRouteChangeStatus.ACTIVE,
          actorId: identity.userId,
          actorSnapshot: identity.actor,
          detail: json({
            activatedRouteVersion,
            publishedProductProfileVersion: profile?.version || null,
            routeSync,
            taskSync,
            dailyTaskSync,
            laborCorrectionSummary: summary,
            historicalLaborRecalculationPending: false,
          }),
        },
      });
      await tx.processRouteChangeOutbox.create({
        data: {
          changeId,
          eventType: 'PROCESS_ROUTE_CHANGE_ACTIVATED',
          dedupeKey: `PROCESS_ROUTE_CHANGE_ACTIVATED:${identity.idempotencyKey}`.slice(0, 180),
          payload: json({
            changeId,
            workOrderId: change.workOrderId,
            routeId: change.routeId,
            activatedRouteVersion,
            publishedProductProfileVersion: profile?.version || null,
            routeSync,
            taskSync,
            dailyTaskSync,
            actor: identity.actor,
          }),
        },
      });
      return changeId;
    });
    return serializeChange(await loadChangeDetail(id));
  } catch (error) {
    if (error instanceof ProcessRouteChangeServiceError && error.status < 500) throw error;
    await prisma.processRouteChange.updateMany({
      where: { id: changeId, status: ProcessRouteChangeStatus.ACTIVATING },
      data: {
        status: ProcessRouteChangeStatus.FAILED,
        activationError: clean(error instanceof Error ? error.message : '启用失败', 2_000),
        historicalLaborRecalculationPending: true,
        version: { increment: 1 },
      },
    }).catch(() => undefined);
    throw error;
  }
}

function optionalDate(value: unknown, label: string): Date | null {
  if (value == null || value === '') return null;
  const result = value instanceof Date ? new Date(value) : new Date(String(value));
  if (Number.isNaN(result.getTime())) {
    throw new ProcessRouteChangeServiceError(`${label}不正确`, 400, 'PROCESS_SUPPLEMENT_DATE_INVALID');
  }
  return result;
}

export function parseProcessSupplementCompletionTiming(input: {
  workDate: unknown;
  workStartedAt?: unknown;
  workEndedAt?: unknown;
}) {
  let workDate: Date;
  try {
    workDate = normalizeWorkDate(input.workDate as string | Date);
  } catch {
    throw new ProcessRouteChangeServiceError(
      '生产日期必须是有效的 YYYY-MM-DD 日期',
      400,
      'PROCESS_SUPPLEMENT_WORK_DATE_INVALID',
    );
  }
  if (workDate.toISOString().slice(0, 10) > chinaTodayDateKey()) {
    throw new ProcessRouteChangeServiceError(
      '生产日期不能晚于今天',
      400,
      'PROCESS_SUPPLEMENT_WORK_DATE_FUTURE',
    );
  }
  const workStartedAt = optionalDate(input.workStartedAt, '开始时间');
  const workEndedAt = optionalDate(input.workEndedAt, '结束时间');
  if ((workStartedAt && !workEndedAt) || (!workStartedAt && workEndedAt)) {
    throw new ProcessRouteChangeServiceError(
      '作业开始时间和结束时间必须同时填写',
      400,
      'PROCESS_SUPPLEMENT_TIME_RANGE_REQUIRED',
    );
  }
  if (workStartedAt && workEndedAt) {
    const duration = workEndedAt.getTime() - workStartedAt.getTime();
    if (duration <= 0) {
      throw new ProcessRouteChangeServiceError(
        '结束时间必须晚于开始时间',
        400,
        'PROCESS_SUPPLEMENT_TIME_RANGE_INVALID',
      );
    }
    if (duration > 72 * 60 * 60 * 1_000) {
      throw new ProcessRouteChangeServiceError(
        '单次作业时间不能超过 72 小时',
        400,
        'PROCESS_SUPPLEMENT_TIME_RANGE_TOO_LONG',
      );
    }
  }
  return { workDate, workStartedAt, workEndedAt };
}

function serializeSupplementCompletionResult(input: {
  changeId: string | null;
  deploymentId?: string | null;
  completionId: string;
  obligationId: string;
  routeId: string;
  routeVersion: number;
  requiredQty: number;
  systemCoveredQty: number;
  actualRequiredQty: number;
  reportedQty: number;
  remainingQty: number;
  status: string;
  processedQty: number;
  employeeCount: number;
  standardLaborMilliseconds: bigint;
  releasePolicy?: string;
  fulfillmentMode?: string;
}) {
  return {
    ...input,
    standardLaborMilliseconds: input.standardLaborMilliseconds.toString(),
    releasePolicy: input.releasePolicy || PROCESS_SUPPLEMENT_RELEASE_POLICY,
    quantityMovementCount: 0,
    completedQtyDelta: 0,
  };
}

export async function completeProcessSupplementObligation(
  command: CompleteProcessSupplementObligationCommand,
  backfill?: ProductionBackfillAuthorization,
) {
  const identity = mutationIdentity(command);
  const obligationId = clean(command.obligationId, 80);
  const routeId = clean(command.routeId, 80);
  const publicCode = clean(command.publicCode, 120);
  const processedQty = nonnegativeInteger(command.processedQty ?? 0, '本次补充整套数量');
  const defectQty = nonnegativeInteger(command.defectQty ?? 0, '不良数量');
  const reportedUnitQty = nonnegativeInteger(
    command.reportedUnitQty ?? processedQty,
    '本次实际动作数量',
  );
  const reportedDefectUnitQty = nonnegativeInteger(
    command.reportedDefectUnitQty ?? defectQty,
    '动作不良数量',
  );
  if (reportedDefectUnitQty > reportedUnitQty) {
    throw new ProcessRouteChangeServiceError(
      '动作不良数量不能超过实际动作数量',
      400,
      'PROCESS_SUPPLEMENT_ACTION_DEFECT_EXCEEDED',
    );
  }
  const { workDate, workStartedAt, workEndedAt } = parseProcessSupplementCompletionTiming(command);
  const employeeIds = [...new Set((Array.isArray(command.employeeIds) ? command.employeeIds : [])
    .map(value => clean(value, 80))
    .filter(Boolean))];
  if (!obligationId || !employeeIds.length) {
    throw new ProcessRouteChangeServiceError(
      '补充工序义务和报工员工不能为空',
      400,
      'PROCESS_SUPPLEMENT_REQUIRED',
    );
  }
  const principalEmployeeId = clean(command.principalEmployeeId, 80) || employeeIds[0];
  if (!employeeIds.includes(principalEmployeeId)) {
    throw new ProcessRouteChangeServiceError(
      '主报工人必须包含在参与员工中',
      400,
      'PROCESS_SUPPLEMENT_PRINCIPAL_INVALID',
    );
  }
  return serializable(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`process-supplement:${obligationId}`}))`;
    const duplicate = await tx.processCompletion.findUnique({
      where: { idempotencyKey: identity.idempotencyKey },
      select: {
        id: true,
        supplementObligationId: true,
        routeId: true,
        routeVersion: true,
        workDate: true,
        processedQty: true,
        defectQty: true,
        reportedUnitQty: true,
        reportedDefectUnitQty: true,
        participants: { orderBy: { position: 'asc' }, select: { employeeId: true } },
        laborPool: { select: { totalStandardLaborMilliseconds: true, claims: { where: { status: ProcessLaborClaimStatus.ACTIVE } } } },
        supplementObligation: {
          select: {
            id: true,
            changeId: true,
            requiredQty: true,
            systemCoveredQty: true,
            reportedQty: true,
            reportedUnitQty: true,
            reportedGoodUnitQty: true,
            reportedDefectUnitQty: true,
            reportQuantityBasis: true,
            reportUnitLabel: true,
            status: true,
            fulfillmentMode: true,
            releasePolicy: true,
            deploymentRoute: { select: { deploymentId: true } },
          },
        },
      },
    });
    if (duplicate) {
      const duplicateEmployees = duplicate.participants.map(item => item.employeeId);
      const sameEmployees = duplicateEmployees.length === employeeIds.length
        && employeeIds.every(employeeId => duplicateEmployees.includes(employeeId));
      if (
        duplicate.supplementObligationId !== obligationId
        || !duplicate.supplementObligation
        || duplicate.processedQty !== processedQty
        || duplicate.defectQty !== defectQty
        || duplicate.reportedUnitQty !== reportedUnitQty
        || duplicate.reportedDefectUnitQty !== reportedDefectUnitQty
        || duplicate.workDate.getTime() !== workDate.getTime()
        || !sameEmployees
      ) {
        throw new ProcessRouteChangeServiceError(
          '请求标识已用于其他报工',
          409,
          'PROCESS_SUPPLEMENT_IDEMPOTENCY_CONFLICT',
        );
      }
      return serializeSupplementCompletionResult({
        changeId: duplicate.supplementObligation.changeId,
        deploymentId: duplicate.supplementObligation.deploymentRoute?.deploymentId || null,
        completionId: duplicate.id,
        obligationId,
        routeId: duplicate.routeId,
        routeVersion: duplicate.routeVersion + 1,
        requiredQty: duplicate.supplementObligation.requiredQty,
        systemCoveredQty: duplicate.supplementObligation.systemCoveredQty,
        actualRequiredQty: processSupplementActualRequiredQty(duplicate.supplementObligation),
        reportedQty: duplicate.supplementObligation.reportedQty,
        remainingQty: processSupplementRemainingQty(duplicate.supplementObligation),
        status: duplicate.supplementObligation.status,
        processedQty: duplicate.processedQty,
        employeeCount: duplicate.laborPool?.claims.length || 0,
        standardLaborMilliseconds: duplicate.laborPool?.totalStandardLaborMilliseconds || 0n,
        releasePolicy: duplicate.supplementObligation.releasePolicy,
        fulfillmentMode: duplicate.supplementObligation.fulfillmentMode,
      });
    }
    const obligation = await tx.processSupplementObligation.findUnique({
      where: { id: obligationId },
      include: {
        change: true,
        deploymentRoute: { include: { deployment: true } },
        route: { include: { workOrder: { include: { qrTicket: true } } } },
        displayStep: true,
      },
    });
    if (!obligation || (routeId && obligation.routeId !== routeId)) {
      throw new ProcessRouteChangeServiceError(
        '补充工序义务不存在或不属于当前路线',
        404,
        'PROCESS_SUPPLEMENT_NOT_FOUND',
      );
    }
    await assertProductionMayRun(tx, obligation.route.workOrder.id, backfill);
    if (obligation.displayStep.retiredAt) {
      throw new ProcessRouteChangeServiceError(
        '该补充工序已退役，不能继续报工',
        409,
        'PROCESS_SUPPLEMENT_STEP_RETIRED',
      );
    }
    if (publicCode && obligation.route.workOrder.qrTicket?.publicCode !== publicCode) {
      throw new ProcessRouteChangeServiceError('二维码与补充工序义务不匹配', 409, 'PROCESS_SUPPLEMENT_QR_CONFLICT');
    }
    if (obligation.change && obligation.change.status !== ProcessRouteChangeStatus.ACTIVE) {
      throw new ProcessRouteChangeServiceError('工艺变更尚未启用', 409, 'PROCESS_SUPPLEMENT_CHANGE_NOT_ACTIVE');
    }
    if (!obligation.change && obligation.deploymentRoute?.deployment.status !== 'ACTIVE') {
      throw new ProcessRouteChangeServiceError(
        '产品工序与工时部署尚未完成',
        409,
        'PROCESS_SUPPLEMENT_DEPLOYMENT_NOT_ACTIVE',
      );
    }
    if (!obligation.change && !obligation.deploymentRoute) {
      throw new ProcessRouteChangeServiceError(
        '补充工序义务缺少有效来源',
        409,
        'PROCESS_SUPPLEMENT_SOURCE_INVALID',
      );
    }
    if (obligation.status !== ProcessSupplementObligationStatus.ACTIVE) {
      throw new ProcessRouteChangeServiceError('补充工序义务已完成或已取消', 409, 'PROCESS_SUPPLEMENT_NOT_ACTIVE');
    }
    if (obligation.version !== identity.expectedVersion) {
      throw new ProcessRouteChangeServiceError('补充工序报工版本已变化，请刷新后重试', 409, 'PROCESS_SUPPLEMENT_VERSION_CONFLICT');
    }
    const requestedRouteVersion = command.expectedRouteVersion == null
      ? obligation.route.version
      : expectedVersion(command.expectedRouteVersion);
    if (obligation.route.version !== requestedRouteVersion) {
      throw new ProcessRouteChangeServiceError('工艺路线版本已变化，请刷新后重试', 409, 'PROCESS_ROUTE_VERSION_CONFLICT');
    }
    const reportQuantityBasis = obligation.reportQuantityBasis === 'action' ? 'action' : 'product';
    if (defectQty !== 0 || command.defectDisposition) {
      throw new ProcessRouteChangeServiceError(
        '补充工序不改变既有整套质量分支；整套不良必须为 0，动作不良可单独登记',
        400,
        'PROCESS_SUPPLEMENT_PRODUCT_DEFECT_NOT_SUPPORTED',
      );
    }
    if (
      reportQuantityBasis === 'product'
      && (
        processedQty <= 0
        || reportedUnitQty !== processedQty
        || reportedDefectUnitQty !== defectQty
      )
    ) {
      throw new ProcessRouteChangeServiceError(
        '该补充工序按整套数量报工，实际数量必须与整套完成数量一致',
        400,
        'PROCESS_SUPPLEMENT_PRODUCT_QUANTITY_MISMATCH',
      );
    }
    if (reportQuantityBasis === 'action' && processedQty === 0 && reportedUnitQty === 0) {
      throw new ProcessRouteChangeServiceError(
        '实际动作数量和形成整套数量不能同时为 0',
        400,
        'PROCESS_SUPPLEMENT_ACTION_QUANTITY_REQUIRED',
      );
    }
    const reportQuantities = resolveProcessReportQuantities({
      basis: reportQuantityBasis,
      productProcessedQty: processedQty,
      productDefectQty: defectQty,
      reportedUnitQty,
      reportedDefectUnitQty,
    });
    const actualRequiredQty = processSupplementActualRequiredQty(obligation);
    const remainingQty = processSupplementRemainingQty(obligation);
    if (processedQty > remainingQty) {
      throw new ProcessRouteChangeServiceError(
        `本次补充报工数量不能超过剩余数量 ${remainingQty}`,
        409,
        'PROCESS_SUPPLEMENT_QTY_EXCEEDED',
      );
    }
    const actionTargetQty = processReportTargetQuantity({
      productTargetQty: actualRequiredQty,
      basis: reportQuantityBasis,
      unitsPerProduct: obligation.unitsPerProduct,
    });
    const remainingActionQty = Math.max(0, actionTargetQty - obligation.reportedGoodUnitQty);
    if (reportQuantities.reportedGoodUnitQty > remainingActionQty) {
      throw new ProcessRouteChangeServiceError(
        `本次合格动作数量不能超过剩余数量 ${remainingActionQty}`,
        409,
        'PROCESS_SUPPLEMENT_ACTION_QTY_EXCEEDED',
      );
    }
    if (reportQuantityBasis === 'action') {
      try {
        assertActionFlowDoesNotExceedReportedOutput({
          unitsPerProduct: obligation.unitsPerProduct,
          previousProductGoodQty: obligation.reportedQty,
          nextProductGoodQty: reportQuantities.productGoodQty,
          previousReportedGoodUnitQty: obligation.reportedGoodUnitQty,
          nextReportedGoodUnitQty: reportQuantities.reportedGoodUnitQty,
        });
      } catch (error) {
        throw new ProcessRouteChangeServiceError(
          error instanceof Error ? error.message : '整套完成数量超过动作产出',
          409,
          'PROCESS_SUPPLEMENT_PRODUCT_FLOW_EXCEEDS_ACTION_OUTPUT',
        );
      }
    }
    if (obligation.timeBasis === 'per_batch' && processedQty !== remainingQty) {
      throw new ProcessRouteChangeServiceError(
        '按批计时的补充工序必须一次报完剩余数量',
        409,
        'PROCESS_SUPPLEMENT_PER_BATCH_PARTIAL_FORBIDDEN',
      );
    }
    const employees = await tx.employee.findMany({
      where: { id: { in: employeeIds }, ...productionEmployeeWhere() },
      select: { id: true },
    });
    if (employees.length !== employeeIds.length) {
      throw new ProcessRouteChangeServiceError(
        '参与员工包含非在职生产员工',
        409,
        'PROCESS_SUPPLEMENT_EMPLOYEE_INVALID',
      );
    }
    const now = new Date();
    const deploymentId = obligation.deploymentRoute?.deploymentId || null;
    const sourceKey = obligation.changeId || `product-time-deployment:${deploymentId}`;
    const standardSource = deploymentId ? 'product_time_deployment' : 'route_change_supplement';
    const nextReportedQty = obligation.reportedQty + processedQty;
    const nextReportedUnitQty = obligation.reportedUnitQty + reportQuantities.reportedUnitQty;
    const nextReportedGoodUnitQty = obligation.reportedGoodUnitQty + reportQuantities.reportedGoodUnitQty;
    const nextReportedDefectUnitQty = obligation.reportedDefectUnitQty + reportQuantities.reportedDefectUnitQty;
    const fulfilled = nextReportedQty >= actualRequiredQty
      && nextReportedGoodUnitQty >= actionTargetQty;
    const nextState = {
      status: fulfilled ? 'FULFILLED' : 'ACTIVE',
      remainingQty: Math.max(0, actualRequiredQty - nextReportedQty),
    } as const;
    const effectiveSetupMilliseconds = obligation.reportedUnitQty === 0
      ? obligation.setupMilliseconds
      : 0;
    const completion = await tx.processCompletion.create({
      data: {
        workOrderId: obligation.workOrderId,
        routeId: obligation.routeId,
        stepId: obligation.displayStepId,
        supplementObligationId: obligation.id,
        workDate,
        completedAt: now,
        workStartedAt,
        workEndedAt,
        team: clean(command.team, 80) || null,
        workstation: clean(command.workstation, 120) || null,
        remark: clean(command.remark, 500) || null,
        processedQty,
        goodQty: reportQuantities.productGoodQty,
        defectQty,
        reportedUnitQty: reportQuantities.reportedUnitQty,
        reportedGoodUnitQty: reportQuantities.reportedGoodUnitQty,
        reportedDefectUnitQty: reportQuantities.reportedDefectUnitQty,
        reportQuantityBasis,
        reportUnitLabel: obligation.reportUnitLabel,
        reportMode: ProcessCompletionReportMode.SEQUENTIAL,
        reportSource: ProcessCompletionSource.SUPPLEMENT_OBLIGATION,
        coverageStatus: ProcessCompletionCoverageStatus.COVERED,
        coveredQty: processedQty,
        coveredGoodQty: processedQty,
        coveredDefectQty: 0,
        coverageUpdatedAt: now,
        autoAssignLabor: true,
        routeVersion: obligation.route.version,
        idempotencyKey: identity.idempotencyKey,
        productTimeProfileId: obligation.displayStep.productTimeProfileId,
        productTimeEntryId: obligation.displayStep.productTimeEntryId,
        productTimeProfileVersion: obligation.displayStep.productTimeProfileVersion,
        standardSource,
        timeBasis: obligation.timeBasis,
        unitLabel: obligation.unitLabel,
        standardMillisecondsPerUnit: obligation.standardMillisecondsPerUnit,
        setupMilliseconds: effectiveSetupMilliseconds,
        unitsPerProduct: obligation.unitsPerProduct,
        countsForEfficiency: obligation.countsForEfficiency,
        createdById: identity.userId,
        principalEmployeeId,
        participants: {
          create: employeeIds.map((employeeId, position) => ({ employeeId, position })),
        },
      },
    });
    if (reportQuantityBasis === 'action') {
      try {
        await materializeProcessActionConsumptions(tx, obligation.displayStepId);
      } catch (error) {
        throw new ProcessRouteChangeServiceError(
          error instanceof Error ? error.message : '补充动作产出与整套流转台账不一致',
          409,
          'PROCESS_SUPPLEMENT_ACTION_CONSUMPTION_INSUFFICIENT',
        );
      }
    }
    const laborEligibleQty = reportQuantityBasis === 'action'
      ? reportQuantities.reportedUnitQty
      : processedQty;
    const laborUnitsPerProduct = reportQuantityBasis === 'action' ? 1 : obligation.unitsPerProduct;
    let standardLaborMilliseconds = 0n;
    let employeeCount = 0;
    if (laborEligibleQty > 0) {
      const snapshot = calculateCompletionLaborSnapshot({
        timeBasis: obligation.timeBasis as 'per_unit' | 'per_batch',
        eligibleQty: laborEligibleQty,
        standardMillisecondsPerUnit: obligation.standardMillisecondsPerUnit,
        setupMilliseconds: effectiveSetupMilliseconds,
        unitsPerProduct: laborUnitsPerProduct,
      });
      standardLaborMilliseconds = snapshot.totalStandardLaborMilliseconds;
      const pool = await tx.processLaborPool.create({
        data: {
          completionId: completion.id,
          workOrderId: obligation.workOrderId,
          stepId: obligation.displayStepId,
          workDate,
          eligibleQty: laborEligibleQty,
          claimedQty: 0,
          remainingQty: laborEligibleQty,
          status: ProcessLaborPoolStatus.OPEN,
          standardMillisecondsPerUnit: obligation.standardMillisecondsPerUnit,
          setupMilliseconds: effectiveSetupMilliseconds,
          unitsPerProduct: laborUnitsPerProduct,
          totalStandardLaborMilliseconds: standardLaborMilliseconds,
          claimedStandardLaborMilliseconds: 0n,
          remainingStandardLaborMilliseconds: standardLaborMilliseconds,
          countsForEfficiency: obligation.countsForEfficiency,
          productTimeProfileVersion: obligation.displayStep.productTimeProfileVersion,
          standardSource,
        },
      });
      const assigned = await autoAssignCompletionLaborPool(tx, {
        poolId: pool.id,
        completionId: completion.id,
        employeeIds,
        userId: identity.userId,
        now,
      });
      employeeCount = assigned.employeeCount;
    }
    const obligationUpdate = await tx.processSupplementObligation.updateMany({
      where: { id: obligation.id, version: obligation.version, status: ProcessSupplementObligationStatus.ACTIVE },
      data: {
        reportedQty: nextReportedQty,
        reportedUnitQty: nextReportedUnitQty,
        reportedGoodUnitQty: nextReportedGoodUnitQty,
        reportedDefectUnitQty: nextReportedDefectUnitQty,
        status: nextState.status as ProcessSupplementObligationStatus,
        version: { increment: 1 },
        lastReportedAt: now,
        fulfilledAt: nextState.status === 'FULFILLED' ? now : null,
      },
    });
    if (obligationUpdate.count !== 1) {
      throw new ProcessRouteChangeServiceError('补充工序报工版本冲突', 409, 'PROCESS_SUPPLEMENT_VERSION_CONFLICT');
    }
    await tx.workOrderProcessStep.update({
      where: { id: obligation.displayStepId },
      data: {
        status: nextState.status === 'FULFILLED' ? 'completed' : 'current',
        startedAt: obligation.displayStep.startedAt || now,
        completedAt: nextState.status === 'FULFILLED' ? now : null,
        completedById: nextState.status === 'FULFILLED' ? identity.userId : null,
        quantityVersion: { increment: 1 },
      },
    });
    const completionReconciliation = await reconcileSupplementRouteCompletion(tx, {
      routeId: obligation.routeId,
      expectedRouteVersion: obligation.route.version,
      userId: identity.userId,
      actor: identity.actor,
      now,
    }).catch(error => {
      if (error instanceof ProcessCompletionServiceError) {
        throw new ProcessRouteChangeServiceError(error.message, error.status, error.code);
      }
      throw error;
    });
    const dailyTaskSync = await synchronizeRouteChangeDailyTasks(tx, {
      changeId: sourceKey,
      routeId: obligation.routeId,
      actorId: identity.userId,
      reason: `补充工序 ${obligation.processName} 已报工，同步日任务进度`,
    });
    await tx.processRouteActivity.create({
      data: {
        routeId: obligation.routeId,
        stepId: obligation.displayStepId,
        action: 'complete_process_supplement_obligation',
        content: `${obligation.processName}补充报工 ${processedQty}，剩余 ${nextState.remainingQty}`,
        actorId: identity.userId,
        detail: json({
          obligationId: obligation.id,
          changeId: obligation.changeId,
          deploymentId,
          completionId: completion.id,
          requiredQty: obligation.requiredQty,
          systemCoveredQty: obligation.systemCoveredQty,
          actualRequiredQty,
          reportedQty: nextReportedQty,
          remainingQty: nextState.remainingQty,
          releasePolicy: obligation.releasePolicy,
          completionReconciliation,
          quantityMovementCount: 0,
          completedQtyDelta: 0,
        }),
      },
    });
    if (obligation.changeId) {
      await tx.processRouteChangeEvent.create({
        data: {
          changeId: obligation.changeId,
          action: 'complete_supplement_obligation',
          idempotencyKey: `supplement:${identity.idempotencyKey}`.slice(0, 120),
          fromStatus: ProcessRouteChangeStatus.ACTIVE,
          toStatus: ProcessRouteChangeStatus.ACTIVE,
          actorId: identity.userId,
          actorSnapshot: identity.actor,
          detail: json({
            obligationId,
            completionId: completion.id,
            processedQty,
            remainingQty: nextState.remainingQty,
            dailyTaskSync,
          }),
        },
      });
      await tx.processRouteChangeOutbox.create({
        data: {
          changeId: obligation.changeId,
          eventType: nextState.status === 'FULFILLED'
            ? 'PROCESS_SUPPLEMENT_OBLIGATION_FULFILLED'
            : 'PROCESS_SUPPLEMENT_OBLIGATION_REPORTED',
          dedupeKey: `PROCESS_SUPPLEMENT_REPORTED:${identity.idempotencyKey}`.slice(0, 180),
          payload: json({
            changeId: obligation.changeId,
            obligationId,
            workOrderId: obligation.workOrderId,
            processName: obligation.processName,
            processedQty,
            reportedQty: nextReportedQty,
            remainingQty: nextState.remainingQty,
            actor: identity.actor,
          }),
        },
      });
    }
    await tx.operationLog.create({
      data: {
        userId: identity.userId,
        action: 'complete_process_supplement_obligation',
        targetType: 'process_supplement_obligation',
        targetId: obligation.id,
        detail: json({
          completionId: completion.id,
          changeId: obligation.changeId,
          deploymentId,
          processedQty,
          releasePolicy: obligation.releasePolicy,
          quantityMovementCount: 0,
          completedQtyDelta: 0,
        }),
      },
    });
    return serializeSupplementCompletionResult({
      changeId: obligation.changeId,
      deploymentId,
      completionId: completion.id,
      obligationId,
      routeId: obligation.routeId,
      routeVersion: obligation.route.version + 1,
      requiredQty: obligation.requiredQty,
      systemCoveredQty: obligation.systemCoveredQty,
      actualRequiredQty,
      reportedQty: nextReportedQty,
      remainingQty: nextState.remainingQty,
      status: nextState.status,
      processedQty,
      employeeCount,
      standardLaborMilliseconds,
      releasePolicy: obligation.releasePolicy,
      fulfillmentMode: obligation.fulfillmentMode,
    });
  });
}
