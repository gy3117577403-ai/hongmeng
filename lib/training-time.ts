/** Training uses Asia/Shanghai wall time, regardless of browser/server timezone. */
export function trainingDateTimeInput(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const part = (name: string) => parts.find(item => item.type === name)?.value || '';
  return part('year') + '-' + part('month') + '-' + part('day') + 'T' + part('hour') + ':' + part('minute');
}

export function trainingDateKey(value: Date | string): string {
  return trainingDateTimeInput(value).slice(0, 10);
}

export function parseTrainingLocalTime(value: string): Date {
  // datetime-local has no timezone. Never let Node/browser guess its timezone.
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error('请填写有效的北京时间');
  const date = new Date(value + ':00+08:00');
  if (!Number.isFinite(date.getTime()) || trainingDateTimeInput(date) !== value) throw new Error('请填写有效的北京时间');
  return date;
}

export function trainingMonthRange(now = new Date()) {
  const date = trainingDateKey(now);
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { start: date.slice(0, 7) + '-01', end: date.slice(0, 7) + '-' + String(lastDay).padStart(2, '0') };
}

/** Excel serial dates have no timezone. This synthetic UTC Date encodes Shanghai
 * wall-clock fields ONLY for workbook serialization, never for database writes. */
export function trainingExcelDate(value: Date): Date {
  const local = trainingDateTimeInput(value);
  if (!local) throw new Error('培训时间无效，不能导出');
  return new Date(local + ':' + String(value.getUTCSeconds()).padStart(2, '0') + '.000Z');
}
