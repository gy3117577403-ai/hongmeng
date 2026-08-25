import { basisPoints } from '@/lib/attendance';

export type ReportMetricTone = 'excellent' | 'good' | 'watch' | 'risk' | 'over' | 'empty';

export type ReportWeekBucket = {
  key: string;
  label: string;
  startDate: string;
  endDate: string;
};

export type PlanBatchAllocationInput = {
  id: string;
  workOrderId: string | null;
  quantity: number;
  plannedDateKey: string;
};

export type WeeklyPlanProgressInput = {
  id: string;
  weekStartDateKey: string;
  quantity: number;
  completedQuantity: number;
};

export type WeeklyPlanProgressRow = ReportWeekBucket & {
  isFutureWeek: boolean;
  scheduledBatches: number;
  plannedBatches: number;
  futureBatches: number;
  completedBatches: number;
  scheduledQuantity: number;
  plannedQuantity: number;
  futureQuantity: number;
  completedQuantity: number;
  batchCompletionBasisPoints: number | null;
  quantityCompletionBasisPoints: number | null;
};

const DAY_MILLISECONDS = 86_400_000;

export function parseReportMonth(value: unknown, fallbackDate: string): string {
  const fallback = /^\d{4}-\d{2}/.exec(fallbackDate)?.[0] || '1970-01';
  const candidate = String(value || '').trim();
  if (!/^\d{4}-\d{2}$/.test(candidate)) return fallback;
  const [year, month] = candidate.split('-').map(Number);
  if (year < 2000 || year > 2200 || month < 1 || month > 12) return fallback;
  return candidate;
}

export function nextReportMonth(month: string): string {
  const [year, monthNumber] = month.split('-').map(Number);
  const nextYear = monthNumber === 12 ? year + 1 : year;
  const nextMonth = monthNumber === 12 ? 1 : monthNumber + 1;
  return `${nextYear}-${String(nextMonth).padStart(2, '0')}`;
}

export function reportMonthDateKeys(month: string): string[] {
  const [year, monthNumber] = month.split('-').map(Number);
  const next = nextReportMonth(month);
  const start = new Date(`${year}-${String(monthNumber).padStart(2, '0')}-01T00:00:00.000Z`);
  const end = new Date(`${next}-01T00:00:00.000Z`);
  const keys: string[] = [];
  for (let cursor = start; cursor < end; cursor = new Date(cursor.getTime() + DAY_MILLISECONDS)) {
    keys.push(cursor.toISOString().slice(0, 10));
  }
  return keys;
}

function mondayFor(dateKey: string): string {
  const date = new Date(`${dateKey}T12:00:00.000Z`);
  const day = date.getUTCDay();
  const offset = day === 0 ? -6 : 1 - day;
  return new Date(date.getTime() + offset * DAY_MILLISECONDS).toISOString().slice(0, 10);
}

export function reportMonthWeekBuckets(month: string): ReportWeekBucket[] {
  const dateKeys = reportMonthDateKeys(month);
  return reportRangeWeekBuckets(dateKeys);
}

export function reportRangeWeekBuckets(dateKeys: string[]): ReportWeekBucket[] {
  const buckets = new Map<string, { startDate: string; endDate: string }>();
  for (const dateKey of dateKeys) {
    const monday = mondayFor(dateKey);
    const existing = buckets.get(monday);
    if (existing) existing.endDate = dateKey;
    else buckets.set(monday, { startDate: dateKey, endDate: dateKey });
  }
  return [...buckets.entries()].map(([key, range], index) => ({
    key,
    label: `第 ${index + 1} 周`,
    startDate: range.startDate,
    endDate: range.endDate,
  }));
}

export function reportWeekKey(dateKey: string): string {
  return mondayFor(dateKey);
}

/**
 * Production-plan week dates have historically been stored at more than one
 * UTC time (for example UTC midnight and Shanghai noon). Query by the complete
 * Shanghai calendar-week window so those equivalent business dates are not
 * lost by an exact timestamp comparison.
 */
export function reportWeekStorageRange(
  buckets: readonly ReportWeekBucket[],
): { gte: Date; lt: Date } | null {
  const first = buckets[0];
  const last = buckets[buckets.length - 1];
  if (!first || !last) return null;
  const gte = new Date(`${first.key}T00:00:00+08:00`);
  const lastStart = new Date(`${last.key}T00:00:00+08:00`);
  return { gte, lt: new Date(lastStart.getTime() + (7 * DAY_MILLISECONDS)) };
}

