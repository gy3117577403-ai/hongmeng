import assert from 'node:assert/strict';
import test from 'node:test';
import {
  attendanceEmployeeWhere,
  attendanceRecordScopeWhere,
  employeeHiredBeforeWhere,
  employeeHiredOnOrBeforeWhere,
  isEmployeeHiredOnDate,
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

test('attendance effective date excludes employees before their hire date', () => {
  assert.equal(isEmployeeHiredOnDate({ hireDate: new Date('2026-08-12T00:00:00.000Z') }, '2026-08-11'), false);
  assert.equal(isEmployeeHiredOnDate({ hireDate: '2026-08-12' }, '2026-08-12'), true);
  assert.equal(isEmployeeHiredOnDate({ hireDate: null }, '2026-08-01'), true);
  assert.deepEqual(employeeHiredOnOrBeforeWhere(new Date('2026-08-12T00:00:00.000Z')), {
    OR: [{ hireDate: null }, { hireDate: { lte: new Date('2026-08-12T00:00:00.000Z') } }],
  });
  assert.deepEqual(employeeHiredBeforeWhere(new Date('2026-09-01T00:00:00.000Z')), {
    OR: [{ hireDate: null }, { hireDate: { lt: new Date('2026-09-01T00:00:00.000Z') } }],
  });
});
