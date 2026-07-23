'use client';

import { AlertTriangle, ArrowRight, BarChart3, CalendarDays, CheckCircle2, Clock3, Copy, Download, GripVertical, Info, ListChecks, PanelRightClose, PanelRightOpen, Pencil, RefreshCw, Rows3, Search, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useToastBridge } from '@/components/ToastProvider';
import { AppWorkbenchHeader } from '@/components/layout/AppWorkbenchHeader';
import { PortalMenu } from '@/components/PortalMenu';
import { VoiceInputButton } from '@/components/VoiceInputButton';
import { writeClipboardText } from '@/lib/client-platform';
import { getProductionAlerts, isDrawingConfirmationAlert, type ProductionAlert } from '@/lib/production-alerts';
import { prepareProductionQuantityAdjustment } from '@/lib/production-quantity-adjustment';
import { formatProductionPercentage, formatProductionQuantity, getProductionQuantitySummary, type ProductionQuantitySummary } from '@/lib/production-quantity';
import type {
  CurrentUserDTO,
  ProcessExecutionContextDTO,
  WorkOrderProcessRouteDTO,
} from '@/types';

type StageKey = 'not_issued' | 'frontend' | 'backend' | 'completed';
type ViewKey = 'board' | 'today' | 'exceptions';
type WeekScope = 'current' | 'carryover' | 'next' | 'history';
type QuickFilter = 'overdue' | 'urgent' | 'drawing' | 'drawing_confirmation' | 'material' | 'documents' | 'tail_remaining' | 'completed' | 'due_today' | 'updated_today' | 'completed_today' | 'delivery_missing' | 'specification_invalid' | 'customer_missing';
type DetailTab = 'production' | 'drawing' | 'progress' | 'source';
type BatchOperation = 'set_priority' | 'set_stage' | 'add_remark';
type DuePreset = '' | 'today' | 'tomorrow' | 'overdue' | 'week' | 'custom';
type ProductionFlowAction = 'confirm_drawing_issued' | 'transfer_to_backend' | 'complete_from_backend' | 'advance_process_route';
type DispatchDensity = 'comfortable' | 'compact';
type DispatchPreset = 'all' | 'today' | 'exceptions' | 'completed';
type DispatchTone = 'normal' | 'warning' | 'danger';

type DispatchRisk = {
  label: string;
  detail: string;
  tone: DispatchTone;
};

type DispatchActivity = {
  id: string;
  specification: string;
  content: string;
  actor: string;
  createdAt: string;
};

type DispatchAlertItem = {
  id: string;
  order: ProductionOrder;
  alert: ProductionAlert;
};

type DispatchProcessLoad = {
  name: string;
  quantity: number;
};

type ProductionStageSegment = {
  stage: StageKey;
  quantity: number | null;
};

type ProductionQuantityFlow = {
  valid: boolean;
  targetQty: number | null;
  frontendTransferredQty: number | null;
  completedQty: number | null;
  frontendRemainingQty: number | null;
  backendRemainingQty: number | null;
  executionVersion: number;
  legacy: boolean;
  materialized: boolean;
  segments: ProductionStageSegment[];
  error: { code: string; field: string; message: string } | null;
};

type ProductionOrder = {
  id: string;
  code: string;
  specification?: string | null;
  customerName?: string | null;
  productName: string;
  stage: StageKey;
  stageText: string;
  priority: string;
  plannedAt?: string | null;
  deliveryDay?: string | null;
  uncompletedQty?: string | null;
  importedTargetQty: number | null;
  productionTargetQty: number | null;
  quantityTargetSource: 'manual_override' | 'weekly_plan' | 'missing';
  productionOwner?: string | null;
  workstation?: string | null;
  completedQty?: string | null;
  frontendTransferredQty?: number | null;
  executionVersion: number;
  quantityFlow: ProductionQuantityFlow;
  startedAt?: string | null;
  completedAt?: string | null;
  lastProgressAt?: string | null;
  latestProgressRemark?: string | null;
  lastProgressBy?: string | null;
  drawingStatus?: string | null;
  materialStatus?: string | null;
  warehouseMaterial?: {
    taskId: string;
    status: string;
    exceptionType?: string | null;
    exceptionNote?: string | null;
    expectedAt?: string | null;
    completedAt?: string | null;
    updatedAt: string;
  } | null;
  processRoute?: WorkOrderProcessRouteDTO | null;
  drawingLibraryItemId?: string | null;
  documentCompleteness: string;
  documentFilledCount: number;
  documentTotalCount: number;
  documentsComplete: boolean;
  documentCategoryCodes: string[];
  exceptionCodes: string[];
  exceptionLabels: string[];
  quantitySummary: ProductionQuantitySummary;
  productionAlerts: ProductionAlert[];
  processName?: string | null;
  orderDate?: string | null;
  salesperson?: string | null;
  customerLevel?: string | null;
  sourceOrderNo?: string | null;
  importBatchId?: string | null;
  sourceSheetName?: string | null;
  sourceRowNo?: number | null;
  drawingIssuedAt?: string | null;
  drawingIssueNote?: string | null;
  unitWorkHours?: string | null;
  totalWorkHours?: string | null;
  remark?: string | null;
  weekStartDate?: string | null;
  weekEndDate?: string | null;
  updatedAt: string;
};

type ProductionSummary = {
  scope: WeekScope;
  readOnly: boolean;
  weekStartDate?: string | null;
  weekEndDate?: string | null;
  total: number;
  dueToday: number;
  overdue: number;
  notIssuedDrawing: number;
  materialNotReady: number;
  incompleteDocuments: number;
  drawingConfirmation: number;
  tailRemaining: number;
  urgent: number;
  completed: number;
  exceptions: number;
  stageCounts: Record<StageKey, number>;
  stageQuantityTotals: Record<StageKey, number>;
  quantityTotals: {
    targetQty: number;
    completedQty: number;
    percentage: number | null;
    knownOrders: number;
    missingOrders: number;
  };
  navigation: {
    current: { weekStartDate: string; weekEndDate: string; count: number };
    next: { weekStartDate: string; weekEndDate: string; count: number };
    carryoverCount: number;
    history: Array<{ weekStartDate: string; weekEndDate: string; count: number }>;
  };
};

type BoardPayload = {
  scope: WeekScope;
  readOnly: boolean;
  weekStartDate?: string | null;
  weekEndDate?: string | null;
  stageCounts: Record<StageKey, number>;
  items: ProductionOrder[];
  filterOptions: { customers: string[] };
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
};

type ProgressLog = {
  id: string;
  previousStage?: string | null;
  previousStageText?: string | null;
  stage: string;
  stageText: string;
  completedQty?: string | null;
  productionOwner?: string | null;
  workstation?: string | null;
  remark?: string | null;
  createdBy?: string | null;
  createdAt: string;
};

type AdvancedFilters = {
  customers: string[];
  duePreset: DuePreset;
  dueFrom: string;
  dueTo: string;
  stage: string;
  priority: string;
  drawing: string;
  material: string;
  documents: string;
};

type UpdateForm = {
  completedQty: string;
  remark: string;
};

type QuantityAdjustmentForm = {
  targetQty: string;
  frontendTransferredQty: string;
  completedQty: string;
  reason: string;
  confirmReopen: boolean;
};

type ExecutionPatchPayload = Partial<UpdateForm> & {
  stage?: StageKey;
  drawingStatus?: string;
};

type StageChangeRequest = {
  order: ProductionOrder;
  stage: StageKey;
};

type NextStepRequest = {
  order: ProductionOrder;
  displayStage: StageKey;
  action: ProductionFlowAction;
  stepId?: string;
};

type ProcessExecutionForm = {
  employeeId: string;
  startedAt: string;
  endedAt: string;
  breakMinutes: string;
  goodQty: string;
  scrapQty: string;
  reworkQty: string;
  remark: string;
};

type ProductionCardView = {
  order: ProductionOrder;
  displayStage: StageKey;
  stageQuantity: number | null;
};

type ProductionExecutionViewState = {
  version: 1 | 2 | 3;
  createdAt: number;
  returnUrl: string;
  view: ViewKey;
  keyword: string;
  filters: AdvancedFilters;
  quick: QuickFilter[];
  scope?: WeekScope;
  weekStart: string;
  page?: number;
  batchMode: boolean;
  selectedIds: string[];
  completedCollapsed?: boolean;
  boardScrollLeft: number;
  boardScrollTop?: number;
  taskScrollTop?: number;
  windowScrollY?: number;
  columnScrollTops: Record<StageKey, number>;
  focusedOrderId?: string;
  focusedStage?: StageKey;
  focusedScrollRegion?: 'column' | 'board' | 'task' | 'window';
  focusedOffsetTop?: number;
};

type FilterChip = {
  key: string;
  label: string;
  remove: () => void;
};

const stages: Array<{ key: StageKey; label: string; step: string; hint: string }> = [
  { key: 'not_issued', label: '未发图', step: '01', hint: '等待图纸下发' },
  { key: 'frontend', label: '在前端', step: '02', hint: '前端工序进行中' },
  { key: 'backend', label: '在后端', step: '03', hint: '后端工序进行中' },
  { key: 'completed', label: '已完成', step: '04', hint: '生产完成归档' },
];

const drawingStatuses = ['未发', '已发', '待样品确认', '待客户确认', '图纸需变更', '已确认'] as const;

function stageMenuItems(order: ProductionOrder): Array<{ key: StageKey; label: string }> {
  const nextStage: Record<StageKey, StageKey> = {
    not_issued: 'frontend', frontend: 'backend', backend: 'completed', completed: 'backend',
  };
  const next = nextStage[order.stage];
  const ordered = [next, ...stages.map(item => item.key)].filter((key, index, values) => key !== order.stage && values.indexOf(key) === index);
  return ordered.map((key, index) => {
    const label = stages.find(item => item.key === key)?.label || key;
    if (index !== 0) return { key, label };
    return { key, label: order.stage === 'completed' ? `撤回到${label}` : `推进到${label}` };
  });
}

function dateTimeLocalValue(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function positiveWholeNumber(value: string): number | null {
  return /^[1-9]\d*$/.test(value.trim()) ? Number(value) : null;
}

function nonnegativeWholeNumber(value: string): number | null {
  return /^\d+$/.test(value.trim()) ? Number(value) : null;
}

function executionPreview(context: ProcessExecutionContextDTO | null, form: ProcessExecutionForm | null): {
  standardMilliseconds: number;
  actualMilliseconds: number;
  attainmentBasisPoints: number;
} | null {
  if (!context?.standard || !form) return null;
  const goodQty = positiveWholeNumber(form.goodQty);
  const breakMinutes = Number(form.breakMinutes || 0);
  const startedAt = new Date(form.startedAt);
  const endedAt = new Date(form.endedAt);
  if (!goodQty || !Number.isFinite(breakMinutes) || breakMinutes < 0 || Number.isNaN(startedAt.getTime()) || Number.isNaN(endedAt.getTime())) return null;
  const actualMilliseconds = endedAt.getTime() - startedAt.getTime() - Math.round(breakMinutes * 60_000);
  if (actualMilliseconds <= 0) return null;
  const standardMilliseconds = context.standard.source === 'product_profile'
    ? context.standard.standardMillisecondsPerUnit * goodQty
    : context.standard.setupMilliseconds + (
    context.standard.timeBasis === 'per_batch'
      ? context.standard.standardMillisecondsPerUnit
      : context.standard.standardMillisecondsPerUnit * goodQty * context.standard.unitsPerProduct
  );
  return {
    standardMilliseconds,
    actualMilliseconds,
    attainmentBasisPoints: Math.round((standardMilliseconds / actualMilliseconds) * 10_000),
  };
}

function durationText(milliseconds: number): string {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return '-';
  const minutes = milliseconds / 60_000;
  if (minutes < 1) return `${Math.round(milliseconds / 1000)} 秒`;
  if (minutes < 60) return `${Number(minutes.toFixed(1))} 分钟`;
  return `${Number((minutes / 60).toFixed(2))} 小时`;
}

const quickByView: Record<ViewKey, Array<{ key: QuickFilter; label: string }>> = {
  board: [
    { key: 'due_today', label: '今日交期' }, { key: 'overdue', label: '已逾期' },
    { key: 'drawing_confirmation', label: '图纸待确认' }, { key: 'material', label: '仓库异常' },
    { key: 'tail_remaining', label: '尾数未清' }, { key: 'completed', label: '已完成' },
  ],
  today: [
    { key: 'due_today', label: '今日交期' }, { key: 'overdue', label: '已逾期' },
    { key: 'updated_today', label: '今日更新' }, { key: 'completed_today', label: '今日完成' },
  ],
  exceptions: [
    { key: 'drawing_confirmation', label: '图纸待确认' }, { key: 'material', label: '仓库异常' }, { key: 'tail_remaining', label: '尾数未清' },
    { key: 'documents', label: '原图缺失' },
    { key: 'delivery_missing', label: '交期缺失' }, { key: 'specification_invalid', label: '规格异常' }, { key: 'customer_missing', label: '客户缺失' },
  ],
};

const categoryLabels: Array<{ code: string; label: string }> = [
  { code: 'drawing', label: '原图' }, { code: 'sop', label: 'SOP指导书' }, { code: 'product', label: '成品图' },
  { code: 'material', label: '辅料规格' }, { code: 'notice', label: '注意事项' },
];

const emptyAdvanced: AdvancedFilters = {
  customers: [], duePreset: '', dueFrom: '', dueTo: '', stage: '', priority: '', drawing: '', material: '', documents: '',
};

const productionBoardCache = new Map<string, BoardPayload>();
const validQuickFilters = new Set<QuickFilter>([
  'overdue', 'urgent', 'drawing', 'material', 'documents', 'completed', 'due_today', 'updated_today', 'completed_today',
  'delivery_missing', 'specification_invalid', 'customer_missing', 'drawing_confirmation', 'tail_remaining',
]);

function cloneAdvanced(value: AdvancedFilters): AdvancedFilters {
  return { ...value, customers: [...value.customers] };
}

function dateText(value?: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit' }).format(date);
}

function dateTimeText(value?: string | null): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date);
}

function priorityText(priority: string): string {
  if (priority === 'urgent') return '紧急';
  if (priority === 'high') return '高';
  return '一般';
}

function deliveryText(order: ProductionOrder): string {
  return order.deliveryDay?.trim() || dateText(order.plannedAt);
}

function warehouseMaterialText(order: ProductionOrder): string {
  if (order.warehouseMaterial?.status === 'completed') return '已配料';
  if (order.warehouseMaterial?.status === 'exception') return '仓库异常';
  if (order.warehouseMaterial?.status === 'pending') return '待配料';
  return '未建立配料任务';
}

function warehouseExceptionDetail(order: ProductionOrder): string {
  if (order.warehouseMaterial?.status !== 'exception') return '-';
  const typeMap: Record<string, string> = {
    shortage: '缺料', wrong_material: '料错', insufficient_quantity: '数量不足', quality_issue: '来料质量异常', other: '其他异常',
  };
  const type = typeMap[order.warehouseMaterial.exceptionType || ''] || '仓库异常';
  const expected = order.warehouseMaterial.expectedAt ? ` · 预计 ${dateText(order.warehouseMaterial.expectedAt)} 解决` : '';
  return `${type}${expected}${order.warehouseMaterial.exceptionNote ? ` · ${order.warehouseMaterial.exceptionNote}` : ''}`;
}

function specText(order: ProductionOrder): string {
  return order.specification?.trim() || '规格待补充';
}

function cardSegments(order: ProductionOrder): ProductionStageSegment[] {
  if (order.quantityFlow.valid && order.quantityFlow.segments.length) return order.quantityFlow.segments;
  return [{ stage: order.stage, quantity: null }];
}

