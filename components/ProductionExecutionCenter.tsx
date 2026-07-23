'use client';

import { AlertTriangle, ArrowRight, BarChart3, CalendarDays, CheckCircle2, Clock3, Copy, Download, Expand, Info, ListChecks, PanelRightClose, PanelRightOpen, Pencil, RefreshCw, Rows3, Search, Users, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useToastBridge } from '@/components/ToastProvider';
import { AppWorkbenchHeader } from '@/components/layout/AppWorkbenchHeader';
import { PortalMenu } from '@/components/PortalMenu';
import { VoiceInputButton } from '@/components/VoiceInputButton';
import { writeClipboardText } from '@/lib/client-platform';
import { getProductionAlerts, isDrawingConfirmationAlert, type ProductionAlert } from '@/lib/production-alerts';
import { resolveProductionLifecycle } from '@/lib/production-lifecycle';
import { resolveProductionPrimaryAction } from '@/lib/production-primary-action';
import { formatProductionPercentage, formatProductionQuantity, getProductionQuantitySummary, type ProductionQuantitySummary } from '@/lib/production-quantity';
import type {
  CurrentUserDTO,
  WorkOrderProcessRouteDTO,
} from '@/types';

type StageKey = 'not_issued' | 'frontend' | 'backend' | 'completed';
type ViewKey = 'board' | 'today' | 'exceptions';
type WeekScope = 'current' | 'carryover' | 'next' | 'history';
type QuickFilter = 'overdue' | 'urgent' | 'drawing' | 'drawing_confirmation' | 'material' | 'documents' | 'tail_remaining' | 'completed' | 'due_today' | 'updated_today' | 'completed_today' | 'delivery_missing' | 'specification_invalid' | 'customer_missing' | 'waiting_transfer';
type DetailTab = 'production' | 'drawing' | 'progress' | 'source';
type BatchOperation = 'set_priority' | 'add_remark';
type DuePreset = '' | 'today' | 'tomorrow' | 'overdue' | 'week' | 'custom';
type ProductionFlowAction = 'confirm_drawing_issued';
type DispatchDensity = 'comfortable' | 'compact';
type DispatchPreset = 'all' | 'today' | 'waiting' | 'exceptions' | 'completed';
type DispatchTone = 'normal' | 'warning' | 'danger';

type DispatchRisk = {
  label: string;
  detail: string;
  tone: DispatchTone;
  alert?: ProductionAlert;
};

