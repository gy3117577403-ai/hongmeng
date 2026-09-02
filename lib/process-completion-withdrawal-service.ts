import {
  DailyProcessTaskStatus,
  Prisma,
  ProcessLaborClaimStatus,
  ProcessLaborPoolStatus,
  ProcessCompletionCoverageStatus,
  ProcessCompletionWithdrawalRequestStatus,
  ProcessMovementType,
} from '@prisma/client';
import { dateKeyFromDatabase } from '@/lib/attendance';
import { prisma } from '@/lib/prisma';
import { syncProductTimeRouteFromPublishedProductTime } from '@/lib/process-routing';
import { syncUnfinishedDailyTasksFromPublishedProductTime } from '@/lib/product-time-task-sync';
import { legacyStatusForStage, type WorkOrderStage } from '@/lib/work-orders';
import {
  materializeProcessActionConsumptions,
  voidProcessActionConsumptionsForCompletion,
} from '@/lib/process-action-consumption';
import { processSupplementActualRequiredQty } from '@/lib/process-supplement-coverage';
import {
  createSystemNotification,
  eligibleUserIdsForCapability,
} from '@/lib/system-notifications';
import { voidWipCreditsForCompletion } from '@/lib/wip-reporting';

export class ProcessCompletionWithdrawalError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status = 400, code = 'PROCESS_COMPLETION_WITHDRAWAL_INVALID') {
    super(message);
    this.name = 'ProcessCompletionWithdrawalError';
    this.status = status;
    this.code = code;
  }
}

export type CompletionCorrectionCategory = 'REPORTING_ERROR' | 'PROCESS_EXCEPTION';

export type ProcessCompletionWithdrawalBlocker = {
  code: string;
  message: string;
};

export type ProcessCompletionWithdrawalImpact = {
  processedQty: number;
  goodQty: number;
  reportedUnitQty: number;
  reportedGoodUnitQty: number;
  reportQuantityBasis: 'product' | 'action';
  reportUnitLabel: string;
  releaseReductionQty: number;
  affectedTargetStepCount: number;
  downstreamPendingCompletionCount: number;
  downstreamPendingQty: number;
  laborPoolId: string | null;
  laborClaimCount: number;
  laborClaimedQty: number;
  employeeNames: string[];
  workOrderCompletedReductionQty: number;
  frontendTransferReductionQty: number;
};

export type ProcessCompletionWithdrawalPreview = {
  routeId: string;
  routeVersion: number;
  completion: {
    id: string;
    stepId: string;
    processName: string;
    workDate: string;
    completedAt: string;
    processedQty: number;
    goodQty: number;
    defectQty: number;
    coveredQty: number;
    pendingCoverageQty: number;
    voidedAt: string | null;
  };
  canWithdraw: boolean;
  blockers: ProcessCompletionWithdrawalBlocker[];
  impact: ProcessCompletionWithdrawalImpact;
};

export type WithdrawProcessCompletionCommand = {
  routeId: string;
  completionId: string;
  expectedRouteVersion: unknown;
  category: unknown;
  reason?: unknown;
  idempotencyKey: unknown;
  userId: string;
  actor: string;
};

export type WithdrawProcessCompletionResult = {
  status: 'WITHDRAWN' | 'BLOCKED';
  completionId: string;
  routeVersion: number;
  preview: ProcessCompletionWithdrawalPreview;
  issue: { id: string; code: string } | null;
};

export type ProcessCompletionWithdrawalRequestDto = {
  id: string;
  status: ProcessCompletionWithdrawalRequestStatus;
  version: number;
  category: CompletionCorrectionCategory;
  reason: string | null;
  requestedRouteVersion: number;
  createdAt: string;
  updatedAt: string;
  decidedAt: string | null;
  decisionNote: string | null;
  cancelledAt: string | null;
  executedAt: string | null;
  resultCode: string | null;
  resultDetail: Prisma.JsonValue | null;
  routeId: string;
  completionId: string;
  requester: {
    userId: string;
    employeeId: string | null;
    employeeNo: string | null;
    name: string;
  };
  workOrder: {
    id: string;
    code: string;
    businessCode: string | null;
    specification: string | null;
  };
  route: {
    id: string;
    version: number;
    status: string;
  };
  step: {
    id: string;
    processName: string;
    sequenceGroup: number;
  };
  completion: {
    id: string;
    processedQty: number;
    goodQty: number;
    defectQty: number;
    reportedUnitQty: number;
    reportQuantityBasis: string;
    reportUnitLabel: string;
    completedAt: string;
    voidedAt: string | null;
  };
};

export type ProcessCompletionWithdrawalRequestDecisionResult = {
  status: 'APPLIED' | 'REJECTED' | 'BLOCKED' | 'STALE';
  request: ProcessCompletionWithdrawalRequestDto;
  withdrawal: WithdrawProcessCompletionResult | null;
};

const withdrawalRequestInclude = Prisma.validator<Prisma.ProcessCompletionWithdrawalRequestInclude>()({
  requesterUser: { select: { id: true, displayName: true, username: true } },
  requesterEmployee: { select: { id: true, employeeNo: true, name: true } },
  workOrder: { select: { id: true, code: true, businessCode: true, specification: true } },
  route: { select: { id: true, version: true, status: true } },
  step: { select: { id: true, processName: true, sequenceGroup: true } },
  completion: {
    select: {
      id: true,
      processedQty: true,
      goodQty: true,
      defectQty: true,
      reportedUnitQty: true,
      reportQuantityBasis: true,
      reportUnitLabel: true,
      completedAt: true,
      voidedAt: true,
    },
  },
});

type WithdrawalRequestRecord = Prisma.ProcessCompletionWithdrawalRequestGetPayload<{
  include: typeof withdrawalRequestInclude;
}>;

const withdrawalStateInclude = Prisma.validator<Prisma.ProcessCompletionInclude>()({
  step: {
    include: {
      completions: {
        where: { voidedAt: null, reportQuantityBasis: 'action' },
        select: {
          id: true,
          reportedGoodUnitQty: true,
          goodQty: true,
          unitsPerProduct: true,
        },
      },
    },
  },
  branchWorkOrder: { select: { id: true, code: true, branchStatus: true } },
  supplementObligation: true,
  participants: {
    include: { employee: { select: { id: true, name: true, employeeNo: true } } },
    orderBy: { position: 'asc' },
  },
  movements: {
    where: { voidedAt: null },
    select: {
      id: true,
      type: true,
      quantity: true,
      branchWorkOrderId: true,
      targetStepId: true,
      reversalOfId: true,
    },
    orderBy: { createdAt: 'asc' },
  },
  laborPool: {
    include: {
      claims: {
        where: { status: ProcessLaborClaimStatus.ACTIVE },
        include: { employee: { select: { id: true, name: true } } },
        orderBy: [{ claimedAt: 'asc' }, { id: 'asc' }],
      },
    },
  },
  wipCredits: {
    where: { status: 'ACTIVE' },
    select: {
      allocationStep: {
        select: { allocation: { select: { status: true } } },
      },
    },
  },
  route: {
    include: {
      workOrder: true,
      steps: { where: { retiredAt: null }, orderBy: [{ sequenceGroup: 'asc' }, { position: 'asc' }] },
    },
  },
});

const triggeredCoverageInclude = Prisma.validator<Prisma.ProcessCompletionCoverageInclude>()({
  reportCompletion: {
    include: {
      step: true,
      branchWorkOrder: { select: { id: true, code: true, branchStatus: true } },
    },
  },
});

type WithdrawalState = Prisma.ProcessCompletionGetPayload<{
  include: typeof withdrawalStateInclude;
}>;

type TriggeredCoverageRecord = Prisma.ProcessCompletionCoverageGetPayload<{
  include: typeof triggeredCoverageInclude;
}>;

type ReleaseMovementRecord = {
  id: string;
  completionId: string;
  workOrderId: string;
  sourceStepId: string;
  targetStepId: string | null;
  branchWorkOrderId: string | null;
  type: ProcessMovementType;
  quantity: number;
  sourceSequenceGroup: number;
  targetSequenceGroup: number | null;
  createdAt: Date;
  reversals: Array<{ quantity: number }>;
};

type MovementReversalPlan = {
  original: ReleaseMovementRecord;
  quantity: number;
};

type StepRollbackPlan = {
  stepId: string;
  sequenceGroup: number;
  inputReduction: number;
  processedReduction: number;
  goodReduction: number;
  defectReduction: number;
  releaseReduction: number;
  nextInputQty: number;
  nextProcessedQty: number;
  nextGoodOutputQty: number;
  nextDefectOutputQty: number;
  nextReleasedGoodQty: number;
};

type CompletionCoverageRollback = {
  completionId: string;
  quantity: number;
  goodQty: number;
  defectQty: number;
  currentCoveredQty: number;
  currentCoveredGoodQty: number;
  currentCoveredDefectQty: number;
  processedQty: number;
};

type WithdrawalRollbackPlan = {
  blockers: ProcessCompletionWithdrawalBlocker[];
  steps: StepRollbackPlan[];
  coverageAllocationIds: string[];
  completionCoverages: CompletionCoverageRollback[];
  movementReversals: Array<{
    sequenceGroup: number;
    targetStepId: string | null;
    plans: MovementReversalPlan[];
  }>;
  sourceReleaseReductionQty: number;
  terminalReleaseReductionQty: number;
  frontendTransferReductionQty: number;
  downstreamPendingCompletionCount: number;
  downstreamPendingQty: number;
};

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function parseExpectedRequestVersion(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new ProcessCompletionWithdrawalError(
      '撤回申请版本不正确，请刷新后重试',
      400,
      'PROCESS_COMPLETION_WITHDRAWAL_REQUEST_VERSION_INVALID',
    );
  }
  return parsed;
}

function parseWithdrawalRequestStatus(value: unknown): ProcessCompletionWithdrawalRequestStatus | null {
  if (typeof value !== 'string' || !value.trim() || value === 'ALL') return null;
  const status = value.trim().toUpperCase();
  if (Object.values(ProcessCompletionWithdrawalRequestStatus).includes(
    status as ProcessCompletionWithdrawalRequestStatus,
  )) return status as ProcessCompletionWithdrawalRequestStatus;
  throw new ProcessCompletionWithdrawalError(
    '撤回申请状态筛选不正确',
    400,
    'PROCESS_COMPLETION_WITHDRAWAL_REQUEST_STATUS_INVALID',
  );
}

export function serializeProcessCompletionWithdrawalRequest(
  request: WithdrawalRequestRecord,
): ProcessCompletionWithdrawalRequestDto {
  const employee = request.requesterEmployee;
  return {
    id: request.id,
    status: request.status,
    version: request.version,
    category: request.category === 'PROCESS_EXCEPTION' ? 'PROCESS_EXCEPTION' : 'REPORTING_ERROR',
    reason: request.reason,
    requestedRouteVersion: request.requestedRouteVersion,
    createdAt: request.createdAt.toISOString(),
    updatedAt: request.updatedAt.toISOString(),
    decidedAt: request.decidedAt?.toISOString() || null,
    decisionNote: request.decisionNote,
    cancelledAt: request.cancelledAt?.toISOString() || null,
    executedAt: request.executedAt?.toISOString() || null,
    resultCode: request.resultCode,
    resultDetail: request.resultDetail,
    routeId: request.routeId,
    completionId: request.completionId,
    requester: {
      userId: request.requesterUserId,
      employeeId: employee?.id || request.requesterEmployeeId,
      employeeNo: employee?.employeeNo || null,
      name: employee?.name || request.requesterUser.displayName || request.requesterUser.username,
    },
    workOrder: request.workOrder,
    route: request.route,
    step: request.step,
    completion: {
      ...request.completion,
      completedAt: request.completion.completedAt.toISOString(),
      voidedAt: request.completion.voidedAt?.toISOString() || null,
    },
  };
}

