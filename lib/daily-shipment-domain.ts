import { chinaDateKey } from '@/lib/china-date';
import { productionDateKey, productionWeekDateBounds, productionWeekDateValues } from '@/lib/production-week';

export type ShipmentProgressState =
  | 'SHIPPED'
  | 'PARTIAL'
  | 'OVERDUE'
  | 'READY'
  | 'IN_PRODUCTION'
  | 'NOT_STARTED'
  | 'CARRIED_OVER';

export type ShipmentPriority = 'URGENT' | 'PRIORITY' | 'NORMAL';

const SHIPMENT_PRIORITIES = new Set<ShipmentPriority>(['URGENT', 'PRIORITY', 'NORMAL']);

export class DailyShipmentDomainError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'DailyShipmentDomainError';
  }
}

export function parseShipmentDate(value: unknown): { key: string; value: Date } {
  try {
    const key = productionDateKey(String(value ?? '').trim());
    return { key, value: new Date(`${key}T00:00:00.000Z`) };
  } catch {
    throw new DailyShipmentDomainError('请选择有效的出货日期', 'SHIPMENT_DATE_INVALID');
  }
}

export function shipmentWeek(value: string | Date): {
  startKey: string;
  endKey: string;
  startDate: Date;
  endExclusiveDate: Date;
  dates: string[];
} {
  const bounds = productionWeekDateBounds(value);
  return { ...bounds, dates: productionWeekDateValues(value) };
}

export function parsePlannedShipmentTime(value: unknown, shipDate: string): Date {
  const raw = String(value ?? '').trim();
  if (!raw) throw new DailyShipmentDomainError('请选择计划出货时间', 'PLANNED_SHIP_TIME_REQUIRED');
  const normalized = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(raw)
    ? `${raw}+08:00`
    : raw;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    throw new DailyShipmentDomainError('计划出货时间无效', 'PLANNED_SHIP_TIME_INVALID');
  }
  if (chinaDateKey(parsed) !== shipDate) {
    throw new DailyShipmentDomainError(
      `计划出货时间必须在 ${shipDate} 当天`,
      'PLANNED_SHIP_TIME_OUTSIDE_DAY',
    );
  }
  return parsed;
}

export function parseShipmentEventTime(value: unknown): Date {
  const raw = String(value ?? '').trim();
  const parsed = raw ? new Date(raw) : new Date();
  if (Number.isNaN(parsed.getTime())) {
    throw new DailyShipmentDomainError('实际出货时间无效', 'SHIPMENT_EVENT_TIME_INVALID');
  }
  if (parsed.getTime() > Date.now() + 5 * 60 * 1000) {
    throw new DailyShipmentDomainError('实际出货时间不能晚于当前时间', 'SHIPMENT_EVENT_TIME_IN_FUTURE');
  }
  return parsed;
}

export function positiveShipmentQuantity(value: unknown, label = '数量'): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new DailyShipmentDomainError(`${label}必须为正整数`, 'SHIPMENT_QUANTITY_INVALID');
  }
  return parsed;
}

export function shipmentVersion(value: unknown, label = '数据版本'): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new DailyShipmentDomainError(`${label}无效，请刷新后重试`, 'SHIPMENT_VERSION_INVALID');
  }
  return parsed;
}

