import { getProductionQuantitySummary, type ProductionQuantityInput } from '@/lib/production-quantity';
import { hasEffectiveIssuedDrawing } from '@/lib/production-drawing-readiness';
import { productionCustomerDate, productionEstimatedDate } from '@/lib/production-control';

export type ProductionAlertCode =
  | 'DRAWING_NOT_ISSUED'
  | 'SAMPLE_CONFIRMATION_REQUIRED'
  | 'CUSTOMER_CONFIRMATION_REQUIRED'
  | 'DRAWING_CHANGE_REQUIRED'
  | 'MATERIAL_NOT_READY'
  | 'OVERDUE'
  | 'INTERNAL_PLAN_DELAY'
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
  hasOriginalDrawing?: boolean;
  materialStatus?: string | null;
  warehouseMaterialStatus?: string | null;
  warehouseExceptionType?: string | null;
  warehouseExceptionNote?: string | null;
  warehouseExpectedAt?: string | Date | null;
  latestProgressRemark?: string | null;
  plannedAt?: string | Date | null;
  deliveryDay?: string | null;
  estimatedCompletionAt?: string | Date | null;
};

const drawingConfirmationCodes = new Set<ProductionAlertCode>([
  'SAMPLE_CONFIRMATION_REQUIRED',
  'CUSTOMER_CONFIRMATION_REQUIRED',
  'DRAWING_CHANGE_REQUIRED',
]);

const warehouseExceptionLabels: Record<string, string> = {
  shortage: '缺料',
  wrong_material: '料错',
  insufficient_quantity: '数量不足',
  quality_issue: '来料质量异常',
  other: '仓库异常',
};

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

function warehouseAlertLabel(input: ProductionAlertInput, now: Date): string {
  const type = warehouseExceptionLabels[String(input.warehouseExceptionType || '')] || '仓库异常';
  if (!input.warehouseExpectedAt) return type;
  const expected = input.warehouseExpectedAt instanceof Date
    ? input.warehouseExpectedAt
    : new Date(input.warehouseExpectedAt);
  if (Number.isNaN(expected.getTime())) return type;
  const days = overdueDays(expected, now);
  if (days > 0) return `${type} · 到料逾期${days}天`;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric',
  }).formatToParts(expected);
  const part = (name: string): string => parts.find(item => item.type === name)?.value || '';
  const label = `${Number(part('month'))}月${Number(part('day'))}日`;
  return `${type} · 预计${label}到`;
}

export function isDrawingConfirmationAlert(code: ProductionAlertCode): boolean {
  return drawingConfirmationCodes.has(code);
}

export function getProductionAlerts(input: ProductionAlertInput, now = new Date()): ProductionAlert[] {
  const alerts: ProductionAlert[] = [];
  const drawing = String(input.drawingStatus || '').trim();
  const remark = String(input.latestProgressRemark || '').trim();
  const drawingContext = `${drawing}\n${remark}`;
  const stageCompleted = completedStage(input.stage);
  const quantity = getProductionQuantitySummary(input);

  if (/返工/.test(drawingContext)) alerts.push({ code: 'REWORK', label: '返工待处理', tone: 'red' });
  if (/变更/.test(drawingContext)) alerts.push({ code: 'DRAWING_CHANGE_REQUIRED', label: '图纸需变更', tone: 'red' });
  else if (/样品/.test(drawingContext) && /确认|等待|待/.test(drawingContext)) alerts.push({ code: 'SAMPLE_CONFIRMATION_REQUIRED', label: '待样品确认', tone: 'amber' });
  else if (/客户/.test(drawingContext) && /确认|等待|待/.test(drawingContext)) alerts.push({ code: 'CUSTOMER_CONFIRMATION_REQUIRED', label: '待客户确认', tone: 'amber' });
  else if (!stageCompleted && !hasEffectiveIssuedDrawing(drawing, Boolean(input.hasOriginalDrawing))) {
    alerts.push({ code: 'DRAWING_NOT_ISSUED', label: '图纸待发', tone: 'orange' });
  }

  if (!stageCompleted && input.warehouseMaterialStatus === 'exception') {
    const critical = input.warehouseExceptionType === 'wrong_material'
      || input.warehouseExceptionType === 'quality_issue'
      || overdueDays(input.warehouseExpectedAt, now) > 0;
    alerts.push({ code: 'MATERIAL_NOT_READY', label: warehouseAlertLabel(input, now), tone: critical ? 'red' : 'orange' });
  }

  const days = stageCompleted ? 0 : overdueDays(productionCustomerDate(input), now);
  if (days > 0) alerts.push({ code: 'OVERDUE', label: `客户交期逾期${days}天`, tone: 'red' });
  const internalDays = stageCompleted ? 0 : overdueDays(productionEstimatedDate(input), now);
  if (internalDays > 0) alerts.push({ code: 'INTERNAL_PLAN_DELAY', label: `内部预计延期${internalDays}天`, tone: 'amber' });
  if (quantity.status === 'tail_remaining' && quantity.remainingQty !== null) {
    alerts.push({ code: 'TAIL_REMAINING', label: `剩余${quantity.remainingQty}套`, tone: 'orange' });
  }
  if (input.specificationInvalid || !String(input.specification || '').trim()) {
    alerts.push({ code: 'SPECIFICATION_INVALID', label: '规格异常', tone: 'blue' });
  }
  return alerts;
}
