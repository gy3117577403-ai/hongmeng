import type { Employee } from '@prisma/client';
import { normalizeEmployeeHireDateInput } from '@/lib/employee-date';
import { formatEmployeeNumber } from '@/lib/employee-number';
import type { EmployeeNumberReorderInput } from '@/lib/employee-number-reorder';

const MAX_IMPORT_ROWS = 2_000;
const employeeNameHeaders = new Set(['姓名', '员工姓名']);
const employeeNumberHeaders = new Set(['工号', '员工编号']);
const hireDateHeaders = new Set(['入职日期', '入职时间']);

export type EmployeeRosterTargetRow = {
  rowNo: number;
  name: string;
  targetEmployeeNo: string;
  hireDate: string | null;
};

export type EmployeeRosterMatrixResult = {
  headerRowNo: number;
  rows: EmployeeRosterTargetRow[];
  blankHireDateCount: number;
};

export type EmployeeRosterImportPlan = {
  items: EmployeeNumberReorderInput[];
  summary: {
    targetCount: number;
    matchedCount: number;
    createdCount: number;
    preservedUnlistedCount: number;
    blankHireDateCount: number;
    firstTargetEmployeeNo: string;
    lastTargetEmployeeNo: string;
  };
};

export class EmployeeRosterImportError extends Error {
  code: string;
  status: number;

  constructor(message: string, code: string, status = 400) {
    super(message);
    this.name = 'EmployeeRosterImportError';
    this.code = code;
    this.status = status;
  }
}

function text(value: unknown): string {
  return String(value ?? '').trim();
}

function normalizedHeader(value: unknown): string {
  return text(value).replace(/[\s　]+/g, '');
}

export function normalizeEmployeeRosterName(value: unknown): string {
  return text(value).replace(/[\s　]+/g, '').toLocaleLowerCase('zh-CN');
}

function targetEmployeeNumber(value: unknown, rowNo: number): string {
  const raw = text(value).replace(/[\s　]+/g, '');
  if (!/^\d+$/.test(raw)) {
    throw new EmployeeRosterImportError(`第 ${rowNo} 行工号“${raw || '空'}”不是正整数`, 'EMPLOYEE_ROSTER_NUMBER_INVALID');
  }
  const numeric = Number(raw);
  if (!Number.isSafeInteger(numeric) || numeric < 1 || numeric > 999_999_999) {
    throw new EmployeeRosterImportError(`第 ${rowNo} 行工号超出允许范围`, 'EMPLOYEE_ROSTER_NUMBER_INVALID');
  }
  return formatEmployeeNumber(numeric);
}

function excelSerialDate(value: number): string | null {
  if (!Number.isFinite(value) || value <= 0 || value > 2_958_465) return null;
  const milliseconds = Date.UTC(1899, 11, 30) + Math.floor(value) * 86_400_000;
  return new Date(milliseconds).toISOString().slice(0, 10);
}

function rosterHireDate(value: unknown, rowNo: number): string | null {
  if (value === null || value === undefined || text(value) === '') return null;
  try {
    if (typeof value === 'number') {
      const parsed = excelSerialDate(value);
      if (!parsed) throw new Error('invalid serial');
      return parsed;
    }
    return normalizeEmployeeHireDateInput(value) ?? null;
  } catch {
    throw new EmployeeRosterImportError(
      `第 ${rowNo} 行入职日期“${text(value)}”无效，请使用 YYYY-MM-DD`,
      'EMPLOYEE_ROSTER_HIRE_DATE_INVALID',
    );
  }
}