function primaryCardView(order: ProductionOrder): ProductionCardView {
  const segments = cardSegments(order);
  const segment = segments.find(item => item.stage === order.stage) || segments[0];
  return { order, displayStage: segment.stage, stageQuantity: segment.quantity };
}

function shanghaiDateKey(value?: string | null): string {
  if (!value) return '';
  const direct = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (direct) return `${direct[1]}-${direct[2]}-${direct[3]}`;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(parsed);
}

function dateKeyNumber(value: string): number | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function daysUntilDelivery(order: ProductionOrder): number | null {
  const delivery = dateKeyNumber(shanghaiDateKey(order.deliveryDay || order.plannedAt));
  const today = dateKeyNumber(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date()));
  if (delivery === null || today === null) return null;
  return Math.round((delivery - today) / 86_400_000);
}

function currentProcessName(order: ProductionOrder): string {
  return order.processRoute?.currentStep?.processName || (order.stage === 'not_issued' ? '等待图纸' : order.stageText);
}

function nextProcessName(order: ProductionOrder): string {
  if (order.processRoute?.nextStep?.processName) return order.processRoute.nextStep.processName;
  if (order.processRoute?.status === 'completed' || order.stage === 'completed') return '完成归档';
  if (!order.processRoute || order.processRoute.status === 'draft') return '维护工序';
  return '等待确认';
}

function dispatchRisk(order: ProductionOrder): DispatchRisk {
  const criticalAlert = order.productionAlerts.find(alert => alert.tone === 'red');
  if (criticalAlert) return { label: criticalAlert.label, detail: '需要立即处理', tone: 'danger' };
  const remainingDays = daysUntilDelivery(order);
  if (remainingDays !== null && remainingDays < 0) {
    return { label: `逾期 ${Math.abs(remainingDays)} 天`, detail: `交期 ${deliveryText(order)}`, tone: 'danger' };
  }
  const warningAlert = order.productionAlerts.find(alert => alert.tone === 'amber' || alert.tone === 'orange');
  if (warningAlert) return { label: warningAlert.label, detail: '请尽快处理', tone: 'warning' };
  if (remainingDays !== null && remainingDays <= 2) {
    return { label: remainingDays === 0 ? '今日交付' : `${remainingDays} 天后交付`, detail: `交期 ${deliveryText(order)}`, tone: 'warning' };
  }
  return {
    label: remainingDays === null ? '交期待补' : '正常',
    detail: remainingDays === null ? '尚未设置交期' : `剩余 ${remainingDays} 天`,
    tone: remainingDays === null ? 'warning' : 'normal',
  };
}

function dispatchTargetQuantity(order: ProductionOrder): number {
  return order.quantitySummary.targetQty ?? order.quantityFlow.targetQty ?? 0;
}

function dispatchCompletedQuantity(order: ProductionOrder): number {
  return order.quantitySummary.completedQty ?? order.quantityFlow.completedQty ?? 0;
}

function updateFormFor(order: ProductionOrder): UpdateForm {
  return { completedQty: order.completedQty || '', remark: '' };
}

function quantityAdjustmentFormFor(order: ProductionOrder): QuantityAdjustmentForm {
  const targetQty = order.quantityFlow.targetQty ?? order.productionTargetQty ?? order.importedTargetQty;
  let frontendTransferredQty = order.quantityFlow.frontendTransferredQty ?? order.frontendTransferredQty;
  if (frontendTransferredQty === null || frontendTransferredQty === undefined) {
    frontendTransferredQty = (order.stage === 'backend' || order.stage === 'completed') && targetQty !== null && targetQty !== undefined
      ? targetQty
      : 0;
  }
  return {
    targetQty: targetQty === null || targetQty === undefined ? '' : String(targetQty),
    frontendTransferredQty: String(frontendTransferredQty),
    completedQty: String(order.quantitySummary.completedQty ?? 0),
    reason: '',
    confirmReopen: false,
  };
}

function quantitySourceText(order: ProductionOrder): string {
  if (order.quantityTargetSource === 'manual_override') return '生产校正值';
  if (order.quantityTargetSource === 'weekly_plan') return '周计划数量';
  return '数量待补充';
}

function advancedFromParams(params: URLSearchParams): AdvancedFilters {
  const customers = params.getAll('customer').flatMap(value => value.split(',')).map(value => value.trim()).filter(Boolean);
  const duePreset = params.get('duePreset');
  return {
    customers: [...new Set(customers)],
    duePreset: duePreset === 'today' || duePreset === 'tomorrow' || duePreset === 'overdue' || duePreset === 'week' || duePreset === 'custom' ? duePreset : '',
    dueFrom: params.get('dueFrom') || '',
    dueTo: params.get('dueTo') || '',
    stage: params.get('stage') || '',
    priority: params.get('priority') || '',
    drawing: params.get('drawing') || '',
    material: params.get('material') || '',
    documents: params.get('documents') || '',
  };
}

function appendAdvancedParams(params: URLSearchParams, value: AdvancedFilters): void {
  value.customers.forEach(customer => params.append('customer', customer));
  if (value.duePreset) params.set('duePreset', value.duePreset);
  if (value.dueFrom) params.set('dueFrom', value.dueFrom);
  if (value.dueTo) params.set('dueTo', value.dueTo);
  if (value.stage) params.set('stage', value.stage);
  if (value.priority) params.set('priority', value.priority);
  if (value.drawing) params.set('drawing', value.drawing);
  if (value.material) params.set('material', value.material);
  if (value.documents) params.set('documents', value.documents);
}

function executionParams(view: ViewKey, keyword: string, quick: QuickFilter[], advanced: AdvancedFilters, scope: WeekScope, weekStart: string, page = 1): URLSearchParams {
  const params = new URLSearchParams({ view, page: String(page), pageSize: '500' });
  params.set('scope', scope);
  if (keyword) params.set('keyword', keyword);
  if (quick.length) params.set('quick', quick.join(','));
  if (scope === 'history' && weekStart) params.set('weekStart', weekStart);
  appendAdvancedParams(params, advanced);
  return params;
}

function normalizedProductionUrl(value: string): string {
  try {
    const url = new URL(value, window.location.origin);
    url.searchParams.delete('returnKey');
    return `${url.pathname}${url.search ? url.search : ''}`;
  } catch {
    return '';
  }
}

function validProductionReturnState(value: ProductionExecutionViewState | null): value is ProductionExecutionViewState {
  return !!value
    && (value.version === 1 || value.version === 2 || value.version === 3)
    && Date.now() - value.createdAt < 30 * 60 * 1000
    && value.returnUrl.startsWith('/production');
}

function findProductionOrderCard(orderId?: string, stage?: StageKey): HTMLElement | null {
  if (!orderId) return null;
  const cards = Array.from(document.querySelectorAll<HTMLElement>('[data-production-order-id]'));
  return cards.find(card => card.dataset.productionOrderId === orderId && (!stage || card.dataset.productionStage === stage))
    || cards.find(card => card.dataset.productionOrderId === orderId)
    || null;
}

function replaceOrder(payload: BoardPayload | null, order: ProductionOrder): BoardPayload | null {
  if (!payload) return payload;
  const items = payload.items.map(item => item.id === order.id ? order : item);
  const stageCounts: Record<StageKey, number> = { not_issued: 0, frontend: 0, backend: 0, completed: 0 };
  items.forEach(item => cardSegments(item).forEach(segment => { stageCounts[segment.stage] += 1; }));
  return { ...payload, items, stageCounts };
}

function withProductionDerived(order: ProductionOrder): ProductionOrder {
  const quantitySummary = getProductionQuantitySummary(order);
  const productionAlerts = getProductionAlerts({
    ...order,
    specificationInvalid: order.exceptionCodes.includes('specification_invalid'),
    warehouseMaterialStatus: order.warehouseMaterial?.status,
    warehouseExceptionType: order.warehouseMaterial?.exceptionType,
    warehouseExceptionNote: order.warehouseMaterial?.exceptionNote,
    warehouseExpectedAt: order.warehouseMaterial?.expectedAt,
  });
  return { ...order, quantitySummary, productionAlerts };
}

function optimisticOrder(order: ProductionOrder, value: UpdateForm): ProductionOrder {
  return withProductionDerived({
    ...order,
    completedQty: value.completedQty.trim() || order.completedQty,
    latestProgressRemark: value.remark.trim() || order.latestProgressRemark,
    lastProgressAt: new Date().toISOString(),
  });
}

