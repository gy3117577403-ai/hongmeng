/** Dates are rendered as calendar dates in Shanghai; source values are never changed. */
export function sampleDisplayDate(value?: string | Date | null, fallback = '未设置') {
  if (!value) return fallback;
  const raw = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return fallback;
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}
export function isSampleCustomerDate(value: unknown) {
  return value instanceof Date || /^(?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d|\d{4}[-/]\d{1,2}[-/]\d{1,2}(?:$|[T\s]))/.test(String(value || '').trim());
}
export function sampleCustomerLabel(value?: string | null) {
  return isSampleCustomerDate(value) ? `客户待核对（原值 ${sampleDisplayDate(value, '日期无效')}）` : value || '客户未设置';
}
