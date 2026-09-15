// Plan time belongs to a production batch. Process standards are only a fallback
// when no explicit batch/order plan exists, and never rewrite reported labor.
export function validPlanMilliseconds(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= 86_400_000 ? value : null;
}

export function resolvePlanMilliseconds(batch?: number | null, order?: number | null, published?: number | null): number | null {
  return validPlanMilliseconds(batch) || validPlanMilliseconds(order) || validPlanMilliseconds(published);
}

export function planTotalMilliseconds(unit: number | null | undefined, quantity: number): bigint | null {
  const value = validPlanMilliseconds(unit);
  return value && Number.isSafeInteger(quantity) && quantity > 0 ? BigInt(value) * BigInt(quantity) : null;
}

export function planMinutesText(value?: number | null): string {
  return value ? `${Number((value / 60_000).toFixed(6))} 分钟` : '待维护';
}

export function planHoursText(value?: number | string | bigint | null): string {
  return value ? `${Number((Number(value) / 3_600_000).toFixed(3))} 小时` : '待维护';
}

export const planTimeSourceText: Record<string, string> = {
  import: '上传计划', manual: '人工调整', order: '订单计划', published: '工序标准参考', legacy: '历史计划', missing: '待维护',
};