export function parseEmployeeRosterMatrix(matrix: unknown[][]): EmployeeRosterMatrixResult {
  const headerIndex = matrix.slice(0, 20).findIndex(row => {
    const headers = row.map(normalizedHeader);
    return headers.some(header => employeeNameHeaders.has(header))
      && headers.some(header => employeeNumberHeaders.has(header));
  });
  if (headerIndex < 0) {
    throw new EmployeeRosterImportError(
      '未找到“姓名”和“工号”表头',
      'EMPLOYEE_ROSTER_HEADER_MISSING',
    );
  }

  const headers = matrix[headerIndex].map(normalizedHeader);
  const nameIndex = headers.findIndex(header => employeeNameHeaders.has(header));
  const numberIndex = headers.findIndex(header => employeeNumberHeaders.has(header));
  const hireDateIndex = headers.findIndex(header => hireDateHeaders.has(header));
  const rows: EmployeeRosterTargetRow[] = [];
  const seenNames = new Map<string, number>();
  const seenNumbers = new Map<string, number>();

  for (let offset = 0; offset < Math.min(matrix.length - headerIndex - 1, MAX_IMPORT_ROWS); offset += 1) {
    const source = matrix[headerIndex + 1 + offset] || [];
    const rowNo = headerIndex + offset + 2;
    const rawName = text(source[nameIndex]);
    const rawNumber = source[numberIndex];
    const rawHireDate = hireDateIndex >= 0 ? source[hireDateIndex] : null;
    if (!rawName && !text(rawNumber) && !text(rawHireDate)) continue;
    if (!rawName) {
      throw new EmployeeRosterImportError(`第 ${rowNo} 行缺少员工姓名`, 'EMPLOYEE_ROSTER_NAME_REQUIRED');
    }
    if (!text(rawNumber)) {
      throw new EmployeeRosterImportError(`第 ${rowNo} 行缺少工号`, 'EMPLOYEE_ROSTER_NUMBER_REQUIRED');
    }

    const normalizedName = normalizeEmployeeRosterName(rawName);
    const employeeNo = targetEmployeeNumber(rawNumber, rowNo);
    const duplicateNameRow = seenNames.get(normalizedName);
    if (duplicateNameRow) {
      throw new EmployeeRosterImportError(
        `第 ${rowNo} 行姓名“${rawName}”与第 ${duplicateNameRow} 行重复`,
        'EMPLOYEE_ROSTER_DUPLICATE_NAME',
      );
    }
    const duplicateNumberRow = seenNumbers.get(employeeNo);
    if (duplicateNumberRow) {
      throw new EmployeeRosterImportError(
        `第 ${rowNo} 行工号 ${employeeNo} 与第 ${duplicateNumberRow} 行重复`,
        'EMPLOYEE_ROSTER_DUPLICATE_NUMBER',
      );
    }
    seenNames.set(normalizedName, rowNo);
    seenNumbers.set(employeeNo, rowNo);
    rows.push({
      rowNo,
      name: rawName,
      targetEmployeeNo: employeeNo,
      hireDate: rosterHireDate(rawHireDate, rowNo),
    });
  }

  if (!rows.length) {
    throw new EmployeeRosterImportError('目标工号名单没有有效人员数据', 'EMPLOYEE_ROSTER_EMPTY');
  }
  if (matrix.length - headerIndex - 1 > MAX_IMPORT_ROWS) {
    throw new EmployeeRosterImportError(`单次最多导入 ${MAX_IMPORT_ROWS} 人`, 'EMPLOYEE_ROSTER_TOO_LARGE');
  }

  rows.sort((left, right) => Number(left.targetEmployeeNo) - Number(right.targetEmployeeNo));
  return {
    headerRowNo: headerIndex + 1,
    rows,
    blankHireDateCount: rows.filter(row => !row.hireDate).length,
  };
}

export function buildEmployeeRosterImportPlan(input: {
  employees: Employee[];
  targetRows: EmployeeRosterTargetRow[];
  blankHireDateCount?: number;
}): EmployeeRosterImportPlan {
  const existingByName = new Map<string, Employee[]>();
  for (const employee of input.employees) {
    const key = normalizeEmployeeRosterName(employee.name);
    existingByName.set(key, [...(existingByName.get(key) || []), employee]);
  }

  const matchedEmployeeIds = new Set<string>();
  let matchedCount = 0;
  let createdCount = 0;
  const items = input.targetRows.map<EmployeeNumberReorderInput>(row => {
    const matches = existingByName.get(normalizeEmployeeRosterName(row.name)) || [];
    if (matches.length > 1) {
      const details = matches.map(employee => `${employee.employeeNo} ${employee.name}`).join('、');
      throw new EmployeeRosterImportError(
        `名单中的“${row.name}”匹配到多份现有档案（${details}），请先合并或改名后再导入`,
        'EMPLOYEE_ROSTER_AMBIGUOUS_NAME',
        409,
      );
    }
    if (matches.length === 1) {
      const employee = matches[0];
      matchedEmployeeIds.add(employee.id);
      matchedCount += 1;
      return {
        kind: 'EXISTING',
        employeeId: employee.id,
        targetEmployeeNo: row.targetEmployeeNo,
        ...(row.hireDate ? { hireDate: row.hireDate } : {}),
      };
    }
    createdCount += 1;
    return {
      kind: 'NEW',
      clientKey: `roster:${row.rowNo}:${row.targetEmployeeNo}`,
      name: row.name,
      department: null,
      position: null,
      team: null,
      isActive: true,
      attendanceEnabled: true,
      targetEmployeeNo: row.targetEmployeeNo,
      ...(row.hireDate ? { hireDate: row.hireDate } : {}),
    };
  });

  const unlisted = input.employees
    .filter(employee => !matchedEmployeeIds.has(employee.id))
    .sort((left, right) => left.employeeNo.localeCompare(right.employeeNo, 'zh-CN', { numeric: true }));
  let nextNumber = Math.max(...input.targetRows.map(row => Number(row.targetEmployeeNo)), 0) + 1;
  for (const employee of unlisted) {
    items.push({
      kind: 'EXISTING',
      employeeId: employee.id,
      targetEmployeeNo: formatEmployeeNumber(nextNumber),
    });
    nextNumber += 1;
  }

  return {
    items,
    summary: {
      targetCount: input.targetRows.length,
      matchedCount,
      createdCount,
      preservedUnlistedCount: unlisted.length,
      blankHireDateCount: input.blankHireDateCount ?? input.targetRows.filter(row => !row.hireDate).length,
      firstTargetEmployeeNo: input.targetRows[0].targetEmployeeNo,
      lastTargetEmployeeNo: input.targetRows[input.targetRows.length - 1].targetEmployeeNo,
    },
  };
}
