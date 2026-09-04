import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AttendanceGroupInputError,
  attendanceGroupEmployeeWhere,
  inferAttendanceGroup,
  parseAttendanceGroup,
  parseOptionalAttendanceGroup,
} from '../lib/attendance-groups';

test('legacy attendance group suggestion separates front, back and sample employees', () => {
  assert.equal(inferAttendanceGroup({ department: '生产部', team: '前端压接组' }), 'PRODUCTION_FRONT');
  assert.equal(inferAttendanceGroup({ department: '生产部', position: '后端装配' }), 'PRODUCTION_BACK');
  assert.equal(inferAttendanceGroup({ department: '生产部', team: '样品组' }), 'SAMPLE');
});

test('unknown production employees remain visible in unassigned instead of being guessed', () => {
  assert.equal(inferAttendanceGroup({ department: '生产部', position: '操作员' }), 'UNASSIGNED');
  assert.equal(inferAttendanceGroup({}), 'UNASSIGNED');
  assert.equal(inferAttendanceGroup({ department: '财务部' }), 'OTHER');
});

test('attendance group input is closed to known values', () => {
  assert.equal(parseAttendanceGroup('sample'), 'SAMPLE');
  assert.equal(parseOptionalAttendanceGroup('PRODUCTION_FRONT'), 'PRODUCTION_FRONT');
  assert.equal(parseOptionalAttendanceGroup(''), null);
  assert.throws(() => parseOptionalAttendanceGroup('front-end'), AttendanceGroupInputError);
});

test('batch group where condition is explicit and can be omitted', () => {
  assert.deepEqual(attendanceGroupEmployeeWhere('SAMPLE'), { attendanceGroup: 'SAMPLE' });
  assert.deepEqual(attendanceGroupEmployeeWhere(null), {});
});

