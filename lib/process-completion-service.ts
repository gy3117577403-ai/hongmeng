import { Prisma } from '@prisma/client';
import { dateKeyFromDatabase, parseWorkDate } from '@/lib/attendance';
import {
  calculateCompletionLaborSnapshot,
  calculateParallelGroupReleaseDelta,
  ProcessCompletionDomainError,
  resolveCompletionQuantities,
} from '@/lib/process-completion-domain';
import { prisma } from '@/lib/prisma';
import { normalizeProcessStageGroup, processStageForGroup } from '@/lib/process-routing';
import {
  compatibleStageForQuantities,
  resolveEffectiveFrontendTransferredQty,
} from '@/lib/production-stage-flow';
import {
  isActiveProductionWorkOrder,
  legacyStatusForStage,
  normalizeWorkOrderStage,
} from '@/lib/work-orders';

export class ProcessCompletionServiceError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status = 400, code = 'PROCESS_COMPLETION_INVALID') {
    super(message);
    this.name = 'ProcessCompletionServiceError';
    this.status = status;
    this.code = code;
  }
}

export const PROCESS_DEFECT_DISPOSITIONS = [
  'rework',
  'scrap_replenish',
  'quality_pending',
] as const;

export type ProcessDefectDispositionInput = (typeof PROCESS_DEFECT_DISPOSITIONS)[number];

export type CompleteProcessStepCommand = {
  routeId: string;
  stepId: unknown;
  processedQty: unknown;
  defectQty: unknown;
  defectDisposition?: unknown;
  workDate: unknown;
  idempotencyKey: unknown;
  expectedRouteVersion: unknown;
  userId: string;
  actor: string;
};

export type ProcessCompletionResult = {
  completionId: string;
  routeVersion: number;
  laborPoolId: string | null;
  laborPoolPendingStandard: boolean;
  branchWorkOrderId?: string;
  branchWorkOrderCode?: string;
  goodTransferredQty: number;
  remainingInputQty: number;
  routeCompleted: boolean;
};

export type ProcessCompletionContext = {
  routeId: string;
  routeVersion: number;
  step: {
    id: string;
    processName: string;
    sequenceGroup: number;
    status: string;
  };
  nextSteps: Array<{
    id: string;
    processName: string;
    sequenceGroup: number;
  }>;
  availableInputQty: number;
  processedQty: number;
  remainingInputQty: number;
  goodQty: number;
  defectQty: number;
  recentCompletions: Array<{
    id: string;
    processedQty: number;
    goodQty: number;
    defectQty: number;
    defectDisposition: ProcessDefectDispositionInput | null;
    workDate: string;
    completedAt: string;
    branchWorkOrder?: {
      id: string;
      code: string;
      branchType: string | null;
      branchStatus: string | null;
    };
  }>;
};

type ParsedCompletionCommand = {
  routeId: string;
  stepId: string;
  processedQty: number;
  defectQty: number;
  defectDisposition: ProcessDefectDispositionInput | null;
  databaseDefectDisposition: 'REWORK' | 'SCRAP_REPLENISH' | 'QUALITY_PENDING' | null;
  workDate: Date;
  workDateKey: string;
  idempotencyKey: string;
  expectedRouteVersion: number;
  userId: string;
  actor: string;
};

type QuantityStep = {
  id: string;
  processCode: string;
  processName: string;
  stageGroup: string;
  position: number;
  sequenceGroup: number;
  inputQty: number;
  processedQty: number;
  goodOutputQty: number;
  defectOutputQty: number;
  releasedGoodQty: number;
  quantityVersion: number;
  status: string;
  startedAt: Date | null;
  completedAt: Date | null;
  completedById: string | null;
};

type BranchSourceStep = QuantityStep & {
  processDefinitionId: string | null;
  standardTimeId: string | null;
  standardVersion: number | null;
  productTimeProfileId: string | null;
  productTimeEntryId: string | null;
  productTimeProfileVersion: number | null;
  standardSource: string;
  timeBasis: string | null;
  unitLabel: string | null;
  standardMillisecondsPerUnit: number | null;
  setupMilliseconds: number;
  unitsPerProduct: number;
  countsForEfficiency: boolean;
  remark: string | null;
};

const completionRouteInclude = Prisma.validator<Prisma.WorkOrderProcessRouteInclude>()({
  workOrder: true,
  steps: { orderBy: [{ sequenceGroup: 'asc' }, { position: 'asc' }] },
});

type CompletionRouteRecord = Prisma.WorkOrderProcessRouteGetPayload<{
  include: typeof completionRouteInclude;
}>;

const replayCompletionInclude = Prisma.validator<Prisma.ProcessCompletionInclude>()({
  laborPool: { select: { id: true, status: true, standardSource: true } },
  branchWorkOrder: { select: { id: true, code: true } },
  movements: {
    where: { voidedAt: null },
    select: { type: true, quantity: true },
  },
  route: { select: { status: true, version: true } },
  step: { select: { inputQty: true, processedQty: true } },
});

type ReplayCompletionRecord = Prisma.ProcessCompletionGetPayload<{
  include: typeof replayCompletionInclude;
}>;

type BranchRoutePlanStep<T> = T & {
  sourceStepId: string;
  position: number;
  sequenceGroup: number;
};

function cleanText(value: unknown, max: number): string {
  return String(value ?? '').trim().slice(0, max);
}

