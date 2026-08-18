import { basisPoints } from '@/lib/attendance';

export type ReportMetricTone = 'excellent' | 'good' | 'watch' | 'risk' | 'over' | 'empty';

export type ReportWeekBucket = {
  key: string;
  label: string;
  startDate: string;
  endDate: string;
};

const DAY_MILLISECONDS = 86_400_000;

export function parseReportMonth(value: unknown, fallbackDate: string): string {
  const fallback = /^\d{4}-\d{2}/.exec(fallbackDate)?.[0] || '1970-01';
  const candidate = String(value || '').trim();
  if (!/^\d{4}-\d{2}$/.test(candidate)) return fallback;
  const [year, month] = candidate.split('-').map(Number);
  if (year < 2000 || year > 2200 || month < 1 || month > 12) return fallback;
  return candidate;
}

export function nextReportMonth(month: string): string {
  const [year, monthNumber] = month.split('-').map(Number);
  const nextYear = monthNumber === 12 ? year + 1 : year;
  const nextMonth = monthNumber === 12 ? 1 : monthNumber + 1;
  return `${nextYear}-${String(nextMonth).padStart(2, '0')}`;
}

export function reportMonthDateKeys(month: string): string[] {
  const [year, monthNumber] = month.split('-').map(Number);
  const next = nextReportMonth(month);
  const start = new Date(`${year}-${String(monthNumber).padStart(2, '0')}-01T00:00:00.000Z`);
  const end = new Date(`${next}-01T00:00:00.000Z`);
  const keys: string[] = [];
  for (let cursor = start; cursor < end; cursor = new Date(cursor.getTime() + DAY_MILLISECONDS)) {
    keys.push(cursor.toISOString().slice(0, 10));
  }
  return keys;
}

function mondayFor(dateKey: string): string {
  const date = new Date(`${dateKey}T12:00:00.000Z`);
  const day = date.getUTCDay();
  const offset = day === 0 ? -6 : 1 - day;
  return new Date(date.getTime() + offset * DAY_MILLISECONDS).toISOString().slice(0, 10);
}

export function reportMonthWeekBuckets(month: string): ReportWeekBucket[] {
  const dateKeys = reportMonthDateKeys(month);
  const buckets = new Map<string, { startDate: string; endDate: string }>();
  for (const dateKey of dateKeys) {
    const monday = mondayFor(dateKey);
    const existing = buckets.get(monday);
    if (existing) existing.endDate = dateKey;
    else buckets.set(monday, { startDate: dateKey, endDate: dateKey });
  }
  return [...buckets.entries()].map(([key, range], index) => ({
    key,
    label: `第 ${index + 1} 周`,
    startDate: range.startDate,
    endDate: range.endDate,
  }));
}

export function reportWeekKey(dateKey: string): string {
  return mondayFor(dateKey);
}

export function reportMetricTone(value: number | null | undefined): ReportMetricTone {
  if (value === null || value === undefined) return 'empty';
  if (value > 11_000) return 'over';
  if (value >= 10_000) return 'excellent';
  if (value >= 9_500) return 'good';
  if (value >= 8_500) return 'watch';
  return 'risk';
}

export function cappedBasisPoints(numerator: number, denominator: number): number | null {
  const ratio = basisPoints(Math.max(0, numerator), Math.max(0, denominator));
  return ratio === null ? null : Math.min(10_000, ratio);
}
