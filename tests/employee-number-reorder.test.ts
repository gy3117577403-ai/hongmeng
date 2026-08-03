import assert from 'node:assert/strict';
import test from 'node:test';
import type { Employee } from '@prisma/client';
import {
  buildEmployeeNumberReorderPreview,
  employeeRosterFingerprint,
  EmployeeNumberReorderError,
  parseEmployeeNumberReorderItems,
} from '../lib/employee-number-reorder';

function employee(id: string, employeeNo: string, name: string, active = true): Employee {
  return {
    id,
    employeeNo,
    name,
    department: '生产部',
    position: '操作员',
    team: '装配',
    isActive: active,
    attendanceEnabled: true,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date(id.endsWith('a')
      ? '2026-08-01T00:00:01.000Z'
      : '2026-08-01T00:00:02.000Z'),
  };
}

test('employee number reorder previews an explicit existing and supplemental order', () => {
  const employees = [employee('employee-a', '0001', '员工甲'), employee('employee-b', '0002', '员工乙')];
  const items = parseEmployeeNumberReorderItems([
    { kind: 'EXISTING', employeeId: 'employee-b' },
    { kind: 'NEW', clientKey: 'new-c', name: '员工丙', department: '工程部', position: '工程师', team: '工程' },
    { kind: 'EXISTING', employeeId: 'employee-a' },
  ]);
  const preview = buildEmployeeNumberReorderPreview({ employees, items });

  assert.deepEqual(preview.rows.map(row => [row.name, row.oldEmployeeNo, row.newEmployeeNo]), [
    ['员工乙', '0002', '0001'],
    ['员工丙', null, '0002'],
    ['员工甲', '0001', '0003'],
  ]);
  assert.equal(preview.employeeCount, 3);
  assert.equal(preview.existingCount, 2);
  assert.equal(preview.createdCount, 1);
  assert.equal(preview.changedCount, 3);
  assert.equal(preview.nextEmployeeNo, '0004');
  assert.equal(preview.confirmationText, '确认重排3人');
});

test('employee number reorder requires every existing active or inactive employee exactly once', () => {
  const employees = [employee('employee-a', '0001', '员工甲'), employee('employee-b', '0002', '离职员工', false)];
  const items = parseEmployeeNumberReorderItems([{ kind: 'EXISTING', employeeId: 'employee-a' }]);

  assert.throws(
    () => buildEmployeeNumberReorderPreview({ employees, items }),
    (error: unknown) => error instanceof EmployeeNumberReorderError
      && error.code === 'EMPLOYEE_REORDER_ROSTER_INCOMPLETE',
  );
});

test('employee number reorder rejects duplicate existing employees and blank supplemental names', () => {
  assert.throws(
    () => parseEmployeeNumberReorderItems([
      { kind: 'EXISTING', employeeId: 'employee-a' },
      { kind: 'EXISTING', employeeId: 'employee-a' },
    ]),
    /重复/,
  );
  assert.throws(
    () => parseEmployeeNumberReorderItems([{ kind: 'NEW', clientKey: 'new-a', name: '  ' }]),
    /缺少姓名/,
  );
});

test('employee roster fingerprint changes when a number or update version changes', () => {
  const base = [employee('employee-a', '0001', '员工甲')];
  const initial = employeeRosterFingerprint(base);
  assert.equal(initial, employeeRosterFingerprint(base.map(item => ({ ...item }))));
  assert.notEqual(initial, employeeRosterFingerprint([{ ...base[0], employeeNo: '0002' }]));
  assert.notEqual(initial, employeeRosterFingerprint([{ ...base[0], updatedAt: new Date('2026-08-02T00:00:00.000Z') }]));
});
