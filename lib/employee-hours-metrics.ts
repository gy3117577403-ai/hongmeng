import { basisPoints } from '@/lib/attendance';

/** Production credit is earned on the business date, independently of attendance reconciliation. */
export type EmployeeHoursDayInput = {
  attendanceMilliseconds: number;
  standardLaborMilliseconds: number;
  exemptAbnormalMilliseconds: number;
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
  const creditedAbnormalMilliseconds = exemptAbnormalMilliseconds * 95 / 100;
  const actualLaborMilliseconds = future ? 0 : nonnegative(input.actualLaborMilliseconds);
  // The daily historical stream controls inclusion. A personal capacity multiplier no longer changes this formula.
  const eligible = !future && input.attainmentEligible !== false && (input.attainmentStream ?? 'batch') === 'batch';
  const hasOutput = standardLaborMilliseconds > 0 || exemptAbnormalMilliseconds > 0;
  const incomplete = eligible && (
    attendanceDataIssue !== null
    || (hasOutput && (!input.attendanceConfirmed || attendanceMilliseconds <= 0))
    || (input.attendanceRequired === true && !input.attendanceConfirmed)
  );
  const attainmentCapacityMilliseconds = eligible ? attendanceMilliseconds : 0;
  const attainmentNumeratorMilliseconds = eligible ? standardLaborMilliseconds + creditedAbnormalMilliseconds : 0;
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
    actualLaborMilliseconds,
    unmatchedStandardLaborMilliseconds: 0,
    attainmentCapacityMilliseconds,
    attainmentNumeratorMilliseconds,
    attainmentIncompleteDays: incomplete ? 1 : 0,
    attainmentDataComplete: !incomplete,
    attainmentBasisPoints: incomplete ? null : basisPoints(attainmentNumeratorMilliseconds, attainmentCapacityMilliseconds),
    effectiveProductionMilliseconds: attendanceMilliseconds,
    unexplainedMilliseconds: Math.max(0, attendanceMilliseconds - actualLaborMilliseconds - exemptAbnormalMilliseconds),
  };
}

export function aggregateEmployeeHours(days: Iterable<EmployeeHoursDayInput>) {
  const totals = {
    attendanceMilliseconds: 0, regularAttendanceMilliseconds: 0, recognizedOvertimeMilliseconds: 0,
    actualOvertimeMilliseconds: 0, standardLaborMilliseconds: 0, claimedStandardLaborMilliseconds: 0,
    exemptAbnormalMilliseconds: 0, creditedAbnormalMilliseconds: 0, actualLaborMilliseconds: 0,
    unmatchedStandardLaborMilliseconds: 0, attainmentCapacityMilliseconds: 0, attainmentNumeratorMilliseconds: 0,
    attainmentIncompleteDays: 0, effectiveProductionMilliseconds: 0, unexplainedMilliseconds: 0,
  };
  for (const day of days) {
    const metrics = employeeHoursDayMetrics(day);
    for (const key of Object.keys(totals) as Array<keyof typeof totals>) totals[key] += metrics[key];
  }
  return {
    ...totals,
    attendanceMissingDays: totals.attainmentIncompleteDays,
    attainmentDataComplete: totals.attainmentIncompleteDays === 0,
    attainmentBasisPoints: totals.attainmentIncompleteDays > 0
      ? null : basisPoints(totals.attainmentNumeratorMilliseconds, totals.attainmentCapacityMilliseconds),
  };
}