export default function ProductionExecutionCenter({ user }: { user: CurrentUserDTO }) {
  const router = useRouter();
  const [summary, setSummary] = useState<ProductionSummary | null>(null);
  const [board, setBoard] = useState<BoardPayload | null>(null);
  const [view, setView] = useState<ViewKey>('board');
  const [keyword, setKeyword] = useState('');
  const [debouncedKeyword, setDebouncedKeyword] = useState('');
  const [quick, setQuick] = useState<QuickFilter[]>([]);
  const [advanced, setAdvanced] = useState<AdvancedFilters>(emptyAdvanced);
  const [draftAdvanced, setDraftAdvanced] = useState<AdvancedFilters>(emptyAdvanced);
  const [scope, setScope] = useState<WeekScope>('current');
  const [weekStart, setWeekStart] = useState('');
  const [stateReady, setStateReady] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [refreshToken, setRefreshToken] = useState(0);
  const [summaryRefreshToken, setSummaryRefreshToken] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  useToastBridge(toast, setToast);
  const [batchMode, setBatchMode] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [detailOrder, setDetailOrder] = useState<ProductionOrder | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>('production');
  const [progressLogs, setProgressLogs] = useState<ProgressLog[]>([]);
  const [progressLoading, setProgressLoading] = useState(false);
  const [updateOrder, setUpdateOrder] = useState<ProductionOrder | null>(null);
  const [updateForm, setUpdateForm] = useState<UpdateForm | null>(null);
  const [quantityOrder, setQuantityOrder] = useState<ProductionOrder | null>(null);
  const [quantityForm, setQuantityForm] = useState<QuantityAdjustmentForm | null>(null);
  const [quantitySaving, setQuantitySaving] = useState(false);
  const [quantityError, setQuantityError] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchOperation, setBatchOperation] = useState<BatchOperation>('set_priority');
  const [batchValue, setBatchValue] = useState('');
  const [batchRemark, setBatchRemark] = useState('');
  const [batchConfirm, setBatchConfirm] = useState('');
  const [statusMenuOrder, setStatusMenuOrder] = useState<ProductionOrder | null>(null);
  const [drawingMenuOrder, setDrawingMenuOrder] = useState<ProductionOrder | null>(null);
  const [stageChangeRequest, setStageChangeRequest] = useState<StageChangeRequest | null>(null);
  const [completionSuggestion, setCompletionSuggestion] = useState<ProductionOrder | null>(null);
  const [nextStepRequest, setNextStepRequest] = useState<NextStepRequest | null>(null);
  const [nextStepQuantity, setNextStepQuantity] = useState('');
  const [nextStepError, setNextStepError] = useState('');
  const [executionContext, setExecutionContext] = useState<ProcessExecutionContextDTO | null>(null);
  const [executionForm, setExecutionForm] = useState<ProcessExecutionForm | null>(null);
  const [executionContextLoading, setExecutionContextLoading] = useState(false);
  const [executionContextWarning, setExecutionContextWarning] = useState('');
  const [insightsOpen, setInsightsOpen] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [density, setDensity] = useState<DispatchDensity>('comfortable');
  const filterButtonRef = useRef<HTMLButtonElement | null>(null);
  const insightsButtonRef = useRef<HTMLButtonElement | null>(null);
  const insightsCloseRef = useRef<HTMLButtonElement | null>(null);
  const insightsPanelRef = useRef<HTMLElement | null>(null);
  const statusButtonRef = useRef<HTMLButtonElement | null>(null);
  const drawingButtonRef = useRef<HTMLButtonElement | null>(null);
  const quantityTriggerRef = useRef<HTMLButtonElement | null>(null);
  const quantityTargetInputRef = useRef<HTMLInputElement | null>(null);
  const boardShellRef = useRef<HTMLDivElement | null>(null);
  const pendingRestoreRef = useRef<ProductionExecutionViewState | null>(null);
  const returnKeyRef = useRef('');
  const requestRef = useRef(0);
  const boardRef = useRef<BoardPayload | null>(null);
  const keywordReadyRef = useRef(false);
  const todayLabel = useMemo(() => new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: 'long', day: 'numeric', weekday: 'short',
  }).format(new Date()), []);

  useEffect(() => { boardRef.current = board; }, [board]);

  useEffect(() => {
    if (!quantityOrder) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const frame = window.requestAnimationFrame(() => quantityTargetInputRef.current?.focus());
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || quantitySaving) return;
      event.preventDefault();
      setQuantityOrder(null);
      setQuantityForm(null);
      setQuantityError('');
      window.requestAnimationFrame(() => {
        const trigger = quantityTriggerRef.current;
        if (trigger?.isConnected) trigger.focus();
        else findProductionOrderCard(quantityOrder.id)?.querySelector<HTMLButtonElement>('.production-card-quantity-edit')?.focus();
      });
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [quantityOrder, quantitySaving]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const explicitReturnKey = params.get('returnKey') || '';
    const pendingReturnKey = sessionStorage.getItem('production-execution:pending-return') || '';
    let returnKey = explicitReturnKey || pendingReturnKey;
    if (!returnKey) {
      const currentUrl = normalizedProductionUrl(window.location.href);
      let latest: { key: string; saved: ProductionExecutionViewState } | null = null;
      for (const key of Object.keys(sessionStorage).filter(item => item.startsWith('production-execution:return:'))) {
        try {
          const saved = JSON.parse(sessionStorage.getItem(key) || '{}') as ProductionExecutionViewState;
          if (!validProductionReturnState(saved)) {
            sessionStorage.removeItem(key);
            continue;
          }
          if (normalizedProductionUrl(saved.returnUrl) === currentUrl && (!latest || saved.createdAt > latest.saved.createdAt)) latest = { key, saved };
        } catch {
          sessionStorage.removeItem(key);
        }
      }
      if (latest) returnKey = latest.key.replace('production-execution:return:', '');
    }
    returnKeyRef.current = returnKey;
    let restored: ProductionExecutionViewState | null = null;
    if (returnKey) {
      try {
        const raw = sessionStorage.getItem(`production-execution:return:${returnKey}`);
        const saved = raw ? JSON.parse(raw) as ProductionExecutionViewState : null;
        const matchesCurrentUrl = !!saved && normalizedProductionUrl(saved.returnUrl) === normalizedProductionUrl(window.location.href);
        const returningThroughNavigation = !explicitReturnKey && pendingReturnKey === returnKey;
        if (validProductionReturnState(saved) && (matchesCurrentUrl || returningThroughNavigation)) {
          restored = saved;
          pendingRestoreRef.current = saved;
          window.history.replaceState(window.history.state, '', saved.returnUrl);
        } else {
          sessionStorage.removeItem(`production-execution:return:${returnKey}`);
          if (sessionStorage.getItem('production-execution:pending-return') === returnKey) sessionStorage.removeItem('production-execution:pending-return');
          returnKeyRef.current = '';
        }
      } catch {
        sessionStorage.removeItem(`production-execution:return:${returnKey}`);
        if (sessionStorage.getItem('production-execution:pending-return') === returnKey) sessionStorage.removeItem('production-execution:pending-return');
        returnKeyRef.current = '';
      }
    }
    const sourceParams = restored
      ? new URL(restored.returnUrl, window.location.origin).searchParams
      : params;
    const parsedView = restored?.view || sourceParams.get('view');
    const parsedKeyword = restored?.keyword ?? sourceParams.get('keyword') ?? '';
    const parsedQuick = restored?.quick
      ? restored.quick.filter(value => validQuickFilters.has(value))
      : (sourceParams.get('quick') || '').split(',').filter(value => validQuickFilters.has(value as QuickFilter)) as QuickFilter[];
    setView(parsedView === 'today' || parsedView === 'exceptions' ? parsedView : 'board');
    setKeyword(parsedKeyword);
    setDebouncedKeyword(parsedKeyword.trim());
    setQuick(parsedQuick);
    setAdvanced(restored ? cloneAdvanced(restored.filters) : advancedFromParams(sourceParams));
    const restoredScope = restored?.scope || sourceParams.get('scope');
    const restoredWeekStart = restored?.weekStart || sourceParams.get('weekStart') || '';
    setScope(restoredScope === 'carryover' || restoredScope === 'next' || restoredScope === 'history'
      ? restoredScope
      : restoredWeekStart ? 'history' : 'current');
    setWeekStart(restoredWeekStart);
    setPage(Math.max(1, restored?.page || Number(sourceParams.get('page')) || 1));
    if (restored) {
      setBatchMode(restored.batchMode);
      setSelected(Array.isArray(restored.selectedIds) ? restored.selectedIds : []);
    }
    setStateReady(true);
  }, []);

  useEffect(() => {
    if (!stateReady) return undefined;
    if (!keywordReadyRef.current) {
      keywordReadyRef.current = true;
      return undefined;
    }
    const timer = window.setTimeout(() => {
      setDebouncedKeyword(keyword.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [keyword, stateReady]);

  useEffect(() => {
    if (!stateReady) return;
    const params = executionParams(view, debouncedKeyword, quick, advanced, scope, weekStart, page);
    if (returnKeyRef.current) params.set('returnKey', returnKeyRef.current);
    window.history.replaceState(window.history.state, '', `/production?${params.toString()}`);
  }, [advanced, debouncedKeyword, page, quick, scope, stateReady, view, weekStart]);

  useEffect(() => {
    if (!stateReady) return undefined;
    let active = true;
    const params = new URLSearchParams();
    params.set('scope', scope);
    if (scope === 'history' && weekStart) params.set('weekStart', weekStart);
    fetch(`/api/dashboard/production-summary?${params.toString()}`, { cache: 'no-store' })
      .then(async response => {
        const body = await response.json().catch(() => ({}));
        if (response.status === 401) location.href = '/login';
        if (!response.ok) throw new Error(body.error || '生产摘要加载失败');
        return body.data as ProductionSummary;
      })
      .then(data => {
        if (!active) return;
        setSummary(data);
        if (scope === 'history' && !weekStart && data.weekStartDate) setWeekStart(data.weekStartDate);
      })
      .catch(reason => { if (active) setError(reason instanceof Error ? reason.message : '生产摘要加载失败'); });
    return () => { active = false; };
  }, [refreshToken, scope, stateReady, summaryRefreshToken, weekStart]);

  useEffect(() => {
    if (!stateReady) return undefined;
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    const controller = new AbortController();
    const params = executionParams(view, debouncedKeyword, quick, advanced, scope, weekStart, page);
    const cacheKey = params.toString();
    const cached = productionBoardCache.get(cacheKey);
    if (cached) {
      setBoard(cached);
      setLoading(false);
    } else {
      setLoading(true);
    }
    setError('');
    fetch(`/api/work-orders/execution?${cacheKey}`, { cache: 'no-store', signal: controller.signal })
      .then(async response => {
        const body = await response.json().catch(() => ({}));
        if (response.status === 401) location.href = '/login';
        if (!response.ok) throw new Error(body.error || '生产看板加载失败');
        return body.data as BoardPayload;
      })
      .then(data => {
        if (requestId !== requestRef.current) return;
        productionBoardCache.set(cacheKey, data);
        if (productionBoardCache.size > 8) productionBoardCache.delete(productionBoardCache.keys().next().value || '');
        setBoard(data);
        setSelected(current => current.filter(id => data.items.some(item => item.id === id)));
      })
      .catch(reason => {
        if (reason instanceof DOMException && reason.name === 'AbortError') return;
        if (requestId === requestRef.current) setError(reason instanceof Error ? reason.message : '生产看板加载失败');
      })
      .finally(() => { if (requestId === requestRef.current) setLoading(false); });
    return () => controller.abort();
  }, [advanced, debouncedKeyword, page, quick, refreshToken, scope, stateReady, view, weekStart]);

  useEffect(() => {
    if (loading || !board || !pendingRestoreRef.current) return;
    const saved = pendingRestoreRef.current;
    let cancelled = false;
    let timer = 0;
    let attempt = 0;
    const restore = (): void => {
      if (cancelled) return;
      attempt += 1;
      const shell = boardShellRef.current;
      if (shell) {
        shell.scrollLeft = saved.boardScrollLeft || 0;
        shell.scrollTop = saved.boardScrollTop || 0;
      }
      if (!shell || window.innerWidth < 1024) window.scrollTo({ top: saved.windowScrollY || 0, behavior: 'auto' });
      window.requestAnimationFrame(() => {
        const focusedCard = findProductionOrderCard(saved.focusedOrderId, saved.focusedStage);
        const anchorContainer = boardShellRef.current;
        if (focusedCard && typeof saved.focusedOffsetTop === 'number') {
          const useWindow = saved.focusedScrollRegion === 'window' || !anchorContainer;
          const currentOffset = useWindow
            ? focusedCard.getBoundingClientRect().top
            : focusedCard.getBoundingClientRect().top - anchorContainer.getBoundingClientRect().top;
          const delta = currentOffset - saved.focusedOffsetTop;
          if (Math.abs(delta) > 0.5) {
            if (useWindow) window.scrollBy({ top: delta, behavior: 'auto' });
            else anchorContainer.scrollTop += delta;
          }
        }
        if (attempt >= 3 || focusedCard) {
          const returnKey = returnKeyRef.current;
          const focusTarget = findProductionOrderCard(saved.focusedOrderId, saved.focusedStage)?.querySelector<HTMLElement>('.production-card-spec');
          if (focusTarget) focusTarget.focus({ preventScroll: true });
          sessionStorage.removeItem(`production-execution:return:${returnKey}`);
          if (sessionStorage.getItem('production-execution:pending-return') === returnKey) sessionStorage.removeItem('production-execution:pending-return');
          pendingRestoreRef.current = null;
          returnKeyRef.current = '';
          const params = executionParams(view, debouncedKeyword, quick, advanced, scope, weekStart, page);
          window.history.replaceState(window.history.state, '', `/production?${params.toString()}`);
        } else if (attempt < 8) {
          timer = window.setTimeout(restore, 100);
        }
      });
    };
    timer = window.setTimeout(restore, 160);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [advanced, board, debouncedKeyword, loading, page, quick, scope, view, weekStart]);

  useEffect(() => {
    document.body.classList.toggle('hongmeng-webview', Boolean(window.__HONGMENG_WEBVIEW__));
    return () => document.body.classList.remove('hongmeng-webview');
  }, []);

  useEffect(() => {
    setInsightsOpen(window.matchMedia('(min-width: 1440px)').matches);
  }, []);

  useEffect(() => {
    if (!autoRefresh) return undefined;
    const refresh = (): void => {
      if (document.visibilityState !== 'visible') return;
      productionBoardCache.clear();
      setRefreshToken(value => value + 1);
      setSummaryRefreshToken(value => value + 1);
    };
    const timer = window.setInterval(refresh, 30_000);
    return () => window.clearInterval(timer);
  }, [autoRefresh]);

  useEffect(() => {
    if (!insightsOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    const overlayMode = !window.matchMedia('(min-width: 1440px)').matches;
    if (overlayMode) document.body.style.overflow = 'hidden';
    const focusTimer = overlayMode ? window.setTimeout(() => insightsCloseRef.current?.focus(), 60) : 0;
    const handleInsightKeys = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setInsightsOpen(false);
        window.requestAnimationFrame(() => insightsButtonRef.current?.focus());
        return;
      }
      if (event.key !== 'Tab' || !overlayMode) return;
      const panel = insightsPanelRef.current;
      if (!panel) return;
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'));
      if (!focusable.length) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const outside = !panel.contains(document.activeElement);
      if (event.shiftKey && (document.activeElement === first || outside)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || outside)) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleInsightKeys);
    return () => {
      if (focusTimer) window.clearTimeout(focusTimer);
      if (overlayMode) document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleInsightKeys);
    };
  }, [insightsOpen]);

  const filterChips = useMemo<FilterChip[]>(() => {
    const chips: FilterChip[] = [];
    advanced.customers.forEach(customer => chips.push({
      key: `customer-${customer}`, label: `客户：${customer}`,
      remove: () => setAdvanced(current => ({ ...current, customers: current.customers.filter(item => item !== customer) })),
    }));
    const add = (key: keyof Omit<AdvancedFilters, 'customers'>, prefix: string, labels?: Record<string, string>): void => {
      const value = advanced[key];
      if (!value) return;
      chips.push({ key, label: `${prefix}：${labels?.[value] || value}`, remove: () => setAdvanced(current => ({ ...current, [key]: '' })) });
    };
    add('duePreset', '交期', { today: '今日', tomorrow: '明日', overdue: '已逾期', week: '本周', custom: '自定义' });
    add('dueFrom', '交期起'); add('dueTo', '交期止');
    add('stage', '状态', { not_issued: '未发图', frontend: '在前端', backend: '在后端', completed: '已完成' });
    add('priority', '优先级', { urgent: '紧急', high: '高', normal: '一般' });
    add('drawing', '图纸', {
      issued: '已发', not_issued: '未发', sample_confirmation: '待样品确认', customer_confirmation: '待客户确认',
      change_required: '图纸需变更', confirmed: '已确认', unset: '未设置',
    });
    add('material', '仓库', { pending: '待配料', completed: '已配料', exception: '异常', unset: '未建任务' });
    add('documents', '资料', { empty: '0/5', partial: '1-4/5', complete: '5/5' });
    return chips;
  }, [advanced]);

  const activeFilterCount = filterChips.length;

  const dispatchItems = useMemo(() => (board?.items || []).map(primaryCardView), [board]);

  const dispatchAlerts = useMemo<DispatchAlertItem[]>(() => (board?.items || [])
    .filter(order => order.stage !== 'completed')
    .flatMap(order => order.productionAlerts.map((alert, index) => ({ id: `${order.id}-${alert.code}-${index}`, order, alert })))
    .sort((left, right) => {
      const score = (alert: ProductionAlert): number => alert.tone === 'red' ? 3 : alert.tone === 'orange' ? 2 : 1;
      return score(right.alert) - score(left.alert);
    })
    .slice(0, 5), [board]);

  const dispatchActivities = useMemo<DispatchActivity[]>(() => (board?.items || [])
    .flatMap(order => (order.processRoute?.activities || []).map(activity => ({
      id: activity.id,
      specification: specText(order),
      content: activity.content || activity.action,
      actor: activity.actor?.displayName || activity.actor?.username || '系统',
      createdAt: activity.createdAt,
    })))
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
    .slice(0, 6), [board]);

  const processLoads = useMemo<DispatchProcessLoad[]>(() => {
    const totals = new Map<string, number>();
    for (const order of board?.items || []) {
      if (order.stage === 'completed') continue;
      const process = currentProcessName(order);
      const pendingQuantity = Math.max(dispatchTargetQuantity(order) - dispatchCompletedQuantity(order), 0);
      totals.set(process, (totals.get(process) || 0) + pendingQuantity);
    }
    return Array.from(totals.entries())
      .map(([name, quantity]) => ({ name, quantity }))
      .sort((left, right) => right.quantity - left.quantity)
      .slice(0, 5);
  }, [board]);

  const dispatchMetric = useMemo(() => ({
    inProduction: (summary?.stageCounts.frontend || 0) + (summary?.stageCounts.backend || 0),
    waitingTransfer: (board?.items || []).filter(order => order.stage !== 'completed' && Boolean(order.processRoute?.nextStep)).length,
    dueSoon: (board?.items || []).filter(order => order.stage !== 'completed' && dispatchRisk(order).tone !== 'normal').length,
    completed: summary?.completed || 0,
    percentage: summary?.quantityTotals.percentage ?? null,
  }), [board, summary]);

  const dispatchPreset: DispatchPreset = view === 'today'
    ? 'today'
    : view === 'exceptions'
      ? 'exceptions'
      : advanced.stage === 'completed'
        ? 'completed'
        : 'all';

  function changeView(next: ViewKey): void {
    setView(next);
    setQuick([]);
    setPage(1);
    setSelected([]);
  }

  function applyDispatchPreset(preset: DispatchPreset): void {
    setSelected([]);
    setPage(1);
    setQuick([]);
    if (preset === 'today') {
      setView('today');
      setAdvanced(emptyAdvanced);
      return;
    }
    if (preset === 'exceptions') {
      setView('exceptions');
      setAdvanced(emptyAdvanced);
      return;
    }
    setView('board');
    setAdvanced(preset === 'completed' ? { ...emptyAdvanced, stage: 'completed' } : emptyAdvanced);
  }

  function changeWeekScope(next: WeekScope, historyWeekStart?: string): void {
    setScope(next);
    setWeekStart(next === 'history' ? (historyWeekStart || summary?.navigation.history[0]?.weekStartDate || '') : '');
    setView('board');
    setQuick([]);
    setAdvanced(emptyAdvanced);
    setPage(1);
    setSelected([]);
    setBatchMode(false);
  }

  function toggleQuick(key: QuickFilter): void {
    setQuick(current => current.includes(key) ? current.filter(item => item !== key) : [...current, key]);
    setPage(1);
  }

  function selectStage(stage: StageKey): void {
    setView('board');
    setAdvanced(current => ({ ...current, stage: current.stage === stage ? '' : stage }));
    setPage(1);
  }

  function closeInsights(): void {
    setInsightsOpen(false);
    window.requestAnimationFrame(() => insightsButtonRef.current?.focus());
  }

  function toggleSummary(key: 'all' | 'due_today' | 'overdue' | 'drawing_confirmation' | 'material' | 'tail_remaining' | 'urgent' | 'completed'): void {
    if (key === 'all') {
      setKeyword(''); setQuick([]); setAdvanced(emptyAdvanced); setView('board'); setPage(1);
      return;
    }
    if (key === 'due_today') {
      setAdvanced(current => ({ ...current, duePreset: current.duePreset === 'today' ? '' : 'today', dueFrom: '', dueTo: '' }));
      setQuick(current => current.filter(item => item !== 'due_today'));
      return;
    }
    toggleQuick(key);
  }

  function summaryActive(key: string): boolean {
    if (key === 'all') return !debouncedKeyword && !quick.length && !activeFilterCount;
    if (key === 'due_today') return advanced.duePreset === 'today';
    return quick.includes(key as QuickFilter);
  }

  function toggleSelected(id: string): void {
    setSelected(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]);
  }

  function toggleBatchMode(): void {
    if (board?.readOnly) {
      setToast('下周预览为只读，启用为本周后才能批量修改');
      return;
    }
    setBatchMode(current => {
      if (current) setSelected([]);
      return !current;
    });
  }

  function openUpdate(order: ProductionOrder): void {
    if (board?.readOnly) {
      setToast('下周预览为只读，启用为本周后才能记录进度');
      return;
    }
    setStatusMenuOrder(null);
    setDrawingMenuOrder(null);
    setUpdateOrder(order);
    setUpdateForm(updateFormFor(order));
    setFormError('');
  }

  function openQuantityAdjustment(order: ProductionOrder, trigger?: HTMLButtonElement): void {
    if (board?.readOnly) {
      setToast('下周预览为只读，启用为本周后才能调整数量');
      return;
    }
    setStatusMenuOrder(null);
    setDrawingMenuOrder(null);
    quantityTriggerRef.current = trigger || (document.activeElement instanceof HTMLButtonElement ? document.activeElement : null);
    setDetailOrder(null);
    setQuantityOrder(order);
    setQuantityForm(quantityAdjustmentFormFor(order));
    setQuantityError('');
  }

  function closeQuantityAdjustment(): void {
    if (quantitySaving) return;
    const orderId = quantityOrder?.id;
    setQuantityOrder(null);
    setQuantityForm(null);
    setQuantityError('');
    window.requestAnimationFrame(() => {
      const trigger = quantityTriggerRef.current;
      if (trigger?.isConnected) trigger.focus();
      else findProductionOrderCard(orderId)?.querySelector<HTMLButtonElement>('.production-card-quantity-edit')?.focus();
    });
  }

  function applyLocalOrder(order: ProductionOrder): void {
    setBoard(current => replaceOrder(current, order));
    setDetailOrder(current => current?.id === order.id ? order : current);
  }

  async function requestExecutionPatch(orderId: string, payload: ExecutionPatchPayload, fallbackError: string): Promise<ProductionOrder> {
    const response = await fetch(`/api/work-orders/${orderId}/execution`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.data) throw new Error(body.error || fallbackError);
    return withProductionDerived(body.data as ProductionOrder);
  }

  async function saveUpdate(): Promise<void> {
    if (!updateOrder || !updateForm) return;
    const previousBoard = board;
    const previousDetail = detailOrder;
    const payload: ExecutionPatchPayload = updateOrder.quantityFlow.materialized
      ? { remark: updateForm.remark }
      : updateForm;
    const optimistic = optimisticOrder(updateOrder, updateOrder.quantityFlow.materialized
      ? { completedQty: updateOrder.completedQty || '', remark: updateForm.remark }
      : updateForm);
    setBoard(current => replaceOrder(current, optimistic));
    if (detailOrder?.id === updateOrder.id) setDetailOrder(optimistic);
    setSaving(true);
    setFormError('');
    try {
      const updated = await requestExecutionPatch(updateOrder.id, payload, '进度更新失败');
      applyLocalOrder(updated);
      setUpdateOrder(null);
      setUpdateForm(null);
      setToast('生产进度已更新');
      productionBoardCache.clear();
      setSummaryRefreshToken(value => value + 1);
      if (updated.stage !== 'completed' && (updated.quantitySummary.status === 'complete' || updated.quantitySummary.status === 'overrun')) {
        setCompletionSuggestion(updated);
      }
    } catch (reason) {
      setBoard(previousBoard);
      setDetailOrder(previousDetail);
      setFormError(reason instanceof Error ? reason.message : '进度更新失败');
    } finally {
      setSaving(false);
    }
  }

  async function saveQuantityAdjustment(): Promise<void> {
    if (!quantityOrder || !quantityForm) return;
    const prepared = prepareProductionQuantityAdjustment({
      targetQty: quantityForm.targetQty,
      frontendTransferredQty: quantityForm.frontendTransferredQty,
      completedQty: quantityForm.completedQty,
      currentStage: quantityOrder.stage,
    });
    if (!prepared.ok) {
      setQuantityError(prepared.message);
      return;
    }
    const hasExistingQuantity = quantityOrder.quantityTargetSource !== 'missing'
      || (quantityOrder.frontendTransferredQty !== null && quantityOrder.frontendTransferredQty !== undefined)
      || (quantityOrder.quantitySummary.completedQty ?? 0) > 0;
    if (hasExistingQuantity && quantityForm.reason.trim().length < 2) {
      setQuantityError('校正已有数量时请填写调整原因');
      return;
    }
    if (prepared.value.reopensCompletedOrder && !quantityForm.confirmReopen) {
      setQuantityError('数量变化会重新打开已完成工单，请先勾选确认');
      return;
    }

    setQuantitySaving(true);
    setQuantityError('');
    try {
      const response = await fetch(`/api/work-orders/${quantityOrder.id}/production-quantities`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetQty: quantityForm.targetQty,
          frontendTransferredQty: quantityForm.frontendTransferredQty,
          completedQty: quantityForm.completedQty,
          expectedVersion: quantityOrder.quantityFlow.executionVersion,
          reason: quantityForm.reason,
          confirmReopen: quantityForm.confirmReopen,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body.data) throw new Error(body.error || '生产数量保存失败');
      const updated = withProductionDerived(body.data as ProductionOrder);
      const adjustedOrderId = quantityOrder.id;
      applyLocalOrder(updated);
      setQuantityOrder(null);
      setQuantityForm(null);
      productionBoardCache.clear();
      setSummaryRefreshToken(value => value + 1);
      setToast(quantityOrder.quantityTargetSource === 'missing' ? '生产数量已补充，无需重新上传计划' : '生产数量已校正');
      window.requestAnimationFrame(() => {
        const trigger = quantityTriggerRef.current;
        if (trigger?.isConnected) trigger.focus();
        else findProductionOrderCard(adjustedOrderId)?.querySelector<HTMLButtonElement>('.production-card-quantity-edit')?.focus();
      });
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : '生产数量保存失败';
      setQuantityError(message);
      if (message === '工单进度已被其他操作更新，请刷新后重试') {
        productionBoardCache.clear();
        setRefreshToken(value => value + 1);
        setSummaryRefreshToken(value => value + 1);
      }
    } finally {
      setQuantitySaving(false);
    }
  }

  async function saveQuickUpdate(order: ProductionOrder, payload: ExecutionPatchPayload, optimistic: ProductionOrder, successMessage: string): Promise<ProductionOrder | null> {
    const previousBoard = boardRef.current;
    const previousDetail = detailOrder;
    applyLocalOrder(optimistic);
    setSaving(true);
    try {
      const updated = await requestExecutionPatch(order.id, payload, successMessage);
      applyLocalOrder(updated);
      productionBoardCache.clear();
      setSummaryRefreshToken(value => value + 1);
      setToast(successMessage);
      return updated;
    } catch (reason) {
      setBoard(previousBoard);
      setDetailOrder(previousDetail);
      setToast(reason instanceof Error ? reason.message : `${successMessage}失败`);
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function saveStageChange(order: ProductionOrder, stage: StageKey): Promise<void> {
    setStatusMenuOrder(null);
    setStageChangeRequest(null);
    setCompletionSuggestion(null);
    if (order.stage === stage) return;
    const optimistic = withProductionDerived({
      ...order,
      stage,
      stageText: stages.find(item => item.key === stage)?.label || order.stageText,
      completedAt: stage === 'completed' ? new Date().toISOString() : null,
    });
    await saveQuickUpdate(order, { stage }, optimistic, stage === 'completed' ? '工单已标记完成' : '生产状态已更新');
  }

  function requestStageChange(order: ProductionOrder, stage: StageKey): void {
    setStatusMenuOrder(null);
    setDrawingMenuOrder(null);
    if (stage === order.stage) return;
    if (stage === 'completed') {
      setStageChangeRequest({ order, stage });
      return;
    }
    void saveStageChange(order, stage);
  }

  async function saveDrawingStatus(order: ProductionOrder, drawingStatus: string): Promise<void> {
    setDrawingMenuOrder(null);
    if (order.drawingStatus === drawingStatus) return;
    const optimistic = withProductionDerived({ ...order, drawingStatus });
    await saveQuickUpdate(order, { drawingStatus }, optimistic, `图纸状态已更新为${drawingStatus}`);
  }

  async function loadProcessExecutionContext(stepId: string): Promise<void> {
    setExecutionContextLoading(true);
    setExecutionContextWarning('');
    setExecutionContext(null);
    setExecutionForm(null);
    try {
      const response = await fetch(`/api/process-executions/context?stepId=${encodeURIComponent(stepId)}`, { cache: 'no-store' });
      const body = await response.json().catch(() => ({})) as {
        context?: ProcessExecutionContextDTO;
        error?: string;
      };
      if (!response.ok || !body.context) throw new Error(body.error || '报工信息加载失败');
      const context = body.context;
      setExecutionContext(context);
      setExecutionForm({
        employeeId: context.employees[0]?.id || '',
        startedAt: dateTimeLocalValue(context.suggestedStartedAt),
        endedAt: dateTimeLocalValue(context.suggestedEndedAt),
        breakMinutes: '0',
        goodQty: String(Math.max(1, context.remainingGoodQuantity || 1)),
        scrapQty: '0',
        reworkQty: '0',
        remark: '',
      });
      if (!context.standard) {
        setExecutionContextWarning('当前工序尚未配置单套合计工时，请先到产品工序与工时维护并发布。');
      } else if (!context.employees.length) {
        setExecutionContextWarning('尚未建立在用员工档案，请先维护员工后再报工。');
      }
    } catch (reason) {
      setExecutionContextWarning(reason instanceof Error ? reason.message : '报工信息加载失败');
    } finally {
      setExecutionContextLoading(false);
    }
  }

  function openNextStep(order: ProductionOrder, displayStage: StageKey): void {
    if (board?.readOnly) {
      setToast('下周预览为只读，启用为本周后才能流转工单');
      return;
    }
    setStatusMenuOrder(null);
    setDrawingMenuOrder(null);
    if (order.processRoute && displayStage !== 'not_issued') {
      if (order.processRoute.status === 'draft') {
        if (!order.drawingLibraryItemId) {
          setToast('当前工单尚未关联图纸产品，无法匹配产品工序与工时');
          return;
        }
        router.push(`/workspace/product-times?itemId=${encodeURIComponent(order.drawingLibraryItemId)}`);
        return;
      }
      if (order.processRoute.status === 'completed') return;
      if (!order.processRoute.currentStep) {
        setToast('当前执行工序状态异常，请检查并重新发布该产品工序与工时');
        return;
      }
      const currentStepId = order.processRoute.currentSteps[0]?.id || order.processRoute.currentStep.id;
      setNextStepRequest({ order, displayStage, action: 'advance_process_route', stepId: currentStepId });
      setNextStepQuantity('');
      setNextStepError('');
      void loadProcessExecutionContext(currentStepId);
      return;
    }
    if (!order.quantityFlow.valid) {
      setToast(order.quantityFlow.error?.message || '工单数量数据不完整，暂时无法流转');
      return;
    }
    if (displayStage === 'completed') return;
    const action: ProductionFlowAction = displayStage === 'not_issued'
      ? 'confirm_drawing_issued'
      : displayStage === 'frontend'
        ? 'transfer_to_backend'
        : 'complete_from_backend';
    const defaultQuantity = displayStage === 'frontend'
      ? order.quantityFlow.frontendRemainingQty
      : displayStage === 'backend'
        ? order.quantityFlow.backendRemainingQty
        : null;
    setNextStepRequest({ order, displayStage, action });
    setNextStepQuantity(defaultQuantity && defaultQuantity > 0 ? String(defaultQuantity) : '');
    setNextStepError('');
    setExecutionContext(null);
    setExecutionForm(null);
    setExecutionContextWarning('');
  }

  function selectCurrentProcess(stepId: string): void {
    if (!nextStepRequest || nextStepRequest.action !== 'advance_process_route') return;
    setNextStepRequest({ ...nextStepRequest, stepId });
    setNextStepError('');
    void loadProcessExecutionContext(stepId);
  }

  async function saveNextStep(): Promise<void> {
    if (!nextStepRequest) return;
    const { order, action, displayStage } = nextStepRequest;
    let execution: {
      employeeId: string;
      startedAt: string;
      endedAt: string;
      breakMilliseconds: number;
      goodQty: number;
      scrapQty: number;
      reworkQty: number;
      remark: string;
    } | undefined;
    if (action === 'advance_process_route' && order.processRoute?.routeSource === 'product_time_profile'
      && (!executionContext || !executionContext.standard || !executionContext.employees.length)) {
      setNextStepError(executionContextWarning || '报工信息不完整，请先维护产品工时和员工档案');
      return;
    }
    if (action === 'advance_process_route' && executionContext?.standard && executionContext.employees.length) {
      if (executionContextLoading || !executionForm) {
        setNextStepError('报工信息仍在加载，请稍候');
        return;
      }
      if (!executionForm.employeeId) {
        setNextStepError('请选择完成该工序的员工');
        return;
      }
      const goodQty = positiveWholeNumber(executionForm.goodQty);
      const scrapQty = nonnegativeWholeNumber(executionForm.scrapQty);
      const reworkQty = nonnegativeWholeNumber(executionForm.reworkQty);
      const breakMinutes = Number(executionForm.breakMinutes || 0);
      const startedAt = new Date(executionForm.startedAt);
      const endedAt = new Date(executionForm.endedAt);
      if (!goodQty || goodQty > executionContext.remainingGoodQuantity) {
        setNextStepError(`合格数量必须为正整数，且不能超过本工序剩余数量 ${executionContext.remainingGoodQuantity}`);
        return;
      }
      if (scrapQty === null || reworkQty === null) {
        setNextStepError('报废数量和返工数量必须为非负整数');
        return;
      }
      if (!Number.isFinite(breakMinutes) || breakMinutes < 0) {
        setNextStepError('休息时间不能小于 0');
        return;
      }
      if (Number.isNaN(startedAt.getTime()) || Number.isNaN(endedAt.getTime()) || endedAt <= startedAt) {
        setNextStepError('结束时间必须晚于开始时间');
        return;
      }
      if (endedAt.getTime() - startedAt.getTime() <= breakMinutes * 60_000) {
        setNextStepError('实际作业时间必须大于休息时间');
        return;
      }
      execution = {
        employeeId: executionForm.employeeId,
        startedAt: startedAt.toISOString(),
        endedAt: endedAt.toISOString(),
        breakMilliseconds: Math.round(breakMinutes * 60_000),
        goodQty,
        scrapQty,
        reworkQty,
        remark: executionForm.remark.trim(),
      };
    }
    if (action !== 'confirm_drawing_issued' && action !== 'advance_process_route') {
      if (!/^[1-9]\d*$/.test(nextStepQuantity.trim())) {
        setNextStepError('本次数量必须是正整数');
        return;
      }
      const quantity = Number(nextStepQuantity);
      const maximum = displayStage === 'frontend'
        ? order.quantityFlow.frontendRemainingQty
        : order.quantityFlow.backendRemainingQty;
      if (maximum === null || quantity > maximum) {
        setNextStepError(`本次数量不能超过当前可流转数量 ${formatProductionQuantity(maximum)}`);
        return;
      }
    }

    setSaving(true);
    setNextStepError('');
    try {
      const processAdvance = action === 'advance_process_route' && order.processRoute;
      const response = await fetch(processAdvance
        ? `/api/process-management/routes/${order.processRoute?.id}`
        : `/api/work-orders/${order.id}/execution`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(processAdvance
          ? {
              action: 'advance',
              version: order.processRoute?.version,
              stepId: nextStepRequest.stepId,
              execution,
            }
          : {
              action,
              quantity: action === 'confirm_drawing_issued' ? undefined : nextStepQuantity.trim(),
              expectedVersion: order.quantityFlow.executionVersion,
            }),
      });
      const body = await response.json().catch(() => ({}));
      const responseOrder = processAdvance ? body.workOrder : body.data;
      if (!response.ok || !responseOrder) throw new Error(body.error || '生产工序流转失败');
      const updated = withProductionDerived(responseOrder as ProductionOrder);
      applyLocalOrder(updated);
      setNextStepRequest(null);
      setNextStepQuantity('');
      setExecutionContext(null);
      setExecutionForm(null);
      setExecutionContextWarning('');
      productionBoardCache.clear();
      setSummaryRefreshToken(value => value + 1);
      setToast(action === 'advance_process_route'
        ? '本次工序报工已提交'
        : action === 'confirm_drawing_issued'
        ? '图纸已确认下发，工单已进入前端'
        : action === 'transfer_to_backend'
          ? '前端数量已转入后端'
          : '后端完成数量已更新');
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : '生产数量流转失败';
      if (message === '工单进度已被其他操作更新，请刷新后重试') {
        setNextStepRequest(null);
        setToast(message);
        productionBoardCache.clear();
        setRefreshToken(value => value + 1);
        setSummaryRefreshToken(value => value + 1);
      } else {
        setNextStepError(message);
      }
    } finally {
      setSaving(false);
    }
  }

  async function loadProgress(orderId: string): Promise<void> {
    setProgressLoading(true);
    try {
      const response = await fetch(`/api/work-orders/${orderId}/progress-logs?pageSize=50`, { cache: 'no-store' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || '进度记录加载失败');
      setProgressLogs(Array.isArray(body.data?.items) ? body.data.items : []);
    } catch (reason) {
      setProgressLogs([]);
      setToast(reason instanceof Error ? reason.message : '进度记录加载失败');
    } finally {
      setProgressLoading(false);
    }
  }

  function openDetail(order: ProductionOrder): void {
    setDetailOrder(order);
    setDetailTab('production');
    setProgressLogs([]);
  }

  function switchDetailTab(tab: DetailTab): void {
    setDetailTab(tab);
    if (tab === 'progress' && detailOrder) void loadProgress(detailOrder.id);
  }

  function captureReturnState(returnKey: string, focusedOrderId: string, focusedStage?: StageKey): string {
    const params = executionParams(view, debouncedKeyword, quick, advanced, scope, weekStart, page);
    params.set('returnKey', returnKey);
    const returnUrl = `/production?${params.toString()}`;
    const focusedCard = findProductionOrderCard(focusedOrderId, focusedStage);
    let focusedScrollRegion: ProductionExecutionViewState['focusedScrollRegion'];
    let focusedOffsetTop: number | undefined;
    const shell = boardShellRef.current;
    if (focusedCard && shell && shell.scrollHeight > shell.clientHeight + 1) {
      focusedScrollRegion = 'board';
      focusedOffsetTop = focusedCard.getBoundingClientRect().top - shell.getBoundingClientRect().top;
    } else if (focusedCard) {
      focusedScrollRegion = 'window';
      focusedOffsetTop = focusedCard.getBoundingClientRect().top;
    }
    const state: ProductionExecutionViewState = {
      version: 3,
      createdAt: Date.now(),
      returnUrl,
      view,
      keyword: debouncedKeyword,
      filters: cloneAdvanced(advanced),
      quick: [...quick],
      scope,
      weekStart,
      page,
      batchMode,
      selectedIds: [...selected],
      completedCollapsed: false,
      boardScrollLeft: shell?.scrollLeft || 0,
      boardScrollTop: shell?.scrollTop || 0,
      taskScrollTop: 0,
      windowScrollY: window.scrollY,
      columnScrollTops: { not_issued: 0, frontend: 0, backend: 0, completed: 0 },
      focusedOrderId,
      focusedStage,
      focusedScrollRegion,
      focusedOffsetTop,
    };
    sessionStorage.setItem(`production-execution:return:${returnKey}`, JSON.stringify(state));
    sessionStorage.setItem('production-execution:pending-return', returnKey);
    window.history.replaceState(window.history.state, '', returnUrl);
    return returnUrl;
  }

  function openWorkOrderResources(order: ProductionOrder, focusedStage?: StageKey): void {
    const returnKey = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    captureReturnState(returnKey, order.id, focusedStage);
    const params = new URLSearchParams({ workOrderId: order.id, categoryCode: 'drawing', from: 'production', returnKey });
    router.push(`/dashboard?${params.toString()}`, { scroll: false });
  }

  function openDrawingLibrary(order: ProductionOrder, focusedStage?: StageKey): void {
    const returnKey = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const returnTo = captureReturnState(returnKey, order.id, focusedStage);
    const params = new URLSearchParams();
    if (order.drawingLibraryItemId) params.set('itemId', order.drawingLibraryItemId);
    else {
      params.set('create', '1');
      params.set('customerName', order.customerName || '');
      params.set('specification', order.specification || '');
      params.set('productName', order.productName || '');
    }
    params.set('from', 'production');
    params.set('returnKey', returnKey);
    params.set('returnTo', returnTo);
    router.push(`/drawing-library?${params.toString()}`, { scroll: false });
  }

  function openWorkflow(order: ProductionOrder, focusedStage?: StageKey): void {
    const returnKey = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const returnTo = captureReturnState(returnKey, order.id, focusedStage);
    const params = new URLSearchParams({
      workOrderId: order.id,
      weekScope: scope,
      from: 'production',
      returnKey,
      returnTo,
    });
    const stepId = order.processRoute?.currentSteps[0]?.id || order.processRoute?.currentStep?.id;
    if (stepId) params.set('stepId', stepId);
    if (weekStart) params.set('weekStart', weekStart);
    router.push(`/workspace/workflows?${params.toString()}`, { scroll: false });
  }

  function openProductionIssue(order: ProductionOrder, alertCode: string, focusedStage?: StageKey): void {
    const returnKey = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const returnTo = captureReturnState(returnKey, order.id, focusedStage);
    const params = new URLSearchParams({
      inbox: 'detected',
      sourceWorkOrderId: order.id,
      alertCode,
      returnKey,
      returnTo,
    });
    router.push(`/workspace/issues?${params.toString()}`, { scroll: false });
  }

  function openBatch(operation: BatchOperation): void {
    if (board?.readOnly) {
      setToast('下周预览为只读，启用为本周后才能批量修改');
      return;
    }
    setBatchOperation(operation); setBatchValue(''); setBatchRemark(''); setBatchConfirm(''); setFormError(''); setBatchOpen(true);
  }

  async function saveBatch(): Promise<void> {
    if (!selected.length) return;
    setSaving(true);
    setFormError('');
    const confirmText = batchOperation === 'set_stage' && batchValue !== 'completed' ? 'CONFIRM' : batchConfirm;
    try {
      const response = await fetch('/api/work-orders/batch-execution', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: selected, operation: batchOperation, value: batchValue, remark: batchRemark, confirmText }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || '批量更新失败');
      setBatchOpen(false); setSelected([]); setBatchMode(false);
      setToast(`已更新 ${body.data?.updated || 0} 个工单`);
      productionBoardCache.clear();
      setRefreshToken(value => value + 1);
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : '批量更新失败');
    } finally {
      setSaving(false);
    }
  }

  function exportCsv(): void {
    const params = executionParams(view, debouncedKeyword, quick, advanced, scope, weekStart, 1);
    params.delete('page'); params.delete('pageSize');
    location.href = `/api/export/production-execution.csv?${params.toString()}`;
  }

  async function copySpecification(order: ProductionOrder): Promise<void> {
    const specification = order.specification?.trim() || order.code.trim();
    if (!specification) {
      setToast('暂无可复制的规格');
      return;
    }
    try {
      await writeClipboardText(specification);
      setToast(order.specification?.trim() ? '已复制完整规格' : '规格未设置，已复制内部编号');
    } catch {
      setToast('复制失败，请手动选择规格复制');
    }
  }

  async function logout(): Promise<void> {
    await fetch('/api/auth/logout', { method: 'POST' });
    location.href = '/login';
  }

  const weeklyPlanWeekStart = weekStart || summary?.weekStartDate || '';
  const weeklyPlanHref = weeklyPlanWeekStart ? `/weekly-plan-center?currentWeekStart=${encodeURIComponent(weeklyPlanWeekStart)}` : '/weekly-plan-center';
  const weekScopeTitle = scope === 'carryover' ? '遗留未完' : scope === 'next' ? '下周预览' : scope === 'history' ? '历史周' : '当前执行周';
  const weekScopeRangeText = !summary?.weekStartDate
    ? '前往周计划中心启用'
    : scope === 'carryover'
      ? `早于 ${dateText(summary.weekStartDate)}`
      : `${dateText(summary.weekStartDate)} - ${dateText(summary.weekEndDate)}`;

  return (
    <main className={`production-page hm-production-workbench hm-workbench-root hm-workbench-navigation-overlay production-dispatch-density-${density}`}>
      <AppWorkbenchHeader
        user={user}
        activeHref="/production"
        subtitle="现场排程与工序流转"
        sidebarTriggerTargetId="production-dispatch-sidebar-trigger"
        menuItems={[
          { label: '系统设置', href: '/dashboard?openSettings=1' },
          { label: '退出登录', onSelect: () => { void logout(); } },
        ]}
      />

      <div className="production-execution-main">
        <section className="production-dispatch-command" aria-labelledby="production-page-title">
          <div className="production-dispatch-title">
            <span id="production-dispatch-sidebar-trigger" className="production-dispatch-nav-trigger" />
            <div>
              <span>现场生产</span>
              <strong id="production-page-title">生产调度中心</strong>
              <small>{todayLabel} · {weekScopeRangeText}</small>
            </div>
          </div>
          <nav className="production-dispatch-week-tabs" aria-label="生产周范围">
            <button className={scope === 'carryover' ? 'active' : ''} type="button" aria-pressed={scope === 'carryover'} onClick={() => changeWeekScope('carryover')}>遗留未完 <b>{summary?.navigation.carryoverCount ?? 0}</b></button>
            <button className={scope === 'current' ? 'active' : ''} type="button" aria-pressed={scope === 'current'} onClick={() => changeWeekScope('current')}>本周 <b>{summary?.navigation.current.count ?? 0}</b></button>
            <button className={scope === 'next' ? 'active' : ''} type="button" aria-pressed={scope === 'next'} onClick={() => changeWeekScope('next')}>下周 <b>{summary?.navigation.next.count ?? 0}</b></button>
            <label className={scope === 'history' ? 'active' : ''}>
              <span>历史周</span>
              <select aria-label="选择历史生产周" value={scope === 'history' ? weekStart : ''} onChange={event => changeWeekScope('history', event.target.value)}>
                <option value="" disabled>选择历史周</option>
                {summary?.navigation.history.map(item => <option key={item.weekStartDate} value={item.weekStartDate}>{dateText(item.weekStartDate)} - {dateText(item.weekEndDate)}（{item.count}）</option>)}
              </select>
            </label>
          </nav>
          <div className="production-dispatch-command-actions">
            <a className="hm-workbench-button" href={weeklyPlanHref}><CalendarDays size={15} aria-hidden="true" />周计划</a>
            <button className={`hm-workbench-button ${batchMode ? 'active' : ''}`.trim()} type="button" disabled={board?.readOnly} title={board?.readOnly ? '下周预览不可批量修改' : ''} onClick={toggleBatchMode}><ListChecks size={15} aria-hidden="true" />{batchMode ? '退出批量' : '批量'}</button>
            <button className="hm-workbench-button" type="button" onClick={exportCsv}><Download size={15} aria-hidden="true" />导出</button>
            <button ref={insightsButtonRef} className={`hm-workbench-button production-insight-trigger ${insightsOpen ? 'active' : ''}`.trim()} type="button" aria-expanded={insightsOpen} aria-controls="production-insight-panel" onClick={() => setInsightsOpen(value => !value)}>{insightsOpen ? <PanelRightClose size={15} aria-hidden="true" /> : <PanelRightOpen size={15} aria-hidden="true" />}调度侧栏</button>
          </div>
        </section>

        <section className="production-dispatch-metrics" aria-label="生产调度指标">
          <button type="button" className={dispatchPreset === 'all' ? 'active' : ''} onClick={() => applyDispatchPreset('all')}><span><CheckCircle2 size={18} aria-hidden="true" />生产中</span><strong>{dispatchMetric.inProduction}</strong><small>{weekScopeTitle} · {summary?.total || 0} 单</small></button>
          <button type="button" onClick={() => applyDispatchPreset('all')}><span><ArrowRight size={18} aria-hidden="true" />待转序</span><strong>{dispatchMetric.waitingTransfer}</strong><small>已有下一工序待衔接</small></button>
          <button type="button" className={dispatchPreset === 'exceptions' ? 'active warning' : 'warning'} onClick={() => applyDispatchPreset('exceptions')}><span><Clock3 size={18} aria-hidden="true" />即将超时</span><strong>{dispatchMetric.dueSoon}</strong><small>逾期、临期或异常任务</small></button>
          <button type="button" className={dispatchPreset === 'completed' ? 'active completed' : 'completed'} onClick={() => applyDispatchPreset('completed')}><span><CheckCircle2 size={18} aria-hidden="true" />已完成</span><strong>{dispatchMetric.completed}</strong><small>当前周完成归档</small></button>
          <div className="production-dispatch-metric-rate"><span><BarChart3 size={18} aria-hidden="true" />数量达成率</span><strong>{formatProductionPercentage(dispatchMetric.percentage)}</strong><small>按已完成数量统计</small></div>
        </section>

        <section className="production-dispatch-toolbar" aria-label="生产调度筛选">
          <label className="production-dispatch-search"><Search size={18} aria-hidden="true" /><input value={keyword} onChange={event => setKeyword(event.target.value)} placeholder="搜索客户、型号、工单或品名" /></label>
          <div className="production-dispatch-presets" aria-label="调度视图">
            <button className={dispatchPreset === 'all' ? 'active' : ''} type="button" aria-pressed={dispatchPreset === 'all'} onClick={() => applyDispatchPreset('all')}>全部</button>
            <button className={dispatchPreset === 'today' ? 'active' : ''} type="button" aria-pressed={dispatchPreset === 'today'} onClick={() => applyDispatchPreset('today')}>今日交付</button>
            <button className={dispatchPreset === 'exceptions' ? 'active' : ''} type="button" aria-pressed={dispatchPreset === 'exceptions'} onClick={() => applyDispatchPreset('exceptions')}>异常</button>
            <button className={dispatchPreset === 'completed' ? 'active' : ''} type="button" aria-pressed={dispatchPreset === 'completed'} onClick={() => applyDispatchPreset('completed')}>已完成</button>
          </div>
          <button ref={filterButtonRef} className={`production-dispatch-filter ${filtersOpen || activeFilterCount ? 'active' : ''}`.trim()} type="button" aria-expanded={filtersOpen} onClick={() => { setDraftAdvanced(cloneAdvanced(advanced)); setFiltersOpen(value => !value); }}>更多筛选{activeFilterCount ? ` ${activeFilterCount}` : ''}</button>
          <PortalMenu open={filtersOpen} anchorRef={filterButtonRef} align="right" className="production-filter-menu hm-production-menu hm-production-filter-menu" width={420} onClose={() => setFiltersOpen(false)} closeOnSelect={false}>
            <AdvancedFilterPanel customers={board?.filterOptions.customers || []} value={draftAdvanced} setValue={setDraftAdvanced} clear={() => setDraftAdvanced(emptyAdvanced)} apply={() => { setAdvanced(cloneAdvanced(draftAdvanced)); setFiltersOpen(false); setPage(1); }} />
          </PortalMenu>
          <button className={`production-auto-refresh ${autoRefresh ? 'active' : ''}`} type="button" aria-pressed={autoRefresh} title="每 30 秒自动刷新" onClick={() => setAutoRefresh(value => !value)}><RefreshCw size={15} aria-hidden="true" />自动刷新</button>
          <div className="production-density-control" aria-label="列表密度">
            <button className={density === 'comfortable' ? 'active' : ''} type="button" aria-label="舒适列表" title="舒适列表" onClick={() => setDensity('comfortable')}><Rows3 size={16} aria-hidden="true" /></button>
            <button className={density === 'compact' ? 'active' : ''} type="button" aria-label="紧凑列表" title="紧凑列表" onClick={() => setDensity('compact')}><ListChecks size={16} aria-hidden="true" /></button>
          </div>
          <span className="production-dispatch-result">{board?.pagination.total || 0} 项</span>
        </section>
        {!!filterChips.length && <div className="production-filter-chips production-dispatch-filter-chips" aria-label="已应用筛选">{filterChips.map(chip => <button key={chip.key} type="button" onClick={() => { chip.remove(); setPage(1); }} title={`移除${chip.label}`}>{chip.label}<span>×</span></button>)}<button className="clear" type="button" onClick={() => { setAdvanced(emptyAdvanced); setQuick([]); setKeyword(''); setPage(1); }}>清空全部</button></div>}

        {error && <div className="production-error"><span><strong>加载失败</strong>{error}</span><button type="button" onClick={() => setRefreshToken(value => value + 1)}>重新加载</button></div>}
        {scope === 'current' && summary?.total === 0 && !loading && <div className="production-empty-week"><strong>本周暂无已启用生产工单</strong><span>历史遗留工单可从“遗留未完”继续处理；新计划请在计划中心下达。</span><a href={weeklyPlanHref}>进入计划中心</a></div>}

        <div className={`production-dispatch-layout ${insightsOpen ? 'rail-open' : ''}`.trim()}>
          <section className="production-dispatch-list-panel" aria-label="生产工单调度列表">
            <header className="production-dispatch-list-head">
              <span>产品信息</span><span>当前工序</span><span>下一步工序</span><span>完成进度</span><span>交期 / 风险</span><span>现场操作</span>
            </header>
            <div ref={boardShellRef} className="production-dispatch-list hm-scroll-region" tabIndex={0} aria-label={`生产工单列表，共 ${board?.pagination.total || 0} 项`}>
              {dispatchItems.map(item => <ProductionDispatchRow
                key={item.order.id}
                item={item}
                readOnly={board?.readOnly || (scope === 'history' && item.order.stage === 'completed')}
                batchMode={batchMode}
                selected={selected}
                saving={saving}
                toggleSelected={toggleSelected}
                openDetail={openDetail}
                openUpdate={openUpdate}
                openQuantityAdjustment={openQuantityAdjustment}
                openNextStep={openNextStep}
                openDrawingLibrary={openDrawingLibrary}
                openWorkflow={openWorkflow}
                openIssue={openProductionIssue}
                copySpecification={copySpecification}
              />)}
              {loading && <DispatchRowSkeleton count={6} />}
              {!loading && !board?.items.length && <div className="production-dispatch-empty"><Rows3 size={28} aria-hidden="true" /><strong>当前没有匹配工单</strong><span>调整周范围或筛选条件后重试。</span></div>}
            </div>
            {board && board.pagination.totalPages > 1 && <div className="production-pagination production-dispatch-pagination"><span>共 {board.pagination.total} 单</span><button type="button" disabled={board.pagination.page <= 1} onClick={() => setPage(value => Math.max(1, value - 1))}>上一页</button><b>{board.pagination.page} / {board.pagination.totalPages}</b><button type="button" disabled={board.pagination.page >= board.pagination.totalPages} onClick={() => setPage(value => value + 1)}>下一页</button></div>}
          </section>

          {insightsOpen && <button className="production-dispatch-scrim" type="button" aria-label="关闭调度侧栏" onClick={closeInsights} />}
          <aside ref={insightsPanelRef} id="production-insight-panel" className={`production-dispatch-rail ${insightsOpen ? 'open' : ''}`} aria-label="生产调度侧栏" aria-hidden={!insightsOpen} tabIndex={-1}>
            <header><div><span>实时协同</span><strong>调度侧栏</strong></div><button ref={insightsCloseRef} type="button" aria-label="关闭调度侧栏" title="关闭调度侧栏" onClick={closeInsights}><X size={18} aria-hidden="true" /></button></header>
            <section className="production-dispatch-rail-section production-dispatch-alerts" aria-label="待处理异常">
              <div className="production-dispatch-rail-title"><strong><AlertTriangle size={15} aria-hidden="true" />待处理异常</strong><button type="button" onClick={() => applyDispatchPreset('exceptions')}>查看全部</button></div>
              {dispatchAlerts.map(item => <button type="button" key={item.id} onClick={() => openProductionIssue(item.order, item.alert.code, item.order.stage)}><span><b title={specText(item.order)}>{specText(item.order)}</b><small>{item.alert.label}</small></span><em className={item.alert.tone}>{item.alert.tone === 'red' ? '紧急' : '关注'}</em></button>)}
              {!dispatchAlerts.length && <p>当前筛选范围内没有待处理异常</p>}
            </section>
            <section className="production-dispatch-rail-section" aria-label="工序待处理量">
              <div className="production-dispatch-rail-title"><strong>工序待处理量</strong><span>实时</span></div>
              <div className="production-dispatch-loads">{processLoads.map((item, index) => {
                const maximum = processLoads[0]?.quantity || 1;
                const percentage = Math.max(4, Math.round((item.quantity / maximum) * 100));
                return <div key={item.name}><span><b>{item.name}</b><em>{formatProductionQuantity(item.quantity)}</em></span><i><span style={{ width: `${percentage}%` }} data-rank={index + 1} /></i></div>;
              })}{!processLoads.length && <p>暂无待处理工序数据</p>}</div>
            </section>
            <section className="production-dispatch-rail-section production-dispatch-activities" aria-label="最近流程动态">
              <div className="production-dispatch-rail-title"><strong>最近流程动态</strong><span>{dispatchActivities.length} 条</span></div>
              {dispatchActivities.map(activity => <button type="button" key={activity.id} onClick={() => {
                const order = board?.items.find(item => specText(item) === activity.specification);
                if (order) openWorkflow(order, order.stage);
              }}><i /><span><b title={activity.specification}>{activity.specification}</b><small>{activity.content}</small><em>{activity.actor} · {dateTimeText(activity.createdAt)}</em></span></button>)}
              {!dispatchActivities.length && <p>暂无流程动态</p>}
            </section>
          </aside>
        </div>
      </div>

      {batchMode && !board?.readOnly && <div className="production-batch-bar"><strong>已选 {selected.length} 单</strong><button type="button" disabled={!selected.length} onClick={() => openBatch('set_priority')}>设置优先级</button><button type="button" disabled={!selected.length} onClick={() => openBatch('set_stage')}>修改状态</button><button type="button" disabled={!selected.length} onClick={() => openBatch('add_remark')}>添加进度备注</button><button type="button" onClick={() => setSelected([])}>清空选择</button><button type="button" onClick={toggleBatchMode}>退出批量</button></div>}

      <PortalMenu open={!!statusMenuOrder} anchorRef={statusButtonRef} className="production-status-menu hm-production-menu hm-production-status-menu" width={164} onClose={() => setStatusMenuOrder(null)} closeOnSelect={false}>
        {statusMenuOrder && stageMenuItems(statusMenuOrder).map(stage => <button type="button" disabled={saving} key={stage.key} onClick={() => requestStageChange(statusMenuOrder, stage.key)}>{stage.label}</button>)}
      </PortalMenu>

      <PortalMenu open={!!drawingMenuOrder} anchorRef={drawingButtonRef} className="production-status-menu hm-production-menu hm-production-status-menu" width={184} onClose={() => setDrawingMenuOrder(null)} closeOnSelect={false}>
        {drawingMenuOrder && drawingStatuses.map(status => <button className={drawingMenuOrder.drawingStatus === status ? 'active' : ''} type="button" disabled={saving} key={status} onClick={() => void saveDrawingStatus(drawingMenuOrder, status)}>{status}</button>)}
      </PortalMenu>

      {updateOrder && updateForm && <UpdateDrawer order={updateOrder} value={updateForm} setValue={setUpdateForm} saving={saving} error={formError} close={() => { if (!saving) { setUpdateOrder(null); setUpdateForm(null); } }} save={saveUpdate} />}
      {quantityOrder && quantityForm && <QuantityAdjustmentDrawer order={quantityOrder} value={quantityForm} setValue={setQuantityForm} targetInputRef={quantityTargetInputRef} saving={quantitySaving} error={quantityError} close={closeQuantityAdjustment} save={() => void saveQuantityAdjustment()} />}
      {detailOrder && <DetailDialog order={detailOrder} readOnly={board?.readOnly || (scope === 'history' && detailOrder.stage === 'completed')} tab={detailTab} setTab={switchDetailTab} progressLogs={progressLogs} progressLoading={progressLoading} close={() => setDetailOrder(null)} update={() => openUpdate(detailOrder)} adjustQuantity={() => openQuantityAdjustment(detailOrder)} resources={() => openWorkOrderResources(detailOrder)} drawingLibrary={() => openDrawingLibrary(detailOrder, detailOrder.stage)} />}
      {batchOpen && <BatchDialog count={selected.length} operation={batchOperation} value={batchValue} remark={batchRemark} confirm={batchConfirm} saving={saving} error={formError} setValue={setBatchValue} setRemark={setBatchRemark} setConfirm={setBatchConfirm} close={() => { if (!saving) setBatchOpen(false); }} save={saveBatch} />}
      {stageChangeRequest && <StageChangeDialog request={stageChangeRequest} saving={saving} close={() => { if (!saving) setStageChangeRequest(null); }} confirm={() => void saveStageChange(stageChangeRequest.order, stageChangeRequest.stage)} />}
      {completionSuggestion && <CompletionSuggestionDialog order={completionSuggestion} saving={saving} close={() => setCompletionSuggestion(null)} confirm={() => void saveStageChange(completionSuggestion, 'completed')} />}
      {nextStepRequest && <NextStepDialog
        request={nextStepRequest}
        quantity={nextStepQuantity}
        setQuantity={setNextStepQuantity}
        executionContext={executionContext}
        executionForm={executionForm}
        setExecutionForm={setExecutionForm}
        executionContextLoading={executionContextLoading}
        executionContextWarning={executionContextWarning}
        selectProcess={selectCurrentProcess}
        saving={saving}
        error={nextStepError}
        close={() => {
          if (!saving) {
            setNextStepRequest(null);
            setNextStepQuantity('');
            setNextStepError('');
            setExecutionContext(null);
            setExecutionForm(null);
            setExecutionContextWarning('');
          }
        }}
        confirm={() => void saveNextStep()}
      />}
    </main>
  );
}

