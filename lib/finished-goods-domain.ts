import { chinaDateKey } from '@/lib/china-date';

export class FinishedGoodsError extends Error {
  constructor(message: string, readonly code = 'FG_INVALID', readonly status = 400) { super(message); }
}
export type FgInput = Record<string, unknown>;
export type FgActor = { id: string; displayName?: string | null; username: string };
export type Stock = { pending: number; available: number; reserved: number; held: number; blocked: number };
export const fgStock = (lot: Stock): Stock => ({ pending: lot.pending, available: lot.available, reserved: lot.reserved, held: lot.held, blocked: lot.blocked });
export const physicalStock = (lot: Stock): number => lot.available + lot.reserved + lot.held + lot.blocked;
export function fgText(value: unknown, max = 500): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text.length > max) throw new FinishedGoodsError(`内容不能超过 ${max} 字`);
  return text;
}
export function fgRequired(value: unknown, label: string, max = 500): string {
  const text = fgText(value, max);
  if (!text) throw new FinishedGoodsError(`请填写${label}`);
  return text;
}
export function fgQty(value: unknown, allowZero = false): number {
  if (value === '' || value === null || typeof value === 'boolean') throw new FinishedGoodsError('数量须为整数');
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < (allowZero ? 0 : 1) || number > 1_000_000_000) throw new FinishedGoodsError(allowZero ? '数量须为非负整数' : '数量须为正整数');
  return number;
}
export function fgDate(value?: unknown): string {
  const date = fgText(value, 10) || chinaDateKey(new Date());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(new Date(`${date}T00:00:00Z`).getTime()) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) throw new FinishedGoodsError('日期无效');
  return date;
}
export function fgWaybills(value: unknown): string[] {
  const values = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[\n,，;；]+/) : [];
  if (values.length > 100) throw new FinishedGoodsError('一张发货单最多登记 100 个运单');
  return [...new Set(values.map(v => fgText(v, 100)).filter(Boolean))];
}
export function fgRecord(value: unknown): FgInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new FinishedGoodsError('请求格式错误');
  return value as FgInput;
}
export function fgAssertStock(stock: Stock): void {
  if (Object.values(stock).some(q => !Number.isSafeInteger(q) || q < 0)) throw new FinishedGoodsError('库存不足或已被其他操作占用，请刷新后重试', 'FG_STOCK_CONFLICT', 409);
}
export const FG_KINDS: Record<string, string> = {
  PRODUCTION_PENDING: '生产待接收', SOURCE_CORRECTION: '来源撤回', RECEIVE: '实物接收', UNRECEIVE: '撤销接收',
  HOLD: '留库', RELEASE_HOLD: '释放留库', RESERVE: '发货占用', RELEASE_RESERVATION: '释放占用', SHIP: '实际发货',
  RETURN: '退货接收', UNBLOCK: '解除隔离', BLOCK: '库存隔离', REWORK_OUT: '返工转出', REWORK_RETURN: '返工回库',
  REWORK_SCRAP: '返工报废', SCRAP: '库存报废', ADJUST: '盘点调整', OPENING: '期初接收', MOVE: '移库', ALLOCATE: '备货分配',
};

export type FgRow = Stock & {
  id: string; lotId: string; shipmentId?: string; lineId?: string; shipmentNumber?: string; shipmentVersion?: number;
  workOrderId: string | null; workOrderCode: string; productName: string; specification: string; productKey: string; unit: string;
  customerName: string; ownerType: string; sourceKind: string; sourceQuantity: number; location: string; note: string;
  openingReview: boolean; version: number; createdAt: string; receivedAt: string | null; status: string; blockedReason: string;
  quantity: number; returned: number; carrier: string; waybills: string[]; method: string; recipient: string; phone: string;
  address: string; boxes: number; handoverName: string; batchId: string; batchNumber: string; shippedAt: string | null;
  holdDueDate: string | null; holdReason: string; otherDrafts: number; shipmentLineCount: number; shipmentNote: string;
};
export type FgBatchDTO = { id: string; number: string; businessDate: string; sequence: number; name: string; carrier: string; note: string; closedAt: string | null; shipped: number; draft: number; quantity: number };
export type FgWorkbench = {
  rows: FgRow[]; total: number; page: number; pageSize: number; date: string;
  counts: Record<string, number>; stats: { pending: number; physical: number; available: number; reserved: number; held: number; blocked: number; shipped: number; shipmentCount: number; batchCount: number; missingWaybill: number; holdDue: number };
  batches: FgBatchDTO[];
};
