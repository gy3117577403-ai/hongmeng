import {
  DailyProcessTaskStatus,
  Prisma,
  ProcessLaborClaimStatus,
  ProcessLaborPoolStatus,
  ProcessCompletionCoverageStatus,
  ProcessMovementType,
} from '@prisma/client';
import { dateKeyFromDatabase } from '@/lib/attendance';
import { issueCode } from '@/lib/issues';
import { prisma } from '@/lib/prisma';
import { syncProductTimeRouteFromPublishedProductTime } from '@/lib/process-routing';
import { syncUnfinishedDailyTasksFromPublishedProductTime } from '@/lib/product-time-task-sync';
import { legacyStatusForStage, type WorkOrderStage } from '@/lib/work-orders';
import {
  materializeProcessActionConsumptions,
  voidProcessActionConsumptionsForCompletion,
} from '@/lib/process-action-consumption';
import { processSupplementActualRequiredQty } from '@/lib/process-supplement-coverage';

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

async function createBlockedIssue(
  tx: Prisma.TransactionClient,
  input: {
    state: WithdrawalState;
    preview: ProcessCompletionWithdrawalPreview;
    category: CompletionCorrectionCategory;
    reason: string;
    userId: string;
  },
) {
  const primary = input.preview.blockers[0];
  const fingerprint = `process-completion-correction:${input.state.id}:${primary?.code || 'blocked'}`;
  const sourceRoute = `/workspace/workflows?${new URLSearchParams({
    entityType: 'production',
    workOrderId: input.state.workOrderId,
    stepId: input.state.stepId,
  }).toString()}`;
  const titlePrefix = input.category === 'REPORTING_ERROR' ? '报工错误' : '流程异常';
  let issue = await tx.issue.findUnique({ where: { sourceFingerprint: fingerprint } });
  if (!issue) {
    issue = await tx.issue.create({
      data: {
        title: `${titlePrefix}：${input.state.route.workOrder.specification || input.state.route.workOrder.code} · ${input.state.step.processName}`,
        type: 'production',
        priority: 'high',
        status: 'pending',
        description: `${input.reason}\n自动撤回被阻止：${input.preview.blockers.map(item => item.message).join('；')}`,
        sourceType: input.category === 'REPORTING_ERROR'
          ? 'process_reporting_error'
          : 'process_flow_exception',
        sourceId: input.state.id,
        sourceCode: input.state.route.workOrder.specification || input.state.route.workOrder.code,
        sourceRoute,
        sourceAlertCode: primary?.code || 'PROCESS_COMPLETION_WITHDRAWAL_BLOCKED',
        sourceFingerprint: fingerprint,
        workOrderId: input.state.workOrderId,
        reporterId: input.userId,
      },
    });
    await tx.issueActivity.create({
      data: {
        issueId: issue.id,
        action: 'create_from_process_correction',
        content: '完工撤回触发安全阻断，已转入问题闭环',
        actorId: input.userId,
        detail: { completionId: input.state.id, blockers: input.preview.blockers },
      },
    });
  } else if (issue.deletedAt) {
    issue = await tx.issue.update({
      where: { id: issue.id },
      data: { deletedAt: null, status: 'pending', reporterId: input.userId },
    });
  }
  return issue;
}