function parseExpectedRouteVersion(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new ProcessCompletionWithdrawalError(
      '工艺路线版本不正确，请刷新后重试',
      400,
      'PROCESS_ROUTE_VERSION_INVALID',
    );
  }
  return parsed;
}

function parseCategory(value: unknown): CompletionCorrectionCategory {
  if (value === 'REPORTING_ERROR' || value === 'PROCESS_EXCEPTION') return value;
  throw new ProcessCompletionWithdrawalError(
    '请选择“报工错误”或“流程异常”',
    400,
    'PROCESS_COMPLETION_CORRECTION_CATEGORY_REQUIRED',
  );
}

function automaticWithdrawalAuditReason(
  category: CompletionCorrectionCategory,
  state: WithdrawalState,
  preview: ProcessCompletionWithdrawalPreview,
): string {
  const categoryLabel = category === 'REPORTING_ERROR' ? '报工错误' : '流程异常';
  return [
    `完工撤回（${categoryLabel}）`,
    `工序：${state.step.processName}`,
    `报工数量：${completionQuantityDescription(state)}`,
    `回收转序：${preview.impact.releaseReductionQty}`,
    `冲销领取：${preview.impact.laborClaimedQty}`,
  ].join('；').slice(0, 500);
}

function completionQuantityDescription(state: WithdrawalState): string {
  if (state.reportQuantityBasis === 'action') {
    return `${state.reportedUnitQty} ${state.reportUnitLabel || '个'}动作，形成 ${state.processedQty} ${state.step.unitLabel || '件'}整套流转`;
  }
  return `${state.processedQty} ${state.step.unitLabel || state.reportUnitLabel || '件'}`;
}

function parseIdempotencyKey(value: unknown): string {
  const key = text(value, 120);
  if (key.length < 8) {
    throw new ProcessCompletionWithdrawalError(
      '请求标识无效，请重新提交',
      400,
      'PROCESS_COMPLETION_WITHDRAWAL_IDEMPOTENCY_INVALID',
    );
  }
  return key;
}

