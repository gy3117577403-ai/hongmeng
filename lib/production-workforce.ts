import type { Prisma } from '@prisma/client';

export const PRODUCTION_DEPARTMENT = '生产部';
export const PRODUCTION_DEPARTMENT_ALIASES = [PRODUCTION_DEPARTMENT, '生产'] as const;

export type AttendanceWorkforceScope = 'PRODUCTION' | 'OTHER' | 'ALL';

type EmployeeWorkforceShape = {
  department?: string | null;
  isActive?: boolean;
  attendanceEnabled?: boolean;
};

type EmployeeHireDateShape = {
  hireDate?: Date | string | null;
};

function normalizedDepartmentKey(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/\s+/g, '')
    .trim();
}

export function normalizeEmployeeDepartment(value: unknown): string | null {
  const department = String(value ?? '').normalize('NFKC').trim();
  if (!department) return null;
  return isProductionDepartment(department) ? PRODUCTION_DEPARTMENT : department;
}

export function isProductionDepartment(value: unknown): boolean {
  const key = normalizedDepartmentKey(value);
  return PRODUCTION_DEPARTMENT_ALIASES.some(alias => normalizedDepartmentKey(alias) === key);
}

export function isProductionWorkforceEmployee(
  employee: EmployeeWorkforceShape | null | undefined,
  options: { requireActive?: boolean; requireAttendance?: boolean } = {},
): boolean {
  if (!employee || !isProductionDepartment(employee.department)) return false;
  if (options.requireActive !== false && employee.isActive !== true) return false;
  if (options.requireAttendance !== false && employee.attendanceEnabled !== true) return false;
  return true;
}

export function parseAttendanceWorkforceScope(value: unknown): AttendanceWorkforceScope {
  const scope = String(value ?? '').trim().toUpperCase();
  return scope === 'OTHER' || scope === 'ALL' ? scope : 'PRODUCTION';
}

export function productionEmployeeWhere(
  options: { requireActive?: boolean; requireAttendance?: boolean } = {},
): Prisma.EmployeeWhereInput {
  return {
    ...(options.requireActive === false ? {} : { isActive: true }),
    ...(options.requireAttendance === false ? {} : { attendanceEnabled: true }),
    department: { in: [...PRODUCTION_DEPARTMENT_ALIASES] },
  };
}

export function employeeHiredOnOrBeforeWhere(workDate: Date): Prisma.EmployeeWhereInput {
  return {
    OR: [
      { hireDate: null },
      { hireDate: { lte: workDate } },
    ],
  };
}

export function employeeHiredBeforeWhere(rangeEndExclusive: Date): Prisma.EmployeeWhereInput {
  return {
    OR: [
      { hireDate: null },
      { hireDate: { lt: rangeEndExclusive } },
    ],
  };
}

export function isEmployeeHiredOnDate(
  employee: EmployeeHireDateShape | null | undefined,
  workDateKey: string,
): boolean {
  if (!employee?.hireDate) return true;
  const hireDateKey = employee.hireDate instanceof Date
    ? employee.hireDate.toISOString().slice(0, 10)
    : String(employee.hireDate).slice(0, 10);
  return hireDateKey <= workDateKey;
}

export function attendanceEmployeeWhere(scope: AttendanceWorkforceScope): Prisma.EmployeeWhereInput {
  const common: Prisma.EmployeeWhereInput = { isActive: true, attendanceEnabled: true };
  if (scope === 'ALL') return common;
  if (scope === 'PRODUCTION') return { ...common, department: { in: [...PRODUCTION_DEPARTMENT_ALIASES] } };
  return {
    ...common,
    OR: [
      { department: null },
      { department: { notIn: [...PRODUCTION_DEPARTMENT_ALIASES] } },
    ],
  };
}

export function attendanceRecordScopeWhere(
  scope: AttendanceWorkforceScope,
): Prisma.AttendanceRecordWhereInput {
  if (scope === 'ALL') return {};
  if (scope === 'PRODUCTION') {
    return {
      OR: [
        { departmentSnapshot: { in: [...PRODUCTION_DEPARTMENT_ALIASES] } },
        {
          departmentSnapshot: null,
          employee: { department: { in: [...PRODUCTION_DEPARTMENT_ALIASES] } },
        },
      ],
    };
  }
  return {
    OR: [
      { departmentSnapshot: { notIn: [...PRODUCTION_DEPARTMENT_ALIASES] } },
      {
        departmentSnapshot: null,
        employee: {
          OR: [
            { department: null },
            { department: { notIn: [...PRODUCTION_DEPARTMENT_ALIASES] } },
          ],
        },
      },
    ],
  };
}
