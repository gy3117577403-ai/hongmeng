import {
  calculateTaskStandardMilliseconds,
  type DailyPlanTimeSnapshot,
} from '@/lib/daily-plan-domain';

export type WeeklyCompletionFilter = 'ALL' | 'INCOMPLETE' | 'COMPLETED';
export type WeeklyProcessSort =
  | 'DUE_ASC'
  | 'REMAINING_LABOR_DESC'
  | 'REMAINING_LABOR_ASC'
  | 'TOTAL_LABOR_DESC'
  | 'ROUTE_ASC';
export type WeeklyCompletionState = 'NOT_STARTED' | 'IN_PROGRESS' | 'PENDING_COVERAGE' | 'COMPLETED';
export type WeeklyDueTone = 'OVERDUE' | 'TODAY' | 'SOON' | 'NORMAL' | 'COMPLETED';

export type WeeklyProcessLabor = {
  total: bigint;
  completed: bigint;
  remaining: bigint;
  pendingCoverage: bigint;
};

function normalizedLegacyKey(value: string): string {
  return value
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase('zh-CN')
    .replace(/[\s\-_./\\]+/g, '');
}

export function weeklyProcessKey(input: {
  processDefinitionId?: string | null;
  processCode?: string | null;
  processName?: string | null;
}): string {
  const definitionId = String(input.processDefinitionId || '').trim();
  if (definitionId) return `definition:${definitionId}`;
  const legacy = normalizedLegacyKey(String(input.processCode || input.processName || '待维护'));
  return `legacy:${legacy || '待维护'}`;
}

export function weeklyProcessPresetScopeKey(input: {
  processKey: string;
  stepId?: string | null;
}): string {
  const stepId = String(input.stepId || '').trim();
  return stepId ? `step:${stepId}` : `process:${input.processKey}`;
}

export function parseWeeklyCompletionFilter(value: unknown): WeeklyCompletionFilter {
  const normalized = String(value || 'ALL').trim().toUpperCase();
  return normalized === 'COMPLETED' || normalized === 'INCOMPLETE' ? normalized : 'ALL';
}

export function parseWeeklyProcessSort(value: unknown): WeeklyProcessSort {
  const normalized = String(value || 'DUE_ASC').trim().toUpperCase();
  return new Set<WeeklyProcessSort>([
    'DUE_ASC',
    'REMAINING_LABOR_DESC',
    'REMAINING_LABOR_ASC',
    'TOTAL_LABOR_DESC',
    'ROUTE_ASC',
  ]).has(normalized as WeeklyProcessSort)
    ? normalized as WeeklyProcessSort
    : 'DUE_ASC';
}

export function weeklyCompletionState(input: {
  batchQuantity: number;
  processedQuantity: number;
  reportedQuantity?: number;
  pendingCoverageQuantity?: number;
  stepStatus?: string | null;
}): WeeklyCompletionState {
  if (input.stepStatus === 'completed' || input.processedQuantity >= input.batchQuantity) {
    return 'COMPLETED';
  }
  if ((input.pendingCoverageQuantity || 0) > 0) return 'PENDING_COVERAGE';
  if (input.processedQuantity > 0 || (input.reportedQuantity || 0) > 0) return 'IN_PROGRESS';
  return 'NOT_STARTED';
}

export function matchesWeeklyCompletionFilter(
  state: WeeklyCompletionState,
  filter: WeeklyCompletionFilter,
): boolean {
  if (filter === 'ALL') return true;
  return filter === 'COMPLETED' ? state === 'COMPLETED' : state !== 'COMPLETED';
}

export function weeklyDueTone(input: {
  dueDate: string;
  today: string;
  completed: boolean;
}): WeeklyDueTone {
  if (input.completed) return 'COMPLETED';
  const due = Date.parse(`${input.dueDate}T00:00:00.000Z`);
  const today = Date.parse(`${input.today}T00:00:00.000Z`);
  if (!Number.isFinite(due) || !Number.isFinite(today)) return 'NORMAL';
  const days = Math.round((due - today) / 86_400_000);
  if (days < 0) return 'OVERDUE';
  if (days === 0) return 'TODAY';
  if (days <= 2) return 'SOON';
  return 'NORMAL';
}

export function weeklyProcessLabor(input: {
  snapshot: DailyPlanTimeSnapshot | null;
  batchQuantity: number;
  processedQuantity: number;
  reportedQuantity?: number;
  pendingCoverageQuantity?: number;
}): WeeklyProcessLabor {
  if (!input.snapshot || input.batchQuantity <= 0) {
    return { total: 0n, completed: 0n, remaining: 0n, pendingCoverage: 0n };
  }
  const batchQuantity = Math.max(0, input.batchQuantity);
  const coveredQuantity = Math.min(batchQuantity, Math.max(0, input.processedQuantity));
  const reportedQuantity = Math.min(
    batchQuantity,
    Math.max(coveredQuantity, input.reportedQuantity || coveredQuantity),
  );
  const total = calculateTaskStandardMilliseconds(input.snapshot, batchQuantity);
  const completed = input.snapshot.timeBasis === 'per_batch'
    ? (coveredQuantity >= batchQuantity ? total : 0n)
    : calculateTaskStandardMilliseconds(input.snapshot, coveredQuantity);
  const remaining = total > completed ? total - completed : 0n;
  let pendingCoverage = 0n;
  if ((input.pendingCoverageQuantity || 0) > 0) {
    pendingCoverage = input.snapshot.timeBasis === 'per_batch'
      ? (reportedQuantity >= batchQuantity && coveredQuantity < batchQuantity ? total : 0n)
      : calculateTaskStandardMilliseconds(input.snapshot, reportedQuantity) - completed;
  }
  return {
    total,
    completed,
    remaining,
    pendingCoverage: pendingCoverage > 0n ? pendingCoverage : 0n,
  };
}

export function compareWeeklyProcessRows(
  left: {
    dueDate: string;
    remainingLaborMilliseconds: bigint;
    totalLaborMilliseconds: bigint;
    workOrderCode: string;
    position: number;
  },
  right: {
    dueDate: string;
    remainingLaborMilliseconds: bigint;
    totalLaborMilliseconds: bigint;
    workOrderCode: string;
    position: number;
  },
  sort: WeeklyProcessSort,
): number {
  const compareBigInt = (a: bigint, b: bigint): number => a === b ? 0 : a > b ? 1 : -1;
  let result = 0;
  if (sort === 'REMAINING_LABOR_DESC') {
    result = compareBigInt(right.remainingLaborMilliseconds, left.remainingLaborMilliseconds);
  } else if (sort === 'REMAINING_LABOR_ASC') {
    result = compareBigInt(left.remainingLaborMilliseconds, right.remainingLaborMilliseconds);
  } else if (sort === 'TOTAL_LABOR_DESC') {
    result = compareBigInt(right.totalLaborMilliseconds, left.totalLaborMilliseconds);
  } else if (sort === 'ROUTE_ASC') {
    result = left.position - right.position;
  } else {
    result = left.dueDate.localeCompare(right.dueDate);
    if (!result) {
      result = compareBigInt(
        right.remainingLaborMilliseconds,
        left.remainingLaborMilliseconds,
      );
    }
  }
  if (result) return result;
  return left.dueDate.localeCompare(right.dueDate)
    || left.workOrderCode.localeCompare(right.workOrderCode, 'zh-CN')
    || left.position - right.position;
}
