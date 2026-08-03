import {
  DailyProcessTaskStatus,
  Prisma,
  ProcessLaborClaimStatus,
  ProcessLaborPoolStatus,
  ProcessMovementType,
} from '@prisma/client';
import { dateKeyFromDatabase } from '@/lib/attendance';
import { issueCode } from '@/lib/issues';
import { prisma } from '@/lib/prisma';
import { legacyStatusForStage, type WorkOrderStage } from '@/lib/work-orders';

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
  releaseReductionQty: number;
  affectedTargetStepCount: number;
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
  step: true,
  branchWorkOrder: { select: { id: true, code: true, branchStatus: true } },
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
      steps: { orderBy: [{ sequenceGroup: 'asc' }, { position: 'asc' }] },
    },
  },
});

type WithdrawalState = Prisma.ProcessCompletionGetPayload<{
  include: typeof withdrawalStateInclude;
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
    `主管完工撤回（${categoryLabel}）`,
    `工序：${state.step.processName}`,
    `完工数量：${preview.impact.processedQty}`,
    `回收转序：${preview.impact.releaseReductionQty}`,
    `冲销领取：${preview.impact.laborClaimedQty}`,
  ].join('；').slice(0, 500);
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
}): MovementReversalPlan[] {
  let remaining = input.requiredQty;
  const planned: MovementReversalPlan[] = [];
  const matching = input.movements
    .filter(movement => movement.targetStepId === input.targetStepId)
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
): Promise<{ state: WithdrawalState; releaseMovements: ReleaseMovementRecord[] }> {
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
  const releaseMovements = await db.processQuantityMovement.findMany({
    where: {
      workOrderId: state.workOrderId,
      sourceSequenceGroup: state.step.sequenceGroup,
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
  });
  return { state, releaseMovements };
}

function nextGroupSteps(state: WithdrawalState) {
  const groups = state.route.steps
    .map(step => step.sequenceGroup)
    .filter(group => group > state.step.sequenceGroup);
  if (!groups.length) return [];
  const group = Math.min(...groups);
  return state.route.steps.filter(step => step.sequenceGroup === group);
}

function previewFromState(
  state: WithdrawalState,
  releaseMovements: ReleaseMovementRecord[],
): ProcessCompletionWithdrawalPreview {
  const blockers: ProcessCompletionWithdrawalBlocker[] = [];
  const groupSteps = state.route.steps.filter(
    step => step.sequenceGroup === state.step.sequenceGroup,
  );
  const targetSteps = nextGroupSteps(state);
  const newGoodQuantities = groupSteps.map(step => (
    step.id === state.stepId ? step.goodOutputQty - state.goodQty : step.goodOutputQty
  ));
  const currentReleased = groupSteps.length
    ? Math.min(...groupSteps.map(step => step.releasedGoodQty))
    : 0;
  const nextReleasable = newGoodQuantities.length ? Math.min(...newGoodQuantities) : 0;
  const releaseReductionQty = Math.max(0, currentReleased - Math.max(0, nextReleasable));

  if (state.voidedAt) {
    blockers.push({ code: 'PROCESS_COMPLETION_ALREADY_WITHDRAWN', message: '该完工记录已经撤回' });
  }
  if (
    state.processedQty > state.step.processedQty
    || state.goodQty > state.step.goodOutputQty
    || state.defectQty > state.step.defectOutputQty
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
  if (state.defectQty > 0 || state.branchWorkOrder || branchMovement) {
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
  const downstreamProcessed = state.route.steps.filter(step => (
    step.sequenceGroup > state.step.sequenceGroup && step.processedQty > 0
  ));
  if (downstreamProcessed.length) {
    blockers.push({
      code: 'PROCESS_COMPLETION_DOWNSTREAM_PROCESSED',
      message: `下道已有 ${downstreamProcessed.length} 道工序报工，禁止自动回退`,
    });
  }
  for (const targetStep of targetSteps) {
    if (
      targetStep.inputQty < releaseReductionQty
      || targetStep.processedQty > targetStep.inputQty - releaseReductionQty
    ) {
      blockers.push({
        code: 'PROCESS_COMPLETION_TARGET_QUANTITY_CONFLICT',
        message: `${targetStep.processName} 的投入/已处理数量不允许回退 ${releaseReductionQty}`,
      });
    }
  }
  if (releaseReductionQty > 0) {
    const channels = targetSteps.length ? targetSteps.map(step => step.id) : [null];
    for (const targetStepId of channels) {
      try {
        planQuantityMovementReversals({
          movements: releaseMovements,
          targetStepId,
          requiredQty: releaseReductionQty,
        });
      } catch (error) {
        if (error instanceof ProcessCompletionWithdrawalError) {
          blockers.push({ code: error.code, message: error.message });
        } else {
          throw error;
        }
      }
    }
  }
  if (state.laborPool?.status === ProcessLaborPoolStatus.VOIDED) {
    blockers.push({
      code: 'PROCESS_COMPLETION_LABOR_POOL_ALREADY_VOIDED',
      message: '关联工时池已作废，需先核对工时台账',
    });
  }

  const claims = state.laborPool?.claims || [];
  const employeeNames = [...new Set(claims.map(claim => claim.employee.name))];
  const sourceStage = groupSteps[0]?.stageGroup || state.step.stageGroup;
  const targetStage = targetSteps[0]?.stageGroup || null;
  const frontendTransferReductionQty = sourceStage === 'frontend'
    && targetStage !== null
    && targetStage !== 'frontend'
    ? releaseReductionQty
    : 0;

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
      voidedAt: state.voidedAt?.toISOString() || null,
    },
    canWithdraw: blockers.length === 0,
    blockers,
    impact: {
      processedQty: state.processedQty,
      goodQty: state.goodQty,
      releaseReductionQty,
      affectedTargetStepCount: targetSteps.length,
      laborPoolId: state.laborPool?.id || null,
      laborClaimCount: claims.length,
      laborClaimedQty: claims.reduce((sum, claim) => sum + claim.quantity, 0),
      employeeNames,
      workOrderCompletedReductionQty: targetSteps.length ? 0 : releaseReductionQty,
      frontendTransferReductionQty,
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
  const { state, releaseMovements } = await loadState(prisma, routeId, completionId);
  return previewFromState(state, releaseMovements);
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
  const groupSteps = state.route.steps.filter(step => step.sequenceGroup === state.step.sequenceGroup);
  const targetSteps = nextGroupSteps(state);
  const releaseReductionQty = preview.impact.releaseReductionQty;

  if (releaseReductionQty > 0) {
    const channels = targetSteps.length ? targetSteps.map(step => step.id) : [null];
    for (const targetStepId of channels) {
      const plans = planQuantityMovementReversals({
        movements: input.releaseMovements,
        targetStepId,
        requiredQty: releaseReductionQty,
      });
      for (const [index, plan] of plans.entries()) {
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
            idempotencyKey: `${input.idempotencyKey}:qty:${targetStepId || 'finished'}:${index}`.slice(0, 190),
          },
        });
      }
    }
  }

  const changedCompletion = await tx.processCompletion.updateMany({
    where: { id: state.id, voidedAt: null },
    data: { voidedAt: now, voidedById: input.userId, voidReason: input.reason },
  });
  if (changedCompletion.count !== 1) {
    throw new ProcessCompletionWithdrawalError(
      '该完工记录已被其他操作更新，请刷新后重试',
      409,
      'PROCESS_COMPLETION_WITHDRAWAL_CONFLICT',
    );
  }

  state.step.processedQty -= state.processedQty;
  state.step.goodOutputQty -= state.goodQty;
  state.step.defectOutputQty -= state.defectQty;
  const routeSourceStep = groupSteps.find(step => step.id === state.stepId);
  if (!routeSourceStep) {
    throw new ProcessCompletionWithdrawalError(
      '完工工序已不在当前路线中',
      409,
      'PROCESS_COMPLETION_STEP_MISSING',
    );
  }
  routeSourceStep.processedQty -= state.processedQty;
  routeSourceStep.goodOutputQty -= state.goodQty;
  routeSourceStep.defectOutputQty -= state.defectQty;
  const nextReleased = Math.max(0, groupSteps[0].releasedGoodQty - releaseReductionQty);
  for (const step of groupSteps) step.releasedGoodQty = nextReleased;
  for (const targetStep of targetSteps) targetStep.inputQty -= releaseReductionQty;

  const sourceUpdate = await tx.workOrderProcessStep.updateMany({
    where: {
      id: state.step.id,
      quantityVersion: state.step.quantityVersion,
      processedQty: { gte: state.processedQty },
      goodOutputQty: { gte: state.goodQty },
      defectOutputQty: { gte: state.defectQty },
    },
    data: {
      processedQty: { decrement: state.processedQty },
      goodOutputQty: { decrement: state.goodQty },
      defectOutputQty: { decrement: state.defectQty },
      releasedGoodQty: nextReleased,
      quantityVersion: { increment: 1 },
    },
  });
  if (sourceUpdate.count !== 1) {
    throw new ProcessCompletionWithdrawalError(
      '当前工序数量已变化，请刷新后重试',
      409,
      'PROCESS_STEP_QUANTITY_CONFLICT',
    );
  }
  state.step.quantityVersion += 1;

  for (const groupStep of groupSteps) {
    if (groupStep.id === state.step.id) continue;
    const update = await tx.workOrderProcessStep.updateMany({
      where: { id: groupStep.id, quantityVersion: groupStep.quantityVersion },
      data: { releasedGoodQty: nextReleased, quantityVersion: { increment: 1 } },
    });
    if (update.count !== 1) {
      throw new ProcessCompletionWithdrawalError(
        '并行工序释放数量已变化，请刷新后重试',
        409,
        'PROCESS_STEP_QUANTITY_CONFLICT',
      );
    }
    groupStep.quantityVersion += 1;
  }
  for (const targetStep of targetSteps) {
    const update = await tx.workOrderProcessStep.updateMany({
      where: {
        id: targetStep.id,
        quantityVersion: targetStep.quantityVersion,
        inputQty: { gte: releaseReductionQty },
      },
      data: { inputQty: { decrement: releaseReductionQty }, quantityVersion: { increment: 1 } },
    });
    if (update.count !== 1) {
      throw new ProcessCompletionWithdrawalError(
        '下道工序投入数量已变化，请刷新后重试',
        409,
        'PROCESS_STEP_QUANTITY_CONFLICT',
      );
    }
    targetStep.quantityVersion += 1;
  }

  const groups = [...new Set(state.route.steps.map(step => step.sequenceGroup))].sort((a, b) => a - b);
  let priorClosed = true;
  for (const group of groups) {
    const steps = state.route.steps.filter(step => step.sequenceGroup === group);
    const groupClosed: boolean = priorClosed
      && steps.every(step => step.processedQty >= step.inputQty);
    for (const step of steps) {
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

  const nextRouteVersion = state.route.version + 1;
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
      status: legacyStatusForStage(stage),
      progress: Math.min(100, Math.round((completedQty / target) * 100)),
      completedQty: String(completedQty),
      frontendTransferredQty,
      executionVersion: { increment: 1 },
      completedAt: stage === 'completed' ? order.completedAt : null,
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
    const projected = nextTaskStatus(step, task.plannedQty);
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

  await tx.processRouteActivity.create({
    data: {
      routeId: state.routeId,
      stepId: state.stepId,
      action: 'withdraw_process_completion',
      content: `${state.step.processName}完工已撤回，数量、工时及日计划已同步`,
      actorId: input.userId,
      detail: {
        idempotencyKey: input.idempotencyKey,
        completionId: state.id,
        category: input.category,
        reason: input.reason,
        routeVersion: nextRouteVersion,
        impact: preview.impact,
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
              preview: previewFromState(loaded.state, loaded.releaseMovements),
              issue: issue ? { id: issue.id, code: issueCode(issue.sequence) } : null,
            };
          }
          return {
            status: 'WITHDRAWN' as const,
            completionId,
            routeVersion: replay.routeVersion,
            preview: previewFromState(loaded.state, loaded.releaseMovements),
            issue: null,
          };
        }

        const { state, releaseMovements } = await loadState(tx, routeId, completionId);
        if (state.route.version !== expectedRouteVersion) {
          throw new ProcessCompletionWithdrawalError(
            '工艺路线已更新，请刷新影响预览后重试',
            409,
            'PROCESS_ROUTE_VERSION_CONFLICT',
          );
        }
        const preview = previewFromState(state, releaseMovements);
        const reason = automaticWithdrawalAuditReason(category, state, preview);
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
