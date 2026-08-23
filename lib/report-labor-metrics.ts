import { attainmentCapacityMilliseconds, basisPoints } from '@/lib/attendance';
import type { AttendanceType } from '@/types';

export type AttendanceOvertimeSource = 'confirmed_plan' | 'attendance_fallback' | 'none';

export type AttendanceDayMetricInput = {
  attendanceType: AttendanceType | null;
  scheduledMilliseconds: number;
  plannedOvertimeMilliseconds: number;
  actualOvertimeMilliseconds: number;
  leaveMilliseconds: number;
  actualAttendanceMilliseconds: number;
  allowAttendanceOvertimeFallback?: boolean;
  /** True means a confirmed daily plan supplied overtime, including an explicit zero. */
  plannedOvertimeConfirmed?: boolean;
};

export type AttendanceDayMetricResult = {
  scheduledMilliseconds: number;
  plannedOvertimeMilliseconds: number;
  recognizedOvertimeMilliseconds: number;
  actualOvertimeMilliseconds: number;
  leaveDeductionMilliseconds: number;
  netExpectedMilliseconds: number;
  actualAttendanceMilliseconds: number;
  extraAttendanceMilliseconds: number;
  attendanceRawBasisPoints: number | null;
  attendanceBasisPoints: number | null;
  overtimeSource: AttendanceOvertimeSource;
  excludedFromAttendanceBase: boolean;
};

function nonNegative(value: number | null | undefined): number {
  return Number.isFinite(value) ? Math.max(0, Math.round(value || 0)) : 0;
}

/**
 * Historical attendance uses a confirmed daily-plan overtime target when one
 * exists. Older dates without such a target may fall back to confirmed
 * attendance overtime, but the caller must surface that provenance.
 *
 * `actualAttendanceMilliseconds` already contains overtime. Overtime belongs
 * in the expected-hours denominator here and must never be added to the actual
 * numerator a second time.
 */
export function attendanceDayMetrics(input: AttendanceDayMetricInput): AttendanceDayMetricResult {
  const rest = input.attendanceType === 'rest';
  const fullLeave = input.attendanceType === 'leave';
  const scheduledMilliseconds = rest ? 0 : nonNegative(input.scheduledMilliseconds);
  const plannedOvertimeMilliseconds = rest ? 0 : nonNegative(input.plannedOvertimeMilliseconds);
  const actualOvertimeMilliseconds = rest ? 0 : nonNegative(input.actualOvertimeMilliseconds);
  const allowAttendanceFallback = input.allowAttendanceOvertimeFallback !== false;
  const hasConfirmedPlanOvertime = input.plannedOvertimeConfirmed === true
    || plannedOvertimeMilliseconds > 0;
  const recognizedOvertimeMilliseconds = hasConfirmedPlanOvertime
    ? plannedOvertimeMilliseconds
    : allowAttendanceFallback
      ? actualOvertimeMilliseconds
      : 0;
  const overtimeSource: AttendanceOvertimeSource = hasConfirmedPlanOvertime
    ? 'confirmed_plan'
    : recognizedOvertimeMilliseconds > 0
      ? 'attendance_fallback'
      : 'none';
  const grossExpectedMilliseconds = scheduledMilliseconds + recognizedOvertimeMilliseconds;
  const requestedLeaveMilliseconds = nonNegative(input.leaveMilliseconds);
  const leaveDeductionMilliseconds = rest
    ? 0
    : fullLeave
      ? grossExpectedMilliseconds
      : Math.min(grossExpectedMilliseconds, requestedLeaveMilliseconds);
  const netExpectedMilliseconds = Math.max(0, grossExpectedMilliseconds - leaveDeductionMilliseconds);
  const actualAttendanceMilliseconds = rest ? 0 : nonNegative(input.actualAttendanceMilliseconds);
  const attendanceRawBasisPoints = basisPoints(actualAttendanceMilliseconds, netExpectedMilliseconds);
  const attendanceBasisPoints = attendanceRawBasisPoints === null
    ? null
    : Math.min(10_000, attendanceRawBasisPoints);

  return {
    scheduledMilliseconds,
    plannedOvertimeMilliseconds,
    recognizedOvertimeMilliseconds,
    actualOvertimeMilliseconds,
    leaveDeductionMilliseconds,
    netExpectedMilliseconds,
    actualAttendanceMilliseconds,
    extraAttendanceMilliseconds: Math.max(0, actualAttendanceMilliseconds - netExpectedMilliseconds),
    attendanceRawBasisPoints,
    attendanceBasisPoints,
    overtimeSource,
    excludedFromAttendanceBase: netExpectedMilliseconds <= 0,
  };
}

export type LaborPerformanceMetricInput = {
  attendanceMilliseconds: number;
  actualLaborMilliseconds: number;
  exemptAbnormalMilliseconds: number;
  standardLaborMilliseconds: number;
  attainmentFactorBasisPoints: number;
};

export type LaborPerformanceMetricResult = {
  accountedMilliseconds: number;
  overlapMilliseconds: number;
  unexplainedMilliseconds: number;
  utilizationBasisPoints: number | null;
  efficiencyBasisPoints: number | null;
  effectiveAttendanceMilliseconds: number;
  attainmentCapacityMilliseconds: number;
  targetAttainmentBasisPoints: number | null;
};

export function laborPerformanceMetrics(input: LaborPerformanceMetricInput): LaborPerformanceMetricResult {
  const attendanceMilliseconds = nonNegative(input.attendanceMilliseconds);
  const actualLaborMilliseconds = nonNegative(input.actualLaborMilliseconds);
  const exemptAbnormalMilliseconds = nonNegative(input.exemptAbnormalMilliseconds);
  const standardLaborMilliseconds = nonNegative(input.standardLaborMilliseconds);
  const factorBasisPoints = Math.max(0, Math.min(10_000, nonNegative(input.attainmentFactorBasisPoints)));
  const accountedMilliseconds = actualLaborMilliseconds + exemptAbnormalMilliseconds;
  const overlapMilliseconds = Math.max(0, accountedMilliseconds - attendanceMilliseconds);
  const coveredMilliseconds = Math.min(attendanceMilliseconds, accountedMilliseconds);
  const effectiveAttendanceMilliseconds = Math.max(0, attendanceMilliseconds - exemptAbnormalMilliseconds);
  const targetCapacity = Math.round(
    attainmentCapacityMilliseconds(effectiveAttendanceMilliseconds) * factorBasisPoints / 10_000,
  );

  return {
    accountedMilliseconds,
    overlapMilliseconds,
    unexplainedMilliseconds: Math.max(0, attendanceMilliseconds - accountedMilliseconds),
    utilizationBasisPoints: basisPoints(coveredMilliseconds, attendanceMilliseconds),
    efficiencyBasisPoints: basisPoints(standardLaborMilliseconds, actualLaborMilliseconds),
    effectiveAttendanceMilliseconds,
    attainmentCapacityMilliseconds: targetCapacity,
    targetAttainmentBasisPoints: basisPoints(standardLaborMilliseconds, targetCapacity),
  };
}
