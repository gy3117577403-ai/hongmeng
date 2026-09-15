import { basisPoints, ATTAINMENT_CAPACITY_FACTOR } from '@/lib/attendance';

export const EMPLOYEE_HOURS_METRIC_VERSION = 'submitted-work-realtime-v3';

/** Production credit is earned on the business date, independently of attendance reconciliation. */
export type EmployeeHoursDayInput = import('@/lib/employee-realtime-hours').RealtimeHoursBreakdown & {
  scheduledTargetMilliseconds?: number;
  attendanceMilliseconds: number;
  standardLaborMilliseconds: number;
  exemptAbnormalMilliseconds: number;
  otherWorkMilliseconds?: number;
  otherWorkCount?: number;
  actualLaborMilliseconds?: number;
  claimedStandardLaborMilliseconds?: number;
  actualOvertimeMilliseconds?: number;
  attendanceConfirmed: boolean;
  attendanceRequired?: boolean;
  attainmentEligible?: boolean;
  attainmentStream?: string;
  isFuture?: boolean;
};

const nonnegative = (value = 0) => Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;

export function employeeHoursDayMetrics(input: EmployeeHoursDayInput) {
  const future = input.isFuture === true;
  const attendanceMilliseconds = !future && input.attendanceConfirmed ? nonnegative(input.attendanceMilliseconds) : 0;
  const actualOvertimeMilliseconds = !future && input.attendanceConfirmed ? nonnegative(input.actualOvertimeMilliseconds) : 0;
  const recognizedOvertimeMilliseconds = Math.min(attendanceMilliseconds, actualOvertimeMilliseconds);
  const attendanceDataIssue = actualOvertimeMilliseconds > attendanceMilliseconds ? 'overtime_exceeds_attendance' as const : null;
  const standardLaborMilliseconds = future ? 0 : nonnegative(input.standardLaborMilliseconds);
  const exemptAbnormalMilliseconds = future ? 0 : nonnegative(input.exemptAbnormalMilliseconds);
  const creditedAbnormalMilliseconds = exemptAbnormalMilliseconds;
  const otherWorkMilliseconds = future ? 0 : nonnegative(input.otherWorkMilliseconds);
  const actualLaborMilliseconds = future ? 0 : nonnegative(input.actualLaborMilliseconds);
  // The daily historical stream controls inclusion. A personal capacity multiplier no longer changes this formula.
  const eligible = !future && input.attainmentEligible !== false && (input.attainmentStream ?? 'batch') === 'batch';
  const hasOutput = standardLaborMilliseconds > 0 || exemptAbnormalMilliseconds > 0 || otherWorkMilliseconds > 0;
  const incomplete = eligible && (
    attendanceDataIssue !== null
    || (hasOutput && (!input.attendanceConfirmed || attendanceMilliseconds <= 0))
    || (input.attendanceRequired === true && !input.attendanceConfirmed)
  );
  const attainmentCapacityMilliseconds = eligible ? attendanceMilliseconds * ATTAINMENT_CAPACITY_FACTOR : 0;
  const attainmentNumeratorMilliseconds = eligible ? standardLaborMilliseconds + exemptAbnormalMilliseconds + otherWorkMilliseconds : 0;
  const estimatedCapacityMilliseconds = eligible && !attendanceDataIssue ? (input.attendanceConfirmed ? attendanceMilliseconds
    : nonnegative(input.scheduledTargetMilliseconds)) * ATTAINMENT_CAPACITY_FACTOR : 0;
  const missingTimeRecordCount = future ? 0 : nonnegative(input.missingTimeRecordCount);
  return {
    attendanceMilliseconds,
    regularAttendanceMilliseconds: attendanceMilliseconds - recognizedOvertimeMilliseconds,
    recognizedOvertimeMilliseconds,
    actualOvertimeMilliseconds,
    attendanceDataIssue,
    standardLaborMilliseconds,
    claimedStandardLaborMilliseconds: future ? 0 : nonnegative(input.claimedStandardLaborMilliseconds),
    exemptAbnormalMilliseconds,
    creditedAbnormalMilliseconds,
    otherWorkMilliseconds,
    otherWorkCount: future ? 0 : nonnegative(input.otherWorkCount),
    restAllowanceMilliseconds: eligible ? attendanceMilliseconds - attainmentCapacityMilliseconds : 0,
    actualLaborMilliseconds,
    pendingMatchingMilliseconds: future ? 0 : nonnegative(input.pendingMatchingMilliseconds),
    pendingReviewMilliseconds: future ? 0 : nonnegative(input.pendingReviewMilliseconds),
    reportedDurationMilliseconds: future ? 0 : nonnegative(input.reportedDurationMilliseconds),
    missingTimeRecordCount,
    estimatedCapacityMilliseconds,
    estimatedAttainmentBasisPoints: estimatedCapacityMilliseconds > 0
      ? basisPoints(attainmentNumeratorMilliseconds, estimatedCapacityMilliseconds) : null,
    unmatchedStandardLaborMilliseconds: 0,
    attainmentCapacityMilliseconds,
    attainmentNumeratorMilliseconds,
    attainmentIncompleteDays: incomplete ? 1 : 0,
    attainmentDataComplete: !incomplete,
    attainmentBasisPoints: incomplete ? null : basisPoints(attainmentNumeratorMilliseconds, attainmentCapacityMilliseconds),
    effectiveProductionMilliseconds: attendanceMilliseconds,
    unexplainedMilliseconds: Math.max(0, attendanceMilliseconds * ATTAINMENT_CAPACITY_FACTOR - actualLaborMilliseconds - exemptAbnormalMilliseconds - otherWorkMilliseconds),
  };
}