export async function requestProcessCompletionCorrection(input: {
  routeId: string;
  completionId: string;
  reason: unknown;
  idempotencyKey: unknown;
  userId: string;
  actor: string;
}): Promise<{ issue: { id: string; code: string }; completionId: string }> {
  const routeId = text(input.routeId, 80);
  const completionId = text(input.completionId, 80);
  const reason = text(input.reason, 500);
  const idempotencyKey = parseIdempotencyKey(input.idempotencyKey);
  if (!routeId || !completionId) {
    throw new ProcessCompletionWithdrawalError(
      '缺少路线或报工记录标识',
      400,
      'PROCESS_COMPLETION_CORRECTION_TARGET_REQUIRED',
    );
  }
  const reasonText = reason || '未填写现场说明';
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`process-completion-correction:${completionId}`}))`;
    const { state } = await loadState(tx, routeId, completionId);
    if (state.voidedAt) {
      throw new ProcessCompletionWithdrawalError(
        '该报工记录已经撤回，请刷新后核对',
        409,
        'PROCESS_COMPLETION_ALREADY_WITHDRAWN',
      );
    }
    const fingerprint = `field-process-completion-correction:${completionId}`;
    const sourceRoute = `/workspace/workflows?${new URLSearchParams({
      entityType: 'production',
      workOrderId: state.workOrderId,
      stepId: state.stepId,
    }).toString()}`;
    let issue = await tx.issue.findUnique({ where: { sourceFingerprint: fingerprint } });
    if (!issue) {
      issue = await tx.issue.create({
        data: {
          title: `报工数量待核对：${state.route.workOrder.specification || state.route.workOrder.code} · ${state.step.processName}`,
          type: 'production',
          priority: 'high',
          status: 'pending',
          description: `现场员工报告该笔报工可能有误。\n报工数量：${completionQuantityDescription(state)}\n现场说明：${reasonText}`,
          sourceType: 'process_reporting_error',
          sourceId: state.id,
          sourceCode: state.route.workOrder.specification || state.route.workOrder.code,
          sourceRoute,
          sourceAlertCode: 'FIELD_REPORT_CORRECTION_REQUEST',
          sourceFingerprint: fingerprint,
          workOrderId: state.workOrderId,
          reporterId: input.userId,
        },
      });
      await tx.issueActivity.create({
        data: {
          issueId: issue.id,
          action: 'create_from_field_report_correction',
          content: `${text(input.actor, 120) || '现场员工'}申请核对报工数量：${reasonText}`.slice(0, 500),
          actorId: input.userId,
          detail: { completionId, routeId, idempotencyKey, reason },
        },
      });
    } else if (issue.deletedAt || issue.status === 'closed') {
      issue = await tx.issue.update({
        where: { id: issue.id },
        data: {
          deletedAt: null,
          status: 'pending',
          reporterId: input.userId,
          description: `现场员工再次报告该笔报工可能有误。\n报工数量：${completionQuantityDescription(state)}\n现场说明：${reasonText}`,
        },
      });
    }
    await tx.operationLog.create({
      data: {
        userId: input.userId,
        action: 'request_process_completion_correction',
        targetType: 'process_completion',
        targetId: completionId,
        detail: { routeId, issueId: issue.id, idempotencyKey, reason },
      },
    });
    return { issue: { id: issue.id, code: issueCode(issue.sequence) }, completionId };
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
            const detail = duplicate.detail && typeof duplicate.detail === 'object' && !Array.isArray(duplicate.detail)
              ? duplicate.detail as Record<string, unknown>
              : {};
            const issue = typeof detail.issueId === 'string'
              ? await tx.issue.findUnique({ where: { id: detail.issueId } })
              : null;
            return {
              status: 'BLOCKED' as const,
              completionId,
              routeVersion: replay.routeVersion,
              preview: previewFromState(
                loaded.state,
                loaded.releaseMovements,
                loaded.triggeredCoverages,
              ),
              issue: issue ? { id: issue.id, code: issueCode(issue.sequence) } : null,
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
          const issue = await createBlockedIssue(tx, {
            state,
            preview,
            category,
            reason,
            userId: command.userId,
          });
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
                issueId: issue.id,
                idempotencyKey,
              },
            },
          });
          await tx.processRouteActivity.create({
            data: {
              routeId,
              stepId: state.stepId,
              action: 'block_process_completion_withdrawal',
              content: '完工撤回被下游影响阻止，已转入问题闭环',
              actorId: command.userId,
              detail: {
                idempotencyKey,
                completionId,
                routeVersion: state.route.version,
                category,
                reason,
                blockers: preview.blockers,
                issueId: issue.id,
              },
            },
          });
          return {
            status: 'BLOCKED' as const,
            completionId,
            routeVersion: state.route.version,
            preview,
            issue: { id: issue.id, code: issueCode(issue.sequence) },
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
