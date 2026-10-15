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
export function materialEventPhase(e: { status: string; required: number | null; usable: number; pending: number; transit: number; remaining: number | null; rejected?: number; arrivalOutcome?: string }): keyof typeof materialPhaseLabels {
  if (e.status === 'RESOLVED' || e.status === 'CANCELLED') return e.status;
  if (e.pending > 0) return e.remaining === 0 ? 'WAITING_VERIFY' : 'PARTIAL';
  if (e.usable > 0) {
    if (materialNeedsCompletion(e)) return 'NEEDS_COMPLETION';
    return 'PARTIAL';
  }
  return e.transit > 0 ? 'IN_TRANSIT' : 'MISSING';
}
export const materialPhaseLabels = { RESOLVED: '本项已解决', CANCELLED: '已取消', WAITING_VERIFY: '已到待核验', PARTIAL: '部分到料', NEEDS_COMPLETION: '已到料，待确认是否补齐', IN_TRANSIT: '运输中', MISSING: '缺料待到' } as const;
export function materialNeedsCompletion(e: { required: number | null; usable: number; pending: number; transit: number; rejected?: number; arrivalOutcome?: string }) {
  return e.required === null && e.usable > 0 && !e.pending && !e.transit && !e.rejected && e.arrivalOutcome !== 'PARTIAL';
}
export function materialForecast(events: { open: boolean; remaining: number | null; expectedAt: string | null }[]) {
  const awaiting = events.filter(e => e.open && (e.remaining === null || e.remaining > 0));
  const dates = awaiting.flatMap(e => e.expectedAt ? [e.expectedAt] : []).sort();
  return { next: dates[0] || null, latest: dates[dates.length - 1] || null, unknown: awaiting.filter(e => !e.expectedAt).length };
}
export const materialOrderStates = { READY: '已配齐', SHORTAGE: '缺料中', PARTIAL: '部分配套', CONFIRM: '待齐料确认', UNCHECKED: '待核对', WAITING: '已到待核验', COMPLETION: '待确认是否补齐' } as const;
