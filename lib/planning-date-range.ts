import { chinaDate } from '@/lib/production-planning';

export const PLANNING_RANGE_MAX_DAYS = 93;
const DAY_MILLISECONDS = 86_400_000;

export type PlanningDateRange = {
  startDate: string;
  endDate: string;
  start: Date;
  endExclusive: Date;
  days: number;
};

export function strictPlanningDate(value: unknown, label = '日期'): { key: string; value: Date } {
  const key = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) throw new Error(`${label}格式必须为 YYYY-MM-DD`);
  const utc = new Date(`${key}T00:00:00.000Z`);
  if (Number.isNaN(utc.getTime()) || utc.toISOString().slice(0, 10) !== key) throw new Error(`${label}不是有效日历日期`);
  return { key, value: utc };
}

export function parsePlanningDateRange(
  startValue: unknown,
  endValue: unknown,
  options: { maxDays?: number } = {},
): PlanningDateRange {
  const start = strictPlanningDate(startValue, '开始日期');
  const end = strictPlanningDate(endValue, '结束日期');
  if (end.value < start.value) throw new Error('结束日期不能早于开始日期');
  const days = Math.round((end.value.getTime() - start.value.getTime()) / DAY_MILLISECONDS) + 1;
  const maxDays = options.maxDays ?? PLANNING_RANGE_MAX_DAYS;
  if (days > maxDays) throw new Error(`日期范围不能超过 ${maxDays} 个自然日`);
  const endExclusive = new Date(end.value);
  endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
  return { startDate: start.key, endDate: end.key, start: start.value, endExclusive, days };
}

export function planningMonthRange(value: unknown): PlanningDateRange & { month: string } {
  const month = String(value || '').trim();
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error('月份格式必须为 YYYY-MM');
  const start = strictPlanningDate(`${month}-01`, '月份');
  const nextMonth = new Date(start.value);
  nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
  if (chinaDate(nextMonth).slice(0, 7) === month) throw new Error('月份不是有效日历月份');
  const end = new Date(nextMonth);
  end.setUTCDate(end.getUTCDate() - 1);
  return {
    month,
    startDate: start.key,
    endDate: end.toISOString().slice(0, 10),
    start: start.value,
    endExclusive: nextMonth,
    days: Math.round((nextMonth.getTime() - start.value.getTime()) / DAY_MILLISECONDS),
  };
}

export function planningDateKeys(range: Pick<PlanningDateRange, 'start' | 'days'>): string[] {
  return Array.from({ length: range.days }, (_, index) => {
    const date = new Date(range.start);
    date.setUTCDate(date.getUTCDate() + index);
    return date.toISOString().slice(0, 10);
  });
}