type ProductionDispatchRowProps = {
  item: ProductionCardView;
  readOnly: boolean;
  batchMode: boolean;
  selected: string[];
  saving: boolean;
  toggleSelected: (id: string) => void;
  openDetail: (order: ProductionOrder) => void;
  openUpdate: (order: ProductionOrder) => void;
  openQuantityAdjustment: (order: ProductionOrder, trigger?: HTMLButtonElement) => void;
  openNextStep: (order: ProductionOrder, displayStage: StageKey) => void;
  openDrawingLibrary: (order: ProductionOrder, focusedStage?: StageKey) => void;
  openWorkflow: (order: ProductionOrder, focusedStage?: StageKey) => void;
  openIssue: (order: ProductionOrder, alertCode: string, focusedStage?: StageKey) => void;
  copySpecification: (order: ProductionOrder) => Promise<void>;
};

function DispatchRowSkeleton({ count }: { count: number }) {
  return <>{Array.from({ length: count }, (_, index) => <div className="production-dispatch-row production-dispatch-row-skeleton" aria-hidden="true" key={index}>
    <span /><span /><span /><span /><span /><span />
  </div>)}</>;
}

function ProductionDispatchRow({
  item,
  readOnly,
  batchMode,
  selected,
  saving,
  toggleSelected,
  openDetail,
  openUpdate,
  openQuantityAdjustment,
  openNextStep,
  openDrawingLibrary,
  openWorkflow,
  openIssue,
  copySpecification,
}: ProductionDispatchRowProps) {
  const { order, displayStage, stageQuantity } = item;
  const route = order.processRoute;
  const targetQuantity = dispatchTargetQuantity(order);
  const completedQuantity = dispatchCompletedQuantity(order);
  const quantityPercentage = order.quantitySummary.percentage ?? (targetQuantity > 0 ? Math.round((completedQuantity / targetQuantity) * 1000) / 10 : 0);
  const progressPercentage = Math.max(0, Math.min(quantityPercentage, 100));
  const risk = dispatchRisk(order);
  const selectedRow = selected.includes(order.id);
  const currentProcess = currentProcessName(order);
  const nextProcess = nextProcessName(order);
  const routeProgress = route?.progress ?? 0;
  const firstAlert = order.productionAlerts[0];
  const routeNeedsMaintenance = !route || route.status === 'draft';
  const quantityUnavailable = targetQuantity <= 0 || !order.quantityFlow.valid;
  const completed = displayStage === 'completed' || route?.status === 'completed';
  const primaryText = readOnly
    ? '查看详情'
    : completed
      ? '查看记录'
      : quantityUnavailable
        ? '补充数量'
        : routeNeedsMaintenance
          ? '维护工序'
          : `完成${currentProcess}`;

  function runPrimaryAction(event: React.MouseEvent<HTMLButtonElement>): void {
    if (readOnly) {
      openDetail(order);
      return;
    }
    if (completed) {
      openWorkflow(order, displayStage);
      return;
    }
    if (quantityUnavailable) {
      openQuantityAdjustment(order, event.currentTarget);
      return;
    }
    openNextStep(order, displayStage);
  }

  return <article className={`production-dispatch-row stage-${displayStage} risk-${risk.tone} ${selectedRow ? 'selected' : ''}`.trim()} data-production-order-id={order.id} data-production-stage={displayStage}>
    <div className="production-dispatch-row-identity">
      <div className="production-dispatch-row-select">
        {batchMode && !readOnly
          ? <input type="checkbox" checked={selectedRow} aria-label={`选择 ${specText(order)}`} onChange={() => toggleSelected(order.id)} />
          : <GripVertical size={16} aria-hidden="true" />}
      </div>
      <div className="production-dispatch-product">
        <span><b title={order.customerName || '客户待补充'}>{order.customerName || '客户待补充'}</b><em className={order.priority}>{priorityText(order.priority)}</em></span>
        <button type="button" title={`${specText(order)}；进入图纸资料库`} onClick={() => openDrawingLibrary(order, displayStage)}>{specText(order)}</button>
        <small title={`${order.productName || '品名待补充'} · ${order.code}`}>{order.productName || '品名待补充'} · {order.code}</small>
      </div>
      <div className="production-dispatch-row-icon-actions">
        <button type="button" aria-label={`复制 ${specText(order)} 规格`} title="复制完整规格" onClick={() => void copySpecification(order)}><Copy size={14} aria-hidden="true" /></button>
        <button type="button" aria-label={`查看 ${specText(order)} 详情`} title="查看工单详情" onClick={() => openDetail(order)}><Info size={14} aria-hidden="true" /></button>
      </div>
    </div>

    <button className="production-dispatch-process current" type="button" title="进入流程中心查看当前工序" onClick={() => openWorkflow(order, displayStage)}>
      <span><b>{routeNeedsMaintenance ? '工序待维护' : currentProcess}</b><small>{route?.statusText || order.stageText}</small></span>
      <i><span style={{ width: `${routeProgress}%` }} /></i>
      <em>{route ? `${route.completedStepCount}/${route.stepCount}` : '未建路线'}</em>
    </button>

    <button className="production-dispatch-process next" type="button" title="进入流程中心查看下一工序" onClick={() => openWorkflow(order, displayStage)}>
      <ArrowRight size={16} aria-hidden="true" />
      <span><b>{nextProcess}</b><small>{route?.nextSteps.length ? `${route.nextSteps.length} 道待衔接` : completed ? '生产已结束' : '等待当前工序完成'}</small></span>
    </button>

    <button className="production-dispatch-progress" type="button" disabled={readOnly} title={readOnly ? '历史范围只读' : '记录生产进度'} onClick={() => openUpdate(order)}>
      <span><b>{formatProductionPercentage(quantityPercentage)}</b><small>{formatProductionQuantity(completedQuantity)} / {targetQuantity > 0 ? formatProductionQuantity(targetQuantity) : '待补充'}</small></span>
      <i><span style={{ width: `${progressPercentage}%` }} /></i>
      <em>本阶段 {stageQuantity === null ? '待补充' : formatProductionQuantity(stageQuantity)}</em>
    </button>

    <div className={`production-dispatch-risk ${risk.tone}`}>
      <strong>{deliveryText(order) || '交期待补'}</strong>
      <span>{risk.label}</span>
      <small>{risk.detail}</small>
      {firstAlert && <button type="button" title="进入问题管理处理该异常" onClick={() => openIssue(order, firstAlert.code, displayStage)}>{firstAlert.label}</button>}
    </div>

    <div className="production-dispatch-row-actions">
      <button className="primary" type="button" disabled={saving} onClick={runPrimaryAction}>{primaryText}</button>
      {!readOnly && !completed && <button type="button" disabled={saving} onClick={() => openUpdate(order)}>记录进度</button>}
      <button type="button" onClick={() => openWorkflow(order, displayStage)}>流程详情</button>
    </div>
  </article>;
}