function parseStoredQuantity(value: unknown): number {
  const parsed = Number(String(value ?? '').replace(/,/g, '').trim() || 0);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function targetQuantity(state: WithdrawalState): number {
  const explicit = Number(state.route.workOrder.productionTargetQty);
  if (Number.isSafeInteger(explicit) && explicit > 0) return explicit;
  const imported = parseStoredQuantity(state.route.workOrder.uncompletedQty);
  return imported > 0 ? imported : 1;
}

function effectiveMovementQuantity(movement: ReleaseMovementRecord): number {
  return Math.max(
    0,
    movement.quantity - movement.reversals.reduce((sum, reversal) => sum + reversal.quantity, 0),
  );
}

export function planQuantityMovementReversals(input: {
  movements: ReleaseMovementRecord[];
  targetStepId: string | null;
  requiredQty: number;
  sourceSequenceGroup?: number;
}): MovementReversalPlan[] {
  let remaining = input.requiredQty;
  const planned: MovementReversalPlan[] = [];
  const matching = input.movements
    .filter(movement => (
      movement.targetStepId === input.targetStepId
      && (input.sourceSequenceGroup === undefined
        || movement.sourceSequenceGroup === input.sourceSequenceGroup)
    ))
    .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
  for (const movement of matching) {
    if (remaining <= 0) break;
    const available = effectiveMovementQuantity(movement);
    if (available <= 0) continue;
    const quantity = Math.min(remaining, available);
    planned.push({ original: movement, quantity });
    remaining -= quantity;
  }
  if (remaining > 0) {
    throw new ProcessCompletionWithdrawalError(
      '数量移动台账不足，不能自动撤回；系统已转为流程异常处理',
      409,
      'PROCESS_COMPLETION_MOVEMENT_LEDGER_INSUFFICIENT',
    );
  }
  return planned;
}

async function loadState(
  db: Prisma.TransactionClient | typeof prisma,
  routeId: string,
  completionId: string,
): Promise<{
  state: WithdrawalState;
  releaseMovements: ReleaseMovementRecord[];
  triggeredCoverages: TriggeredCoverageRecord[];
}> {
  const state = await db.processCompletion.findFirst({
    where: { id: completionId, routeId },
    include: withdrawalStateInclude,
  });
  if (!state) {
    throw new ProcessCompletionWithdrawalError(
      '完工记录不存在或不属于当前路线',
      404,
      'PROCESS_COMPLETION_NOT_FOUND',
    );
  }
  // The coverage columns were added after the original completion ledger.
  // A fully covered legacy/direct completion can therefore carry the new
  // COVERED default with zero snapshots. Treat that exact shape as the
  // historical full-coverage record; true advance reports use PENDING/PARTIAL
  // and must keep their uncovered quantity at zero here.
  if (
    state.coverageStatus === ProcessCompletionCoverageStatus.COVERED
    && state.coveredQty === 0
    && state.processedQty > 0
  ) {
    state.coveredQty = state.processedQty;
    state.coveredGoodQty = state.goodQty;
    state.coveredDefectQty = state.defectQty;
  }
  const [releaseMovements, triggeredCoverages] = await Promise.all([
    db.processQuantityMovement.findMany({
      where: {
        workOrderId: state.workOrderId,
        sourceSequenceGroup: { gte: state.step.sequenceGroup },
        type: { in: [ProcessMovementType.GOOD_TRANSFER, ProcessMovementType.FINISHED_GOOD] },
        voidedAt: null,
      },
      select: {
        id: true,
        completionId: true,
        workOrderId: true,
        sourceStepId: true,
        targetStepId: true,
        branchWorkOrderId: true,
        type: true,
        quantity: true,
        sourceSequenceGroup: true,
        targetSequenceGroup: true,
        createdAt: true,
        reversals: {
          where: { voidedAt: null },
          select: { quantity: true },
        },
      },
    }),
    db.processCompletionCoverage.findMany({
      where: { triggerCompletionId: state.id, voidedAt: null },
      include: triggeredCoverageInclude,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    }),
  ]);
  return { state, releaseMovements, triggeredCoverages };
}

function nextGroupSteps(state: WithdrawalState) {
  const groups = state.route.steps
    .filter(step => step.executionMode === 'NORMAL')
    .map(step => step.sequenceGroup)
    .filter(group => group > state.step.sequenceGroup);
  if (!groups.length) return [];
  const group = Math.min(...groups);
  return state.route.steps.filter(step => (
    step.executionMode === 'NORMAL'
    && step.sequenceGroup === group
  ));
}

function buildWithdrawalRollbackPlan(
  state: WithdrawalState,
  releaseMovements: ReleaseMovementRecord[],
  triggeredCoverages: TriggeredCoverageRecord[],
): WithdrawalRollbackPlan {
  const blockers: ProcessCompletionWithdrawalBlocker[] = [];
  if (state.reportQuantityBasis === 'action') {
    const remainingActionOutput = state.step.completions
      .filter(completion => completion.id !== state.id)
      .reduce((sum, completion) => sum + completion.reportedGoodUnitQty, 0);
    const remainingActionDemand = state.step.completions
      .filter(completion => completion.id !== state.id)
      .reduce((sum, completion) => sum + completion.goodQty * completion.unitsPerProduct, 0);
    if (remainingActionOutput < remainingActionDemand) {
      blockers.push({
        code: 'PROCESS_ACTION_WITHDRAWAL_DEPENDENCY_EXISTS',
        message: `该笔动作报工撤回后只剩 ${remainingActionOutput} 个合格动作，但其余整套良品仍需要 ${remainingActionDemand} 个；请先撤回依赖它形成的整套报工`,
      });
    }
  }
  const normalSteps = state.route.steps.filter(step => step.executionMode === 'NORMAL');
  const groups = [...new Set(normalSteps.map(step => step.sequenceGroup))]
    .filter(group => group >= state.step.sequenceGroup)
    .sort((left, right) => left - right);
  const stepPlans: StepRollbackPlan[] = [];
  const inputReductionByStep = new Map<string, number>();
  const downstreamCoverageByStep = new Map<string, TriggeredCoverageRecord[]>();
  const completionCoverageMap = new Map<string, CompletionCoverageRollback>();
  const coverageAllocationIds: string[] = [];
  const movementReversals: WithdrawalRollbackPlan['movementReversals'] = [];
  let sourceReleaseReductionQty = 0;
  let terminalReleaseReductionQty = 0;
  let frontendTransferReductionQty = 0;

  for (const coverage of triggeredCoverages) {
    if (
      coverage.reportCompletionId === state.id
      || coverage.reportCompletion.step.sequenceGroup <= state.step.sequenceGroup
    ) continue;
    const list = downstreamCoverageByStep.get(coverage.reportCompletion.stepId) || [];
    list.push(coverage);
    downstreamCoverageByStep.set(coverage.reportCompletion.stepId, list);
  }

  for (const group of groups) {
    const groupSteps = normalSteps.filter(step => step.sequenceGroup === group);
    const reductions = new Map<string, { processed: number; good: number; defect: number }>();
    for (const step of groupSteps) {
      const inputReduction = inputReductionByStep.get(step.id) || 0;
      if (inputReduction > step.inputQty) {
        blockers.push({
          code: 'PROCESS_COMPLETION_TARGET_QUANTITY_CONFLICT',
          message: `${step.processName} 的投入数量不足以回退 ${inputReduction}`,
        });
      }
      if (step.id === state.stepId) {
        reductions.set(step.id, {
          processed: state.coveredQty,
          good: state.coveredGoodQty,
          defect: state.coveredDefectQty,
        });
        continue;
      }
      const nextInputQty = Math.max(0, step.inputQty - inputReduction);
      const requiredDemotion = Math.max(0, step.processedQty - nextInputQty);
      if (requiredDemotion <= 0) {
        reductions.set(step.id, { processed: 0, good: 0, defect: 0 });
        continue;
      }
      const candidates = downstreamCoverageByStep.get(step.id) || [];
      const candidateQty = candidates.reduce((sum, coverage) => sum + coverage.quantity, 0);
      if (candidateQty !== requiredDemotion) {
        blockers.push({
          code: candidateQty < requiredDemotion
            ? 'PROCESS_COMPLETION_DOWNSTREAM_COVERAGE_NOT_ATTRIBUTABLE'
            : 'PROCESS_COMPLETION_DOWNSTREAM_PARTIAL_COVERAGE_REQUIRED',
          message: candidateQty < requiredDemotion
            ? `${step.processName} 需退回 ${requiredDemotion}，但本次上道报工只关联 ${candidateQty}，不能自动回退`
            : `${step.processName} 只需退回 ${requiredDemotion}，关联核销为 ${candidateQty}，需主管核对后处理`,
        });
        reductions.set(step.id, { processed: 0, good: 0, defect: 0 });
        continue;
      }
      const invalidCoverage = candidates.find(coverage => (
        coverage.reportCompletion.voidedAt
        || coverage.defectQty > 0
        || Boolean(coverage.reportCompletion.branchWorkOrder)
      ));
      if (invalidCoverage) {
        blockers.push({
          code: 'PROCESS_COMPLETION_DOWNSTREAM_BRANCH_EFFECT_EXISTS',
          message: `${step.processName} 的提前报工已产生不良或分支影响，需进入流程异常处理`,
        });
        reductions.set(step.id, { processed: 0, good: 0, defect: 0 });
        continue;
      }
      const good = candidates.reduce((sum, coverage) => sum + coverage.goodQty, 0);
      const defect = candidates.reduce((sum, coverage) => sum + coverage.defectQty, 0);
      reductions.set(step.id, { processed: candidateQty, good, defect });
      for (const coverage of candidates) {
        coverageAllocationIds.push(coverage.id);
        const report = coverage.reportCompletion;
        const existing = completionCoverageMap.get(report.id) || {
          completionId: report.id,
          quantity: 0,
          goodQty: 0,
          defectQty: 0,
          currentCoveredQty: report.coveredQty,
          currentCoveredGoodQty: report.coveredGoodQty,
          currentCoveredDefectQty: report.coveredDefectQty,
          processedQty: report.processedQty,
        };
        existing.quantity += coverage.quantity;
        existing.goodQty += coverage.goodQty;
        existing.defectQty += coverage.defectQty;
        completionCoverageMap.set(report.id, existing);
      }
    }

    const currentReleased = groupSteps.length
      ? Math.min(...groupSteps.map(step => step.releasedGoodQty))
      : 0;
    const nextGoodQuantities = groupSteps.map(step => {
      const reduction = reductions.get(step.id) || { processed: 0, good: 0, defect: 0 };
      if (
        reduction.processed > step.processedQty
        || reduction.good > step.goodOutputQty
        || reduction.defect > step.defectOutputQty
      ) {
        blockers.push({
          code: 'PROCESS_COMPLETION_QUANTITY_STATE_INVALID',
          message: `${step.processName} 当前数量小于需回退数量，需先核对数量台账`,
        });
      }
      return Math.max(0, step.goodOutputQty - reduction.good);
    });
    const nextReleasedGoodQty = Math.min(
      currentReleased,
      nextGoodQuantities.length ? Math.min(...nextGoodQuantities) : 0,
    );
    const releaseReduction = Math.max(0, currentReleased - nextReleasedGoodQty);
    if (group === state.step.sequenceGroup) sourceReleaseReductionQty = releaseReduction;
    const groupIndex = groups.indexOf(group);
    const nextGroup = groups[groupIndex + 1];
    const targetSteps = nextGroup === undefined
      ? []
      : normalSteps.filter(step => step.sequenceGroup === nextGroup);
    if (releaseReduction > 0) {
      const channels = targetSteps.length ? targetSteps.map(step => step.id) : [null];
      for (const targetStepId of channels) {
        try {
          movementReversals.push({
            sequenceGroup: group,
            targetStepId,
            plans: planQuantityMovementReversals({
              movements: releaseMovements,
              targetStepId,
              requiredQty: releaseReduction,
              sourceSequenceGroup: group,
            }),
          });
        } catch (error) {
          if (error instanceof ProcessCompletionWithdrawalError) {
            blockers.push({ code: error.code, message: error.message });
          } else {
            throw error;
          }
        }
      }
      if (!targetSteps.length) terminalReleaseReductionQty += releaseReduction;
      if (
        targetSteps.length
        && groupSteps[0]?.stageGroup === 'frontend'
        && targetSteps[0]?.stageGroup !== 'frontend'
      ) frontendTransferReductionQty += releaseReduction;
      for (const targetStep of targetSteps) {
        inputReductionByStep.set(
          targetStep.id,
          (inputReductionByStep.get(targetStep.id) || 0) + releaseReduction,
        );
      }
    }

    for (const step of groupSteps) {
      const reduction = reductions.get(step.id) || { processed: 0, good: 0, defect: 0 };
      const inputReduction = inputReductionByStep.get(step.id) || 0;
      const nextInputQty = Math.max(0, step.inputQty - inputReduction);
      const nextProcessedQty = Math.max(0, step.processedQty - reduction.processed);
      if (nextProcessedQty > nextInputQty) {
        blockers.push({
          code: 'PROCESS_COMPLETION_DOWNSTREAM_PROCESSED',
          message: `${step.processName} 回退后仍有 ${nextProcessedQty - nextInputQty} 数量无法转回待前序覆盖`,
        });
      }
      stepPlans.push({
        stepId: step.id,
        sequenceGroup: group,
        inputReduction,
        processedReduction: reduction.processed,
        goodReduction: reduction.good,
        defectReduction: reduction.defect,
        releaseReduction,
        nextInputQty,
        nextProcessedQty,
        nextGoodOutputQty: Math.max(0, step.goodOutputQty - reduction.good),
        nextDefectOutputQty: Math.max(0, step.defectOutputQty - reduction.defect),
        nextReleasedGoodQty,
      });
    }
  }

  const uniqueBlockers = blockers.filter((blocker, index, items) => (
    items.findIndex(item => item.code === blocker.code && item.message === blocker.message) === index
  ));
  const completionCoverages = [...completionCoverageMap.values()];
  return {
    blockers: uniqueBlockers,
    steps: stepPlans,
    coverageAllocationIds: [...new Set(coverageAllocationIds)],
    completionCoverages,
    movementReversals,
    sourceReleaseReductionQty,
    terminalReleaseReductionQty,
    frontendTransferReductionQty,
    downstreamPendingCompletionCount: completionCoverages.length,
    downstreamPendingQty: completionCoverages.reduce((sum, completion) => sum + completion.quantity, 0),
  };
}

function previewFromState(
  state: WithdrawalState,
  releaseMovements: ReleaseMovementRecord[],
  triggeredCoverages: TriggeredCoverageRecord[],
): ProcessCompletionWithdrawalPreview {
  const blockers: ProcessCompletionWithdrawalBlocker[] = [];
  const rollbackPlan = buildWithdrawalRollbackPlan(state, releaseMovements, triggeredCoverages);
  blockers.push(...rollbackPlan.blockers);

  if (state.voidedAt) {
    blockers.push({ code: 'PROCESS_COMPLETION_ALREADY_WITHDRAWN', message: '该完工记录已经撤回' });
  }
  if (
    !state.supplementObligationId
    && (
      state.coveredQty > state.step.processedQty
      || state.coveredGoodQty > state.step.goodOutputQty
      || state.coveredDefectQty > state.step.defectOutputQty
    )
  ) {
    blockers.push({
      code: 'PROCESS_COMPLETION_QUANTITY_STATE_INVALID',
      message: '当前工序数量小于本次完工数量，需先核对数量台账',
    });
  }
  const branchMovement = state.movements.some(movement => (
    movement.branchWorkOrderId
    || movement.type === ProcessMovementType.REWORK_SPLIT
    || movement.type === ProcessMovementType.SCRAP_REPLENISH_SPLIT
    || movement.type === ProcessMovementType.QUALITY_HOLD
    || movement.type === ProcessMovementType.REWORK_RETURN
    || movement.type === ProcessMovementType.SCRAP
  ));
  if (state.coveredDefectQty > 0 || state.branchWorkOrder || branchMovement) {
    blockers.push({
      code: 'PROCESS_COMPLETION_BRANCH_EFFECT_EXISTS',
      message: '本次完工已产生不良或分支流转，不能直接撤回，需进入流程异常处理',
    });
  }
  if (state.route.workOrder.branchType) {
    blockers.push({
      code: 'PROCESS_COMPLETION_BRANCH_WORK_ORDER',
      message: '分支工单的完工会影响上级数量，需进入流程异常处理',
    });
  }
  if (state.laborPool?.status === ProcessLaborPoolStatus.VOIDED) {
    blockers.push({
      code: 'PROCESS_COMPLETION_LABOR_POOL_ALREADY_VOIDED',
      message: '关联工时池已作废，需先核对工时台账',
    });
  }
  if (state.wipCredits.some(credit => (
    credit.allocationStep.allocation.status === 'SUPERSEDED'
  ))) {
    blockers.push({
      code: 'PROCESS_WIP_RESCHEDULE_DEPENDENCY_EXISTS',
      message: '该笔半成品报工已作为后续改排的数量依据；请先核对并撤销后续改排，再处理本次报工撤回',
    });
  }

  const claims = state.laborPool?.claims || [];
  const employeeNames = [...new Set(claims.map(claim => claim.employee.name))];
  return {
    routeId: state.routeId,
    routeVersion: state.route.version,
    completion: {
      id: state.id,
      stepId: state.stepId,
      processName: state.step.processName,
      workDate: dateKeyFromDatabase(state.workDate),
      completedAt: state.completedAt.toISOString(),
      processedQty: state.processedQty,
      goodQty: state.goodQty,
      defectQty: state.defectQty,
      coveredQty: state.coveredQty,
      pendingCoverageQty: Math.max(0, state.processedQty - state.coveredQty),
      voidedAt: state.voidedAt?.toISOString() || null,
    },
    canWithdraw: blockers.length === 0,
    blockers,
    impact: {
      processedQty: state.coveredQty,
      goodQty: state.coveredGoodQty,
      reportedUnitQty: state.reportedUnitQty,
      reportedGoodUnitQty: state.reportedGoodUnitQty,
      reportQuantityBasis: state.reportQuantityBasis === 'action' ? 'action' : 'product',
      reportUnitLabel: state.reportUnitLabel || state.step.unitLabel || '件',
      releaseReductionQty: rollbackPlan.sourceReleaseReductionQty,
      affectedTargetStepCount: rollbackPlan.steps.filter(step => (
        step.sequenceGroup > state.step.sequenceGroup
        && (step.inputReduction > 0 || step.processedReduction > 0)
      )).length,
      downstreamPendingCompletionCount: rollbackPlan.downstreamPendingCompletionCount,
      downstreamPendingQty: rollbackPlan.downstreamPendingQty,
      laborPoolId: state.laborPool?.id || null,
      laborClaimCount: claims.length,
      laborClaimedQty: claims.reduce((sum, claim) => sum + claim.quantity, 0),
      employeeNames,
      workOrderCompletedReductionQty: rollbackPlan.terminalReleaseReductionQty,
      frontendTransferReductionQty: rollbackPlan.frontendTransferReductionQty,
    },
  };
}

export async function previewProcessCompletionWithdrawal(
  routeIdValue: string,
  completionIdValue: string,
): Promise<ProcessCompletionWithdrawalPreview> {
  const routeId = text(routeIdValue, 80);
  const completionId = text(completionIdValue, 80);
  if (!routeId || !completionId) {
    throw new ProcessCompletionWithdrawalError(
      '缺少路线或完工记录标识',
      400,
      'PROCESS_COMPLETION_WITHDRAWAL_TARGET_REQUIRED',
    );
  }
  const { state, releaseMovements, triggeredCoverages } = await loadState(prisma, routeId, completionId);
  return previewFromState(state, releaseMovements, triggeredCoverages);
}

async function withdrawalReviewerUserIds(
  tx: Prisma.TransactionClient,
  workOrderId: string,
  requesterUserId: string,
): Promise<string[]> {
  const candidateIds = await eligibleUserIdsForCapability(
    tx,
    'PRODUCTION',
    'UPDATE',
    { excludeUserIds: [requesterUserId] },
  );
  if (!candidateIds.length) return [];
  const now = new Date();
  const [workOrder, candidates] = await Promise.all([
    tx.workOrder.findUnique({
      where: { id: workOrderId },
      select: {
        dailyProcessTasks: {
          where: { status: { not: DailyProcessTaskStatus.CANCELLED } },
          select: {
            plan: {
              select: {
                team: { select: { id: true, code: true, name: true, legacyTeamName: true } },
              },
            },
          },
        },
      },
    }),
    tx.user.findMany({
      where: { id: { in: candidateIds } },
      select: {
        id: true,
        laborRole: true,
        accessGrants: {
          where: {
            isActive: true,
            effectiveFrom: { lte: now },
            OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }],
          },
          select: {
            profile: true,
            scopeKey: true,
            department: { select: { code: true } },
          },
        },
        employee: {
          select: {
            productionPlanningMemberships: {
              where: {
                isActive: true,
                effectiveFrom: { lte: now },
                OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }],
              },
              select: { role: true, teamId: true },
            },
          },
        },
      },
    }),
  ]);
  const allowedTeamKeys = new Set(
    (workOrder?.dailyProcessTasks || []).flatMap(task => {
      const team = task.plan.team;
      return [team.id, team.code, team.name, team.legacyTeamName]
        .filter((value): value is string => Boolean(value))
        .map(value => value.toLocaleLowerCase('zh-CN'));
    }),
  );
  return candidates.filter(candidate => {
    if (candidate.laborRole === 'ADMIN') return true;
    const memberships = candidate.employee?.productionPlanningMemberships || [];
    if (memberships.some(item => item.role === 'WORKSHOP_SUPERVISOR')) return true;
    if (candidate.accessGrants.some(grant => (
      grant.profile === 'ADMIN_GLOBAL'
      || grant.profile === 'WORKSHOP_SUPERVISOR'
      || grant.profile === 'PRODUCTION_COLLABORATOR'
      || (grant.profile === 'DEPARTMENT_FULL' && grant.department?.code === 'PRODUCTION')
    ))) return true;
    const teamKeys = [
      ...candidate.accessGrants
        .map(grant => grant.scopeKey)
        .filter(scopeKey => scopeKey.toUpperCase().startsWith('TEAM:'))
        .map(scopeKey => scopeKey.slice(scopeKey.indexOf(':') + 1)),
      ...memberships
        .filter(item => item.role === 'TEAM_LEADER')
        .map(item => item.teamId)
        .filter((teamId): teamId is string => Boolean(teamId)),
    ];
    return teamKeys.some(key => allowedTeamKeys.has(key.toLocaleLowerCase('zh-CN')));
  }).map(candidate => candidate.id);
}

