export const DEFAULT_DAILY_CAPACITY_MILLISECONDS = 8 * 60 * 60 * 1_000;

export type DailyPlanTimeSnapshot = {
  timeBasis: 'per_unit' | 'per_batch';
  standardMillisecondsPerUnit: number;
  setupMilliseconds: number;
  unitsPerProduct: number;
};

const DAILY_TASK_PROGRESS_TERMINAL_STATUSES = new Set([
  'COMPLETED',
  'CARRIED_OVER',
  'CANCELLED',
  'NEEDS_REVIEW',
]);

const DAILY_PLAN_ASSIGNABLE_STATUSES = new Set(['CONFIRMED', 'IN_PROGRESS']);

export function isDailyPlanAssignableStatus(status: string): boolean {
  return DAILY_PLAN_ASSIGNABLE_STATUSES.has(status);
}

export class DailyPlanDomainError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = 'DailyPlanDomainError';
    this.code = code;
  }
}

function integer(value: unknown, label: string, minimum: number): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) {
    throw new DailyPlanDomainError(
      `${label}必须是${minimum > 0 ? '正' : '非负'}整数`,
      'DAILY_PLAN_INVALID_NUMBER',
    );
  }
  return parsed;
}

export function remainingCrossTeamApprovalQuantity(input: {
  approvedQuantity: unknown;
  alreadyAssignedQuantity: unknown;
}): number {
  const approvedQuantity = integer(input.approvedQuantity, '跨组审批数量', 0);
  const alreadyAssignedQuantity = integer(input.alreadyAssignedQuantity, '跨组已分配数量', 0);
  return Math.max(0, approvedQuantity - alreadyAssignedQuantity);
}

export function normalizeWorkDate(value: string | Date): Date {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new DailyPlanDomainError('生产日期无效', 'DAILY_PLAN_INVALID_DATE');
    }
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value).trim());
  if (!match) throw new DailyPlanDomainError('生产日期必须为 YYYY-MM-DD', 'DAILY_PLAN_INVALID_DATE');
  const result = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (
    result.getUTCFullYear() !== Number(match[1])
    || result.getUTCMonth() !== Number(match[2]) - 1
    || result.getUTCDate() !== Number(match[3])
  ) {
    throw new DailyPlanDomainError('生产日期无效', 'DAILY_PLAN_INVALID_DATE');
  }
  return result;
}

export function formatWorkDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function calculateTaskStandardMilliseconds(
  snapshot: DailyPlanTimeSnapshot,
  quantity: unknown,
): bigint {
  const safeQuantity = integer(quantity, '计划数量', 0);
  const standard = integer(snapshot.standardMillisecondsPerUnit, '单位标准工时', 1);
  const setup = integer(snapshot.setupMilliseconds, '准备工时', 0);
  const occurrences = integer(snapshot.unitsPerProduct, '单套工序次数', 1);
  if (snapshot.timeBasis !== 'per_unit' && snapshot.timeBasis !== 'per_batch') {
    throw new DailyPlanDomainError('标准工时计时方式不正确', 'DAILY_PLAN_INVALID_TIME_BASIS');
  }
  if (safeQuantity === 0) return 0n;
  return snapshot.timeBasis === 'per_batch'
    ? BigInt(setup) + BigInt(standard)
    : BigInt(setup) + BigInt(standard) * BigInt(safeQuantity) * BigInt(occurrences);
}

/**
 * Allocates only the incremental task labor. This prevents setup time from being
 * counted once per employee when one process is split across several people.
 */
export function allocateIncrementalTaskLabor(input: {
  snapshot: DailyPlanTimeSnapshot;
  alreadyAssignedQuantity: unknown;
  quantities: readonly unknown[];
}): bigint[] {
  const alreadyAssignedQuantity = integer(input.alreadyAssignedQuantity, '已分配数量', 0);
  const quantities = input.quantities.map(value => integer(value, '分配数量', 1));
  let cursor = alreadyAssignedQuantity;
  return quantities.map(quantity => {
    const before = calculateTaskStandardMilliseconds(input.snapshot, cursor);
    cursor += quantity;
    const after = calculateTaskStandardMilliseconds(input.snapshot, cursor);
    return after - before;
  });
}

export function resolveDailyTaskAvailability(input: {
  sequenceGroup: unknown;
  inputQty: unknown;
  processedQty: unknown;
}): { availableQty: number; status: 'READY' | 'WAITING_UPSTREAM' } {
  integer(input.sequenceGroup, '顺序组', 1);
  const inputQty = integer(input.inputQty, '工序投入数量', 0);
  const processedQty = integer(input.processedQty, '已处理数量', 0);
  const availableQty = Math.max(0, inputQty - processedQty);
  return { availableQty, status: availableQty > 0 ? 'READY' : 'WAITING_UPSTREAM' };
}

