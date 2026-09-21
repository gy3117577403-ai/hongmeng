import type { WarehouseExceptionType } from '@/types';

export const MATERIAL_SOURCES = ['PURCHASED', 'CUSTOMER', 'UNKNOWN'] as const;
export type MaterialSource = typeof MATERIAL_SOURCES[number];
export const materialSourceText: Record<MaterialSource, string> = { PURCHASED: '采购物料', CUSTOMER: '客供物料', UNKNOWN: '来源待确认' };
export function materialSource(value: unknown): MaterialSource {
  return MATERIAL_SOURCES.includes(value as MaterialSource) ? value as MaterialSource : 'UNKNOWN';
}
export function materialExceptionLabel(type: WarehouseExceptionType | string, source?: unknown): string {
  const labels: Record<string, string> = { shortage: '缺料', wrong_material: '料错', insufficient_quantity: '数量不足', quality_issue: '来料质量异常', other: '其他异常' };
  const prefix = materialSource(source) === 'UNKNOWN' ? '' : materialSourceText[materialSource(source)];
  return `${prefix}${labels[type] || '物料异常'}`;
}

export class MaterialInputError extends Error {
  constructor(message: string, readonly statusCode = 400) { super(message); }
}
export function materialQuantity(value: unknown, nullable = false): number | null {
  if (nullable && (value === '' || value === null || value === undefined)) return null;
  if (typeof value === 'boolean' || value === null || value === '') throw new MaterialInputError('数量须为非负数字');
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1e9 || Math.abs(number * 1000 - Math.round(number * 1000)) > .0001) throw new MaterialInputError('数量须为非负数字，最多三位小数');
  return number;
}
export function validateMaterialAmounts(required: number | null, received: number): void {
  if (required !== null && received > required) throw new MaterialInputError('累计到料数量不能超过本次缺料数量，请先核对缺料数量');
}
