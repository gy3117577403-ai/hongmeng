import { SamplePlanError } from './sample-plan-domain';

/** Same planning unit as mass production: minutes per set, stored as integer ms. */
export function sampleUnitTime(value: unknown): number | null {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const text = String(value).trim();
  const minutes = Number(text);
  if (!/^\d+(?:\.\d{1,3})?$/.test(text) || !Number.isFinite(minutes) || minutes <= 0 || minutes > 1440) {
    throw new SamplePlanError('单套计划工时须为大于 0、最多 1440 分钟的数字，最多保留三位小数');
  }
  return Math.round(minutes * 60000);
}

export function samplePlanTime(task: { unitPlannedMilliseconds?: number | null; sampleQuantity?: number | null; completedQuantity?: number; completedQuantityKnown?: boolean; status?: string }) {
  const unit = task.unitPlannedMilliseconds ?? null;
  const quantityKnown = task.completedQuantityKnown !== false;
  const remaining = quantityKnown && task.sampleQuantity != null ? Math.max(0, task.sampleQuantity - (task.completedQuantity || 0)) : null;
  const total = (quantity: number | null | undefined) => unit !== null && quantity != null ? (BigInt(unit) * BigInt(quantity)).toString() : null;
  return {
    unitPlannedMinutes: unit === null ? null : unit / 60000,
    totalPlannedMilliseconds: total(task.sampleQuantity),
    remainingQuantity: ['CANCELLED','COMPLETED'].includes(task.status || '') ? 0 : remaining,
    remainingPlannedMilliseconds: ['CANCELLED','COMPLETED'].includes(task.status || '') ? '0' : total(remaining),
  };
}

export function sampleHours(milliseconds: string | number | null | undefined): string {
  if (milliseconds == null) return '待补';
  return (Number(milliseconds) / 3600000).toLocaleString('zh-CN', { maximumFractionDigits: 3 });
}