export function aggregateEmployeeHours(days: Iterable<EmployeeHoursDayInput>) {
  const totals = {
    attendanceMilliseconds: 0, regularAttendanceMilliseconds: 0, recognizedOvertimeMilliseconds: 0,
    actualOvertimeMilliseconds: 0, standardLaborMilliseconds: 0, claimedStandardLaborMilliseconds: 0,
    exemptAbnormalMilliseconds: 0, creditedAbnormalMilliseconds: 0, actualLaborMilliseconds: 0,
    otherWorkMilliseconds: 0, otherWorkCount: 0, restAllowanceMilliseconds: 0,
    unmatchedStandardLaborMilliseconds: 0, attainmentCapacityMilliseconds: 0, attainmentNumeratorMilliseconds: 0,
    pendingMatchingMilliseconds: 0, pendingReviewMilliseconds: 0, reportedDurationMilliseconds: 0, missingTimeRecordCount: 0,
    estimatedCapacityMilliseconds: 0, estimatedMissingDays: 0,
    attainmentIncompleteDays: 0, effectiveProductionMilliseconds: 0, unexplainedMilliseconds: 0,
  };
  for (const day of days) {
    const metrics = employeeHoursDayMetrics(day);
    for (const key of Object.keys(totals) as Array<keyof typeof totals>) {
      if (key === 'estimatedMissingDays') continue;
      totals[key] += metrics[key];
    }
    if (metrics.attainmentIncompleteDays && metrics.estimatedCapacityMilliseconds <= 0) totals.estimatedMissingDays += 1;
  }
  return {
    ...totals,
    attendanceMissingDays: totals.attainmentIncompleteDays,
    attainmentDataComplete: totals.attainmentIncompleteDays === 0,
    estimatedAttainmentBasisPoints: totals.estimatedMissingDays > 0 ? null
      : basisPoints(totals.attainmentNumeratorMilliseconds, totals.estimatedCapacityMilliseconds),
    attainmentBasisPoints: totals.attainmentIncompleteDays > 0
      ? null : basisPoints(totals.attainmentNumeratorMilliseconds, totals.attainmentCapacityMilliseconds),
  };
}
