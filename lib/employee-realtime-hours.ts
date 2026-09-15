/** A reporting state never determines whether a person's submitted work exists. */
export type EmployeeWorkRecord = {
  id: string;
  employeeId: string;
  workDate: string;
  type: 'production' | 'abnormal' | 'other';
  source: 'claim' | 'execution' | 'completion' | 'submission' | 'abnormal' | 'other';
  sourceId: string;
  title: string;
  workOrderCode?: string;
  specification?: string | null;
  processName?: string;
  milliseconds: number;
  pendingMatchingMilliseconds: number;
  pendingReviewMilliseconds: number;
  reportedDurationMilliseconds: number;
  missingTime: boolean;
  state: 'recorded' | 'pending_match' | 'pending_review' | 'missing_time';
  recordedAt: string;
};

export const realtimeBreakdownKeys = [
  'pendingMatchingMilliseconds', 'pendingReviewMilliseconds', 'reportedDurationMilliseconds', 'missingTimeRecordCount',
] as const;

export type RealtimeHoursBreakdown = { [K in typeof realtimeBreakdownKeys[number]]?: number };

export function pendingMatchingLabor(milliseconds: number, processed: number, covered: number): number {
  return processed > 0 ? Math.round(milliseconds * Math.max(0, Math.min(1, (processed - covered) / processed))) : 0;
}

/** Stable integer allocation conserves the report total, including sub-millisecond remainders. */
export function distributeReportedLabor(milliseconds: number, employeeIds: readonly string[]) {
  const ids = [...new Set(employeeIds.filter(Boolean))].sort();
  const total = Math.max(0, Math.round(milliseconds));
  return ids.map((employeeId, index) => ({ employeeId,
    milliseconds: Math.floor(total / ids.length) + (index < total % ids.length ? 1 : 0),
  }));
}

export function submittedWorkMilliseconds(input: {
  timeBasis?: unknown; standardMillisecondsPerUnit?: unknown; unitsPerProduct?: unknown;
  setupMilliseconds?: unknown; quantity: number; targetQuantity?: number;
  workStartedAt?: unknown; workEndedAt?: unknown;
}): { milliseconds: number; basis: 'standard' | 'reported_duration' | 'missing' } {
  const standard = Number(input.standardMillisecondsPerUnit || 0);
  const quantity = Math.max(0, input.quantity);
  if (standard > 0 && Number.isFinite(standard) && quantity > 0) {
    if (input.timeBasis === 'per_unit') return { milliseconds: Math.round(
      standard * quantity * Math.max(1, Number(input.unitsPerProduct || 1))), basis: 'standard' };
    if (input.timeBasis === 'per_batch' && input.targetQuantity && input.targetQuantity > 0) {
      return { milliseconds: Math.round((standard + Math.max(0, Number(input.setupMilliseconds || 0)))
        * Math.min(1, quantity / input.targetQuantity)), basis: 'standard' };
    }
  }
  const start = input.workStartedAt ? new Date(String(input.workStartedAt)).getTime() : NaN;
  const end = input.workEndedAt ? new Date(String(input.workEndedAt)).getTime() : NaN;
  if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
    return { milliseconds: end - start, basis: 'reported_duration' };
  }
  return { milliseconds: 0, basis: 'missing' };
}

/** A submitted correction replaces its original; drafts/rejections never suppress a valid original. */
export function activeOtherWorkRecords<T extends { id: string; correctionOfId?: string | null; status: string; voidedAt?: unknown }>(records: T[]): T[] {
  const active = records.filter(record => !record.voidedAt && ['PENDING', 'APPROVED'].includes(record.status));
  const replaced = new Set(active.flatMap(record => record.correctionOfId ? [record.correctionOfId] : []));
  return active.filter(record => !replaced.has(record.id));
}
