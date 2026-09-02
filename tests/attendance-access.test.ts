import assert from 'node:assert/strict';
import test from 'node:test';
import {
  attendanceHistoricalRecordWhere,
  departedAttendanceCorrectionError,
} from '../lib/attendance-access';
import { attendanceRecordScopeWhere } from '../lib/production-workforce';

test('historical attendance access keeps HR unrestricted but confines workshop access to production facts', () => {
  assert.deepEqual(attendanceHistoricalRecordWhere({
    unrestricted: true,
    productionScope: 'NONE',
  }), {});
  assert.deepEqual(attendanceHistoricalRecordWhere({
    unrestricted: false,
    productionScope: 'WORKSHOP',
  }), attendanceRecordScopeWhere('PRODUCTION'));
  assert.deepEqual(attendanceHistoricalRecordWhere({
    unrestricted: false,
    productionScope: 'GLOBAL',
  }), attendanceRecordScopeWhere('PRODUCTION'));
});

test('team historical attendance uses the immutable team snapshot with a legacy fallback only', () => {
  assert.deepEqual(attendanceHistoricalRecordWhere({
    unrestricted: false,
    productionScope: 'TEAM',
    teamValues: ['TEAM-1', ' 压接组 ', '压接组'],
  }), {
    OR: [
      { teamSnapshot: { in: ['TEAM-1', '压接组'] } },
      {
        teamSnapshot: null,
        employee: { team: { in: ['TEAM-1', '压接组'] } },
      },
    ],
  });
});

test('self and unresolved team historical attendance fail closed', () => {
  assert.deepEqual(attendanceHistoricalRecordWhere({
    unrestricted: false,
    productionScope: 'NONE',
    employeeId: 'employee-1',
  }), { employeeId: 'employee-1' });
  assert.deepEqual(attendanceHistoricalRecordWhere({
    unrestricted: false,
    productionScope: 'TEAM',
    teamValues: [],
  }), { employeeId: { in: [] } });
  assert.deepEqual(attendanceHistoricalRecordWhere({
    unrestricted: false,
    productionScope: 'NONE',
  }), { employeeId: { in: [] } });
});

test('departed attendance can only correct an existing fact with HR update permission and an audit reason', () => {
  assert.deepEqual(departedAttendanceCorrectionError({
    hasHrUpdate: false,
    existingRecord: true,
    correctionReason: '纸质考勤核对',
  }), { status: 403, error: '离职员工的历史考勤仅限人事更新权限纠正' });
  assert.equal(departedAttendanceCorrectionError({
    hasHrUpdate: true,
    existingRecord: false,
    correctionReason: '纸质考勤核对',
  })?.status, 409);
  assert.equal(departedAttendanceCorrectionError({
    hasHrUpdate: true,
    existingRecord: true,
    correctionReason: '   ',
  })?.status, 400);
  assert.equal(departedAttendanceCorrectionError({
    hasHrUpdate: true,
    existingRecord: true,
    correctionReason: '纸质考勤核对',
  }), null);
});
