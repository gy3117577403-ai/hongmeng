import {
  AccessProfileKey,
  DailyProcessTaskStatus,
  Prisma,
  ProcessCompletionCoverageStatus,
  ProcessCompletionReportMode,
  ProcessCompletionSource,
  ProcessLaborClaimStatus,
  ProcessLaborPoolStatus,
} from '@prisma/client';
import { dateKeyFromDatabase, parseWorkDate } from '@/lib/attendance';
import { resolveDailyTaskProgress } from '@/lib/daily-plan-domain';
import {
  calculateCompletionLaborSnapshot,
  calculateParallelGroupReleaseDelta,
  planLaborClaim,
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
  isExecutableProductionWorkOrder,
  legacyStatusForStage,
  normalizeWorkOrderStage,
} from '@/lib/work-orders';
import { loadWeeklyProcessWorkerPresetForStep } from '@/lib/weekly-process-worker-preset-service';
import {
  isProductionWorkforceEmployee,
  productionEmployeeWhere,
} from '@/lib/production-workforce';
import { branchBusinessWorkOrderCode } from '@/lib/work-order-business-code';

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
  workStartedAt?: unknown;
  workEndedAt?: unknown;
  employeeIds?: unknown;
  team?: unknown;
  workstation?: unknown;
  remark?: unknown;
  requireParticipants?: boolean;
  allowAdvanceReporting?: boolean;
  autoAssignLabor?: boolean;
  reportSource?: ProcessCompletionSource;
  principalEmployeeId?: unknown;
  fieldReportTerminalId?: unknown;
  pinCredentialVersion?: unknown;
  fieldReportPinSession?: unknown;
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
  coverageStatus: 'pending' | 'partial' | 'covered';
  pendingCoverageQty: number;
  autoAssignedEmployeeCount: number;
  autoAssignedLaborMilliseconds: number;
};

export type CompleteProcessStepsBatchCommand = Omit<CompleteProcessStepCommand,
  'stepId' | 'processedQty' | 'defectQty' | 'defectDisposition'> & {
  items: Array<{
    stepId: unknown;
    processedQty: unknown;
    defectQty?: unknown;
    defectDisposition?: unknown;
  }>;
};

export type ProcessCompletionBatchResult = {
  batchId: string;
  routeVersion: number;
  completionCount: number;
  pendingCoverageQty: number;
  autoAssignedLaborMilliseconds: number;
  autoAssignedEmployeeCount: number;
  items: Array<{
    stepId: string;
    processName: string;
    position: number;
    result: ProcessCompletionResult;
  }>;
};