function QuantityAdjustmentDrawer({ order, value, setValue, targetInputRef, saving, error, close, save }: {
  order: ProductionOrder;
  value: QuantityAdjustmentForm;
  setValue: (value: QuantityAdjustmentForm) => void;
  targetInputRef: { current: HTMLInputElement | null };
  saving: boolean;
  error: string;
  close: () => void;
  save: () => void;
}) {
  const prepared = prepareProductionQuantityAdjustment({
    targetQty: value.targetQty,
    frontendTransferredQty: value.frontendTransferredQty,
    completedQty: value.completedQty,
    currentStage: order.stage,
  });
  const preview = prepared.ok ? prepared.value : null;
  const nextStageText = preview ? stages.find(stage => stage.key === preview.nextStage)?.label || preview.nextStage : '-';
  const importedText = order.importedTargetQty !== null && order.importedTargetQty !== undefined
    ? `${formatProductionQuantity(order.importedTargetQty)} 套`
    : order.uncompletedQty?.trim()
      ? `原值“${order.uncompletedQty.trim()}”无法识别`
      : '周计划未提供';
  const requiresReason = order.quantityTargetSource !== 'missing'
    || (order.frontendTransferredQty !== null && order.frontendTransferredQty !== undefined)
    || (order.quantitySummary.completedQty ?? 0) > 0;

  function keepFocusInside(event: React.KeyboardEvent<HTMLDivElement>): void {
    if (event.key !== 'Tab') return;
    const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), textarea:not([disabled])'));
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return <div className="production-quantity-backdrop" onKeyDown={keepFocusInside} onMouseDown={event => { if (event.target === event.currentTarget) close(); }}>
    <aside className="production-quantity-drawer" role="dialog" aria-modal="true" aria-labelledby="production-quantity-title">
      <div className="dialog-title"><div><strong id="production-quantity-title">{order.quantityTargetSource === 'missing' ? '补充生产数量' : '校正生产数量'}</strong><small>{order.customerName || '客户待补充'} · {specText(order)}</small></div><button type="button" disabled={saving} aria-label="关闭数量校正" title="关闭" onClick={close}><X size={18} aria-hidden="true" /></button></div>
      <div className="production-quantity-origin"><span>周计划原始总目标</span><strong title={importedText}>{importedText}</strong><small>原始导入值永久保留，生产校正不会要求重新上传计划。</small></div>
      <div className="production-quantity-form-grid">
        <label><span>生产总目标 T</span><input ref={targetInputRef} inputMode="numeric" pattern="[0-9]*" min="1" step="1" value={value.targetQty} disabled={saving} onChange={event => setValue({ ...value, targetQty: event.target.value })} placeholder="请输入大于 0 的整数" /></label>
        <label><span>累计进入后端 F</span><input inputMode="numeric" pattern="[0-9]*" min="0" step="1" value={value.frontendTransferredQty} disabled={saving} onChange={event => setValue({ ...value, frontendTransferredQty: event.target.value })} placeholder="0" /></label>
        <label><span>累计完成 C</span><input inputMode="numeric" pattern="[0-9]*" min="0" step="1" value={value.completedQty} disabled={saving} onChange={event => setValue({ ...value, completedQty: event.target.value })} placeholder="0" /></label>
      </div>
      <div className={`production-quantity-live ${preview ? '' : 'invalid'}`} aria-live="polite">
        {preview ? <>
          <div><span>保存后阶段</span><strong>{nextStageText}</strong></div>
          <div><span>本阶段数量</span><strong>{formatProductionQuantity(preview.stageQuantity)} 套</strong></div>
          <div><span>整体进度</span><strong>{formatProductionPercentage(preview.percentage)}</strong></div>
          <div><span>前端剩余 T-F</span><strong>{formatProductionQuantity(preview.frontendRemainingQty)} 套</strong></div>
          <div><span>后端待完成 F-C</span><strong>{formatProductionQuantity(preview.backendRemainingQty)} 套</strong></div>
        </> : <p>{prepared.ok ? '' : prepared.message}</p>}
      </div>
      <label className="production-quantity-reason"><span>调整原因{requiresReason ? '（必填）' : '（首次补充可选）'}</span><textarea rows={3} maxLength={240} value={value.reason} disabled={saving} onChange={event => setValue({ ...value, reason: event.target.value })} placeholder={requiresReason ? '例如：现场复核后修正总目标' : '例如：补录周计划缺失数量'} /></label>
      {preview?.reopensCompletedOrder && <label className="production-quantity-reopen"><input type="checkbox" checked={value.confirmReopen} disabled={saving} onChange={event => setValue({ ...value, confirmReopen: event.target.checked })} /><span><strong>确认重新打开已完成工单</strong><small>保存后工单会回到{nextStageText}，历史完成记录和调整日志仍保留。</small></span></label>}
      <p className="production-quantity-rule">数量规则：累计完成 C ≤ 累计进入后端 F ≤ 生产总目标 T。保存后阶段和百分比自动重算。</p>
      {error && <div className="form-error" role="alert">{error}</div>}
      <div className="dialog-actions"><button type="button" disabled={saving} onClick={close}>取消</button><button className="primary-button" type="button" disabled={saving || !preview} onClick={save}>{saving ? '保存中...' : order.quantityTargetSource === 'missing' ? '保存并启用流转' : '保存数量校正'}</button></div>
    </aside>
  </div>;
}