type DispatchActivity = {
  id: string;
  orderId: string;
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
  parentWorkOrderId?: string | null;
  parentWorkOrder?: { id: string; code: string } | null;
  branchWorkOrders?: Array<{
    id: string;
    code: string;
    branchType?: 'REWORK' | 'SCRAP_REPLENISH' | 'QUALITY_PENDING' | null;
    branchStatus?: 'OPEN' | 'RELEASED' | 'IN_PROGRESS' | 'QUALITY_PENDING' | 'RESOLVED' | 'CANCELLED' | null;
    productionTargetQty?: number | null;
    routeStatus?: string | null;
    currentProcessName?: string | null;
    unitLabel?: string | null;
  }>;
  rootWorkOrderId?: string | null;
  branchType?: 'REWORK' | 'SCRAP_REPLENISH' | 'QUALITY_PENDING' | null;
  branchStatus?: 'OPEN' | 'RELEASED' | 'IN_PROGRESS' | 'QUALITY_PENDING' | 'RESOLVED' | 'CANCELLED' | null;
  originStep?: { id: string; processName: string } | null;
  rejoinStep?: { id: string; processName: string } | null;
  branchSequence?: number | null;
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

type ExecutionPatchPayload = {
  completedQty?: string;
  remark?: string;
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
};

type DefectDisposition = 'rework' | 'scrap_replenish';

type ProcessCompletionContext = {
  routeId: string;
  routeVersion: number;
  step: {
    id: string;
    processName: string;
    sequenceGroup: number;
    status: string;
    startedAt: string | null;
  };
  nextSteps: Array<{
    id: string;
    processName: string;
    sequenceGroup: number;
  }>;
  availableInputQty: number;
  processedQty: number;
  remainingInputQty: number;
  goodQty: number;
  defectQty: number;
  employees: Array<{
    id: string;
    employeeNo: string;
    name: string;
    department?: string | null;
    position?: string | null;
    team?: string | null;
  }>;
  recentCompletions: Array<{
    id: string;
    processedQty: number;
    goodQty: number;
    defectQty: number;
    defectDisposition?: string | null;
    workDate: string;
    completedAt: string;
    workStartedAt: string | null;
    workEndedAt: string | null;
    team: string | null;
    workstation: string | null;
    remark: string | null;
    participants: Array<{
      id: string;
      employeeNo: string;
      name: string;
      team?: string | null;
    }>;
    branchWorkOrder?: {
      id: string;
      code: string;
      branchType?: string | null;
      branchStatus?: string | null;
    } | null;
  }>;
};

type ProcessCompletionForm = {
  processedQty: string;
  defectQty: string;
  defectDisposition: DefectDisposition;
  workDate: string;
  workStartedAt: string;
  workEndedAt: string;
  employeeIds: string[];
  team: string;
  workstation: string;
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
  pageSize?: number;
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
  'delivery_missing', 'specification_invalid', 'customer_missing', 'drawing_confirmation', 'tail_remaining', 'waiting_transfer',
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

function dateTimeLocalValue(value?: string | Date | null): string {
  const date = value instanceof Date ? value : new Date(value || '');
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const valueFor = (type: Intl.DateTimeFormatPartTypes): string => (
    parts.find(part => part.type === type)?.value || ''
  );
  const hour = valueFor('hour') === '24' ? '00' : valueFor('hour');
  return `${valueFor('year')}-${valueFor('month')}-${valueFor('day')}T${hour}:${valueFor('minute')}`;
}

function defaultCompletionWorkWindow(startedAt?: string | null): {
  workStartedAt: string;
  workEndedAt: string;
} {
  const endedAt = new Date();
  const candidate = startedAt ? new Date(startedAt) : null;
  const duration = candidate && !Number.isNaN(candidate.getTime())
    ? endedAt.getTime() - candidate.getTime()
    : 0;
  const safeStartedAt = candidate && duration > 0 && duration <= 72 * 60 * 60 * 1000
    ? candidate
    : new Date(endedAt.getTime() - 60 * 60 * 1000);
  return {
    workStartedAt: dateTimeLocalValue(safeStartedAt),
    workEndedAt: dateTimeLocalValue(endedAt),
  };
}

function priorityText(priority: string): string {
  if (priority === 'urgent') return '紧急';
  if (priority === 'high') return '高';
  return '一般';
}

function branchTypeText(branchType?: ProductionOrder['branchType']): string {
  if (branchType === 'REWORK') return '返工分支';
  if (branchType === 'SCRAP_REPLENISH') return '补产分支';
  if (branchType === 'QUALITY_PENDING') return '质量待判';
  return '';
}

function branchStatusText(status?: ProductionOrder['branchStatus']): string {
  if (status === 'QUALITY_PENDING') return '待质量判定';
  if (status === 'IN_PROGRESS' || status === 'OPEN' || status === 'RELEASED') return '处理中';
  if (status === 'RESOLVED') return '已闭环';
  if (status === 'CANCELLED') return '已取消';
  return '状态待确认';
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

function todayShanghaiDateKey(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function durationText(milliseconds: number): string {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return '未设置标准工时';
  const minutes = milliseconds / 60_000;
  if (minutes < 1) return `${Math.round(milliseconds / 100) / 10} 秒`;
  if (minutes < 60) return `${Math.round(minutes * 10) / 10} 分钟`;
  return `${Math.round((minutes / 60) * 10) / 10} 小时`;
}

function defectDispositionText(value?: string | null): string {
  if (value === 'rework' || value === 'REWORK') return '返工分支';
  if (value === 'scrap_replenish' || value === 'SCRAP_REPLENISH') return '报废补产';
  if (value === 'quality_pending' || value === 'QUALITY_PENDING') return '质量待判';
  return '无不良';
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

function nextRouteSteps(order: ProductionOrder): WorkOrderProcessRouteDTO['steps'] {
  const route = order.processRoute;
  const current = route?.currentStep;
  if (!route || !current) return route?.nextSteps || [];
  const candidates = route.steps.filter(step => (
    step.sequenceGroup > current.sequenceGroup
    && step.status !== 'completed'
    && step.status !== 'skipped'
  ));
  if (!candidates.length) return [];
  const nextSequenceGroup = Math.min(...candidates.map(step => step.sequenceGroup));
  return candidates.filter(step => step.sequenceGroup === nextSequenceGroup);
}

function nextProcessName(order: ProductionOrder): string {
  const lifecycle = resolveProductionLifecycle({
    routeCompleted: order.processRoute?.status === 'completed',
    workOrderCompletedAt: order.completedAt,
  });
  if (lifecycle.awaitingBranchClosure) return '返工/补产分支';
  const nextSteps = nextRouteSteps(order);
  if (nextSteps.length) return nextSteps.map(step => step.processName).join(' / ');
  if (order.processRoute?.currentStep || lifecycle.aggregateCompleted) return '完成归档';
  if (!order.processRoute || order.processRoute.status === 'draft') return '维护工序';
  return '等待确认';
}

function dispatchRisk(order: ProductionOrder): DispatchRisk {
  const criticalAlert = order.productionAlerts.find(alert => alert.tone === 'red');
  if (criticalAlert) return { label: criticalAlert.label, detail: '需要立即处理', tone: 'danger', alert: criticalAlert };
  const remainingDays = daysUntilDelivery(order);
  if (remainingDays !== null && remainingDays < 0) {
    return { label: `逾期 ${Math.abs(remainingDays)} 天`, detail: `交期 ${deliveryText(order)}`, tone: 'danger' };
  }
  const warningAlert = order.productionAlerts.find(alert => alert.tone === 'amber' || alert.tone === 'orange');
  if (warningAlert) return { label: warningAlert.label, detail: '请尽快处理', tone: 'warning', alert: warningAlert };
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

function executionParams(
  view: ViewKey,
  keyword: string,
  quick: QuickFilter[],
  advanced: AdvancedFilters,
  scope: WeekScope,
  weekStart: string,
  page = 1,
  workOrderId = '',
  displaySize = 12,
): URLSearchParams {
  const params = new URLSearchParams({ view, page: '1', pageSize: '5000' });
  if (page > 1) params.set('displayPage', String(page));
  if (displaySize !== 12) params.set('displaySize', String(displaySize));
  params.set('scope', scope);
  if (workOrderId) params.set('workOrderId', workOrderId);
  if (keyword) params.set('keyword', keyword);
  if (quick.length) params.set('quick', quick.join(','));
  if (scope === 'history' && weekStart) params.set('weekStart', weekStart);
  appendAdvancedParams(params, advanced);
  return params;
}

async function fetchCompleteProductionBoard(params: URLSearchParams, signal: AbortSignal): Promise<BoardPayload> {
  const fetchPage = async (serverPage: number): Promise<BoardPayload> => {
    const pageParams = new URLSearchParams(params);
    pageParams.set('page', String(serverPage));
    pageParams.delete('displayPage');
    const response = await fetch(`/api/work-orders/execution?${pageParams.toString()}`, { cache: 'no-store', signal });
    const body = await response.json().catch(() => ({}));
    if (response.status === 401) location.href = '/login';
    if (!response.ok) throw new Error(body.error || '生产看板加载失败');
    return body.data as BoardPayload;
  };

  const firstPage = await fetchPage(1);
  if (firstPage.pagination.totalPages <= 1) return firstPage;

  const items = [...firstPage.items];
  for (let serverPage = 2; serverPage <= firstPage.pagination.totalPages; serverPage += 1) {
    const nextPage = await fetchPage(serverPage);
    items.push(...nextPage.items);
  }
  return {
    ...firstPage,
    items,
    pagination: {
      page: 1,
      pageSize: items.length,
      total: firstPage.pagination.total,
      totalPages: 1,
    },
  };
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

export default function ProductionExecutionCenter({ user }: { user: CurrentUserDTO }) {
  const router = useRouter();
  const canAdministerProduction = user.laborRole === 'ADMIN';
  const [summary, setSummary] = useState<ProductionSummary | null>(null);
  const [board, setBoard] = useState<BoardPayload | null>(null);
  const [view, setView] = useState<ViewKey>('board');
  const [keyword, setKeyword] = useState('');
  const [debouncedKeyword, setDebouncedKeyword] = useState('');
  const [targetWorkOrderId, setTargetWorkOrderId] = useState('');
  const [quick, setQuick] = useState<QuickFilter[]>([]);
  const [advanced, setAdvanced] = useState<AdvancedFilters>(emptyAdvanced);
  const [draftAdvanced, setDraftAdvanced] = useState<AdvancedFilters>(emptyAdvanced);
  const [scope, setScope] = useState<WeekScope>('current');
  const [weekStart, setWeekStart] = useState('');
  const [stateReady, setStateReady] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [dispatchPageSize, setDispatchPageSize] = useState(12);
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
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchOperation, setBatchOperation] = useState<BatchOperation>('set_priority');
  const [batchValue, setBatchValue] = useState('');
  const [batchRemark, setBatchRemark] = useState('');
  const [statusMenuOrder, setStatusMenuOrder] = useState<ProductionOrder | null>(null);
  const [drawingMenuOrder, setDrawingMenuOrder] = useState<ProductionOrder | null>(null);
  const [stageChangeRequest, setStageChangeRequest] = useState<StageChangeRequest | null>(null);
  const [nextStepRequest, setNextStepRequest] = useState<NextStepRequest | null>(null);
  const [nextStepError, setNextStepError] = useState('');
  const [completionOrder, setCompletionOrder] = useState<ProductionOrder | null>(null);
  const [completionContext, setCompletionContext] = useState<ProcessCompletionContext | null>(null);
  const [completionForm, setCompletionForm] = useState<ProcessCompletionForm | null>(null);
  const [completionLoading, setCompletionLoading] = useState(false);
  const [completionSaving, setCompletionSaving] = useState(false);
  const [completionError, setCompletionError] = useState('');
  const [completionStepId, setCompletionStepId] = useState('');
  const [completionIdempotencyKey, setCompletionIdempotencyKey] = useState('');
  const [insightsOpen, setInsightsOpen] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [density, setDensity] = useState<DispatchDensity>('comfortable');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);
  const filterButtonRef = useRef<HTMLButtonElement | null>(null);
  const insightsButtonRef = useRef<HTMLButtonElement | null>(null);
  const insightsCloseRef = useRef<HTMLButtonElement | null>(null);
  const insightsPanelRef = useRef<HTMLElement | null>(null);
  const statusButtonRef = useRef<HTMLButtonElement | null>(null);
  const drawingButtonRef = useRef<HTMLButtonElement | null>(null);
  const completionRequestRef = useRef(0);
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
    const params = new URLSearchParams(window.location.search);
    const explicitReturnKey = params.get('returnKey') || '';
    const explicitWorkOrderId = (params.get('workOrderId') || '').trim();
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
        const returningThroughNavigation = !explicitReturnKey
          && !explicitWorkOrderId
          && pendingReturnKey === returnKey;
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
    setTargetWorkOrderId((sourceParams.get('workOrderId') || '').trim().slice(0, 120));
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
    setPage(Math.max(1, restored?.page || Number(sourceParams.get('displayPage')) || Number(sourceParams.get('page')) || 1));
    const restoredPageSize = restored?.pageSize || Number(sourceParams.get('displaySize')) || 12;
    setDispatchPageSize(restoredPageSize === 8 || restoredPageSize === 16 ? restoredPageSize : 12);
    if (restored) {
      setBatchMode(canAdministerProduction && restored.batchMode);
      setSelected(canAdministerProduction && Array.isArray(restored.selectedIds) ? restored.selectedIds : []);
    }
    setStateReady(true);
  }, [canAdministerProduction]);

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
    const params = executionParams(view, debouncedKeyword, quick, advanced, scope, weekStart, page, targetWorkOrderId, dispatchPageSize);
    if (returnKeyRef.current) params.set('returnKey', returnKeyRef.current);
    window.history.replaceState(window.history.state, '', `/production?${params.toString()}`);
  }, [advanced, debouncedKeyword, dispatchPageSize, page, quick, scope, stateReady, targetWorkOrderId, view, weekStart]);

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
    const params = executionParams(view, debouncedKeyword, quick, advanced, scope, weekStart, 1, targetWorkOrderId);
    const cacheKey = params.toString();
    const cached = productionBoardCache.get(cacheKey);
    if (cached) {
      setBoard(cached);
      setLoading(false);
    } else {
      setLoading(true);
    }
    setError('');
    fetchCompleteProductionBoard(params, controller.signal)
      .then(data => {
        if (requestId !== requestRef.current) return;
        productionBoardCache.set(cacheKey, data);
        if (productionBoardCache.size > 8) productionBoardCache.delete(productionBoardCache.keys().next().value || '');
        setBoard(data);
        setLastRefreshedAt(new Date());
        setSelected(current => current.filter(id => data.items.some(item => item.id === id)));
      })
      .catch(reason => {
        if (reason instanceof DOMException && reason.name === 'AbortError') return;
        if (requestId === requestRef.current) setError(reason instanceof Error ? reason.message : '生产看板加载失败');
      })
      .finally(() => { if (requestId === requestRef.current) setLoading(false); });
    return () => controller.abort();
  }, [advanced, debouncedKeyword, quick, refreshToken, scope, stateReady, targetWorkOrderId, view, weekStart]);

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
          const params = executionParams(view, debouncedKeyword, quick, advanced, scope, weekStart, page, targetWorkOrderId, dispatchPageSize);
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
  }, [advanced, board, debouncedKeyword, dispatchPageSize, loading, page, quick, scope, targetWorkOrderId, view, weekStart]);

  useEffect(() => {
    document.body.classList.toggle('hongmeng-webview', Boolean(window.__HONGMENG_WEBVIEW__));
    return () => document.body.classList.remove('hongmeng-webview');
  }, []);

  useEffect(() => {
    const syncFullscreenState = (): void => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', syncFullscreenState);
    syncFullscreenState();
    return () => document.removeEventListener('fullscreenchange', syncFullscreenState);
  }, []);

  useEffect(() => {
    setInsightsOpen(window.matchMedia('(min-width: 1280px)').matches);
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
    const overlayMode = !window.matchMedia('(min-width: 1280px)').matches;
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
    if (targetWorkOrderId) {
      const targetOrder = board?.items.find(order => order.id === targetWorkOrderId);
      chips.push({
        key: 'work-order-target',
        label: `定位工单：${targetOrder?.code || targetWorkOrderId}`,
        remove: () => setTargetWorkOrderId(''),
      });
    }
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
  }, [advanced, board, targetWorkOrderId]);

  const activeFilterCount = filterChips.length;

  const dispatchAllItems = useMemo(() => (board?.items || []).map(primaryCardView), [board]);
  const dispatchTotalPages = Math.max(1, Math.ceil(dispatchAllItems.length / dispatchPageSize));
  const dispatchItems = useMemo(
    () => dispatchAllItems.slice((page - 1) * dispatchPageSize, page * dispatchPageSize),
    [dispatchAllItems, dispatchPageSize, page],
  );

  useEffect(() => {
    if (page <= dispatchTotalPages) return;
    setPage(dispatchTotalPages);
  }, [dispatchTotalPages, page]);

  const dispatchAlertItems = useMemo<DispatchAlertItem[]>(() => (board?.items || [])
    .filter(order => order.stage !== 'completed')
    .flatMap(order => order.productionAlerts.map((alert, index) => ({ id: `${order.id}-${alert.code}-${index}`, order, alert })))
    .sort((left, right) => {
      const score = (alert: ProductionAlert): number => alert.tone === 'red' ? 3 : alert.tone === 'orange' ? 2 : 1;
      return score(right.alert) - score(left.alert);
    }), [board]);
  const dispatchAlerts = useMemo(() => dispatchAlertItems.slice(0, 5), [dispatchAlertItems]);

  const dispatchActivities = useMemo<DispatchActivity[]>(() => (board?.items || [])
    .filter(order => Boolean(order.lastProgressAt || order.completedAt))
    .map(order => ({
      id: `${order.id}-${order.lastProgressAt || order.completedAt}`,
      orderId: order.id,
      specification: specText(order),
      content: order.latestProgressRemark || (order.stage === 'completed' ? '工单已完成' : '生产进度已更新'),
      actor: order.lastProgressBy || '系统',
      createdAt: order.lastProgressAt || order.completedAt || order.updatedAt,
    }))
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
    .slice(0, 6), [board]);

  const processLoads = useMemo<DispatchProcessLoad[]>(() => {
    const totals = new Map<string, number>();
    for (const order of board?.items || []) {
      if (order.stage === 'completed') continue;
      const process = currentProcessName(order);
      const stageQuantity = primaryCardView(order).stageQuantity;
      const pendingQuantity = stageQuantity === null
        ? Math.max(dispatchTargetQuantity(order) - dispatchCompletedQuantity(order), 0)
        : Math.max(stageQuantity, 0);
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
    dueSoon: (board?.items || []).filter(order => {
      if (order.stage === 'completed') return false;
      const days = daysUntilDelivery(order);
      return days !== null && days >= 0 && days <= 2;
    }).length,
    completed: summary?.completed || 0,
    percentage: summary?.quantityTotals.percentage ?? null,
  }), [board, summary]);

  const dispatchPreset: DispatchPreset = view === 'today'
    ? 'today'
    : view === 'exceptions'
      ? 'exceptions'
      : quick.includes('waiting_transfer')
        ? 'waiting'
      : advanced.stage === 'completed'
        ? 'completed'
        : 'all';

  function changeView(next: ViewKey): void {
    setTargetWorkOrderId('');
    setView(next);
    setQuick([]);
    setPage(1);
    setSelected([]);
  }

  function applyDispatchPreset(preset: DispatchPreset): void {
    setTargetWorkOrderId('');
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
    if (preset === 'waiting') setQuick(['waiting_transfer']);
    setAdvanced(preset === 'completed' ? { ...emptyAdvanced, stage: 'completed' } : emptyAdvanced);
  }

  function changeWeekScope(next: WeekScope, historyWeekStart?: string): void {
    setTargetWorkOrderId('');
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

  async function toggleFullscreen(): Promise<void> {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      setToast('浏览器未允许进入大屏模式');
    }
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

  function closeProcessCompletion(force = false): void {
    if (completionSaving && !force) return;
    completionRequestRef.current += 1;
    setCompletionOrder(null);
    setCompletionContext(null);
    setCompletionForm(null);
    setCompletionError('');
    setCompletionStepId('');
    setCompletionIdempotencyKey('');
    setCompletionLoading(false);
  }

  async function loadProcessCompletionContext(order: ProductionOrder, stepId: string): Promise<void> {
    const route = order.processRoute;
    const activeSteps = route?.currentSteps.length
      ? route.currentSteps
      : route?.currentStep
        ? [route.currentStep]
        : [];
    const step = activeSteps.find(item => item.id === stepId);
    if (!route || !step) {
      setCompletionError('所选工序已不在执行中，请刷新调度中心后重试');
      return;
    }
    const requestId = completionRequestRef.current + 1;
    completionRequestRef.current = requestId;
    const previousForm = completionForm;
    const workDate = previousForm?.workDate || todayShanghaiDateKey();
    const defectDisposition = previousForm?.defectDisposition || 'rework';
    setCompletionStepId(step.id);
    setCompletionContext(null);
    setCompletionForm(null);
    setCompletionError('');
    setCompletionIdempotencyKey(globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`);
    setCompletionLoading(true);
    try {
      const params = new URLSearchParams({ stepId: step.id });
      const response = await fetch(`/api/process-management/routes/${route.id}/completions?${params.toString()}`, { cache: 'no-store' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body.data) throw new Error(body.error || '工序可完成数量加载失败');
      if (completionRequestRef.current !== requestId) return;
      const context = body.data as ProcessCompletionContext;
      const workWindow = defaultCompletionWorkWindow(context.step.startedAt);
      const previousEmployeeIds = previousForm?.employeeIds.filter(id => (
        context.employees.some(employee => employee.id === id)
      )) || [];
      const defaultEmployeeIds = previousEmployeeIds.length
        ? previousEmployeeIds
        : user.employeeId && context.employees.some(employee => employee.id === user.employeeId)
          ? [user.employeeId]
          : [];
      setCompletionContext(context);
      setCompletionForm({
        processedQty: context.remainingInputQty > 0 ? String(context.remainingInputQty) : '',
        defectQty: '0',
        defectDisposition,
        workDate,
        workStartedAt: previousForm?.workStartedAt || workWindow.workStartedAt,
        workEndedAt: previousForm?.workEndedAt || workWindow.workEndedAt,
        employeeIds: defaultEmployeeIds,
        team: previousForm?.team || user.employee?.team || '',
        workstation: previousForm?.workstation || '',
        remark: previousForm?.remark || '',
      });
    } catch (reason) {
      if (completionRequestRef.current !== requestId) return;
      setCompletionError(reason instanceof Error ? reason.message : '工序可完成数量加载失败');
    } finally {
      if (completionRequestRef.current === requestId) setCompletionLoading(false);
    }
  }

  async function openProcessCompletion(order: ProductionOrder): Promise<void> {
    const route = order.processRoute;
    const step = route?.currentSteps[0] || route?.currentStep;
    if (!route || !step) {
      setToast('当前没有可完成的执行工序，请先检查工艺路线');
      return;
    }
    setCompletionOrder(order);
    await loadProcessCompletionContext(order, step.id);
  }

  async function saveProcessCompletion(): Promise<void> {
    if (!completionOrder || !completionContext || !completionForm) return;
    const processedText = completionForm.processedQty.trim();
    const defectText = completionForm.defectQty.trim();
    if (!/^[1-9]\d*$/.test(processedText)) {
      setCompletionError('本次实际处理数量必须是正整数');
      return;
    }
    if (!/^\d+$/.test(defectText)) {
      setCompletionError('不良品数量必须是大于或等于 0 的整数');
      return;
    }
    const processedQty = Number(processedText);
    const defectQty = Number(defectText);
    if (processedQty > completionContext.remainingInputQty) {
      setCompletionError(`本次数量不能超过当前可处理数量 ${formatProductionQuantity(completionContext.remainingInputQty)}`);
      return;
    }
    if (defectQty > processedQty) {
      setCompletionError('不良品数量不能超过本次实际处理数量');
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(completionForm.workDate)) {
      setCompletionError('请选择正确的生产归属日期');
      return;
    }
    if (!completionForm.employeeIds.length) {
      setCompletionError('请选择至少一名本次作业员工');
      return;
    }
    if (!completionForm.workStartedAt || !completionForm.workEndedAt) {
      setCompletionError('请填写作业开始时间和结束时间');
      return;
    }
    const workStartedAt = new Date(completionForm.workStartedAt);
    const workEndedAt = new Date(completionForm.workEndedAt);
    const workDuration = workEndedAt.getTime() - workStartedAt.getTime();
    if (Number.isNaN(workDuration) || workDuration <= 0) {
      setCompletionError('作业结束时间必须晚于开始时间');
      return;
    }
    if (workDuration > 72 * 60 * 60 * 1000) {
      setCompletionError('单次作业时间不能超过 72 小时');
      return;
    }

    setCompletionSaving(true);
    setCompletionError('');
    try {
      const response = await fetch(`/api/process-management/routes/${completionContext.routeId}/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stepId: completionContext.step.id,
          processedQty,
          defectQty,
          defectDisposition: defectQty > 0 ? completionForm.defectDisposition : undefined,
          workDate: completionForm.workDate,
          workStartedAt: workStartedAt.toISOString(),
          workEndedAt: workEndedAt.toISOString(),
          employeeIds: completionForm.employeeIds,
          team: completionForm.team,
          workstation: completionForm.workstation,
          remark: completionForm.remark,
          idempotencyKey: completionIdempotencyKey,
          expectedRouteVersion: completionContext.routeVersion,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body.data) throw new Error(body.error || '工序完成转序失败');
      const goodQty = processedQty - defectQty;
      const goodTransferredQty = Math.max(
        0,
        Number.isSafeInteger(Number(body.data.goodTransferredQty))
          ? Number(body.data.goodTransferredQty)
          : 0,
      );
      const goodWaitingForGroupQty = Math.max(0, goodQty - goodTransferredQty);
      const branchMessage = body.data.branchWorkOrderId
        ? `，不良品分支 ${body.data.branchWorkOrderCode || '工单'} 已建立`
        : '';
      const completedStep = completionOrder.processRoute?.steps.find(
        step => step.id === completionContext.step.id,
      ) || completionOrder.processRoute?.currentStep;
      const laborMessage = body.data.laborPoolPendingStandard
        ? '，工时已记入待补标准清单'
        : body.data.laborPoolId
        ? '，工时已进入待领取池'
        : completedStep?.timeBasis === 'per_batch'
          ? '，本批工时将在上下游闭环后自动进入待领取池'
          : !completedStep?.standardMillisecondsPerUnit
            ? '，未生成工时池，请维护该工序标准工时'
            : '，本次未生成待领取工时';
      const unitLabel = completedStep?.unitLabel || '件';
      const transferMessage = goodTransferredQty > 0
        ? `${formatProductionQuantity(goodTransferredQty)} ${unitLabel}良品已流转${goodWaitingForGroupQty > 0 ? `，${formatProductionQuantity(goodWaitingForGroupQty)} ${unitLabel}等待同组工序齐套` : ''}`
        : goodQty > 0
          ? `${formatProductionQuantity(goodQty)} ${unitLabel}良品已登记，等待同组工序齐套后转序`
          : '本批没有良品可流转';
      setToast(`${transferMessage}${laborMessage}${branchMessage}`);
      closeProcessCompletion(true);
      productionBoardCache.clear();
      setRefreshToken(value => value + 1);
      setSummaryRefreshToken(value => value + 1);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : '工序完成转序失败';
      setCompletionError(message);
      if (message.includes('已被其他操作更新') || message.includes('版本')) {
        productionBoardCache.clear();
        setRefreshToken(value => value + 1);
        setSummaryRefreshToken(value => value + 1);
      }
    } finally {
      setCompletionSaving(false);
    }
  }

  function openNextStep(order: ProductionOrder, displayStage: StageKey): void {
    if (board?.readOnly) {
      setToast('下周预览为只读，启用为本周后才能流转工单');
      return;
    }
    setStatusMenuOrder(null);
    setDrawingMenuOrder(null);
    if (!order.processRoute || order.processRoute.status === 'draft') {
      if (!canAdministerProduction) {
        setToast('当前产品工序与工时尚未发布，请联系管理员维护');
        return;
      }
      if (!order.drawingLibraryItemId) {
        setToast('当前工单尚未关联图纸产品，无法匹配产品工序与工时');
        return;
      }
      router.push(`/workspace/product-times?itemId=${encodeURIComponent(order.drawingLibraryItemId)}`);
      return;
    }
    if (order.processRoute.status === 'completed') return;
    if (displayStage === 'not_issued') {
      if (!canAdministerProduction) {
        setToast('图纸需由管理员确认下发后才能开始生产');
        return;
      }
      setNextStepRequest({ order, displayStage, action: 'confirm_drawing_issued' });
      setNextStepError('');
      return;
    }
    if (!order.processRoute.currentSteps.length && !order.processRoute.currentStep) {
      setToast('当前执行工序状态异常，请联系管理员核对工单路线；已开工路线不会被新产品版本覆盖');
      return;
    }
    void openProcessCompletion(order);
  }

  async function saveNextStep(): Promise<void> {
    if (!nextStepRequest) return;
    const { order, action } = nextStepRequest;

    setSaving(true);
    setNextStepError('');
    try {
      const response = await fetch(`/api/work-orders/${order.id}/execution`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          expectedVersion: order.quantityFlow.executionVersion,
        }),
      });
      const body = await response.json().catch(() => ({}));
      const responseOrder = body.data;
      if (!response.ok || !responseOrder) throw new Error(body.error || '生产工序流转失败');
      const updated = withProductionDerived(responseOrder as ProductionOrder);
      applyLocalOrder(updated);
      setNextStepRequest(null);
      productionBoardCache.clear();
      setSummaryRefreshToken(value => value + 1);
      setToast('图纸已确认下发，工单已进入首道工序');
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
    const params = executionParams(view, debouncedKeyword, quick, advanced, scope, weekStart, page, targetWorkOrderId, dispatchPageSize);
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
      pageSize: dispatchPageSize,
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
    setBatchOperation(operation); setBatchValue(''); setBatchRemark(''); setFormError(''); setBatchOpen(true);
  }

  async function saveBatch(): Promise<void> {
    if (!selected.length) return;
    setSaving(true);
    setFormError('');
    try {
      const response = await fetch('/api/work-orders/batch-execution', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: selected, operation: batchOperation, value: batchValue, remark: batchRemark }),
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
    const params = executionParams(view, debouncedKeyword, quick, advanced, scope, weekStart, 1, targetWorkOrderId);
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
        hideHeader
        sidebarTriggerTargetId="production-dispatch-sidebar-trigger"
        menuItems={[
          ...(canAdministerProduction ? [{ label: '系统设置', href: '/dashboard?openSettings=1' }] : []),
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
            {canAdministerProduction && <a className="hm-workbench-button" href={weeklyPlanHref}><CalendarDays size={15} aria-hidden="true" />周计划</a>}
            {canAdministerProduction && <button className={`hm-workbench-button ${batchMode ? 'active' : ''}`.trim()} type="button" disabled={board?.readOnly} title={board?.readOnly ? '下周预览不可批量修改' : ''} onClick={toggleBatchMode}><ListChecks size={15} aria-hidden="true" />{batchMode ? '退出批量' : '批量'}</button>}
            <button className="hm-workbench-button" type="button" onClick={exportCsv}><Download size={15} aria-hidden="true" />导出</button>
            <button ref={insightsButtonRef} className={`hm-workbench-button production-insight-trigger ${insightsOpen ? 'active' : ''}`.trim()} type="button" aria-expanded={insightsOpen} aria-controls="production-insight-panel" onClick={() => setInsightsOpen(value => !value)}>{insightsOpen ? <PanelRightClose size={15} aria-hidden="true" /> : <PanelRightOpen size={15} aria-hidden="true" />}调度侧栏</button>
            <button className="hm-workbench-button production-fullscreen-trigger" type="button" onClick={() => void toggleFullscreen()}><Expand size={15} aria-hidden="true" />{isFullscreen ? '退出大屏' : '大屏模式'}</button>
          </div>
        </section>

        <section className="production-dispatch-metrics" aria-label="生产调度指标">
          <button type="button" className={dispatchPreset === 'all' ? 'active' : ''} onClick={() => applyDispatchPreset('all')}><span><CheckCircle2 size={18} aria-hidden="true" />生产中</span><strong>{dispatchMetric.inProduction}</strong><small>{weekScopeTitle} · {summary?.total || 0} 单</small></button>
          <button type="button" className={dispatchPreset === 'waiting' ? 'active waiting' : 'waiting'} onClick={() => applyDispatchPreset('waiting')}><span><ArrowRight size={18} aria-hidden="true" />待转序</span><strong>{dispatchMetric.waitingTransfer}</strong><small>已有下一工序待衔接</small></button>
          <button type="button" className={dispatchPreset === 'exceptions' ? 'active warning' : 'warning'} onClick={() => applyDispatchPreset('exceptions')}><span><Clock3 size={18} aria-hidden="true" />即将超时</span><strong>{dispatchMetric.dueSoon}</strong><small>交期在未来 0-2 天</small></button>
          <button type="button" className={dispatchPreset === 'completed' ? 'active completed' : 'completed'} onClick={() => applyDispatchPreset('completed')}><span><CheckCircle2 size={18} aria-hidden="true" />已完成</span><strong>{dispatchMetric.completed}</strong><small>当前周完成归档</small></button>
          <div className="production-dispatch-metric-rate"><span><BarChart3 size={18} aria-hidden="true" />数量达成率</span><strong>{formatProductionPercentage(dispatchMetric.percentage)}</strong><small>按已完成数量统计</small></div>
        </section>

        <section className="production-dispatch-toolbar" aria-label="生产调度筛选">
          <label className="production-dispatch-search"><Search size={18} aria-hidden="true" /><input value={keyword} onChange={event => { setTargetWorkOrderId(''); setKeyword(event.target.value); }} placeholder="搜索客户、型号、工单或品名" /></label>
          <div className="production-dispatch-presets" aria-label="调度视图">
            <button className={dispatchPreset === 'all' ? 'active' : ''} type="button" aria-pressed={dispatchPreset === 'all'} onClick={() => applyDispatchPreset('all')}>全部</button>
            <button className={dispatchPreset === 'today' ? 'active' : ''} type="button" aria-pressed={dispatchPreset === 'today'} onClick={() => applyDispatchPreset('today')}>今日交付</button>
            <button className={dispatchPreset === 'waiting' ? 'active' : ''} type="button" aria-pressed={dispatchPreset === 'waiting'} onClick={() => applyDispatchPreset('waiting')}>待转序</button>
            <button className={dispatchPreset === 'exceptions' ? 'active' : ''} type="button" aria-pressed={dispatchPreset === 'exceptions'} onClick={() => applyDispatchPreset('exceptions')}>异常</button>
            <button className={dispatchPreset === 'completed' ? 'active' : ''} type="button" aria-pressed={dispatchPreset === 'completed'} onClick={() => applyDispatchPreset('completed')}>已完成</button>
          </div>
          <button ref={filterButtonRef} className={`production-dispatch-filter ${filtersOpen || activeFilterCount ? 'active' : ''}`.trim()} type="button" aria-expanded={filtersOpen} onClick={() => { setDraftAdvanced(cloneAdvanced(advanced)); setFiltersOpen(value => !value); }}>更多筛选{activeFilterCount ? ` ${activeFilterCount}` : ''}</button>
          <PortalMenu open={filtersOpen} anchorRef={filterButtonRef} align="right" className="production-filter-menu hm-production-menu hm-production-filter-menu" width={420} onClose={() => setFiltersOpen(false)} closeOnSelect={false}>
            <AdvancedFilterPanel customers={board?.filterOptions.customers || []} value={draftAdvanced} setValue={setDraftAdvanced} clear={() => setDraftAdvanced(emptyAdvanced)} apply={() => { setAdvanced(cloneAdvanced(draftAdvanced)); setFiltersOpen(false); setPage(1); }} />
          </PortalMenu>
          <button className={`production-auto-refresh ${autoRefresh ? 'active' : ''}`} type="button" aria-pressed={autoRefresh} title="每 30 秒自动刷新" onClick={() => setAutoRefresh(value => !value)}><RefreshCw size={15} aria-hidden="true" />自动刷新 <span>30 秒</span></button>
          {lastRefreshedAt && <span className="production-refresh-status" aria-live="polite">更新 {new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(lastRefreshedAt)}</span>}
          <div className="production-density-control" aria-label="列表密度">
            <button className={density === 'comfortable' ? 'active' : ''} type="button" aria-label="舒适列表" title="舒适列表" onClick={() => { setDensity('comfortable'); setPage(1); }}><Rows3 size={16} aria-hidden="true" /></button>
            <button className={density === 'compact' ? 'active' : ''} type="button" aria-label="紧凑列表" title="紧凑列表" onClick={() => { setDensity('compact'); setPage(1); }}><ListChecks size={16} aria-hidden="true" /></button>
          </div>
          <span className="production-dispatch-result">{board?.pagination.total || 0} 项</span>
        </section>
        {!!filterChips.length && <div className="production-filter-chips production-dispatch-filter-chips" aria-label="已应用筛选">{filterChips.map(chip => <button key={chip.key} type="button" onClick={() => { chip.remove(); setPage(1); }} title={`移除${chip.label}`}>{chip.label}<span>×</span></button>)}<button className="clear" type="button" onClick={() => { setTargetWorkOrderId(''); setAdvanced(emptyAdvanced); setQuick([]); setKeyword(''); setPage(1); }}>清空全部</button></div>}

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
                canAdministerProduction={canAdministerProduction}
                batchMode={batchMode}
                selected={selected}
                saving={saving}
                toggleSelected={toggleSelected}
                openDetail={openDetail}
                openNextStep={openNextStep}
                openDrawingLibrary={openDrawingLibrary}
                openWorkflow={openWorkflow}
                openIssue={openProductionIssue}
                copySpecification={copySpecification}
              />)}
              {loading && <DispatchRowSkeleton count={dispatchPageSize} />}
              {!loading && !board?.items.length && <div className="production-dispatch-empty"><Rows3 size={28} aria-hidden="true" /><strong>当前没有匹配工单</strong><span>调整周范围或筛选条件后重试。</span></div>}
            </div>
            {board && dispatchAllItems.length > 0 && <div className="production-pagination production-dispatch-pagination">
              <span>共 {dispatchAllItems.length} 单</span>
              <label>
                <span>显示范围</span>
                <select aria-label="选择显示范围" value={page} onChange={event => setPage(Number(event.target.value))}>
                  {Array.from({ length: dispatchTotalPages }, (_, index) => {
                    const optionPage = index + 1;
                    const start = index * dispatchPageSize + 1;
                    const end = Math.min(dispatchAllItems.length, optionPage * dispatchPageSize);
                    return <option value={optionPage} key={optionPage}>{start}–{end}</option>;
                  })}
                </select>
              </label>
              <label>
                <span>每屏</span>
                <select aria-label="选择每屏工单数" value={dispatchPageSize} onChange={event => {
                  setDispatchPageSize(Number(event.target.value));
                  setPage(1);
                }}>
                  <option value={8}>8 单</option>
                  <option value={12}>12 单</option>
                  <option value={16}>16 单</option>
                </select>
              </label>
            </div>}
          </section>

          {insightsOpen && <button className="production-dispatch-scrim" type="button" aria-label="关闭调度侧栏" onClick={closeInsights} />}
          <aside ref={insightsPanelRef} id="production-insight-panel" className={`production-dispatch-rail ${insightsOpen ? 'open' : ''}`} aria-label="生产调度侧栏" aria-hidden={!insightsOpen} tabIndex={-1}>
            <header><div><span>实时协同</span><strong>调度建议</strong></div><button ref={insightsCloseRef} type="button" aria-label="关闭调度侧栏" title="关闭调度侧栏" onClick={closeInsights}><X size={18} aria-hidden="true" /></button></header>
            <section className="production-dispatch-rail-section production-dispatch-alerts" aria-label="待处理异常">
              <div className="production-dispatch-rail-title"><strong><AlertTriangle size={15} aria-hidden="true" />待处理异常</strong><button type="button" onClick={() => applyDispatchPreset('exceptions')}>查看全部</button></div>
              <div className="production-dispatch-alert-summary"><AlertTriangle size={20} aria-hidden="true" /><b>{dispatchAlertItems.length}</b><span>项需要处理</span></div>
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
                const order = board?.items.find(item => item.id === activity.orderId);
                if (order) openWorkflow(order, order.stage);
              }}><i /><span><b title={activity.specification}>{activity.specification}</b><small>{activity.content}</small><em>{activity.actor} · {dateTimeText(activity.createdAt)}</em></span></button>)}
              {!dispatchActivities.length && <p>暂无流程动态</p>}
            </section>
          </aside>
        </div>
      </div>

      {canAdministerProduction && batchMode && !board?.readOnly && <div className="production-batch-bar"><strong>已选 {selected.length} 单</strong><button type="button" disabled={!selected.length} onClick={() => openBatch('set_priority')}>设置优先级</button><button type="button" disabled={!selected.length} onClick={() => openBatch('add_remark')}>添加进度备注</button><button type="button" onClick={() => setSelected([])}>清空选择</button><button type="button" onClick={toggleBatchMode}>退出批量</button></div>}

      <PortalMenu open={canAdministerProduction && !!statusMenuOrder} anchorRef={statusButtonRef} className="production-status-menu hm-production-menu hm-production-status-menu" width={164} onClose={() => setStatusMenuOrder(null)} closeOnSelect={false}>
        {statusMenuOrder && stageMenuItems(statusMenuOrder).map(stage => <button type="button" disabled={saving} key={stage.key} onClick={() => requestStageChange(statusMenuOrder, stage.key)}>{stage.label}</button>)}
      </PortalMenu>

      <PortalMenu open={canAdministerProduction && !!drawingMenuOrder} anchorRef={drawingButtonRef} className="production-status-menu hm-production-menu hm-production-status-menu" width={184} onClose={() => setDrawingMenuOrder(null)} closeOnSelect={false}>
        {drawingMenuOrder && drawingStatuses.map(status => <button className={drawingMenuOrder.drawingStatus === status ? 'active' : ''} type="button" disabled={saving} key={status} onClick={() => void saveDrawingStatus(drawingMenuOrder, status)}>{status}</button>)}
      </PortalMenu>

      {detailOrder && <DetailDialog order={detailOrder} tab={detailTab} setTab={switchDetailTab} progressLogs={progressLogs} progressLoading={progressLoading} close={() => setDetailOrder(null)} resources={() => openWorkOrderResources(detailOrder)} drawingLibrary={() => openDrawingLibrary(detailOrder, detailOrder.stage)} />}
      {canAdministerProduction && batchOpen && <BatchDialog count={selected.length} operation={batchOperation} value={batchValue} remark={batchRemark} saving={saving} error={formError} setValue={setBatchValue} setRemark={setBatchRemark} close={() => { if (!saving) setBatchOpen(false); }} save={saveBatch} />}
      {canAdministerProduction && stageChangeRequest && <StageChangeDialog request={stageChangeRequest} saving={saving} close={() => { if (!saving) setStageChangeRequest(null); }} confirm={() => void saveStageChange(stageChangeRequest.order, stageChangeRequest.stage)} />}
      {canAdministerProduction && nextStepRequest && <NextStepDialog
        request={nextStepRequest}
        saving={saving}
        error={nextStepError}
        close={() => {
          if (!saving) {
            setNextStepRequest(null);
            setNextStepError('');
          }
        }}
        confirm={() => void saveNextStep()}
      />}
      {completionOrder && <ProcessCompletionDrawer
        order={completionOrder}
        activeSteps={completionOrder.processRoute?.currentSteps.length
          ? completionOrder.processRoute.currentSteps
          : completionOrder.processRoute?.currentStep
            ? [completionOrder.processRoute.currentStep]
            : []}
        selectedStepId={completionStepId}
        selectStep={stepId => void loadProcessCompletionContext(completionOrder, stepId)}
        context={completionContext}
        value={completionForm}
        setValue={setCompletionForm}
        loading={completionLoading}
        saving={completionSaving}
        error={completionError}
        close={() => closeProcessCompletion()}
        save={() => void saveProcessCompletion()}
      />}
    </main>
  );
}