export type ProcessCompletionContext = {
  routeId: string;
  routeVersion: number;
  step: {
    id: string;
    processName: string;
    position: number;
    sequenceGroup: number;
    executionMode: 'NORMAL' | 'SUPPLEMENTAL_OBLIGATION';
    supplementObligation: {
      id: string;
      requiredQty: number;
      reportedQty: number;
      remainingQty: number;
      status: 'ACTIVE' | 'FULFILLED' | 'CANCELLED';
      version: number;
    } | null;
    status: string;
    startedAt: string | null;
  };
  routeSteps: Array<{
    id: string;
    processName: string;
    position: number;
    sequenceGroup: number;
    executionMode: 'NORMAL' | 'SUPPLEMENTAL_OBLIGATION';
    supplementObligation: {
      id: string;
      requiredQty: number;
      reportedQty: number;
      remainingQty: number;
      status: 'ACTIVE' | 'FULFILLED' | 'CANCELLED';
      version: number;
    } | null;
    status: string;
    unitLabel: string | null;
    inputQty: number;
    processedQty: number;
    reportedQty: number;
    coveredReportedQty: number;
    pendingCoverageQty: number;
    reportableQty: number;
    availableCoverageQty: number;
  }>;
  targetQty: number;
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
  reportedQty: number;
  coveredReportedQty: number;
  pendingCoverageQty: number;
  reportableQty: number;
  employees: Array<{
    id: string;
    employeeNo: string;
    name: string;
    department: string | null;
    position: string | null;
    team: string | null;
  }>;
  workerPreset: {
    weekStartDate: string;
    scope: 'PROCESS' | 'STEP';
    version: number;
    employees: Array<{
      id: string;
      employeeNo: string;
      name: string;
      team: string | null;
      position: string | null;
      priority: number;
    }>;
  } | null;
  recentCompletions: Array<{
    id: string;
    processedQty: number;
    goodQty: number;
    defectQty: number;
    reportMode: 'sequential' | 'advance';
    coverageStatus: 'pending' | 'partial' | 'covered';
    coveredQty: number;
    pendingCoverageQty: number;
    defectDisposition: ProcessDefectDispositionInput | null;
    workDate: string;
    completedAt: string;
    workStartedAt: string | null;
    workEndedAt: string | null;
    team: string | null;
    workstation: string | null;
    remark: string | null;
    participants: Array<{
      id: string;
      employeeNo: string;
      name: string;
      team: string | null;
    }>;
    branchWorkOrder?: {
      id: string;
      code: string;
      businessCode: string | null;
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
  workStartedAt: Date | null;
  workEndedAt: Date | null;
  employeeIds: string[];
  team: string | null;
  workstation: string | null;
  remark: string | null;
  allowAdvanceReporting: boolean;
  autoAssignLabor: boolean;
  reportSource: ProcessCompletionSource;
  principalEmployeeId: string | null;
  fieldReportTerminalId: string | null;
  pinCredentialVersion: number | null;
  fieldReportPinSession: ParsedFieldReportPinSessionEvidence | null;
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
  executionMode: 'NORMAL' | 'SUPPLEMENTAL_OBLIGATION';
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
  steps: { where: { retiredAt: null }, orderBy: [{ sequenceGroup: 'asc' }, { position: 'asc' }] },
});

type CompletionRouteRecord = Prisma.WorkOrderProcessRouteGetPayload<{
  include: typeof completionRouteInclude;
}>;

const replayCompletionInclude = Prisma.validator<Prisma.ProcessCompletionInclude>()({
  laborPool: {
    select: {
      id: true,
      status: true,
      standardSource: true,
      claimedStandardLaborMilliseconds: true,
      claims: {
        where: { status: ProcessLaborClaimStatus.ACTIVE, source: 'completion_auto' },
        select: { employeeId: true },
      },
    },
  },
  branchWorkOrder: { select: { id: true, code: true, businessCode: true } },
  participants: {
    select: { employeeId: true, position: true },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
  },
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

export type SharedTerminalPrincipalSnapshot = {
  credential: {
    credentialVersion: number;
    isActive: boolean;
    lockedUntil: Date | null;
  } | null;
  terminal: {
    isActive: boolean;
    lockedUntil: Date | null;
  } | null;
  employeeExists: boolean;
  user: {
    id: string;
    isActive: boolean;
    accountStatus: string;
    employeeId: string | null;
    fieldReporterGrantCount: number;
  } | null;
};

export type ParsedFieldReportPinSessionEvidence = {
  sessionId: string;
  tokenHash: string;
  terminalId: string;
  terminalVersion: number;
  credentialId: string;
  credentialVersion: number;
  employeeId: string;
  userId: string;
  ticketId: string;
};

export function sharedTerminalPrincipalSnapshotIsValid(input: {
  principalEmployeeId: string;
  pinCredentialVersion: number;
  userId: string;
}, snapshot: SharedTerminalPrincipalSnapshot, now = new Date()): boolean {
  return Boolean(
    snapshot.credential?.isActive
    && snapshot.credential.credentialVersion === input.pinCredentialVersion
    && (!snapshot.credential.lockedUntil || snapshot.credential.lockedUntil.getTime() <= now.getTime())
    && snapshot.terminal?.isActive
    && (!snapshot.terminal.lockedUntil || snapshot.terminal.lockedUntil.getTime() <= now.getTime())
    && snapshot.employeeExists
    && snapshot.user?.id === input.userId
    && snapshot.user.isActive
    && snapshot.user.accountStatus === 'ACTIVE'
    && snapshot.user.employeeId === input.principalEmployeeId
    && snapshot.user.fieldReporterGrantCount === 1
  );
}

export function completionPrincipalIdentityMatches(
  stored: {
    principalEmployeeId: string | null;
    fieldReportTerminalId: string | null;
    pinCredentialVersion: number | null;
  },
  requested: {
    principalEmployeeId: string | null;
    fieldReportTerminalId: string | null;
    pinCredentialVersion: number | null;
  },
): boolean {
  return stored.principalEmployeeId === requested.principalEmployeeId
    && stored.fieldReportTerminalId === requested.fieldReportTerminalId
    && stored.pinCredentialVersion === requested.pinCredentialVersion;
}

export type SharedTerminalPinSessionSnapshot = {
  id: string;
  tokenHash: string;
  terminalId: string;
  terminalVersion: number;
  credentialId: string;
  credentialVersion: number;
  employeeId: string;
  userId: string;
  ticketId: string;
  expiresAt: Date;
  consumedAt: Date | null;
  revokedAt: Date | null;
  ticketStatus: string;
  ticketRouteId: string | null;
};

export function sharedTerminalPinSessionSnapshotIsValid(
  evidence: ParsedFieldReportPinSessionEvidence,
  snapshot: SharedTerminalPinSessionSnapshot | null,
  input: { routeId: string },
  mode: 'consume' | 'replay',
  now = new Date(),
): boolean {
  return Boolean(
    snapshot
    && snapshot.id === evidence.sessionId
    && snapshot.tokenHash === evidence.tokenHash
    && snapshot.terminalId === evidence.terminalId
    && snapshot.terminalVersion === evidence.terminalVersion
    && snapshot.credentialId === evidence.credentialId
    && snapshot.credentialVersion === evidence.credentialVersion
    && snapshot.employeeId === evidence.employeeId
    && snapshot.userId === evidence.userId
    && snapshot.ticketId === evidence.ticketId
    && snapshot.expiresAt.getTime() > now.getTime()
    && snapshot.revokedAt === null
    && (mode === 'consume' ? snapshot.consumedAt === null : snapshot.consumedAt !== null)
    && snapshot.ticketStatus === 'ACTIVE'
    && snapshot.ticketRouteId === input.routeId
  );
}

type BranchRoutePlanStep<T> = T & {
  sourceStepId: string;
  position: number;
  sequenceGroup: number;
};

function cleanText(value: unknown, max: number): string {
  return String(value ?? '').trim().slice(0, max);
}

function parseOptionalDateTime(
  value: unknown,
  label: string,
  code: string,
): Date | null {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) {
    throw new ProcessCompletionServiceError(`${label}必须是有效时间`, 400, code);
  }
  return parsed;
}

function parseCompletionEmployeeIds(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new ProcessCompletionServiceError(
      '作业员工格式不正确',
      400,
      'PROCESS_COMPLETION_EMPLOYEES_INVALID',
    );
  }
  const ids = [...new Set(value.map(item => cleanText(item, 80)).filter(Boolean))];
  if (ids.length > 20) {
    throw new ProcessCompletionServiceError(
      '单次最多选择 20 名作业员工',
      400,
      'PROCESS_COMPLETION_EMPLOYEES_LIMIT',
    );
  }
  return ids;
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

export type CompletionCoveragePlan = {
  deltaQty: number;
  deltaGoodQty: number;
  deltaDefectQty: number;
  coveredQty: number;
  coveredGoodQty: number;
  coveredDefectQty: number;
  pendingQty: number;
  status: 'PENDING' | 'PARTIAL' | 'COVERED';
};

/**
 * Covers an out-of-order report with material that has actually arrived.
 * Good quantity is covered first. Defect quantity is deliberately kept as
 * one indivisible tail so its branch is created exactly once when enough
 * upstream material exists.
 */
export function planCompletionCoverage(input: {
  processedQty: number;
  goodQty: number;
  defectQty: number;
  coveredQty?: number;
  coveredGoodQty?: number;
  coveredDefectQty?: number;
  availableQty: number;
}): CompletionCoveragePlan {
  const values = [
    input.processedQty,
    input.goodQty,
    input.defectQty,
    input.coveredQty || 0,
    input.coveredGoodQty || 0,
    input.coveredDefectQty || 0,
    input.availableQty,
  ];
  if (!values.every(value => Number.isSafeInteger(value) && value >= 0)) {
    throw new ProcessCompletionServiceError(
      '待核销报工数量状态不正确',
      409,
      'PROCESS_COMPLETION_COVERAGE_INVALID',
    );
  }
  const coveredQty = input.coveredQty || 0;
  const coveredGoodQty = input.coveredGoodQty || 0;
  const coveredDefectQty = input.coveredDefectQty || 0;
  if (
    input.goodQty + input.defectQty !== input.processedQty
    || coveredGoodQty + coveredDefectQty !== coveredQty
    || coveredQty > input.processedQty
    || coveredGoodQty > input.goodQty
    || coveredDefectQty > input.defectQty
  ) {
    throw new ProcessCompletionServiceError(
      '待核销报工数量关系不正确',
      409,
      'PROCESS_COMPLETION_COVERAGE_MISMATCH',
    );
  }
  let capacity = Math.min(input.availableQty, input.processedQty - coveredQty);
  const remainingGoodQty = input.goodQty - coveredGoodQty;
  const remainingDefectQty = input.defectQty - coveredDefectQty;
  const deltaGoodQty = Math.min(remainingGoodQty, capacity);
  capacity -= deltaGoodQty;
  const deltaDefectQty = remainingDefectQty > 0 && capacity >= remainingDefectQty
    ? remainingDefectQty
    : 0;
  const deltaQty = deltaGoodQty + deltaDefectQty;
  const nextCoveredQty = coveredQty + deltaQty;
  const pendingQty = input.processedQty - nextCoveredQty;
  return {
    deltaQty,
    deltaGoodQty,
    deltaDefectQty,
    coveredQty: nextCoveredQty,
    coveredGoodQty: coveredGoodQty + deltaGoodQty,
    coveredDefectQty: coveredDefectQty + deltaDefectQty,
    pendingQty,
    status: pendingQty === 0 ? 'COVERED' : nextCoveredQty === 0 ? 'PENDING' : 'PARTIAL',
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

function parseFieldReportPinSessionEvidence(
  value: unknown,
): ParsedFieldReportPinSessionEvidence | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const sessionId = cleanText(source.sessionId, 80);
  const tokenHash = cleanText(source.tokenHash, 128).toLowerCase();
  const terminalId = cleanText(source.terminalId, 80);
  const terminalVersion = Number(source.terminalVersion);
  const credentialId = cleanText(source.credentialId, 80);
  const credentialVersion = Number(source.credentialVersion);
  const employeeId = cleanText(source.employeeId, 80);
  const userId = cleanText(source.userId, 80);
  const ticketId = cleanText(source.ticketId, 80);
  if (
    !sessionId
    || !/^[a-f0-9]{64}$/.test(tokenHash)
    || !terminalId
    || !Number.isSafeInteger(terminalVersion)
    || terminalVersion <= 0
    || !credentialId
    || !Number.isSafeInteger(credentialVersion)
    || credentialVersion <= 0
    || !employeeId
    || !userId
    || !ticketId
  ) return null;
  return {
    sessionId,
    tokenHash,
    terminalId,
    terminalVersion,
    credentialId,
    credentialVersion,
    employeeId,
    userId,
    ticketId,
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
  const employeeIds = parseCompletionEmployeeIds(command.employeeIds);
  const workStartedAt = parseOptionalDateTime(
    command.workStartedAt,
    '作业开始时间',
    'PROCESS_COMPLETION_STARTED_AT_INVALID',
  );
  const workEndedAt = parseOptionalDateTime(
    command.workEndedAt,
    '作业结束时间',
    'PROCESS_COMPLETION_ENDED_AT_INVALID',
  );
  if ((workStartedAt && !workEndedAt) || (!workStartedAt && workEndedAt)) {
    throw new ProcessCompletionServiceError(
      '作业开始时间和结束时间必须同时填写',
      400,
      'PROCESS_COMPLETION_TIME_RANGE_REQUIRED',
    );
  }
  if (workStartedAt && workEndedAt) {
    const duration = workEndedAt.getTime() - workStartedAt.getTime();
    if (duration <= 0) {
      throw new ProcessCompletionServiceError(
        '作业结束时间必须晚于开始时间',
        400,
        'PROCESS_COMPLETION_TIME_RANGE_INVALID',
      );
    }
    if (duration > 72 * 60 * 60 * 1000) {
      throw new ProcessCompletionServiceError(
        '单次作业时间不能超过 72 小时',
        400,
        'PROCESS_COMPLETION_TIME_RANGE_TOO_LONG',
      );
    }
  }
  if (command.requireParticipants && !employeeIds.length) {
    throw new ProcessCompletionServiceError(
      '请选择至少一名作业员工',
      400,
      'PROCESS_COMPLETION_EMPLOYEE_REQUIRED',
    );
  }
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
  const reportSource = command.reportSource === ProcessCompletionSource.QR_MOBILE
    ? ProcessCompletionSource.QR_MOBILE
    : command.reportSource === ProcessCompletionSource.SHARED_TERMINAL_PIN
      ? ProcessCompletionSource.SHARED_TERMINAL_PIN
      : ProcessCompletionSource.DESKTOP;
  const principalEmployeeId = reportSource === ProcessCompletionSource.SHARED_TERMINAL_PIN
    ? cleanText(command.principalEmployeeId, 80)
    : '';
  const fieldReportTerminalId = reportSource === ProcessCompletionSource.SHARED_TERMINAL_PIN
    ? cleanText(command.fieldReportTerminalId, 80)
    : '';
  const pinCredentialVersionValue = Number(command.pinCredentialVersion);
  const pinCredentialVersion = reportSource === ProcessCompletionSource.SHARED_TERMINAL_PIN
    && Number.isSafeInteger(pinCredentialVersionValue)
    && pinCredentialVersionValue > 0
    ? pinCredentialVersionValue
    : null;
  const fieldReportPinSession = reportSource === ProcessCompletionSource.SHARED_TERMINAL_PIN
    ? parseFieldReportPinSessionEvidence(command.fieldReportPinSession)
    : null;
  if (
    reportSource === ProcessCompletionSource.SHARED_TERMINAL_PIN
    && (
      !principalEmployeeId
      || !fieldReportTerminalId
      || pinCredentialVersion === null
      || !fieldReportPinSession
      || fieldReportPinSession.employeeId !== principalEmployeeId
      || fieldReportPinSession.userId !== userId
      || fieldReportPinSession.terminalId !== fieldReportTerminalId
      || fieldReportPinSession.credentialVersion !== pinCredentialVersion
    )
  ) {
    throw new ProcessCompletionServiceError(
      '共享终端报工身份已失效，请重新验证',
      401,
      'PROCESS_COMPLETION_PIN_PRINCIPAL_REQUIRED',
    );
  }
  if (
    reportSource === ProcessCompletionSource.SHARED_TERMINAL_PIN
    && !employeeIds.includes(principalEmployeeId)
  ) {
    throw new ProcessCompletionServiceError(
      '共享终端报工人必须包含在本次作业人员中',
      400,
      'PROCESS_COMPLETION_PIN_PRINCIPAL_PARTICIPANT_REQUIRED',
    );
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
    workStartedAt,
    workEndedAt,
    employeeIds,
    team: cleanText(command.team, 80) || null,
    workstation: cleanText(command.workstation, 80) || null,
    remark: cleanText(command.remark, 500) || null,
    allowAdvanceReporting: command.allowAdvanceReporting === true,
    autoAssignLabor: command.autoAssignLabor === true,
    reportSource,
    principalEmployeeId: principalEmployeeId || null,
    fieldReportTerminalId: fieldReportTerminalId || null,
    pinCredentialVersion,
    fieldReportPinSession,
    idempotencyKey: parseIdempotencyKey(command.idempotencyKey),
    expectedRouteVersion: parseExpectedRouteVersion(command.expectedRouteVersion),
    userId,
    actor: cleanText(command.actor, 120) || userId,
  };
}

function normalQuantitySteps<T extends Pick<QuantityStep, 'executionMode'>>(
  steps: readonly T[],
): T[] {
  return steps.filter(step => step.executionMode === 'NORMAL');
}

function firstNormalSequenceGroup<T extends Pick<QuantityStep, 'sequenceGroup' | 'executionMode'>>(
  steps: readonly T[],
): number | null {
  const normalSteps = normalQuantitySteps(steps);
  return normalSteps.length
    ? Math.min(...normalSteps.map(step => step.sequenceGroup))
    : null;
}

function nextNormalSequenceGroupSteps<T extends Pick<
  QuantityStep,
  'sequenceGroup' | 'position' | 'executionMode'
>>(
  steps: readonly T[],
  sequenceGroup: number,
): T[] {
  const normalSteps = normalQuantitySteps(steps);
  const futureGroups = normalSteps
    .map(step => step.sequenceGroup)
    .filter(group => group > sequenceGroup);
  if (!futureGroups.length) return [];
  const nextGroup = Math.min(...futureGroups);
  return normalSteps
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

function lowercaseCoverageStatus(
  value: ProcessCompletionCoverageStatus,
): 'pending' | 'partial' | 'covered' {
  if (value === ProcessCompletionCoverageStatus.PENDING) return 'pending';
  if (value === ProcessCompletionCoverageStatus.PARTIAL) return 'partial';
  return 'covered';
}

function lowercaseReportMode(
  value: ProcessCompletionReportMode,
): 'sequential' | 'advance' {
  return value === ProcessCompletionReportMode.ADVANCE ? 'advance' : 'sequential';
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
  const coverageStatus = record.coverageStatus === 'pending' || record.coverageStatus === 'partial'
    ? record.coverageStatus
    : 'covered';
  const pendingCoverageQty = Number(record.pendingCoverageQty ?? 0);
  const autoAssignedEmployeeCount = Number(record.autoAssignedEmployeeCount ?? 0);
  const autoAssignedLaborMilliseconds = Number(record.autoAssignedLaborMilliseconds ?? 0);
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
    coverageStatus,
    pendingCoverageQty: Number.isSafeInteger(pendingCoverageQty) && pendingCoverageQty >= 0
      ? pendingCoverageQty
      : 0,
    autoAssignedEmployeeCount: Number.isSafeInteger(autoAssignedEmployeeCount)
      && autoAssignedEmployeeCount >= 0
      ? autoAssignedEmployeeCount
      : 0,
    autoAssignedLaborMilliseconds: Number.isSafeInteger(autoAssignedLaborMilliseconds)
      && autoAssignedLaborMilliseconds >= 0
      ? autoAssignedLaborMilliseconds
      : 0,
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
    ...(completion.branchWorkOrder?.code ? { branchWorkOrderCode: completion.branchWorkOrder.businessCode || completion.branchWorkOrder.code } : {}),
    goodTransferredQty: normalMovementQuantities.length ? Math.max(...normalMovementQuantities) : 0,
    remainingInputQty: Math.max(0, completion.step.inputQty - completion.step.processedQty),
    routeCompleted: completion.route.status === 'completed',
    coverageStatus: lowercaseCoverageStatus(completion.coverageStatus),
    pendingCoverageQty: Math.max(0, completion.processedQty - completion.coveredQty),
    autoAssignedEmployeeCount: new Set(
      completion.laborPool?.claims.map(claim => claim.employeeId) || [],
    ).size,
    autoAssignedLaborMilliseconds: Number(
      completion.laborPool?.claimedStandardLaborMilliseconds || 0n,
    ),
  };
}

function assertIdempotentPayload(
  completion: ReplayCompletionRecord,
  input: ParsedCompletionCommand,
): void {
  const storedEmployeeIds = completion.participants.map(item => item.employeeId).sort();
  const inputEmployeeIds = [...input.employeeIds].sort();
  const matches = completion.routeId === input.routeId
    && completion.stepId === input.stepId
    && completion.processedQty === input.processedQty
    && completion.defectQty === input.defectQty
    && completion.defectDisposition === input.databaseDefectDisposition
    && dateKeyFromDatabase(completion.workDate) === input.workDateKey
    && (completion.workStartedAt?.getTime() || null) === (input.workStartedAt?.getTime() || null)
    && (completion.workEndedAt?.getTime() || null) === (input.workEndedAt?.getTime() || null)
    && completion.team === input.team
    && completion.workstation === input.workstation
    && completion.remark === input.remark
    && completion.reportSource === input.reportSource
    && completion.createdById === input.userId
    && completionPrincipalIdentityMatches(completion, input)
    && storedEmployeeIds.length === inputEmployeeIds.length
    && storedEmployeeIds.every((id, index) => id === inputEmployeeIds[index]);
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
  options: { allowAdvanceReporting?: boolean } = {},
): Promise<ProcessCompletionContext> {
  const routeId = cleanText(routeIdInput, 80);
  const stepId = cleanText(stepIdInput, 80);
  const [route, employees, completionTotals] = await Promise.all([
    prisma.workOrderProcessRoute.findUnique({
      where: { id: routeId },
      include: {
        workOrder: {
          include: {
            productionPlanBatch: true,
            rootWorkOrder: {
              include: { productionPlanBatch: true },
            },
          },
        },
        steps: {
          where: { retiredAt: null },
          orderBy: [{ sequenceGroup: 'asc' }, { position: 'asc' }],
          include: {
            supplementObligation: true,
            completions: {
              where: { voidedAt: null },
              orderBy: [{ completedAt: 'desc' }, { createdAt: 'desc' }],
              take: 20,
              include: {
                branchWorkOrder: {
                  select: {
                    id: true,
                    code: true,
                    businessCode: true,
                    branchType: true,
                    branchStatus: true,
                  },
                },
                participants: {
                  include: { employee: true },
                  orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
                },
              },
            },
          },
        },
      },
    }),
    prisma.employee.findMany({
      where: productionEmployeeWhere(),
      orderBy: [{ employeeNo: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        employeeNo: true,
        name: true,
        department: true,
        position: true,
        team: true,
      },
    }),
    prisma.processCompletion.groupBy({
      by: ['stepId'],
      where: { routeId, voidedAt: null },
      _sum: { processedQty: true, coveredQty: true },
    }),
  ]);
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
  const target = targetQuantity(route.workOrder);
  const totalByStep = new Map(completionTotals.map(total => [
    total.stepId,
    {
      reportedQty: total._sum.processedQty || 0,
      coveredReportedQty: total._sum.coveredQty || 0,
    },
  ]));
  const selected = stepId
    ? route.steps.find(step => step.id === stepId)
    : options.allowAdvanceReporting
      ? route.steps.find(step => (
          step.status === 'current'
          && (totalByStep.get(step.id)?.reportedQty || 0) < target
        )) || route.steps.find(step => (totalByStep.get(step.id)?.reportedQty || 0) < target)
      : route.steps.find(step => step.status === 'current');
  if (!selected) {
    throw new ProcessCompletionServiceError(
      stepId ? '当前工序不属于该工艺路线' : '当前没有可完成的生产工序',
      stepId ? 404 : 409,
      stepId ? 'PROCESS_STEP_NOT_FOUND' : 'PROCESS_CURRENT_STEP_REQUIRED',
    );
  }
  if (!options.allowAdvanceReporting && selected.status !== 'current') {
    throw new ProcessCompletionServiceError(
      '该工序已不是当前可完成工序，请刷新后重试',
      409,
      'PROCESS_STEP_NOT_CURRENT',
    );
  }
  const firstGroup = firstNormalSequenceGroup(route.steps);
  const availableInputQty = selected.executionMode === 'SUPPLEMENTAL_OBLIGATION'
    ? selected.supplementObligation?.requiredQty || target
    : effectiveInputQuantity(selected, firstGroup, target);
  const selectedTotals = totalByStep.get(selected.id) || {
    reportedQty: 0,
    coveredReportedQty: 0,
  };
  const selectedTarget = selected.executionMode === 'SUPPLEMENTAL_OBLIGATION'
    ? selected.supplementObligation?.requiredQty || target
    : target;
  const reportableQty = Math.max(0, selectedTarget - selectedTotals.reportedQty);
  if (options.allowAdvanceReporting && reportableQty <= 0) {
    throw new ProcessCompletionServiceError(
      '该工序的累计报工数量已达到生产目标',
      409,
      'PROCESS_STEP_REPORT_TARGET_REACHED',
    );
  }
  const nextSteps = nextNormalSequenceGroupSteps(route.steps, selected.sequenceGroup);
  const presetWeekDate = route.workOrder.productionPlanBatch?.weekStartDate
    || route.workOrder.weekStartDate
    || route.workOrder.rootWorkOrder?.productionPlanBatch?.weekStartDate
    || route.workOrder.rootWorkOrder?.weekStartDate
    || null;
  const workerPreset = await loadWeeklyProcessWorkerPresetForStep({
    weekDate: presetWeekDate,
    processDefinitionId: selected.processDefinitionId,
    processCode: selected.processCode,
    processName: selected.processName,
    stepId: selected.id,
  });
  return {
    routeId: route.id,
    routeVersion: route.version,
    step: {
      id: selected.id,
      processName: selected.processName,
      position: selected.position,
      sequenceGroup: selected.sequenceGroup,
      executionMode: selected.executionMode,
      supplementObligation: selected.supplementObligation ? {
        id: selected.supplementObligation.id,
        requiredQty: selected.supplementObligation.requiredQty,
        reportedQty: selected.supplementObligation.reportedQty,
        remainingQty: Math.max(
          0,
          selected.supplementObligation.requiredQty - selected.supplementObligation.reportedQty,
        ),
        status: selected.supplementObligation.status,
        version: selected.supplementObligation.version,
      } : null,
      status: selected.status,
      startedAt: selected.startedAt?.toISOString() || null,
    },
    routeSteps: route.steps.map(step => {
      const totals = totalByStep.get(step.id) || { reportedQty: 0, coveredReportedQty: 0 };
      const supplemental = step.executionMode === 'SUPPLEMENTAL_OBLIGATION'
        ? step.supplementObligation
        : null;
      const stepTarget = supplemental?.requiredQty || target;
      const stepAvailableInput = supplemental?.requiredQty
        || effectiveInputQuantity(step, firstGroup, target);
      return {
        id: step.id,
        processName: step.processName,
        position: step.position,
        sequenceGroup: step.sequenceGroup,
        executionMode: step.executionMode,
        supplementObligation: supplemental ? {
          id: supplemental.id,
          requiredQty: supplemental.requiredQty,
          reportedQty: supplemental.reportedQty,
          remainingQty: Math.max(0, supplemental.requiredQty - supplemental.reportedQty),
          status: supplemental.status,
          version: supplemental.version,
        } : null,
        status: step.status,
        unitLabel: step.unitLabel,
        inputQty: stepAvailableInput,
        processedQty: supplemental ? totals.reportedQty : step.processedQty,
        reportedQty: totals.reportedQty,
        coveredReportedQty: supplemental ? totals.reportedQty : totals.coveredReportedQty,
        pendingCoverageQty: supplemental
          ? 0
          : Math.max(0, totals.reportedQty - totals.coveredReportedQty),
        reportableQty: Math.max(0, stepTarget - totals.reportedQty),
        availableCoverageQty: supplemental
          ? Math.max(0, stepTarget - totals.reportedQty)
          : Math.max(0, stepAvailableInput - step.processedQty),
      };
    }),
    targetQty: target,
    nextSteps: nextSteps.map(step => ({
      id: step.id,
      processName: step.processName,
      sequenceGroup: step.sequenceGroup,
    })),
    availableInputQty,
    processedQty: selected.executionMode === 'SUPPLEMENTAL_OBLIGATION'
      ? selectedTotals.reportedQty
      : selected.processedQty,
    remainingInputQty: Math.max(
      0,
      availableInputQty - (selected.executionMode === 'SUPPLEMENTAL_OBLIGATION'
        ? selectedTotals.reportedQty
        : selected.processedQty),
    ),
    goodQty: selected.executionMode === 'SUPPLEMENTAL_OBLIGATION'
      ? selectedTotals.reportedQty
      : selected.goodOutputQty,
    defectQty: selected.executionMode === 'SUPPLEMENTAL_OBLIGATION'
      ? 0
      : selected.defectOutputQty,
    reportedQty: selectedTotals.reportedQty,
    coveredReportedQty: selectedTotals.coveredReportedQty,
    pendingCoverageQty: Math.max(0, selectedTotals.reportedQty - selectedTotals.coveredReportedQty),
    reportableQty,
    employees,
    workerPreset: workerPreset ? {
      weekStartDate: workerPreset.weekStartDate,
      scope: workerPreset.scope,
      version: workerPreset.version,
      employees: workerPreset.employees
        .filter(employee => employee.isActive)
        .map(employee => ({
          id: employee.id,
          employeeNo: employee.employeeNo,
          name: employee.name,
          team: employee.team,
          position: employee.position,
          priority: employee.priority,
        })),
    } : null,
    recentCompletions: selected.completions.map(completion => ({
      id: completion.id,
      processedQty: completion.processedQty,
      goodQty: completion.goodQty,
      defectQty: completion.defectQty,
      reportMode: lowercaseReportMode(completion.reportMode),
      coverageStatus: lowercaseCoverageStatus(completion.coverageStatus),
      coveredQty: completion.coveredQty,
      pendingCoverageQty: Math.max(0, completion.processedQty - completion.coveredQty),
      defectDisposition: lowercaseDisposition(completion.defectDisposition),
      workDate: dateKeyFromDatabase(completion.workDate),
      completedAt: completion.completedAt.toISOString(),
      workStartedAt: completion.workStartedAt?.toISOString() || null,
      workEndedAt: completion.workEndedAt?.toISOString() || null,
      team: completion.team,
      workstation: completion.workstation,
      remark: completion.remark,
      participants: completion.participants.map(participant => ({
        id: participant.employee.id,
        employeeNo: participant.employee.employeeNo,
        name: participant.employee.name,
        team: participant.employee.team,
      })),
      ...(completion.branchWorkOrder ? {
        branchWorkOrder: {
          id: completion.branchWorkOrder.id,
          code: completion.branchWorkOrder.code,
          businessCode: completion.branchWorkOrder.businessCode,
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
    normalQuantitySteps(input.route.steps as BranchSourceStep[]),
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
  const firstGroup = firstNormalSequenceGroup(sourceSteps);
  const firstSource = sourceSteps[0];
  const firstStage = processStageForGroup(
    normalizeProcessStageGroup(firstSource.stageGroup) || 'frontend',
  );
  const nextOriginalSteps = nextNormalSequenceGroupSteps(
    input.route.steps,
    input.route.steps.find(step => step.id === input.currentStepId)?.sequenceGroup || 0,
  );
  const branchOrder = await tx.workOrder.create({
    data: {
      code: branchCode(input.route.workOrder.code, configuration.codeTag, branchSequence),
      businessCode: branchBusinessWorkOrderCode(
        input.route.workOrder.businessCode,
        input.route.workOrder,
        configuration.codeTag,
        branchSequence,
      ),
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
      steps: { where: { retiredAt: null }, orderBy: [{ sequenceGroup: 'asc' }, { position: 'asc' }] },
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
    workOrderCode: branchOrder.businessCode || branchOrder.code,
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
      step.executionMode === 'SUPPLEMENTAL_OBLIGATION'
        ? step.status === 'completed' || step.status === 'skipped'
        : step.processedQty >= step.inputQty
    ));
    for (const step of groupSteps) {
      // A late-inserted supplemental step is closed by its independent
      // obligation ledger. Its input/processed quantities intentionally stay
      // outside the ordinary material-flow ledger, so zero input must never
      // cause this reconciler to auto-skip it.
      if (step.executionMode === 'SUPPLEMENTAL_OBLIGATION') continue;
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

export async function autoAssignCompletionLaborPool(
  tx: Prisma.TransactionClient,
  input: {
    poolId: string;
    completionId: string;
    employeeIds: string[];
    userId: string;
    now: Date;
  },
): Promise<{ employeeCount: number; standardLaborMilliseconds: number }> {
  if (!input.employeeIds.length) {
    return { employeeCount: 0, standardLaborMilliseconds: 0 };
  }
  const pool = await tx.processLaborPool.findUnique({
    where: { id: input.poolId },
    select: {
      id: true,
      workDate: true,
      eligibleQty: true,
      claimedQty: true,
      remainingQty: true,
      totalStandardLaborMilliseconds: true,
      claimedStandardLaborMilliseconds: true,
      status: true,
      standardSource: true,
      version: true,
    },
  });
  if (
    !pool
    || pool.remainingQty <= 0
    || pool.status === ProcessLaborPoolStatus.LOCKED
    || pool.standardSource === 'pending_standard'
  ) {
    return { employeeCount: 0, standardLaborMilliseconds: 0 };
  }

  const participants = [...new Set(input.employeeIds)];
  const baseQty = Math.floor(pool.remainingQty / participants.length);
  const remainder = pool.remainingQty % participants.length;
  let claimedQty = pool.claimedQty;
  let claimedLabor = pool.claimedStandardLaborMilliseconds;
  let assignedLabor = 0n;
  let assignedEmployeeCount = 0;

  for (let index = 0; index < participants.length; index += 1) {
    const claimQty = baseQty + (index < remainder ? 1 : 0);
    if (claimQty <= 0) continue;
    const plan = planLaborClaim({
      eligibleQty: pool.eligibleQty,
      claimedQty,
      claimQty,
      totalStandardLaborMilliseconds: pool.totalStandardLaborMilliseconds,
      claimedStandardLaborMilliseconds: claimedLabor,
    });
    await tx.processLaborClaim.create({
      data: {
        poolId: pool.id,
        employeeId: participants[index],
        quantity: claimQty,
        standardLaborMilliseconds: plan.claimStandardLaborMilliseconds,
        workDate: pool.workDate,
        status: ProcessLaborClaimStatus.ACTIVE,
        source: 'completion_auto',
        idempotencyKey: `completion-auto:${input.completionId}:${participants[index]}`,
        claimedById: input.userId,
        claimedAt: input.now,
      },
    });
    claimedQty = plan.nextClaimedQty;
    claimedLabor = plan.nextClaimedStandardLaborMilliseconds;
    assignedLabor += plan.claimStandardLaborMilliseconds;
    assignedEmployeeCount += 1;
  }

  const remainingQty = pool.eligibleQty - claimedQty;
  const remainingLabor = pool.totalStandardLaborMilliseconds - claimedLabor;
  const updated = await tx.processLaborPool.updateMany({
    where: { id: pool.id, version: pool.version },
    data: {
      claimedQty,
      remainingQty,
      claimedStandardLaborMilliseconds: claimedLabor,
      remainingStandardLaborMilliseconds: remainingLabor,
      status: remainingQty === 0
        ? ProcessLaborPoolStatus.EXHAUSTED
        : ProcessLaborPoolStatus.PARTIAL,
      version: { increment: 1 },
    },
  });
  if (updated.count !== 1) {
    throw new ProcessCompletionServiceError(
      '自动记工状态已变化，请刷新后重试',
      409,
      'PROCESS_LABOR_POOL_VERSION_CONFLICT',
    );
  }
  const standardLaborMilliseconds = Number(assignedLabor);
  if (!Number.isSafeInteger(standardLaborMilliseconds)) {
    throw new ProcessCompletionServiceError(
      '自动记工数值超过系统可处理范围',
      409,
      'PROCESS_LABOR_DURATION_OVERFLOW',
    );
  }
  return { employeeCount: assignedEmployeeCount, standardLaborMilliseconds };
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
    step.executionMode === 'NORMAL'
    && step.timeBasis === 'per_batch'
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
          autoAssignLabor: true,
          timeBasis: true,
          standardMillisecondsPerUnit: true,
          setupMilliseconds: true,
          unitsPerProduct: true,
          countsForEfficiency: true,
          standardSource: true,
          productTimeProfileVersion: true,
          participants: {
            select: { employeeId: true, position: true },
            orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
          },
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
    const automatic = completion.autoAssignLabor
      ? await autoAssignCompletionLaborPool(tx, {
          poolId: pool.id,
          completionId: completion.id,
          employeeIds: completion.participants.map(participant => participant.employeeId),
          userId: input.userId,
          now: input.now,
        })
      : { employeeCount: 0, standardLaborMilliseconds: 0 };
    await tx.processRouteActivity.create({
      data: {
        routeId: route.id,
        stepId: step.id,
        action: 'create_deferred_per_batch_labor_pool',
        content: pool.pendingStandard
          ? `${step.processName} 上下游已闭环，补建 ${directCompletedGoodQty} 件待补标准工时`
          : automatic.employeeCount > 0
            ? `${step.processName} 上下游已闭环，${directCompletedGoodQty} 件标准工时已自动记入 ${automatic.employeeCount} 人`
            : `${step.processName} 上下游已闭环，补建 ${directCompletedGoodQty} 件标准工时`,
        actorId: input.userId,
        detail: {
          completionId: completion.id,
          laborPoolId: pool.id,
          laborPoolPendingStandard: pool.pendingStandard,
          autoAssignedEmployeeCount: automatic.employeeCount,
          autoAssignedLaborMilliseconds: automatic.standardLaborMilliseconds,
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

/**
 * Projects the authoritative process-step quantities into same-day planning tasks.
 * ProcessCompletion remains the only production fact: this function only updates
 * the daily-plan status/availability cache and its audit trail in the same
 * serializable transaction as the completion.
 */
async function syncDailyProcessTasksAfterCompletion(
  tx: Prisma.TransactionClient,
  input: {
    completionId: string;
    routeId: string;
    workDate: Date;
    steps: QuantityStep[];
    actorId: string;
  },
): Promise<void> {
  const tasks = await tx.dailyProcessTask.findMany({
    where: {
      routeId: input.routeId,
      plan: { workDate: input.workDate },
      status: {
        notIn: [
          DailyProcessTaskStatus.COMPLETED,
          DailyProcessTaskStatus.CARRIED_OVER,
          DailyProcessTaskStatus.CANCELLED,
          DailyProcessTaskStatus.NEEDS_REVIEW,
        ],
      },
    },
    select: {
      id: true,
      planId: true,
      stepId: true,
      status: true,
      availableQty: true,
      plannedQty: true,
      version: true,
    },
  });
  if (!tasks.length) return;

  const stepsById = new Map(input.steps.map(step => [step.id, step]));
  for (const task of tasks) {
    const step = stepsById.get(task.stepId);
    if (!step) continue;
    const next = resolveDailyTaskProgress({
      currentStatus: task.status,
      currentAvailableQty: task.availableQty,
      plannedQty: task.plannedQty,
      inputQty: step.inputQty,
      processedQty: step.processedQty,
      stepStatus: step.status,
    });
    if (next.status === task.status && next.availableQty === task.availableQty) continue;

    const updated = await tx.dailyProcessTask.updateMany({
      where: {
        id: task.id,
        version: task.version,
        status: task.status,
      },
      data: {
        status: next.status as DailyProcessTaskStatus,
        availableQty: next.availableQty,
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) {
      throw new ProcessCompletionServiceError(
        '日计划任务已被其他操作更新，请刷新后重试',
        409,
        'DAILY_PLAN_VERSION_CONFLICT',
      );
    }

    await tx.dailyPlanRevision.create({
      data: {
        planId: task.planId,
        taskId: task.id,
        action: 'PROCESS_COMPLETION_SYNC',
        beforeData: {
          status: task.status,
          availableQty: task.availableQty,
          stepId: task.stepId,
        },
        afterData: {
          status: next.status,
          availableQty: next.availableQty,
          stepId: task.stepId,
          completionId: input.completionId,
        },
        reason: '生产工序完工同步日计划任务状态与可执行数量',
        actorId: input.actorId,
        idempotencyKey: `process-completion:${input.completionId}:daily-task:${task.id}`,
      },
    });
  }
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
    step => step.executionMode === 'NORMAL'
      && step.sequenceGroup === originStep.sequenceGroup,
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
  const targetSteps = nextNormalSequenceGroupSteps(parentRoute.steps, originStep.sequenceGroup);
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

type CoverageApplicationSummary = {
  goodTransferredQty: number;
  frontendTransferDelta: number;
  finishedGoodDelta: number;
  branchWorkOrderId?: string;
  branchWorkOrderCode?: string;
  reworkReturn?: {
    completionId: string;
    sourceStepId: string;
    recoveredQty: number;
  };
};

async function applyCompletionCoverage(
  tx: Prisma.TransactionClient,
  input: {
    route: CompletionRouteRecord;
    completion: {
      id: string;
      stepId: string;
      processedQty: number;
      goodQty: number;
      defectQty: number;
      coveredQty: number;
      coveredGoodQty: number;
      coveredDefectQty: number;
      defectDisposition: string | null;
    };
    triggerCompletionId: string;
    targetQty: number;
    userId: string;
    actor: string;
    now: Date;
  },
): Promise<CoverageApplicationSummary> {
  const current = input.route.steps.find(step => step.id === input.completion.stepId);
  if (!current) {
    throw new ProcessCompletionServiceError(
      '待核销报工对应的工序不存在',
      409,
      'PROCESS_COVERAGE_STEP_NOT_FOUND',
    );
  }
  if (current.executionMode !== 'NORMAL') {
    throw new ProcessCompletionServiceError(
      '补充工序不参与普通数量核销',
      409,
      'PROCESS_SUPPLEMENT_QUANTITY_FLOW_FORBIDDEN',
    );
  }
  const availableQty = Math.max(0, current.inputQty - current.processedQty);
  const plan = planCompletionCoverage({
    processedQty: input.completion.processedQty,
    goodQty: input.completion.goodQty,
    defectQty: input.completion.defectQty,
    coveredQty: input.completion.coveredQty,
    coveredGoodQty: input.completion.coveredGoodQty,
    coveredDefectQty: input.completion.coveredDefectQty,
    availableQty,
  });
  if (plan.deltaQty <= 0) {
    return {
      goodTransferredQty: 0,
      frontendTransferDelta: 0,
      finishedGoodDelta: 0,
    };
  }

  const completionUpdate = await tx.processCompletion.updateMany({
    where: {
      id: input.completion.id,
      voidedAt: null,
      coveredQty: input.completion.coveredQty,
      coveredGoodQty: input.completion.coveredGoodQty,
      coveredDefectQty: input.completion.coveredDefectQty,
    },
    data: {
      coveredQty: plan.coveredQty,
      coveredGoodQty: plan.coveredGoodQty,
      coveredDefectQty: plan.coveredDefectQty,
      coverageStatus: plan.status,
      coverageUpdatedAt: input.now,
    },
  });
  if (completionUpdate.count !== 1) {
    throw new ProcessCompletionServiceError(
      '待核销报工已被其他操作更新，请刷新后重试',
      409,
      'PROCESS_COMPLETION_COVERAGE_CONFLICT',
    );
  }
  await tx.processCompletionCoverage.create({
    data: {
      reportCompletionId: input.completion.id,
      triggerCompletionId: input.triggerCompletionId,
      quantity: plan.deltaQty,
      goodQty: plan.deltaGoodQty,
      defectQty: plan.deltaDefectQty,
      idempotencyKey: `coverage:${input.completion.id}:${input.completion.coveredQty}:${plan.coveredQty}`,
    },
  });
  input.completion.coveredQty = plan.coveredQty;
  input.completion.coveredGoodQty = plan.coveredGoodQty;
  input.completion.coveredDefectQty = plan.coveredDefectQty;

  const stepUpdate = await tx.workOrderProcessStep.updateMany({
    where: {
      id: current.id,
      quantityVersion: current.quantityVersion,
      processedQty: current.processedQty,
      inputQty: current.inputQty,
    },
    data: {
      processedQty: { increment: plan.deltaQty },
      goodOutputQty: { increment: plan.deltaGoodQty },
      defectOutputQty: { increment: plan.deltaDefectQty },
      quantityVersion: { increment: 1 },
    },
  });
  if (stepUpdate.count !== 1) {
    throw new ProcessCompletionServiceError(
      '工序核销数量已变化，请刷新后重试',
      409,
      'PROCESS_STEP_QUANTITY_CONFLICT',
    );
  }
  current.processedQty += plan.deltaQty;
  current.goodOutputQty += plan.deltaGoodQty;
  current.defectOutputQty += plan.deltaDefectQty;
  current.quantityVersion += 1;

  const groupSteps = input.route.steps.filter(step => (
    step.executionMode === 'NORMAL'
    && step.sequenceGroup === current.sequenceGroup
  ));
  const alreadyReleasedQty = Math.min(...groupSteps.map(step => step.releasedGoodQty));
  const directRouteCap = await loadDirectRouteReleaseCap(tx, {
    workOrderId: input.route.workOrderId,
    targetQty: input.targetQty,
    currentSequenceGroup: current.sequenceGroup,
    alreadyReleasedQty: Math.max(...groupSteps.map(step => step.releasedGoodQty)),
    pendingScrapReservationQty: input.completion.defectDisposition === 'SCRAP_REPLENISH'
      ? plan.deltaDefectQty
      : 0,
  });
  const release = calculateCappedParallelGroupRelease({
    stepGoodOutputQuantities: groupSteps.map(step => step.goodOutputQty),
    alreadyReleasedQty,
    directRouteCap,
  });
  const targetSteps = nextNormalSequenceGroupSteps(input.route.steps, current.sequenceGroup);
  let frontendTransferDelta = 0;
  if (release.releaseDeltaQty > 0) {
    if (targetSteps.length) {
      await tx.processQuantityMovement.createMany({
        data: targetSteps.map(targetStep => ({
          completionId: input.completion.id,
          workOrderId: input.route.workOrderId,
          sourceStepId: current.id,
          targetStepId: targetStep.id,
          type: 'GOOD_TRANSFER',
          quantity: release.releaseDeltaQty,
          sourceSequenceGroup: current.sequenceGroup,
          targetSequenceGroup: targetStep.sequenceGroup,
          idempotencyKey: `${input.completion.id}:coverage:${plan.coveredQty}:good:${targetStep.id}`,
        })),
      });
      for (const targetStep of targetSteps) {
        await tx.workOrderProcessStep.update({
          where: { id: targetStep.id },
          data: {
            inputQty: { increment: release.releaseDeltaQty },
            quantityVersion: { increment: 1 },
            status: targetStep.status === 'pending' ? 'current' : targetStep.status,
            startedAt: targetStep.startedAt || input.now,
          },
        });
        targetStep.inputQty += release.releaseDeltaQty;
        targetStep.quantityVersion += 1;
        if (targetStep.status === 'pending') targetStep.status = 'current';
        targetStep.startedAt = targetStep.startedAt || input.now;
      }
      const sourceStageGroup = normalizeProcessStageGroup(current.stageGroup);
      const targetStageGroup = normalizeProcessStageGroup(targetSteps[0].stageGroup);
      if (sourceStageGroup === 'frontend' && targetStageGroup && targetStageGroup !== 'frontend') {
        frontendTransferDelta = release.releaseDeltaQty;
      }
    } else if (input.route.workOrder.branchType !== 'REWORK') {
      await tx.processQuantityMovement.create({
        data: {
          completionId: input.completion.id,
          workOrderId: input.route.workOrderId,
          sourceStepId: current.id,
          targetStepId: null,
          type: 'FINISHED_GOOD',
          quantity: release.releaseDeltaQty,
          sourceSequenceGroup: current.sequenceGroup,
          targetSequenceGroup: null,
          idempotencyKey: `${input.completion.id}:coverage:${plan.coveredQty}:finished`,
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
  if (plan.deltaDefectQty > 0) {
    const disposition = lowercaseDisposition(input.completion.defectDisposition);
    if (!disposition) {
      throw new ProcessCompletionServiceError(
        '待核销不良品缺少处置方式',
        409,
        'PROCESS_DEFECT_DISPOSITION_REQUIRED',
      );
    }
    const branch = await createDefectBranch(tx, {
      route: input.route,
      completionId: input.completion.id,
      currentStepId: current.id,
      defectQty: plan.deltaDefectQty,
      disposition,
      userId: input.userId,
      actor: input.actor,
      now: input.now,
    });
    branchWorkOrderId = branch.workOrderId;
    branchWorkOrderCode = branch.workOrderCode;
    await tx.processQuantityMovement.create({
      data: {
        completionId: input.completion.id,
        workOrderId: input.route.workOrderId,
        sourceStepId: current.id,
        targetStepId: branch.firstStepId,
        branchWorkOrderId: branch.workOrderId,
        type: branch.movementType,
        quantity: plan.deltaDefectQty,
        sourceSequenceGroup: current.sequenceGroup,
        targetSequenceGroup: branch.firstSequenceGroup,
        idempotencyKey: `${input.completion.id}:coverage:${plan.coveredQty}:defect`,
      },
    });
  }

  return {
    goodTransferredQty: release.releaseDeltaQty,
    frontendTransferDelta,
    finishedGoodDelta: targetSteps.length ? 0 : release.releaseDeltaQty,
    ...(branchWorkOrderId ? { branchWorkOrderId } : {}),
    ...(branchWorkOrderCode ? { branchWorkOrderCode } : {}),
    ...(input.route.workOrder.branchType === 'REWORK'
      && !targetSteps.length
      && release.releaseDeltaQty > 0
      ? {
          reworkReturn: {
            completionId: input.completion.id,
            sourceStepId: current.id,
            recoveredQty: release.releaseDeltaQty,
          },
        }
      : {}),
  };
}

async function reconcilePendingCompletionCoverage(
  tx: Prisma.TransactionClient,
  input: {
    route: CompletionRouteRecord;
    triggerCompletionId: string;
    targetQty: number;
    userId: string;
    actor: string;
    now: Date;
  },
): Promise<{
  goodTransferredQty: number;
  frontendTransferDelta: number;
  finishedGoodDelta: number;
  branchWorkOrderId?: string;
  branchWorkOrderCode?: string;
  reworkReturns: Array<{ completionId: string; sourceStepId: string; recoveredQty: number }>;
}> {
  let goodTransferredQty = 0;
  let frontendTransferDelta = 0;
  let finishedGoodDelta = 0;
  let branchWorkOrderId: string | undefined;
  let branchWorkOrderCode: string | undefined;
  const reworkReturns: Array<{ completionId: string; sourceStepId: string; recoveredQty: number }> = [];
  const orderedSteps = normalQuantitySteps(input.route.steps).sort((left, right) => (
    left.sequenceGroup - right.sequenceGroup || left.position - right.position
  ));

  for (const step of orderedSteps) {
    while (step.inputQty > step.processedQty) {
      const report = await tx.processCompletion.findFirst({
        where: {
          routeId: input.route.id,
          stepId: step.id,
          voidedAt: null,
          coverageStatus: { in: [
            ProcessCompletionCoverageStatus.PENDING,
            ProcessCompletionCoverageStatus.PARTIAL,
          ] },
        },
        orderBy: [{ completedAt: 'asc' }, { createdAt: 'asc' }],
        select: {
          id: true,
          stepId: true,
          processedQty: true,
          goodQty: true,
          defectQty: true,
          coveredQty: true,
          coveredGoodQty: true,
          coveredDefectQty: true,
          defectDisposition: true,
        },
      });
      if (!report) break;
      const beforeCoveredQty = report.coveredQty;
      const applied = await applyCompletionCoverage(tx, {
        route: input.route,
        completion: report,
        triggerCompletionId: input.triggerCompletionId,
        targetQty: input.targetQty,
        userId: input.userId,
        actor: input.actor,
        now: input.now,
      });
      if (report.coveredQty === beforeCoveredQty) break;
      goodTransferredQty += applied.goodTransferredQty;
      frontendTransferDelta += applied.frontendTransferDelta;
      finishedGoodDelta += applied.finishedGoodDelta;
      branchWorkOrderId = branchWorkOrderId || applied.branchWorkOrderId;
      branchWorkOrderCode = branchWorkOrderCode || applied.branchWorkOrderCode;
      if (applied.reworkReturn) reworkReturns.push(applied.reworkReturn);
    }
  }
  return {
    goodTransferredQty,
    frontendTransferDelta,
    finishedGoodDelta,
    ...(branchWorkOrderId ? { branchWorkOrderId } : {}),
    ...(branchWorkOrderCode ? { branchWorkOrderCode } : {}),
    reworkReturns,
  };
}

type SharedTerminalSessionPreparation = 'none' | 'new-batch' | 'replay-batch';

async function assertSharedTerminalPinSession(
  tx: Prisma.TransactionClient,
  input: ParsedCompletionCommand,
  mode: 'available' | 'consume' | 'replay',
): Promise<void> {
  const evidence = input.fieldReportPinSession;
  if (!evidence) {
    throw new ProcessCompletionServiceError(
      '共享终端报工身份已失效，请重新验证',
      401,
      'PROCESS_COMPLETION_PIN_SESSION_REQUIRED',
    );
  }
  const now = new Date();
  const expectedScope = `EMPLOYEE:${input.principalEmployeeId}`;
  const session = await tx.fieldReportPinSession.findUnique({
    where: { id: evidence.sessionId },
    select: {
      id: true,
      tokenHash: true,
      terminalId: true,
      terminalVersion: true,
      credentialId: true,
      credentialVersion: true,
      employeeId: true,
      userId: true,
      ticketId: true,
      expiresAt: true,
      consumedAt: true,
      revokedAt: true,
      terminal: {
        select: { id: true, version: true, isActive: true, lockedUntil: true },
      },
      credential: {
        select: {
          id: true,
          employeeId: true,
          credentialVersion: true,
          isActive: true,
          lockedUntil: true,
        },
      },
      employee: {
        select: { id: true, department: true, isActive: true, attendanceEnabled: true },
      },
      user: {
        select: {
          id: true,
          isActive: true,
          accountStatus: true,
          employeeId: true,
          accessGrants: {
            where: {
              profile: AccessProfileKey.FIELD_REPORTER,
              scopeKey: expectedScope,
              isActive: true,
              effectiveFrom: { lte: now },
              OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
            },
            select: { id: true },
            take: 1,
          },
        },
      },
      ticket: {
        select: {
          status: true,
          workOrder: { select: { processRoute: { select: { id: true } } } },
        },
      },
    },
  });
  const stateMode = mode === 'replay' ? 'replay' : 'consume';
  const sessionValid = sharedTerminalPinSessionSnapshotIsValid(evidence, session ? {
    id: session.id,
    tokenHash: session.tokenHash,
    terminalId: session.terminalId,
    terminalVersion: session.terminalVersion,
    credentialId: session.credentialId,
    credentialVersion: session.credentialVersion,
    employeeId: session.employeeId,
    userId: session.userId,
    ticketId: session.ticketId,
    expiresAt: session.expiresAt,
    consumedAt: session.consumedAt,
    revokedAt: session.revokedAt,
    ticketStatus: session.ticket.status,
    ticketRouteId: session.ticket.workOrder.processRoute?.id || null,
  } : null, input, stateMode, now);
  const livePrincipalValid = Boolean(
    session
    && session.terminal.id === evidence.terminalId
    && session.terminal.version === evidence.terminalVersion
    && session.credential.id === evidence.credentialId
    && session.credential.employeeId === evidence.employeeId
    && session.employee.id === evidence.employeeId
    && isProductionWorkforceEmployee(session.employee)
    && sharedTerminalPrincipalSnapshotIsValid({
      principalEmployeeId: input.principalEmployeeId!,
      pinCredentialVersion: input.pinCredentialVersion!,
      userId: input.userId,
    }, {
      credential: session.credential,
      terminal: session.terminal,
      employeeExists: true,
      user: {
        id: session.user.id,
        isActive: session.user.isActive,
        accountStatus: session.user.accountStatus,
        employeeId: session.user.employeeId,
        fieldReporterGrantCount: session.user.accessGrants.length,
      },
    }, now)
  );
  if (!sessionValid || !livePrincipalValid) {
    throw new ProcessCompletionServiceError(
      mode === 'replay'
        ? '本次 PIN 报工重放凭据已失效，请重新验证'
        : '共享终端报工身份已失效，请重新验证',
      401,
      mode === 'replay'
        ? 'PROCESS_COMPLETION_PIN_REPLAY_INVALID'
        : 'PROCESS_COMPLETION_PIN_SESSION_INVALID',
    );
  }
  if (mode === 'consume') {
    const consumed = await tx.fieldReportPinSession.updateMany({
      where: {
        id: evidence.sessionId,
        tokenHash: evidence.tokenHash,
        terminalId: evidence.terminalId,
        terminalVersion: evidence.terminalVersion,
        credentialId: evidence.credentialId,
        credentialVersion: evidence.credentialVersion,
        employeeId: evidence.employeeId,
        userId: evidence.userId,
        ticketId: evidence.ticketId,
        expiresAt: { gt: now },
        consumedAt: null,
        revokedAt: null,
      },
      data: { consumedAt: now },
    });
    if (consumed.count !== 1) {
      throw new ProcessCompletionServiceError(
        '本次 PIN 身份已使用或已过期，请重新验证',
        401,
        'PROCESS_COMPLETION_PIN_SESSION_USED',
      );
    }
  }
}

async function performProcessCompletion(
  tx: Prisma.TransactionClient,
  input: ParsedCompletionCommand,
  sessionPreparation: SharedTerminalSessionPreparation = 'none',
): Promise<ProcessCompletionResult> {
  const existing = await tx.processCompletion.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
    include: replayCompletionInclude,
  });
  if (existing) {
    assertIdempotentPayload(existing, input);
    if (
      input.reportSource === ProcessCompletionSource.SHARED_TERMINAL_PIN
      && sessionPreparation === 'none'
    ) {
      await assertSharedTerminalPinSession(tx, input, 'replay');
    }
    return resultForExistingCompletion(tx, existing);
  }
  if (sessionPreparation === 'replay-batch') {
    throw new ProcessCompletionServiceError(
      '共享终端批量报工的幂等记录不完整，不能继续落账',
      409,
      'PROCESS_COMPLETION_PIN_BATCH_REPLAY_INCOMPLETE',
    );
  }
  if (
    input.reportSource === ProcessCompletionSource.SHARED_TERMINAL_PIN
    && sessionPreparation === 'none'
  ) {
    await assertSharedTerminalPinSession(tx, input, 'consume');
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
  if (!isExecutableProductionWorkOrder(route.workOrder)) {
    throw new ProcessCompletionServiceError(
      '已归档或已清除的周计划不能登记生产完成',
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
  if (input.employeeIds.length) {
    const activeEmployees = await tx.employee.findMany({
      where: {
        id: { in: input.employeeIds },
        ...productionEmployeeWhere(),
      },
      select: { id: true },
    });
    if (activeEmployees.length !== input.employeeIds.length) {
      throw new ProcessCompletionServiceError(
        '所选作业员工不属于生产部、未启用考勤或已停用，请刷新后重新选择',
        400,
        'PROCESS_COMPLETION_EMPLOYEE_INVALID',
      );
    }
  }
  const targetQty = targetQuantity(route.workOrder);
  const firstGroup = firstNormalSequenceGroup(route.steps);
  for (const firstStep of route.steps.filter(step => (
    step.executionMode === 'NORMAL'
    && step.sequenceGroup === firstGroup
  ))) {
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
      '所选工序不属于该工艺路线',
      404,
      'PROCESS_STEP_NOT_FOUND',
    );
  }
  if (current.executionMode === 'SUPPLEMENTAL_OBLIGATION') {
    throw new ProcessCompletionServiceError(
      '该工序属于工艺变更后的补充报工，请刷新二维码页面后从 NEW 工序卡片提交',
      409,
      'PROCESS_SUPPLEMENT_COMPLETION_REQUIRED',
    );
  }
  const blockingSupplement = route.steps.find(step => (
    step.executionMode === 'SUPPLEMENTAL_OBLIGATION'
    && step.position < current.position
    && step.status !== 'completed'
    && step.status !== 'skipped'
  ));
  if (blockingSupplement) {
    throw new ProcessCompletionServiceError(
      `请先完成新增工序「${blockingSupplement.processName}」的补充报工`,
      409,
      'PROCESS_SUPPLEMENT_BLOCKS_DOWNSTREAM',
    );
  }
  if (!input.allowAdvanceReporting && current.status !== 'current') {
    throw new ProcessCompletionServiceError(
      '该工序已不是当前可完成工序，请刷新后重试',
      409,
      'PROCESS_STEP_NOT_CURRENT',
    );
  }
  const reported = await tx.processCompletion.aggregate({
    where: { routeId: route.id, stepId: current.id, voidedAt: null },
    _sum: { processedQty: true },
  });
  const reportedQty = reported._sum.processedQty || 0;
  const reportableQty = Math.max(0, targetQty - reportedQty);
  if (input.processedQty > reportableQty) {
    throw new ProcessCompletionServiceError(
      `本次报工不能超过该工序剩余可报数量 ${reportableQty}`,
      409,
      'PROCESS_REPORTED_QTY_EXCEEDS_TARGET',
    );
  }
  const availableInputQty = Math.max(0, current.inputQty - current.processedQty);
  if (!input.allowAdvanceReporting) {
    resolveCompletionQuantities({
      availableInputQty,
      processedQty: input.processedQty,
      defectQty: input.defectQty,
    });
  }
  const goodQty = input.processedQty - input.defectQty;
  const reportMode = current.status === 'current' && input.processedQty <= availableInputQty
    ? ProcessCompletionReportMode.SEQUENTIAL
    : ProcessCompletionReportMode.ADVANCE;
  const now = new Date();
  const nextRouteVersion = route.version + 1;
  const goodOutputBeforeCompletion = current.goodOutputQty;
  const completion = await tx.processCompletion.create({
    data: {
      workOrderId: route.workOrderId,
      routeId: route.id,
      stepId: current.id,
      workDate: input.workDate,
      completedAt: now,
      workStartedAt: input.workStartedAt,
      workEndedAt: input.workEndedAt,
      team: input.team,
      workstation: input.workstation,
      remark: input.remark,
      processedQty: input.processedQty,
      goodQty,
      defectQty: input.defectQty,
      reportMode,
      reportSource: input.reportSource,
      principalEmployeeId: input.principalEmployeeId,
      fieldReportTerminalId: input.fieldReportTerminalId,
      pinCredentialVersion: input.pinCredentialVersion,
      coverageStatus: ProcessCompletionCoverageStatus.PENDING,
      coveredQty: 0,
      coveredGoodQty: 0,
      coveredDefectQty: 0,
      autoAssignLabor: input.autoAssignLabor,
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
      ...(input.employeeIds.length ? {
        participants: {
          create: input.employeeIds.map((employeeId, position) => ({ employeeId, position })),
        },
      } : {}),
    },
  });
  const coverage = await reconcilePendingCompletionCoverage(tx, {
    route,
    triggerCompletionId: completion.id,
    targetQty,
    userId: input.userId,
    actor: input.actor,
    now,
  });
  const coveredCompletion = await tx.processCompletion.findUniqueOrThrow({
    where: { id: completion.id },
    select: {
      coverageStatus: true,
      coveredQty: true,
      coveredGoodQty: true,
      coveredDefectQty: true,
      branchWorkOrder: { select: { id: true, code: true, businessCode: true } },
    },
  });

  let laborPoolId: string | null = null;
  let laborPoolPendingStandard = false;
  let autoAssignedEmployeeCount = 0;
  let autoAssignedLaborMilliseconds = 0;
  const upstreamPermanentlyClosed = route.steps
    .filter(step => (
      step.executionMode === 'NORMAL'
      && step.sequenceGroup < current.sequenceGroup
    ))
    .every(step => step.inputQty <= step.processedQty);
  const perBatchInputStable = current.timeBasis !== 'per_batch'
    || !await hasActiveUpstreamReworkBranch(tx, route, current.sequenceGroup);
  const laborPoolEligibleQty = current.timeBasis === 'per_batch'
    ? (
        current.processedQty >= current.inputQty
        && upstreamPermanentlyClosed
        && perBatchInputStable
          ? current.goodOutputQty
          : 0
      )
    : goodQty;
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
    if (input.autoAssignLabor && !pool.pendingStandard) {
      const automatic = await autoAssignCompletionLaborPool(tx, {
        poolId: pool.id,
        completionId: completion.id,
        employeeIds: input.employeeIds,
        userId: input.userId,
        now,
      });
      autoAssignedEmployeeCount = automatic.employeeCount;
      autoAssignedLaborMilliseconds = automatic.standardLaborMilliseconds;
    }
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
    finishedGoodDelta: coverage.finishedGoodDelta,
    frontendTransferDelta: coverage.frontendTransferDelta,
    routeCompleted,
    actor: input.actor,
    now,
    propagateFinishedToAncestors: route.workOrder.branchType !== 'REWORK',
  });
  await syncDailyProcessTasksAfterCompletion(tx, {
    completionId: completion.id,
    routeId: route.id,
    workDate: input.workDate,
    steps: route.steps as QuantityStep[],
    actorId: input.userId,
  });
  for (const reworkReturn of coverage.reworkReturns) {
    await returnReworkOutputToParent(tx, {
      completionId: reworkReturn.completionId,
      sourceRoute: route,
      sourceStepId: reworkReturn.sourceStepId,
      recoveredQty: reworkReturn.recoveredQty,
      userId: input.userId,
      actor: input.actor,
      now,
    });
  }

  const pendingCoverageQty = Math.max(0, input.processedQty - coveredCompletion.coveredQty);
  const result: ProcessCompletionResult = {
    completionId: completion.id,
    routeVersion: nextRouteVersion,
    laborPoolId,
    laborPoolPendingStandard,
    ...(coveredCompletion.branchWorkOrder?.id
      ? { branchWorkOrderId: coveredCompletion.branchWorkOrder.id }
      : coverage.branchWorkOrderId ? { branchWorkOrderId: coverage.branchWorkOrderId } : {}),
    ...(coveredCompletion.branchWorkOrder?.code
      ? { branchWorkOrderCode: coveredCompletion.branchWorkOrder.businessCode || coveredCompletion.branchWorkOrder.code }
      : coverage.branchWorkOrderCode ? { branchWorkOrderCode: coverage.branchWorkOrderCode } : {}),
    goodTransferredQty: coverage.goodTransferredQty,
    remainingInputQty: Math.max(0, current.inputQty - current.processedQty),
    routeCompleted,
    coverageStatus: lowercaseCoverageStatus(coveredCompletion.coverageStatus),
    pendingCoverageQty,
    autoAssignedEmployeeCount,
    autoAssignedLaborMilliseconds,
  };
  const content = pendingCoverageQty > 0
    ? `${current.processName}报工 ${input.processedQty}，已核销 ${coveredCompletion.coveredQty}，待前序核销 ${pendingCoverageQty}`
    : input.defectQty > 0
      ? `${current.processName}报工 ${input.processedQty}，良品 ${goodQty}，不良 ${input.defectQty}`
      : `${current.processName}报工 ${input.processedQty}，已自动核销转序`;
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
        workStartedAt: input.workStartedAt?.toISOString() || null,
        workEndedAt: input.workEndedAt?.toISOString() || null,
        employeeIds: input.employeeIds,
        team: input.team,
        workstation: input.workstation,
        remark: input.remark,
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
        processedQty: input.processedQty,
        goodQty,
        defectQty: input.defectQty,
        defectDisposition: input.databaseDefectDisposition,
        workDate: input.workDateKey,
        workStartedAt: input.workStartedAt?.toISOString() || null,
        workEndedAt: input.workEndedAt?.toISOString() || null,
        employeeIds: input.employeeIds,
        team: input.team,
        workstation: input.workstation,
        remark: input.remark,
        laborPoolId,
        laborPoolPendingStandard,
        branchWorkOrderId: result.branchWorkOrderId || null,
        goodTransferredQty: coverage.goodTransferredQty,
        reportMode,
        reportSource: input.reportSource,
        principalEmployeeId: input.principalEmployeeId,
        fieldReportTerminalId: input.fieldReportTerminalId,
        pinCredentialVersion: input.pinCredentialVersion,
        coverageStatus: coveredCompletion.coverageStatus,
        coveredQty: coveredCompletion.coveredQty,
        pendingCoverageQty,
        autoAssignedEmployeeCount,
        autoAssignedLaborMilliseconds,
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
      try {
        const replay = await prisma.$transaction(async tx => {
          const existing = await tx.processCompletion.findUnique({
            where: { idempotencyKey: input.idempotencyKey },
            include: replayCompletionInclude,
          });
          if (!existing) {
            if (input.reportSource === ProcessCompletionSource.SHARED_TERMINAL_PIN) {
              await assertSharedTerminalPinSession(tx, input, 'available');
            }
            return null;
          }
          assertIdempotentPayload(existing, input);
          if (input.reportSource === ProcessCompletionSource.SHARED_TERMINAL_PIN) {
            await assertSharedTerminalPinSession(tx, input, 'replay');
          }
          return resultForExistingCompletion(tx, existing);
        }, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 5_000,
          timeout: 15_000,
        });
        if (replay) return replay;
      } catch (replayError) {
        throw normalizeServiceError(replayError);
      }
    }
    throw normalizeServiceError(error);
  }
}

export async function completeProcessStepsBatch(
  command: CompleteProcessStepsBatchCommand,
  retrySerializationConflict = true,
): Promise<ProcessCompletionBatchResult> {
  if (!Array.isArray(command.items) || command.items.length < 2) {
    throw new ProcessCompletionServiceError(
      '批量报工请至少选择两道工序',
      400,
      'PROCESS_COMPLETION_BATCH_ITEMS_REQUIRED',
    );
  }
  if (command.items.length > 20) {
    throw new ProcessCompletionServiceError(
      '一次最多批量报工 20 道工序',
      400,
      'PROCESS_COMPLETION_BATCH_ITEMS_LIMIT',
    );
  }
  const batchKey = parseIdempotencyKey(command.idempotencyKey);
  const routeId = cleanText(command.routeId, 80);
  const expectedRouteVersion = parseExpectedRouteVersion(command.expectedRouteVersion);
  const itemByStepId = new Map<string, CompleteProcessStepsBatchCommand['items'][number]>();
  for (const item of command.items) {
    const stepId = cleanText(item.stepId, 80);
    if (!stepId) {
      throw new ProcessCompletionServiceError('批量报工包含无效工序', 400, 'PROCESS_STEP_REQUIRED');
    }
    if (itemByStepId.has(stepId)) {
      throw new ProcessCompletionServiceError('同一道工序不能重复选择', 400, 'PROCESS_COMPLETION_BATCH_STEP_DUPLICATE');
    }
    itemByStepId.set(stepId, item);
  }

  try {
    return await prisma.$transaction(async tx => {
      const route = await tx.workOrderProcessRoute.findUnique({
        where: { id: routeId },
        select: {
          id: true,
          steps: {
            where: { id: { in: [...itemByStepId.keys()] } },
            orderBy: [{ sequenceGroup: 'asc' }, { position: 'asc' }],
            select: { id: true, processName: true, position: true },
          },
        },
      });
      if (!route || route.steps.length !== itemByStepId.size) {
        throw new ProcessCompletionServiceError(
          '部分所选工序不属于当前工艺路线，请刷新后重试',
          404,
          'PROCESS_STEP_NOT_FOUND',
        );
      }
      const parsedItems = route.steps.map((step, index) => ({
        step,
        input: parseProcessCompletionCommand({
          ...command,
          stepId: step.id,
          processedQty: itemByStepId.get(step.id)!.processedQty,
          defectQty: itemByStepId.get(step.id)!.defectQty,
          defectDisposition: itemByStepId.get(step.id)!.defectDisposition,
          idempotencyKey: `${batchKey.slice(0, 88)}:${index + 1}:${step.id.slice(0, 8)}`,
          expectedRouteVersion: expectedRouteVersion + index,
        }),
      }));
      let sessionPreparation: SharedTerminalSessionPreparation = 'none';
      const pinInput = parsedItems[0]?.input.reportSource === ProcessCompletionSource.SHARED_TERMINAL_PIN
        ? parsedItems[0].input
        : null;
      if (pinInput) {
        const existing = await tx.processCompletion.findMany({
          where: { idempotencyKey: { in: parsedItems.map(item => item.input.idempotencyKey) } },
          select: { idempotencyKey: true },
        });
        if (existing.length > 0 && existing.length !== parsedItems.length) {
          throw new ProcessCompletionServiceError(
            '共享终端批量报工的幂等记录不完整，不能继续落账',
            409,
            'PROCESS_COMPLETION_PIN_BATCH_REPLAY_INCOMPLETE',
          );
        }
        sessionPreparation = existing.length === parsedItems.length ? 'replay-batch' : 'new-batch';
        await assertSharedTerminalPinSession(
          tx,
          pinInput,
          sessionPreparation === 'replay-batch' ? 'replay' : 'consume',
        );
      }
      let nextExpectedVersion = expectedRouteVersion;
      const results: ProcessCompletionBatchResult['items'] = [];
      for (const { step, input } of parsedItems) {
        input.expectedRouteVersion = nextExpectedVersion;
        const result = await performProcessCompletion(tx, input, sessionPreparation);
        nextExpectedVersion = result.routeVersion;
        results.push({
          stepId: step.id,
          processName: step.processName,
          position: step.position,
          result,
        });
      }
      return {
        batchId: `BR-${batchKey.replace(/[^A-Za-z0-9]/g, '').slice(-10).toUpperCase()}`,
        routeVersion: nextExpectedVersion,
        completionCount: results.length,
        pendingCoverageQty: results.reduce((sum, item) => sum + item.result.pendingCoverageQty, 0),
        autoAssignedLaborMilliseconds: results.reduce((sum, item) => sum + item.result.autoAssignedLaborMilliseconds, 0),
        autoAssignedEmployeeCount: Math.max(0, ...results.map(item => item.result.autoAssignedEmployeeCount)),
        items: results,
      };
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 8_000,
      timeout: 30_000,
    });
  } catch (error) {
    if (
      retrySerializationConflict
      && error instanceof Prisma.PrismaClientKnownRequestError
      && (error.code === 'P2002' || error.code === 'P2034')
    ) {
      return completeProcessStepsBatch(command, false);
    }
    throw normalizeServiceError(error);
  }
}
