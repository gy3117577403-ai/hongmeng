import assert from 'node:assert/strict';
import test from 'node:test';
import {
  attendanceEmployeeWhere,
  attendanceRecordScopeWhere,
  isProductionDepartment,
  isProductionWorkforceEmployee,
  normalizeEmployeeDepartment,
  parseAttendanceWorkforceScope,
  PRODUCTION_DEPARTMENT,
} from '../lib/production-workforce';

test('production department aliases normalize to the existing HR department', () => {
  assert.equal(isProductionDepartment('生产部'), true);
  assert.equal(isProductionDepartment(' 生 产 '), true);
  assert.equal(isProductionDepartment('质量部'), false);
  assert.equal(normalizeEmployeeDepartment('生产'), PRODUCTION_DEPARTMENT);
  assert.equal(normalizeEmployeeDepartment(' 质量部 '), '质量部');
  assert.equal(normalizeEmployeeDepartment(''), null);
});

test('production workforce requires active attendance-enabled production employees', () => {
  assert.equal(isProductionWorkforceEmployee({ department: '生产部', isActive: true, attendanceEnabled: true }), true);
  assert.equal(isProductionWorkforceEmployee({ department: '生产部', isActive: false, attendanceEnabled: true }), false);
  assert.equal(isProductionWorkforceEmployee({ department: '生产', isActive: true, attendanceEnabled: false }), false);
  assert.equal(isProductionWorkforceEmployee({ department: '总经办', isActive: true, attendanceEnabled: true }), false);
});

test('attendance workforce scope defaults safely to production', () => {
  assert.equal(parseAttendanceWorkforceScope(undefined), 'PRODUCTION');
  assert.equal(parseAttendanceWorkforceScope('other'), 'OTHER');
  assert.equal(parseAttendanceWorkforceScope('ALL'), 'ALL');
  assert.deepEqual(attendanceEmployeeWhere('PRODUCTION'), {
    isActive: true,
    attendanceEnabled: true,
    department: { in: ['生产部', '生产'] },
  });
  assert.deepEqual(attendanceRecordScopeWhere('ALL'), {});
});
