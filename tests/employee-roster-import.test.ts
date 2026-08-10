import assert from 'node:assert/strict';
import test from 'node:test';
import type { Employee } from '@prisma/client';
import {
  buildEmployeeRosterImportPlan,
  EmployeeRosterImportError,
  parseEmployeeRosterMatrix,
} from '../lib/employee-roster-import';

function employee(id: string, employeeNo: string, name: string, hireDate: Date | null = null): Employee {
  return {
    id,
    employeeNo,
    name,
    department: '生产部',
    departmentId: null,
    position: '岗位明细',
    team: '装配组',
    hireDate,
    mobile: null,
    wecomUserId: null,
    notificationEnabled: true,
    isActive: true,
    attendanceEnabled: true,
    resignedAt: null,
    resignationReason: null,
    resignationNote: null,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
  };
}

test('target roster parses employee numbers, excel dates and blank dates', () => {
  const result = parseEmployeeRosterMatrix([
    ['序号', '姓名', '工号', '入职日期'],
    [1, '韦林', '0001', null],
    [2, '张盈盈', 4, 42703],
  ]);

  assert.deepEqual(result.rows, [
    { rowNo: 2, name: '韦林', targetEmployeeNo: '0001', hireDate: null },
    { rowNo: 3, name: '张盈盈', targetEmployeeNo: '0004', hireDate: '2016-11-29' },
  ]);
  assert.equal(result.blankHireDateCount, 1);
});

test('target roster matches by exact normalized name, preserves details and appends unlisted employees', () => {
  const employees = [
    employee('existing-lin', '0001', '林 波'),
    employee('unlisted', 'QA-001', '名单外员工', new Date('2025-01-02T00:00:00.000Z')),
  ];
  const parsed = parseEmployeeRosterMatrix([
    ['姓名', '工号', '入职时间'],
    ['林波', '0032', '2025/10/30'],
    ['刘菲', '0033', '2025-10-29'],
  ]);
  const plan = buildEmployeeRosterImportPlan({ employees, targetRows: parsed.rows });

  assert.deepEqual(plan.items, [
    { kind: 'EXISTING', employeeId: 'existing-lin', targetEmployeeNo: '0032', hireDate: '2025-10-30' },
    {
      kind: 'NEW',
      clientKey: 'roster:3:0033',
      name: '刘菲',
      department: null,
      position: null,
      team: null,
      isActive: true,
      attendanceEnabled: true,
      targetEmployeeNo: '0033',
      hireDate: '2025-10-29',
    },
    { kind: 'EXISTING', employeeId: 'unlisted', targetEmployeeNo: '0034' },
  ]);
  assert.deepEqual(plan.summary, {
    targetCount: 2,
    matchedCount: 1,
    createdCount: 1,
    preservedUnlistedCount: 1,
    blankHireDateCount: 0,
    firstTargetEmployeeNo: '0032',
    lastTargetEmployeeNo: '0033',
  });
  assert.equal(employees[0].position, '岗位明细');
});

test('target roster blocks duplicate names, duplicate numbers and ambiguous existing names', () => {
  assert.throws(
    () => parseEmployeeRosterMatrix([
      ['姓名', '工号'],
      ['张三', 1],
      ['张 三', 2],
    ]),
    (error: unknown) => error instanceof EmployeeRosterImportError
      && error.code === 'EMPLOYEE_ROSTER_DUPLICATE_NAME',
  );
  assert.throws(
    () => parseEmployeeRosterMatrix([
      ['姓名', '工号'],
      ['张三', 1],
      ['李四', '0001'],
    ]),
    (error: unknown) => error instanceof EmployeeRosterImportError
      && error.code === 'EMPLOYEE_ROSTER_DUPLICATE_NUMBER',
  );
  assert.throws(
    () => buildEmployeeRosterImportPlan({
      employees: [employee('a', '0001', '王五'), employee('b', '0002', '王 五')],
      targetRows: [{ rowNo: 2, name: '王五', targetEmployeeNo: '0001', hireDate: null }],
    }),
    (error: unknown) => error instanceof EmployeeRosterImportError
      && error.code === 'EMPLOYEE_ROSTER_AMBIGUOUS_NAME',
  );
});
