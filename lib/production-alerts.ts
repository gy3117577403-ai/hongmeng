import { getProductionQuantitySummary, type ProductionQuantityInput } from '@/lib/production-quantity';

export type ProductionAlertCode =
  | 'DRAWING_NOT_ISSUED'
  | 'SAMPLE_CONFIRMATION_REQUIRED'
  | 'CUSTOMER_CONFIRMATION_REQUIRED'
  | 'DRAWING_CHANGE_REQUIRED'
  | 'MATERIAL_NOT_READY'
  | 'OVERDUE'
  | 'TAIL_REMAINING'
  | 'REWORK'
  | 'SPECIFICATION_INVALID';

export type ProductionAlert = {
  code: ProductionAlertCode;
  label: string;
  tone: 'red' | 'orange' | 'amber' | 'blue';
};

export type ProductionAlertInput = ProductionQuantityInput & {
  specification?: string | null;
  specificationInvalid?: boolean;
  drawingStatus?: string | null;
  materialStatus?: string | null;
  latestProgressRemark?: string | null;
  plannedAt?: string | Date | null;
};

const drawingConfirmationCodes = new Set<ProductionAlertCode>([
  'SAMPLE_CONFIRMATION_REQUIRED',
  'CUSTOMER_CONFIRMATION_REQUIRED',
  'DRAWING_CHANGE_REQUIRED',
]);

function chinaDayNumber(value: Date): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(value);
  const part = (type: string): number => Number(parts.find(item => item.type === type)?.value || 0);
  return Date.UTC(part('year'), part('month') - 1, part('day')) / 86_400_000;
}

function overdueDays(value: string | Date | null | undefined, now: Date): number {
  if (!value) return 0;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return 0;
  return Math.max(chinaDayNumber(now) - chinaDayNumber(date), 0);
}

function completedStage(stage?: string | null): boolean {
  return stage === 'completed' || stage === '已完成';
}

export function isDrawingConfirmationAlert(code: ProductionAlertCode): boolean {
  return drawingConfirmationCodes.has(code);
}

export function getProductionAlerts(input: ProductionAlertInput, now = new Date()): ProductionAlert[] {
  const alerts: ProductionAlert[] = [];
  const drawing = String(input.drawingStatus || '').trim();
  const remark = String(input.latestProgressRemark || '').trim();
  const drawingContext = `${drawing}\n${remark}`;
  const material = String(input.materialStatus || '').trim();
  const stageCompleted = completedStage(input.stage);
  const quantity = getProductionQuantitySummary(input);

  if (/返工/.test(drawingContext)) alerts.push({ code: 'REWORK', label: '返工待处理', tone: 'red' });
  if (/变更/.test(drawingContext)) alerts.push({ code: 'DRAWING_CHANGE_REQUIRED', label: '图纸需变更', tone: 'red' });
  else if (/样品/.test(drawingContext) && /确认|等待|待/.test(drawingContext)) alerts.push({ code: 'SAMPLE_CONFIRMATION_REQUIRED', label: '待样品确认', tone: 'amber' });
  else if (/客户/.test(drawingContext) && /确认|等待|待/.test(drawingContext)) alerts.push({ code: 'CUSTOMER_CONFIRMATION_REQUIRED', label: '待客户确认', tone: 'amber' });
  else if (!stageCompleted && (!drawing || /未发|待发|未下发/.test(drawing))) alerts.push({ code: 'DRAWING_NOT_ISSUED', label: '图纸待发', tone: 'orange' });

  if (!stageCompleted && /未齐|缺料|待料|未配|待配|配料异常/.test(material)) {
    alerts.push({ code: 'MATERIAL_NOT_READY', label: '配料未齐', tone: 'orange' });
  }

  const days = stageCompleted ? 0 : overdueDays(input.plannedAt, now);
  if (days > 0) alerts.push({ code: 'OVERDUE', label: `逾期${days}天`, tone: 'red' });
  if (quantity.status === 'tail_remaining' && quantity.remainingQty !== null) {
    alerts.push({ code: 'TAIL_REMAINING', label: `剩余${quantity.remainingQty}套`, tone: 'orange' });
  }
  if (input.specificationInvalid || !String(input.specification || '').trim()) {
    alerts.push({ code: 'SPECIFICATION_INVALID', label: '规格异常', tone: 'blue' });
  }
  return alerts;
}