function UpdateDrawer({ order, value, setValue, saving, error, close, save }: { order: ProductionOrder; value: UpdateForm; setValue: (value: UpdateForm) => void; saving: boolean; error: string; close: () => void; save: () => void }) {
  const draft = getProductionQuantitySummary({ ...order, completedQty: value.completedQty });
  return (
    <div className="production-update-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}><aside className="production-update-drawer" role="dialog" aria-modal="true" aria-label="快速更新工单进度">
      <div className="dialog-title"><div><strong>更新生产进度</strong><small>{specText(order)} · {order.customerName || '客户待补充'}</small></div><button type="button" aria-label="关闭" onClick={close}>×</button></div>
      <div className="production-update-product"><strong>{order.productName || '品名待补充'}</strong><span>{order.stageText}</span></div>
      <div className="production-update-quantity">
        <div><span>目标数量</span><strong>{formatProductionQuantity(draft.targetQty)}</strong></div>
        <div><span>当前已完成</span><strong>{formatProductionQuantity(draft.completedQty)}</strong></div>
        <div><span>当前剩余</span><strong>{formatProductionQuantity(draft.remainingQty)}</strong></div>
      </div>
      <div className="production-update-form">
        {order.quantityFlow.materialized
          ? <div className="production-flow-edit-note"><strong>数量由“下一步”流转维护</strong><span>此处仅记录生产进度备注，避免绕过分批数量校验。</span></div>
          : <label><span>累计完成数量</span><input inputMode="decimal" value={value.completedQty} onChange={event => setValue({ ...value, completedQty: event.target.value })} placeholder="请输入累计完成数量" /></label>}
        <label><span>进度备注</span><div className="production-voice-field"><textarea value={value.remark} onChange={event => setValue({ ...value, remark: event.target.value })} rows={4} placeholder="记录首件、批量生产或异常处理进度" /><VoiceInputButton value={value.remark} onChange={remark => setValue({ ...value, remark })} label="进度备注语音输入" /></div></label>
      </div>
      {error && <div className="form-error">{error}</div>}
      <div className="dialog-actions"><button type="button" disabled={saving} onClick={close}>取消</button><button className="primary-button" type="button" disabled={saving} onClick={save}>{saving ? '保存中...' : '保存进度'}</button></div>
    </aside></div>
  );
}

