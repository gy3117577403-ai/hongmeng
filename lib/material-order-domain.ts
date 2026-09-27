export type ArrivalAmounts = { status: string; quantity: number; acceptedQuantity: number; rejectedQuantity: number };
const round = (n: number) => Math.round(n * 1000000) / 1000000;
export function materialAmounts(required: number | null, batches: ArrivalAmounts[]) {
  const usable = round(batches.reduce((n, b) => n + (b.status === 'VERIFIED' ? b.acceptedQuantity : 0), 0));
  const pending = round(batches.reduce((n, b) => n + (b.status === 'ARRIVED' ? b.quantity : 0), 0));
  const transit = round(batches.reduce((n, b) => n + (b.status === 'SHIPPED' ? b.quantity : 0), 0));
  const rejected = round(batches.reduce((n, b) => n + (b.status === 'VERIFIED' ? b.rejectedQuantity : 0), 0));
  return { usable, pending, transit, rejected, missing: required === null ? null : Math.max(0, round(required - usable)), remaining: required === null ? null : Math.max(0, round(required - usable - pending)), unallocated: required === null ? null : Math.max(0, round(required - usable - pending - transit)) };
}
export function materialOrderState(status: string, openCount: number, historyCount: number) {
  if (status === 'completed' && !openCount) return 'READY' as const;
  if (openCount) return 'SHORTAGE' as const;
  return historyCount ? 'CONFIRM' as const : 'UNCHECKED' as const;
}
export function materialForecast(events: { open: boolean; remaining: number | null; expectedAt: string | null }[]) {
  const awaiting = events.filter(e => e.open && (e.remaining === null || e.remaining > 0));
  const dates = awaiting.flatMap(e => e.expectedAt ? [e.expectedAt] : []).sort();
  return { next: dates[0] || null, latest: dates[dates.length - 1] || null, unknown: awaiting.filter(e => !e.expectedAt).length };
}
export const materialOrderStates = { READY: '已配齐', SHORTAGE: '缺料中', CONFIRM: '待齐料确认', UNCHECKED: '待核对' } as const;
