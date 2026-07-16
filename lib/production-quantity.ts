export type ProductionQuantityStatus = 'unknown' | 'in_progress' | 'complete' | 'tail_remaining' | 'overrun';

export type ProductionQuantityInput = {
  uncompletedQty?: unknown;
  productionTargetQty?: unknown;
  completedQty?: unknown;
  stage?: string | null;
};

export type ProductionQuantitySummary = {
  targetQty: number | null;
  completedQty: number | null;
  remainingQty: number | null;
  overrunQty: number | null;
  percentage: number | null;
  status: ProductionQuantityStatus;
};

function quantityNumber(value: unknown, emptyValue: number | null): number | null {
  if (value === null || value === undefined || String(value).trim() === '') return emptyValue;
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : null;

  const text = String(value).trim().replace(/,/g, '');
  const matches = text.match(/[+-]?\d+(?:\.\d+)?/g) || [];
  if (matches.length !== 1) return null;
  const parsed = Number(matches[0]);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function effectiveProductionTarget(input: Pick<ProductionQuantityInput, 'uncompletedQty' | 'productionTargetQty'>): unknown {
  return input.productionTargetQty === null || input.productionTargetQty === undefined
    ? input.uncompletedQty
    : input.productionTargetQty;
}

export function parsedImportedProductionTarget(value: unknown): number | null {
  return quantityNumber(value, null);
}

function completedStage(stage?: string | null): boolean {
  const value = String(stage || '').trim().toLocaleLowerCase('zh-CN');
  return value === 'completed' || value === '已完成';
}

export function getProductionQuantitySummary(input: ProductionQuantityInput): ProductionQuantitySummary {
  const targetQty = quantityNumber(effectiveProductionTarget(input), null);
  const completedQty = quantityNumber(input.completedQty, 0);
  if (targetQty === null || completedQty === null) {
    return { targetQty, completedQty, remainingQty: null, overrunQty: null, percentage: null, status: 'unknown' };
  }

  const remainingQty = Math.max(targetQty - completedQty, 0);
  const overrunQty = Math.max(completedQty - targetQty, 0);
  const percentage = targetQty > 0 ? Math.round((completedQty / targetQty) * 1000) / 10 : null;
  let status: ProductionQuantityStatus;
  if (overrunQty > 0) status = 'overrun';
  else if (remainingQty > 0 && completedStage(input.stage)) status = 'tail_remaining';
  else if (remainingQty > 0) status = 'in_progress';
  else status = 'complete';

  return { targetQty, completedQty, remainingQty, overrunQty, percentage, status };
}

export function formatProductionQuantity(value: number | null): string {
  if (value === null) return '-';
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 3 }).format(value);
}

export function formatProductionPercentage(value: number | null): string {
  if (value === null) return '-';
  return Number.isInteger(value) ? `${value}%` : `${value.toFixed(1)}%`;
}
