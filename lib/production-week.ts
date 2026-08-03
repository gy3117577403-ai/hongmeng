import { chinaDateKey } from '@/lib/china-date';

const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function dateFromKey(value: string): Date {
  const match = DATE_KEY_PATTERN.exec(value);
  if (!match) throw new RangeError('生产日期必须为 YYYY-MM-DD');
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (
    date.getUTCFullYear() !== Number(match[1])
    || date.getUTCMonth() !== Number(match[2]) - 1
    || date.getUTCDate() !== Number(match[3])
  ) {
    throw new RangeError('生产日期无效');
  }
  return date;
}

function dateKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function addDays(value: Date, days: number): Date {
  const result = new Date(value);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

export function productionDateKey(value: string | Date): string {
  if (typeof value === 'string') return dateKey(dateFromKey(value.trim()));
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new RangeError('生产日期无效');
  const key = chinaDateKey(value);
  if (!key) throw new RangeError('生产日期无效');
  return key;
}

export function productionWeekKeys(value: string | Date): { startKey: string; endKey: string } {
  const selected = dateFromKey(productionDateKey(value));
  const day = selected.getUTCDay();
  const monday = addDays(selected, day === 0 ? -6 : 1 - day);
  return { startKey: dateKey(monday), endKey: dateKey(addDays(monday, 6)) };
}

export function productionWeekDateBounds(value: string | Date): {
  startKey: string;
  endKey: string;
  startDate: Date;
  endExclusiveDate: Date;
} {
  const { startKey, endKey } = productionWeekKeys(value);
  const startDate = dateFromKey(startKey);
  return {
    startKey,
    endKey,
    startDate,
    endExclusiveDate: addDays(startDate, 7),
  };
}

/**
 * Production plan batches historically store their week marker at Shanghai
 * noon in a timestamp column. Match the complete Shanghai Monday calendar day
 * so both legacy noon values and normalized midnight values resolve to the
 * same business week.
 */
export function productionBatchWeekStartWindow(value: string | Date): {
  startKey: string;
  endKey: string;
  gte: Date;
  lt: Date;
} {
  const { startKey, endKey } = productionWeekKeys(value);
  return {
    startKey,
    endKey,
    gte: new Date(`${startKey}T00:00:00+08:00`),
    lt: new Date(`${dateKey(addDays(dateFromKey(startKey), 1))}T00:00:00+08:00`),
  };
}

export function productionWeekDateValues(value: string | Date): string[] {
  const { startKey } = productionWeekKeys(value);
  const start = dateFromKey(startKey);
  return Array.from({ length: 7 }, (_, index) => dateKey(addDays(start, index)));
}