type ProductionDispatchRowProps = {
  item: ProductionCardView;
  readOnly: boolean;
  canAdministerProduction: boolean;
  batchMode: boolean;
  selected: string[];
  saving: boolean;
  toggleSelected: (id: string) => void;
  openDetail: (order: ProductionOrder) => void;
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
  canAdministerProduction,
  batchMode,
  selected,
  saving,
  toggleSelected,
  openDetail,
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
  const lifecycle = resolveProductionLifecycle({
    routeCompleted: route?.status === 'completed',
    workOrderCompletedAt: order.completedAt,
  });
  const currentProcess = lifecycle.awaitingBranchClosure ? '主路线完成' : currentProcessName(order);
  const nextProcess = nextProcessName(order);
  const upcomingSteps = nextRouteSteps(order);
  const routeProgress = route?.progress ?? 0;
  const unitLabel = route?.currentStep?.unitLabel || route?.steps[0]?.unitLabel || '件';
  const routeNeedsMaintenance = !route || route.status === 'draft';
  const primaryText = readOnly
    ? '查看记录'
    : lifecycle.aggregateCompleted
      ? '查看记录'
      : lifecycle.awaitingBranchClosure
        ? '查看分支'
        : '下一步';

  function runPrimaryAction(): void {
    const action = resolveProductionPrimaryAction({
      readOnly,
      aggregateCompleted: lifecycle.aggregateCompleted,
      awaitingBranchClosure: lifecycle.awaitingBranchClosure,
      canAdministerProduction,
      routeNeedsMaintenance,
      drawingNotIssued: displayStage === 'not_issued',
    });
    if (action === 'view_detail') {
      openDetail(order);
      return;
    }
    if (action === 'view_workflow') {
      openWorkflow(order, displayStage);
      return;
    }
    openNextStep(order, displayStage);
  }

  return <article className={`production-dispatch-row stage-${displayStage} risk-${risk.tone} ${selectedRow ? 'selected' : ''}`.trim()} data-production-order-id={order.id} data-production-stage={displayStage}>
    <div className="production-dispatch-row-identity">
      <div className="production-dispatch-row-select">
        {canAdministerProduction && batchMode && !readOnly
          ? <input type="checkbox" checked={selectedRow} aria-label={`选择 ${specText(order)}`} onChange={() => toggleSelected(order.id)} />
          : <span className="production-dispatch-stage-dot" aria-hidden="true" />}
      </div>
      <div className="production-dispatch-product">
        <span><b title={order.customerName || '客户待补充'}>{order.customerName || '客户待补充'}</b>{order.branchType ? <em className="branch">{branchTypeText(order.branchType)}</em> : <em className={order.priority}>{priorityText(order.priority)}</em>}</span>
        <button type="button" title={`${specText(order)}；进入图纸资料库`} onClick={() => openDrawingLibrary(order, displayStage)}>{specText(order)}</button>
        <small title={`${order.productName || '品名待补充'} · ${order.code}`}>{order.productName || '品名待补充'} · {order.code}{order.parentWorkOrder ? ` · 主单 ${order.parentWorkOrder.code}` : ''}</small>
        <div className="production-dispatch-product-quantity"><span>数量</span><b>{targetQuantity > 0 ? formatProductionQuantity(targetQuantity) : '待补充'} {unitLabel}</b></div>
      </div>
      <div className="production-dispatch-row-icon-actions">
        <button type="button" aria-label={`复制 ${specText(order)} 规格`} title="复制完整规格" onClick={() => void copySpecification(order)}><Copy size={14} aria-hidden="true" /></button>
        <button type="button" aria-label={`查看 ${specText(order)} 详情`} title="查看工单详情" onClick={() => openDetail(order)}><Info size={14} aria-hidden="true" /></button>
      </div>
    </div>

    <button className="production-dispatch-process current" type="button" title="进入流程中心查看当前工序" onClick={() => openWorkflow(order, displayStage)}>
      <span><b>{routeNeedsMaintenance ? '工序待维护' : currentProcess}</b><small>{lifecycle.awaitingBranchClosure ? '等待返工/补产分支闭环' : route?.statusText || order.stageText}</small></span>
      <i><span style={{ width: `${routeProgress}%` }} /></i>
      <em>{route ? `${route.completedStepCount}/${route.stepCount}` : '未建路线'}</em>
    </button>

    <button className="production-dispatch-process next" type="button" title="进入流程中心查看下一工序" onClick={() => openWorkflow(order, displayStage)}>
      <ArrowRight size={16} aria-hidden="true" />
      <span><b>{nextProcess}</b><small>{upcomingSteps.length
        ? `${upcomingSteps.length} 道待衔接`
        : routeNeedsMaintenance
          ? '等待工序发布'
          : lifecycle.aggregateCompleted
            ? '生产已结束'
            : lifecycle.awaitingBranchClosure
              ? '等待分支闭环'
              : route?.currentStep
                ? '当前为末道工序'
                : '等待当前工序开始'}</small></span>
    </button>

    <div className="production-dispatch-progress" title="工单累计完成进度">
      <span><b>{formatProductionPercentage(quantityPercentage)}</b><small>{formatProductionQuantity(completedQuantity)} / {targetQuantity > 0 ? formatProductionQuantity(targetQuantity) : '待补充'}</small></span>
      <i><span style={{ width: `${progressPercentage}%` }} /></i>
      <em>本阶段 {stageQuantity === null ? '待补充' : formatProductionQuantity(stageQuantity)}</em>
    </div>

    <div className={`production-dispatch-risk ${risk.tone}`}>
      <strong>{deliveryText(order) || '交期待补'}</strong>
      {risk.alert
        ? <button type="button" title="进入问题管理处理该异常" onClick={() => openIssue(order, risk.alert!.code, displayStage)}>{risk.label}</button>
        : <span>{risk.label}</span>}
      <small>{risk.detail}</small>
    </div>

    <div className="production-dispatch-row-actions">
      <button className="primary" type="button" disabled={saving} onClick={runPrimaryAction}>{primaryText}</button>
    </div>
  </article>;
}