async function completeWithdrawalApprovalNotifications(
  tx: Prisma.TransactionClient,
  requestId: string,
  reason: string,
  completedAt: Date,
): Promise<void> {
  await tx.systemNotificationRecipient.updateMany({
    where: {
      completedAt: null,
      notification: {
        sourceType: 'process_completion_withdrawal_request',
        sourceId: requestId,
      },
    },
    data: {
      completedAt,
      completionKind: 'SOURCE_RESOLVED',
      completionReason: reason.slice(0, 500),
    },
  });
}

async function notifyWithdrawalRequester(
  tx: Prisma.TransactionClient,
  input: {
    request: Pick<WithdrawalRequestRecord, 'id' | 'requesterUserId' | 'completionId' | 'workOrder' | 'step'>;
    status: ProcessCompletionWithdrawalRequestStatus;
    version: number;
    actorId: string;
    note?: string | null;
  },
): Promise<void> {
  const labels: Partial<Record<ProcessCompletionWithdrawalRequestStatus, string>> = {
    APPLIED: '已批准并完成冲销',
    REJECTED: '已驳回',
    BLOCKED: '审批复核后被安全校验阻止',
    STALE: '因报工或路线已变化而失效',
    CANCELLED: '已取消',
  };
  const label = labels[input.status];
  if (!label) return;
  const ticket = await tx.workOrderQrTicket.findUnique({
    where: { workOrderId: input.request.workOrder.id },
    select: { publicCode: true, status: true },
  });
  await createSystemNotification(tx, {
    eventType: `PROCESS_COMPLETION_WITHDRAWAL_REQUEST_${input.status}`,
    dedupeKey: `process-completion-withdrawal-request:${input.request.id}:${input.status}:v${input.version}`,
    category: 'SYSTEM',
    priority: input.status === ProcessCompletionWithdrawalRequestStatus.BLOCKED ? 'HIGH' : 'NORMAL',
    title: `报工撤回申请${label}`,
    body: `${input.request.workOrder.specification || input.request.workOrder.code} · ${input.request.step.processName}${input.note ? `；${input.note}` : ''}`,
    targetRoute: ticket && ticket.status === 'ACTIVE'
      ? `/field-report/${encodeURIComponent(ticket.publicCode)}`
      : '/home',
    sourceType: 'process_completion_withdrawal_request',
    sourceId: input.request.id,
    actorId: input.actorId,
    metadata: {
      requestId: input.request.id,
      completionId: input.request.completionId,
      status: input.status,
      version: input.version,
    },
    recipientUserIds: [input.request.requesterUserId],
  });
}

export async function createProcessCompletionWithdrawalRequest(input: {
  routeId: string;
  completionId: string;
  expectedRouteVersion: unknown;
  category?: unknown;
  reason?: unknown;
  idempotencyKey: unknown;
  userId: string;
  employeeId: string;
  actor: string;
}): Promise<ProcessCompletionWithdrawalRequestDto> {
  const routeId = text(input.routeId, 80);
  const completionId = text(input.completionId, 80);
  const employeeId = text(input.employeeId, 80);
  const reason = text(input.reason, 500) || null;
  const category = parseCategory(input.category ?? 'REPORTING_ERROR');
  const idempotencyKey = parseIdempotencyKey(input.idempotencyKey);
  const expectedRouteVersion = parseExpectedRouteVersion(input.expectedRouteVersion);
  if (!routeId || !completionId || !employeeId) {
    throw new ProcessCompletionWithdrawalError(
      '缺少路线、报工记录或员工标识',
      400,
      'PROCESS_COMPLETION_WITHDRAWAL_REQUEST_TARGET_REQUIRED',
    );
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await prisma.$transaction(async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`process-completion-withdrawal:${completionId}`}))`;
        const duplicate = await tx.processCompletionWithdrawalRequest.findUnique({
          where: { requestIdempotencyKey: idempotencyKey },
          include: withdrawalRequestInclude,
        });
        if (duplicate) {
          if (
            duplicate.routeId !== routeId
            || duplicate.completionId !== completionId
            || duplicate.requesterUserId !== input.userId
            || duplicate.requesterEmployeeId !== employeeId
          ) {
            throw new ProcessCompletionWithdrawalError(
              '请求标识已用于其他撤回申请',
              409,
              'PROCESS_COMPLETION_WITHDRAWAL_REQUEST_IDEMPOTENCY_CONFLICT',
            );
          }
          return serializeProcessCompletionWithdrawalRequest(duplicate);
        }

        const { state, releaseMovements, triggeredCoverages } = await loadState(tx, routeId, completionId);
        if (state.voidedAt) {
          throw new ProcessCompletionWithdrawalError(
            '该报工记录已经撤回，请刷新后核对',
            409,
            'PROCESS_COMPLETION_ALREADY_WITHDRAWN',
          );
        }
        const employeeParticipates = (
          state.principalEmployeeId === employeeId
          || state.createdById === input.userId
          || state.participants.some(participant => participant.employeeId === employeeId)
          || (state.laborPool?.claims || []).some(claim => claim.employeeId === employeeId)
        );
        if (!employeeParticipates) {
          throw new ProcessCompletionWithdrawalError(
            '只能为本人主报或本人参与的报工提交撤回申请',
            403,
            'PROCESS_COMPLETION_WITHDRAWAL_REQUEST_EMPLOYEE_FORBIDDEN',
          );
        }
        if (state.route.version !== expectedRouteVersion) {
          throw new ProcessCompletionWithdrawalError(
            '工艺路线已更新，请刷新影响预览后重试',
            409,
            'PROCESS_ROUTE_VERSION_CONFLICT',
          );
        }
        const active = await tx.processCompletionWithdrawalRequest.findFirst({
          where: { completionId, status: ProcessCompletionWithdrawalRequestStatus.PENDING },
          include: withdrawalRequestInclude,
        });
        if (active) {
          throw new ProcessCompletionWithdrawalError(
            active.requesterUserId === input.userId
              ? '该报工已有待审批撤回申请，请勿重复提交'
              : '该报工已有其他待审批撤回申请，请主管先处理',
            409,
            'PROCESS_COMPLETION_WITHDRAWAL_REQUEST_ALREADY_PENDING',
          );
        }

        const preview = previewFromState(state, releaseMovements, triggeredCoverages);
        const created = await tx.processCompletionWithdrawalRequest.create({
          data: {
            completionId,
            routeId,
            workOrderId: state.workOrderId,
            stepId: state.stepId,
            requesterUserId: input.userId,
            requesterEmployeeId: employeeId,
            category,
            reason,
            requestedRouteVersion: state.route.version,
            preview: preview as unknown as Prisma.InputJsonValue,
            requestIdempotencyKey: idempotencyKey,
          },
          include: withdrawalRequestInclude,
        });
        await tx.processRouteActivity.create({
          data: {
            routeId,
            stepId: state.stepId,
            action: 'request_process_completion_withdrawal',
            content: `${text(input.actor, 120) || '现场员工'}申请撤回${state.step.processName}报工`,
            actorId: input.userId,
            detail: {
              requestId: created.id,
              completionId,
              requestedRouteVersion: state.route.version,
              category,
              reason,
              idempotencyKey,
              canWithdrawAtRequest: preview.canWithdraw,
              blockers: preview.blockers,
            },
          },
        });
        await tx.operationLog.create({
          data: {
            userId: input.userId,
            action: 'request_process_completion_withdrawal',
            targetType: 'process_completion_withdrawal_request',
            targetId: created.id,
            detail: {
              routeId,
              workOrderId: state.workOrderId,
              stepId: state.stepId,
              completionId,
              category,
              reason,
              idempotencyKey,
              requestedRouteVersion: state.route.version,
            },
          },
        });
        const reviewerUserIds = await withdrawalReviewerUserIds(
          tx,
          state.workOrderId,
          input.userId,
        );
        await createSystemNotification(tx, {
          eventType: 'PROCESS_COMPLETION_WITHDRAWAL_REQUEST_PENDING',
          dedupeKey: `process-completion-withdrawal-request:${created.id}:PENDING:v${created.version}`,
          category: 'APPROVAL',
          priority: preview.canWithdraw ? 'NORMAL' : 'HIGH',
          title: `待审批报工撤回：${state.route.workOrder.specification || state.route.workOrder.code} · ${state.step.processName}`,
          body: reason || '员工未填写撤回说明；请按当前路线重新预览后审批。',
          targetRoute: `/workspace/workflows?withdrawalRequestId=${encodeURIComponent(created.id)}`,
          sourceType: 'process_completion_withdrawal_request',
          sourceId: created.id,
          actorId: input.userId,
          metadata: {
            requestId: created.id,
            completionId,
            routeId,
            requestedRouteVersion: state.route.version,
            canWithdrawAtRequest: preview.canWithdraw,
          },
          recipientUserIds: reviewerUserIds,
        });
        return serializeProcessCompletionWithdrawalRequest(created);
      }, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5_000,
        timeout: 15_000,
      });
    } catch (error) {
      if (
        attempt === 0
        && error instanceof Prisma.PrismaClientKnownRequestError
        && error.code === 'P2034'
      ) continue;
      throw error;
    }
  }
  throw new ProcessCompletionWithdrawalError(
    '撤回申请发生并发冲突，请刷新后重试',
    409,
    'PROCESS_COMPLETION_WITHDRAWAL_REQUEST_CONFLICT',
  );
}

export async function listProcessCompletionWithdrawalRequests(input: {
  status?: unknown;
  take?: unknown;
  cursor?: unknown;
  routeId?: unknown;
  completionId?: unknown;
  requesterUserId?: string;
  workOrderWhere?: Prisma.WorkOrderWhereInput;
} = {}): Promise<{ items: ProcessCompletionWithdrawalRequestDto[]; nextCursor: string | null }> {
  const status = parseWithdrawalRequestStatus(input.status);
  const parsedTake = Number(input.take);
  const take = Number.isSafeInteger(parsedTake) && parsedTake > 0
    ? Math.min(parsedTake, 100)
    : 50;
  const cursor = text(input.cursor, 80) || null;
  const routeId = text(input.routeId, 80) || null;
  const completionId = text(input.completionId, 80) || null;
  const records = await prisma.processCompletionWithdrawalRequest.findMany({
    where: {
      ...(status ? { status } : {}),
      ...(routeId ? { routeId } : {}),
      ...(completionId ? { completionId } : {}),
      ...(input.requesterUserId ? { requesterUserId: input.requesterUserId } : {}),
      ...(input.workOrderWhere ? { workOrder: input.workOrderWhere } : {}),
    },
    include: withdrawalRequestInclude,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    take: take + 1,
  });
  const hasMore = records.length > take;
  const page = hasMore ? records.slice(0, take) : records;
  return {
    items: page.map(serializeProcessCompletionWithdrawalRequest),
    nextCursor: hasMore ? page[page.length - 1]?.id || null : null,
  };
}

export async function getProcessCompletionWithdrawalRequest(input: {
  requestId: string;
  requesterUserId?: string;
  workOrderWhere?: Prisma.WorkOrderWhereInput;
}): Promise<{
  request: ProcessCompletionWithdrawalRequestDto;
  currentPreview: ProcessCompletionWithdrawalPreview | null;
}> {
  const requestId = text(input.requestId, 80);
  if (!requestId) {
    throw new ProcessCompletionWithdrawalError(
      '缺少撤回申请标识',
      400,
      'PROCESS_COMPLETION_WITHDRAWAL_REQUEST_ID_REQUIRED',
    );
  }
  const request = await prisma.processCompletionWithdrawalRequest.findFirst({
    where: {
      id: requestId,
      ...(input.requesterUserId ? { requesterUserId: input.requesterUserId } : {}),
      ...(input.workOrderWhere ? { workOrder: input.workOrderWhere } : {}),
    },
    include: withdrawalRequestInclude,
  });
  if (!request) {
    throw new ProcessCompletionWithdrawalError(
      '撤回申请不存在或无权查看',
      404,
      'PROCESS_COMPLETION_WITHDRAWAL_REQUEST_NOT_FOUND',
    );
  }
  const currentPreview = request.completion.voidedAt
    ? null
    : await previewProcessCompletionWithdrawal(request.routeId, request.completionId);
  return { request: serializeProcessCompletionWithdrawalRequest(request), currentPreview };
}

export async function cancelProcessCompletionWithdrawalRequest(input: {
  requestId: string;
  routeId: string;
  completionId: string;
  expectedVersion: unknown;
  idempotencyKey: unknown;
  userId: string;
  employeeId: string;
}): Promise<ProcessCompletionWithdrawalRequestDto> {
  const requestId = text(input.requestId, 80);
  const expectedVersion = parseExpectedRequestVersion(input.expectedVersion);
  const idempotencyKey = parseIdempotencyKey(input.idempotencyKey);
  if (!requestId) {
    throw new ProcessCompletionWithdrawalError(
      '缺少撤回申请标识',
      400,
      'PROCESS_COMPLETION_WITHDRAWAL_REQUEST_ID_REQUIRED',
    );
  }
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`process-completion-withdrawal-request:${requestId}`}))`;
    const request = await tx.processCompletionWithdrawalRequest.findUnique({
      where: { id: requestId },
      include: withdrawalRequestInclude,
    });
    if (
      !request
      || request.requesterUserId !== input.userId
      || request.requesterEmployeeId !== input.employeeId
      || request.routeId !== input.routeId
      || request.completionId !== input.completionId
    ) {
      throw new ProcessCompletionWithdrawalError(
        '撤回申请不存在或只能由申请人取消',
        404,
        'PROCESS_COMPLETION_WITHDRAWAL_REQUEST_NOT_FOUND',
      );
    }
    if (
      request.status === ProcessCompletionWithdrawalRequestStatus.CANCELLED
      && request.resolutionIdempotencyKey === idempotencyKey
    ) return serializeProcessCompletionWithdrawalRequest(request);
    if (request.status !== ProcessCompletionWithdrawalRequestStatus.PENDING) {
      throw new ProcessCompletionWithdrawalError(
        '该撤回申请已处理，不能再取消',
        409,
        'PROCESS_COMPLETION_WITHDRAWAL_REQUEST_NOT_PENDING',
      );
    }
    if (request.version !== expectedVersion) {
      throw new ProcessCompletionWithdrawalError(
        '撤回申请已变化，请刷新后重试',
        409,
        'PROCESS_COMPLETION_WITHDRAWAL_REQUEST_VERSION_CONFLICT',
      );
    }
    const now = new Date();
    const updated = await tx.processCompletionWithdrawalRequest.updateMany({
      where: { id: requestId, status: ProcessCompletionWithdrawalRequestStatus.PENDING, version: expectedVersion },
      data: {
        status: ProcessCompletionWithdrawalRequestStatus.CANCELLED,
        version: { increment: 1 },
        resolutionIdempotencyKey: idempotencyKey,
        cancelledAt: now,
        resultCode: 'CANCELLED_BY_REQUESTER',
      },
    });
    if (updated.count !== 1) {
      throw new ProcessCompletionWithdrawalError(
        '撤回申请已变化，请刷新后重试',
        409,
        'PROCESS_COMPLETION_WITHDRAWAL_REQUEST_VERSION_CONFLICT',
      );
    }
    await tx.operationLog.create({
      data: {
        userId: input.userId,
        action: 'cancel_process_completion_withdrawal_request',
        targetType: 'process_completion_withdrawal_request',
        targetId: requestId,
        detail: { completionId: request.completionId, routeId: request.routeId, idempotencyKey },
      },
    });
    await completeWithdrawalApprovalNotifications(tx, requestId, '申请人已取消撤回申请', now);
    const saved = await tx.processCompletionWithdrawalRequest.findUniqueOrThrow({
      where: { id: requestId },
      include: withdrawalRequestInclude,
    });
    await notifyWithdrawalRequester(tx, {
      request: saved,
      status: ProcessCompletionWithdrawalRequestStatus.CANCELLED,
      version: saved.version,
      actorId: input.userId,
    });
    return serializeProcessCompletionWithdrawalRequest(saved);
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    maxWait: 5_000,
    timeout: 15_000,
  });
}