function NextStepDialog({ request, quantity, setQuantity, executionContext, executionForm, setExecutionForm, executionContextLoading, executionContextWarning, selectProcess, saving, error, close, confirm }: {
  request: NextStepRequest;
  quantity: string;
  setQuantity: (value: string) => void;
  executionContext: ProcessExecutionContextDTO | null;
  executionForm: ProcessExecutionForm | null;
  setExecutionForm: (value: ProcessExecutionForm) => void;
  executionContextLoading: boolean;
  executionContextWarning: string;
  selectProcess: (stepId: string) => void;
  saving: boolean;
  error: string;
  close: () => void;
  confirm: () => void;
}) {
  const { order, action } = request;
  const flow = order.quantityFlow;
  const isDrawingConfirmation = action === 'confirm_drawing_issued';
  const isProcessAdvance = action === 'advance_process_route';
  const selectedProcess = order.processRoute?.currentSteps.find(step => step.id === request.stepId)
    || order.processRoute?.currentStep;
  const title = isProcessAdvance
    ? `工序报工：${selectedProcess?.processName || '当前工序'}`
    : isDrawingConfirmation
      ? '确认图纸已下发并进入前端'
      : action === 'transfer_to_backend'
        ? '前端数量进入后端'
        : '确认后端完成数量';
  const quantityLabel = action === 'transfer_to_backend' ? '本次进入后端数量' : '本次完成数量';
  const preview = executionPreview(executionContext, executionForm);
  const requiresExecution = Boolean(executionContext?.standard && executionContext.employees.length);
  return <div className="modal-backdrop"><section className="production-dialog production-next-step-dialog" role="dialog" aria-modal="true" aria-label={title}>
    <div className="dialog-title"><div><strong>{title}</strong><small>{order.customerName || '客户待补充'} · {specText(order)}</small></div><button type="button" disabled={saving} onClick={close} aria-label="关闭">×</button></div>
    <div className="production-flow-summary" aria-label="当前生产数量">
      <div><span>总目标 T</span><strong>{formatProductionQuantity(flow.targetQty)}</strong></div>
      <div><span>前端剩余 T-F</span><strong>{formatProductionQuantity(flow.frontendRemainingQty)}</strong></div>
      <div><span>后端待完成 F-C</span><strong>{formatProductionQuantity(flow.backendRemainingQty)}</strong></div>
      <div><span>累计已完成 C</span><strong>{formatProductionQuantity(flow.completedQty)}</strong></div>
    </div>
    {isProcessAdvance
      ? <>
        <div className="production-flow-confirm-copy"><strong>{order.processRoute && order.processRoute.currentSteps.length > 1 ? `当前并行工序 ${order.processRoute.currentSteps.length} 道` : '按本次合格数量累计报工'}</strong><br />累计合格数量达到生产目标后完成本工序；同组并行工序全部完成后，才会开放下一顺序组。</div>
        {order.processRoute && order.processRoute.currentSteps.length > 1 && <label className="production-process-picker"><span>本次报工工序</span><select value={request.stepId || ''} disabled={saving || executionContextLoading} onChange={event => selectProcess(event.target.value)}>{order.processRoute.currentSteps.map(step => <option value={step.id} key={step.id}>{step.processName} · 已报 {step.reportedGoodQuantity || 0}</option>)}</select></label>}
        {executionContextLoading && <div className="production-execution-loading"><RefreshCw className="spin" />正在加载产品工时和员工档案...</div>}
        {executionContextWarning && <div className="production-execution-warning" role="status"><AlertTriangle />{executionContextWarning}<a href="/workspace/product-times">前往维护</a></div>}
        {requiresExecution && executionForm && executionContext?.standard && <div className="production-execution-form">
          <header><div><strong>本工序报工</strong><small>用于员工当日、周、月达成率汇总</small></div><em>标准 V{executionContext.standard.version || '-'}</em></header>
          <div className="production-execution-fields">
            <label><span>完成员工</span><select value={executionForm.employeeId} onChange={event => setExecutionForm({ ...executionForm, employeeId: event.target.value })}>{executionContext.employees.map(employee => <option value={employee.id} key={employee.id}>{employee.employeeNo} · {employee.name}{employee.position ? ` · ${employee.position}` : ''}{employee.team ? ` · ${employee.team}` : ''}</option>)}</select></label>
            <label><span>合格数量</span><input type="number" min="1" max={executionContext.remainingGoodQuantity} value={executionForm.goodQty} onChange={event => setExecutionForm({ ...executionForm, goodQty: event.target.value })} /></label>
            <label><span>开始时间</span><input type="datetime-local" value={executionForm.startedAt} onChange={event => setExecutionForm({ ...executionForm, startedAt: event.target.value })} /></label>
            <label><span>结束时间</span><input type="datetime-local" value={executionForm.endedAt} onChange={event => setExecutionForm({ ...executionForm, endedAt: event.target.value })} /></label>
            <label><span>休息时间（分钟）</span><input type="number" min="0" step="1" value={executionForm.breakMinutes} onChange={event => setExecutionForm({ ...executionForm, breakMinutes: event.target.value })} /></label>
            <label><span>报废 / 返工</span><div className="production-execution-split"><input aria-label="报废数量" type="number" min="0" step="1" value={executionForm.scrapQty} onChange={event => setExecutionForm({ ...executionForm, scrapQty: event.target.value })} /><input aria-label="返工数量" type="number" min="0" step="1" value={executionForm.reworkQty} onChange={event => setExecutionForm({ ...executionForm, reworkQty: event.target.value })} /></div></label>
            <label className="wide"><span>报工备注</span><input maxLength={300} value={executionForm.remark} onChange={event => setExecutionForm({ ...executionForm, remark: event.target.value })} placeholder="可选：记录异常、换线或人员协作情况" /></label>
          </div>
          <div className="production-execution-preview">
            <span><small>本工序累计</small><b>{executionContext.reportedGoodQuantity} / {executionContext.targetQuantity}，剩余 {executionContext.remainingGoodQuantity}</b></span>
            <span><small>标准口径</small><b>{executionContext.standard.source === 'product_profile' ? `单套本工序合计 ${executionContext.standard.standardMillisecondsPerUnit / 1000} 秒` : executionContext.standard.timeBasis === 'per_batch' ? '按批' : `每${executionContext.standard.unitLabel} ${executionContext.standard.standardMillisecondsPerUnit / 1000} 秒`}</b></span>
            <span><small>标准工时</small><b>{preview ? durationText(preview.standardMilliseconds) : '-'}</b></span>
            <span><small>实际工时</small><b>{preview ? durationText(preview.actualMilliseconds) : '-'}</b></span>
            <span><small>预计达成率</small><b className={preview && preview.attainmentBasisPoints >= 10_000 ? 'good' : preview ? 'watch' : ''}>{preview ? `${(preview.attainmentBasisPoints / 100).toFixed(1)}%` : '-'}</b></span>
          </div>
        </div>}
      </>
      : isDrawingConfirmation
      ? <p className="production-flow-confirm-copy">确认后，图纸状态将更新为“已发”，工单进入前端；目标数量和已有资料不会改变。</p>
      : <label className="production-flow-quantity-input"><span>{quantityLabel}</span><input autoFocus inputMode="numeric" pattern="[0-9]*" value={quantity} onChange={event => setQuantity(event.target.value)} disabled={saving} aria-describedby="production-flow-limit" /><small id="production-flow-limit">仅支持正整数，默认填写当前阶段全部可流转数量。</small></label>}
    {error && <div className="form-error" role="alert">{error}</div>}
    <div className="dialog-actions"><button type="button" disabled={saving} onClick={close}>取消</button><button className="primary-button" type="button" disabled={saving || executionContextLoading} onClick={confirm}>{saving ? '提交中...' : isProcessAdvance ? '提交本次报工' : '确认下一步'}</button></div>
  </section></div>;
}

