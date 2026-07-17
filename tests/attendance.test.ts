import assert from 'node:assert/strict';
import test from 'node:test';
import {
  attendanceTotals,
  basisPoints,
  defaultAttendanceSegments,
  parseAttendanceSegments,
  parseEventDateTimes,
  STANDARD_DAY_MILLISECONDS,
} from '../lib/attendance';

test('default attendance uses 08:00-12:00 and 13:00-17:00 for eight hours', () => {
  const segments = defaultAttendanceSegments('2026-07-17');
  const totals = attendanceTotals({ attendanceType: 'normal', segments, leaveMinutes: 0 });
  assert.equal(segments.length, 2);
  assert.equal(totals.actualMilliseconds, STANDARD_DAY_MILLISECONDS);
  assert.equal(totals.overtimeMilliseconds, 0);
});

test('variable overtime is included in attendance and tracked separately', () => {
  const segments = parseAttendanceSegments([
    { type: 'regular', startedAt: '2026-07-17T08:00:00+08:00', endedAt: '2026-07-17T12:00:00+08:00' },
    { type: 'regular', startedAt: '2026-07-17T13:00:00+08:00', endedAt: '2026-07-17T17:00:00+08:00' },
    { type: 'overtime', startedAt: '2026-07-17T17:30:00+08:00', endedAt: '2026-07-17T20:00:00+08:00' },
  ], '2026-07-17');
  const totals = attendanceTotals({ attendanceType: 'normal', segments, leaveMinutes: 0 });
  assert.equal(totals.actualMilliseconds, 10.5 * 60 * 60 * 1000);
  assert.equal(totals.overtimeMilliseconds, 2.5 * 60 * 60 * 1000);
});

test('manual leave is excluded from effective attendance', () => {
  const totals = attendanceTotals({
    attendanceType: 'normal',
    segments: defaultAttendanceSegments('2026-07-17'),
    leaveMinutes: 120,
  });
  assert.equal(totals.leaveMilliseconds, 2 * 60 * 60 * 1000);
  assert.equal(totals.actualMilliseconds, 6 * 60 * 60 * 1000);
});

test('full-day leave has no effective attendance', () => {
  const totals = attendanceTotals({ attendanceType: 'leave', segments: [], leaveMinutes: 0 });
  assert.equal(totals.leaveMilliseconds, STANDARD_DAY_MILLISECONDS);
  assert.equal(totals.actualMilliseconds, 0);
});

test('attendance segments reject overlap and cross-day ranges', () => {
  assert.throws(() => parseAttendanceSegments([
    { type: 'regular', startedAt: '2026-07-17T08:00:00+08:00', endedAt: '2026-07-17T12:00:00+08:00' },
    { type: 'regular', startedAt: '2026-07-17T11:30:00+08:00', endedAt: '2026-07-17T13:00:00+08:00' },
  ], '2026-07-17'), /不能互相重叠/);
  assert.throws(() => parseAttendanceSegments([
    { type: 'overtime', startedAt: '2026-07-17T23:00:00+08:00', endedAt: '2026-07-18T01:00:00+08:00' },
  ], '2026-07-17'), /暂不支持跨天班次/);
});

test('abnormal time stays within one work date', () => {
  const event = parseEventDateTimes({
    workDate: '2026-07-17',
    startedAt: '2026-07-17T17:30:00+08:00',
    endedAt: '2026-07-17T19:00:00+08:00',
  });
  assert.equal(event.durationMilliseconds, 90 * 60 * 1000);
});

test('attainment denominator with no effective production time is explicit null', () => {
  assert.equal(basisPoints(60 * 60 * 1000, 0), null);
  assert.equal(basisPoints(6 * 60 * 60 * 1000, 8 * 60 * 60 * 1000), 7500);
});
