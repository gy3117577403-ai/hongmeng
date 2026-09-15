import { aggregateEmployeeHours } from '@/lib/employee-hours-metrics';
import type { AttainmentStream } from '@/types';

export type DailyAttainmentInput = import('@/lib/employee-realtime-hours').RealtimeHoursBreakdown & {
  scheduledTargetMilliseconds?: number;
  teamSnapshot?: string | null;
  attendanceMilliseconds: number;
  exemptAbnormalMilliseconds: number;
  otherWorkMilliseconds?: number;
  otherWorkCount?: number;
  standardLaborMilliseconds: number;
  claimedStandardLaborMilliseconds: number;
  actualLaborMilliseconds: number;
  attendanceConfirmed: boolean;
  /** Confirmed leave/rest/absence has no production-performance denominator. */
  excludedFromAttainmentBase?: boolean;
  /** Undefined is treated as eligible for backward-compatible historical inputs. */
  attainmentEligible?: boolean;
  /** Daily immutable snapshot. Undefined keeps the historical all-or-nothing behavior. */
  attainmentFactorBasisPoints?: number;
  attainmentStream?: AttainmentStream;
  actualOvertimeMilliseconds?: number;
  attendanceRequired?: boolean;
  isFuture?: boolean;
};

export function aggregateDailyAttainment(days: Iterable<DailyAttainmentInput>) {
  return aggregateEmployeeHours(days);
}

export function shouldIncludeEmployeeInAttainmentReport(input: {
  isActive: boolean;
  hasPeriodActivity: boolean;
}): boolean {
  return input.isActive || input.hasPeriodActivity;
}