function nextTaskStatus(step: WithdrawalState['route']['steps'][number], plannedQty: number) {
  if (step.status === 'completed' || step.status === 'skipped') {
    return { status: DailyProcessTaskStatus.COMPLETED, availableQty: 0 };
  }
  const availableQty = Math.min(plannedQty, Math.max(0, step.inputQty - step.processedQty));
  if (step.processedQty > 0) return { status: DailyProcessTaskStatus.IN_PROGRESS, availableQty };
  return {
    status: availableQty > 0
      ? DailyProcessTaskStatus.READY
      : DailyProcessTaskStatus.WAITING_UPSTREAM,
    availableQty,
  };
}

async function applyWithdrawal(
  tx: Prisma.TransactionClient,
  input: {
    state: WithdrawalState;
    releaseMovements: ReleaseMovementRecord[];
    triggeredCoverages: TriggeredCoverageRecord[];
    preview: ProcessCompletionWithdrawalPreview;
    reason: string;
    category: CompletionCorrectionCategory;
    idempotencyKey: string;
    userId: string;
    actor: string;
  },
): Promise<number> {
  const { state, preview } = input;
  const now = new Date();
  const rollbackPlan = buildWithdrawalRollbackPlan(
    state,
    input.releaseMovements,
    input.triggeredCoverages,
  );
  if (rollbackPlan.blockers.length) {
    throw new ProcessCompletionWithdrawalError(
      rollbackPlan.blockers[0].message,
      409,
      rollbackPlan.blockers[0].code,
    );
  }

  for (const channel of rollbackPlan.movementReversals) {
    for (const [index, plan] of channel.plans.entries()) {
        await tx.processQuantityMovement.create({
          data: {
            completionId: state.id,
            workOrderId: plan.original.workOrderId,
            sourceStepId: plan.original.sourceStepId,
            targetStepId: plan.original.targetStepId,
            branchWorkOrderId: plan.original.branchWorkOrderId,
            type: ProcessMovementType.REVERSAL,
            quantity: plan.quantity,
            sourceSequenceGroup: plan.original.sourceSequenceGroup,
            targetSequenceGroup: plan.original.targetSequenceGroup,
            reversalOfId: plan.original.id,
            idempotencyKey: `${input.idempotencyKey}:qty:${channel.sequenceGroup}:${channel.targetStepId || 'finished'}:${index}`.slice(0, 190),
          },
        });
    }
  }

  const changedCompletion = await tx.processCompletion.updateMany({
    where: { id: state.id, voidedAt: null },
    data: {
      voidedAt: now,
      voidedById: input.userId,
      voidReason: input.reason,
      coverageStatus: ProcessCompletionCoverageStatus.VOIDED,
      coverageUpdatedAt: now,
    },
  });
  if (changedCompletion.count !== 1) {
    throw new ProcessCompletionWithdrawalError(
      '该完工记录已被其他操作更新，请刷新后重试',
      409,
      'PROCESS_COMPLETION_WITHDRAWAL_CONFLICT',
    );
  }
  await voidWipCreditsForCompletion(tx, state.id, now);
  if (state.reportQuantityBasis === 'action') {
    await voidProcessActionConsumptionsForCompletion(tx, {
      completionId: state.id,
      userId: input.userId,
      reason: input.reason,
      now,
    });
    await materializeProcessActionConsumptions(tx, state.stepId);
  }
  if (state.supplementObligation) {
    const obligation = state.supplementObligation;
    const nextReportedQty = obligation.reportedQty - state.processedQty;
    const nextReportedUnitQty = obligation.reportedUnitQty - state.reportedUnitQty;
    const nextReportedGoodUnitQty = obligation.reportedGoodUnitQty - state.reportedGoodUnitQty;
    const nextReportedDefectUnitQty = obligation.reportedDefectUnitQty - state.reportedDefectUnitQty;
    if (
      nextReportedQty < 0
      || nextReportedUnitQty < 0
      || nextReportedGoodUnitQty < 0
      || nextReportedDefectUnitQty < 0
    ) {
      throw new ProcessCompletionWithdrawalError(
        '补充工序累计数量小于本次撤回数量，请先核对补充报工台账',
        409,
        'PROCESS_SUPPLEMENT_WITHDRAWAL_LEDGER_INVALID',
      );
    }
    const obligationUpdate = await tx.processSupplementObligation.updateMany({
      where: { id: obligation.id, version: obligation.version },
      data: {
        reportedQty: nextReportedQty,
        reportedUnitQty: nextReportedUnitQty,
        reportedGoodUnitQty: nextReportedGoodUnitQty,
        reportedDefectUnitQty: nextReportedDefectUnitQty,
        status: 'ACTIVE',
        fulfilledAt: null,
        lastReportedAt: now,
        version: { increment: 1 },
      },
    });
    if (obligationUpdate.count !== 1) {
      throw new ProcessCompletionWithdrawalError(
        '补充工序义务已变化，请刷新后重试',
        409,
        'PROCESS_SUPPLEMENT_VERSION_CONFLICT',
      );
    }
    await tx.workOrderProcessStep.update({
      where: { id: state.stepId },
      data: {
        status: 'current',
        startedAt: state.step.startedAt || now,
        completedAt: null,
        completedById: null,
        quantityVersion: { increment: 1 },
      },
    });
    state.step.status = 'current';
    state.step.completedAt = null;
  }

  await tx.processCompletionCoverage.updateMany({
    where: {
      voidedAt: null,
      OR: [
        { reportCompletionId: state.id },
        ...(rollbackPlan.coverageAllocationIds.length
          ? [{ id: { in: rollbackPlan.coverageAllocationIds } }]
          : []),
      ],
    },
    data: { voidedAt: now },
  });

  for (const completion of rollbackPlan.completionCoverages) {
    const nextCoveredQty = completion.currentCoveredQty - completion.quantity;
    const nextCoveredGoodQty = completion.currentCoveredGoodQty - completion.goodQty;
    const nextCoveredDefectQty = completion.currentCoveredDefectQty - completion.defectQty;
    const coverageStatus = nextCoveredQty <= 0
      ? ProcessCompletionCoverageStatus.PENDING
      : nextCoveredQty < completion.processedQty
        ? ProcessCompletionCoverageStatus.PARTIAL
        : ProcessCompletionCoverageStatus.COVERED;
    const updated = await tx.processCompletion.updateMany({
      where: {
        id: completion.completionId,
        voidedAt: null,
        coveredQty: completion.currentCoveredQty,
        coveredGoodQty: completion.currentCoveredGoodQty,
        coveredDefectQty: completion.currentCoveredDefectQty,
      },
      data: {
        coveredQty: nextCoveredQty,
        coveredGoodQty: nextCoveredGoodQty,
        coveredDefectQty: nextCoveredDefectQty,
        coverageStatus,
        coverageUpdatedAt: now,
      },
    });
    if (updated.count !== 1) {
      throw new ProcessCompletionWithdrawalError(
        '下道提前报工的核销数量已变化，请刷新后重试',
        409,
        'PROCESS_COMPLETION_COVERAGE_CONFLICT',
      );
    }
  }

  for (const plan of rollbackPlan.steps) {
    const step = state.route.steps.find(item => item.id === plan.stepId);
    if (!step) continue;
    const changed = plan.inputReduction > 0
      || plan.processedReduction > 0
      || plan.releaseReduction > 0;
    if (!changed) continue;
    const update = await tx.workOrderProcessStep.updateMany({
      where: {
        id: step.id,
        quantityVersion: step.quantityVersion,
        inputQty: step.inputQty,
        processedQty: step.processedQty,
        goodOutputQty: step.goodOutputQty,
        defectOutputQty: step.defectOutputQty,
        releasedGoodQty: step.releasedGoodQty,
      },
      data: {
        inputQty: plan.nextInputQty,
        processedQty: plan.nextProcessedQty,
        goodOutputQty: plan.nextGoodOutputQty,
        defectOutputQty: plan.nextDefectOutputQty,
        releasedGoodQty: plan.nextReleasedGoodQty,
        quantityVersion: { increment: 1 },
      },
    });
    if (update.count !== 1) {
      throw new ProcessCompletionWithdrawalError(
        `${step.processName} 数量已变化，请刷新后重试`,
        409,
        'PROCESS_STEP_QUANTITY_CONFLICT',
      );
    }
    step.inputQty = plan.nextInputQty;
    step.processedQty = plan.nextProcessedQty;
    step.goodOutputQty = plan.nextGoodOutputQty;
    step.defectOutputQty = plan.nextDefectOutputQty;
    step.releasedGoodQty = plan.nextReleasedGoodQty;
    step.quantityVersion += 1;
  }

  const groups = [...new Set(state.route.steps.map(step => step.sequenceGroup))].sort((a, b) => a - b);
  let priorClosed = true;
  for (const group of groups) {
    const steps = state.route.steps.filter(step => step.sequenceGroup === group);
    const groupClosed: boolean = priorClosed
      && steps.every(step => (
        step.executionMode === 'SUPPLEMENTAL_OBLIGATION'
          ? step.status === 'completed' || step.status === 'skipped'
          : step.processedQty >= step.inputQty
      ));
    for (const step of steps) {
      // Supplemental obligations keep an independent ledger and must remain a
      // lifecycle gate without participating in ordinary quantity rollback.
      if (step.executionMode === 'SUPPLEMENTAL_OBLIGATION') continue;
      let status: string;
      if (groupClosed) status = step.inputQty > 0 ? 'completed' : 'skipped';
      else if (step.processedQty >= step.inputQty && step.inputQty > 0 && step.id !== state.stepId) status = 'completed';
      else if (priorClosed && step.inputQty > step.processedQty) status = 'current';
      else if (step.processedQty > 0) status = 'current';
      else status = 'pending';
      step.status = status;
      await tx.workOrderProcessStep.update({
        where: { id: step.id },
        data: {
          status,
          ...(status === 'completed' || status === 'skipped'
            ? { completedAt: step.completedAt || now }
            : {
                completedAt: null,
                completedById: null,
                ...(status === 'current'
                  ? { startedAt: step.startedAt || now }
                  : { startedAt: step.processedQty > 0 ? step.startedAt : null }),
              }),
        },
      });
    }
    priorClosed = groupClosed;
  }

  if (state.laborPool) {
    for (const [index, claim] of state.laborPool.claims.entries()) {
      await tx.processLaborClaim.update({
        where: { id: claim.id },
        data: {
          status: ProcessLaborClaimStatus.VOIDED,
          voidedAt: now,
          voidedById: input.userId,
          voidReason: input.reason,
        },
      });
      await tx.processLaborClaim.create({
        data: {
          poolId: claim.poolId,
          employeeId: claim.employeeId,
          quantity: -claim.quantity,
          standardLaborMilliseconds: -claim.standardLaborMilliseconds,
          workDate: claim.workDate,
          status: ProcessLaborClaimStatus.REVERSAL,
          source: 'completion_auto_reversal',
          idempotencyKey: `${input.idempotencyKey}:labor:${index}`.slice(0, 120),
          claimedById: input.userId,
          claimedAt: now,
          reversalOfId: claim.id,
        },
      });
    }
    await tx.processLaborPool.update({
      where: { id: state.laborPool.id },
      data: {
        claimedQty: 0,
        remainingQty: state.laborPool.eligibleQty,
        status: ProcessLaborPoolStatus.VOIDED,
        claimedStandardLaborMilliseconds: 0n,
        remainingStandardLaborMilliseconds: state.laborPool.totalStandardLaborMilliseconds,
        version: { increment: 1 },
        lockedAt: now,
      },
    });
  }

  let nextRouteVersion = state.route.version + 1;
  const routeUpdate = await tx.workOrderProcessRoute.updateMany({
    where: { id: state.routeId, version: state.route.version },
    data: { version: { increment: 1 }, status: 'in_progress', completedAt: null },
  });
  if (routeUpdate.count !== 1) {
    throw new ProcessCompletionWithdrawalError(
      '工艺路线已更新，请刷新后重试',
      409,
      'PROCESS_ROUTE_VERSION_CONFLICT',
    );
  }

  const latestPublishedProfile = state.route.routeSource === 'product_time_profile'
    && state.route.workOrder.drawingLibraryItemId
    ? await tx.productTimeProfile.findFirst({
        where: {
          drawingLibraryItemId: state.route.workOrder.drawingLibraryItemId,
          status: 'published',
        },
        orderBy: [{ version: 'desc' }, { publishedAt: 'desc' }],
        select: { id: true, version: true, drawingLibraryItemId: true },
      })
    : null;
  const productTimeRouteSync = latestPublishedProfile
    ? await syncProductTimeRouteFromPublishedProductTime(tx, {
        routeId: state.routeId,
        profileId: latestPublishedProfile.id,
        actorId: input.userId,
      })
    : null;
  if (productTimeRouteSync?.routeVersion !== null && productTimeRouteSync?.routeVersion !== undefined) {
    nextRouteVersion = productTimeRouteSync.routeVersion;
  }

  const order = state.route.workOrder;
  const target = targetQuantity(state);
  const currentCompleted = parseStoredQuantity(order.completedQty);
  const completedQty = Math.max(0, currentCompleted - preview.impact.workOrderCompletedReductionQty);
  const currentFrontend = Math.max(completedQty, Number(order.frontendTransferredQty || 0));
  const frontendTransferredQty = Math.max(
    completedQty,
    currentFrontend - preview.impact.frontendTransferReductionQty,
  );
  const stage: WorkOrderStage = completedQty >= target
    ? 'completed'
    : frontendTransferredQty >= target
      ? 'backend'
      : 'frontend';
  await tx.workOrder.update({
    where: { id: order.id },
    data: {
      stage,
      status: state.supplementObligationId ? 'processing' : legacyStatusForStage(stage),
      progress: state.supplementObligationId
        ? Math.min(99, order.progress)
        : Math.min(100, Math.round((completedQty / target) * 100)),
      completedQty: String(completedQty),
      frontendTransferredQty,
      executionVersion: { increment: 1 },
      completedAt: state.supplementObligationId ? null : stage === 'completed' ? order.completedAt : null,
      lastProgressAt: now,
      latestProgressRemark: `${state.step.processName}完工已撤回：${input.reason}`,
    },
  });
  await tx.workOrderProgressLog.create({
    data: {
      workOrderId: order.id,
      previousStage: order.stage,
      stage,
      completedQty: String(completedQty),
      productionOwner: order.productionOwner,
      workstation: order.workstation,
      remark: `${state.step.processName}完工撤回，数量与工时台账已同步冲销`,
      createdBy: input.actor,
    },
  });

  const tasks = await tx.dailyProcessTask.findMany({
    where: {
      routeId: state.routeId,
      plan: { workDate: state.workDate },
      status: { notIn: [
        DailyProcessTaskStatus.CARRIED_OVER,
        DailyProcessTaskStatus.CANCELLED,
        DailyProcessTaskStatus.NEEDS_REVIEW,
      ] },
    },
  });
  const stepById = new Map(state.route.steps.map(step => [step.id, step]));
  for (const task of tasks) {
    const step = stepById.get(task.stepId);
    if (!step) continue;
    const supplementReportedAfter = state.supplementObligationId === state.supplementObligation?.id
      && task.stepId === state.stepId
      ? Math.max(0, state.supplementObligation.reportedQty - state.processedQty)
      : null;
    const projected = supplementReportedAfter === null
      ? nextTaskStatus(step, task.plannedQty)
      : {
          status: supplementReportedAfter > 0
            ? DailyProcessTaskStatus.IN_PROGRESS
            : DailyProcessTaskStatus.READY,
          availableQty: Math.max(
            0,
            processSupplementActualRequiredQty(state.supplementObligation!) - supplementReportedAfter,
          ),
        };
    if (task.status === projected.status && task.availableQty === projected.availableQty) continue;
    await tx.dailyProcessTask.update({
      where: { id: task.id },
      data: {
        status: projected.status,
        availableQty: projected.availableQty,
        version: { increment: 1 },
      },
    });
    await tx.dailyPlanRevision.create({
      data: {
        planId: task.planId,
        taskId: task.id,
        action: 'PROCESS_COMPLETION_WITHDRAWAL',
        beforeData: { status: task.status, availableQty: task.availableQty },
        afterData: {
          status: projected.status,
          availableQty: projected.availableQty,
          completionId: state.id,
        },
        reason: input.reason,
        actorId: input.userId,
        idempotencyKey: `${input.idempotencyKey}:daily:${task.id}`.slice(0, 190),
      },
    });
  }

  const productTimeTaskSync = latestPublishedProfile
    ? await syncUnfinishedDailyTasksFromPublishedProductTime(tx, {
        drawingLibraryItemId: latestPublishedProfile.drawingLibraryItemId,
        profileId: latestPublishedProfile.id,
        profileVersion: latestPublishedProfile.version,
        actorId: input.userId,
        routeId: state.routeId,
        reason: `完工撤回后自动追平产品工序与工时 V${latestPublishedProfile.version}，同步日任务及人员计划工时`,
      })
    : null;

  await tx.processRouteActivity.create({
    data: {
      routeId: state.routeId,
      stepId: state.stepId,
      action: 'withdraw_process_completion',
      content: `${state.step.processName}完工已撤回，数量、工时及日计划已同步${productTimeRouteSync?.updated ? `，重新打开的工序已追平产品工时 V${latestPublishedProfile?.version}` : ''}`,
      actorId: input.userId,
      detail: {
        idempotencyKey: input.idempotencyKey,
        completionId: state.id,
        category: input.category,
        reason: input.reason,
        routeVersion: nextRouteVersion,
        impact: preview.impact,
        productTimeSync: latestPublishedProfile ? {
          profileId: latestPublishedProfile.id,
          profileVersion: latestPublishedProfile.version,
          routeUpdated: productTimeRouteSync?.updated || false,
          partiallyUpdated: productTimeRouteSync?.partiallyUpdated || false,
          reviewRequired: productTimeRouteSync?.reviewRequired || false,
          dailyTaskSynchronized: productTimeTaskSync?.synchronized || 0,
          dailyTaskReviewRequired: productTimeTaskSync?.reviewRequired || 0,
        } : null,
      },
    },
  });
  await tx.operationLog.create({
    data: {
      userId: input.userId,
      action: 'withdraw_process_completion',
      targetType: 'process_completion',
      targetId: state.id,
      detail: {
        routeId: state.routeId,
        workOrderId: state.workOrderId,
        stepId: state.stepId,
        category: input.category,
        reason: input.reason,
        routeVersion: nextRouteVersion,
        impact: preview.impact,
        productTimeProfileId: latestPublishedProfile?.id || null,
        productTimeProfileVersion: latestPublishedProfile?.version || null,
        productTimeRouteUpdated: productTimeRouteSync?.updated || false,
        dailyTaskSynchronized: productTimeTaskSync?.synchronized || 0,
      },
    },
  });
  return nextRouteVersion;
}

