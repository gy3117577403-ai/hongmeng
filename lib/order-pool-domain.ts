/** Pool quantities are product units. Material metres/pieces never imply product coverage. */
export function poolQuantities(orderQuantity: number, target: number | null, prepared: number, batches: { quantity: number; poolPreparedQuantity: number; deletedAt?: Date | null }[]) {
  const active = batches.filter(b => !b.deletedAt);
  const allocated = active.reduce((n, b) => n + b.quantity, 0);
  const consumed = active.reduce((n, b) => n + b.poolPreparedQuantity, 0);
  const remaining = Math.max(0, orderQuantity - allocated);
  const targetTotal = Math.min(orderQuantity, target ?? orderQuantity);
  return { allocated, consumed, remaining, targetTotal, targetRemaining: Math.max(0, targetTotal - allocated), readyRemaining: Math.min(remaining, Math.max(0, prepared - consumed)) };
}
export const poolPriority = { insert: { label: '特急', weight: 0 }, urgent: { label: '优先', weight: 1 }, normal: { label: '常规', weight: 2 } } as const;
export function poolPriorityWeight(v: string) { return poolPriority[v as keyof typeof poolPriority]?.weight ?? 2; }
export function poolSort<T extends { priority: string; preparationRank: number; id: string }>(rows: T[]) {
  return [...rows].sort((a, b) => poolPriorityWeight(a.priority) - poolPriorityWeight(b.priority) || a.preparationRank - b.preparationRank || a.id.localeCompare(b.id));
}
export class PoolError extends Error { constructor(message: string, public status = 400) { super(message); } }
export function poolInteger(value: unknown, label: string, min = 0) {
  const n = Number(value);
  if (value === '' || value == null || !Number.isSafeInteger(n) || n < min || n > 2_000_000_000) throw new PoolError(`${label}必须是${min ? '正' : '非负'}整数`);
  return n;
}
