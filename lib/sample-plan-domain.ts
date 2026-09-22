import { chinaDateKey } from '@/lib/china-date';

export type SampleTaskType = 'NEW' | 'REPEAT';
export const sampleTaskTypeText = { NEW: '新品试制', REPEAT: '老产品制作' } as const;
export class SamplePlanError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}
export function sampleTaskType(value: unknown): SampleTaskType {
  if (value === undefined || value === null || value === '') return 'NEW';
  if (value !== 'NEW' && value !== 'REPEAT') throw new SamplePlanError('请选择新品或老产品');
  return value;
}
export function sampleDay(value: unknown): string {
  const text = String(value ?? '');
  const date = new Date(text + 'T00:00:00Z');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== text)
    throw new SamplePlanError('日期格式无效');
  return text;
}
export function sampleWeek(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  const day = new Date(sampleDay(value) + 'T00:00:00Z');
  day.setUTCDate(day.getUTCDate() - (day.getUTCDay() + 6) % 7);
  return day.toISOString().slice(0, 10);
}
export function sampleShiftDay(value: string, days: number): string {
  const date = new Date(sampleDay(value) + 'T00:00:00Z'); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10);
}
export const sampleCurrentWeek = () => sampleWeek(chinaDateKey(new Date()))!;
export function sampleCompletionQuantity(value: unknown, planned: number | null, completed: number): number {
  const quantity = Number(value);
  if (!planned || planned < 1) throw new SamplePlanError('请先补充计划数量，再登记样品完成');
  if (!Number.isSafeInteger(quantity) || quantity <= 0 || quantity > planned - completed)
    throw new SamplePlanError(`本次完成数量须为 1 至 ${Math.max(0, planned - completed)} 的整数`);
  return quantity;
}
export type SampleMaterialLine = { id: string; model: string; unit: string; quantity: number; prepared: number; supplySource: 'PURCHASED' | 'CUSTOMER' | 'UNKNOWN' };
export function sampleMaterialLines(value: unknown): SampleMaterialLine[] {
  if (!Array.isArray(value) || value.length > 200) throw new SamplePlanError('物料清单最多 200 行');
  const ids = new Set<string>();
  return value.map(raw => {
    if (!raw || typeof raw !== 'object') throw new SamplePlanError('物料格式无效');
    const row = raw as Record<string, unknown>;
    const id = String(row.id || '').trim().slice(0, 80), model = String(row.model || '').trim().slice(0, 160);
    const quantity = Number(row.quantity), prepared = Number(row.prepared || 0);
    if (!id || ids.has(id) || !model) throw new SamplePlanError('请填写物料型号，物料行不能重复');
    ids.add(id);
    if (![quantity, prepared].every(n => Number.isFinite(n) && n >= 0 && n <= 1e9 && Math.abs(n * 1000 - Math.round(n * 1000)) < .0001) || quantity <= 0 || prepared > quantity)
      throw new SamplePlanError('需求数量须大于零，已配数量不能超过需求');
    const source = String(row.supplySource || 'UNKNOWN');
    if (!['PURCHASED','CUSTOMER','UNKNOWN'].includes(source)) throw new SamplePlanError('物料来源无效');
    return { id, model, unit: String(row.unit || '个').trim().slice(0, 12), quantity, prepared, supplySource: source as SampleMaterialLine['supplySource'] };
  });
}