function ProcessCompletionDrawer({ order, activeSteps, selectedStepId, selectStep, context, value, setValue, loading, saving, error, close, save }: {
  order: ProductionOrder;
  activeSteps: WorkOrderProcessRouteDTO['currentSteps'];
  selectedStepId: string;
  selectStep: (stepId: string) => void;
  context: ProcessCompletionContext | null;
  value: ProcessCompletionForm | null;
  setValue: (value: ProcessCompletionForm) => void;
  loading: boolean;
  saving: boolean;
  error: string;
  close: () => void;
  save: () => void;
}) {
  const processedQty = value && /^\d+$/.test(value.processedQty.trim()) ? Number(value.processedQty) : 0;
  const defectQty = value && /^\d+$/.test(value.defectQty.trim()) ? Number(value.defectQty) : 0;
  const goodQty = Math.max(0, processedQty - defectQty);
  const stepSnapshot = order.processRoute?.steps.find(step => step.id === context?.step.id) || order.processRoute?.currentStep;
  const unitLabel = stepSnapshot?.unitLabel || '件';
  const standardMillisecondsPerUnit = stepSnapshot?.standardMillisecondsPerUnit || 0;
  const setupMilliseconds = stepSnapshot?.setupMilliseconds || 0;
  const unitsPerProduct = stepSnapshot?.unitsPerProduct || 1;
  const isPerBatch = stepSnapshot?.timeBasis === 'per_batch';
  const laborEligibleQty = isPerBatch
    ? (context && processedQty === context.remainingInputQty ? context.goodQty + goodQty : 0)
    : goodQty;
  const appliedSetupMilliseconds = isPerBatch || (context?.goodQty || 0) === 0
    ? setupMilliseconds
    : 0;
  const standardLaborMilliseconds = laborEligibleQty <= 0 || standardMillisecondsPerUnit <= 0
    ? 0
    : appliedSetupMilliseconds + (isPerBatch
        ? standardMillisecondsPerUnit
        : standardMillisecondsPerUnit * laborEligibleQty * unitsPerProduct);
  const laborPreviewTitle = standardMillisecondsPerUnit <= 0
    ? '生成待补标准工时池，完成数量不会丢失'
    : isPerBatch
      ? laborEligibleQty > 0
        ? `上下游与本批闭环后生成 ${formatProductionQuantity(laborEligibleQty)} ${unitLabel}待领取工时`
        : '整批工时将在上下游与本批闭环后生成'
      : laborEligibleQty > 0
        ? `生成 ${formatProductionQuantity(laborEligibleQty)} ${unitLabel}待领取工时`
        : '本次不生成正常工时池';
  const nextProcessText = context?.nextSteps.length
    ? context.nextSteps.map(step => step.processName).join(' / ')
    : '成品入库';
  const selectedStep = activeSteps.find(step => step.id === selectedStepId)
    || activeSteps[0]
    || order.processRoute?.currentStep;
  const completionTitle = context
    ? `完成 ${context.step.processName} → ${nextProcessText}`
    : selectedStep
      ? `完成 ${selectedStep.processName}`
      : '完成当前工序';
  const submitText = context?.nextSteps.length
    ? `确认完成并进入 ${nextProcessText}`
    : '确认完成生产';
  const waitsForParallelGroup = !!context
    && (order.processRoute?.steps.filter(step => step.sequenceGroup === context.step.sequenceGroup).length || 0) > 1;
  const goodDestinationHint = waitsForParallelGroup
    ? `同组齐套后进入 ${nextProcessText}`
    : `立即进入 ${nextProcessText}`;
  const workStartedAt = value?.workStartedAt ? new Date(value.workStartedAt) : null;
  const workEndedAt = value?.workEndedAt ? new Date(value.workEndedAt) : null;
  const workDuration = workStartedAt && workEndedAt
    ? workEndedAt.getTime() - workStartedAt.getTime()
    : 0;
  const workRangeValid = workDuration > 0 && workDuration <= 72 * 60 * 60 * 1000;
  const invalid = !value
    || processedQty <= 0
    || defectQty < 0
    || defectQty > processedQty
    || !context
    || processedQty > context.remainingInputQty
    || !value.employeeIds.length
    || !workRangeValid;

  return <div className="production-update-backdrop process-completion-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}>
    <aside className="production-update-drawer process-completion-drawer" role="dialog" aria-modal="true" aria-labelledby="process-completion-title">
      <div className="dialog-title">
        <div><strong id="process-completion-title">{completionTitle}</strong><small>{order.customerName || '客户待补充'} · {specText(order)} · {order.code}</small></div>
        <button type="button" disabled={saving} aria-label="关闭转序抽屉" onClick={close}>×</button>
      </div>

      {activeSteps.length > 1 && <section className="process-completion-step-picker" aria-label="选择本次完成工序">
        <label htmlFor="process-completion-step">
          <span>本次完成工序</span>
          <select id="process-completion-step" value={selectedStepId} disabled={saving} aria-busy={loading} onChange={event => selectStep(event.target.value)}>
            {activeSteps.map(step => {
              const remainingQty = Math.max(0, (step.inputQty || 0) - (step.processedQty || 0));
              const quantityHint = step.inputQty === undefined ? '' : ` · 剩余 ${formatProductionQuantity(remainingQty)} ${step.unitLabel || '件'}`;
              return <option value={step.id} key={step.id}>第 {step.sequenceGroup} 组 · {step.processName}{quantityHint}</option>;
            })}
          </select>
          <small>存在并行工序或已释放的下游在制品，请先确认本次实际完成哪一道工序。</small>
        </label>
      </section>}

      {loading && <div className="process-completion-loading"><RefreshCw size={18} aria-hidden="true" /><span>正在核对工序数量与历史流转...</span></div>}
      {!loading && error && !context && <section className="process-completion-blocked" role="alert">
        <AlertTriangle size={22} aria-hidden="true" />
        <div><strong>当前工序暂不能流转</strong><p>{error}</p><small>系统不会修改生产目标，也不会跳过已发布工艺路线。请核对工艺路线或计划来源后重试。</small></div>
      </section>}

      {context && value && <>
        <section className="process-completion-route" aria-label="本次工序流转">
          <div><span>当前工序</span><strong>{context.step.processName}</strong><small>第 {context.step.sequenceGroup} 顺序组</small></div>
          <ArrowRight size={22} aria-hidden="true" />
          <div><span>良品进入</span><strong>{nextProcessText}</strong><small>{context.nextSteps.length > 1 ? `${context.nextSteps.length} 道并行工序` : context.nextSteps.length ? '下一道工序' : '末道工序完成'}</small></div>
        </section>

        <section className="process-completion-quantity-summary" aria-label="当前工序数量">
          <div><span>可投入数量</span><strong>{formatProductionQuantity(context.availableInputQty)}</strong></div>
          <div><span>累计已处理</span><strong>{formatProductionQuantity(context.processedQty)}</strong></div>
          <div><span>本次前剩余</span><strong>{formatProductionQuantity(context.remainingInputQty)}</strong></div>
        </section>

        <section className="process-completion-form">
          <label>
            <span>本次实际处理数量</span>
            <input autoFocus inputMode="numeric" pattern="[0-9]*" min="1" max={context.remainingInputQty} step="1" value={value.processedQty} disabled={saving} onChange={event => setValue({ ...value, processedQty: event.target.value })} />
            <small>不能超过当前可处理数量 {formatProductionQuantity(context.remainingInputQty)} {unitLabel}</small>
          </label>
          <label>
            <span>不良品数量</span>
            <input inputMode="numeric" pattern="[0-9]*" min="0" max={processedQty || context.remainingInputQty} step="1" value={value.defectQty} disabled={saving} onChange={event => setValue({ ...value, defectQty: event.target.value })} />
            <small>良品将自动按“处理数 − 不良数”计算</small>
          </label>
          <label>
            <span>生产归属日期</span>
            <input type="date" value={value.workDate} disabled={saving} onChange={event => setValue({ ...value, workDate: event.target.value })} />
            <small>员工稍后领取时仍归属这个生产日期</small>
          </label>
          <div className="process-completion-good" aria-live="polite"><span>本次良品</span><strong>{formatProductionQuantity(goodQty)} {unitLabel}</strong><small>{goodDestinationHint}</small></div>
        </section>

        <section className="process-completion-work-session" aria-label="本次现场作业记录">
          <header>
            <div><strong>现场作业记录</strong><small>用于追溯并在手动报工中推荐领取人，不会自动记入员工工时</small></div>
            <span>{value.employeeIds.length} 人</span>
          </header>
          <fieldset>
            <legend>本次作业员工（必选，可多选）</legend>
            <div className="process-completion-employee-list">
              {context.employees.map(employee => {
                const checked = value.employeeIds.includes(employee.id);
                return <label className={checked ? 'selected' : ''} key={employee.id}>
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={saving}
                    onChange={() => setValue({
                      ...value,
                      employeeIds: checked
                        ? value.employeeIds.filter(id => id !== employee.id)
                        : [...value.employeeIds, employee.id],
                    })}
                  />
                  <span><strong>{employee.name}</strong><small>{employee.employeeNo}{employee.team ? ` · ${employee.team}` : ''}</small></span>
                </label>;
              })}
            </div>
          </fieldset>
          <div className="process-completion-work-grid">
            <label><span>作业开始时间</span><input type="datetime-local" value={value.workStartedAt} disabled={saving} onChange={event => setValue({ ...value, workStartedAt: event.target.value })} /></label>
            <label><span>作业结束时间</span><input type="datetime-local" value={value.workEndedAt} disabled={saving} onChange={event => setValue({ ...value, workEndedAt: event.target.value })} /></label>
            <label><span>班组</span><input maxLength={80} value={value.team} disabled={saving} onChange={event => setValue({ ...value, team: event.target.value })} placeholder="例如：前端一组" /></label>
            <label><span>工位 / 设备</span><input maxLength={80} value={value.workstation} disabled={saving} onChange={event => setValue({ ...value, workstation: event.target.value })} placeholder="例如：裁线 C-03" /></label>
          </div>
          <label className="process-completion-work-remark"><span>现场备注（可选）</span><textarea rows={2} maxLength={500} value={value.remark} disabled={saving} onChange={event => setValue({ ...value, remark: event.target.value })} placeholder="记录换线、设备、交接或质量情况" /></label>
        </section>

        {defectQty > 0 && <fieldset className="process-completion-disposition">
          <legend>不良品后续处理</legend>
          <label className={value.defectDisposition === 'rework' ? 'selected' : ''}><input type="radio" name="defectDisposition" value="rework" checked={value.defectDisposition === 'rework'} disabled={saving} onChange={() => setValue({ ...value, defectDisposition: 'rework' })} /><span><strong>返工</strong><small>建立返工分支，从当前工序重新处理后回接主线。</small></span></label>
          {!order.parentWorkOrderId && <label className={value.defectDisposition === 'scrap_replenish' ? 'selected' : ''}><input type="radio" name="defectDisposition" value="scrap_replenish" checked={value.defectDisposition === 'scrap_replenish'} disabled={saving} onChange={() => setValue({ ...value, defectDisposition: 'scrap_replenish' })} /><span><strong>报废补产</strong><small>建立补产分支，从首道工序重新生产。</small></span></label>}
        </fieldset>}

        <section className="process-completion-preview" aria-label="提交结果预览">
          <header><strong>提交结果预览</strong><span>生产事实与员工领取分开记录</span></header>
          <div><CheckCircle2 size={18} aria-hidden="true" /><span><strong>{waitsForParallelGroup ? `${formatProductionQuantity(goodQty)} ${unitLabel}良品登记，按同组齐套量进入 ${nextProcessText}` : `${formatProductionQuantity(goodQty)} ${unitLabel}良品进入 ${nextProcessText}`}</strong><small>{goodQty > 0 ? (waitsForParallelGroup ? '提交后由系统返回本次实际转序数量；员工领取工时不影响生产放行' : '下一工序无需等待员工领取工时') : '本批没有可转序良品'}</small></span></div>
          <div><Clock3 size={18} aria-hidden="true" /><span><strong>{laborPreviewTitle}</strong><small>{standardLaborMilliseconds > 0 ? `标准工时快照约 ${durationText(standardLaborMilliseconds)}；是否即时入池以服务端闭环校验为准` : '生产可继续，班组长需在报表中心补录标准后才能分配'}</small></span></div>
          <div><Users size={18} aria-hidden="true" /><span><strong>{value.employeeIds.length ? context.employees.filter(employee => value.employeeIds.includes(employee.id)).map(employee => employee.name).join('、') : '尚未选择作业员工'}</strong><small>{workRangeValid ? `${dateTimeText(workStartedAt?.toISOString())} 至 ${dateTimeText(workEndedAt?.toISOString())}，仅作为报工推荐` : '请检查作业起止时间，单次不能超过 72 小时'}</small></span></div>
          {defectQty > 0 && <div className="defect"><AlertTriangle size={18} aria-hidden="true" /><span><strong>{formatProductionQuantity(defectQty)} {unitLabel}进入{defectDispositionText(value.defectDisposition)}</strong><small>分支完成后再形成对应工时，避免原工序重复计工。</small></span></div>}
        </section>

        {!!context.recentCompletions.length && <section className="process-completion-history">
          <header><strong>最近转序记录</strong><span>{context.recentCompletions.length} 条</span></header>
          {context.recentCompletions.slice(0, 4).map(item => <article key={item.id}>
            <time>{dateText(item.workDate)} · {dateTimeText(item.completedAt)}</time>
            <span>处理 {formatProductionQuantity(item.processedQty)} / 良品 {formatProductionQuantity(item.goodQty)} / 不良 {formatProductionQuantity(item.defectQty)}</span>
            <small>{item.participants.length ? `${item.participants.map(participant => participant.name).join('、')} · ${item.workStartedAt && item.workEndedAt ? `${dateTimeText(item.workStartedAt)}–${dateTimeText(item.workEndedAt)}` : '未记录时段'}` : item.branchWorkOrder ? `${item.branchWorkOrder.code} · ${defectDispositionText(item.defectDisposition)}` : '正常流转'}</small>
          </article>)}
        </section>}
      </>}

      {error && context && <div className="form-error" role="alert">{error}</div>}
      <div className="dialog-actions">
        <button type="button" disabled={saving} onClick={close}>取消</button>
        <button className="primary-button" type="button" disabled={loading || saving || invalid} onClick={save}>{saving ? '正在流转...' : submitText}</button>
      </div>
    </aside>
  </div>;
}


