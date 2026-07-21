import type { Employee, ProcessTimeStandard } from '@prisma/client';
import type {
  EmployeeDTO,
  ProcessTimeBasis,
  ProcessTimeStandardDTO,
} from '@/types';
import { chinaDateKey } from '@/lib/china-date';

export const PROCESS_TIME_BASES: ProcessTimeBasis[] = ['per_unit', 'per_batch'];
export const MAX_PROCESS_MILLISECONDS = 2_147_483_647;

type StandardWithCreator = ProcessTimeStandard & {
  createdBy?: { id: string; username: string; displayName: string } | null;
};

export function cleanProcessText(value: unknown, max: number): string {
  return String(value ?? '').trim().slice(0, max);
}

export function parseProcessTimeBasis(value: unknown): ProcessTimeBasis {
  return value === 'per_batch' ? 'per_batch' : 'per_unit';
}

export function secondsToMilliseconds(value: unknown, fieldLabel: string, allowZero = false): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || (!allowZero && parsed <= 0)) {
    throw new Error(`${fieldLabel}${allowZero ? '不能小于 0' : '必须大于 0'}`);
  }
  const milliseconds = Math.round(parsed * 1000);
  if (milliseconds > MAX_PROCESS_MILLISECONDS) throw new Error(`${fieldLabel}超出允许范围`);
  return milliseconds;
}

export function positiveInteger(value: unknown, fieldLabel: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${fieldLabel}必须是正整数`);
  return parsed;
}

export function nonnegativeInteger(value: unknown, fieldLabel: string): number {
  const parsed = Number(value ?? 0);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${fieldLabel}不能小于 0`);
  return parsed;
}

export function calculateStandardLaborMilliseconds(input: {
  timeBasis: ProcessTimeBasis;
  standardMillisecondsPerUnit: number;
  setupMilliseconds: number;
  goodQty: number;
  unitsPerProduct: number;
}): number {
  const variable = input.timeBasis === 'per_batch'
    ? input.standardMillisecondsPerUnit
    : input.standardMillisecondsPerUnit * input.goodQty * input.unitsPerProduct;
  const total = input.setupMilliseconds + variable;
  if (!Number.isSafeInteger(total) || total <= 0 || total > MAX_PROCESS_MILLISECONDS) {
    throw new Error('本次标准工时超出允许范围，请拆分批次或调整标准');
  }
  return total;
}

export function calculateProductProcessLaborMilliseconds(input: {
  aggregateMillisecondsPerProduct: number;
  goodQty: number;
}): number {
  const total = input.aggregateMillisecondsPerProduct * input.goodQty;
  if (!Number.isSafeInteger(total) || total <= 0 || total > MAX_PROCESS_MILLISECONDS) {
    throw new Error('本次标准工时超出允许范围，请拆分报工数量');
  }
  return total;
}

export function calculateProcessReportProgress(input: {
  targetQuantity: number;
  previouslyReportedGoodQuantity: number;
  submittedGoodQuantity: number;
}): {
  reportedGoodQuantity: number;
  remainingGoodQuantity: number;
  completed: boolean;
} {
  const targetQuantity = Math.trunc(input.targetQuantity);
  const previouslyReportedGoodQuantity = Math.trunc(input.previouslyReportedGoodQuantity);
  const submittedGoodQuantity = Math.trunc(input.submittedGoodQuantity);
  if (targetQuantity <= 0 || previouslyReportedGoodQuantity < 0 || submittedGoodQuantity <= 0) {
    throw new Error('报工数量不正确');
  }
  const remainingBeforeReport = Math.max(0, targetQuantity - previouslyReportedGoodQuantity);
  if (submittedGoodQuantity > remainingBeforeReport) {
    throw new Error(`本次合格数量不能超过当前工序剩余数量 ${remainingBeforeReport}`);
  }
  const reportedGoodQuantity = previouslyReportedGoodQuantity + submittedGoodQuantity;
  const remainingGoodQuantity = Math.max(0, targetQuantity - reportedGoodQuantity);
  return {
    reportedGoodQuantity,
    remainingGoodQuantity,
    completed: remainingGoodQuantity === 0,
  };
}