export function shipmentNote(value: unknown, maxLength = 500): string | null {
  const normalized = String(value ?? '').trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

export function shipmentPriority(value: unknown): ShipmentPriority {
  const normalized = String(value ?? '').trim().toUpperCase() as ShipmentPriority;
  if (!SHIPMENT_PRIORITIES.has(normalized)) {
    throw new DailyShipmentDomainError('请选择有效的出货优先级', 'SHIPMENT_PRIORITY_INVALID');
  }
  return normalized;
}

export function shipmentPriorityRank(value: ShipmentPriority): number {
  if (value === 'URGENT') return 0;
  if (value === 'PRIORITY') return 1;
  return 2;
}

export function shiftShipmentDateKey(value: unknown, days: number): string {
  const parsed = parseShipmentDate(value);
  const shifted = new Date(parsed.value);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

export function carryoverPlannedShipAt(source: Date, targetDate: string): Date {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(source);
  const part = (type: string) => parts.find(item => item.type === type)?.value || '00';
  return new Date(`${parseShipmentDate(targetDate).key}T${part('hour')}:${part('minute')}:${part('second')}+08:00`);
}

export function assertScheduledQuantity(input: {
  batchQuantity: number;
  alreadyScheduledQuantity: number;
  requestedQuantity: number;
}): void {
  const total = input.alreadyScheduledQuantity + input.requestedQuantity;
  if (total > input.batchQuantity) {
    throw new DailyShipmentDomainError(
      `该批次计划数量将达到 ${total}，超过批次数量 ${input.batchQuantity}`,
      'SHIPMENT_BATCH_PLAN_EXCEEDED',
    );
  }
}

export function assertRecordableShipment(input: {
  plannedQuantity: number;
  itemShippedQuantity: number;
  batchCompletedQuantity: number;
  batchShippedQuantity: number;
  requestedQuantity: number;
}): void {
  if (input.itemShippedQuantity + input.requestedQuantity > input.plannedQuantity) {
    throw new DailyShipmentDomainError(
      `本次实发后将超过该日计划数量 ${input.plannedQuantity}`,
      'SHIPMENT_ITEM_QUANTITY_EXCEEDED',
    );
  }
  if (input.batchShippedQuantity + input.requestedQuantity > input.batchCompletedQuantity) {
    throw new DailyShipmentDomainError(
      `本次实发后将超过已完工良品数量 ${input.batchCompletedQuantity}`,
      'SHIPMENT_COMPLETED_QUANTITY_EXCEEDED',
    );
  }
}

export function netShipmentQuantity(
  events: Array<{ eventType: string; quantity: number }>,
): number {
  return Math.max(0, events.reduce((total, event) => (
    event.eventType === 'REVERSAL' ? total - event.quantity : total + event.quantity
  ), 0));
}

export function shipmentItemStatus(
  plannedQuantity: number,
  shippedQuantity: number,
): 'PLANNED' | 'PARTIALLY_SHIPPED' | 'SHIPPED' {
  if (shippedQuantity >= plannedQuantity) return 'SHIPPED';
  if (shippedQuantity > 0) return 'PARTIALLY_SHIPPED';
  return 'PLANNED';
}

export function shipmentProgressState(input: {
  plannedQuantity: number;
  shippedQuantity: number;
  completedQuantity: number;
  plannedShipAt: Date;
  itemStatus?: string;
  now?: Date;
}): ShipmentProgressState {
  if (input.itemStatus === 'CARRIED_OVER') return 'CARRIED_OVER';
  if (input.shippedQuantity >= input.plannedQuantity) return 'SHIPPED';
  if (input.shippedQuantity > 0) return 'PARTIAL';
  if (input.plannedShipAt.getTime() < (input.now ?? new Date()).getTime()) return 'OVERDUE';
  if (input.completedQuantity >= input.plannedQuantity) return 'READY';
  if (input.completedQuantity > 0) return 'IN_PRODUCTION';
  return 'NOT_STARTED';
}

export function shipmentReservationQuantity(input: {
  status: string;
  plannedQuantity: number;
  events: Array<{ eventType: string; quantity: number }>;
}): number {
  if (input.status === 'CANCELLED') return 0;
  if (input.status === 'CARRIED_OVER') return netShipmentQuantity(input.events);
  return Math.max(0, input.plannedQuantity);
}

export function completionPercentage(completedQuantity: number, batchQuantity: number): number {
  if (batchQuantity <= 0) return 0;
  return Math.max(0, Math.round((completedQuantity / batchQuantity) * 1000) / 10);
}