function StageChangeDialog({ request, saving, close, confirm }: { request: StageChangeRequest; saving: boolean; close: () => void; confirm: () => void }) {
  const quantity = request.order.quantitySummary;
  const hasTail = quantity.remainingQty !== null && quantity.remainingQty > 0;
  return <div className="modal-backdrop"><section className="production-dialog production-stage-confirm" role="dialog" aria-modal="true" aria-label="确认完成工单">
    <div className="dialog-title"><div><strong>确认更新为已完成</strong><small>{specText(request.order)} · {request.order.customerName || '客户待补充'}</small></div><button type="button" onClick={close} aria-label="关闭">×</button></div>
    <div className="production-confirm-quantity"><span>目标 <b>{formatProductionQuantity(quantity.targetQty)}</b></span><span>已完成 <b>{formatProductionQuantity(quantity.completedQty)}</b></span><span>剩余 <b>{formatProductionQuantity(quantity.remainingQty)}</b></span></div>
    {hasTail ? <p className="production-tail-warning">当前仍剩余 {formatProductionQuantity(quantity.remainingQty)} 套，完成后将标记为“尾数未清”。</p> : <p className="production-complete-note">数量已完成，可以同步更新工单状态。</p>}
    <div className="dialog-actions"><button type="button" disabled={saving} onClick={close}>取消</button><button className="primary-button" type="button" disabled={saving} onClick={confirm}>{saving ? '更新中...' : '确认完成'}</button></div>
  </section></div>;
}

function CompletionSuggestionDialog({ order, saving, close, confirm }: { order: ProductionOrder; saving: boolean; close: () => void; confirm: () => void }) {
  return <div className="modal-backdrop"><section className="production-dialog production-stage-confirm" role="dialog" aria-modal="true" aria-label="数量完成提示">
    <div className="dialog-title"><div><strong>数量已经完成</strong><small>{specText(order)} · {formatProductionPercentage(order.quantitySummary.percentage)}</small></div><button type="button" onClick={close} aria-label="关闭">×</button></div>
    <p className="production-complete-note">累计完成数量已达到目标。是否同步把工单状态更新为“已完成”？</p>
    <div className="dialog-actions"><button type="button" disabled={saving} onClick={close}>暂不修改状态</button><button className="primary-button" type="button" disabled={saving} onClick={confirm}>{saving ? '更新中...' : '同步标记已完成'}</button></div>
  </section></div>;
}

function DetailDialog({ order, readOnly, tab, setTab, progressLogs, progressLoading, close, update, adjustQuantity, resources, drawingLibrary }: { order: ProductionOrder; readOnly: boolean; tab: DetailTab; setTab: (tab: DetailTab) => void; progressLogs: ProgressLog[]; progressLoading: boolean; close: () => void; update: () => void; adjustQuantity: () => void; resources: () => void; drawingLibrary: () => void }) {
  return (
    <div className="modal-backdrop"><section className="production-dialog detail" role="dialog" aria-modal="true" aria-label="生产工单详情">
      <div className="dialog-title"><div><strong>{specText(order)}</strong><small>{order.customerName || '客户待补充'} · {order.productName || '品名待补充'}</small></div><button type="button" aria-label="关闭" onClick={close}>×</button></div>
      <div className="production-detail-tabs">{([['production', '生产信息'], ['drawing', '工单资料'], ['progress', '进度记录'], ['source', '来源信息']] as Array<[DetailTab, string]>).map(item => <button className={tab === item[0] ? 'active' : ''} type="button" key={item[0]} onClick={() => setTab(item[0])}>{item[1]}</button>)}</div>
      <div className="production-detail-body">
        {tab === 'production' && <InfoGrid items={[
          ['状态', order.stageText], ['优先级', priorityText(order.priority)], ['周计划原始目标', order.importedTargetQty === null ? order.uncompletedQty || '-' : formatProductionQuantity(order.importedTargetQty)], ['当前生产目标', formatProductionQuantity(order.quantitySummary.targetQty)],
          ['工艺路线', order.processRoute?.statusText || '沿用前后端流程'], ['当前工序', order.processRoute?.currentStep?.processName || (order.processRoute?.status === 'confirmed' ? '等待图纸下发' : '-')], ['工序进度', order.processRoute ? `${order.processRoute.completedStepCount}/${order.processRoute.stepCount}（${order.processRoute.progress}%）` : '-'],
          ['数量来源', quantitySourceText(order)], ['累计进入后端', formatProductionQuantity(order.quantityFlow.frontendTransferredQty)], ['累计完成', formatProductionQuantity(order.quantitySummary.completedQty)], ['整体进度', formatProductionPercentage(order.quantitySummary.percentage)],
          ['交期', deliveryText(order) || '-'], ['图纸', order.drawingStatus || '-'], ['仓库配料', warehouseMaterialText(order)], ['仓库异常', warehouseExceptionDetail(order)], ['开始时间', dateTimeText(order.startedAt)],
          ['完成时间', dateTimeText(order.completedAt)], ['最近更新', dateTimeText(order.lastProgressAt)], ['最近进度', order.latestProgressRemark || '暂无进度备注'],
        ]} />}
        {tab === 'drawing' && <div className="production-drawing-detail"><div className="production-drawing-score"><span>工单资料完整度</span><strong>{order.documentFilledCount}/{order.documentTotalCount || 5}</strong></div><div className="production-category-status">{categoryLabels.map(category => <span className={order.documentCategoryCodes.includes(category.code) ? 'ready' : 'missing'} key={category.code}><i />{category.label}<b>{order.documentCategoryCodes.includes(category.code) ? '已有资料' : '待补充'}</b></span>)}</div><div className="production-drawing-actions"><button className="primary-button" type="button" onClick={resources}>打开工单资料</button><button type="button" onClick={drawingLibrary}>查看图纸资料库</button></div></div>}
        {tab === 'progress' && <div className="production-progress-list">{progressLoading && <div className="production-loading">进度记录加载中...</div>}{progressLogs.map(log => <article key={log.id}><time>{dateTimeText(log.createdAt)}</time><strong>{log.createdBy || '操作人未记录'}</strong><span>状态：{log.previousStageText && log.previousStage !== log.stage ? `${log.previousStageText} → ` : ''}{log.stageText}</span>{log.completedQty && <span>完成：{log.completedQty}</span>}{(log.productionOwner || log.workstation) && <span>历史记录：{log.productionOwner || ''}{log.productionOwner && log.workstation ? ' · ' : ''}{log.workstation || ''}</span>}<p>{log.remark || '未填写备注'}</p></article>)}{!progressLoading && !progressLogs.length && <div className="production-task-empty">暂无进度记录</div>}</div>}
        {tab === 'source' && <InfoGrid items={[
          ['订单日期', dateText(order.orderDate) || '-'], ['业务员', order.salesperson || '-'], ['客户等级', order.customerLevel || '-'], ['来源订单号', order.sourceOrderNo || '-'],
          ['导入批次', order.importBatchId || '-'], ['来源工作表', order.sourceSheetName || '-'], ['来源行号', order.sourceRowNo ? String(order.sourceRowNo) : '-'], ['内部编号', order.code],
          ['工序', order.processName || '-'], ['单位工时', order.unitWorkHours || '-'], ['总工时', order.totalWorkHours || '-'], ['图纸说明', order.drawingIssueNote || '-'],
        ]} />}
      </div>
      <div className="dialog-actions"><button type="button" onClick={resources}>工单资料</button>{!readOnly && <button type="button" onClick={adjustQuantity}>校正数量</button>}{!readOnly && <button className="primary-button" type="button" onClick={update}>更新进度</button>}<button type="button" onClick={close}>关闭</button></div>
    </section></div>
  );
}

function InfoGrid({ items }: { items: Array<[string, string]> }) {
  return <div className="production-info-grid">{items.map(([label, value]) => <div className={label === '最近进度' ? 'wide' : ''} key={label}><span>{label}</span><strong title={value}>{value}</strong></div>)}</div>;
}

function AdvancedFilterPanel({ customers, value, setValue, clear, apply }: { customers: string[]; value: AdvancedFilters; setValue: (value: AdvancedFilters) => void; clear: () => void; apply: () => void }) {
  const [customerSearch, setCustomerSearch] = useState('');
  const filteredCustomers = customers.filter(customer => customer.toLocaleLowerCase().includes(customerSearch.trim().toLocaleLowerCase()));
  function toggleCustomer(customer: string): void {
    setValue({ ...value, customers: value.customers.includes(customer) ? value.customers.filter(item => item !== customer) : [...value.customers, customer] });
  }
  return <section className="production-filter-panel" aria-label="生产看板高级筛选">
    <div className="production-filter-heading"><div><strong>高级筛选</strong><small>筛选当前启用周的生产工单</small></div><button type="button" onClick={clear}>重置</button></div>
    <div className="production-filter-fields">
      <fieldset className="production-customer-filter"><legend>客户（可多选）</legend><input value={customerSearch} onChange={event => setCustomerSearch(event.target.value)} placeholder="搜索当前周客户" /><div>{filteredCustomers.map(customer => <label key={customer}><input type="checkbox" checked={value.customers.includes(customer)} onChange={() => toggleCustomer(customer)} /><span>{customer}</span></label>)}{!filteredCustomers.length && <p>暂无匹配客户</p>}</div></fieldset>
      <label><span>交期</span><select value={value.duePreset} onChange={event => setValue({ ...value, duePreset: event.target.value as DuePreset, dueFrom: event.target.value === 'custom' ? value.dueFrom : '', dueTo: event.target.value === 'custom' ? value.dueTo : '' })}><option value="">全部交期</option><option value="today">今日</option><option value="tomorrow">明日</option><option value="overdue">已逾期</option><option value="week">本周</option><option value="custom">自定义</option></select></label>
      {value.duePreset === 'custom' && <><label><span>开始日期</span><input type="date" value={value.dueFrom} onChange={event => setValue({ ...value, dueFrom: event.target.value })} /></label><label><span>结束日期</span><input type="date" value={value.dueTo} onChange={event => setValue({ ...value, dueTo: event.target.value })} /></label></>}
      <label><span>状态</span><select value={value.stage} onChange={event => setValue({ ...value, stage: event.target.value })}><option value="">全部状态</option>{stages.map(stage => <option value={stage.key} key={stage.key}>{stage.label}</option>)}</select></label>
      <label><span>优先级</span><select value={value.priority} onChange={event => setValue({ ...value, priority: event.target.value })}><option value="">全部优先级</option><option value="urgent">紧急</option><option value="high">高</option><option value="normal">一般</option></select></label>
      <label><span>图纸状态</span><select value={value.drawing} onChange={event => setValue({ ...value, drawing: event.target.value })}><option value="">全部图纸状态</option><option value="issued">已发</option><option value="not_issued">未发</option><option value="sample_confirmation">待样品确认</option><option value="customer_confirmation">待客户确认</option><option value="change_required">图纸需变更</option><option value="confirmed">已确认</option><option value="unset">未设置</option></select></label>
      <label><span>仓库状态</span><select value={value.material} onChange={event => setValue({ ...value, material: event.target.value })}><option value="">全部仓库状态</option><option value="pending">待配料</option><option value="completed">已配料</option><option value="exception">仓库异常</option><option value="unset">未建立任务</option></select></label>
      <label><span>资料完整度</span><select value={value.documents} onChange={event => setValue({ ...value, documents: event.target.value })}><option value="">全部完整度</option><option value="empty">0/5</option><option value="partial">1-4/5</option><option value="complete">5/5</option></select></label>
    </div>
    <div className="production-filter-actions"><button type="button" onClick={clear}>清空全部</button><button className="primary-button" type="button" onClick={apply}>应用筛选</button></div>
  </section>;
}

function BatchDialog({ count, operation, value, remark, confirm, saving, error, setValue, setRemark, setConfirm, close, save }: { count: number; operation: BatchOperation; value: string; remark: string; confirm: string; saving: boolean; error: string; setValue: (value: string) => void; setRemark: (value: string) => void; setConfirm: (value: string) => void; close: () => void; save: () => void }) {
  const labels: Record<BatchOperation, string> = { set_priority: '批量设置优先级', set_stage: '批量修改状态', add_remark: '批量添加进度备注' };
  return <div className="modal-backdrop"><section className="production-dialog batch" role="dialog" aria-modal="true" aria-label={labels[operation]}><div className="dialog-title"><div><strong>{labels[operation]}</strong><small>将更新已选的 {count} 个当前周工单</small></div><button type="button" aria-label="关闭" onClick={close}>×</button></div><div className="production-batch-form">
    {operation === 'set_priority' && <label><span>优先级</span><select value={value} onChange={event => setValue(event.target.value)}><option value="">请选择</option><option value="urgent">紧急</option><option value="high">高</option><option value="normal">一般</option></select></label>}
    {operation === 'set_stage' && <label><span>新状态</span><select value={value} onChange={event => { setValue(event.target.value); setConfirm(''); }}><option value="">请选择</option>{stages.map(stage => <option value={stage.key} key={stage.key}>{stage.label}</option>)}</select></label>}
    <label><span>{operation === 'add_remark' ? '进度备注' : '附加进度备注（可选）'}</span><div className="production-voice-field"><textarea value={remark} onChange={event => setRemark(event.target.value)} rows={3} /><VoiceInputButton value={remark} onChange={setRemark} label="批量进度备注语音输入" /></div></label>
    {operation === 'set_stage' && value === 'completed' && <label className="danger-confirm-inline"><span>批量完成不可误触，请输入 COMPLETE_BATCH</span><input value={confirm} onChange={event => setConfirm(event.target.value)} placeholder="COMPLETE_BATCH" /></label>}
  </div>{error && <div className="form-error">{error}</div>}<div className="dialog-actions"><button type="button" disabled={saving} onClick={close}>取消</button><button className={operation === 'set_stage' && value === 'completed' ? 'danger-button' : 'primary-button'} type="button" disabled={saving || (operation !== 'add_remark' && !value) || (operation === 'add_remark' && !remark.trim()) || (operation === 'set_stage' && value === 'completed' && confirm.trim() !== 'COMPLETE_BATCH')} onClick={save}>{saving ? '处理中...' : '确认批量更新'}</button></div></section></div>;
}
