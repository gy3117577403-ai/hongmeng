export type DailyShipmentPlanStatus = 'DRAFT' | 'CONFIRMED' | 'CLOSED' | 'CANCELLED';
export type DailyShipmentItemStatus = 'PLANNED' | 'PARTIALLY_SHIPPED' | 'SHIPPED' | 'CANCELLED';
export type ShipmentProgressState = 'SHIPPED' | 'PARTIAL' | 'OVERDUE' | 'READY' | 'IN_PRODUCTION' | 'NOT_STARTED';

export type DailyShipmentEventDTO = {
  id: string;
  eventType: 'SHIPMENT' | 'REVERSAL';
  quantity: number;
  shippedAt: string;
  reversalOfEventId: string | null;
  reason: string | null;
  createdAt: string;
  actor: { id: string; name: string };
};

export type DailyShipmentItemDTO = {
  id: string;
  version: number;
  status: DailyShipmentItemStatus;
  batchId: string;
  batchNo: number;
  batchQuantity: number;
  workOrderId: string;
  workOrderCode: string;
  sourceOrderNo: string;
  customerName: string;
  salesperson: string | null;
  productName: string;
  specification: string;
  priority: string;
  customerDueDate: string;
  plannedCompletionDate: string;
  plannedQuantity: number;
  shippedQuantity: number;
  pendingQuantity: number;
  completedQuantity: number;
  productionProgress: number;
  productionStage: string;
  currentProcess: string;
  lastProgressAt: string | null;
  plannedShipAt: string;
  actualShipAt: string | null;
  progressState: ShipmentProgressState;
  note: string | null;
  sortOrder: number;
  events: DailyShipmentEventDTO[];
};

export type DailyShipmentCandidateDTO = {
  batchId: string;
  batchNo: number;
  batchQuantity: number;
  releaseState: string;
  workOrderId: string;
  workOrderCode: string;
  sourceOrderNo: string;
  customerName: string;
  salesperson: string | null;
  productName: string;
  specification: string;
  priority: string;
  customerDueDate: string;
  plannedCompletionDate: string;
  scheduledQuantity: number;
  availableQuantity: number;
  completedQuantity: number;
  shippedQuantity: number;
  productionProgress: number;
  productionStage: string;
  currentProcess: string;
  lastProgressAt: string | null;
  scheduledDates: string[];
};

export type DailyShipmentWorkbenchDTO = {
  selectedDate: string;
  generatedAt: string;
  week: {
    startDate: string;
    endDate: string;
    days: Array<{
      date: string;
      status: DailyShipmentPlanStatus | null;
      itemCount: number;
      plannedQuantity: number;
      shippedQuantity: number;
    }>;
  };
  plan: {
    id: string;
    status: DailyShipmentPlanStatus;
    version: number;
    confirmedAt: string | null;
    confirmedBy: { id: string; name: string } | null;
    closedAt: string | null;
    closedBy: { id: string; name: string } | null;
    items: DailyShipmentItemDTO[];
  } | null;
  summary: {
    itemCount: number;
    plannedQuantity: number;
    readyQuantity: number;
    shippedQuantity: number;
    pendingQuantity: number;
    riskItemCount: number;
  };
  candidates: DailyShipmentCandidateDTO[];
};

type ApiEnvelope<T> = { ok: boolean; data?: T; error?: string; message?: string; code?: string };

async function parseResponse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({})) as ApiEnvelope<T>;
  if (!response.ok || !payload.ok || payload.data === undefined) {
    throw new Error(payload.message || payload.error || '日出货计划请求失败');
  }
  return payload.data;
}

export async function fetchDailyShipmentWorkbench(date: string, signal?: AbortSignal): Promise<DailyShipmentWorkbenchDTO> {
  const query = new URLSearchParams({ date });
  const response = await fetch(`/api/daily-shipments?${query.toString()}`, {
    cache: 'no-store',
    signal,
  });
  return parseResponse<DailyShipmentWorkbenchDTO>(response);
}

export async function mutateDailyShipment(
  body: Record<string, unknown>,
  idempotencyKey = crypto.randomUUID(),
): Promise<{ planId: string; replayed: boolean }> {
  const response = await fetch('/api/daily-shipments', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify(body),
  });
  return parseResponse<{ planId: string; replayed: boolean }>(response);
}