function withdrawalResultFromResolvedRequest(
  request: WithdrawalRequestRecord,
): WithdrawProcessCompletionResult | null {
  if (request.status !== ProcessCompletionWithdrawalRequestStatus.APPLIED) return null;
  if (!request.resultDetail || typeof request.resultDetail !== 'object' || Array.isArray(request.resultDetail)) {
    return null;
  }
  const detail = request.resultDetail as Record<string, unknown>;
  const routeVersion = Number(detail.routeVersion);
  const preview = detail.preview as ProcessCompletionWithdrawalPreview | undefined;
  if (!Number.isSafeInteger(routeVersion) || !preview || typeof preview !== 'object') return null;
  return {
    status: 'WITHDRAWN',
    completionId: request.completionId,
    routeVersion,
    preview,
    issue: null,
  };
}

export async function decideProcessCompletionWithdrawalRequest(input: {
  requestId: string;
  action: unknown;
  expectedVersion: unknown;
  expectedRouteVersion?: unknown;
  idempotencyKey: unknown;
  note?: unknown;
  userId: string;
  actor: string;
  workOrderWhere: Prisma.WorkOrderWhereInput;
}): Promise<ProcessCompletionWithdrawalRequestDecisionResult> {
  const requestId = text(input.requestId, 80);
  const action = input.action === 'APPROVE' || input.action === 'REJECT' ? input.action : null;
  const expectedVersion = parseExpectedRequestVersion(input.expectedVersion);
  const expectedRouteVersion = action === 'APPROVE'
    ? parseExpectedRouteVersion(input.expectedRouteVersion)
    : null;
  const idempotencyKey = parseIdempotencyKey(input.idempotencyKey);
  const note = text(input.note, 500) || null;
  if (!requestId) {
    throw new ProcessCompletionWithdrawalError(
      '缺少撤回申请标识',
      400,
      'PROCESS_COMPLETION_WITHDRAWAL_REQUEST_ID_REQUIRED',
    );
  }
  if (!action) {
    throw new ProcessCompletionWithdrawalError(
      '审批动作必须为 APPROVE 或 REJECT',
      400,
      'PROCESS_COMPLETION_WITHDRAWAL_REQUEST_ACTION_INVALID',
    );
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await prisma.$transaction(async tx => {
        const initial = await tx.processCompletionWithdrawalRequest.findUnique({
          where: { id: requestId },
          select: { completionId: true },
        });
        if (!initial) {
          throw new ProcessCompletionWithdrawalError(
            '撤回申请不存在',
            404,
            'PROCESS_COMPLETION_WITHDRAWAL_REQUEST_NOT_FOUND',
          );
        }
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`process-completion-withdrawal:${initial.completionId}`}))`;
        const request = await tx.processCompletionWithdrawalRequest.findUnique({
          where: { id: requestId },
          include: withdrawalRequestInclude,
        });
        if (!request) {
          throw new ProcessCompletionWithdrawalError(
            '撤回申请不存在',
            404,
            'PROCESS_COMPLETION_WITHDRAWAL_REQUEST_NOT_FOUND',
          );
        }
        const workOrderInScope = await tx.workOrder.findFirst({
          where: { id: request.workOrderId, deletedAt: null, ...input.workOrderWhere },
          select: { id: true },
        });
        if (!workOrderInScope) {
          throw new ProcessCompletionWithdrawalError(
            '该撤回申请不在当前账号的生产数据范围内',
            403,
            'PROCESS_COMPLETION_WITHDRAWAL_REQUEST_SCOPE_FORBIDDEN',
          );
        }

        if (request.resolutionIdempotencyKey === idempotencyKey) {
          const replayMatches = (
            action === 'REJECT'
              ? request.status === ProcessCompletionWithdrawalRequestStatus.REJECTED
              : new Set<ProcessCompletionWithdrawalRequestStatus>([
                  ProcessCompletionWithdrawalRequestStatus.APPLIED,
                  ProcessCompletionWithdrawalRequestStatus.BLOCKED,
                  ProcessCompletionWithdrawalRequestStatus.STALE,
                ]).has(request.status)
          );
          if (!replayMatches) {
            throw new ProcessCompletionWithdrawalError(
              '请求标识已用于不同的申请处理动作',
              409,
              'PROCESS_COMPLETION_WITHDRAWAL_REQUEST_IDEMPOTENCY_CONFLICT',
            );
          }
          return {
            status: request.status as ProcessCompletionWithdrawalRequestDecisionResult['status'],
            request: serializeProcessCompletionWithdrawalRequest(request),
            withdrawal: withdrawalResultFromResolvedRequest(request),
          };
        }
        const duplicateResolution = await tx.processCompletionWithdrawalRequest.findUnique({
          where: { resolutionIdempotencyKey: idempotencyKey },
          select: { id: true },
        });
        if (duplicateResolution) {
          throw new ProcessCompletionWithdrawalError(
            '请求标识已用于其他撤回申请处理',
            409,
            'PROCESS_COMPLETION_WITHDRAWAL_REQUEST_IDEMPOTENCY_CONFLICT',
          );
        }
        if (request.status !== ProcessCompletionWithdrawalRequestStatus.PENDING) {
          throw new ProcessCompletionWithdrawalError(
            '该撤回申请已处理，请刷新后核对',
            409,
            'PROCESS_COMPLETION_WITHDRAWAL_REQUEST_NOT_PENDING',
          );
        }
        if (request.version !== expectedVersion) {
          throw new ProcessCompletionWithdrawalError(
            '撤回申请已变化，请刷新后重试',
            409,
            'PROCESS_COMPLETION_WITHDRAWAL_REQUEST_VERSION_CONFLICT',
          );
        }

        const now = new Date();
        if (action === 'REJECT') {
          const rejected = await tx.processCompletionWithdrawalRequest.updateMany({
            where: { id: requestId, status: ProcessCompletionWithdrawalRequestStatus.PENDING, version: expectedVersion },
            data: {
              status: ProcessCompletionWithdrawalRequestStatus.REJECTED,
              version: { increment: 1 },
              resolutionIdempotencyKey: idempotencyKey,
              decidedById: input.userId,
              decidedAt: now,
              decisionNote: note,
              resultCode: 'REJECTED_BY_REVIEWER',
            },
          });
          if (rejected.count !== 1) {
            throw new ProcessCompletionWithdrawalError(
              '撤回申请已变化，请刷新后重试',
              409,
              'PROCESS_COMPLETION_WITHDRAWAL_REQUEST_VERSION_CONFLICT',
            );
          }
          await tx.operationLog.create({
            data: {
              userId: input.userId,
              action: 'reject_process_completion_withdrawal_request',
              targetType: 'process_completion_withdrawal_request',
              targetId: requestId,
              detail: {
                completionId: request.completionId,
                routeId: request.routeId,
                note,
                idempotencyKey,
              },
            },
          });
          await completeWithdrawalApprovalNotifications(tx, requestId, '撤回申请已驳回', now);
          const saved = await tx.processCompletionWithdrawalRequest.findUniqueOrThrow({
            where: { id: requestId },
            include: withdrawalRequestInclude,
          });
          await notifyWithdrawalRequester(tx, {
            request: saved,
            status: ProcessCompletionWithdrawalRequestStatus.REJECTED,
            version: saved.version,
            actorId: input.userId,
            note,
          });
          return {
            status: 'REJECTED',
            request: serializeProcessCompletionWithdrawalRequest(saved),
            withdrawal: null,
          };
        }

        const loaded = await loadState(tx, request.routeId, request.completionId);
        const currentPreview = previewFromState(
          loaded.state,
          loaded.releaseMovements,
          loaded.triggeredCoverages,
        );
        const staleCode = loaded.state.voidedAt
          ? 'PROCESS_COMPLETION_ALREADY_WITHDRAWN'
          : (
              loaded.state.route.version !== expectedRouteVersion
              || loaded.state.route.version !== request.requestedRouteVersion
            )
            ? 'PROCESS_ROUTE_VERSION_CONFLICT'
            : null;
        if (staleCode) {
          const stale = await tx.processCompletionWithdrawalRequest.updateMany({
            where: { id: requestId, status: ProcessCompletionWithdrawalRequestStatus.PENDING, version: expectedVersion },
            data: {
              status: ProcessCompletionWithdrawalRequestStatus.STALE,
              version: { increment: 1 },
              resolutionIdempotencyKey: idempotencyKey,
              decidedById: input.userId,
              decidedAt: now,
              decisionNote: note,
              resultCode: staleCode,
              resultDetail: {
                requestedRouteVersion: request.requestedRouteVersion,
                expectedRouteVersion,
                currentRouteVersion: loaded.state.route.version,
                preview: currentPreview as unknown as Prisma.InputJsonValue,
              },
            },
          });
          if (stale.count !== 1) {
            throw new ProcessCompletionWithdrawalError(
              '撤回申请已变化，请刷新后重试',
              409,
              'PROCESS_COMPLETION_WITHDRAWAL_REQUEST_VERSION_CONFLICT',
            );
          }
          await tx.operationLog.create({
            data: {
              userId: input.userId,
              action: 'stale_process_completion_withdrawal_request',
              targetType: 'process_completion_withdrawal_request',
              targetId: requestId,
              detail: {
                completionId: request.completionId,
                routeId: request.routeId,
                requestedRouteVersion: request.requestedRouteVersion,
                expectedRouteVersion,
                currentRouteVersion: loaded.state.route.version,
                resultCode: staleCode,
                idempotencyKey,
              },
            },
          });
          await completeWithdrawalApprovalNotifications(tx, requestId, '撤回申请已失效', now);
          const saved = await tx.processCompletionWithdrawalRequest.findUniqueOrThrow({
            where: { id: requestId },
            include: withdrawalRequestInclude,
          });
          await notifyWithdrawalRequester(tx, {
            request: saved,
            status: ProcessCompletionWithdrawalRequestStatus.STALE,
            version: saved.version,
            actorId: input.userId,
            note,
          });
          return {
            status: 'STALE',
            request: serializeProcessCompletionWithdrawalRequest(saved),
            withdrawal: null,
          };
        }

        if (!currentPreview.canWithdraw) {
          const blocked = await tx.processCompletionWithdrawalRequest.updateMany({
            where: { id: requestId, status: ProcessCompletionWithdrawalRequestStatus.PENDING, version: expectedVersion },
            data: {
              status: ProcessCompletionWithdrawalRequestStatus.BLOCKED,
              version: { increment: 1 },
              resolutionIdempotencyKey: idempotencyKey,
              decidedById: input.userId,
              decidedAt: now,
              decisionNote: note,
              resultCode: currentPreview.blockers[0]?.code || 'PROCESS_COMPLETION_WITHDRAWAL_BLOCKED',
              resultDetail: {
                blockers: currentPreview.blockers,
                preview: currentPreview as unknown as Prisma.InputJsonValue,
              },
            },
          });
          if (blocked.count !== 1) {
            throw new ProcessCompletionWithdrawalError(
              '撤回申请已变化，请刷新后重试',
              409,
              'PROCESS_COMPLETION_WITHDRAWAL_REQUEST_VERSION_CONFLICT',
            );
          }
          await tx.operationLog.create({
            data: {
              userId: input.userId,
              action: 'block_process_completion_withdrawal_request',
              targetType: 'process_completion_withdrawal_request',
              targetId: requestId,
              detail: {
                completionId: request.completionId,
                routeId: request.routeId,
                blockers: currentPreview.blockers,
                note,
                idempotencyKey,
              },
            },
          });
          await completeWithdrawalApprovalNotifications(tx, requestId, '撤回申请被安全校验阻止', now);
          const saved = await tx.processCompletionWithdrawalRequest.findUniqueOrThrow({
            where: { id: requestId },
            include: withdrawalRequestInclude,
          });
          await notifyWithdrawalRequester(tx, {
            request: saved,
            status: ProcessCompletionWithdrawalRequestStatus.BLOCKED,
            version: saved.version,
            actorId: input.userId,
            note: currentPreview.blockers.map(item => item.message).join('；'),
          });
          return {
            status: 'BLOCKED',
            request: serializeProcessCompletionWithdrawalRequest(saved),
            withdrawal: null,
          };
        }

        const category = request.category === 'PROCESS_EXCEPTION' ? 'PROCESS_EXCEPTION' : 'REPORTING_ERROR';
        const reason = [
          automaticWithdrawalAuditReason(category, loaded.state, currentPreview),
          ...(request.reason ? [`员工说明：${request.reason}`] : []),
          ...(note ? [`审批备注：${note}`] : []),
        ].join('；').slice(0, 500);
        const withdrawalIdempotencyKey = `withdrawal-request:${request.id}`.slice(0, 120);
        const routeVersion = await applyWithdrawal(tx, {
          state: loaded.state,
          releaseMovements: loaded.releaseMovements,
          triggeredCoverages: loaded.triggeredCoverages,
          preview: currentPreview,
          reason,
          category,
          idempotencyKey: withdrawalIdempotencyKey,
          userId: input.userId,
          actor: text(input.actor, 120) || input.userId,
        });
        const applied = await tx.processCompletionWithdrawalRequest.updateMany({
          where: { id: requestId, status: ProcessCompletionWithdrawalRequestStatus.PENDING, version: expectedVersion },
          data: {
            status: ProcessCompletionWithdrawalRequestStatus.APPLIED,
            version: { increment: 1 },
            resolutionIdempotencyKey: idempotencyKey,
            decidedById: input.userId,
            decidedAt: now,
            decisionNote: note,
            executedAt: now,
            resultCode: 'WITHDRAWAL_APPLIED',
            resultDetail: {
              routeVersion,
              withdrawalIdempotencyKey,
              preview: currentPreview as unknown as Prisma.InputJsonValue,
            },
          },
        });
        if (applied.count !== 1) {
          throw new ProcessCompletionWithdrawalError(
            '撤回申请已变化，数量与工时冲销已安全回滚，请刷新后重试',
            409,
            'PROCESS_COMPLETION_WITHDRAWAL_REQUEST_VERSION_CONFLICT',
          );
        }
        await tx.operationLog.create({
          data: {
            userId: input.userId,
            action: 'approve_process_completion_withdrawal_request',
            targetType: 'process_completion_withdrawal_request',
            targetId: requestId,
            detail: {
              completionId: request.completionId,
              routeId: request.routeId,
              routeVersion,
              note,
              idempotencyKey,
              withdrawalIdempotencyKey,
            },
          },
        });
        await completeWithdrawalApprovalNotifications(tx, requestId, '撤回申请已批准并完成冲销', now);
        const saved = await tx.processCompletionWithdrawalRequest.findUniqueOrThrow({
          where: { id: requestId },
          include: withdrawalRequestInclude,
        });
        await notifyWithdrawalRequester(tx, {
          request: saved,
          status: ProcessCompletionWithdrawalRequestStatus.APPLIED,
          version: saved.version,
          actorId: input.userId,
          note,
        });
        const withdrawal: WithdrawProcessCompletionResult = {
          status: 'WITHDRAWN',
          completionId: request.completionId,
          routeVersion,
          preview: currentPreview,
          issue: null,
        };
        return {
          status: 'APPLIED',
          request: serializeProcessCompletionWithdrawalRequest(saved),
          withdrawal,
        };
      }, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5_000,
        timeout: 20_000,
      });
    } catch (error) {
      if (
        attempt === 0
        && error instanceof Prisma.PrismaClientKnownRequestError
        && error.code === 'P2034'
      ) continue;
      throw error;
    }
  }
  throw new ProcessCompletionWithdrawalError(
    '撤回审批发生并发冲突，请刷新后重试',
    409,
    'PROCESS_COMPLETION_WITHDRAWAL_REQUEST_CONFLICT',
  );
}

function storedResult(
  detail: Prisma.JsonValue | null,
): { completionId: string; routeVersion: number } | null {
  if (!detail || typeof detail !== 'object' || Array.isArray(detail)) return null;
  const value = detail as Record<string, unknown>;
  if (typeof value.completionId !== 'string' || !Number.isSafeInteger(Number(value.routeVersion))) return null;
  return { completionId: value.completionId, routeVersion: Number(value.routeVersion) };
}

export async function withdrawProcessCompletion(
  command: WithdrawProcessCompletionCommand,
): Promise<WithdrawProcessCompletionResult> {
  const routeId = text(command.routeId, 80);
  const completionId = text(command.completionId, 80);
  const category = parseCategory(command.category);
  const idempotencyKey = parseIdempotencyKey(command.idempotencyKey);
  const expectedRouteVersion = parseExpectedRouteVersion(command.expectedRouteVersion);
  if (!routeId || !completionId) {
    throw new ProcessCompletionWithdrawalError(
      '缺少路线或完工记录标识',
      400,
      'PROCESS_COMPLETION_WITHDRAWAL_TARGET_REQUIRED',
    );
  }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await prisma.$transaction(async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`process-completion-withdrawal:${completionId}`}))`;
        const duplicate = await tx.processRouteActivity.findFirst({
          where: {
            routeId,
            action: { in: ['withdraw_process_completion', 'block_process_completion_withdrawal'] },
            detail: { path: ['idempotencyKey'], equals: idempotencyKey },
          },
          select: { action: true, detail: true },
          orderBy: { createdAt: 'desc' },
        });
        if (duplicate) {
          const replay = storedResult(duplicate.detail);
          if (!replay || replay.completionId !== completionId) {
            throw new ProcessCompletionWithdrawalError(
              '请求标识已用于其他撤回操作',
              409,
              'PROCESS_COMPLETION_WITHDRAWAL_IDEMPOTENCY_CONFLICT',
            );
          }
          const loaded = await loadState(tx, routeId, completionId);
          if (duplicate.action === 'block_process_completion_withdrawal') {
            return {
              status: 'BLOCKED' as const,
              completionId,
              routeVersion: replay.routeVersion,
              preview: previewFromState(
                loaded.state,
                loaded.releaseMovements,
                loaded.triggeredCoverages,
              ),
              issue: null,
            };
          }
          return {
            status: 'WITHDRAWN' as const,
            completionId,
            routeVersion: replay.routeVersion,
            preview: previewFromState(
              loaded.state,
              loaded.releaseMovements,
              loaded.triggeredCoverages,
            ),
            issue: null,
          };
        }

        const { state, releaseMovements, triggeredCoverages } = await loadState(
          tx,
          routeId,
          completionId,
        );
        if (state.route.version !== expectedRouteVersion) {
          throw new ProcessCompletionWithdrawalError(
            '工艺路线已更新，请刷新影响预览后重试',
            409,
            'PROCESS_ROUTE_VERSION_CONFLICT',
          );
        }
        const preview = previewFromState(state, releaseMovements, triggeredCoverages);
        const submittedReason = text(command.reason, 180);
        const reason = [
          automaticWithdrawalAuditReason(category, state, preview),
          ...(submittedReason ? [`现场说明：${submittedReason}`] : []),
        ].join('；').slice(0, 500);
        if (!preview.canWithdraw) {
          await tx.operationLog.create({
            data: {
              userId: command.userId,
              action: 'block_process_completion_withdrawal',
              targetType: 'process_completion',
              targetId: completionId,
              detail: {
                category,
                reason,
                blockers: preview.blockers,
                idempotencyKey,
              },
            },
          });
          await tx.processRouteActivity.create({
            data: {
              routeId,
              stepId: state.stepId,
              action: 'block_process_completion_withdrawal',
              content: '完工撤回被安全校验阻止，未修改数量或工时',
              actorId: command.userId,
              detail: {
                idempotencyKey,
                completionId,
                routeVersion: state.route.version,
                category,
                reason,
                blockers: preview.blockers,
              },
            },
          });
          return {
            status: 'BLOCKED' as const,
            completionId,
            routeVersion: state.route.version,
            preview,
            issue: null,
          };
        }
        const routeVersion = await applyWithdrawal(tx, {
          state,
          releaseMovements,
          triggeredCoverages,
          preview,
          reason,
          category,
          idempotencyKey,
          userId: command.userId,
          actor: text(command.actor, 120) || command.userId,
        });
        return {
          status: 'WITHDRAWN' as const,
          completionId,
          routeVersion,
          preview,
          issue: null,
        };
      }, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5_000,
        timeout: 20_000,
      });
    } catch (error) {
      if (
        attempt === 0
        && error instanceof Prisma.PrismaClientKnownRequestError
        && error.code === 'P2034'
      ) continue;
      if (error instanceof ProcessCompletionWithdrawalError) throw error;
      throw error;
    }
  }
  throw new ProcessCompletionWithdrawalError(
    '撤回事务发生并发冲突，请刷新后重试',
    409,
    'PROCESS_COMPLETION_WITHDRAWAL_CONFLICT',
  );
}
