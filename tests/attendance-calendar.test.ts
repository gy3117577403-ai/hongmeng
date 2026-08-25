import assert from 'node:assert/strict';
import test from 'node:test';
import {
  attendanceCalendarDayLabel,
  attendanceMonthKey,
  resolveAttendanceCalendarDay,
} from '../lib/attendance-calendar';

test('factory calendar defaults Monday through Saturday to work and Sunday to weekly rest', () => {
  const saturday = resolveAttendanceCalendarDay('2026-08-01');
  const sunday = resolveAttendanceCalendarDay('2026-08-02');
  const monday = resolveAttendanceCalendarDay('2026-08-03');
  assert.equal(saturday.effectiveDayType, 'workday');
  assert.equal(saturday.isWorkday, true);
  assert.equal(sunday.weekday, '周日');
  assert.equal(sunday.effectiveDayType, 'weekly_rest');
  assert.equal(sunday.isWorkday, false);
  assert.equal(attendanceCalendarDayLabel(sunday), '周休');
  assert.equal(monday.effectiveDayType, 'workday');
});

test('calendar overrides exclude holidays and activate temporary weekend work', () => {
  const holiday = resolveAttendanceCalendarDay('2026-10-01', {
    dayType: 'holiday',
    label: '国庆节',
    remark: '法定节假日',
  });
  const sundayWork = resolveAttendanceCalendarDay('2026-08-02', {
    dayType: 'temporary_workday',
    label: '临时赶工',
  });
  assert.equal(holiday.effectiveDayType, 'holiday');
  assert.equal(holiday.isWorkday, false);
  assert.equal(attendanceCalendarDayLabel(holiday), '国庆节');
  assert.equal(sundayWork.effectiveDayType, 'temporary_workday');
  assert.equal(sundayWork.isWorkday, true);
  assert.equal(attendanceCalendarDayLabel(sundayWork), '临时赶工');
});

test('default override returns a date to its weekday rule and month keys are validated', () => {
  const sunday = resolveAttendanceCalendarDay('2026-08-02', { dayType: 'default', label: 'ignored' });
  assert.equal(sunday.effectiveDayType, 'weekly_rest');
  assert.equal(attendanceMonthKey('2026-08-25'), '2026-08');
  assert.throws(() => attendanceMonthKey('2026-13'), /有效日历月份/);
});
