import { chinaDateKey } from '@/lib/china-date';
import { employeeHireDateToDate, normalizeEmployeeHireDateInput } from '@/lib/employee-date';
import { cleanProcessText } from '@/lib/process-time';

export const EMPLOYEE_RESIGNATION_REASONS = [
  '主动离职',
  '协商解除',
  '合同到期',
  '公司解除',
  '退休',
  '其他',
] as const;

export class EmployeeOffboardingError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, options?: { status?: number; code?: string }) {
    super(message);
    this.name = 'EmployeeOffboardingError';
    this.status = options?.status ?? 400;
    this.code = options?.code ?? 'INVALID_OFFBOARDING_REQUEST';
  }
}

export function parseEmployeeEffectiveDate(value: unknown, options?: { allowFuture?: boolean }): {
  key: string;
  value: Date;
} {
  const normalized = normalizeEmployeeHireDateInput(value);
  if (!normalized) throw new EmployeeOffboardingError('请选择生效日期');
  const today = chinaDateKey(new Date());
  if (!options?.allowFuture && normalized > today) {
    throw new EmployeeOffboardingError('暂不支持未来日期自动生效，请在离职当天办理');
  }
  return { key: normalized, value: employeeHireDateToDate(normalized)! };
}

export function parseOffboardingInput(body: Record<string, unknown>): {
  effectiveDateKey: string;
  effectiveDate: Date;
  reason: string;
  note: string | null;
} {
  const effectiveDate = parseEmployeeEffectiveDate(body.effectiveDate);
  const reason = cleanProcessText(body.reason, 40);
  if (!EMPLOYEE_RESIGNATION_REASONS.includes(reason as typeof EMPLOYEE_RESIGNATION_REASONS[number])) {
    throw new EmployeeOffboardingError('请选择有效的离职原因');
  }
  return {
    effectiveDateKey: effectiveDate.key,
    effectiveDate: effectiveDate.value,
    reason,
    note: cleanProcessText(body.note, 500) || null,
  };
}