function safeNonnegativeInteger(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function parseStoredQuantity(value: unknown): number {
  const text = String(value ?? '').replace(/,/g, '').trim();
  const parsed = Number(text || 0);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function targetQuantity(order: Parameters<typeof resolveEffectiveFrontendTransferredQty>[0]): number {
  const resolution = resolveEffectiveFrontendTransferredQty(order);
  if (resolution.ok && resolution.state.targetQty > 0) return resolution.state.targetQty;
  const explicitTarget = Number(order.productionTargetQty);
  if (Number.isSafeInteger(explicitTarget) && explicitTarget > 0) return explicitTarget;
  const importedTarget = parseStoredQuantity(order.uncompletedQty);
  if (importedTarget > 0) return importedTarget;
  throw new ProcessCompletionServiceError(
    '当前工单没有有效的生产目标数量',
    409,
    'PROCESS_TARGET_QUANTITY_REQUIRED',
  );
}

export function resolveCompletedQuantityDelta(input: {
  previousCompletedQty: number;
  targetQty: number;
  finishedGoodDelta: number;
}): number {
  const values = [
    input.previousCompletedQty,
    input.targetQty,
    input.finishedGoodDelta,
  ];
  if (
    !values.every(Number.isSafeInteger)
    || input.previousCompletedQty < 0
    || input.targetQty <= 0
    || input.finishedGoodDelta < 0
  ) {
    throw new ProcessCompletionServiceError(
      '完成数量状态不正确',
      409,
      'PROCESS_COMPLETED_QTY_INVALID',
    );
  }
  const completedQty = input.previousCompletedQty + input.finishedGoodDelta;
  if (completedQty > input.targetQty) {
    throw new ProcessCompletionServiceError(
      `累计完成数量 ${completedQty} 不能超过目标 ${input.targetQty}`,
      409,
      'PROCESS_COMPLETED_QTY_EXCEEDS_TARGET',
    );
  }
  return completedQty;
}

export function calculateCappedParallelGroupRelease(input: {
  stepGoodOutputQuantities: readonly unknown[];
  alreadyReleasedQty: unknown;
  directRouteCap: unknown;
}) {
  const directRouteCap = Number(input.directRouteCap);
  if (!Number.isSafeInteger(directRouteCap) || directRouteCap < 0) {
    throw new ProcessCompletionServiceError(
      '工单正常路线可释放上限不正确',
      409,
      'PROCESS_DIRECT_ROUTE_CAP_INVALID',
    );
  }
  const uncapped = calculateParallelGroupReleaseDelta({
    stepGoodOutputQuantities: input.stepGoodOutputQuantities,
    alreadyReleasedQty: input.alreadyReleasedQty,
  });
  if (uncapped.alreadyReleasedQty > directRouteCap) {
    throw new ProcessCompletionServiceError(
      `补产预留后正常路线最多可释放 ${directRouteCap}，低于已释放数量 ${uncapped.alreadyReleasedQty}`,
      409,
      'PROCESS_SCRAP_RESERVATION_BELOW_RELEASED',
    );
  }
  const releasableGoodQty = Math.min(uncapped.releasableGoodQty, directRouteCap);
  return {
    releasableGoodQty,
    alreadyReleasedQty: uncapped.alreadyReleasedQty,
    releaseDeltaQty: releasableGoodQty - uncapped.alreadyReleasedQty,
  };
}

function parseExpectedRouteVersion(value: unknown): number {
  const version = Number(value);
  if (!Number.isInteger(version) || version < 0) {
    throw new ProcessCompletionServiceError(
      '工艺路线版本不正确，请刷新后重试',
      400,
      'INVALID_PROCESS_ROUTE_VERSION',
    );
  }
  return version;
}

function parseIdempotencyKey(value: unknown): string {
  const key = cleanText(value, 120);
  if (key.length < 8) {
    throw new ProcessCompletionServiceError(
      '请求标识无效，请重新提交',
      400,
      'PROCESS_COMPLETION_IDEMPOTENCY_INVALID',
    );
  }
  return key;
}

function parseDefectDisposition(
  value: unknown,
  defectQty: number,
): {
  input: ProcessDefectDispositionInput | null;
  database: 'REWORK' | 'SCRAP_REPLENISH' | 'QUALITY_PENDING' | null;
} {
  const normalized = cleanText(value, 40).toLowerCase();
  if (defectQty === 0) {
    if (normalized && !PROCESS_DEFECT_DISPOSITIONS.includes(normalized as ProcessDefectDispositionInput)) {
      throw new ProcessCompletionServiceError(
        '不良品处置方式不正确',
        400,
        'PROCESS_DEFECT_DISPOSITION_INVALID',
      );
    }
    return { input: null, database: null };
  }
  if (normalized === 'quality_pending') {
    throw new ProcessCompletionServiceError(
      '质量待判分支尚未开放判定闭环，请选择返工或报废补产',
      409,
      'PROCESS_QUALITY_PENDING_NOT_AVAILABLE',
    );
  }
  if (!PROCESS_DEFECT_DISPOSITIONS.includes(normalized as ProcessDefectDispositionInput)) {
    throw new ProcessCompletionServiceError(
      '存在不良品时必须选择返工或报废补产',
      400,
      'PROCESS_DEFECT_DISPOSITION_REQUIRED',
    );
  }
  const input = normalized as ProcessDefectDispositionInput;
  return {
    input,
    database: input === 'rework'
      ? 'REWORK'
      : input === 'scrap_replenish'
        ? 'SCRAP_REPLENISH'
        : 'QUALITY_PENDING',
  };
}

export function parseProcessCompletionCommand(
  command: CompleteProcessStepCommand,
): ParsedCompletionCommand {
  const routeId = cleanText(command.routeId, 80);
  const stepId = cleanText(command.stepId, 80);
  const processedQty = Number(command.processedQty);
  const defectQty = Number(command.defectQty ?? 0);
  if (!routeId) {
    throw new ProcessCompletionServiceError('工艺路线不能为空', 400, 'PROCESS_ROUTE_REQUIRED');
  }
  if (!stepId) {
    throw new ProcessCompletionServiceError('请选择当前工序', 400, 'PROCESS_STEP_REQUIRED');
  }
  if (!Number.isSafeInteger(processedQty) || processedQty <= 0) {
    throw new ProcessCompletionServiceError(
      '本次完成数量必须是正整数',
      400,
      'INVALID_PROCESSED_QTY',
    );
  }
  if (!Number.isSafeInteger(defectQty) || defectQty < 0) {
    throw new ProcessCompletionServiceError(
      '本次不良品数量必须是非负整数',
      400,
      'INVALID_DEFECT_QTY',
    );
  }
  if (defectQty > processedQty) {
    throw new ProcessCompletionServiceError(
      '不良品数量不能超过本次完成数量',
      400,
      'DEFECT_QTY_EXCEEDS_PROCESSED',
    );
  }
  const disposition = parseDefectDisposition(command.defectDisposition, defectQty);
  let parsedWorkDate: ReturnType<typeof parseWorkDate>;
  try {
    parsedWorkDate = parseWorkDate(command.workDate);
  } catch {
    throw new ProcessCompletionServiceError(
      '生产日期必须是有效的 YYYY-MM-DD 日期',
      400,
      'PROCESS_COMPLETION_WORK_DATE_INVALID',
    );
  }
  const userId = cleanText(command.userId, 80);
  if (!userId) {
    throw new ProcessCompletionServiceError('登录状态已失效', 401, 'PROCESS_COMPLETION_USER_REQUIRED');
  }
  return {
    routeId,
    stepId,
    processedQty,
    defectQty,
    defectDisposition: disposition.input,
    databaseDefectDisposition: disposition.database,
    workDate: parsedWorkDate.value,
    workDateKey: parsedWorkDate.key,
    idempotencyKey: parseIdempotencyKey(command.idempotencyKey),
    expectedRouteVersion: parseExpectedRouteVersion(command.expectedRouteVersion),
    userId,
    actor: cleanText(command.actor, 120) || userId,
  };
}

function firstSequenceGroup(steps: Array<Pick<QuantityStep, 'sequenceGroup'>>): number | null {
  return steps.length ? Math.min(...steps.map(step => step.sequenceGroup)) : null;
}

function nextSequenceGroupSteps<T extends { sequenceGroup: number; position: number }>(
  steps: T[],
  sequenceGroup: number,
): T[] {
  const futureGroups = steps
    .map(step => step.sequenceGroup)
    .filter(group => group > sequenceGroup);
  if (!futureGroups.length) return [];
  const nextGroup = Math.min(...futureGroups);
  return steps
    .filter(step => step.sequenceGroup === nextGroup)
    .sort((left, right) => left.position - right.position);
}

function effectiveInputQuantity(
  step: Pick<QuantityStep, 'sequenceGroup' | 'inputQty'>,
  firstGroup: number | null,
  target: number,
): number {
  return step.sequenceGroup === firstGroup ? Math.max(step.inputQty, target) : step.inputQty;
}

export function planDefectBranchRoute<T extends {
  id: string;
  position: number;
  sequenceGroup: number;
}>(
  steps: readonly T[],
  currentStepId: string,
  disposition: ProcessDefectDispositionInput,
): Array<BranchRoutePlanStep<T>> {
  const sorted = [...steps].sort((left, right) => (
    left.sequenceGroup - right.sequenceGroup || left.position - right.position
  ));
  const current = sorted.find(step => step.id === currentStepId);
  if (!current) {
    throw new ProcessCompletionServiceError(
      '当前工序不存在',
      404,
      'PROCESS_STEP_NOT_FOUND',
    );
  }
  const selected = disposition === 'scrap_replenish'
    ? sorted
    : disposition === 'rework'
      ? [current]
      : sorted.filter(step => step.id === current.id || step.sequenceGroup > current.sequenceGroup);
  const groupMap = new Map<number, number>();
  for (const step of selected) {
    if (!groupMap.has(step.sequenceGroup)) groupMap.set(step.sequenceGroup, groupMap.size + 1);
  }
  return selected.map((step, index) => ({
    ...step,
    sourceStepId: step.id,
    position: index + 1,
    sequenceGroup: groupMap.get(step.sequenceGroup) || 1,
  }));
}

function lowercaseDisposition(value: string | null): ProcessDefectDispositionInput | null {
  if (value === 'REWORK') return 'rework';
  if (value === 'SCRAP_REPLENISH') return 'scrap_replenish';
  if (value === 'QUALITY_PENDING') return 'quality_pending';
  return null;
}

function detailRecord(value: Prisma.JsonValue | null): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function resultFromActivityDetail(
  detail: Prisma.JsonValue | null,
  completionId: string,
): ProcessCompletionResult | null {
  const record = detailRecord(detail);
  if (!record || record.completionId !== completionId) return null;
  const routeVersion = Number(record.routeVersion);
  const goodTransferredQty = Number(record.goodTransferredQty);
  const remainingInputQty = Number(record.remainingInputQty);
  if (
    !Number.isSafeInteger(routeVersion)
    || !Number.isSafeInteger(goodTransferredQty)
    || !Number.isSafeInteger(remainingInputQty)
  ) return null;
  const laborPoolId = typeof record.laborPoolId === 'string' ? record.laborPoolId : null;
  const laborPoolPendingStandard = record.laborPoolPendingStandard === true;
  const branchWorkOrderId = typeof record.branchWorkOrderId === 'string'
    ? record.branchWorkOrderId
    : undefined;
  const branchWorkOrderCode = typeof record.branchWorkOrderCode === 'string'
    ? record.branchWorkOrderCode
    : undefined;
  return {
    completionId,
    routeVersion,
    laborPoolId,
    laborPoolPendingStandard,
    ...(branchWorkOrderId ? { branchWorkOrderId } : {}),
    ...(branchWorkOrderCode ? { branchWorkOrderCode } : {}),
    goodTransferredQty,
    remainingInputQty,
    routeCompleted: record.routeCompleted === true,
  };
}

async function resultForExistingCompletion(
  db: Prisma.TransactionClient | typeof prisma,
  completion: ReplayCompletionRecord,
): Promise<ProcessCompletionResult> {
  const activities = await db.processRouteActivity.findMany({
    where: {
      routeId: completion.routeId,
      stepId: completion.stepId,
      action: 'complete_process_step',
      detail: {
        path: ['completionId'],
        equals: completion.id,
      },
    },
    select: { detail: true },
    orderBy: { createdAt: 'desc' },
    take: 1,
  });
  for (const activity of activities) {
    const stored = resultFromActivityDetail(activity.detail, completion.id);
    if (stored) return stored;
  }
  const normalMovementQuantities = completion.movements
    .filter(movement => (
      movement.type === 'GOOD_TRANSFER'
      || movement.type === 'FINISHED_GOOD'
      || movement.type === 'REWORK_RETURN'
    ))
    .map(movement => movement.quantity);
  return {
    completionId: completion.id,
    routeVersion: completion.routeVersion,
    laborPoolId: completion.laborPool?.id || null,
    laborPoolPendingStandard: completion.laborPool?.status === 'LOCKED'
      && completion.laborPool.standardSource === 'pending_standard',
    ...(completion.branchWorkOrder?.id ? { branchWorkOrderId: completion.branchWorkOrder.id } : {}),
    ...(completion.branchWorkOrder?.code ? { branchWorkOrderCode: completion.branchWorkOrder.code } : {}),
    goodTransferredQty: normalMovementQuantities.length ? Math.max(...normalMovementQuantities) : 0,
    remainingInputQty: Math.max(0, completion.step.inputQty - completion.step.processedQty),
    routeCompleted: completion.route.status === 'completed',
  };
}

function assertIdempotentPayload(
  completion: ReplayCompletionRecord,
  input: ParsedCompletionCommand,
): void {
  const matches = completion.routeId === input.routeId
    && completion.stepId === input.stepId
    && completion.processedQty === input.processedQty
    && completion.defectQty === input.defectQty
    && completion.defectDisposition === input.databaseDefectDisposition
    && dateKeyFromDatabase(completion.workDate) === input.workDateKey;
  if (!matches) {
    throw new ProcessCompletionServiceError(
      '请求标识已用于另一笔完成记录，请重新提交',
      409,
      'PROCESS_COMPLETION_IDEMPOTENCY_CONFLICT',
    );
  }
}

function normalizeServiceError(error: unknown): ProcessCompletionServiceError {
  if (error instanceof ProcessCompletionServiceError) return error;
  if (error instanceof ProcessCompletionDomainError) {
    const conflictCodes = new Set([
      'PROCESSED_QTY_EXCEEDS_AVAILABLE',
      'RELEASED_QTY_EXCEEDS_PARALLEL_MINIMUM',
    ]);
    return new ProcessCompletionServiceError(
      error.message,
      conflictCodes.has(error.code) ? 409 : 400,
      error.code,
    );
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError
    && (error.code === 'P2002' || error.code === 'P2034')) {
    return new ProcessCompletionServiceError(
      '工艺路线已被其他操作更新，请刷新后重试',
      409,
      'PROCESS_ROUTE_VERSION_CONFLICT',
    );
  }
  return new ProcessCompletionServiceError(
    '生产完成记录保存失败',
    500,
    'PROCESS_COMPLETION_FAILED',
  );
}

export async function loadProcessCompletionContext(
  routeIdInput: string,
  stepIdInput?: string | null,
): Promise<ProcessCompletionContext> {
  const routeId = cleanText(routeIdInput, 80);
  const stepId = cleanText(stepIdInput, 80);
  const route = await prisma.workOrderProcessRoute.findUnique({
    where: { id: routeId },
    include: {
      workOrder: true,
      steps: {
        orderBy: [{ sequenceGroup: 'asc' }, { position: 'asc' }],
        include: {
          completions: {
            where: { voidedAt: null },
            orderBy: [{ completedAt: 'desc' }, { createdAt: 'desc' }],
            take: 20,
            include: {
              branchWorkOrder: {
                select: {
                  id: true,
                  code: true,
                  branchType: true,
                  branchStatus: true,
                },
              },
            },
          },
        },
      },
    },
  });
  if (!route) {
    throw new ProcessCompletionServiceError(
      '工艺路线不存在',
      404,
      'PROCESS_ROUTE_NOT_FOUND',
    );
  }
  if (!route.steps.length) {
    throw new ProcessCompletionServiceError(
      '工艺路线尚未配置工序',
      409,
      'PROCESS_ROUTE_STEPS_REQUIRED',
    );
  }
  const selected = stepId
    ? route.steps.find(step => step.id === stepId)
    : route.steps.find(step => step.status === 'current');
  if (!selected) {
    throw new ProcessCompletionServiceError(
      stepId ? '当前工序不属于该工艺路线' : '当前没有可完成的生产工序',
      stepId ? 404 : 409,
      stepId ? 'PROCESS_STEP_NOT_FOUND' : 'PROCESS_CURRENT_STEP_REQUIRED',
    );
  }
  if (selected.status !== 'current') {
    throw new ProcessCompletionServiceError(
      '该工序已不是当前可完成工序，请刷新后重试',
      409,
      'PROCESS_STEP_NOT_CURRENT',
    );
  }
  const target = targetQuantity(route.workOrder);
  const firstGroup = firstSequenceGroup(route.steps);
  const availableInputQty = effectiveInputQuantity(selected, firstGroup, target);
  const nextSteps = nextSequenceGroupSteps(route.steps, selected.sequenceGroup);
  return {
    routeId: route.id,
    routeVersion: route.version,
    step: {
      id: selected.id,
      processName: selected.processName,
      sequenceGroup: selected.sequenceGroup,
      status: selected.status,
    },
    nextSteps: nextSteps.map(step => ({
      id: step.id,
      processName: step.processName,
      sequenceGroup: step.sequenceGroup,
    })),
    availableInputQty,
    processedQty: selected.processedQty,
    remainingInputQty: Math.max(0, availableInputQty - selected.processedQty),
    goodQty: selected.goodOutputQty,
    defectQty: selected.defectOutputQty,
    recentCompletions: selected.completions.map(completion => ({
      id: completion.id,
      processedQty: completion.processedQty,
      goodQty: completion.goodQty,
      defectQty: completion.defectQty,
      defectDisposition: lowercaseDisposition(completion.defectDisposition),
      workDate: dateKeyFromDatabase(completion.workDate),
      completedAt: completion.completedAt.toISOString(),
      ...(completion.branchWorkOrder ? {
        branchWorkOrder: {
          id: completion.branchWorkOrder.id,
          code: completion.branchWorkOrder.code,
          branchType: completion.branchWorkOrder.branchType?.toLowerCase() || null,
          branchStatus: completion.branchWorkOrder.branchStatus?.toLowerCase() || null,
        },
      } : {}),
    })),
  };
}

function branchConfiguration(disposition: ProcessDefectDispositionInput): {
  branchType: 'REWORK' | 'SCRAP_REPLENISH' | 'QUALITY_PENDING';
  branchStatus: 'IN_PROGRESS' | 'QUALITY_PENDING';
  movementType: 'REWORK_SPLIT' | 'SCRAP_REPLENISH_SPLIT' | 'QUALITY_HOLD';
  codeTag: string;
  label: string;
  frozen: boolean;
} {
  if (disposition === 'rework') {
    return {
      branchType: 'REWORK',
      branchStatus: 'IN_PROGRESS',
      movementType: 'REWORK_SPLIT',
      codeTag: 'RW',
      label: '返工',
      frozen: false,
    };
  }
  if (disposition === 'scrap_replenish') {
    return {
      branchType: 'SCRAP_REPLENISH',
      branchStatus: 'IN_PROGRESS',
      movementType: 'SCRAP_REPLENISH_SPLIT',
      codeTag: 'RP',
      label: '报废补产',
      frozen: false,
    };
  }
  return {
    branchType: 'QUALITY_PENDING',
    branchStatus: 'QUALITY_PENDING',
    movementType: 'QUALITY_HOLD',
    codeTag: 'QH',
    label: '质量待判',
    frozen: true,
  };
}

function branchCode(parentCode: string, tag: string, sequence: number): string {
  const suffix = `-${tag}${String(sequence).padStart(2, '0')}`;
  return `${parentCode.slice(0, Math.max(1, 80 - suffix.length))}${suffix}`;
}

async function createDefectBranch(
  tx: Prisma.TransactionClient,
  input: {
    route: CompletionRouteRecord;
    completionId: string;
    currentStepId: string;
    defectQty: number;
    disposition: ProcessDefectDispositionInput;
    userId: string;
    actor: string;
    now: Date;
  },
): Promise<{
  workOrderId: string;
  workOrderCode: string;
  firstStepId: string;
  firstSequenceGroup: number;
  movementType: 'REWORK_SPLIT' | 'SCRAP_REPLENISH_SPLIT' | 'QUALITY_HOLD';
}> {
  const configuration = branchConfiguration(input.disposition);
  const sourceSteps = planDefectBranchRoute(
    input.route.steps as BranchSourceStep[],
    input.currentStepId,
    input.disposition,
  );
  if (!sourceSteps.length) {
    throw new ProcessCompletionServiceError(
      '无法为不良品生成后续工艺路线',
      409,
      'PROCESS_BRANCH_ROUTE_EMPTY',
    );
  }
  const branchSequence = await tx.workOrder.count({
    where: { parentWorkOrderId: input.route.workOrderId },
  }) + 1;
  const firstGroup = firstSequenceGroup(sourceSteps);
  const firstSource = sourceSteps[0];
  const firstStage = processStageForGroup(
    normalizeProcessStageGroup(firstSource.stageGroup) || 'frontend',
  );
  const nextOriginalSteps = nextSequenceGroupSteps(
    input.route.steps,
    input.route.steps.find(step => step.id === input.currentStepId)?.sequenceGroup || 0,
  );
  const branchOrder = await tx.workOrder.create({
    data: {
      code: branchCode(input.route.workOrder.code, configuration.codeTag, branchSequence),
      customerName: input.route.workOrder.customerName,
      productName: input.route.workOrder.productName,
      stage: firstStage,
      status: configuration.frozen ? 'pending' : legacyStatusForStage(firstStage),
      progress: 0,
      priority: input.route.workOrder.priority,
      plannedAt: input.route.workOrder.plannedAt,
      remark: `${configuration.label}分支，来源工单 ${input.route.workOrder.code}`,
      sourceOrderNo: input.route.workOrder.sourceOrderNo,
      salesperson: input.route.workOrder.salesperson,
      orderDate: input.route.workOrder.orderDate,
      customerLevel: input.route.workOrder.customerLevel,
      specification: input.route.workOrder.specification,
      processName: firstSource.processName,
      uncompletedQty: String(input.defectQty),
      productionTargetQty: input.defectQty,
      unitWorkHours: input.route.workOrder.unitWorkHours,
      totalWorkHours: input.route.workOrder.totalWorkHours,
      drawingStatus: input.route.workOrder.drawingStatus,
      deliveryDay: input.route.workOrder.deliveryDay,
      materialStatus: input.route.workOrder.materialStatus,
      drawingIssuedAt: input.route.workOrder.drawingIssuedAt,
      drawingIssueNote: input.route.workOrder.drawingIssueNote,
      planType: input.route.workOrder.planType,
      weekStartDate: input.route.workOrder.weekStartDate,
      weekEndDate: input.route.workOrder.weekEndDate,
      planActive: input.route.workOrder.planActive,
      libraryKey: input.route.workOrder.libraryKey,
      drawingLibraryItemId: input.route.workOrder.drawingLibraryItemId,
      productionOwner: input.route.workOrder.productionOwner,
      workstation: input.route.workOrder.workstation,
      completedQty: '0',
      frontendTransferredQty: firstStage === 'backend' ? input.defectQty : 0,
      parentWorkOrderId: input.route.workOrderId,
      rootWorkOrderId: input.route.workOrder.rootWorkOrderId || input.route.workOrderId,
      branchType: configuration.branchType,
      branchStatus: configuration.branchStatus,
      originCompletionId: input.completionId,
      originStepId: input.currentStepId,
      rejoinStepId: input.disposition === 'rework' ? nextOriginalSteps[0]?.id || null : null,
      branchSequence,
      startedAt: configuration.frozen ? null : input.now,
      lastProgressAt: input.now,
      latestProgressRemark: configuration.frozen
        ? '不良品等待质量判定，分支路线已冻结'
        : `${configuration.label}分支已创建，当前工序：${sourceSteps
            .filter(step => step.sequenceGroup === firstGroup)
            .map(step => step.processName)
            .join('、')}`,
    },
  });
  const branchRoute = await tx.workOrderProcessRoute.create({
    data: {
      workOrderId: branchOrder.id,
      templateId: input.route.templateId,
      templateName: `${input.route.templateName} · ${configuration.label}分支`,
      templateVersion: input.route.templateVersion,
      status: configuration.frozen ? 'confirmed' : 'in_progress',
      version: 0,
      confirmedAt: input.now,
      confirmedById: input.userId,
      startedAt: configuration.frozen ? null : input.now,
      productTimeProfileId: input.route.productTimeProfileId,
      productTimeProfileVersion: input.route.productTimeProfileVersion,
      routeSource: input.route.routeSource,
      steps: {
        create: sourceSteps.map(step => {
          const isFirstGroup = step.sequenceGroup === firstGroup;
          return {
            processDefinitionId: step.processDefinitionId,
            processCode: step.processCode,
            processName: step.processName,
            stageGroup: step.stageGroup,
            position: step.position,
            sequenceGroup: step.sequenceGroup,
            standardTimeId: step.standardTimeId,
            standardVersion: step.standardVersion,
            productTimeProfileId: step.productTimeProfileId,
            productTimeEntryId: step.productTimeEntryId,
            productTimeProfileVersion: step.productTimeProfileVersion,
            standardSource: step.standardSource,
            timeBasis: step.timeBasis,
            unitLabel: step.unitLabel,
            standardMillisecondsPerUnit: step.standardMillisecondsPerUnit,
            setupMilliseconds: step.setupMilliseconds,
            unitsPerProduct: step.unitsPerProduct,
            countsForEfficiency: step.countsForEfficiency,
            inputQty: isFirstGroup ? input.defectQty : 0,
            processedQty: 0,
            goodOutputQty: 0,
            defectOutputQty: 0,
            releasedGoodQty: 0,
            quantityVersion: 0,
            status: !configuration.frozen && isFirstGroup ? 'current' : 'pending',
            startedAt: !configuration.frozen && isFirstGroup ? input.now : null,
          };
        }),
      },
    },
    include: {
      steps: { orderBy: [{ sequenceGroup: 'asc' }, { position: 'asc' }] },
    },
  });
  await tx.processRouteActivity.create({
    data: {
      routeId: branchRoute.id,
      stepId: branchRoute.steps[0]?.id || null,
      action: 'create_defect_branch_route',
      content: configuration.frozen
        ? `由 ${input.route.workOrder.code} 创建质量待判分支，路线保持冻结`
        : `由 ${input.route.workOrder.code} 创建${configuration.label}分支，数量 ${input.defectQty}`,
      actorId: input.userId,
      detail: {
        originCompletionId: input.completionId,
        originRouteId: input.route.id,
        originStepId: input.currentStepId,
        defectQty: input.defectQty,
        branchType: configuration.branchType,
      },
    },
  });
  return {
    workOrderId: branchOrder.id,
    workOrderCode: branchOrder.code,
    firstStepId: branchRoute.steps[0].id,
    firstSequenceGroup: branchRoute.steps[0].sequenceGroup,
    movementType: configuration.movementType,
  };
}

async function reconcileQuantityStepStatuses(
  tx: Prisma.TransactionClient,
  steps: QuantityStep[],
  input: {
    targetQty: number;
    userId: string;
    now: Date;
  },
): Promise<boolean> {
  const groups = [...new Set(steps.map(step => step.sequenceGroup))].sort((a, b) => a - b);
  let priorGroupClosed = true;
  for (const group of groups) {
    const groupSteps = steps.filter(step => step.sequenceGroup === group);
    const groupClosed: boolean = priorGroupClosed && groupSteps.every(step => (
      step.processedQty >= step.inputQty
    ));
    for (const step of groupSteps) {
      let nextStatus = step.status;
      if (groupClosed) nextStatus = step.inputQty > 0 ? 'completed' : 'skipped';
      else if (step.inputQty > step.processedQty) nextStatus = 'current';
      else if (step.status !== 'completed' && step.status !== 'skipped') nextStatus = 'current';
      if (nextStatus !== step.status || (groupClosed && !step.completedAt)) {
        await tx.workOrderProcessStep.update({
          where: { id: step.id },
          data: {
            status: nextStatus,
            ...(nextStatus === 'completed' || nextStatus === 'skipped'
              ? {
                  completedAt: step.completedAt || input.now,
                  completedById: step.completedById || input.userId,
                }
              : {
                  startedAt: step.startedAt || input.now,
                  completedAt: null,
                  completedById: null,
                }),
          },
        });
        step.status = nextStatus;
        if (nextStatus === 'completed' || nextStatus === 'skipped') {
          step.completedAt = step.completedAt || input.now;
          step.completedById = step.completedById || input.userId;
        } else {
          step.startedAt = step.startedAt || input.now;
          step.completedAt = null;
          step.completedById = null;
        }
      }
    }
    priorGroupClosed = groupClosed;
  }
  return steps.every(step => step.status === 'completed' || step.status === 'skipped');
}

async function hasActiveDescendantBranches(
  tx: Prisma.TransactionClient,
  workOrderId: string,
): Promise<boolean> {
  let frontier = [workOrderId];
  const visited = new Set<string>(frontier);
  while (frontier.length) {
    const children = await tx.workOrder.findMany({
      where: {
        parentWorkOrderId: { in: frontier },
        deletedAt: null,
      },
      select: {
        id: true,
        branchStatus: true,
      },
    });
    if (children.some(child => (
      child.branchStatus !== 'RESOLVED' && child.branchStatus !== 'CANCELLED'
    ))) {
      return true;
    }
    const nextFrontier: string[] = [];
    for (const child of children) {
      if (visited.has(child.id)) {
        throw new ProcessCompletionServiceError(
          '工单分支层级存在循环，无法确认生产完成状态',
          409,
          'PROCESS_BRANCH_ANCESTRY_CYCLE',
        );
      }
      visited.add(child.id);
      nextFrontier.push(child.id);
    }
    frontier = nextFrontier;
  }
  return false;
}

async function hasActiveUpstreamReworkBranch(
  tx: Prisma.TransactionClient,
  route: CompletionRouteRecord,
  currentSequenceGroup: number,
): Promise<boolean> {
  if (currentSequenceGroup <= 1) return false;
  return (await tx.workOrder.count({
    where: {
      parentWorkOrderId: route.workOrderId,
      deletedAt: null,
      branchType: 'REWORK',
      branchStatus: { notIn: ['RESOLVED', 'CANCELLED'] },
      originStep: {
        is: {
          routeId: route.id,
          sequenceGroup: { lt: currentSequenceGroup },
        },
      },
    },
  })) > 0;
}

async function createCompletionLaborPool(
  tx: Prisma.TransactionClient,
  input: {
    completionId: string;
    workOrderId: string;
    stepId: string;
    workDate: Date;
    eligibleQty: number;
    timeBasis: string | null;
    standardMillisecondsPerUnit: number | null;
    setupMilliseconds: number;
    unitsPerProduct: number;
    countsForEfficiency: boolean;
    standardSource: string;
    productTimeProfileVersion: number | null;
  },
): Promise<{ id: string; pendingStandard: boolean }> {
  const knownTimeBasis = input.timeBasis === 'per_unit' || input.timeBasis === 'per_batch';
  const hasStandard = knownTimeBasis
    && Boolean(input.standardMillisecondsPerUnit && input.standardMillisecondsPerUnit > 0);
  if (!hasStandard) {
    const pool = await tx.processLaborPool.create({
      data: {
        completionId: input.completionId,
        workOrderId: input.workOrderId,
        stepId: input.stepId,
        workDate: input.workDate,
        eligibleQty: input.eligibleQty,
        claimedQty: 0,
        remainingQty: input.eligibleQty,
        status: 'LOCKED',
        version: 0,
        standardMillisecondsPerUnit: 0,
        setupMilliseconds: Math.max(0, input.setupMilliseconds),
        unitsPerProduct: Math.max(1, input.unitsPerProduct),
        totalStandardLaborMilliseconds: 0n,
        claimedStandardLaborMilliseconds: 0n,
        remainingStandardLaborMilliseconds: 0n,
        countsForEfficiency: input.countsForEfficiency,
        standardSource: 'pending_standard',
        productTimeProfileVersion: input.productTimeProfileVersion,
      },
    });
    return { id: pool.id, pendingStandard: true };
  }

  const labor = calculateCompletionLaborSnapshot({
    timeBasis: input.timeBasis as 'per_unit' | 'per_batch',
    eligibleQty: input.eligibleQty,
    standardMillisecondsPerUnit: input.standardMillisecondsPerUnit,
    setupMilliseconds: input.setupMilliseconds,
    unitsPerProduct: input.unitsPerProduct,
  });
  const pool = await tx.processLaborPool.create({
    data: {
      completionId: input.completionId,
      workOrderId: input.workOrderId,
      stepId: input.stepId,
      workDate: input.workDate,
      eligibleQty: input.eligibleQty,
      claimedQty: 0,
      remainingQty: input.eligibleQty,
      status: 'OPEN',
      version: 0,
      standardMillisecondsPerUnit: labor.standardMillisecondsPerUnit,
      setupMilliseconds: labor.setupMilliseconds,
      unitsPerProduct: labor.unitsPerProduct,
      totalStandardLaborMilliseconds: labor.totalStandardLaborMilliseconds,
      claimedStandardLaborMilliseconds: 0n,
      remainingStandardLaborMilliseconds: labor.totalStandardLaborMilliseconds,
      countsForEfficiency: input.countsForEfficiency,
      standardSource: input.standardSource,
      productTimeProfileVersion: input.productTimeProfileVersion,
    },
  });
  return { id: pool.id, pendingStandard: false };
}

async function createDeferredPerBatchLaborPools(
  tx: Prisma.TransactionClient,
  route: CompletionRouteRecord,
  input: {
    userId: string;
    now: Date;
  },
): Promise<string[]> {
  const createdPoolIds: string[] = [];
  const candidates = route.steps.filter(step => (
    step.timeBasis === 'per_batch'
    && step.inputQty > 0
    && step.processedQty >= step.inputQty
    && step.goodOutputQty > 0
    && step.status === 'completed'
  ));

  for (const step of candidates) {
    const upstreamClosed = route.steps
      .filter(candidate => candidate.sequenceGroup < step.sequenceGroup)
      .every(candidate => candidate.status === 'completed' || candidate.status === 'skipped');
    if (!upstreamClosed || await hasActiveUpstreamReworkBranch(tx, route, step.sequenceGroup)) {
      continue;
    }

    const existingPool = await tx.processLaborPool.findFirst({
      where: { stepId: step.id },
      select: { id: true },
    });
    if (existingPool) continue;

    const completionWhere = {
      routeId: route.id,
      stepId: step.id,
      voidedAt: null,
    };
    const [completion, completedQuantity] = await Promise.all([
      tx.processCompletion.findFirst({
        where: completionWhere,
        orderBy: [
          { completedAt: 'desc' },
          { createdAt: 'desc' },
        ],
        select: {
          id: true,
          workDate: true,
          timeBasis: true,
          standardMillisecondsPerUnit: true,
          setupMilliseconds: true,
          unitsPerProduct: true,
          countsForEfficiency: true,
          standardSource: true,
          productTimeProfileVersion: true,
        },
      }),
      tx.processCompletion.aggregate({
        where: completionWhere,
        _sum: { goodQty: true },
      }),
    ]);
    if (
      completion?.timeBasis !== 'per_batch'
      && completion?.timeBasis !== null
    ) {
      continue;
    }
    if (!completion) continue;
    const directCompletedGoodQty = Math.max(0, completedQuantity._sum.goodQty || 0);
    // Rework returns increase the step's cumulative good output for material
    // release, but the rework branch already owns that labor. Only direct
    // completion output from this step may create its deferred batch pool.
    if (directCompletedGoodQty <= 0) continue;
    const pool = await createCompletionLaborPool(tx, {
      completionId: completion.id,
      workOrderId: route.workOrderId,
      stepId: step.id,
      workDate: completion.workDate,
      eligibleQty: directCompletedGoodQty,
      timeBasis: completion.timeBasis,
      standardMillisecondsPerUnit: completion.standardMillisecondsPerUnit,
      setupMilliseconds: completion.setupMilliseconds,
      unitsPerProduct: completion.unitsPerProduct,
      countsForEfficiency: completion.countsForEfficiency,
      standardSource: completion.standardSource,
      productTimeProfileVersion: completion.productTimeProfileVersion,
    });
    createdPoolIds.push(pool.id);
    await tx.processRouteActivity.create({
      data: {
        routeId: route.id,
        stepId: step.id,
        action: 'create_deferred_per_batch_labor_pool',
        content: pool.pendingStandard
          ? `${step.processName} 上下游已闭环，补建 ${directCompletedGoodQty} 件待补标准工时`
          : `${step.processName} 上下游已闭环，补建 ${directCompletedGoodQty} 件待领取工时`,
        actorId: input.userId,
        detail: {
          completionId: completion.id,
          laborPoolId: pool.id,
          laborPoolPendingStandard: pool.pendingStandard,
          eligibleQty: directCompletedGoodQty,
          reason: 'upstream_closed_without_release_delta',
        },
      },
    });
  }

  return createdPoolIds;
}

async function loadDirectRouteReleaseCap(
  tx: Prisma.TransactionClient,
  input: {
    workOrderId: string;
    targetQty: number;
    currentSequenceGroup: number;
    alreadyReleasedQty: number;
    pendingScrapReservationQty?: number;
  },
): Promise<number> {
  const reservation = await tx.processQuantityMovement.aggregate({
    where: {
      workOrderId: input.workOrderId,
      type: 'SCRAP_REPLENISH_SPLIT',
      sourceSequenceGroup: { lte: input.currentSequenceGroup },
      voidedAt: null,
    },
    _sum: { quantity: true },
  });
  const reservedQty = safeNonnegativeInteger(reservation._sum.quantity);
  const pendingQty = safeNonnegativeInteger(input.pendingScrapReservationQty);
  const directRouteCap = input.targetQty - reservedQty - pendingQty;
  if (directRouteCap < 0) {
    throw new ProcessCompletionServiceError(
      `补产预留数量 ${reservedQty + pendingQty} 不能超过工单目标 ${input.targetQty}`,
      409,
      'PROCESS_SCRAP_RESERVATION_EXCEEDS_TARGET',
    );
  }
  const alreadyReleasedQty = safeNonnegativeInteger(input.alreadyReleasedQty);
  if (directRouteCap < alreadyReleasedQty) {
    throw new ProcessCompletionServiceError(
      `本次补产会把当前顺序组可释放上限降至 ${directRouteCap}，低于已释放数量 ${alreadyReleasedQty}`,
      409,
      'PROCESS_SCRAP_RESERVATION_BELOW_RELEASED',
    );
  }
  return directRouteCap;
}

function stageForLifecycleState(input: {
  targetQty: number;
  frontendTransferredQty: number;
  completedQty: number;
  lifecycleCompleted: boolean;
}) {
  const quantityStage = compatibleStageForQuantities({
    targetQty: input.targetQty,
    frontendTransferredQty: input.frontendTransferredQty,
    completedQty: input.completedQty,
  });
  if (quantityStage !== 'completed' || input.lifecycleCompleted) return quantityStage;
  return input.frontendTransferredQty >= input.targetQty ? 'backend' : 'frontend';
}

async function updateCompletionWorkOrders(
  tx: Prisma.TransactionClient,
  input: {
    route: CompletionRouteRecord;
    targetQty: number;
    finishedGoodDelta: number;
    frontendTransferDelta: number;
    routeCompleted: boolean;
    actor: string;
    now: Date;
    propagateFinishedToAncestors?: boolean;
  },
) {
  const previousStage = normalizeWorkOrderStage(
    input.route.workOrder.stage || input.route.workOrder.status,
  ) || 'not_issued';
  const previousCompleted = parseStoredQuantity(input.route.workOrder.completedQty);
  const completedQty = resolveCompletedQuantityDelta({
    previousCompletedQty: previousCompleted,
    targetQty: input.targetQty,
    finishedGoodDelta: input.finishedGoodDelta,
  });
  const quantityCompleted = completedQty === input.targetQty;
  const activeDescendantBranches = await hasActiveDescendantBranches(
    tx,
    input.route.workOrderId,
  );
  const workOrderCompleted = quantityCompleted && input.routeCompleted && !activeDescendantBranches;
  const currentFlow = resolveEffectiveFrontendTransferredQty(input.route.workOrder);
  const effectiveTransferredQty = currentFlow.ok
    ? currentFlow.state.frontendTransferredQty
    : safeNonnegativeInteger(input.route.workOrder.frontendTransferredQty);
  const frontendTransferredQty = Math.min(
    input.targetQty,
    Math.max(
      completedQty,
      effectiveTransferredQty + input.frontendTransferDelta,
    ),
  );
  const stage = stageForLifecycleState({
    targetQty: input.targetQty,
    frontendTransferredQty,
    completedQty,
    lifecycleCompleted: workOrderCompleted,
  });
  const changed = await tx.workOrder.update({
    where: { id: input.route.workOrderId },
    data: {
      stage,
      status: legacyStatusForStage(stage),
      progress: Math.min(100, Math.round((completedQty / input.targetQty) * 100)),
      completedQty: String(completedQty),
      frontendTransferredQty,
      executionVersion: { increment: 1 },
      startedAt: input.route.workOrder.startedAt || input.now,
      completedAt: workOrderCompleted
        ? input.route.workOrder.completedAt || input.now
        : null,
      lastProgressAt: input.now,
      latestProgressRemark: workOrderCompleted
        ? `累计完成 ${completedQty}/${input.targetQty}，工单生产完成`
        : input.routeCompleted
          ? `主路线已处理完毕，累计良品 ${completedQty}/${input.targetQty}，等待不良分支闭环`
          : `累计成品 ${completedQty}/${input.targetQty}`,
      ...(input.route.workOrder.branchType
        ? {
            branchStatus: workOrderCompleted
              ? 'RESOLVED'
              : input.route.workOrder.branchStatus,
          }
        : {}),
    },
  });
  await tx.workOrderProgressLog.create({
    data: {
      workOrderId: changed.id,
      previousStage,
      stage,
      completedQty: changed.completedQty,
      productionOwner: changed.productionOwner,
      workstation: changed.workstation,
      remark: changed.latestProgressRemark,
      createdBy: input.actor,
    },
  });

  if (
    input.propagateFinishedToAncestors !== false
    && input.finishedGoodDelta > 0
    && input.route.workOrder.parentWorkOrderId
  ) {
    const visited = new Set([input.route.workOrderId]);
    let ancestorId: string | null = input.route.workOrder.parentWorkOrderId;
    while (ancestorId) {
      if (visited.has(ancestorId)) {
        throw new ProcessCompletionServiceError(
          '工单分支层级存在循环，无法回补完成数量',
          409,
          'PROCESS_BRANCH_ANCESTRY_CYCLE',
        );
      }
      visited.add(ancestorId);
      const ancestor: CompletionRouteRecord['workOrder'] | null =
        await tx.workOrder.findUnique({ where: { id: ancestorId } });
      if (!ancestor) {
        throw new ProcessCompletionServiceError(
          '分支工单的上级工单不存在',
          409,
          'PROCESS_BRANCH_PARENT_NOT_FOUND',
        );
      }
      const ancestorTarget = targetQuantity(ancestor);
      const ancestorCompletedQty = resolveCompletedQuantityDelta({
        previousCompletedQty: parseStoredQuantity(ancestor.completedQty),
        targetQty: ancestorTarget,
        finishedGoodDelta: input.finishedGoodDelta,
      });
      const ancestorQuantityCompleted = ancestorCompletedQty === ancestorTarget;
      const ancestorRoute = await tx.workOrderProcessRoute.findUnique({
        where: { workOrderId: ancestor.id },
        select: { status: true },
      });
      const ancestorRouteCompleted = !ancestorRoute || ancestorRoute.status === 'completed';
      const ancestorHasActiveBranches = await hasActiveDescendantBranches(tx, ancestor.id);
      const ancestorCompleted = ancestorQuantityCompleted
        && ancestorRouteCompleted
        && !ancestorHasActiveBranches;
      const ancestorFlow = resolveEffectiveFrontendTransferredQty(ancestor);
      const ancestorEffectiveTransferred = ancestorFlow.ok
        ? ancestorFlow.state.frontendTransferredQty
        : safeNonnegativeInteger(ancestor.frontendTransferredQty);
      const ancestorFrontendTransferredQty = Math.min(
        ancestorTarget,
        Math.max(ancestorEffectiveTransferred, ancestorCompletedQty),
      );
      const ancestorPreviousStage = normalizeWorkOrderStage(
        ancestor.stage || ancestor.status,
      ) || 'not_issued';
      const ancestorStage = stageForLifecycleState({
        targetQty: ancestorTarget,
        frontendTransferredQty: ancestorFrontendTransferredQty,
        completedQty: ancestorCompletedQty,
        lifecycleCompleted: ancestorCompleted,
      });
      const changedAncestor = await tx.workOrder.update({
        where: { id: ancestor.id },
        data: {
          completedQty: String(ancestorCompletedQty),
          frontendTransferredQty: ancestorFrontendTransferredQty,
          progress: Math.min(100, Math.round((ancestorCompletedQty / ancestorTarget) * 100)),
          stage: ancestorStage,
          status: legacyStatusForStage(ancestorStage),
          executionVersion: { increment: 1 },
          completedAt: ancestorCompleted ? ancestor.completedAt || input.now : null,
          lastProgressAt: input.now,
          latestProgressRemark: ancestorCompleted
            ? `含分支累计完成 ${ancestorCompletedQty}/${ancestorTarget}，工单生产完成`
            : `分支回补 ${input.finishedGoodDelta}，累计完成 ${ancestorCompletedQty}/${ancestorTarget}`,
          ...(ancestor.branchType
            ? {
                branchStatus: ancestorCompleted
                  ? 'RESOLVED'
                  : ancestor.branchStatus,
              }
            : {}),
        },
      });
      await tx.workOrderProgressLog.create({
        data: {
          workOrderId: changedAncestor.id,
          previousStage: ancestorPreviousStage,
          stage: ancestorStage,
          completedQty: changedAncestor.completedQty,
          productionOwner: changedAncestor.productionOwner,
          workstation: changedAncestor.workstation,
          remark: changedAncestor.latestProgressRemark,
          createdBy: input.actor,
        },
      });
      ancestorId = ancestor.parentWorkOrderId;
    }
  }
  return changed;
}

async function returnReworkOutputToParent(
  tx: Prisma.TransactionClient,
  input: {
    completionId: string;
    sourceRoute: CompletionRouteRecord;
    sourceStepId: string;
    recoveredQty: number;
    userId: string;
    actor: string;
    now: Date;
    visitedWorkOrderIds?: Set<string>;
  },
): Promise<void> {
  if (input.recoveredQty <= 0) return;
  const sourceOrder = input.sourceRoute.workOrder;
  if (sourceOrder.branchType !== 'REWORK') {
    throw new ProcessCompletionServiceError(
      '只有返工分支可以回流到原工序',
      409,
      'PROCESS_REWORK_RETURN_SOURCE_INVALID',
    );
  }
  if (!sourceOrder.parentWorkOrderId || !sourceOrder.originStepId) {
    throw new ProcessCompletionServiceError(
      '返工分支缺少原工单或原工序信息',
      409,
      'PROCESS_REWORK_RETURN_TARGET_MISSING',
    );
  }
  const visited = input.visitedWorkOrderIds || new Set<string>();
  if (visited.has(sourceOrder.id) || visited.has(sourceOrder.parentWorkOrderId)) {
    throw new ProcessCompletionServiceError(
      '返工分支层级存在循环，无法回流',
      409,
      'PROCESS_BRANCH_ANCESTRY_CYCLE',
    );
  }
  visited.add(sourceOrder.id);

  const sourceStep = input.sourceRoute.steps.find(step => step.id === input.sourceStepId);
  if (!sourceStep) {
    throw new ProcessCompletionServiceError(
      '返工回流的来源工序不存在',
      409,
      'PROCESS_REWORK_RETURN_SOURCE_STEP_MISSING',
    );
  }
  const parentRoute = await tx.workOrderProcessRoute.findUnique({
    where: { workOrderId: sourceOrder.parentWorkOrderId },
    include: completionRouteInclude,
  });
  if (!parentRoute) {
    throw new ProcessCompletionServiceError(
      '返工分支的原工艺路线不存在',
      409,
      'PROCESS_REWORK_RETURN_PARENT_ROUTE_MISSING',
    );
  }
  const originStep = parentRoute.steps.find(step => step.id === sourceOrder.originStepId);
  if (!originStep) {
    throw new ProcessCompletionServiceError(
      '返工分支的原工序不属于上级工艺路线',
      409,
      'PROCESS_REWORK_RETURN_ORIGIN_STEP_MISSING',
    );
  }
  if (input.recoveredQty > originStep.defectOutputQty) {
    throw new ProcessCompletionServiceError(
      `返工回流数量 ${input.recoveredQty} 超过原工序待修复不良数量 ${originStep.defectOutputQty}`,
      409,
      'PROCESS_REWORK_RETURN_EXCEEDS_DEFECT',
    );
  }

  const originUpdate = await tx.workOrderProcessStep.updateMany({
    where: {
      id: originStep.id,
      quantityVersion: originStep.quantityVersion,
      goodOutputQty: originStep.goodOutputQty,
      defectOutputQty: originStep.defectOutputQty,
    },
    data: {
      goodOutputQty: { increment: input.recoveredQty },
      defectOutputQty: { decrement: input.recoveredQty },
      quantityVersion: { increment: 1 },
    },
  });
  if (originUpdate.count !== 1) {
    throw new ProcessCompletionServiceError(
      '原工序数量已变化，请刷新后重试',
      409,
      'PROCESS_STEP_QUANTITY_CONFLICT',
    );
  }
  originStep.goodOutputQty += input.recoveredQty;
  originStep.defectOutputQty -= input.recoveredQty;
  originStep.quantityVersion += 1;

  await tx.processQuantityMovement.create({
    data: {
      completionId: input.completionId,
      workOrderId: parentRoute.workOrderId,
      sourceStepId: sourceStep.id,
      targetStepId: originStep.id,
      branchWorkOrderId: sourceOrder.id,
      type: 'REWORK_RETURN',
      quantity: input.recoveredQty,
      sourceSequenceGroup: sourceStep.sequenceGroup,
      targetSequenceGroup: originStep.sequenceGroup,
      idempotencyKey: `${input.completionId}:rework-return:${sourceOrder.id}:${originStep.id}`,
    },
  });

  const groupSteps = parentRoute.steps.filter(
    step => step.sequenceGroup === originStep.sequenceGroup,
  );
  const alreadyReleasedQty = Math.min(...groupSteps.map(step => step.releasedGoodQty));
  const directRouteCap = await loadDirectRouteReleaseCap(tx, {
    workOrderId: parentRoute.workOrderId,
    targetQty: targetQuantity(parentRoute.workOrder),
    currentSequenceGroup: originStep.sequenceGroup,
    alreadyReleasedQty: Math.max(...groupSteps.map(step => step.releasedGoodQty)),
  });
  const release = calculateCappedParallelGroupRelease({
    stepGoodOutputQuantities: groupSteps.map(step => step.goodOutputQty),
    alreadyReleasedQty,
    directRouteCap,
  });
  const targetSteps = nextSequenceGroupSteps(parentRoute.steps, originStep.sequenceGroup);
  let frontendTransferDelta = 0;
  if (release.releaseDeltaQty > 0) {
    if (targetSteps.length) {
      await tx.processQuantityMovement.createMany({
        data: targetSteps.map(targetStep => ({
          completionId: input.completionId,
          workOrderId: parentRoute.workOrderId,
          sourceStepId: originStep.id,
          targetStepId: targetStep.id,
          branchWorkOrderId: sourceOrder.id,
          type: 'GOOD_TRANSFER' as const,
          quantity: release.releaseDeltaQty,
          sourceSequenceGroup: originStep.sequenceGroup,
          targetSequenceGroup: targetStep.sequenceGroup,
          idempotencyKey: `${input.completionId}:rejoin-good:${parentRoute.id}:${targetStep.id}`,
        })),
      });
      for (const targetStep of targetSteps) {
        const targetUpdate = await tx.workOrderProcessStep.updateMany({
          where: {
            id: targetStep.id,
            quantityVersion: targetStep.quantityVersion,
            inputQty: targetStep.inputQty,
          },
          data: {
            inputQty: { increment: release.releaseDeltaQty },
            quantityVersion: { increment: 1 },
            status: 'current',
            startedAt: targetStep.startedAt || input.now,
            completedAt: null,
            completedById: null,
          },
        });
        if (targetUpdate.count !== 1) {
          throw new ProcessCompletionServiceError(
            '返工回流的下一工序数量已变化，请刷新后重试',
            409,
            'PROCESS_STEP_QUANTITY_CONFLICT',
          );
        }
        targetStep.inputQty += release.releaseDeltaQty;
        targetStep.quantityVersion += 1;
        targetStep.status = 'current';
        targetStep.startedAt = targetStep.startedAt || input.now;
        targetStep.completedAt = null;
        targetStep.completedById = null;
      }
      const sourceStageGroup = normalizeProcessStageGroup(originStep.stageGroup);
      const targetStageGroup = normalizeProcessStageGroup(targetSteps[0].stageGroup);
      if (sourceStageGroup === 'frontend' && targetStageGroup && targetStageGroup !== 'frontend') {
        frontendTransferDelta = release.releaseDeltaQty;
      }
    } else if (parentRoute.workOrder.branchType !== 'REWORK') {
      await tx.processQuantityMovement.create({
        data: {
          completionId: input.completionId,
          workOrderId: parentRoute.workOrderId,
          sourceStepId: originStep.id,
          targetStepId: null,
          branchWorkOrderId: sourceOrder.id,
          type: 'FINISHED_GOOD',
          quantity: release.releaseDeltaQty,
          sourceSequenceGroup: originStep.sequenceGroup,
          targetSequenceGroup: null,
          idempotencyKey: `${input.completionId}:rejoin-finished:${parentRoute.id}`,
        },
      });
    }
    for (const groupStep of groupSteps) {
      const releasedUpdate = await tx.workOrderProcessStep.updateMany({
        where: {
          id: groupStep.id,
          quantityVersion: groupStep.quantityVersion,
          releasedGoodQty: groupStep.releasedGoodQty,
        },
        data: {
          releasedGoodQty: release.releasableGoodQty,
          quantityVersion: { increment: 1 },
        },
      });
      if (releasedUpdate.count !== 1) {
        throw new ProcessCompletionServiceError(
          '并行工序释放数量已变化，请刷新后重试',
          409,
          'PROCESS_STEP_QUANTITY_CONFLICT',
        );
      }
      groupStep.releasedGoodQty = release.releasableGoodQty;
      groupStep.quantityVersion += 1;
    }
  }

  const reopensRoute = release.releaseDeltaQty > 0 && targetSteps.length > 0;
  const parentRouteUpdate = await tx.workOrderProcessRoute.updateMany({
    where: {
      id: parentRoute.id,
      version: parentRoute.version,
    },
    data: {
      version: { increment: 1 },
      ...(reopensRoute
        ? {
            status: 'in_progress',
            completedAt: null,
          }
        : {}),
    },
  });
  if (parentRouteUpdate.count !== 1) {
    throw new ProcessCompletionServiceError(
      '原工艺路线已被其他操作更新，请刷新后重试',
      409,
      'PROCESS_ROUTE_VERSION_CONFLICT',
    );
  }
  const parentRouteCompleted = reopensRoute ? false : parentRoute.status === 'completed';
  if (reopensRoute) {
    parentRoute.status = 'in_progress';
    parentRoute.completedAt = null;
  }
  parentRoute.version += 1;

  const terminalReleaseDelta = targetSteps.length ? 0 : release.releaseDeltaQty;
  await updateCompletionWorkOrders(tx, {
    route: parentRoute,
    targetQty: targetQuantity(parentRoute.workOrder),
    finishedGoodDelta: terminalReleaseDelta,
    frontendTransferDelta,
    routeCompleted: parentRouteCompleted,
    actor: input.actor,
    now: input.now,
    propagateFinishedToAncestors: parentRoute.workOrder.branchType !== 'REWORK',
  });

  if (terminalReleaseDelta > 0 && parentRoute.workOrder.branchType === 'REWORK') {
    await returnReworkOutputToParent(tx, {
      completionId: input.completionId,
      sourceRoute: parentRoute,
      sourceStepId: originStep.id,
      recoveredQty: terminalReleaseDelta,
      userId: input.userId,
      actor: input.actor,
      now: input.now,
      visitedWorkOrderIds: visited,
    });
  }
  await createDeferredPerBatchLaborPools(tx, parentRoute, {
    userId: input.userId,
    now: input.now,
  });
}

async function performProcessCompletion(
  tx: Prisma.TransactionClient,
  input: ParsedCompletionCommand,
): Promise<ProcessCompletionResult> {
  const existing = await tx.processCompletion.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
    include: replayCompletionInclude,
  });
  if (existing) {
    assertIdempotentPayload(existing, input);
    return resultForExistingCompletion(tx, existing);
  }

  const route = await tx.workOrderProcessRoute.findUnique({
    where: { id: input.routeId },
    include: completionRouteInclude,
  });
  if (!route) {
    throw new ProcessCompletionServiceError(
      '工艺路线不存在',
      404,
      'PROCESS_ROUTE_NOT_FOUND',
    );
  }
  if (!isActiveProductionWorkOrder(route.workOrder)) {
    throw new ProcessCompletionServiceError(
      '历史周和未启用计划不能登记生产完成',
      409,
      'WORK_ORDER_READ_ONLY',
    );
  }
  if (route.workOrder.branchStatus === 'QUALITY_PENDING') {
    throw new ProcessCompletionServiceError(
      '质量待判分支尚未放行，不能登记生产完成',
      409,
      'QUALITY_PENDING_BRANCH_LOCKED',
    );
  }
  if (route.workOrder.parentWorkOrderId && input.defectDisposition === 'scrap_replenish') {
    throw new ProcessCompletionServiceError(
      '分支工单再次出现不良时请建立返工分支；补产分支不能继续嵌套补产',
      409,
      'PROCESS_NESTED_SCRAP_REPLENISH_NOT_AVAILABLE',
    );
  }
  if (route.status !== 'in_progress') {
    throw new ProcessCompletionServiceError(
      route.status === 'completed' ? '该工艺路线已经完成' : '工艺路线尚未进入生产',
      409,
      route.status === 'completed' ? 'PROCESS_ROUTE_COMPLETED' : 'PROCESS_ROUTE_NOT_IN_PROGRESS',
    );
  }
  if (route.version !== input.expectedRouteVersion) {
    throw new ProcessCompletionServiceError(
      '工艺路线已被其他操作更新，请刷新后重试',
      409,
      'PROCESS_ROUTE_VERSION_CONFLICT',
    );
  }
  if (!route.steps.length) {
    throw new ProcessCompletionServiceError(
      '工艺路线尚未配置工序',
      409,
      'PROCESS_ROUTE_STEPS_REQUIRED',
    );
  }
  const targetQty = targetQuantity(route.workOrder);
  const firstGroup = firstSequenceGroup(route.steps);
  for (const firstStep of route.steps.filter(step => step.sequenceGroup === firstGroup)) {
    if (firstStep.inputQty < targetQty) {
      const updated = await tx.workOrderProcessStep.updateMany({
        where: {
          id: firstStep.id,
          inputQty: firstStep.inputQty,
          quantityVersion: firstStep.quantityVersion,
        },
        data: {
          inputQty: targetQty,
          quantityVersion: { increment: 1 },
        },
      });
      if (updated.count !== 1) {
        throw new ProcessCompletionServiceError(
          '当前工序数量已变化，请刷新后重试',
          409,
          'PROCESS_STEP_QUANTITY_CONFLICT',
        );
      }
      firstStep.inputQty = targetQty;
      firstStep.quantityVersion += 1;
    }
  }
  const current = route.steps.find(step => step.id === input.stepId);
  if (!current) {
    throw new ProcessCompletionServiceError(
      '当前工序不属于该工艺路线',
      404,
      'PROCESS_STEP_NOT_FOUND',
    );
  }
  if (current.status !== 'current') {
    throw new ProcessCompletionServiceError(
      '该工序已不是当前可完成工序，请刷新后重试',
      409,
      'PROCESS_STEP_NOT_CURRENT',
    );
  }
  const availableInputQty = Math.max(0, current.inputQty - current.processedQty);
  const quantity = resolveCompletionQuantities({
    availableInputQty,
    processedQty: input.processedQty,
    defectQty: input.defectQty,
  });
  const groupSteps = route.steps.filter(step => step.sequenceGroup === current.sequenceGroup);
  const alreadyReleasedQty = Math.min(...groupSteps.map(step => step.releasedGoodQty));
  const directRouteCap = await loadDirectRouteReleaseCap(tx, {
    workOrderId: route.workOrderId,
    targetQty,
    currentSequenceGroup: current.sequenceGroup,
    alreadyReleasedQty: Math.max(...groupSteps.map(step => step.releasedGoodQty)),
    pendingScrapReservationQty: input.defectDisposition === 'scrap_replenish'
      ? quantity.defectQty
      : 0,
  });
  const now = new Date();
  const nextRouteVersion = route.version + 1;
  const completion = await tx.processCompletion.create({
    data: {
      workOrderId: route.workOrderId,
      routeId: route.id,
      stepId: current.id,
      workDate: input.workDate,
      completedAt: now,
      processedQty: quantity.processedQty,
      goodQty: quantity.goodQty,
      defectQty: quantity.defectQty,
      defectDisposition: input.databaseDefectDisposition,
      routeVersion: nextRouteVersion,
      idempotencyKey: input.idempotencyKey,
      standardTimeId: current.standardTimeId,
      standardVersion: current.standardVersion,
      productTimeProfileId: current.productTimeProfileId,
      productTimeEntryId: current.productTimeEntryId,
      productTimeProfileVersion: current.productTimeProfileVersion,
      standardSource: current.standardSource,
      timeBasis: current.timeBasis,
      unitLabel: current.unitLabel,
      standardMillisecondsPerUnit: current.standardMillisecondsPerUnit,
      setupMilliseconds: current.setupMilliseconds,
      unitsPerProduct: current.unitsPerProduct,
      countsForEfficiency: current.countsForEfficiency,
      createdById: input.userId,
    },
  });
  const goodOutputBeforeCompletion = current.goodOutputQty;
  const stepUpdate = await tx.workOrderProcessStep.updateMany({
    where: {
      id: current.id,
      status: 'current',
      quantityVersion: current.quantityVersion,
      processedQty: current.processedQty,
      inputQty: current.inputQty,
    },
    data: {
      processedQty: { increment: quantity.processedQty },
      goodOutputQty: { increment: quantity.goodQty },
      defectOutputQty: { increment: quantity.defectQty },
      quantityVersion: { increment: 1 },
    },
  });
  if (stepUpdate.count !== 1) {
    throw new ProcessCompletionServiceError(
      '当前工序数量已变化，请刷新后重试',
      409,
      'PROCESS_STEP_QUANTITY_CONFLICT',
    );
  }
  current.processedQty += quantity.processedQty;
  current.goodOutputQty += quantity.goodQty;
  current.defectOutputQty += quantity.defectQty;
  current.quantityVersion += 1;

  const release = calculateCappedParallelGroupRelease({
    stepGoodOutputQuantities: groupSteps.map(step => step.goodOutputQty),
    alreadyReleasedQty,
    directRouteCap,
  });
  const targetSteps = nextSequenceGroupSteps(route.steps, current.sequenceGroup);
  let frontendTransferDelta = 0;
  if (release.releaseDeltaQty > 0) {
    if (targetSteps.length) {
      await tx.processQuantityMovement.createMany({
        data: targetSteps.map(targetStep => ({
          completionId: completion.id,
          workOrderId: route.workOrderId,
          sourceStepId: current.id,
          targetStepId: targetStep.id,
          type: 'GOOD_TRANSFER',
          quantity: release.releaseDeltaQty,
          sourceSequenceGroup: current.sequenceGroup,
          targetSequenceGroup: targetStep.sequenceGroup,
          idempotencyKey: `${completion.id}:good:${targetStep.id}`,
        })),
      });
      for (const targetStep of targetSteps) {
        await tx.workOrderProcessStep.update({
          where: { id: targetStep.id },
          data: {
            inputQty: { increment: release.releaseDeltaQty },
            quantityVersion: { increment: 1 },
            status: targetStep.status === 'pending' ? 'current' : targetStep.status,
            startedAt: targetStep.startedAt || now,
          },
        });
        targetStep.inputQty += release.releaseDeltaQty;
        targetStep.quantityVersion += 1;
        if (targetStep.status === 'pending') targetStep.status = 'current';
        targetStep.startedAt = targetStep.startedAt || now;
      }
      const sourceStageGroup = normalizeProcessStageGroup(current.stageGroup);
      const targetStageGroup = normalizeProcessStageGroup(targetSteps[0].stageGroup);
      if (sourceStageGroup === 'frontend' && targetStageGroup && targetStageGroup !== 'frontend') {
        frontendTransferDelta = release.releaseDeltaQty;
      }
    } else if (route.workOrder.branchType !== 'REWORK') {
      await tx.processQuantityMovement.create({
        data: {
          completionId: completion.id,
          workOrderId: route.workOrderId,
          sourceStepId: current.id,
          targetStepId: null,
          type: 'FINISHED_GOOD',
          quantity: release.releaseDeltaQty,
          sourceSequenceGroup: current.sequenceGroup,
          targetSequenceGroup: null,
          idempotencyKey: `${completion.id}:finished`,
        },
      });
    }
    for (const groupStep of groupSteps) {
      await tx.workOrderProcessStep.update({
        where: { id: groupStep.id },
        data: {
          releasedGoodQty: release.releasableGoodQty,
          quantityVersion: { increment: 1 },
        },
      });
      groupStep.releasedGoodQty = release.releasableGoodQty;
      groupStep.quantityVersion += 1;
    }
  }

  let branchWorkOrderId: string | undefined;
  let branchWorkOrderCode: string | undefined;
  if (quantity.defectQty > 0 && input.defectDisposition) {
    const branch = await createDefectBranch(tx, {
      route,
      completionId: completion.id,
      currentStepId: current.id,
      defectQty: quantity.defectQty,
      disposition: input.defectDisposition,
      userId: input.userId,
      actor: input.actor,
      now,
    });
    branchWorkOrderId = branch.workOrderId;
    branchWorkOrderCode = branch.workOrderCode;
    await tx.processQuantityMovement.create({
      data: {
        completionId: completion.id,
        workOrderId: route.workOrderId,
        sourceStepId: current.id,
        targetStepId: branch.firstStepId,
        branchWorkOrderId: branch.workOrderId,
        type: branch.movementType,
        quantity: quantity.defectQty,
        sourceSequenceGroup: current.sequenceGroup,
        targetSequenceGroup: branch.firstSequenceGroup,
        idempotencyKey: `${completion.id}:defect`,
      },
    });
  }

  let laborPoolId: string | null = null;
  let laborPoolPendingStandard = false;
  const upstreamPermanentlyClosed = route.steps
    .filter(step => step.sequenceGroup < current.sequenceGroup)
    .every(step => step.status === 'completed' || step.status === 'skipped');
  const perBatchInputStable = current.timeBasis !== 'per_batch'
    || !await hasActiveUpstreamReworkBranch(tx, route, current.sequenceGroup);
  const laborPoolEligibleQty = current.timeBasis === 'per_batch'
    ? (
        quantity.completesInput
        && upstreamPermanentlyClosed
        && perBatchInputStable
          ? current.goodOutputQty
          : 0
      )
    : quantity.goodQty;
  if (laborPoolEligibleQty > 0) {
    const pool = await createCompletionLaborPool(tx, {
      completionId: completion.id,
      workOrderId: route.workOrderId,
      stepId: current.id,
      workDate: input.workDate,
      eligibleQty: laborPoolEligibleQty,
      timeBasis: current.timeBasis,
      standardMillisecondsPerUnit: current.standardMillisecondsPerUnit,
      setupMilliseconds: current.timeBasis === 'per_batch' || goodOutputBeforeCompletion === 0
        ? current.setupMilliseconds
        : 0,
      unitsPerProduct: current.unitsPerProduct,
      countsForEfficiency: current.countsForEfficiency,
      standardSource: current.standardSource,
      productTimeProfileVersion: current.productTimeProfileVersion,
    });
    laborPoolId = pool.id;
    laborPoolPendingStandard = pool.pendingStandard;
  }

  const routeCompleted = await reconcileQuantityStepStatuses(
    tx,
    route.steps as QuantityStep[],
    { targetQty, userId: input.userId, now },
  );
  await createDeferredPerBatchLaborPools(tx, route, {
    userId: input.userId,
    now,
  });
  const routeUpdate = await tx.workOrderProcessRoute.updateMany({
    where: {
      id: route.id,
      version: route.version,
      status: 'in_progress',
    },
    data: {
      version: { increment: 1 },
      status: routeCompleted ? 'completed' : 'in_progress',
      completedAt: routeCompleted ? now : null,
    },
  });
  if (routeUpdate.count !== 1) {
    throw new ProcessCompletionServiceError(
      '工艺路线已被其他操作更新，请刷新后重试',
      409,
      'PROCESS_ROUTE_VERSION_CONFLICT',
    );
  }
  await updateCompletionWorkOrders(tx, {
    route,
    targetQty,
    finishedGoodDelta: targetSteps.length ? 0 : release.releaseDeltaQty,
    frontendTransferDelta,
    routeCompleted,
    actor: input.actor,
    now,
    propagateFinishedToAncestors: route.workOrder.branchType !== 'REWORK',
  });
  if (
    route.workOrder.branchType === 'REWORK'
    && !targetSteps.length
    && release.releaseDeltaQty > 0
  ) {
    await returnReworkOutputToParent(tx, {
      completionId: completion.id,
      sourceRoute: route,
      sourceStepId: current.id,
      recoveredQty: release.releaseDeltaQty,
      userId: input.userId,
      actor: input.actor,
      now,
    });
  }

  const result: ProcessCompletionResult = {
    completionId: completion.id,
    routeVersion: nextRouteVersion,
    laborPoolId,
    laborPoolPendingStandard,
    ...(branchWorkOrderId ? { branchWorkOrderId } : {}),
    ...(branchWorkOrderCode ? { branchWorkOrderCode } : {}),
    goodTransferredQty: release.releaseDeltaQty,
    remainingInputQty: quantity.remainingInputQty,
    routeCompleted,
  };
  const content = quantity.defectQty > 0
    ? `${current.processName}完成 ${quantity.processedQty}，良品 ${quantity.goodQty}，不良 ${quantity.defectQty}`
    : `${current.processName}完成 ${quantity.processedQty}，良品已转序`;
  await tx.processRouteActivity.create({
    data: {
      routeId: route.id,
      stepId: current.id,
      action: 'complete_process_step',
      content,
      actorId: input.userId,
      detail: {
        ...result,
        defectDisposition: input.databaseDefectDisposition,
        workDate: input.workDateKey,
      },
    },
  });
  await tx.operationLog.create({
    data: {
      userId: input.userId,
      action: 'complete_process_step',
      targetType: 'process_completion',
      targetId: completion.id,
      detail: {
        workOrderId: route.workOrderId,
        routeId: route.id,
        stepId: current.id,
        processedQty: quantity.processedQty,
        goodQty: quantity.goodQty,
        defectQty: quantity.defectQty,
        defectDisposition: input.databaseDefectDisposition,
        laborPoolId,
        laborPoolPendingStandard,
        branchWorkOrderId: branchWorkOrderId || null,
        goodTransferredQty: release.releaseDeltaQty,
        routeVersion: nextRouteVersion,
      },
    },
  });
  return result;
}

export async function completeProcessStep(
  command: CompleteProcessStepCommand,
): Promise<ProcessCompletionResult> {
  const input = parseProcessCompletionCommand(command);
  try {
    return await prisma.$transaction(
      tx => performProcessCompletion(tx, input),
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5_000,
        timeout: 15_000,
      },
    );
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError
      && (error.code === 'P2002' || error.code === 'P2034')) {
      const existing = await prisma.processCompletion.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
        include: replayCompletionInclude,
      });
      if (existing) {
        assertIdempotentPayload(existing, input);
        return resultForExistingCompletion(prisma, existing);
      }
    }
    throw normalizeServiceError(error);
  }
}
