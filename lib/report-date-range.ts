import type { ReportCenterPeriodDTO } from '@/types';
import { employeeReportRange } from '@/lib/process-time';

const DAY_MILLISECONDS = 86_400_000;

export class ReportDateRangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReportDateRangeError';
  }
}

export function parseReportPeriod(value: unknown, fallback: ReportCenterPeriodDTO = 'week'): ReportCenterPeriodDTO {
  return value === 'today' || value === 'week' || value === 'month' || value === 'custom'
    ? value
    : fallback;
}

export function reportDateRange(input: {
  period?: unknown;
  date?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  fallbackPeriod?: ReportCenterPeriodDTO;
}) {
  const period = parseReportPeriod(input.period, input.fallbackPeriod);
  try {
    const range = employeeReportRange(period, input.date, input.startDate, input.endDate);
    return { period, ...range };
  } catch (error) {
    throw new ReportDateRangeError(error instanceof Error ? error.message : '统计周期不正确');
  }
}

export function reportRangeDateKeys(start: Date, end: Date): string[] {
  const keys: string[] = [];
  for (let cursor = start; cursor < end; cursor = new Date(cursor.getTime() + DAY_MILLISECONDS)) {
    keys.push(new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(cursor));
  }
  return keys;
}

export function reportRangeQuery(searchParams: URLSearchParams) {
  return reportDateRange({
    period: searchParams.get('period'),
    date: searchParams.get('date'),
    startDate: searchParams.get('startDate'),
    endDate: searchParams.get('endDate'),
  });
}