/**
 * Projects the existing production step fact into the daily-plan task. This
 * function never creates a second completion fact; it only derives the current
 * planning status and executable quantity from the process step quantities.
 */
export function resolveDailyTaskProgress(input: {
  currentStatus: string;
  currentAvailableQty: unknown;
  plannedQty: unknown;
  inputQty: unknown;
  processedQty: unknown;
  stepStatus: string;
}): { status: string; availableQty: number } {
  const currentAvailableQty = integer(input.currentAvailableQty, '当前可执行数量', 0);
  if (DAILY_TASK_PROGRESS_TERMINAL_STATUSES.has(input.currentStatus)) {
    return { status: input.currentStatus, availableQty: currentAvailableQty };
  }
  const plannedQty = integer(input.plannedQty, '计划数量', 0);
  const inputQty = integer(input.inputQty, '工序投入数量', 0);
  const processedQty = integer(input.processedQty, '已处理数量', 0);
  if (input.stepStatus === 'completed' || input.stepStatus === 'skipped') {
    return { status: 'COMPLETED', availableQty: 0 };
  }
  const availableQty = Math.min(plannedQty, Math.max(0, inputQty - processedQty));
  if (processedQty > 0) return { status: 'IN_PROGRESS', availableQty };
  return {
    status: availableQty > 0 ? 'READY' : 'WAITING_UPSTREAM',
    availableQty,
  };
}

export function resolveEffectiveCapacity(input?: {
  attendanceActualMilliseconds?: number | null;
  attendanceOvertimeMilliseconds?: number | null;
  overrideRegularMilliseconds?: number | null;
  overrideOvertimeMilliseconds?: number | null;
}): { source: 'override' | 'attendance' | 'fallback'; regularMilliseconds: number; overtimeMilliseconds: number; totalMilliseconds: number } {
  if (input?.overrideRegularMilliseconds != null || input?.overrideOvertimeMilliseconds != null) {
    const regularMilliseconds = integer(
      input.overrideRegularMilliseconds ?? DEFAULT_DAILY_CAPACITY_MILLISECONDS,
      '日常容量',
      0,
    );
    const overtimeMilliseconds = integer(input.overrideOvertimeMilliseconds ?? 0, '加班容量', 0);
    return { source: 'override', regularMilliseconds, overtimeMilliseconds, totalMilliseconds: regularMilliseconds + overtimeMilliseconds };
  }
  if (input?.attendanceActualMilliseconds != null && input.attendanceActualMilliseconds > 0) {
    const regularMilliseconds = integer(input.attendanceActualMilliseconds, '实际出勤工时', 0);
    const overtimeMilliseconds = integer(input.attendanceOvertimeMilliseconds ?? 0, '考勤加班工时', 0);
    return { source: 'attendance', regularMilliseconds, overtimeMilliseconds, totalMilliseconds: regularMilliseconds + overtimeMilliseconds };
  }
  return {
    source: 'fallback',
    regularMilliseconds: DEFAULT_DAILY_CAPACITY_MILLISECONDS,
    overtimeMilliseconds: 0,
    totalMilliseconds: DEFAULT_DAILY_CAPACITY_MILLISECONDS,
  };
}

export function scoreDailyPlanPriority(input: {
  workDate: Date;
  dueDate?: Date | null;
  priority?: string | null;
  availableQty: number;
  sequenceGroup: number;
}): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];
  const priority = String(input.priority || '').toLowerCase();
  if (['urgent', 'critical', 'high', '紧急', '高'].includes(priority)) {
    score += 300;
    reasons.push('业务高优先级');
  }
  if (input.dueDate) {
    const due = normalizeWorkDate(input.dueDate);
    const days = Math.round((due.getTime() - normalizeWorkDate(input.workDate).getTime()) / 86_400_000);
    if (days < 0) {
      score += 1_000 + Math.min(365, Math.abs(days));
      reasons.push(`已逾期 ${Math.abs(days)} 天`);
    } else if (days <= 2) {
      score += 500 - days * 100;
      reasons.push(days === 0 ? '今日到期' : `${days} 天内到期`);
    }
  }
  if (input.availableQty > 0) {
    score += 100;
    reasons.push('上游良品已释放');
  } else {
    reasons.push('等待上游，可提前预排');
  }
  score += Math.max(0, 50 - input.sequenceGroup);
  return { score, reasons };
}

export function serializeDailyPlanValue<T>(value: T): T {
  if (typeof value === 'bigint') return value.toString() as T;
  if (value instanceof Date) return value.toISOString() as T;
  if (Array.isArray(value)) return value.map(item => serializeDailyPlanValue(item)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, serializeDailyPlanValue(item)]),
    ) as T;
  }
  return value;
}
