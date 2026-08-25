import assert from 'node:assert/strict';
import test from 'node:test';
import {
  finalizeAttendanceDay,
  summarizeFinalizedAttendance,
  type AttendancePeriodDayInput,
} from '../lib/report-attendance-score';

const HOUR = 60 * 60 * 1000;

function day(overrides: Partial<AttendancePeriodDayInput> = {}): AttendancePeriodDayInput {
  const base = {
    date: '2026-08-24',
    requiredRecords: 2,
    confirmedRecords: 2,
    draftRecords: 0,
    missingRecords: 0,
    plannedPeople: 2,
    attendancePeople: 2,
    netExpectedMilliseconds: 16 * HOUR,
    attendanceMilliseconds: 16 * HOUR,
    actualOvertimeMilliseconds: 0,
    leaveDeductionMilliseconds: 0,
    extraAttendanceMilliseconds: 0,
  };
  const input = { ...base, ...overrides };
  return { ...input, ...finalizeAttendanceDay(input, '2026-08-25') };
}

test('current day with only three of thirty-five records never publishes a 100% score', () => {
  const current = day({
    date: '2026-08-25',
    requiredRecords: 35,
    confirmedRecords: 3,
    missingRecords: 32,
    plannedPeople: 3,
    attendancePeople: 3,
  });
  assert.equal(current.publicationState, 'in_progress');
  assert.equal(current.isFinalized, false);
  assert.equal(current.dataCoverageBasisPoints, 857);
  assert.equal(current.attendanceRawBasisPoints, 10_000);
  assert.equal(current.hoursBasisPoints, null);
  assert.equal(current.attendanceBasisPoints, null);
});

test('past day remains incomplete until every required attendance record is resolved', () => {
  const incomplete = day({ requiredRecords: 35, confirmedRecords: 34, missingRecords: 1 });
  assert.equal(incomplete.publicationState, 'incomplete');
  assert.equal(incomplete.dataCoverageBasisPoints, 9714);
  assert.equal(incomplete.hoursBasisPoints, null);
});

test('confirmed absence remains in the finalized attendance denominator', () => {
  const absence = day({
    requiredRecords: 2,
    confirmedRecords: 2,
    plannedPeople: 2,
    attendancePeople: 1,
    attendanceMilliseconds: 8 * HOUR,
  });
  assert.equal(absence.publicationState, 'finalized');
  assert.equal(absence.hoursBasisPoints, 5000);
  assert.equal(absence.attendanceBasisPoints, 5000);
});

test('period score reconciles only finalized days and reports coverage separately', () => {
  const finalized = day({
    netExpectedMilliseconds: 16 * HOUR,
    attendanceMilliseconds: 15 * HOUR,
    actualOvertimeMilliseconds: 2 * HOUR,
    leaveDeductionMilliseconds: HOUR,
  });
  const incomplete = day({
    date: '2026-08-23',
    requiredRecords: 2,
    confirmedRecords: 1,
    missingRecords: 1,
    netExpectedMilliseconds: 8 * HOUR,
    attendanceMilliseconds: 8 * HOUR,
  });
  const current = day({
    date: '2026-08-25',
    requiredRecords: 35,
    confirmedRecords: 3,
    missingRecords: 32,
  });
  const summary = summarizeFinalizedAttendance([incomplete, finalized, current]);
  assert.equal(summary.finalizedDays, 1);
  assert.equal(summary.incompleteDays, 1);
  assert.equal(summary.inProgressDays, 1);
  assert.equal(summary.lastFinalizedDate, '2026-08-24');
  assert.equal(summary.requiredRecords, 39);
  assert.equal(summary.resolvedRecords, 6);
  assert.equal(summary.dataCoverageBasisPoints, 1538);
  assert.equal(summary.netExpectedMilliseconds, 16 * HOUR);
  assert.equal(summary.attendanceMilliseconds, 15 * HOUR);
  assert.equal(summary.shortfallMilliseconds, HOUR);
  assert.equal(summary.attendanceBasisPoints, 9375);
});
