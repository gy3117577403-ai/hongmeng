'use client';

import { AlertTriangle, BarChart3, CalendarDays, ChevronRight, Copy, Download, Info, ListChecks, Pencil, RefreshCw, Search, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AppWorkbenchHeader } from '@/components/layout/AppWorkbenchHeader';
import { WorkbenchPageHeader } from '@/components/layout/WorkbenchPageHeader';
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
  const standardMilliseconds = context.standard.setupMilliseconds + (
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
  const [completedCollapsed, setCompletedCollapsed] = useState(false);
  const [insightsOpen, setInsightsOpen] = useState(false);
  const filterButtonRef = useRef<HTMLButtonElement | null>(null);
  const insightsButtonRef = useRef<HTMLButtonElement | null>(null);
  const insightsCloseRef = useRef<HTMLButtonElement | null>(null);
  const insightsPanelRef = useRef<HTMLElement | null>(null);
  const statusButtonRef = useRef<HTMLButtonElement | null>(null);
  const drawingButtonRef = useRef<HTMLButtonElement | null>(null);
  const quantityTriggerRef = useRef<HTMLButtonElement | null>(null);
  const quantityTargetInputRef = useRef<HTMLInputElement | null>(null);
  const boardShellRef = useRef<HTMLDivElement | null>(null);
  const taskGridRef = useRef<HTMLDivElement | null>(null);
  const columnRefs = useRef<Record<StageKey, HTMLDivElement | null>>({ not_issued: null, frontend: null, backend: null, completed: null });
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
      if (typeof restored.completedCollapsed === 'boolean') setCompletedCollapsed(restored.completedCollapsed);
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
    let stableAttemptCount = 0;
    const restore = (): void => {
      if (cancelled) return;
      attempt += 1;
      const shell = boardShellRef.current;
      const taskGrid = taskGridRef.current;
      const narrowPageMode = window.innerWidth < 1024;
      if (shell) {
        shell.scrollLeft = saved.boardScrollLeft || 0;
        shell.scrollTop = saved.boardScrollTop || 0;
      }
      if (taskGrid) taskGrid.scrollTop = saved.taskScrollTop || 0;
      if (narrowPageMode) window.scrollTo({ top: saved.windowScrollY || 0, behavior: 'auto' });
      if (view === 'board') {
        stages.forEach(stage => {
          const column = columnRefs.current[stage.key];
          if (column) column.scrollTop = saved.columnScrollTops[stage.key] || 0;
        });
      }
      window.requestAnimationFrame(() => {
        const currentShell = boardShellRef.current;
        const currentTaskGrid = taskGridRef.current;
        const expectedLeft = currentShell ? Math.min(saved.boardScrollLeft || 0, Math.max(0, currentShell.scrollWidth - currentShell.clientWidth)) : 0;
        const expectedBoardTop = currentShell ? Math.min(saved.boardScrollTop || 0, Math.max(0, currentShell.scrollHeight - currentShell.clientHeight)) : 0;
        const expectedTaskTop = currentTaskGrid ? Math.min(saved.taskScrollTop || 0, Math.max(0, currentTaskGrid.scrollHeight - currentTaskGrid.clientHeight)) : 0;
        const expectedWindowTop = Math.min(saved.windowScrollY || 0, Math.max(0, document.documentElement.scrollHeight - window.innerHeight));
        const focusedCard = findProductionOrderCard(saved.focusedOrderId, saved.focusedStage);
        let anchorContainer: HTMLElement | null = null;
        let anchorMatches = true;
        if (focusedCard && typeof saved.focusedOffsetTop === 'number' && saved.focusedScrollRegion) {
          if (saved.focusedScrollRegion === 'column') anchorContainer = focusedCard.closest<HTMLElement>('.production-column-list');
          else if (saved.focusedScrollRegion === 'board') anchorContainer = currentShell;
          else if (saved.focusedScrollRegion === 'task') anchorContainer = currentTaskGrid;
          const currentOffset = saved.focusedScrollRegion === 'window'
            ? focusedCard.getBoundingClientRect().top
            : anchorContainer
              ? focusedCard.getBoundingClientRect().top - anchorContainer.getBoundingClientRect().top
              : saved.focusedOffsetTop;
          const delta = currentOffset - saved.focusedOffsetTop;
          if (Math.abs(delta) > 0.5) {
            if (saved.focusedScrollRegion === 'window') window.scrollBy({ top: delta, behavior: 'auto' });
            else if (anchorContainer) anchorContainer.scrollTop += delta;
          }
          const restoredOffset = saved.focusedScrollRegion === 'window'
            ? focusedCard.getBoundingClientRect().top
            : anchorContainer
              ? focusedCard.getBoundingClientRect().top - anchorContainer.getBoundingClientRect().top
              : saved.focusedOffsetTop;
          anchorMatches = Math.abs(restoredOffset - saved.focusedOffsetTop) <= 2;
        }
        const anchoredBoard = !!focusedCard && saved.focusedScrollRegion === 'board' && !!anchorContainer;
        const anchoredTask = !!focusedCard && saved.focusedScrollRegion === 'task' && !!anchorContainer;
        const anchoredColumn = !!focusedCard && saved.focusedScrollRegion === 'column' && !!anchorContainer;
        const anchoredWindow = !!focusedCard && saved.focusedScrollRegion === 'window';
        const shellMatches = view !== 'board' || (!!currentShell
          && Math.abs(currentShell.scrollLeft - expectedLeft) <= 2
          && (anchoredBoard ? anchorMatches : Math.abs(currentShell.scrollTop - expectedBoardTop) <= 2));
        const taskMatches = view === 'board' || (!!currentTaskGrid && (anchoredTask ? anchorMatches : Math.abs(currentTaskGrid.scrollTop - expectedTaskTop) <= 2));
        const columnsMatch = view !== 'board' || stages.every(stage => {
          const column = columnRefs.current[stage.key];
          if (!column) return false;
          if (anchoredColumn && column === anchorContainer) return anchorMatches;
          const expected = Math.min(saved.columnScrollTops[stage.key] || 0, Math.max(0, column.scrollHeight - column.clientHeight));
          return Math.abs(column.scrollTop - expected) <= 2;
        });
        const windowMatches = !narrowPageMode || (anchoredWindow ? anchorMatches : Math.abs(window.scrollY - expectedWindowTop) <= 2);
        if (shellMatches && taskMatches && columnsMatch && windowMatches) {
          stableAttemptCount += 1;
          if (stableAttemptCount < 3 && attempt < 12) {
            timer = window.setTimeout(restore, 100);
            return;
          }
          const returnKey = returnKeyRef.current;
          const focusTarget = findProductionOrderCard(saved.focusedOrderId, saved.focusedStage)?.querySelector<HTMLElement>('.production-card-spec');
          if (focusTarget) focusTarget.focus({ preventScroll: true });
          sessionStorage.removeItem(`production-execution:return:${returnKey}`);
          if (sessionStorage.getItem('production-execution:pending-return') === returnKey) sessionStorage.removeItem('production-execution:pending-return');
          pendingRestoreRef.current = null;
          returnKeyRef.current = '';
          const params = executionParams(view, debouncedKeyword, quick, advanced, scope, weekStart, page);
          window.history.replaceState(window.history.state, '', `/production?${params.toString()}`);
        } else if (attempt < 12) {
          stableAttemptCount = 0;
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
    if (pendingRestoreRef.current && typeof pendingRestoreRef.current.completedCollapsed === 'boolean') return;
    const saved = sessionStorage.getItem('production-execution:completed-collapsed');
    setCompletedCollapsed(window.innerWidth >= 1280 && saved === '1');
  }, []);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(''), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!insightsOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    const overlayMode = !window.matchMedia('(min-width: 1600px)').matches;
    if (overlayMode) document.body.style.overflow = 'hidden';
    const focusTimer = window.setTimeout(() => insightsCloseRef.current?.focus(), 60);
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
      window.clearTimeout(focusTimer);
      if (overlayMode) document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleInsightKeys);
    };
  }, [insightsOpen]);

  const grouped = useMemo(() => {
    const result: Record<StageKey, ProductionCardView[]> = { not_issued: [], frontend: [], backend: [], completed: [] };
    for (const item of board?.items || []) {
      cardSegments(item).forEach(segment => result[segment.stage].push({
        order: item,
        displayStage: segment.stage,
        stageQuantity: segment.quantity,
      }));
    }
    return result;
  }, [board]);

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

  const insightOrders = useMemo(() => (board?.items || [])
    .filter(item => item.stage !== 'completed' && item.productionAlerts.length > 0)
    .sort((left, right) => {
      const leftCritical = left.productionAlerts.some(alert => alert.tone === 'red') ? 1 : 0;
      const rightCritical = right.productionAlerts.some(alert => alert.tone === 'red') ? 1 : 0;
      return rightCritical - leftCritical || right.productionAlerts.length - left.productionAlerts.length;
    })
    .slice(0, 5), [board]);

  const stageTotal = useMemo(() => stages.reduce((total, stage) => total + (summary?.stageCounts[stage.key] || 0), 0), [summary]);

  function changeView(next: ViewKey): void {
    setView(next);
    setQuick([]);
    setPage(1);
    setSelected([]);
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
        goodQty: String(Math.max(1, context.targetQuantity || 1)),
        scrapQty: '0',
        reworkQty: '0',
        remark: '',
      });
      if (!context.standard) {
        setExecutionContextWarning('当前工序尚未定标。本次可以继续完成工序，但不会生成员工达成率记录。');
      } else if (!context.employees.length) {
        setExecutionContextWarning('尚未建立在用员工档案。本次可以继续完成工序，但不会生成员工达成率记录。');
      }
    } catch (reason) {
      setExecutionContextWarning(`${reason instanceof Error ? reason.message : '报工信息加载失败'}。本次仍可继续完成工序，但不会生成员工达成率记录。`);
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
      setNextStepRequest({ order, displayStage, action: 'advance_process_route' });
      setNextStepQuantity('');
      setNextStepError('');
      const currentStepId = order.processRoute.currentStep.id;
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
      if (!goodQty || goodQty > executionContext.targetQuantity) {
        setNextStepError(`合格数量必须为正整数，且不能超过生产目标 ${executionContext.targetQuantity}`);
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
        ? order.processRoute?.nextStep
          ? `${order.processRoute.currentStep?.processName || '当前工序'}已完成，进入${order.processRoute.nextStep.processName}`
          : '全部工序已完成'
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

  function toggleCompletedColumn(): void {
    setCompletedCollapsed(current => {
      const next = !current;
      sessionStorage.setItem('production-execution:completed-collapsed', next ? '1' : '0');
      return next;
    });
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
    if (focusedCard) {
      const cardRect = focusedCard.getBoundingClientRect();
      if (view === 'board' && window.innerWidth >= 1280) {
        const column = focusedCard.closest<HTMLElement>('.production-column-list');
        if (column) {
          focusedScrollRegion = 'column';
          focusedOffsetTop = cardRect.top - column.getBoundingClientRect().top;
        }
      } else if (view === 'board' && window.innerWidth >= 1024 && boardShellRef.current) {
        focusedScrollRegion = 'board';
        focusedOffsetTop = cardRect.top - boardShellRef.current.getBoundingClientRect().top;
      } else if (view !== 'board' && taskGridRef.current && taskGridRef.current.scrollHeight > taskGridRef.current.clientHeight + 1) {
        focusedScrollRegion = 'task';
        focusedOffsetTop = cardRect.top - taskGridRef.current.getBoundingClientRect().top;
      } else {
        focusedScrollRegion = 'window';
        focusedOffsetTop = cardRect.top;
      }
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
      completedCollapsed,
      boardScrollLeft: boardShellRef.current?.scrollLeft || 0,
      boardScrollTop: boardShellRef.current?.scrollTop || 0,
      taskScrollTop: taskGridRef.current?.scrollTop || 0,
      windowScrollY: window.scrollY,
      columnScrollTops: {
        not_issued: columnRefs.current.not_issued?.scrollTop || 0,
        frontend: columnRefs.current.frontend?.scrollTop || 0,
        backend: columnRefs.current.backend?.scrollTop || 0,
        completed: columnRefs.current.completed?.scrollTop || 0,
      },
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

  function openDrawingLibrary(order: ProductionOrder): void {
    const params = new URLSearchParams();
    if (order.drawingLibraryItemId) params.set('itemId', order.drawingLibraryItemId);
    else {
      params.set('create', '1');
      params.set('customerName', order.customerName || '');
      params.set('specification', order.specification || '');
      params.set('productName', order.productName || '');
    }
    router.push(`/drawing-library?${params.toString()}`);
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

  const cardProps = {
    readOnly: board?.readOnly || false,
    batchMode, selected, toggleSelected, openDetail, openUpdate, openQuantityAdjustment, openNextStep, saving,
    openResources: openWorkOrderResources, copySpecification, openIssue: openProductionIssue,
    openStatusMenu: (event: React.MouseEvent<HTMLButtonElement>, item: ProductionOrder): void => {
      if (item.quantityFlow.materialized) {
        setToast('该工单已启用分批数量流转，请使用“下一步”更新生产数量');
        return;
      }
      statusButtonRef.current = event.currentTarget;
      setDrawingMenuOrder(null);
      setStatusMenuOrder(item);
    },
    openDrawingStatusMenu: (event: React.MouseEvent<HTMLButtonElement>, item: ProductionOrder): void => {
      drawingButtonRef.current = event.currentTarget;
      setStatusMenuOrder(null);
      setDrawingMenuOrder(item);
    },
  };
  const weeklyPlanWeekStart = weekStart || summary?.weekStartDate || '';
  const weeklyPlanHref = weeklyPlanWeekStart ? `/weekly-plan-center?currentWeekStart=${encodeURIComponent(weeklyPlanWeekStart)}` : '/weekly-plan-center';
  const weekScopeTitle = scope === 'carryover' ? '遗留未完' : scope === 'next' ? '下周预览' : scope === 'history' ? '历史周' : '当前执行周';
  const weekScopeRangeText = !summary?.weekStartDate
    ? '前往周计划中心启用'
    : scope === 'carryover'
      ? `早于 ${dateText(summary.weekStartDate)}`
      : `${dateText(summary.weekStartDate)} - ${dateText(summary.weekEndDate)}`;

  return (
    <main className="production-page hm-production-workbench hm-workbench-root">
      <AppWorkbenchHeader
        user={user}
        activeHref="/production"
        subtitle="现场生产工作台"
        menuItems={[
          { label: '系统设置', href: '/dashboard?openSettings=1' },
          { label: '退出登录', onSelect: () => { void logout(); } },
        ]}
      />

      <div className="production-execution-main">
        <WorkbenchPageHeader
          kicker="生产执行"
          title="生产执行中心"
          description={`${todayLabel} · 本周任务、异常与进度闭环`}
          titleId="production-page-title"
          actionsClassName="production-page-actions"
          actions={<><button ref={insightsButtonRef} className={`hm-workbench-button production-insight-trigger ${insightsOpen ? 'active' : ''}`.trim()} type="button" aria-expanded={insightsOpen} aria-controls="production-insight-panel" onClick={() => setInsightsOpen(value => !value)}><BarChart3 size={15} aria-hidden="true" />生产概览</button><a className="hm-workbench-button" href="/workspace/attendance?tab=abnormal"><AlertTriangle size={15} aria-hidden="true" />报异常工时</a><a className="hm-workbench-button" href={weeklyPlanHref}><CalendarDays size={15} aria-hidden="true" />周计划</a><button className={`hm-workbench-button ${batchMode ? 'active' : ''}`.trim()} type="button" disabled={board?.readOnly} title={board?.readOnly ? '下周预览不可批量修改' : ''} onClick={toggleBatchMode}><ListChecks size={15} aria-hidden="true" />{batchMode ? '退出批量' : '批量操作'}</button><button className="hm-workbench-button" type="button" onClick={exportCsv}><Download size={15} aria-hidden="true" />导出</button></>}
        />

        <nav className="production-week-scope-bar" aria-label="生产周范围">
          <div className="production-week-scope-tabs">
            <button className={scope === 'carryover' ? 'active' : ''} type="button" aria-pressed={scope === 'carryover'} onClick={() => changeWeekScope('carryover')}>遗留未完 <b>{summary?.navigation.carryoverCount ?? 0}</b></button>
            <button className={scope === 'current' ? 'active' : ''} type="button" aria-pressed={scope === 'current'} onClick={() => changeWeekScope('current')}>本周 <b>{summary?.navigation.current.count ?? 0}</b></button>
            <button className={scope === 'next' ? 'active' : ''} type="button" aria-pressed={scope === 'next'} onClick={() => changeWeekScope('next')}>下周 <b>{summary?.navigation.next.count ?? 0}</b></button>
            <label className={scope === 'history' ? 'active' : ''}><span>历史周</span><select aria-label="选择历史生产周" value={scope === 'history' ? weekStart : ''} onChange={event => changeWeekScope('history', event.target.value)}><option value="" disabled>选择历史周</option>{summary?.navigation.history.map(item => <option key={item.weekStartDate} value={item.weekStartDate}>{dateText(item.weekStartDate)} - {dateText(item.weekEndDate)}（{item.count}）</option>)}</select></label>
          </div>
          <span className={`production-week-scope-note ${board?.readOnly ? 'readonly' : ''}`}>{scope === 'carryover' ? '历史周未完成工单，可继续流转；不计入本周统计。' : scope === 'next' ? '下周计划仅预览，启用为本周后才能记录生产。' : scope === 'history' ? '已完成工单只读，未完成工单可继续处理。' : '本周数据按自然周独立统计。'}</span>
        </nav>

        <section className="production-summary production-command-strip" aria-label="当前周生产摘要">
          <button className={`production-week-label production-command-total ${summaryActive('all') ? 'active' : ''}`} type="button" onClick={() => toggleSummary('all')}>
            <span>{summary?.weekStartDate ? `${weekScopeTitle} · 数量完成 ${formatProductionPercentage(summary?.quantityTotals?.percentage ?? null)}` : '周计划尚未启用'}</span><strong>{weekScopeRangeText}</strong><em>{summary?.total ?? 0}<small>工单</small></em>
          </button>
          {stages.map(stage => <button className={`production-command-stage ${stage.key} ${advanced.stage === stage.key ? 'active' : ''}`} type="button" key={stage.key} aria-pressed={advanced.stage === stage.key} onClick={() => selectStage(stage.key)}><span>{stage.label}</span><strong>{summary?.stageCounts[stage.key] ?? 0}</strong><small>{stage.hint} · {formatProductionQuantity(summary?.stageQuantityTotals?.[stage.key] ?? 0)} 套</small></button>)}
          <button className={`production-command-alert ${summaryActive('urgent') || summaryActive('overdue') ? 'active' : ''}`} type="button" onClick={() => { setView('exceptions'); setQuick([]); setPage(1); }}><span>异常 / 紧急</span><strong>{summary?.exceptions ?? 0}</strong><small>逾期 {summary?.overdue ?? 0} · 原图缺失 {summary?.incompleteDocuments ?? 0}</small></button>
        </section>

        <section className="production-controls" aria-label="生产任务筛选">
          <div className="production-toolbar">
            <div className="production-view-tabs" aria-label="任务视图">
              <button className={view === 'board' ? 'active' : ''} type="button" aria-pressed={view === 'board'} onClick={() => changeView('board')}>生产看板</button>
              <button className={view === 'today' ? 'active' : ''} type="button" aria-pressed={view === 'today'} onClick={() => changeView('today')}>今日任务</button>
              <button className={view === 'exceptions' ? 'active' : ''} type="button" aria-pressed={view === 'exceptions'} onClick={() => changeView('exceptions')}>异常任务</button>
            </div>
            <label className="production-search"><Search aria-hidden="true" /><input value={keyword} onChange={event => setKeyword(event.target.value)} placeholder="搜索规格 / 客户 / 品名 / 订单号" /></label>
            <button ref={filterButtonRef} className={filtersOpen || activeFilterCount ? 'active' : ''} type="button" aria-expanded={filtersOpen} onClick={() => { setDraftAdvanced(cloneAdvanced(advanced)); setFiltersOpen(value => !value); }}>高级筛选{activeFilterCount ? ` ${activeFilterCount}` : ''}</button>
            <PortalMenu open={filtersOpen} anchorRef={filterButtonRef} align="right" className="production-filter-menu hm-production-menu hm-production-filter-menu" width={420} onClose={() => setFiltersOpen(false)} closeOnSelect={false}>
              <AdvancedFilterPanel customers={board?.filterOptions.customers || []} value={draftAdvanced} setValue={setDraftAdvanced} clear={() => setDraftAdvanced(emptyAdvanced)} apply={() => { setAdvanced(cloneAdvanced(draftAdvanced)); setFiltersOpen(false); setPage(1); }} />
            </PortalMenu>
            <span className="production-result-count">筛选结果 <b>{board?.pagination.total || 0}</b> / 全周 {summary?.total || 0}</span>
          </div>
          <div className="production-quick-filters" aria-label="快捷筛选">
            <span className="production-quick-filter-label">快捷筛选</span>
            <button className={!quick.length ? 'active' : ''} type="button" aria-pressed={!quick.length} onClick={() => { setQuick([]); setPage(1); }}>全部</button>
            {quickByView[view].map(item => <button className={quick.includes(item.key) ? 'active' : ''} key={item.key} type="button" aria-pressed={quick.includes(item.key)} onClick={() => toggleQuick(item.key)}>{item.label}</button>)}
          </div>
          {!!filterChips.length && <div className="production-filter-chips" aria-label="已应用筛选">{filterChips.map(chip => <button key={chip.key} type="button" onClick={() => { chip.remove(); setPage(1); }} title={`移除${chip.label}`}>{chip.label}<span>×</span></button>)}<button className="clear" type="button" onClick={() => { setAdvanced(emptyAdvanced); setQuick([]); setKeyword(''); setPage(1); }}>清空全部</button></div>}
        </section>

        {error && <div className="production-error"><span><strong>加载失败</strong>{error}</span><button type="button" onClick={() => setRefreshToken(value => value + 1)}>重新加载</button></div>}
        {scope === 'current' && summary?.total === 0 && !loading && <div className="production-empty-week"><strong>本周暂无已启用生产工单</strong><span>历史遗留工单可从“遗留未完”继续处理；新计划请在计划中心下达。</span><a href={weeklyPlanHref}>进入计划中心</a></div>}

        <div className="production-workspace">
          <div className="production-workspace-primary">
            {view === 'board' ? (
              <div ref={boardShellRef} className="production-board-shell hm-scroll-region" tabIndex={0} aria-label="四状态生产看板">
                <div className={`production-board ${completedCollapsed ? 'completed-collapsed' : ''}`}>
                  {stages.map(column => (
                    <section className={`production-column ${column.key} ${column.key === 'completed' && completedCollapsed ? 'collapsed' : ''}`} key={column.key}>
                      <header className="production-stage-header">
                        {column.key === 'completed'
                          ? <button type="button" aria-expanded={!completedCollapsed} onClick={toggleCompletedColumn}><span className="production-stage-step">{column.step}</span><span className="production-stage-copy"><strong>{column.label}</strong><small>{column.hint}</small></span><span className="production-stage-count">{board?.stageCounts[column.key] || 0}</span><em>{completedCollapsed ? '展开' : '收起'}</em></button>
                          : <><span className="production-stage-step">{column.step}</span><span className="production-stage-copy"><strong>{column.label}</strong><small>{column.hint}</small></span><span className="production-stage-count">{board?.stageCounts[column.key] || 0}</span></>}
                      </header>
                      {!completedCollapsed || column.key !== 'completed' ? <div ref={element => { columnRefs.current[column.key] = element; }} className="production-column-list hm-scroll-region" tabIndex={0} aria-label={`${column.label}工单列表，共 ${grouped[column.key].length} 项`}>
                        {grouped[column.key].map(item => <ProductionCard key={`${item.order.id}:${item.displayStage}`} order={item.order} displayStage={item.displayStage} stageQuantity={item.stageQuantity} {...cardProps} readOnly={board?.readOnly || (scope === 'history' && item.order.stage === 'completed')} />)}
                        {loading && !grouped[column.key].length && <CardSkeleton count={3} />}
                        {!loading && !grouped[column.key].length && <div className="production-column-empty">当前状态暂无工单</div>}
                      </div> : <div ref={element => { columnRefs.current[column.key] = element; }} className="production-completed-collapsed-hint"><span>{board?.stageCounts.completed || 0}</span><small>已完成</small></div>}
                    </section>
                  ))}
                </div>
              </div>
            ) : (
              <section className="production-task-view">
                <div className="production-task-heading"><div><strong>{view === 'today' ? '今日任务' : '异常任务'}</strong><span>{view === 'today' ? '今日交期、逾期与今日进展' : '仅展示会阻塞生产或需补齐的异常，查看后进入原工单处理'}</span></div><em>{board?.pagination.total || 0} 项</em></div>
                <div ref={taskGridRef} className={`production-task-grid hm-scroll-region ${view === 'exceptions' ? 'exception-list' : ''}`} tabIndex={0} aria-label={`${view === 'today' ? '今日任务' : '异常任务'}列表`}>
                  {board?.items.map(order => {
                    const item = primaryCardView(order);
                    const readOnly = board?.readOnly || (scope === 'history' && order.stage === 'completed');
                    return view === 'exceptions'
                      ? <ProductionExceptionRow key={order.id} order={order} displayStage={item.displayStage} readOnly={readOnly} openDetail={openDetail} openResources={openWorkOrderResources} />
                      : <ProductionCard key={order.id} order={order} displayStage={item.displayStage} stageQuantity={item.stageQuantity} {...cardProps} readOnly={readOnly} />;
                  })}
                  {loading && <CardSkeleton count={8} />}
                  {!loading && !board?.items.length && <div className="production-task-empty">当前没有匹配任务</div>}
                </div>
              </section>
            )}

            {board && board.pagination.totalPages > 1 && <div className="production-pagination"><span>共 {board.pagination.total} 单</span><button type="button" disabled={board.pagination.page <= 1} onClick={() => setPage(value => Math.max(1, value - 1))}>上一页</button><b>{board.pagination.page} / {board.pagination.totalPages}</b><button type="button" disabled={board.pagination.page >= board.pagination.totalPages} onClick={() => setPage(value => value + 1)}>下一页</button></div>}
          </div>

          {insightsOpen && <button className="production-insight-scrim open" type="button" aria-label="关闭生产概览" onClick={closeInsights} />}
          {insightsOpen && <aside ref={insightsPanelRef} id="production-insight-panel" className="production-insight-panel open" aria-label="生产概览" role="dialog" aria-modal="true" tabIndex={-1}>
            <header><div><span>本周概览</span><strong>生产执行分布</strong></div><button ref={insightsCloseRef} type="button" aria-label="关闭生产概览" title="关闭生产概览" onClick={closeInsights}><X size={18} aria-hidden="true" /></button></header>
            <section className="production-insight-section" aria-label="阶段分布">
              <div className="production-insight-section-title"><strong>阶段分布</strong><span>{stageTotal} 单</span></div>
              <div className="production-insight-stages">{stages.map(stage => {
                const count = summary?.stageCounts[stage.key] || 0;
                const percentage = stageTotal ? Math.round((count / stageTotal) * 100) : 0;
                return <button type="button" key={stage.key} className={stage.key} onClick={() => { selectStage(stage.key); closeInsights(); }}><span><b>{stage.label}</b><em>{count} 单 · {percentage}%</em></span><i><span style={{ width: `${percentage}%` }} /></i></button>;
              })}</div>
            </section>
            <section className="production-insight-section production-insight-exceptions" aria-label="异常关注">
              <div className="production-insight-section-title"><strong><AlertTriangle size={15} aria-hidden="true" />异常关注</strong><button type="button" onClick={() => { changeView('exceptions'); closeInsights(); }}>查看全部</button></div>
              <div className="production-insight-order-list">{insightOrders.map(order => <button type="button" key={order.id} onClick={() => { closeInsights(); openDetail(order); }}><span><strong title={order.specification || order.code}>{order.specification || order.code}</strong><small>{order.customerName || '客户未设置'}</small></span><em>{order.productionAlerts[0]?.label || '待处理'}</em></button>)}{!insightOrders.length && <p>当前筛选范围内暂无异常工单</p>}</div>
            </section>
            <section className="production-insight-section production-insight-quick" aria-label="快捷入口">
              <div className="production-insight-section-title"><strong>快捷入口</strong></div>
              <a href={weeklyPlanHref}>查看周计划<ChevronRight aria-hidden="true" /></a>
              <a href="/dashboard">进入工单资料库<ChevronRight aria-hidden="true" /></a>
              <button type="button" disabled={board?.readOnly} title={board?.readOnly ? '下周预览不可批量修改' : ''} onClick={() => { closeInsights(); toggleBatchMode(); }}>{batchMode ? '退出批量操作' : '开始批量操作'}<ChevronRight aria-hidden="true" /></button>
            </section>
          </aside>}
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
      {detailOrder && <DetailDialog order={detailOrder} readOnly={board?.readOnly || (scope === 'history' && detailOrder.stage === 'completed')} tab={detailTab} setTab={switchDetailTab} progressLogs={progressLogs} progressLoading={progressLoading} close={() => setDetailOrder(null)} update={() => openUpdate(detailOrder)} adjustQuantity={() => openQuantityAdjustment(detailOrder)} resources={() => openWorkOrderResources(detailOrder)} drawingLibrary={() => openDrawingLibrary(detailOrder)} />}
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
      {toast && <div className="production-toast" role="status">{toast}</div>}
    </main>
  );
}

function CardSkeleton({ count }: { count: number }) {
  return <>{Array.from({ length: count }, (_, index) => <div className="production-card skeleton" aria-hidden="true" key={index}><i /><i /><i /><i /></div>)}</>;
}

function ProductionExceptionRow({ order, displayStage, readOnly, openDetail, openResources }: {
  order: ProductionOrder;
  displayStage: StageKey;
  readOnly: boolean;
  openDetail: (order: ProductionOrder) => void;
  openResources: (order: ProductionOrder, focusedStage?: StageKey) => void;
}) {
  const labels = order.exceptionLabels.length ? order.exceptionLabels : order.productionAlerts.map(alert => alert.label);
  const weekLabel = order.weekStartDate
    ? `${dateText(order.weekStartDate)}${order.weekEndDate ? ` - ${dateText(order.weekEndDate)}` : ''}`
    : '生产周未设置';
  return <article className="production-exception-row" data-production-order-id={order.id} data-production-stage={displayStage}>
    <div className="production-exception-identity">
      <strong title={order.specification || order.code}>{specText(order)}</strong>
      <span title={`${order.customerName || '客户未设置'} · ${order.productName || '品名未设置'}`}>{order.customerName || '客户未设置'} · {order.productName || '品名未设置'}</span>
    </div>
    <div className="production-exception-stage"><span>{order.stageText}</span><small>{weekLabel}</small></div>
    <div className="production-exception-tags" title={labels.join('、')}>{labels.slice(0, 3).map((label, index) => <em key={`${label}-${index}`}>{label}</em>)}{labels.length > 3 && <em>+{labels.length - 3}</em>}</div>
    <div className="production-exception-due"><span>计划交期</span><strong>{deliveryText(order) || '未设置'}</strong></div>
    <div className="production-exception-actions"><button type="button" onClick={() => openDetail(order)}>查看</button><button className="primary" type="button" onClick={() => openResources(order, displayStage)}>进入工单</button>{readOnly && <small>当前范围只读</small>}</div>
  </article>;
}

type ProductionCardProps = {
  order: ProductionOrder;
  displayStage: StageKey;
  stageQuantity: number | null;
  readOnly: boolean;
  batchMode: boolean;
  selected: string[];
  toggleSelected: (id: string) => void;
  openDetail: (order: ProductionOrder) => void;
  openUpdate: (order: ProductionOrder) => void;
  openQuantityAdjustment: (order: ProductionOrder, trigger?: HTMLButtonElement) => void;
  openNextStep: (order: ProductionOrder, displayStage: StageKey) => void;
  saving: boolean;
  openResources: (order: ProductionOrder, focusedStage?: StageKey) => void;
  copySpecification: (order: ProductionOrder) => Promise<void>;
  openStatusMenu: (event: React.MouseEvent<HTMLButtonElement>, order: ProductionOrder) => void;
  openDrawingStatusMenu: (event: React.MouseEvent<HTMLButtonElement>, order: ProductionOrder) => void;
  openIssue: (order: ProductionOrder, alertCode: string, focusedStage?: StageKey) => void;
  showExceptions?: boolean;
};

function ProductionCard(props: ProductionCardProps) {
  if (props.displayStage === 'not_issued') return <NotIssuedWorkOrderCard {...props} />;
  if (props.displayStage === 'completed') return <CompletedWorkOrderCard {...props} />;
  return <ActiveWorkOrderCard {...props} />;
}

function CardSelection({ order, batchMode, selected, toggleSelected, readOnly }: Pick<ProductionCardProps, 'order' | 'batchMode' | 'selected' | 'toggleSelected' | 'readOnly'>) {
  if (!batchMode || readOnly) return null;
  return <label className="production-card-selection" title={`选择${specText(order)}`}><input aria-label={`选择${specText(order)}`} type="checkbox" checked={selected.includes(order.id)} onChange={() => toggleSelected(order.id)} /></label>;
}

function ProductionAlertList({ order, showExceptions, openDrawingStatusMenu, openIssue, displayStage, readOnly }: Pick<ProductionCardProps, 'order' | 'showExceptions' | 'openDrawingStatusMenu' | 'openIssue' | 'displayStage' | 'readOnly'>) {
  const fallback = showExceptions
    ? order.exceptionLabels.filter(label => !order.productionAlerts.some(alert => alert.label === label)).map((label, index) => ({ code: `legacy-${index}`, label, tone: 'amber' as const }))
    : [];
  const all = [...order.productionAlerts, ...fallback];
  if (!all.length) return null;
  const drawingCodes = new Set(['DRAWING_NOT_ISSUED', 'SAMPLE_CONFIRMATION_REQUIRED', 'CUSTOMER_CONFIRMATION_REQUIRED', 'DRAWING_CHANGE_REQUIRED']);
  return <div className="production-alerts" aria-label="工单异常">
    {all.slice(0, 2).map(alert => drawingCodes.has(alert.code) && !readOnly
      ? <button className={alert.tone} type="button" key={`${alert.code}-${alert.label}`} onClick={event => openDrawingStatusMenu(event, order)}>{alert.label}</button>
      : <span className={alert.tone} key={`${alert.code}-${alert.label}`}>{alert.label}</span>)}
    {all.length > 2 && <span className="more" title={all.slice(2).map(alert => alert.label).join('、')}>+{all.length - 2} 更多异常</span>}
    {!!order.productionAlerts[0] && !readOnly && <button className="issue-action" type="button" title="将首要异常转入问题管理" onClick={() => openIssue(order, order.productionAlerts[0].code, displayStage)}>转问题</button>}
  </div>;
}

function ProcessRouteStrip({ order }: { order: ProductionOrder }) {
  const route = order.processRoute;
  if (!route) return null;
  const label = route.status === 'draft'
    ? '工艺待确认'
    : route.status === 'confirmed'
      ? '工艺已确认 · 等待图纸'
      : route.status === 'completed'
        ? '全部工序完成'
        : `当前工序：${route.currentStep?.processName || '待检查'}`;
  return <div className={`production-process-route ${route.status}`} title={`${route.templateName} V${route.templateVersion} · ${route.completedStepCount}/${route.stepCount} 工序`}>
    <span>{label}</span><i><b style={{ width: `${route.progress}%` }} /></i><strong>{route.completedStepCount}/{route.stepCount}</strong>
  </div>;
}

function nextStepButtonText(order: ProductionOrder): string {
  const route = order.processRoute;
  if (!route) return '下一步';
  if (route.status === 'draft') return '确认工艺';
  if (route.currentStep) return `完成${route.currentStep.processName}`;
  return '检查工艺';
}

function WorkOrderCardTitle({ order, displayStage, batchMode, selected, toggleSelected, openDetail, openQuantityAdjustment, openResources, copySpecification, readOnly }: Pick<ProductionCardProps, 'order' | 'displayStage' | 'batchMode' | 'selected' | 'toggleSelected' | 'openDetail' | 'openQuantityAdjustment' | 'openResources' | 'copySpecification' | 'readOnly'>) {
  return <>
    <div className="production-card-title">
      <CardSelection order={order} batchMode={batchMode} selected={selected} toggleSelected={toggleSelected} readOnly={readOnly} />
      <div className="production-card-identity">
        <strong title={order.customerName || '客户待补充'}>{order.customerName || '客户待补充'}</strong>
        <button className="production-card-spec" type="button" title={order.specification || '规格待补充'} onClick={() => openResources(order, displayStage)}>{specText(order)}</button>
      </div>
      <div className="production-card-title-actions">
        <button className="production-card-quantity-edit" type="button" disabled={readOnly} title={readOnly ? '只读范围不可修改数量' : order.quantityTargetSource === 'missing' ? '补充生产数量' : '校正生产数量'} aria-label={readOnly ? '只读范围不可修改数量' : order.quantityTargetSource === 'missing' ? '补充生产数量' : '校正生产数量'} onClick={event => openQuantityAdjustment(order, event.currentTarget)}><Pencil size={14} aria-hidden="true" /></button>
        <button className="production-card-copy" type="button" title="复制完整规格" aria-label="复制完整规格" onClick={() => void copySpecification(order)}><Copy size={15} aria-hidden="true" /></button>
        <button className="production-card-info" type="button" title="查看工单详情" aria-label="查看工单详情" onClick={() => openDetail(order)}><Info size={15} aria-hidden="true" /></button>
      </div>
    </div>
    <div className="production-card-context"><span title={order.productName || '品名待补充'}>{order.productName || '品名待补充'}</span><em className={order.priority}>{priorityText(order.priority)}</em></div>
  </>;
}

function NotIssuedWorkOrderCard(props: ProductionCardProps) {
  const { order, openNextStep, openQuantityAdjustment, openDrawingStatusMenu, saving, stageQuantity } = props;
  const quantity = order.quantitySummary;
  const quantityUnavailable = quantity.targetQty === null || !order.quantityFlow.valid;
  const quantityActionText = order.quantityTargetSource === 'missing' ? '补充数量' : '校正数量';
  const percentageWidth = Math.max(0, Math.min(quantity.percentage || 0, 100));
  const reminder = /样品|确认|变更|异常|返工|待处理/.test(order.latestProgressRemark || '') ? order.latestProgressRemark : '';
  return <article className={`production-card production-card-not-issued not_issued ${props.selected.includes(order.id) ? 'selected' : ''}`} data-production-order-id={order.id} data-production-stage="not_issued">
    <WorkOrderCardTitle {...props} />
    <ProcessRouteStrip order={order} />
    <dl className="production-leader-metrics production-quantity-grid"><div><dt>本阶段数量</dt><dd>{stageQuantity === null ? '待补充' : formatProductionQuantity(stageQuantity)}</dd></div><div><dt>总目标</dt><dd>{quantity.targetQty === null ? '待补充' : formatProductionQuantity(quantity.targetQty)}</dd></div><div><dt>已完成</dt><dd>{quantity.completedQty === null ? '-' : formatProductionQuantity(quantity.completedQty)}</dd></div></dl>
    <div className={`production-card-quantity-status ${quantityUnavailable ? 'missing' : ''}`}><span>{quantitySourceText(order)}</span><div className="production-progress-track"><i><b style={{ width: `${percentageWidth}%` }} /></i><strong>{quantityUnavailable ? quantityActionText : formatProductionPercentage(quantity.percentage)}</strong></div></div>
    <div className="production-card-meta"><span>计划交期</span><strong>{deliveryText(order) || '待设置'}</strong></div>
    <ProductionAlertList order={order} displayStage="not_issued" showExceptions={props.showExceptions} openDrawingStatusMenu={openDrawingStatusMenu} openIssue={props.openIssue} readOnly={props.readOnly} />
    {reminder && <p className="production-focus-reminder" title={reminder}>{reminder}</p>}
    {props.readOnly ? <footer><span className="production-readonly-note">下周预览，仅可查看</span></footer> : <footer><button type="button" onClick={event => openDrawingStatusMenu(event, order)}>更新图纸状态</button>{quantityUnavailable ? <button className="primary" type="button" disabled={saving} onClick={event => openQuantityAdjustment(order, event.currentTarget)}>{quantityActionText}</button> : <button className="primary" type="button" disabled={saving} onClick={() => openNextStep(order, 'not_issued')}>下一步</button>}</footer>}
  </article>;
}

function ActiveWorkOrderCard(props: ProductionCardProps) {
  const { order, openUpdate, openQuantityAdjustment, openNextStep, displayStage, stageQuantity, saving } = props;
  const quantity = order.quantitySummary;
  const quantityUnavailable = quantity.targetQty === null || !order.quantityFlow.valid;
  const percentageWidth = Math.max(0, Math.min(quantity.percentage || 0, 100));
  const splitFlow = cardSegments(order).length > 1;
  return <article className={`production-card production-card-active ${displayStage} ${props.selected.includes(order.id) ? 'selected' : ''}`} data-production-order-id={order.id} data-production-stage={displayStage}>
    <WorkOrderCardTitle {...props} />
    <ProcessRouteStrip order={order} />
    <button className="production-progress-hit" type="button" disabled={props.readOnly} onClick={() => openUpdate(order)} title={props.readOnly ? '只读范围不可记录进度' : '记录生产进度备注'}>
      <span className="production-quantity-grid"><span><small>本阶段数量</small><strong>{stageQuantity === null ? '-' : formatProductionQuantity(stageQuantity)}</strong></span><span><small>总目标</small><strong>{quantity.targetQty === null ? '-' : formatProductionQuantity(quantity.targetQty)}</strong></span><span><small>累计完成</small><strong>{quantity.completedQty === null ? '-' : formatProductionQuantity(quantity.completedQty)}</strong></span></span>
      <span className="production-progress-track"><i><b style={{ width: `${percentageWidth}%` }} /></i><strong>{formatProductionPercentage(quantity.percentage)}</strong></span>
      {quantity.overrunQty !== null && quantity.overrunQty > 0 && <small className="overrun">超产 {formatProductionQuantity(quantity.overrunQty)} 套</small>}
    </button>
    <span className={`production-quantity-source ${order.quantityTargetSource}`}>{quantitySourceText(order)}</span>
    {splitFlow && <span className="production-flow-badge">分批流转 · 同一工单</span>}
    <ProductionAlertList order={order} displayStage={displayStage} showExceptions={props.showExceptions} openDrawingStatusMenu={props.openDrawingStatusMenu} openIssue={props.openIssue} readOnly={props.readOnly} />
    {props.readOnly ? <footer><span className="production-readonly-note">下周预览，仅可查看</span></footer> : <footer><button type="button" onClick={() => openUpdate(order)}>记录进度</button>{quantityUnavailable ? <button className="primary" type="button" disabled={saving} onClick={event => openQuantityAdjustment(order, event.currentTarget)}>补充 / 校正数量</button> : <button className="primary" type="button" title={nextStepButtonText(order)} disabled={saving || !stageQuantity} onClick={() => openNextStep(order, displayStage)}>{nextStepButtonText(order)}</button>}</footer>}
  </article>;
}

function CompletedWorkOrderCard(props: ProductionCardProps) {
  const { order, openStatusMenu } = props;
  const isSelected = props.selected.includes(order.id);
  const quantity = order.quantitySummary;
  const quantityText = props.stageQuantity === null
    ? '完成数量待核对'
    : `本阶段完成 ${formatProductionQuantity(props.stageQuantity)} 套 · 累计 ${formatProductionQuantity(quantity.completedQty)} / ${formatProductionQuantity(quantity.targetQty)} 套`;
  const percentageWidth = Math.max(0, Math.min(quantity.percentage || 0, 100));
  return <article className={`production-card production-card-completed completed ${quantity.status} ${isSelected ? 'selected' : ''}`} data-production-order-id={order.id} data-production-stage="completed">
    <WorkOrderCardTitle {...props} />
    <ProcessRouteStrip order={order} />
    <div className="production-completed-quantity">{quantityText}</div>
    <div className="production-completed-progress"><div className="production-progress-track"><i><b style={{ width: `${percentageWidth}%` }} /></i><strong>{formatProductionPercentage(quantity.percentage)}</strong></div><span className={`production-quantity-source ${order.quantityTargetSource}`}>{quantitySourceText(order)}</span></div>
    {quantity.status === 'tail_remaining' && <div className="production-completed-result tail">剩余 {formatProductionQuantity(quantity.remainingQty)} 套 · 尾数未清</div>}
    {quantity.status === 'overrun' && <div className="production-completed-result overrun">超产 {formatProductionQuantity(quantity.overrunQty)} 套</div>}
    <button className="production-completed-more" type="button" disabled={props.readOnly} onClick={event => openStatusMenu(event, order)}>{props.readOnly ? '历史完成，只读' : '调整状态'}</button>
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

function NextStepDialog({ request, quantity, setQuantity, executionContext, executionForm, setExecutionForm, executionContextLoading, executionContextWarning, saving, error, close, confirm }: {
  request: NextStepRequest;
  quantity: string;
  setQuantity: (value: string) => void;
  executionContext: ProcessExecutionContextDTO | null;
  executionForm: ProcessExecutionForm | null;
  setExecutionForm: (value: ProcessExecutionForm) => void;
  executionContextLoading: boolean;
  executionContextWarning: string;
  saving: boolean;
  error: string;
  close: () => void;
  confirm: () => void;
}) {
  const { order, action } = request;
  const flow = order.quantityFlow;
  const isDrawingConfirmation = action === 'confirm_drawing_issued';
  const isProcessAdvance = action === 'advance_process_route';
  const title = isProcessAdvance
    ? `完成工序：${order.processRoute?.currentStep?.processName || '当前工序'}`
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
        <div className="production-flow-confirm-copy"><strong>{order.processRoute?.nextStep ? `下一工序：${order.processRoute.nextStep.processName}` : '这是路线最后一道工序'}</strong><br />确认后将记录当前工序完成，并自动切换到下一道工序；已确认的路线顺序不会改变。</div>
        {executionContextLoading && <div className="production-execution-loading"><RefreshCw className="spin" />正在加载产品工时和员工档案...</div>}
        {executionContextWarning && <div className="production-execution-warning" role="status"><AlertTriangle />{executionContextWarning}<a href="/workspace/product-times">前往维护</a></div>}
        {requiresExecution && executionForm && executionContext?.standard && <div className="production-execution-form">
          <header><div><strong>本工序报工</strong><small>用于员工当日、周、月达成率汇总</small></div><em>标准 V{executionContext.standard.version || '-'}</em></header>
          <div className="production-execution-fields">
            <label><span>完成员工</span><select value={executionForm.employeeId} onChange={event => setExecutionForm({ ...executionForm, employeeId: event.target.value })}>{executionContext.employees.map(employee => <option value={employee.id} key={employee.id}>{employee.employeeNo} · {employee.name}{employee.position ? ` · ${employee.position}` : ''}{employee.team ? ` · ${employee.team}` : ''}</option>)}</select></label>
            <label><span>合格数量</span><input type="number" min="1" max={executionContext.targetQuantity} value={executionForm.goodQty} onChange={event => setExecutionForm({ ...executionForm, goodQty: event.target.value })} /></label>
            <label><span>开始时间</span><input type="datetime-local" value={executionForm.startedAt} onChange={event => setExecutionForm({ ...executionForm, startedAt: event.target.value })} /></label>
            <label><span>结束时间</span><input type="datetime-local" value={executionForm.endedAt} onChange={event => setExecutionForm({ ...executionForm, endedAt: event.target.value })} /></label>
            <label><span>休息时间（分钟）</span><input type="number" min="0" step="1" value={executionForm.breakMinutes} onChange={event => setExecutionForm({ ...executionForm, breakMinutes: event.target.value })} /></label>
            <label><span>报废 / 返工</span><div className="production-execution-split"><input aria-label="报废数量" type="number" min="0" step="1" value={executionForm.scrapQty} onChange={event => setExecutionForm({ ...executionForm, scrapQty: event.target.value })} /><input aria-label="返工数量" type="number" min="0" step="1" value={executionForm.reworkQty} onChange={event => setExecutionForm({ ...executionForm, reworkQty: event.target.value })} /></div></label>
            <label className="wide"><span>报工备注</span><input maxLength={300} value={executionForm.remark} onChange={event => setExecutionForm({ ...executionForm, remark: event.target.value })} placeholder="可选：记录异常、换线或人员协作情况" /></label>
          </div>
          <div className="production-execution-preview">
            <span><small>标准口径</small><b>{executionContext.standard.timeBasis === 'per_batch' ? '按批' : `每${executionContext.standard.unitLabel}`} {executionContext.standard.standardMillisecondsPerUnit / 1000} 秒 × {executionContext.standard.unitsPerProduct}</b></span>
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
    <div className="dialog-actions"><button type="button" disabled={saving} onClick={close}>取消</button><button className="primary-button" type="button" disabled={saving || executionContextLoading} onClick={confirm}>{saving ? '提交中...' : isProcessAdvance ? '完成工序并进入下一步' : '确认下一步'}</button></div>
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
