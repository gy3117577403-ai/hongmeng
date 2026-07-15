const CHINA_TIME_ZONE = 'Asia/Shanghai';

export function chinaDateKey(value?: Date | null): string {
  if (!value || Number.isNaN(value.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: CHINA_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const part = (type: string): string => parts.find(item => item.type === type)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}