export function reportMetricTone(value: number | null | undefined): ReportMetricTone {
  if (value === null || value === undefined) return 'empty';
  if (value > 11_000) return 'over';
  if (value >= 10_000) return 'excellent';
  if (value >= 9_500) return 'good';
  if (value >= 8_500) return 'watch';
  return 'risk';
}

export function cappedBasisPoints(numerator: number, denominator: number): number | null {
  const ratio = basisPoints(Math.max(0, numerator), Math.max(0, denominator));
  return ratio === null ? null : Math.min(10_000, ratio);
}

/**
 * A weekly-plan rate measures progress for production weeks that have started.
 * Every batch assigned to the current or a historical production week belongs
 * to the denominator immediately, and an early completion belongs to the
 * numerator immediately. Entire weeks that have not started remain future and
 * deliberately have no rate instead of being shown as zero percent.
 */
export function summarizeWeeklyPlanProgress(
  buckets: readonly ReportWeekBucket[],
  batches: readonly WeeklyPlanProgressInput[],
  cutoffDateKey: string,
): WeeklyPlanProgressRow[] {
  const cutoffWeekKey = reportWeekKey(cutoffDateKey);
  const rows = buckets.map(bucket => ({
    ...bucket,
    isFutureWeek: bucket.key > cutoffWeekKey,
    scheduledBatches: 0,
    plannedBatches: 0,
    futureBatches: 0,
    completedBatches: 0,
    scheduledQuantity: 0,
    plannedQuantity: 0,
    futureQuantity: 0,
    completedQuantity: 0,
    batchCompletionBasisPoints: null as number | null,
    quantityCompletionBasisPoints: null as number | null,
  }));
  const rowByWeek = new Map(rows.map(row => [row.key, row]));

  for (const batch of batches) {
    const row = rowByWeek.get(reportWeekKey(batch.weekStartDateKey));
    if (!row) continue;
    const plannedQuantity = Math.max(0, Math.trunc(batch.quantity || 0));
    const completedQuantity = Math.min(
      plannedQuantity,
      Math.max(0, Math.trunc(batch.completedQuantity || 0)),
    );
    row.scheduledBatches += 1;
    row.scheduledQuantity += plannedQuantity;
    if (row.isFutureWeek) {
      row.futureBatches += 1;
      row.futureQuantity += plannedQuantity;
      continue;
    }
    row.plannedBatches += 1;
    row.plannedQuantity += plannedQuantity;
    row.completedQuantity += completedQuantity;
    if (plannedQuantity > 0 && completedQuantity >= plannedQuantity) row.completedBatches += 1;
  }

  for (const row of rows) {
    row.batchCompletionBasisPoints = cappedBasisPoints(row.completedBatches, row.plannedBatches);
    row.quantityCompletionBasisPoints = cappedBasisPoints(row.completedQuantity, row.plannedQuantity);
  }
  return rows;
}

/**
 * Allocate final-good quantity once per work order, oldest planned batch first.
 * This prevents one work order's completion total from being credited in full
 * to every weekly-plan batch that points at the same work order.
 */
export function allocatePlanBatchCompletionQuantities(
  batches: readonly PlanBatchAllocationInput[],
  completedByWorkOrder: ReadonlyMap<string, number>,
): Map<string, number> {
  const remaining = new Map<string, number>();
  for (const [workOrderId, quantity] of completedByWorkOrder) {
    remaining.set(workOrderId, Math.max(0, Math.trunc(quantity || 0)));
  }
  const allocated = new Map<string, number>();
  const ordered = [...batches].sort((left, right) => (
    left.plannedDateKey.localeCompare(right.plannedDateKey)
    || left.id.localeCompare(right.id)
  ));
  for (const batch of ordered) {
    const planned = Math.max(0, Math.trunc(batch.quantity || 0));
    if (!batch.workOrderId || planned <= 0) {
      allocated.set(batch.id, 0);
      continue;
    }
    const available = remaining.get(batch.workOrderId) || 0;
    const quantity = Math.min(planned, available);
    allocated.set(batch.id, quantity);
    remaining.set(batch.workOrderId, Math.max(0, available - quantity));
  }
  return allocated;
}
