import { parseShipmentDate, shiftShipmentDateKey } from '@/lib/daily-shipment-domain';

/**
 * The daily-shipment module starts from this business date. Orders whose
 * confirmed customer due date is earlier than this date are deliberately
 * excluded from the workbench, warning KPIs and automated repair.
 */
export const DAILY_SHIPMENT_CUTOVER_DATE = '2026-09-01';
export const DAILY_SHIPMENT_WARNING_DAYS = 3;

export function dailyShipmentCutoverApplies(date: string): boolean {
  return date >= DAILY_SHIPMENT_CUTOVER_DATE;
}

export function dailyShipmentDisplayWindow(selectedDate: string): {
  startKey: string;
  endKey: string;
  startDate: Date;
  endExclusiveDate: Date;
  cutoverApplied: boolean;
} {
  const selected = parseShipmentDate(selectedDate);
  const cutoverApplied = dailyShipmentCutoverApplies(selected.key);
  const startKey = cutoverApplied ? DAILY_SHIPMENT_CUTOVER_DATE : selected.key;
  return {
    startKey,
    endKey: selected.key,
    startDate: parseShipmentDate(startKey).value,
    endExclusiveDate: parseShipmentDate(shiftShipmentDateKey(selected.key, 1)).value,
    cutoverApplied,
  };
}

export function dailyShipmentWarningWindow(anchorDate: string): {
  startKey: string;
  endKey: string;
  startDate: Date;
  endExclusiveDate: Date;
  cutoverApplied: boolean;
} {
  const anchor = parseShipmentDate(anchorDate);
  const endKey = shiftShipmentDateKey(anchor.key, DAILY_SHIPMENT_WARNING_DAYS);
  const cutoverApplied = dailyShipmentCutoverApplies(anchor.key);
  const startKey = cutoverApplied ? DAILY_SHIPMENT_CUTOVER_DATE : anchor.key;
  return {
    startKey,
    endKey,
    startDate: parseShipmentDate(startKey).value,
    endExclusiveDate: parseShipmentDate(shiftShipmentDateKey(endKey, 1)).value,
    cutoverApplied,
  };
}

export function compactShipmentOrderCode(value: string, head = 10, tail = 11): string {
  const normalized = value.trim();
  if (normalized.length <= head + tail + 1) return normalized;
  return `${normalized.slice(0, head)}…${normalized.slice(-tail)}`;
}

export function safeShipmentProcessName(value: string | null | undefined): string {
  const normalized = String(value || '').trim();
  if (!normalized) return '待生产反馈';
  if (/^(front|back)end$/i.test(normalized) || /^(component|service|unknown|null|undefined)$/i.test(normalized)) {
    return '待生产反馈';
  }
  return normalized;
}
