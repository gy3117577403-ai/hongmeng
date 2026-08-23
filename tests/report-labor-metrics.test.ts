import assert from 'node:assert/strict';
import test from 'node:test';
import {
  attendanceDayMetrics,
  laborPerformanceMetrics,
} from '@/lib/report-labor-metrics';

const hour = 3_600_000;

test('confirmed overtime expands the attendance denominator without double counting actual attendance', () => {
  const result = attendanceDayMetrics({
    attendanceType: 'normal',
    scheduledMilliseconds: 8 * hour,
    plannedOvertimeMilliseconds: 0,
    actualOvertimeMilliseconds: 2 * hour,
    leaveMilliseconds: 0,
    actualAttendanceMilliseconds: 10 * hour,
  });
  assert.equal(result.recognizedOvertimeMilliseconds, 2 * hour);
  assert.equal(result.netExpectedMilliseconds, 10 * hour);
  assert.equal(result.actualAttendanceMilliseconds, 10 * hour);
  assert.equal(result.attendanceRawBasisPoints, 10_000);
  assert.equal(result.attendanceBasisPoints, 10_000);
  assert.equal(result.overtimeSource, 'attendance_fallback');
});

test('confirmed plan overtime wins over attendance fallback and extra time remains visible', () => {
  const result = attendanceDayMetrics({
    attendanceType: 'normal',
    scheduledMilliseconds: 8 * hour,
    plannedOvertimeMilliseconds: 1 * hour,
    actualOvertimeMilliseconds: 2 * hour,
    leaveMilliseconds: 0,
    actualAttendanceMilliseconds: 10 * hour,
  });
  assert.equal(result.netExpectedMilliseconds, 9 * hour);
  assert.equal(result.extraAttendanceMilliseconds, 1 * hour);
  assert.equal(result.attendanceRawBasisPoints, 11_111);
  assert.equal(result.attendanceBasisPoints, 10_000);
  assert.equal(result.overtimeSource, 'confirmed_plan');
});

test('an explicit confirmed zero-overtime plan does not fall back to attendance overtime', () => {
  const result = attendanceDayMetrics({
    attendanceType: 'normal',
    scheduledMilliseconds: 8 * hour,
    plannedOvertimeMilliseconds: 0,
    plannedOvertimeConfirmed: true,
    actualOvertimeMilliseconds: 2 * hour,
    leaveMilliseconds: 0,
    actualAttendanceMilliseconds: 10 * hour,
  });
  assert.equal(result.recognizedOvertimeMilliseconds, 0);
  assert.equal(result.netExpectedMilliseconds, 8 * hour);
  assert.equal(result.extraAttendanceMilliseconds, 2 * hour);
  assert.equal(result.overtimeSource, 'confirmed_plan');
});

test('full leave is excluded instead of producing zero attainment', () => {
  const result = attendanceDayMetrics({
    attendanceType: 'leave',
    scheduledMilliseconds: 8 * hour,
    plannedOvertimeMilliseconds: 2 * hour,
    actualOvertimeMilliseconds: 0,
    leaveMilliseconds: 8 * hour,
    actualAttendanceMilliseconds: 0,
  });
  assert.equal(result.leaveDeductionMilliseconds, 10 * hour);
  assert.equal(result.netExpectedMilliseconds, 0);
  assert.equal(result.attendanceBasisPoints, null);
  assert.equal(result.excludedFromAttendanceBase, true);
});

test('partial leave reduces the expected hours and retains the worked portion', () => {
  const result = attendanceDayMetrics({
    attendanceType: 'partial_leave',
    scheduledMilliseconds: 8 * hour,
    plannedOvertimeMilliseconds: 0,
    actualOvertimeMilliseconds: 0,
    leaveMilliseconds: 4 * hour,
    actualAttendanceMilliseconds: 4 * hour,
  });
  assert.equal(result.netExpectedMilliseconds, 4 * hour);
  assert.equal(result.attendanceBasisPoints, 10_000);
  assert.equal(result.excludedFromAttendanceBase, false);
});

test('absence stays in the attendance denominator but has no performance denominator', () => {
  const attendance = attendanceDayMetrics({
    attendanceType: 'absent',
    scheduledMilliseconds: 8 * hour,
    plannedOvertimeMilliseconds: 0,
    actualOvertimeMilliseconds: 0,
    leaveMilliseconds: 0,
    actualAttendanceMilliseconds: 0,
  });
  const performance = laborPerformanceMetrics({
    attendanceMilliseconds: 0,
    actualLaborMilliseconds: 0,
    exemptAbnormalMilliseconds: 0,
    standardLaborMilliseconds: 0,
    attainmentFactorBasisPoints: 10_000,
  });
  assert.equal(attendance.attendanceBasisPoints, 0);
  assert.equal(performance.targetAttainmentBasisPoints, null);
});

test('performance separates utilization, standard efficiency, target attainment, and overlaps', () => {
  const result = laborPerformanceMetrics({
    attendanceMilliseconds: 8 * hour,
    actualLaborMilliseconds: 7 * hour,
    exemptAbnormalMilliseconds: 2 * hour,
    standardLaborMilliseconds: 6 * hour,
    attainmentFactorBasisPoints: 10_000,
  });
  assert.equal(result.utilizationBasisPoints, 10_000);
  assert.equal(result.overlapMilliseconds, 1 * hour);
  assert.equal(result.unexplainedMilliseconds, 0);
  assert.equal(result.efficiencyBasisPoints, 8_571);
  assert.equal(result.attainmentCapacityMilliseconds, 5.7 * hour);
  assert.equal(result.targetAttainmentBasisPoints, 10_526);
});