export function calculateActualLaborMilliseconds(
  startedAt: Date,
  endedAt: Date,
  breakMilliseconds: number,
): number {
  const actual = endedAt.getTime() - startedAt.getTime() - breakMilliseconds;
  if (!Number.isSafeInteger(actual) || actual <= 0 || actual > MAX_PROCESS_MILLISECONDS) {
    throw new Error('实际作业时长必须大于休息时长，且单次不能超过 596 小时');
  }
  return actual;
}

export function calculateAttainmentBasisPoints(
  standardLaborMilliseconds: number,
  actualLaborMilliseconds: number,
): number {
  return Math.max(0, Math.round((standardLaborMilliseconds / actualLaborMilliseconds) * 10_000));
}

export function serializeProcessTimeStandard(standard: StandardWithCreator): ProcessTimeStandardDTO {
  return {
    id: standard.id,
    processDefinitionId: standard.processDefinitionId,
    version: standard.version,
    timeBasis: parseProcessTimeBasis(standard.timeBasis),
    unitLabel: standard.unitLabel,
    standardMillisecondsPerUnit: standard.standardMillisecondsPerUnit,
    setupMilliseconds: standard.setupMilliseconds,
    countsForEfficiency: standard.countsForEfficiency,
    isCurrent: standard.isCurrent,
    effectiveFrom: standard.effectiveFrom.toISOString(),
    remark: standard.remark,
    createdBy: standard.createdBy
      ? {
          id: standard.createdBy.id,
          username: standard.createdBy.username,
          displayName: standard.createdBy.displayName,
        }
      : null,
    createdAt: standard.createdAt.toISOString(),
  };
}

export function serializeEmployee(employee: Employee): EmployeeDTO {
  return {
    id: employee.id,
    employeeNo: employee.employeeNo,
    name: employee.name,
    department: employee.department,
    position: employee.position,
    team: employee.team,
    isActive: employee.isActive,
    attendanceEnabled: employee.attendanceEnabled,
    createdAt: employee.createdAt.toISOString(),
    updatedAt: employee.updatedAt.toISOString(),
  };
}

export function formatProcessDuration(milliseconds: number): string {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return '0 分钟';
  if (milliseconds < 60_000) {
    const seconds = milliseconds / 1000;
    return `${Number.isInteger(seconds) ? seconds : Number(seconds.toFixed(2))} 秒`;
  }
  const minutes = milliseconds / 60_000;
  if (minutes < 60) return `${Number(minutes.toFixed(1))} 分钟`;
  const hours = minutes / 60;
  return `${Number(hours.toFixed(2))} 小时`;
}

function chinaMidnight(dateKey: string): Date {
  return new Date(`${dateKey}T00:00:00+08:00`);
}

function addUtcDays(value: Date, days: number): Date {
  return new Date(value.getTime() + days * 86_400_000);
}

export function employeeReportRange(
  period: 'today' | 'week' | 'month',
  requestedDate?: string | null,
): { date: string; start: Date; end: Date } {
  const fallback = chinaDateKey(new Date());
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(requestedDate || ''))
    ? String(requestedDate)
    : fallback;
  const anchor = chinaMidnight(date);
  if (Number.isNaN(anchor.getTime())) return employeeReportRange(period, fallback);
  if (period === 'today') return { date, start: anchor, end: addUtcDays(anchor, 1) };
  if (period === 'week') {
    const chinaNoon = new Date(`${date}T12:00:00+08:00`);
    const day = chinaNoon.getUTCDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    const start = addUtcDays(anchor, mondayOffset);
    return { date, start, end: addUtcDays(start, 7) };
  }
  const [year, month] = date.split('-').map(Number);
  const start = new Date(`${year}-${String(month).padStart(2, '0')}-01T00:00:00+08:00`);
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const end = new Date(`${nextYear}-${String(nextMonth).padStart(2, '0')}-01T00:00:00+08:00`);
  return { date, start, end };
}