function NextStepDialog({ request, saving, error, close, confirm }: {
  request: NextStepRequest;
  saving: boolean;
  error: string;
  close: () => void;
  confirm: () => void;
}) {
  const { order } = request;
  const flow = order.quantityFlow;
  const title = '确认图纸已下发并进入首道工序';
  return <div className="modal-backdrop"><section className="production-dialog production-next-step-dialog" role="dialog" aria-modal="true" aria-label={title}>
    <div className="dialog-title"><div><strong>{title}</strong><small>{order.customerName || '客户待补充'} · {specText(order)}</small></div><button type="button" disabled={saving} onClick={close} aria-label="关闭">×</button></div>
    <div className="production-flow-summary" aria-label="当前生产数量">
      <div><span>总目标 T</span><strong>{formatProductionQuantity(flow.targetQty)}</strong></div>
      <div><span>前端剩余 T-F</span><strong>{formatProductionQuantity(flow.frontendRemainingQty)}</strong></div>
      <div><span>后端待完成 F-C</span><strong>{formatProductionQuantity(flow.backendRemainingQty)}</strong></div>
      <div><span>累计已完成 C</span><strong>{formatProductionQuantity(flow.completedQty)}</strong></div>
    </div>
    <p className="production-flow-confirm-copy">确认后，图纸状态将更新为“已发”，工单进入已发布工艺路线的首道工序；目标数量和已有资料不会改变。</p>
    {error && <div className="form-error" role="alert">{error}</div>}
    <div className="dialog-actions"><button type="button" disabled={saving} onClick={close}>取消</button><button className="primary-button" type="button" disabled={saving} onClick={confirm}>{saving ? '提交中...' : '确认下一步'}</button></div>
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

function DetailDialog({ order, tab, setTab, progressLogs, progressLoading, close, resources, drawingLibrary }: { order: ProductionOrder; tab: DetailTab; setTab: (tab: DetailTab) => void; progressLogs: ProgressLog[]; progressLoading: boolean; close: () => void; resources: () => void; drawingLibrary: () => void }) {
  return (
    <div className="modal-backdrop"><section className="production-dialog detail" role="dialog" aria-modal="true" aria-label="生产工单详情">
      <div className="dialog-title"><div><strong>{specText(order)}</strong><small>{order.customerName || '客户待补充'} · {order.productName || '品名待补充'}</small></div><button type="button" aria-label="关闭" onClick={close}>×</button></div>
      <div className="production-detail-tabs">{([['production', '生产信息'], ['drawing', '工单资料'], ['progress', '进度记录'], ['source', '来源信息']] as Array<[DetailTab, string]>).map(item => <button className={tab === item[0] ? 'active' : ''} type="button" key={item[0]} onClick={() => setTab(item[0])}>{item[1]}</button>)}</div>
      <div className="production-detail-body">
        {tab === 'production' && <><InfoGrid items={[
          ['状态', order.stageText], ['优先级', priorityText(order.priority)], ['周计划原始目标', order.importedTargetQty === null ? order.uncompletedQty || '-' : formatProductionQuantity(order.importedTargetQty)], ['当前生产目标', formatProductionQuantity(order.quantitySummary.targetQty)],
          ...(order.branchType ? [
            ['分支类型', branchTypeText(order.branchType)],
            ['主工单', order.parentWorkOrder?.code || '-'],
            ['来源工序', order.originStep?.processName || '-'],
            ['回接工序', order.rejoinStep?.processName || '成品汇总'],
          ] as Array<[string, string]> : []),
          ['工艺路线', order.processRoute?.statusText || '沿用前后端流程'], ['当前工序', order.processRoute?.currentStep?.processName || (order.processRoute?.status === 'confirmed' ? '等待图纸下发' : '-')], ['工序进度', order.processRoute ? `${order.processRoute.completedStepCount}/${order.processRoute.stepCount}（${order.processRoute.progress}%）` : '-'],
          ['数量来源', quantitySourceText(order)], ['累计进入后端', formatProductionQuantity(order.quantityFlow.frontendTransferredQty)], ['累计完成', formatProductionQuantity(order.quantitySummary.completedQty)], ['整体进度', formatProductionPercentage(order.quantitySummary.percentage)],
          ['交期', deliveryText(order) || '-'], ['图纸', order.drawingStatus || '-'], ['仓库配料', warehouseMaterialText(order)], ['仓库异常', warehouseExceptionDetail(order)], ['开始时间', dateTimeText(order.startedAt)],
          ['完成时间', dateTimeText(order.completedAt)], ['最近更新', dateTimeText(order.lastProgressAt)], ['最近进度', order.latestProgressRemark || '暂无进度备注'],
        ]} />
        {!!order.branchWorkOrders?.length && <section className="production-branch-list" aria-label="关联不良品分支">
          <header><strong>关联不良品分支</strong><span>{order.branchWorkOrders.length} 单</span></header>
          <div>{order.branchWorkOrders.map(branch => <article key={branch.id}>
            <span><b>{branch.code}</b><small>{branchTypeText(branch.branchType)} · {branch.productionTargetQty || 0} {branch.unitLabel || '件'}</small></span>
            <span><b>{branch.currentProcessName || (branch.routeStatus === 'completed' ? '路线已完成' : '工序待确认')}</b><small>{branchStatusText(branch.branchStatus)}</small></span>
            <a href={`/workspace/workflows?workOrderId=${encodeURIComponent(branch.id)}&from=production&returnTo=${encodeURIComponent('/production')}`}>查看分支流程</a>
          </article>)}</div>
        </section>}</>}
        {tab === 'drawing' && <div className="production-drawing-detail"><div className="production-drawing-score"><span>工单资料完整度</span><strong>{order.documentFilledCount}/{order.documentTotalCount || 5}</strong></div><div className="production-category-status">{categoryLabels.map(category => <span className={order.documentCategoryCodes.includes(category.code) ? 'ready' : 'missing'} key={category.code}><i />{category.label}<b>{order.documentCategoryCodes.includes(category.code) ? '已有资料' : '待补充'}</b></span>)}</div><div className="production-drawing-actions"><button className="primary-button" type="button" onClick={resources}>打开工单资料</button><button type="button" onClick={drawingLibrary}>查看图纸资料库</button></div></div>}
        {tab === 'progress' && <div className="production-progress-list">{progressLoading && <div className="production-loading">进度记录加载中...</div>}{progressLogs.map(log => <article key={log.id}><time>{dateTimeText(log.createdAt)}</time><strong>{log.createdBy || '操作人未记录'}</strong><span>状态：{log.previousStageText && log.previousStage !== log.stage ? `${log.previousStageText} → ` : ''}{log.stageText}</span>{log.completedQty && <span>完成：{log.completedQty}</span>}{(log.productionOwner || log.workstation) && <span>历史记录：{log.productionOwner || ''}{log.productionOwner && log.workstation ? ' · ' : ''}{log.workstation || ''}</span>}<p>{log.remark || '未填写备注'}</p></article>)}{!progressLoading && !progressLogs.length && <div className="production-task-empty">暂无进度记录</div>}</div>}
        {tab === 'source' && <InfoGrid items={[
          ['订单日期', dateText(order.orderDate) || '-'], ['业务员', order.salesperson || '-'], ['客户等级', order.customerLevel || '-'], ['来源订单号', order.sourceOrderNo || '-'],
          ['导入批次', order.importBatchId || '-'], ['来源工作表', order.sourceSheetName || '-'], ['来源行号', order.sourceRowNo ? String(order.sourceRowNo) : '-'], ['内部编号', order.code],
          ['工序', order.processName || '-'], ['单位工时', order.unitWorkHours || '-'], ['总工时', order.totalWorkHours || '-'], ['图纸说明', order.drawingIssueNote || '-'],
        ]} />}
      </div>
      <div className="dialog-actions"><button type="button" onClick={resources}>工单资料</button><button className="primary-button" type="button" onClick={close}>关闭</button></div>
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

function BatchDialog({ count, operation, value, remark, saving, error, setValue, setRemark, close, save }: { count: number; operation: BatchOperation; value: string; remark: string; saving: boolean; error: string; setValue: (value: string) => void; setRemark: (value: string) => void; close: () => void; save: () => void }) {
  const labels: Record<BatchOperation, string> = { set_priority: '批量设置优先级', add_remark: '批量添加进度备注' };
  return <div className="modal-backdrop"><section className="production-dialog batch" role="dialog" aria-modal="true" aria-label={labels[operation]}><div className="dialog-title"><div><strong>{labels[operation]}</strong><small>将更新已选的 {count} 个当前周工单</small></div><button type="button" aria-label="关闭" onClick={close}>×</button></div><div className="production-batch-form">
    {operation === 'set_priority' && <label><span>优先级</span><select value={value} onChange={event => setValue(event.target.value)}><option value="">请选择</option><option value="urgent">紧急</option><option value="high">高</option><option value="normal">一般</option></select></label>}
    <label><span>{operation === 'add_remark' ? '进度备注' : '附加进度备注（可选）'}</span><div className="production-voice-field"><textarea value={remark} onChange={event => setRemark(event.target.value)} rows={3} /><VoiceInputButton value={remark} onChange={setRemark} label="批量进度备注语音输入" /></div></label>
  </div>{error && <div className="form-error">{error}</div>}<div className="dialog-actions"><button type="button" disabled={saving} onClick={close}>取消</button><button className="primary-button" type="button" disabled={saving || (operation !== 'add_remark' && !value) || (operation === 'add_remark' && !remark.trim())} onClick={save}>{saving ? '处理中...' : '确认批量更新'}</button></div></section></div>;
}
