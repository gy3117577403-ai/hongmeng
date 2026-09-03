'use client';
import { ProductionControlButton, ProductionNoteSummary } from '@/components/ProductionControl';
import { canAdjustProductionDates, canManageProductionControl } from '@/lib/production-control';

import {
  Archive,
  AlertTriangle,
  ArrowRight,
  Boxes,
  CalendarCheck2,
  CalendarClock,
  CalendarRange,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDashed,
  ClipboardList,
  Clock3,
  Factory,
  FileSpreadsheet,
  FilePenLine,
  FlaskConical,
  History,
  ListFilter,
  LockKeyhole,
  MoveRight,
  PackageCheck,
  PanelLeftOpen,
  Pencil,
  Plus,
  Printer,
  RefreshCw,
  Search,
  Send,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Upload,
  Warehouse,
  X,
} from 'lucide-react';
import {
  Fragment,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useToastBridge } from '@/components/ToastProvider';
import { TravelerPrintDialog } from '@/components/TravelerPrintDialog';
import { WeekReconciliationBar } from '@/components/WeekReconciliationBar';
import { AppWorkbenchHeader } from '@/components/layout/AppWorkbenchHeader';
import { ModuleModeDrawer, ModuleModeTrigger, useModuleModeDrawer } from '@/components/layout/ModuleModeDrawer';
import {
  isPlanningReadinessFilter,
  matchesPlanningReadiness,
  orderLevelReadinessFilters,
  PLANNING_READINESS_FILTERS,
  planningReadinessState,
  type PlanningReadinessFilter,
} from '@/lib/planning-readiness';
import { resolvePlanningFlow } from '@/lib/planning-flow';
import { planningProcessDisplay } from '@/lib/planning-process-display';
import { buildPlanningDrawingLibraryHref, buildPlanningReturnPath } from '@/lib/planning-navigation';
import { auxiliaryValueAfterLoad, type ClientLoadWarning } from '@/lib/client-load-resilience';
import {
  formatPlanningSopUpdatedAt,
  planningSopStage,
  planningSopStageLabels,
  planningSopTooltip,
} from '@/lib/planning-sop';
import {
  publishProductionDataInvalidation,
  subscribeProductionDataInvalidations,
} from '@/lib/production-data-client-sync';
import { productTimeConfigurationRoute } from '@/lib/workflow-routes';
import { useModalLayer } from '@/components/useModalLayer';
import type {
  CurrentUserDTO,
  ProductionPlanBatchDTO,
  ProductionPlanChangeDTO,
  ProductionPlanOrderDTO,
  ProductionPlanPriority,
  ProductionPlanProductOptionDTO,
  ProductionPlanningPeriodsDTO,
  ProductionPlanningWipContinuationDTO,
  ProductionPlanningMonthDTO,
  ProductionPlanningSummaryDTO,
} from '@/types';

type PlanningView = 'schedule' | 'month' | 'orders' | 'preparation' | 'changes' | 'history';
type ProductEntryMode = 'select' | 'create';
type EditableWeekKey = string;

const PLANNING_RETURN_STATE_KEY = 'hm-planning-return-state';
const planningWarningSeverityLabel = { LOW: '低', MEDIUM: '中', HIGH: '高', CRITICAL: '重大' } as const;

type PlanningReturnState = {
  view: PlanningView;
  keyword: string;
  customer: string;
  priority: 'all' | ProductionPlanPriority;
  readinessFilters: PlanningReadinessFilter[];
  expandedOrderId: string;
  selectedWeekStartDate?: string;
  historyWeekStartDate?: string;
  scheduleScrollTop: number;
  windowScrollY: number;
};

const readinessOptions: Array<{
  id: PlanningReadinessFilter;
  label: string;
  description: string;
}> = [
  { id: 'missing_time', label: '工时未维护', description: '没有有效单套工时' },
  { id: 'missing_drawing', label: '图纸未下发', description: '没有有效原图文件' },
  { id: 'missing_sop', label: 'SOP 未下发', description: '没有有效 SOP 文件' },
  { id: 'sop_validating', label: 'SOP 验证中', description: '允许排产并进入生产执行，清单持续提示验证状态' },
  { id: 'sop_new_product', label: '新品 SOP', description: '处于新品导入阶段的 SOP' },
  { id: 'sop_unregistered', label: 'SOP 未登记', description: '尚未维护 SOP 生命周期状态' },
  { id: 'missing_material', label: '材料未配', description: '仓库未下达或配料未完成' },
  { id: 'material_exception', label: '材料异常', description: '缺料、错料或到料异常' },
  { id: 'missing_process', label: '工艺未编排', description: '工艺路线未生成或未确认' },
  { id: 'print_not_confirmed', label: '未确认打印', description: '未生成或仅打开过打印预览' },
  { id: 'print_needs_reprint', label: '需要重打', description: '工艺、数量、图纸或 SOP 已变更' },
  { id: 'print_confirmed', label: '已确认打印', description: '实体纸张已打印并人工确认' },
  { id: 'ready_preparation', label: '可下达预备', description: '图纸、SOP 和工时均已就绪' },
  { id: 'ready_production', label: '全部准备完成', description: '生产资料、工时、配料和工艺均就绪' },
];

const readyFilters = new Set<PlanningReadinessFilter>(['ready_preparation', 'ready_production']);

type PlanningPayload = {
  ok?: boolean;
  orders?: ProductionPlanOrderDTO[];
  wipContinuations?: ProductionPlanningWipContinuationDTO[];
  summary?: ProductionPlanningSummaryDTO;
  customers?: string[];
  productOptions?: ProductionPlanProductOptionDTO[];
  salespeople?: string[];
  periods?: ProductionPlanningPeriodsDTO;
  warnings?: ClientLoadWarning[];
  error?: string;
};

const planningProductOptionsWarningCode = 'PLANNING_PRODUCT_OPTIONS_UNAVAILABLE';
const planningSalespeopleWarningCode = 'PLANNING_SALESPEOPLE_UNAVAILABLE';

type OrderForm = {
  confirmation: string;
  drawingLibraryItemId: string;
  customerName: string;
  salesperson: string;
  productName: string;
  specification: string;
  orderQuantity: string;
  planningUnitMinutes: string;
  orderDate: string;
  customerDueDate: string;
  priority: ProductionPlanPriority;
  remark: string;
  reason: string;
};

type BatchForm = {
  quantity: string;
  unitSeconds: string;
  weekStartDate: string;
  plannedCompletionDate: string;
  reason: string;
};

type ReleasePreview = {
  target: 'preparation' | 'active';
  targetWeekStartDate: string;
  targetWeekEndDate: string;
  batchCount: number;
  totalQuantity: number;
  warnings: number;
  blockers: number;
  validatingSopCount: number;
  items: Array<{
    batchId: string;
    specification: string;
    quantity: number;
    warnings: string[];
    blockers: string[];
    sopStage: ProductionPlanOrderDTO['sopStage'];
    sopRemark: string | null;
    sopMetadataUpdatedAt: string | null;
    sopValidationRequired: boolean;
  }>;
};

type DeletePreview = {
  batchCount: number;
  totalQuantity: number;
  draftDeleteCount: number;
  withdrawCount: number;
  blockers: number;
  items: Array<{
    batchId: string;
    specification: string;
    quantity: number;
    action: 'delete_draft' | 'withdraw_unstarted' | 'blocked';
    message: string;
  }>;
};

type HistoricalDeleteTarget = {
  order: ProductionPlanOrderDTO;
  batch: ProductionPlanBatchDTO;
};

type PlanningSopCarrier = Pick<ProductionPlanOrderDTO,
  'sopFileCount' | 'sopStage' | 'sopDrawingStatus' | 'sopRemark' | 'sopMetadataUpdatedAt'>;

function sopStageInfo(item: PlanningSopCarrier) {
  const stage = planningSopStage(item.sopStage);
  return {
    stage,
    label: planningSopStageLabels[stage],
    title: planningSopTooltip({
      sopFileCount: item.sopFileCount,
      sopStage: item.sopStage || null,
      sopDrawingStatus: item.sopDrawingStatus || null,
      sopRemark: item.sopRemark || null,
      sopMetadataUpdatedAt: item.sopMetadataUpdatedAt || null,
    }),
  };
}

type ActivationPreview = {
  sourceWeekStartDate?: string;
  sourceWeekEndDate?: string;
  weekStartDate: string;
  weekEndDate: string;
  batchCount: number;
  totalQuantity: number;
  warningCount: number;
  blockerCount: number;
  items: Array<{
    batchId: string;
    specification: string;
    customerName: string;
    quantity: number;
    warehouseStatus: string;
    processStatus: string;
    warnings: string[];
    blockers: string[];
  }>;
};

type MovePreview = {
  targetWeekStartDate: string;
  targetWeekEndDate: string;
  batchCount: number;
  totalQuantity: number;
  blockers: number;
  missingCount: number;
  items: Array<{
    batchId: string;
    specification: string;
    customerName: string;
    quantity: number;
    sourceWeekStartDate: string;
    sourceWeekEndDate: string;
    blockers: string[];
  }>;
};

type PlanningImportRow = {
  rowNo: number;
  status: 'ready' | 'skipped' | 'invalid' | 'duplicate' | 'conflict';
  reason: string;
  warning: string | null;
  productAction: 'reuse' | 'restore' | 'create' | 'conflict' | 'none';
  matchedDrawingLibraryItemId: string | null;
  candidates: Array<{
    id: string;
    libraryKey: string;
    customerName: string;
    productName: string | null;
    specification: string;
    deletedAt: string | null;
    drawingFileCount: number;
    sopFileCount: number;
    productTimeVersion: number | null;
  }>;
  existingPlanOrderId: string | null;
  input: {
    sourceOrderNo: string;
    sourceLineNo: number;
    customerName: string;
    productName: string;
    specification: string;
    orderQuantity: number;
    plannedQuantity: number;
    customerDueDate: string;
    plannedCompletionDate: string;
  } | null;
};

type PlanningImportPreview = {
  batchId: string;
  requestId: string;
  previewToken: string;
  sourceFileName: string;
  sourceSheetName?: string | null;
  targetWeekStartDate: string;
  targetWeekEndDate: string;
  summary: {
    totalRows: number;
    readyCount: number;
    reuseCount: number;
    restoreCount: number;
    createCount: number;
    skippedCount: number;
    invalidCount: number;
    duplicateCount: number;
    conflictCount: number;
  };
  rows: PlanningImportRow[];
};

type PlanningImportResult = {
  targetWeekStartDate: string;
  targetWeekEndDate: string;
  summary: {
    created: number;
    skipped: number;
    failed: number;
    reusedProducts: number;
    restoredProducts: number;
    createdProducts: number;
    automaticallyActive: number;
    automaticallyPrepared: number;
    total: number;
  };
  results: Array<{
    row: number;
    specification: string;
    status: 'created' | 'skipped';
    productAction: 'reuse' | 'restore' | 'create' | 'none';
    message: string;
  }>;
};

type PlanningImportHistoryRecord = {
  id: string;
  requestId: string;
  status: string;
  sourceFileName: string;
  targetWeekStartDate: string;
  targetWeekEndDate: string;
  operator: string;
  committedAt: string | null;
  createdAt: string;
  result?: { summary?: PlanningImportResult['summary'] } | null;
};

type PlanningImportDialog = {
  step: 'upload' | 'preview' | 'complete' | 'history';
  targetWeekStartDate: string;
  targetWeekEndDate: string;
  fileName: string;
  preview: PlanningImportPreview | null;
  result: PlanningImportResult | null;
  decisions: Record<string, string>;
  history: PlanningImportHistoryRecord[];
  loading: boolean;
};

type WeeklyPlanExportVersion = 'full' | 'orders';
type WeeklyPlanExportRange = 'execution' | 'current';

type WeeklyPlanExportMetric = {
  batchCount: number;
  orderCount: number;
  quantity: number;
  totalHours: number;
  quantityMissingCount: number;
  hoursMissingCount: number;
};

type WeeklyPlanExportPreview = {
  mode: 'week_execution' | 'schedule_range';
  digest?: string;
  weekStartDate: string;
  weekEndDate: string;
  summary: {
    current: WeeklyPlanExportMetric;
    previousCarryover: WeeklyPlanExportMetric;
    olderCarryover: WeeklyPlanExportMetric;
    carryover: WeeklyPlanExportMetric;
    execution: WeeklyPlanExportMetric;
  };
};

type WeeklyPlanExportDialog = {
  mode: 'week_execution' | 'schedule_range';
  startDate: string;
  endDate: string;
  version: WeeklyPlanExportVersion;
  range: WeeklyPlanExportRange;
  preview: WeeklyPlanExportPreview | null;
  loading: boolean;
  exporting: boolean;
};

const emptySummary: ProductionPlanningSummaryDTO = {
  orderCount: 0,
  pendingOrderCount: 0,
  scheduledOrderCount: 0,
  thisWeekBatchCount: 0,
  nextWeekBatchCount: 0,
  preparationBatchCount: 0,
  activeBatchCount: 0,
  missingDrawingCount: 0,
  missingSopCount: 0,
  missingProductTimeCount: 0,
  warehouseExceptionCount: 0,
  processPendingCount: 0,
};

function emptyOrderForm(): OrderForm {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
  return {
    drawingLibraryItemId: '',
    customerName: '', salesperson: '', productName: '', specification: '',
    orderQuantity: '', planningUnitMinutes: '', orderDate: today, customerDueDate: '', priority: 'normal', remark: '', reason: '', confirmation: '',
  };
}

function orderForm(order: ProductionPlanOrderDTO): OrderForm {
  return {
    confirmation: '',
    drawingLibraryItemId: order.drawingLibraryItemId || '',
    customerName: order.customerName,
    salesperson: order.salesperson || '',
    productName: order.productName,
    specification: order.specification,
    orderQuantity: String(order.orderQuantity),
    planningUnitMinutes: millisecondsInput(order.planningUnitMilliseconds || order.currentUnitMilliseconds),
    orderDate: order.orderDate,
    customerDueDate: order.customerDueDate,
    priority: order.priority,
    remark: order.remark || '',
    reason: '',
  };
}

function duration(milliseconds?: number | null): string {
  if (!milliseconds) return '待维护';
  const seconds = Math.round(milliseconds / 1000);
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} 分`;
  return `${(minutes / 60).toFixed(2)} 小时`;
}

function totalDuration(milliseconds?: string | null): string {
  if (!milliseconds) return '待计算';
  const number = Number(milliseconds);
  return Number.isFinite(number) ? duration(number) : '待计算';
}

function millisecondsInput(milliseconds?: number | null): string {
  if (!milliseconds) return '';
  return String(Number((milliseconds / 60_000).toFixed(3)));
}

function secondsInput(milliseconds?: number | null): string {
  if (!milliseconds) return '';
  return String(Number((milliseconds / 1000).toFixed(3)));
}

function planningUnitMilliseconds(order: ProductionPlanOrderDTO): number | null {
  return order.effectiveUnitMilliseconds || order.currentUnitMilliseconds || order.planningUnitMilliseconds || null;
}

function batchTotalMilliseconds(order: ProductionPlanOrderDTO, batch: ProductionPlanBatchDTO): string | null {
  if (batch.totalMillisecondsSnapshot) return batch.totalMillisecondsSnapshot;
  const unitMilliseconds = batch.unitMillisecondsSnapshot || planningUnitMilliseconds(order);
  return unitMilliseconds ? String(unitMilliseconds * batch.quantity) : null;
}

function priorityText(priority: ProductionPlanPriority): string {
  if (priority === 'insert') return '插单';
  if (priority === 'urgent') return '紧急';
  return '一般';
}

function flowTime(value?: string | null): string {
  if (!value) return '';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value));
}

function addDateDays(value: string, days: number): string {
  const date = new Date(`${value}T12:00:00+08:00`);
  date.setUTCDate(date.getUTCDate() + days);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function dayOffset(weekStartDate: string, date: string): number {
  const start = new Date(`${weekStartDate}T12:00:00+08:00`);
  const target = new Date(`${date}T12:00:00+08:00`);
  return Math.max(0, Math.min(6, Math.round((target.getTime() - start.getTime()) / 86_400_000)));
}

function editableWeekLabel(key: EditableWeekKey): string {
  if (key === 'current') return '本周';
  if (key === 'next') return '下周';
  if (key === 'afterNext') return '下下周';
  const index = Number(key.replace('future-', ''));
  return Number.isInteger(index) ? `第${index + 1}周` : '未来周';
}

function currentPlanningMonth(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit' })
    .format(new Date()).slice(0, 7);
}

function shiftPlanningMonth(month: string, offset: number): string {
  const value = new Date(`${month}-01T00:00:00.000Z`);
  value.setUTCMonth(value.getUTCMonth() + offset);
  return value.toISOString().slice(0, 7);
}

function weekLabel(batch: ProductionPlanBatchDTO, periods?: PlanningPayload['periods']): string {
  if (!periods) return '计划周';
  if (batch.weekStartDate === periods.current.weekStartDate) return '本周';
  if (batch.weekStartDate === periods.next.weekStartDate) return '下周';
  if (batch.weekStartDate === periods.afterNext.weekStartDate) return '下下周';
  if (batch.weekEndDate < periods.current.weekStartDate) return '历史周';
  return '未来周';
}

function linkedWeekScope(
  batch: ProductionPlanBatchDTO,
  periods?: PlanningPayload['periods'],
): 'history' | 'current' | 'next' | 'afterNext' {
  if (!periods || batch.weekStartDate < periods.current.weekStartDate) return 'history';
  if (batch.weekStartDate === periods.next.weekStartDate) return 'next';
  if (batch.weekStartDate === periods.afterNext.weekStartDate) return 'afterNext';
  return 'current';
}

function productionExecutionHref(
  batch: ProductionPlanBatchDTO,
  periods?: PlanningPayload['periods'],
  forceCarryover = false,
): string {
  const scope = forceCarryover ? 'carryover' : linkedWeekScope(batch, periods);
  const params = new URLSearchParams({ scope });
  if (scope === 'history') params.set('weekStart', batch.weekStartDate);
  if (batch.workOrderId) params.set('workOrderId', batch.workOrderId);
  return `/production?${params.toString()}`;
}

function workflowCenterParams(
  batch: ProductionPlanBatchDTO,
  periods?: PlanningPayload['periods'],
): URLSearchParams {
  const weekScope = linkedWeekScope(batch, periods);
  const params = new URLSearchParams({
    entityType: 'production',
    batchId: batch.id,
    from: 'planning',
    weekScope,
    returnTo: buildPlanningReturnPath({ batchId: batch.id, weekStartDate: batch.weekStartDate }),
  });
  if (weekScope === 'history') params.set('weekStart', batch.weekStartDate);
  if (batch.workOrderId) params.set('workOrderId', batch.workOrderId);
  return params;
}

function planningFlow(order: ProductionPlanOrderDTO, batch: ProductionPlanBatchDTO) {
  return resolvePlanningFlow({
    releaseState: batch.releaseState,
    drawingReady: order.drawingFileCount > 0,
    sopReady: order.sopFileCount > 0,
    timeReady: Boolean(batch.unitMillisecondsSnapshot || planningUnitMilliseconds(order)),
    warehouseStatus: batch.warehouseStatus,
    processStatus: batch.processStatus,
    currentProcessName: batch.currentProcessName,
    workOrderStartedAt: batch.workOrderStartedAt,
    workOrderCompletedAt: batch.workOrderCompletedAt,
    processCompletedAt: batch.processCompletedAt,
  });
}

function travelerPrintStatus(batch: ProductionPlanBatchDTO): { label: string; tone: string; time: string | null } {
  const status = batch.travelerPrintStatus || 'not_printed';
  if (status === 'printed') return { label: '已打印', tone: 'ready', time: batch.travelerPrintConfirmedAt || null };
  if (status === 'needs_reprint') return { label: '待重打', tone: 'danger', time: batch.travelerPrintConfirmedAt || batch.travelerPrintGeneratedAt || null };
  if (status === 'partial') return { label: '部分完成', tone: 'warning', time: batch.travelerPrintGeneratedAt || null };
  if (status === 'generated') return { label: '待确认', tone: 'warning', time: batch.travelerPrintGeneratedAt || null };
  if (status === 'legacy_unverified') return { label: '待核验', tone: 'warning', time: batch.travelerPrintGeneratedAt || null };
  return { label: '未打印', tone: 'muted', time: null };
}

function changeActionText(action: string): string {
  const labels: Record<string, string> = {
    create_plan_order: '新建订单', update_plan_order: '修改订单', update_released_plan_order: '变更已下达订单',
    delete_plan_order: '删除订单', create_plan_batch: '新增排产批次', update_plan_batch: '调整排产',
    direct_delete_plan_order: '删除历史订单',
    update_released_plan_batch: '调整已下达批次', delete_plan_batch: '删除排产批次',
    move_plan_batch_week: '调配生产周', import_plan_week: '导入周排单',
    release_to_current_week: '下达本周执行', release_to_next_week: '下达下周预备', activate_preparation_week: '启用为本周执行',
    repair_active_plan_week_alignment: '修复执行周次',
  };
  return labels[action] || action;
}

async function responseBody<T>(response: Response): Promise<T & { error?: string; requiresConfirmation?: boolean; requiresProductRestore?: boolean }> {
  return response.json().catch(() => ({})) as Promise<T & { error?: string; requiresConfirmation?: boolean; requiresProductRestore?: boolean }>;
}

function weeklyPlanExportHours(metric: WeeklyPlanExportMetric): string {
  const known = `${metric.totalHours.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}h`;
  return metric.hoursMissingCount ? `${known} + ${metric.hoursMissingCount}批待补` : known;
}

function planningCapacityRate(numerator: string, denominator: string): string {
  const top = Number(numerator);
  const bottom = Number(denominator);
  if (!Number.isFinite(top) || !Number.isFinite(bottom) || bottom <= 0) return '—';
  return `${(top / bottom * 100).toFixed(1)}%`;
}

function responseDownloadFileName(response: Response, fallback: string): string {
  const disposition = response.headers.get('Content-Disposition') || '';
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
  if (!encoded) return fallback;
  try {
    return decodeURIComponent(encoded);
  } catch {
    return fallback;
  }
}

function productTimeHref(
  order: ProductionPlanOrderDTO,
  batch: ProductionPlanBatchDTO,
  periods?: PlanningPayload['periods'],
): string {
  const weekScope = linkedWeekScope(batch, periods);
  const scope = weekScope === 'afterNext' ? undefined : weekScope;
  return productTimeConfigurationRoute(order.drawingLibraryItemId, {
    scope,
    from: 'planning',
    returnTo: buildPlanningReturnPath({ batchId: batch.id, weekStartDate: batch.weekStartDate }),
    batchId: batch.id,
    workOrderId: batch.workOrderId,
    weekStartDate: batch.weekStartDate,
    weekEndDate: batch.weekEndDate,
  });
}

export default function PlanningCenterShell({
  user,
  modeDrawerInitiallyOpen = false,
}: {
  user: CurrentUserDTO;
  modeDrawerInitiallyOpen?: boolean;
}) {
  const modeDrawer = useModuleModeDrawer(modeDrawerInitiallyOpen);
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [view, setView] = useState<PlanningView>('schedule');
  const [orders, setOrders] = useState<ProductionPlanOrderDTO[]>([]);
  const [wipContinuations, setWipContinuations] = useState<ProductionPlanningWipContinuationDTO[]>([]);
  const [summary, setSummary] = useState<ProductionPlanningSummaryDTO>(emptySummary);
  const [customers, setCustomers] = useState<string[]>([]);
  const [productOptions, setProductOptions] = useState<ProductionPlanProductOptionDTO[]>([]);
  const [salespeople, setSalespeople] = useState<string[]>([]);
  const [periods, setPeriods] = useState<PlanningPayload['periods']>();
  const [selectedMonth, setSelectedMonth] = useState(currentPlanningMonth);
  const [monthData, setMonthData] = useState<ProductionPlanningMonthDTO | null>(null);
  const [monthLoading, setMonthLoading] = useState(false);
  const [selectedWeekStartDate, setSelectedWeekStartDate] = useState('');
  const [historyWeekStartDate, setHistoryWeekStartDate] = useState('');
  const [carryoverOpen, setCarryoverOpen] = useState(false);
  const [orderPoolOpen, setOrderPoolOpen] = useState(false);
  const [moveTargetWeekStartDate, setMoveTargetWeekStartDate] = useState('');
  const [keyword, setKeyword] = useState('');
  const [customer, setCustomer] = useState('');
  const [priority, setPriority] = useState<'all' | ProductionPlanPriority>('all');
  const [readinessFilters, setReadinessFilters] = useState<PlanningReadinessFilter[]>([]);
  const [readinessOpen, setReadinessOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [planLoadError, setPlanLoadError] = useState('');
  const [planLoadWarnings, setPlanLoadWarnings] = useState<ClientLoadWarning[]>([]);
  const [lastPlanLoadedAt, setLastPlanLoadedAt] = useState<Date | null>(null);
  const [toast, setToast] = useState('');
  useToastBridge(toast, setToast);
  const [refreshToken, setRefreshToken] = useState(0);
  const planRequestInFlightRef = useRef(false);
  const planRefreshPendingRef = useRef(false);
  useEffect(() => {
    const refreshControl = () => {
      if (planRequestInFlightRef.current) {
        planRefreshPendingRef.current = true;
        return;
      }
      setRefreshToken(value => value + 1);
    };
    window.addEventListener('production-control-updated', refreshControl);
    return () => window.removeEventListener('production-control-updated', refreshControl);
  }, []);
  useEffect(() => subscribeProductionDataInvalidations(invalidation => {
    if (!invalidation.kind.startsWith('wip-')) return;
    if (planRequestInFlightRef.current) {
      planRefreshPendingRef.current = true;
      return;
    }
    setRefreshToken(value => value + 1);
  }), []);
  const [expandedOrderId, setExpandedOrderId] = useState('');
  const [selectedBatchIds, setSelectedBatchIds] = useState<string[]>([]);
  const [travelerPrintIds, setTravelerPrintIds] = useState<string[]>([]);
  const [orderDialog, setOrderDialog] = useState<{ mode: 'create' | 'edit'; orderId?: string } | null>(null);
  const [orderDraft, setOrderDraft] = useState<OrderForm>(emptyOrderForm);
  const [productKeyword, setProductKeyword] = useState('');
  const [productPickerOpen, setProductPickerOpen] = useState(false);
  const [productEntryMode, setProductEntryMode] = useState<ProductEntryMode>('select');
  const [activeProductIndex, setActiveProductIndex] = useState(-1);
  const [batchDialog, setBatchDialog] = useState<{ orderId: string; batchId?: string } | null>(null);
  const [batchDraft, setBatchDraft] = useState<BatchForm>({ quantity: '', unitSeconds: '', weekStartDate: '', plannedCompletionDate: '', reason: '' });
  const [releasePreview, setReleasePreview] = useState<ReleasePreview | null>(null);
  const [deletePreview, setDeletePreview] = useState<DeletePreview | null>(null);
  const [historicalDeleteTarget, setHistoricalDeleteTarget] = useState<HistoricalDeleteTarget | null>(null);
  const [historicalDeleteReason, setHistoricalDeleteReason] = useState('');
  const [historicalDeleteCode, setHistoricalDeleteCode] = useState('');
  const [historicalDeleteClosing, setHistoricalDeleteClosing] = useState(false);
  const [activationPreview, setActivationPreview] = useState<ActivationPreview | null>(null);
  const [movePreview, setMovePreview] = useState<MovePreview | null>(null);
  const [moveBatchIds, setMoveBatchIds] = useState<string[]>([]);
  const [importDialog, setImportDialog] = useState<PlanningImportDialog | null>(null);
  const [weeklyPlanExportDialog, setWeeklyPlanExportDialog] = useState<WeeklyPlanExportDialog | null>(null);
  const [changes, setChanges] = useState<ProductionPlanChangeDTO[]>([]);
  const [changesLoading, setChangesLoading] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const dialogTriggerRef = useRef<HTMLElement | null>(null);
  const historicalDeleteCodeRef = useRef<HTMLInputElement>(null);
  const historicalDeleteCloseTimerRef = useRef<number | null>(null);
  const historicalDeleteMotionFrameRef = useRef<number | null>(null);
  const productPickerRef = useRef<HTMLDivElement>(null);
  const productSearchInputRef = useRef<HTMLInputElement>(null);
  const readinessFilterRef = useRef<HTMLDivElement>(null);
  const readinessTriggerRef = useRef<HTMLButtonElement>(null);
  const scheduleScrollRef = useRef<HTMLDivElement>(null);
  const orderPoolTriggerRef = useRef<HTMLButtonElement>(null);
  const orderPoolCloseRef = useRef<HTMLButtonElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const requestedWeekStartRef = useRef('');
  const weekScrollPositionsRef = useRef(new Map<string, number>());
  const pendingReturnScrollRef = useRef<{ scheduleScrollTop: number; windowScrollY: number } | null>(null);
  const pendingBatchFocusRef = useRef<string | null>(null);
  const lastExternalRefreshRef = useRef(0);
  const activeDialog = Boolean(orderDialog || batchDialog || releasePreview || deletePreview || historicalDeleteTarget || activationPreview || movePreview || importDialog || weeklyPlanExportDialog);

  useModalLayer({
    open: activeDialog,
    layerRef: dialogRef,
    triggerRef: dialogTriggerRef,
    initialFocusRef: historicalDeleteTarget ? historicalDeleteCodeRef : undefined,
    backgroundRef: mainRef,
    onClose: handleDialogEscape,
    interactionEnabled: !historicalDeleteClosing,
  });

  useEffect(() => () => {
    if (historicalDeleteCloseTimerRef.current !== null) window.clearTimeout(historicalDeleteCloseTimerRef.current);
    if (historicalDeleteMotionFrameRef.current !== null) window.cancelAnimationFrame(historicalDeleteMotionFrameRef.current);
  }, []);

  useEffect(() => {
    if (!orderPoolOpen) return undefined;
    orderPoolCloseRef.current?.focus();
    function onKeyDown(event: globalThis.KeyboardEvent): void {
      if (event.key !== 'Escape') return;
      setOrderPoolOpen(false);
      window.setTimeout(() => orderPoolTriggerRef.current?.focus(), 0);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [orderPoolOpen]);

  useEffect(() => {
    const controller = new AbortController();
    planRequestInFlightRef.current = true;
    setLoading(true);
    setPlanLoadError('');
    setPlanLoadWarnings([]);
    fetch('/api/planning/orders', { cache: 'no-store', signal: controller.signal })
      .then(async response => {
        const body = await responseBody<PlanningPayload>(response);
        if (response.status === 401) { location.href = '/login'; return null; }
        if (!response.ok) throw new Error(body.error || '计划中心加载失败');
        return body;
      })
      .then(body => {
        if (!body) return;
        const loadWarnings = Array.isArray(body.warnings)
          ? body.warnings.filter((warning): warning is ClientLoadWarning => Boolean(warning && typeof warning.code === 'string'))
          : [];
        setOrders(body.orders || []);
        setWipContinuations(body.wipContinuations || []);
        setSummary(body.summary || emptySummary);
        setCustomers(body.customers || []);
        setProductOptions(current => auxiliaryValueAfterLoad(
          current,
          body.productOptions || [],
          loadWarnings,
          planningProductOptionsWarningCode,
        ));
        setSalespeople(current => auxiliaryValueAfterLoad(
          current,
          body.salespeople || [],
          loadWarnings,
          planningSalespeopleWarningCode,
        ));
        setPlanLoadWarnings(loadWarnings);
        setPeriods(body.periods);
        setLastPlanLoadedAt(new Date());
        if (body.periods) {
          const editableStarts = (body.periods.upcoming?.length
            ? body.periods.upcoming
            : [body.periods.current, body.periods.next, body.periods.afterNext])
            .map(item => item.weekStartDate);
          const requestedWeekStartDate = requestedWeekStartRef.current;
          setSelectedWeekStartDate(current => (
            editableStarts.includes(current)
              ? current
              : editableStarts.includes(requestedWeekStartDate)
                ? requestedWeekStartDate
                : body.periods!.current.weekStartDate
          ));
          setHistoryWeekStartDate(current => (
            body.periods!.history.some(item => item.weekStartDate === current)
              ? current
              : body.periods!.history.some(item => item.weekStartDate === requestedWeekStartDate)
                ? requestedWeekStartDate
                : body.periods!.history[0]?.weekStartDate || ''
          ));
          if (body.periods.history.some(item => item.weekStartDate === requestedWeekStartDate)) {
            setView('history');
          }
        }
      })
      .catch(reason => {
        if (reason instanceof Error && reason.name !== 'AbortError') setPlanLoadError(reason.message);
      })
      .finally(() => {
        if (controller.signal.aborted) return;
        planRequestInFlightRef.current = false;
        setLoading(false);
        if (planRefreshPendingRef.current) {
          planRefreshPendingRef.current = false;
          setRefreshToken(value => value + 1);
        }
      });
    return () => controller.abort();
  }, [refreshToken]);

  useEffect(() => {
    if (view !== 'month') return undefined;
    const controller = new AbortController();
    setMonthLoading(true);
    setError('');
    fetch(`/api/planning/month?month=${encodeURIComponent(selectedMonth)}`, { cache: 'no-store', signal: controller.signal })
      .then(async response => {
        const body = await responseBody<{ month?: ProductionPlanningMonthDTO }>(response);
        if (response.status === 401) { location.href = '/login'; return null; }
        if (!response.ok || !body.month) throw new Error(body.error || '月度排产加载失败');
        return body.month;
      })
      .then(month => { if (month) setMonthData(month); })
      .catch(reason => {
        if (reason instanceof Error && reason.name !== 'AbortError') setError(reason.message);
      })
      .finally(() => { if (!controller.signal.aborted) setMonthLoading(false); });
    return () => controller.abort();
  }, [refreshToken, selectedMonth, view]);

  useEffect(() => {
    if (!productPickerOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || productPickerRef.current?.contains(event.target)) return;
      setProductPickerOpen(false);
      setActiveProductIndex(-1);
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer, true);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer, true);
  }, [productPickerOpen]);

  useEffect(() => {
    const search = new URLSearchParams(window.location.search);
    if (search.get('restore') === '1') {
      const stored = window.sessionStorage.getItem(PLANNING_RETURN_STATE_KEY);
      if (stored) {
        try {
          const state = JSON.parse(stored) as PlanningReturnState;
          setView(state.view);
          setKeyword(state.keyword);
          setCustomer(state.customer);
          setPriority(state.priority);
          setReadinessFilters(state.readinessFilters.filter(isPlanningReadinessFilter));
          setExpandedOrderId(state.expandedOrderId);
          if (state.selectedWeekStartDate) {
            requestedWeekStartRef.current = state.selectedWeekStartDate;
            setSelectedWeekStartDate(state.selectedWeekStartDate);
          }
          if (state.historyWeekStartDate) setHistoryWeekStartDate(state.historyWeekStartDate);
          pendingReturnScrollRef.current = {
            scheduleScrollTop: state.scheduleScrollTop || 0,
            windowScrollY: state.windowScrollY || 0,
          };
          window.sessionStorage.removeItem(PLANNING_RETURN_STATE_KEY);
          return;
        } catch {
          window.sessionStorage.removeItem(PLANNING_RETURN_STATE_KEY);
        }
      }
    }
    const requestedWeekStartDate = String(search.get('week') || '').trim();
    requestedWeekStartRef.current = requestedWeekStartDate;
    const batchId = search.get('batchId');
    if (batchId) {
      setView('schedule');
      setExpandedOrderId(batchId);
      pendingBatchFocusRef.current = batchId;
    }
    const values = search.get('readiness')?.split(',').filter(isPlanningReadinessFilter) || [];
    if (values.length === 0) return;
    const readyValue = values.find(value => readyFilters.has(value));
    setReadinessFilters(readyValue ? [readyValue] : [...new Set(values)]);
  }, []);

  useEffect(() => {
    if (!readinessOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || readinessFilterRef.current?.contains(event.target)) return;
      setReadinessOpen(false);
    };
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setReadinessOpen(false);
      readinessTriggerRef.current?.focus();
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer, true);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer, true);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [readinessOpen]);

  useEffect(() => {
    const refreshAfterExternalChange = () => {
      if (document.visibilityState !== 'visible') return;
      if (planRequestInFlightRef.current) {
        planRefreshPendingRef.current = true;
        return;
      }
      const now = Date.now();
      if (now - lastExternalRefreshRef.current < 1200) return;
      lastExternalRefreshRef.current = now;
      setRefreshToken(value => value + 1);
    };
    window.addEventListener('focus', refreshAfterExternalChange);
    document.addEventListener('visibilitychange', refreshAfterExternalChange);
    return () => {
      window.removeEventListener('focus', refreshAfterExternalChange);
      document.removeEventListener('visibilitychange', refreshAfterExternalChange);
    };
  }, []);

  useEffect(() => {
    if (view !== 'changes') return;
    setChangesLoading(true);
    fetch('/api/planning/changes', { cache: 'no-store' })
      .then(async response => {
        const body = await responseBody<{ changes?: ProductionPlanChangeDTO[] }>(response);
        if (!response.ok) throw new Error(body.error || '变更记录加载失败');
        setChanges(body.changes || []);
      })
      .catch(reason => setError(reason instanceof Error ? reason.message : '变更记录加载失败'))
      .finally(() => setChangesLoading(false));
  }, [view, refreshToken]);

  const allBatches = useMemo(() => orders.flatMap(order => order.batches.map(batch => ({ order, batch }))), [orders]);
  const editableWeeks = useMemo(() => periods
    ? (periods.upcoming?.length ? periods.upcoming : [periods.current, periods.next, periods.afterNext]).map((week, index) => ({
        key: index === 0 ? 'current' : index === 1 ? 'next' : index === 2 ? 'afterNext' : `future-${index}`,
        ...week,
      }))
    : [], [periods]);
  const selectedWeek = editableWeeks.find(item => item.weekStartDate === selectedWeekStartDate)
    || editableWeeks[0]
    || null;
  const selectedWeekKey = selectedWeek?.key || 'current';
  const selectedHistoryWeek = periods?.history.find(item => item.weekStartDate === historyWeekStartDate)
    || periods?.history[0]
    || null;
  const moveTargetWeeks = useMemo(
    () => editableWeeks.filter(item => item.weekStartDate !== selectedWeek?.weekStartDate),
    [editableWeeks, selectedWeek?.weekStartDate],
  );
  useEffect(() => {
    if (moveTargetWeeks.some(item => item.weekStartDate === moveTargetWeekStartDate)) return;
    const preferred = selectedWeekKey === 'current'
      ? editableWeeks.find(item => item.key === 'next')
      : editableWeeks.find(item => item.key === 'current');
    setMoveTargetWeekStartDate(preferred?.weekStartDate || moveTargetWeeks[0]?.weekStartDate || '');
  }, [editableWeeks, moveTargetWeekStartDate, moveTargetWeeks, selectedWeekKey]);
  const selectedProduct = useMemo(
    () => productOptions.find(item => item.id === orderDraft.drawingLibraryItemId) || null,
    [orderDraft.drawingLibraryItemId, productOptions],
  );
  const batchOrder = useMemo(
    () => batchDialog ? orders.find(item => item.id === batchDialog.orderId) || null : null,
    [batchDialog, orders],
  );
  const orderDraftUnitMilliseconds = useMemo(() => {
    const minutes = Number(orderDraft.planningUnitMinutes);
    return Number.isFinite(minutes) && minutes > 0 ? Math.round(minutes * 60_000) : null;
  }, [orderDraft.planningUnitMinutes]);
  const orderDraftTotalMilliseconds = useMemo(() => {
    const quantity = Number(orderDraft.orderQuantity);
    return orderDraftUnitMilliseconds && Number.isInteger(quantity) && quantity > 0
      ? orderDraftUnitMilliseconds * quantity
      : null;
  }, [orderDraft.orderQuantity, orderDraftUnitMilliseconds]);
  const batchDraftUnitMilliseconds = useMemo(() => {
    const seconds = Number(batchDraft.unitSeconds);
    const milliseconds = Math.round(seconds * 1000);
    return Number.isFinite(seconds) && milliseconds > 0 && milliseconds <= 86_400_000
      ? milliseconds
      : null;
  }, [batchDraft.unitSeconds]);
  const batchDraftTotalMilliseconds = useMemo(() => {
    const quantity = Number(batchDraft.quantity);
    return batchDraftUnitMilliseconds && Number.isInteger(quantity) && quantity > 0
      ? batchDraftUnitMilliseconds * quantity
      : null;
  }, [batchDraft.quantity, batchDraftUnitMilliseconds]);
  const batchDraftAutomaticReleaseTarget = batchDraft.weekStartDate === periods?.current.weekStartDate
    ? 'active'
    : batchDraft.weekStartDate === periods?.next.weekStartDate
      ? 'preparation'
      : null;
  const batchReleaseState = batchDialog?.batchId
    ? batchOrder?.batches.find(item => item.id === batchDialog.batchId)?.releaseState || null
    : null;
  const batchHasSopValidationWarning = Boolean(
    batchDraftAutomaticReleaseTarget
    && batchOrder?.sopStage === 'validating'
    && (!batchReleaseState || batchReleaseState === 'draft'),
  );
  const canSaveBatch = useMemo(() => {
    const quantity = Number(batchDraft.quantity);
    const timeIsValid = !batchDraft.unitSeconds.trim() || Boolean(batchDraftUnitMilliseconds);
    return Number.isInteger(quantity) && quantity > 0
      && Boolean(batchDraft.weekStartDate && batchDraft.plannedCompletionDate)
      && timeIsValid;
  }, [batchDraft.plannedCompletionDate, batchDraft.quantity, batchDraft.unitSeconds, batchDraft.weekStartDate, batchDraftUnitMilliseconds]);
  const visibleProductOptions = useMemo(() => {
    const word = productKeyword.trim().toLocaleLowerCase();
    const filtered = word
      ? productOptions.filter(item => [item.customerName, item.customerCode || '', item.specification, item.productName, item.sopRemark || '']
          .some(value => value.toLocaleLowerCase().includes(word)))
      : productOptions;
    return filtered.slice(0, 18);
  }, [productKeyword, productOptions]);
  useEffect(() => {
    setActiveProductIndex(current => visibleProductOptions.length
      ? Math.min(Math.max(current, 0), visibleProductOptions.length - 1)
      : -1);
  }, [visibleProductOptions]);
  const canSaveOrder = useMemo(() => {
    const productReady = productEntryMode === 'create'
      ? Boolean(orderDraft.customerName.trim() && orderDraft.specification.trim() && orderDraft.productName.trim())
      : Boolean(orderDraft.drawingLibraryItemId);
    const quantity = Number(orderDraft.orderQuantity);
    const timeIsValid = !orderDraft.planningUnitMinutes.trim()
      || Boolean(orderDraftUnitMilliseconds && orderDraftUnitMilliseconds <= 86_400_000);
    return productReady
      && Number.isInteger(quantity) && quantity > 0
      && Boolean(orderDraft.orderDate && orderDraft.customerDueDate)
      && timeIsValid;
  }, [orderDraft.customerDueDate, orderDraft.customerName, orderDraft.drawingLibraryItemId, orderDraft.orderDate, orderDraft.orderQuantity, orderDraft.planningUnitMinutes, orderDraft.productName, orderDraft.specification, orderDraftUnitMilliseconds, productEntryMode]);
  const baseFilteredOrders = useMemo(() => {
    const word = keyword.trim().toLocaleLowerCase();
    return orders.filter(order => {
      if (customer && order.customerName !== customer) return false;
      if (priority !== 'all' && order.priority !== priority) return false;
      if (!word) return true;
      return [order.customerName, order.salesperson || '', order.productName, order.specification, order.remark || '', order.sopRemark || '']
        .some(value => value.toLocaleLowerCase().includes(word));
    });
  }, [orders, keyword, customer, priority]);
  const orderReadiness = useMemo(() => orderLevelReadinessFilters(readinessFilters), [readinessFilters]);
  const filteredOrders = useMemo(() => (
    orderReadiness.length
      ? baseFilteredOrders.filter(order => matchesPlanningReadiness(order, undefined, orderReadiness))
      : baseFilteredOrders
  ), [baseFilteredOrders, orderReadiness]);
  const orderPool = filteredOrders.filter(order => order.remainingQuantity > 0 && order.status !== 'cancelled' && order.status !== 'completed');
  const baseOpenScheduleRows = useMemo(() => allBatches.filter(({ order, batch }) => {
    if (batch.releaseState === 'archived' && batch.workOrderCompletedAt) return false;
    if (customer && order.customerName !== customer) return false;
    if (priority !== 'all' && order.priority !== priority) return false;
    const word = keyword.trim().toLocaleLowerCase();
    return !word || [order.customerName, order.salesperson || '', order.productName, order.specification, order.sopRemark || ''].some(value => value.toLocaleLowerCase().includes(word));
  }), [allBatches, customer, keyword, priority]);
  const baseScheduleRows = useMemo(() => baseOpenScheduleRows.filter(({ batch }) => (
    Boolean(selectedWeekStartDate) && batch.weekStartDate === selectedWeekStartDate
  )), [baseOpenScheduleRows, selectedWeekStartDate]);
  const scheduleRows = useMemo(() => baseScheduleRows.filter(({ order, batch }) => (
    matchesPlanningReadiness(order, batch, readinessFilters)
  )), [baseScheduleRows, readinessFilters]);
  const selectedWipContinuations = useMemo(() => {
    const word = keyword.trim().toLocaleLowerCase('zh-CN');
    return wipContinuations.filter(item => {
      if (!selectedWeekStartDate || item.targetWeekStartDate !== selectedWeekStartDate) return false;
      if (customer && item.customerName !== customer) return false;
      if (!word) return true;
      return [item.customerName, item.productName, item.specification, item.lotNo, item.workOrderCode]
        .some(value => value.toLocaleLowerCase('zh-CN').includes(word));
    });
  }, [customer, keyword, selectedWeekStartDate, wipContinuations]);
  const carryoverRows = useMemo(() => (
    periods
      ? baseOpenScheduleRows.filter(({ batch }) => batch.weekEndDate < periods.current.weekStartDate)
      : []
  ), [baseOpenScheduleRows, periods]);
  useEffect(() => {
    if (loading || !pendingReturnScrollRef.current) return;
    const saved = pendingReturnScrollRef.current;
    pendingReturnScrollRef.current = null;
    const frame = window.requestAnimationFrame(() => {
      if (scheduleScrollRef.current) scheduleScrollRef.current.scrollTop = saved.scheduleScrollTop;
      window.scrollTo({ top: saved.windowScrollY, behavior: 'auto' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [loading, scheduleRows.length]);
  useEffect(() => {
    if (loading || !pendingBatchFocusRef.current || !scheduleScrollRef.current) return;
    const batchId = pendingBatchFocusRef.current;
    const row = Array.from(scheduleScrollRef.current.querySelectorAll<HTMLTableRowElement>('tr[data-batch-id]'))
      .find(item => item.dataset.batchId === batchId);
    if (!row) return;
    pendingBatchFocusRef.current = null;
    const frame = window.requestAnimationFrame(() => {
      row.scrollIntoView({ block: 'center', behavior: 'auto' });
      row.querySelector<HTMLButtonElement>('.planning-product-link')?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [loading, scheduleRows.length]);
  const basePreparationRows = useMemo(() => baseOpenScheduleRows.filter(item => (
    item.batch.releaseState === 'preparation'
      && (!periods || item.batch.weekStartDate === periods.next.weekStartDate)
  )), [baseOpenScheduleRows, periods]);
  const preparationRows = useMemo(() => basePreparationRows.filter(({ order, batch }) => (
    matchesPlanningReadiness(order, batch, readinessFilters)
  )), [basePreparationRows, readinessFilters]);
  const baseHistoryRows = useMemo(() => allBatches.filter(({ order, batch }) => {
    if (!periods || batch.weekEndDate >= periods.current.weekStartDate) return false;
    if (customer && order.customerName !== customer) return false;
    if (priority !== 'all' && order.priority !== priority) return false;
    const word = keyword.trim().toLocaleLowerCase();
    return !word || [order.customerName, order.salesperson || '', order.productName, order.specification]
      .some(value => value.toLocaleLowerCase().includes(word));
  }), [allBatches, customer, keyword, periods, priority]);
  const historyRows = useMemo(() => baseHistoryRows.filter(({ batch }) => (
    Boolean(selectedHistoryWeek) && batch.weekStartDate === selectedHistoryWeek?.weekStartDate
  )), [baseHistoryRows, selectedHistoryWeek]);
  const readinessCounts = useMemo(() => {
    const result = Object.fromEntries(PLANNING_READINESS_FILTERS.map(filter => [filter, 0])) as Record<PlanningReadinessFilter, number>;
    if (view === 'orders') {
      for (const order of baseFilteredOrders) {
        const state = planningReadinessState(order);
        for (const filter of PLANNING_READINESS_FILTERS) if (state[filter]) result[filter] += 1;
      }
      return result;
    }
    const sourceRows = view === 'preparation' ? basePreparationRows : baseScheduleRows;
    for (const { order, batch } of sourceRows) {
      const state = planningReadinessState(order, batch);
      for (const filter of PLANNING_READINESS_FILTERS) if (state[filter]) result[filter] += 1;
    }
    return result;
  }, [baseFilteredOrders, basePreparationRows, baseScheduleRows, view]);
  const readinessLabel = readinessFilters.length === 0
    ? '准备状态'
    : readinessFilters.length === 1
      ? readinessOptions.find(option => option.id === readinessFilters[0])?.label || '准备状态'
      : `准备状态 ${readinessFilters.length}`;
  const readinessDisabled = view === 'changes' || view === 'history' || view === 'month';
  const selectedWeekQuantity = baseScheduleRows.reduce((sum, item) => sum + item.batch.quantity, 0);
  const selectedWeekTotalMilliseconds = baseScheduleRows.reduce((sum, item) => {
    const total = batchTotalMilliseconds(item.order, item.batch);
    return sum + (total ? Number(total) : 0);
  }, 0);
  const selectedWipQuantity = selectedWipContinuations.reduce((sum, item) => sum + item.quantity, 0);
  const selectedWipMilliseconds = selectedWipContinuations.reduce((sum, item) => sum + item.plannedStandardMilliseconds, 0);
  const carryoverQuantity = carryoverRows.reduce((sum, item) => sum + item.batch.quantity, 0);
  const historyQuantity = historyRows.reduce((sum, item) => sum + item.batch.quantity, 0);
  const editingBatch = batchDialog?.batchId
    ? allBatches.find(item => item.batch.id === batchDialog.batchId)?.batch || null
    : null;

  function persistReadinessFilters(next: PlanningReadinessFilter[]): void {
    setReadinessFilters(next);
    const url = new URL(window.location.href);
    if (next.length) url.searchParams.set('readiness', next.join(','));
    else url.searchParams.delete('readiness');
    window.history.replaceState(window.history.state, '', url);
  }

  function rememberPlanningState(): void {
    const state: PlanningReturnState = {
      view,
      keyword,
      customer,
      priority,
      readinessFilters,
      expandedOrderId,
      selectedWeekStartDate,
      historyWeekStartDate,
      scheduleScrollTop: scheduleScrollRef.current?.scrollTop || 0,
      windowScrollY: window.scrollY,
    };
    window.sessionStorage.setItem(PLANNING_RETURN_STATE_KEY, JSON.stringify(state));
  }

  function toggleReadinessFilter(filter: PlanningReadinessFilter): void {
    if (readyFilters.has(filter)) {
      persistReadinessFilters(readinessFilters.includes(filter) ? [] : [filter]);
      return;
    }
    const deficiencyFilters = readinessFilters.filter(item => !readyFilters.has(item));
    const next = deficiencyFilters.includes(filter)
      ? deficiencyFilters.filter(item => item !== filter)
      : [...deficiencyFilters, filter];
    persistReadinessFilters(next);
  }

  function writeWeekToUrl(weekStartDate: string): void {
    requestedWeekStartRef.current = weekStartDate;
    const url = new URL(window.location.href);
    if (weekStartDate) url.searchParams.set('week', weekStartDate);
    else url.searchParams.delete('week');
    window.history.replaceState(window.history.state, '', url);
  }

  function selectScheduleWeek(weekStartDate: string): void {
    if (selectedWeekStartDate) {
      weekScrollPositionsRef.current.set(selectedWeekStartDate, scheduleScrollRef.current?.scrollTop || 0);
    }
    setSelectedWeekStartDate(weekStartDate);
    setSelectedBatchIds([]);
    setExpandedOrderId('');
    setView('schedule');
    setReadinessOpen(false);
    writeWeekToUrl(weekStartDate);
    window.requestAnimationFrame(() => {
      if (scheduleScrollRef.current) {
        scheduleScrollRef.current.scrollTop = weekScrollPositionsRef.current.get(weekStartDate) || 0;
      }
    });
  }

  function selectHistoryWeek(weekStartDate: string): void {
    setHistoryWeekStartDate(weekStartDate);
    setSelectedBatchIds([]);
    setExpandedOrderId('');
    setView('history');
    setReadinessOpen(false);
    persistReadinessFilters([]);
    writeWeekToUrl(weekStartDate);
  }

  function selectView(nextView: PlanningView): void {
    if (nextView !== 'schedule') setOrderPoolOpen(false);
    if (nextView === 'schedule') {
      selectScheduleWeek(selectedWeek?.weekStartDate || periods?.current.weekStartDate || '');
      return;
    }
    if (nextView === 'history') {
      selectHistoryWeek(selectedHistoryWeek?.weekStartDate || periods?.history[0]?.weekStartDate || '');
      return;
    }
    setView(nextView);
    setReadinessOpen(false);
    if (nextView === 'orders') {
      persistReadinessFilters(orderLevelReadinessFilters(readinessFilters));
      return;
    }
    if (nextView === 'changes') persistReadinessFilters([]);
  }

  function finishHistoricalDeleteClose(): void {
    if (historicalDeleteCloseTimerRef.current !== null) {
      window.clearTimeout(historicalDeleteCloseTimerRef.current);
      historicalDeleteCloseTimerRef.current = null;
    }
    setHistoricalDeleteTarget(null);
    setHistoricalDeleteReason('');
    setHistoricalDeleteCode('');
    setHistoricalDeleteClosing(false);
    setError('');
  }

  function closeHistoricalDeleteDialog(): void {
    if (!historicalDeleteTarget || historicalDeleteClosing) return;
    setHistoricalDeleteClosing(true);
    historicalDeleteCloseTimerRef.current = window.setTimeout(finishHistoricalDeleteClose, 220);
  }

  function closeDialog(): void {
    if (historicalDeleteTarget) {
      closeHistoricalDeleteDialog();
      return;
    }
    setOrderDialog(null);
    setBatchDialog(null);
    setReleasePreview(null);
    setDeletePreview(null);
    setActivationPreview(null);
    setMovePreview(null);
    setMoveBatchIds([]);
    setImportDialog(null);
    setWeeklyPlanExportDialog(null);
    setProductPickerOpen(false);
    setProductEntryMode('select');
    setActiveProductIndex(-1);
    setError('');
  }

  function handleDialogEscape(): void {
    if (productPickerOpen && productPickerRef.current?.contains(document.activeElement)) {
      setProductPickerOpen(false);
      setActiveProductIndex(-1);
      return;
    }
    closeDialog();
  }

  function openCreateOrder(trigger: HTMLElement): void {
    dialogTriggerRef.current = trigger;
    setOrderDraft(emptyOrderForm());
    setProductKeyword('');
    setProductPickerOpen(false);
    setProductEntryMode('select');
    setActiveProductIndex(-1);
    setOrderDialog({ mode: 'create' });
  }

  function openHistoricalDelete(
    order: ProductionPlanOrderDTO,
    batch: ProductionPlanBatchDTO,
    trigger: HTMLElement,
  ): void {
    dialogTriggerRef.current = trigger;
    if (historicalDeleteCloseTimerRef.current !== null) {
      window.clearTimeout(historicalDeleteCloseTimerRef.current);
      historicalDeleteCloseTimerRef.current = null;
    }
    setHistoricalDeleteReason('');
    setHistoricalDeleteCode('');
    setHistoricalDeleteClosing(false);
    setError('');
    setHistoricalDeleteTarget({ order, batch });
  }

  function openEditOrder(order: ProductionPlanOrderDTO, trigger: HTMLElement): void {
    dialogTriggerRef.current = trigger;
    setOrderDraft(orderForm(order));
    setProductKeyword(order.specification);
    setProductPickerOpen(false);
    setProductEntryMode('select');
    setActiveProductIndex(-1);
    setOrderDialog({ mode: 'edit', orderId: order.id });
  }

  function selectProduct(option: ProductionPlanProductOptionDTO): void {
    setOrderDraft(current => {
      const previous = productOptions.find(item => item.id === current.drawingLibraryItemId);
      const keepSalesperson = Boolean(current.salesperson && previous?.customerName === option.customerName);
      return {
        ...current,
        drawingLibraryItemId: option.id,
        customerName: option.customerName,
        specification: option.specification,
        productName: option.productName,
        salesperson: keepSalesperson ? current.salesperson : option.recommendedSalesperson || '',
        planningUnitMinutes: previous?.id === option.id && current.planningUnitMinutes
          ? current.planningUnitMinutes
          : millisecondsInput(option.unitMilliseconds),
      };
    });
    setProductKeyword(option.specification);
    setProductPickerOpen(false);
    setProductEntryMode('select');
    setActiveProductIndex(-1);
  }

  function clearProductSelection(openPicker = true): void {
    setOrderDraft(current => ({
      ...current,
      drawingLibraryItemId: '',
      customerName: '',
      salesperson: '',
      productName: '',
      specification: '',
      planningUnitMinutes: '',
    }));
    setProductKeyword('');
    setProductEntryMode('select');
    setProductPickerOpen(openPicker);
    setActiveProductIndex(-1);
    if (openPicker) window.requestAnimationFrame(() => productSearchInputRef.current?.focus());
  }

  function updateProductKeyword(value: string): void {
    if (orderDraft.drawingLibraryItemId && value !== selectedProduct?.specification) {
      setOrderDraft(current => ({
        ...current,
        drawingLibraryItemId: '',
        customerName: '',
        salesperson: '',
        productName: '',
        specification: '',
        planningUnitMinutes: '',
      }));
    }
    setProductKeyword(value);
    setProductPickerOpen(true);
    setActiveProductIndex(0);
  }

  function beginCreateProduct(): void {
    const specification = productKeyword.trim();
    setOrderDraft(current => ({
      ...current,
      drawingLibraryItemId: '',
      customerName: '',
      salesperson: '',
      productName: '',
      specification,
      planningUnitMinutes: '',
    }));
    setProductEntryMode('create');
    setProductPickerOpen(false);
    setActiveProductIndex(-1);
    setError('');
  }

  function handleProductSearchKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setProductPickerOpen(false);
      setActiveProductIndex(-1);
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!productPickerOpen) setProductPickerOpen(true);
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      setActiveProductIndex(current => {
        if (!visibleProductOptions.length) return -1;
        const start = current < 0 ? (direction > 0 ? -1 : 0) : current;
        return (start + direction + visibleProductOptions.length) % visibleProductOptions.length;
      });
      return;
    }
    if (event.key === 'Enter' && productPickerOpen) {
      event.preventDefault();
      const option = visibleProductOptions[activeProductIndex] || visibleProductOptions[0];
      if (option) selectProduct(option);
      else if (orderDialog?.mode === 'create' && productKeyword.trim()) beginCreateProduct();
    }
  }

  function openBatch(order: ProductionPlanOrderDTO, trigger: HTMLElement, batch?: ProductionPlanBatchDTO): void {
    dialogTriggerRef.current = trigger;
    const defaultWeek = batch?.weekStartDate || selectedWeek?.weekStartDate || periods?.current.weekStartDate || '';
    const defaultWeekEnd = editableWeeks.find(item => item.weekStartDate === defaultWeek)?.weekEndDate
      || batch?.weekEndDate
      || periods?.current.weekEndDate
      || '';
    setBatchDraft({
      quantity: String(batch?.quantity || order.remainingQuantity || ''),
      unitSeconds: secondsInput(batch?.unitMillisecondsSnapshot || planningUnitMilliseconds(order)),
      weekStartDate: defaultWeek,
      plannedCompletionDate: batch?.plannedCompletionDate || defaultWeekEnd,
      reason: '',
    });
    setBatchDialog({ orderId: order.id, batchId: batch?.id });
  }

  function changeBatchWeek(weekStartDate: string): void {
    const targetWeek = editableWeeks.find(item => item.weekStartDate === weekStartDate);
    if (!targetWeek) return;
    setBatchDraft(current => {
      const offset = current.weekStartDate && current.plannedCompletionDate
        ? dayOffset(current.weekStartDate, current.plannedCompletionDate)
        : 6;
      return {
        ...current,
        weekStartDate,
        plannedCompletionDate: addDateDays(weekStartDate, offset),
      };
    });
  }

  async function saveOrder(confirmImpact = false, restoreDrawingLibraryProduct = false): Promise<void> {
    if (!orderDialog) return;
    if (productEntryMode === 'select' && !orderDraft.drawingLibraryItemId) {
      setError('请选择图纸资料库产品，或创建新型号');
      return;
    }
    if (productEntryMode === 'create' && (!orderDraft.customerName.trim() || !orderDraft.specification.trim() || !orderDraft.productName.trim())) {
      setError('新型号必须填写客户、产品规格和产品名称');
      return;
    }
    if (orderDraft.planningUnitMinutes.trim() && (!orderDraftUnitMilliseconds || orderDraftUnitMilliseconds > 86_400_000)) {
      setError('请填写大于 0 且不超过 1440 分钟的单件产品工时');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const editing = orderDialog.mode === 'edit' && orderDialog.orderId;
      const response = await fetch(editing ? `/api/planning/orders/${orderDialog.orderId}` : '/api/planning/orders', {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...orderDraft,
          expectedDeliveryVersion: orders.find(order => order.id === orderDialog.orderId)?.deliveryVersion,
          planningUnitMilliseconds: orderDraftUnitMilliseconds,
          confirmImpact,
          createDrawingLibraryProduct: productEntryMode === 'create',
          restoreDrawingLibraryProduct,
        }),
      });
      const body = await responseBody<{
        order?: ProductionPlanOrderDTO;
        impact?: Record<string, number | boolean | string>;
        productAction?: 'existing' | 'created' | 'restored';
      }>(response);
      if (body.requiresConfirmation && !confirmImpact) {
        if (!orderDraft.reason.trim()) throw new Error('订单已经下达，请填写变更原因后再次保存');
        const confirmed = window.confirm('该订单已经下达，数量、交期或产品信息会同步到关联工单，但不会重置仓库和工艺进度。确认继续吗？');
        if (confirmed) await saveOrder(true);
        return;
      }
      if (body.requiresProductRestore && !restoreDrawingLibraryProduct) {
        const confirmed = window.confirm('该客户和规格已在图纸资料库回收站中。是否恢复该型号并继续创建订单？');
        if (confirmed) await saveOrder(confirmImpact, true);
        return;
      }
      if (!response.ok || !body.order) throw new Error(body.error || '计划订单保存失败');
      setToast(editing
        ? orderDraftUnitMilliseconds ? '计划订单已更新' : '计划订单已更新，工时待维护'
        : body.productAction === 'created'
          ? orderDraftUnitMilliseconds ? '订单已创建，新型号已进入图纸资料库' : '订单已创建并建档，工时待维护'
          : body.productAction === 'restored'
            ? orderDraftUnitMilliseconds ? '订单已创建，回收站型号已恢复' : '订单已创建并恢复型号，工时待维护'
            : orderDraftUnitMilliseconds ? '计划订单已创建' : '计划订单已创建，工时待维护');
      closeDialog();
      setRefreshToken(value => value + 1);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '计划订单保存失败');
    } finally {
      setSaving(false);
    }
  }

  async function deleteOrder(order: ProductionPlanOrderDTO): Promise<void> {
    if (!window.confirm(`确认从计划系统删除 ${order.specification}？\n\n该计划不会回到订单池；图纸资料、产品工序与标准工时会继续保留。`)) return;
    setSaving(true);
    setError('');
    try {
      const response = await fetch(`/api/planning/orders/${order.id}`, { method: 'DELETE' });
      const body = await responseBody<Record<string, never>>(response);
      if (!response.ok) throw new Error(body.error || '删除计划订单失败');
      publishProductionDataInvalidation({ kind: 'plan-order-deleted', entityId: order.id });
      setToast('计划已删除，图纸与产品工时资料已保留');
      setRefreshToken(value => value + 1);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '删除计划订单失败');
    } finally {
      setSaving(false);
    }
  }

  function moveHistoricalDeleteGlass(event: ReactPointerEvent<HTMLDivElement>): void {
    if (historicalDeleteClosing || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const layer = event.currentTarget;
    const bounds = layer.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
    const y = Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height));
    if (historicalDeleteMotionFrameRef.current !== null) {
      window.cancelAnimationFrame(historicalDeleteMotionFrameRef.current);
    }
    historicalDeleteMotionFrameRef.current = window.requestAnimationFrame(() => {
      layer.style.setProperty('--history-delete-rotate-x', `${((0.5 - y) * 3.2).toFixed(2)}deg`);
      layer.style.setProperty('--history-delete-rotate-y', `${((x - 0.5) * 4.4).toFixed(2)}deg`);
      layer.style.setProperty('--history-delete-light-x', `${((x - 0.5) * 440).toFixed(1)}px`);
      layer.style.setProperty('--history-delete-light-y', `${((y - 0.5) * 300).toFixed(1)}px`);
      historicalDeleteMotionFrameRef.current = null;
    });
  }

  function resetHistoricalDeleteGlass(event: ReactPointerEvent<HTMLDivElement>): void {
    const layer = event.currentTarget;
    if (historicalDeleteMotionFrameRef.current !== null) {
      window.cancelAnimationFrame(historicalDeleteMotionFrameRef.current);
      historicalDeleteMotionFrameRef.current = null;
    }
    layer.style.setProperty('--history-delete-rotate-x', '0deg');
    layer.style.setProperty('--history-delete-rotate-y', '0deg');
    layer.style.setProperty('--history-delete-light-x', '0px');
    layer.style.setProperty('--history-delete-light-y', '-72px');
  }

  async function commitHistoricalDelete(): Promise<void> {
    if (!historicalDeleteTarget) return;
    if (historicalDeleteCode !== '111') {
      setError('请输入删除确认码 111');
      historicalDeleteCodeRef.current?.focus();
      return;
    }
    setSaving(true);
    setError('');
    try {
      const response = await fetch(`/api/planning/orders/${historicalDeleteTarget.order.id}/direct-delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          confirmationCode: historicalDeleteCode,
          reason: historicalDeleteReason.trim() || undefined,
        }),
      });
      const body = await responseBody<{
        result?: {
          deletedBatchCount: number;
          retiredWorkOrderCount: number;
        };
      }>(response);
      if (!response.ok || !body.result) throw new Error(body.error || '删除订单失败');
      publishProductionDataInvalidation({
        kind: 'plan-order-deleted',
        entityId: historicalDeleteTarget.order.id,
      });
      setToast(`${historicalDeleteTarget.order.specification} 已删除，关联记录已转入审计留存`);
      setRefreshToken(value => value + 1);
      closeHistoricalDeleteDialog();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '删除订单失败');
    } finally {
      setSaving(false);
    }
  }

  async function saveBatch(confirmImpact = false): Promise<void> {
    if (!batchDialog) return;
    if (batchDraft.unitSeconds.trim() && !batchDraftUnitMilliseconds) {
      setError('请填写大于 0 且不超过 86400 秒的单根工时');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const editing = Boolean(batchDialog.batchId);
      const response = await fetch(editing ? `/api/planning/batches/${batchDialog.batchId}` : `/api/planning/orders/${batchDialog.orderId}/batches`, {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...batchDraft,
          unitMilliseconds: batchDraftUnitMilliseconds,
          confirmImpact,
        }),
      });
      const body = await responseBody<{
        order?: ProductionPlanOrderDTO;
        automaticReleaseTarget?: 'active' | 'preparation' | null;
      }>(response);
      if (body.requiresConfirmation && !confirmImpact) {
        if (!batchDraft.reason.trim()) throw new Error('该批次已经下达，请填写调整原因后再次保存');
        if (window.confirm('修改会同步关联生产工单，且保留现有仓库和工艺进度。确认继续吗？')) await saveBatch(true);
        return;
      }
      if (!response.ok || !body.order) throw new Error(body.error || '排产批次保存失败');
      setToast(body.automaticReleaseTarget === 'active'
        ? `排产批次已${editing ? '调整' : '创建'}并自动进入本周生产执行${batchDraftUnitMilliseconds ? '' : '，工时待配置'}`
        : body.automaticReleaseTarget === 'preparation'
          ? `排产批次已${editing ? '调整' : '创建'}并自动进入下周生产执行${batchDraftUnitMilliseconds ? '' : '，工时待配置'}`
          : batchDraftUnitMilliseconds
            ? editing ? '排产批次与总工时已调整' : '排产批次与总工时已创建'
            : editing ? '排产草稿已调整，工时待维护' : '排产草稿已创建，工时待维护');
      closeDialog();
      setRefreshToken(value => value + 1);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '排产批次保存失败');
    } finally {
      setSaving(false);
    }
  }

  async function deleteBatch(batch: ProductionPlanBatchDTO): Promise<void> {
    if (!window.confirm(`确认删除第 ${batch.batchNo} 批排产？\n\n删除数量不会回到订单池；图纸与产品工时资料会继续保留。`)) return;
    const response = await fetch(`/api/planning/batches/${batch.id}`, { method: 'DELETE' });
    const body = await responseBody<Record<string, never>>(response);
    if (!response.ok) { setError(body.error || '删除排产批次失败'); return; }
    publishProductionDataInvalidation({ kind: 'plan-batch-deleted', entityId: batch.id });
    setSelectedBatchIds(current => current.filter(id => id !== batch.id));
    setToast('排产批次已删除，未回到订单池');
    setRefreshToken(value => value + 1);
  }

  function toggleBatch(batchId: string): void {
    setSelectedBatchIds(current => current.includes(batchId) ? current.filter(id => id !== batchId) : [...current, batchId]);
  }

  async function previewRelease(target: ReleasePreview['target'], trigger: HTMLElement): Promise<void> {
    if (!selectedBatchIds.length) { setToast('请先勾选排产批次'); return; }
    dialogTriggerRef.current = trigger;
    setSaving(true);
    setError('');
    try {
      const response = await fetch('/api/planning/release/preview', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ batchIds: selectedBatchIds, target }),
      });
      const body = await responseBody<{ preview?: ReleasePreview }>(response);
      if (!response.ok || !body.preview) throw new Error(body.error || '下达预检失败');
      setReleasePreview(body.preview);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '下达预检失败');
    } finally {
      setSaving(false);
    }
  }

  async function commitRelease(): Promise<void> {
    if (!releasePreview) return;
    setSaving(true);
    setError('');
    try {
      const response = await fetch('/api/planning/release/commit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          batchIds: selectedBatchIds,
          target: releasePreview.target,
          confirmWarnings: true,
        }),
      });
      const body = await responseBody<{ result?: { releasedCount: number; warningCount: number } }>(response);
      if (!response.ok || !body.result) throw new Error(body.error || '计划下达失败');
      const warningText = body.result.warningCount > 0
        ? `，${body.result.warningCount} 项准备提醒已保留`
        : '';
      setToast(`${body.result.releasedCount} 个批次已${releasePreview.target === 'active' ? '下达本周执行' : '下达下周预备'}${warningText}`);
      setSelectedBatchIds([]);
      closeDialog();
      setRefreshToken(value => value + 1);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '计划下达失败');
    } finally {
      setSaving(false);
    }
  }

  async function previewDeletion(trigger: HTMLElement): Promise<void> {
    if (!selectedBatchIds.length) { setToast('请先勾选要删除的计划批次'); return; }
    dialogTriggerRef.current = trigger;
    setSaving(true);
    setError('');
    try {
      const response = await fetch('/api/planning/delete/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batchIds: selectedBatchIds }),
      });
      const body = await responseBody<{ preview?: DeletePreview }>(response);
      if (!response.ok || !body.preview) throw new Error(body.error || '删除计划预检失败');
      setDeletePreview(body.preview);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '删除计划预检失败');
    } finally {
      setSaving(false);
    }
  }

  async function commitDeletion(): Promise<void> {
    if (!deletePreview) return;
    setSaving(true);
    setError('');
    try {
      const response = await fetch('/api/planning/delete/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batchIds: selectedBatchIds, confirm: true }),
      });
      const body = await responseBody<{ result?: { draftDeletedCount: number; withdrawnCount: number } }>(response);
      if (!response.ok || !body.result) throw new Error(body.error || '删除计划失败');
      const messages = [
        body.result.draftDeletedCount ? `删除草稿 ${body.result.draftDeletedCount} 批` : '',
        body.result.withdrawnCount ? `撤回未开工计划 ${body.result.withdrawnCount} 批` : '',
      ].filter(Boolean);
      setToast(messages.join('，') || '所选计划已删除');
      setSelectedBatchIds([]);
      closeDialog();
      setRefreshToken(value => value + 1);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '删除计划失败');
    } finally {
      setSaving(false);
    }
  }

  async function previewActivation(trigger: HTMLElement): Promise<void> {
    const weekStartDate = periods?.next.weekStartDate || preparationRows[0]?.batch.weekStartDate;
    if (!weekStartDate) { setToast('当前没有下周预备批次'); return; }
    dialogTriggerRef.current = trigger;
    setSaving(true);
    try {
      const response = await fetch('/api/planning/activate/preview', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ weekStartDate }),
      });
      const body = await responseBody<{ preview?: ActivationPreview }>(response);
      if (!response.ok || !body.preview) throw new Error(body.error || '启用预检失败');
      setActivationPreview(body.preview);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '启用预检失败');
    } finally {
      setSaving(false);
    }
  }

  async function commitActivation(): Promise<void> {
    if (!activationPreview) return;
    setSaving(true);
    try {
      const response = await fetch('/api/planning/activate/commit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          weekStartDate: activationPreview.sourceWeekStartDate || activationPreview.weekStartDate,
          confirmWarnings: true,
        }),
      });
      const body = await responseBody<{ result?: { activated: number; archived: number } }>(response);
      if (!response.ok || !body.result) throw new Error(body.error || '启用本周计划失败');
      setToast(`已启用 ${body.result.activated} 个批次，原本周 ${body.result.archived} 个批次已归档`);
      closeDialog();
      setView('schedule');
      setRefreshToken(value => value + 1);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '启用本周计划失败');
    } finally {
      setSaving(false);
    }
  }

  async function previewMove(
    targetWeekStartDate: string,
    trigger: HTMLElement,
    ids = selectedBatchIds,
  ): Promise<void> {
    if (!ids.length) { setToast('请先勾选需要调配的排产批次'); return; }
    if (!targetWeekStartDate) { setToast('请选择目标生产周'); return; }
    dialogTriggerRef.current = trigger;
    setSaving(true);
    setError('');
    try {
      const response = await fetch('/api/planning/move/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batchIds: ids, targetWeekStartDate }),
      });
      const body = await responseBody<{ preview?: MovePreview }>(response);
      if (!response.ok || !body.preview) throw new Error(body.error || '周次调配预检失败');
      setMoveBatchIds(ids);
      setMovePreview(body.preview);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '周次调配预检失败');
    } finally {
      setSaving(false);
    }
  }

  async function commitMove(): Promise<void> {
    if (!movePreview || !moveBatchIds.length) return;
    setSaving(true);
    setError('');
    try {
      const response = await fetch('/api/planning/move/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          batchIds: moveBatchIds,
          targetWeekStartDate: movePreview.targetWeekStartDate,
          reason: '周排单工作区调配',
        }),
      });
      const body = await responseBody<{
        result?: {
          movedCount: number;
          targetWeekStartDate: string;
          automaticallyActive: number;
          automaticallyPrepared: number;
        };
      }>(response);
      if (!response.ok || !body.result) throw new Error(body.error || '周次调配失败');
      const automaticMessage = body.result.automaticallyActive
        ? `，${body.result.automaticallyActive} 批已自动进入本周生产`
        : body.result.automaticallyPrepared
          ? `，${body.result.automaticallyPrepared} 批已自动进入下周生产`
          : '';
      setToast(`${body.result.movedCount} 个草稿批次已调配到 ${body.result.targetWeekStartDate}${automaticMessage}`);
      setSelectedBatchIds([]);
      const targetWeekStartDate = body.result.targetWeekStartDate;
      closeDialog();
      selectScheduleWeek(targetWeekStartDate);
      setRefreshToken(value => value + 1);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '周次调配失败');
    } finally {
      setSaving(false);
    }
  }

  async function loadWeeklyPlanExportPreview(config: Pick<WeeklyPlanExportDialog, 'mode' | 'startDate' | 'endDate' | 'range' | 'version'>): Promise<void> {
    setWeeklyPlanExportDialog(current => current ? { ...current, ...config, preview: null, loading: true } : {
      ...config, preview: null, loading: true, exporting: false,
    });
    setError('');
    try {
      const response = await fetch('/api/planning/weekly-plan-export/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: config.mode, startDate: config.startDate, endDate: config.endDate }),
      });
      const body = await responseBody<{ preview?: WeeklyPlanExportPreview }>(response);
      if (response.status === 401) { location.href = '/login'; return; }
      if (!response.ok || !body.preview) throw new Error(body.error || '计划导出预览生成失败');
      setWeeklyPlanExportDialog(current => current ? { ...current, preview: body.preview!, loading: false } : current);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '计划导出预览生成失败');
      setWeeklyPlanExportDialog(current => current ? { ...current, loading: false } : current);
    }
  }

  async function openWeeklyPlanExport(trigger: HTMLElement): Promise<void> {
    const monthRange = view === 'month' ? monthData : null;
    const startDate = monthRange?.startDate || selectedWeek?.weekStartDate;
    const endDate = monthRange?.endDate || selectedWeek?.weekEndDate;
    if (!startDate || !endDate) {
      setToast('计划周期加载完成后才能导出');
      return;
    }
    dialogTriggerRef.current = trigger;
    const mode = view === 'schedule' && selectedWeekKey === 'current' ? 'week_execution' : 'schedule_range';
    await loadWeeklyPlanExportPreview({
      mode,
      startDate,
      endDate,
      version: 'full',
      range: mode === 'week_execution' ? 'execution' : 'current',
    });
  }

  async function downloadWeeklyPlanExport(): Promise<void> {
    if (!weeklyPlanExportDialog?.preview || weeklyPlanExportDialog.exporting) return;
    const { version, range, preview, mode, startDate, endDate } = weeklyPlanExportDialog;
    setError('');
    setWeeklyPlanExportDialog(current => current ? { ...current, exporting: true } : current);
    try {
      const query = new URLSearchParams({ version, range, mode, startDate, endDate });
      if (preview.digest) query.set('previewDigest', preview.digest);
      const response = await fetch(`/api/planning/weekly-plan-export.xlsx?${query.toString()}`, { cache: 'no-store' });
      if (response.status === 401) {
        location.href = '/login';
        return;
      }
      if (!response.ok) {
        const body = await responseBody<Record<string, never>>(response);
        throw new Error(body.error || '生产计划导出失败');
      }
      const fallback = `生产计划_${preview.weekStartDate}至${preview.weekEndDate}_${version === 'full' ? '完整版' : '订单简版'}.xlsx`;
      const filename = responseDownloadFileName(response, fallback);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      anchor.style.display = 'none';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setToast(`${version === 'full' ? '完整计划版' : '订单简版'}已导出${mode === 'week_execution' && range === 'execution' ? '，包含有效遗留' : '，按内部完成日筛选'}`);
      setWeeklyPlanExportDialog(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '生产计划导出失败');
      setWeeklyPlanExportDialog(current => current ? { ...current, exporting: false } : current);
    }
  }

  function openPlanningImport(trigger: HTMLElement): void {
    if (!selectedWeek) {
      setToast('计划周期尚未加载完成');
      return;
    }
    dialogTriggerRef.current = trigger;
    setError('');
    setImportDialog({
      step: 'upload',
      targetWeekStartDate: selectedWeek.weekStartDate,
      targetWeekEndDate: selectedWeek.weekEndDate,
      fileName: '',
      preview: null,
      result: null,
      decisions: {},
      history: [],
      loading: false,
    });
    window.requestAnimationFrame(() => importInputRef.current?.focus());
  }

  async function previewPlanningImport(file: File): Promise<void> {
    if (!importDialog) return;
    setError('');
    setImportDialog(current => current ? { ...current, fileName: file.name, preview: null, loading: true } : current);
    try {
      const form = new FormData();
      form.set('file', file);
      form.set('mode', 'weekly_plan');
      form.set('destination', 'planning');
      form.set('weekStartDate', importDialog.targetWeekStartDate);
      const response = await fetch('/api/planning/import/preview', { method: 'POST', body: form });
      const body = await responseBody<PlanningImportPreview>(response);
      if (!response.ok || !Array.isArray(body.rows)) throw new Error(body.error || '排单清单预览失败');
      setImportDialog(current => current ? {
        ...current,
        step: 'preview',
        fileName: file.name,
        preview: body,
        result: null,
        decisions: {},
        loading: false,
      } : current);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '排单清单预览失败');
      setImportDialog(current => current ? { ...current, loading: false } : current);
    }
  }

  async function commitPlanningImport(): Promise<void> {
    if (!importDialog?.preview) return;
    setSaving(true);
    setError('');
    try {
      const response = await fetch('/api/planning/import/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          batchId: importDialog.preview.batchId,
          previewToken: importDialog.preview.previewToken,
          decisions: importDialog.decisions,
        }),
      });
      const body = await responseBody<PlanningImportResult>(response);
      if (!response.ok || !body.summary) throw new Error(body.error || '排单清单导入失败');
      const automaticMessage = body.summary.automaticallyActive
        ? `，${body.summary.automaticallyActive} 批已进入本周生产`
        : body.summary.automaticallyPrepared
          ? `，${body.summary.automaticallyPrepared} 批已进入下周生产`
          : '';
      setToast(`已导入 ${body.summary.created} 批${automaticMessage}，跳过 ${body.summary.skipped} 行，失败 ${body.summary.failed} 行`);
      setImportDialog(current => current ? { ...current, step: 'complete', result: body, loading: false } : current);
      setRefreshToken(value => value + 1);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '排单清单导入失败');
    } finally {
      setSaving(false);
    }
  }

  async function openPlanningImportHistory(): Promise<void> {
    setError('');
    setImportDialog(current => current ? { ...current, step: 'history', loading: true } : current);
    try {
      const response = await fetch('/api/planning/import/history', { cache: 'no-store' });
      const body = await responseBody<{ records?: PlanningImportHistoryRecord[] }>(response);
      if (!response.ok || !Array.isArray(body.records)) throw new Error(body.error || '导入记录加载失败');
      setImportDialog(current => current ? { ...current, history: body.records || [], loading: false } : current);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '导入记录加载失败');
      setImportDialog(current => current ? { ...current, loading: false } : current);
    }
  }

  function selectAllDrafts(): void {
    const ids = scheduleRows.filter(item => item.batch.releaseState === 'draft').map(item => item.batch.id);
    setSelectedBatchIds(current => current.length === ids.length && ids.every(id => current.includes(id)) ? [] : ids);
  }

  const selectedQuantity = allBatches.filter(item => selectedBatchIds.includes(item.batch.id)).reduce((sum, item) => sum + item.batch.quantity, 0);
  const selectedPrintableWorkOrderIds = [...new Set(allBatches
    .filter(item => selectedBatchIds.includes(item.batch.id) && item.batch.workOrderId)
    .map(item => item.batch.workOrderId as string))];
  const planDataAvailable = lastPlanLoadedAt !== null;
  const planAuxiliaryWarningText = planLoadWarnings.length
    ? `计划数据已正常加载；${Array.from(new Set(planLoadWarnings.map(warning => {
      if (warning.code === planningProductOptionsWarningCode) return '产品选项暂未更新，已有选项保持不变';
      if (warning.code === planningSalespeopleWarningCode) return '业务员选项暂未更新，已有选项保持不变';
      return warning.message || '部分辅助选项暂未更新';
    }))).join('；')}。`
    : '';
  const lastPlanLoadedTime = lastPlanLoadedAt?.toLocaleTimeString('zh-CN', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
  const views: Array<{ id: PlanningView; label: string; icon: typeof ClipboardList; count?: number }> = [
    { id: 'schedule', label: '计划排程', icon: CalendarCheck2, count: planDataAvailable ? summary.scheduledOrderCount : undefined },
    { id: 'month', label: '月度排产', icon: CalendarRange },
    { id: 'orders', label: '订单管理', icon: ClipboardList, count: planDataAvailable ? summary.pendingOrderCount : undefined },
    { id: 'preparation', label: '下周生产', icon: PackageCheck, count: planDataAvailable ? summary.preparationBatchCount : undefined },
    { id: 'changes', label: '插单与变更', icon: FilePenLine },
    { id: 'history', label: '历史计划', icon: History },
  ];

  function handleNavigationExpandedChange(expanded: boolean): void {
    setNavigationOpen(expanded);
    if (expanded) modeDrawer.close(false);
  }

  function toggleModeDrawer(): void {
    if (!modeDrawer.open) setNavigationOpen(false);
    modeDrawer.toggle();
  }

  return <>
    <main ref={mainRef} className="planning-center-shell hm-workbench-root hm-workbench-navigation-overlay">
      <AppWorkbenchHeader
        user={user}
        activeHref="/weekly-plan-center"
        subtitle="订单排程、下周准备与本周生产下达"
        menuItems={[]}
        hideHeader
        sidebarTriggerTargetId="planning-navigation-trigger"
        sidebarExpanded={navigationOpen}
        onSidebarExpandedChange={handleNavigationExpandedChange}
        moduleModeSwitcher={{ mode: 'mass', drawerId: 'planning-mode-drawer', drawerOpen: modeDrawer.open, onToggle: toggleModeDrawer, openFromSidebar: false }}
      />

      <div className={`planning-center-main${modeDrawer.open ? ' module-mode-open' : ''}`}>
        <header className="planning-titlebar">
          <div className="planning-navigation-trigger" id="planning-navigation-trigger" aria-label="平台导航入口" />
          <div className="planning-title-copy"><span>生产计划</span><div className="planning-heading-line"><h1>计划中心</h1><ModuleModeTrigger buttonRef={modeDrawer.triggerRef} open={modeDrawer.open} mode="mass" onClick={toggleModeDrawer} controls="planning-mode-drawer" compact /></div><p>订单、排程、配料、工艺与生产下达</p></div>
          <nav aria-label="计划中心视图">
            {views.map(item => {
              const Icon = item.icon;
              return <button className={view === item.id ? 'active' : ''} type="button" key={item.id} onClick={() => selectView(item.id)}><Icon size={16} aria-hidden="true" /><span>{item.label}</span>{item.count !== undefined && <b>{item.count}</b>}</button>;
            })}
          </nav>
          <button className="planning-refresh" type="button" title="刷新计划数据" aria-label="刷新计划数据" disabled={loading} onClick={() => setRefreshToken(value => value + 1)}><RefreshCw size={17} className={loading ? 'spin' : ''} aria-hidden="true" /></button>
        </header>

        <ModuleModeDrawer
          id="planning-mode-drawer"
          open={modeDrawer.open}
          moduleLabel="计划中心"
          mode="mass"
          mass={{ href: '/weekly-plan-center', title: '量产计划', description: '订单排程、配料准备、工艺联动与生产下达', count: planDataAvailable ? summary.scheduledOrderCount : undefined, countLabel: '单' }}
          sample={{ href: '/weekly-plan-center?branch=samples', title: '样品组计划', description: '按客户等级下达样品资料采集与分项审核任务' }}
          onClose={modeDrawer.close}
        />

        <section className="planning-period-ribbon" aria-label="本周与下周计划状态">
          <article className="current"><div><CalendarCheck2 aria-hidden="true" /><span><small>本周执行</small><strong>{periods ? `${periods.current.weekStartDate.slice(5)} - ${periods.current.weekEndDate.slice(5)}` : loading ? '加载中' : '未获取最新数据'}</strong></span></div><b>{planDataAvailable ? summary.activeBatchCount : '—'}<small>正常批已进入生产</small>{Boolean(periods?.current.wipTaskCount) && <em className="planning-period-wip-count">+{periods?.current.wipTaskCount} 项半成品续作</em>}</b><a href="/production?scope=current">进入生产<ChevronRight size={14} /></a></article>
          <div className="planning-period-link"><span>提前准备</span><ArrowRight aria-hidden="true" /></div>
          <article className="next"><div><CalendarClock aria-hidden="true" /><span><small>下周生产</small><strong>{periods ? `${periods.next.weekStartDate.slice(5)} - ${periods.next.weekEndDate.slice(5)}` : loading ? '加载中' : '未获取最新数据'}</strong></span></div><b>{planDataAvailable ? summary.preparationBatchCount : '—'}<small>正常批已进入生产</small>{Boolean(periods?.next.wipTaskCount) && <em className="planning-period-wip-count">+{periods?.next.wipTaskCount} 项半成品续作</em>}</b><a href="/production?scope=next">进入生产<ChevronRight size={14} /></a></article>
          <div className="planning-readiness"><span><Warehouse size={15} />仓库异常 <b>{planDataAvailable ? summary.warehouseExceptionCount : '—'}</b></span><span><Settings2 size={15} />待工艺 <b>{planDataAvailable ? summary.processPendingCount : '—'}</b></span><span><ShieldAlert size={15} />缺工时 <b>{planDataAvailable ? summary.missingProductTimeCount : '—'}</b></span><span><FilePenLine size={15} />缺 SOP <b>{planDataAvailable ? summary.missingSopCount : '—'}</b></span></div>
        </section>

        <section className="planning-week-switcher" aria-label="周排单工作区">
          <button
            className={view === 'history' ? 'active history' : 'history'}
            type="button"
            disabled={!periods?.history.length}
            onClick={() => selectHistoryWeek(selectedHistoryWeek?.weekStartDate || periods?.history[0]?.weekStartDate || '')}
          >
            <History size={17} aria-hidden="true" />
            <span><strong>历史周</strong><small>{selectedHistoryWeek ? `${selectedHistoryWeek.weekStartDate.slice(5)} - ${selectedHistoryWeek.weekEndDate.slice(5)}` : planDataAvailable ? '暂无归档周' : '尚未获取数据'}</small></span>
            <b>{planDataAvailable ? periods?.history.length || 0 : '—'}<small>周</small></b>
          </button>
          {editableWeeks.map(week => <button
            className={view === 'schedule' && selectedWeek?.key === week.key ? `active ${week.key}` : week.key}
            type="button"
            key={week.key}
            onClick={() => selectScheduleWeek(week.weekStartDate)}
          >
            {week.key === 'current' ? <CalendarCheck2 size={17} aria-hidden="true" /> : <CalendarClock size={17} aria-hidden="true" />}
            <span><strong>{editableWeekLabel(week.key)}</strong><small>{week.weekStartDate.slice(5)} - {week.weekEndDate.slice(5)}</small></span>
            <b>{week.batchCount}<small>批</small>{Boolean(week.wipTaskCount) && <em className="planning-week-wip-count">+{week.wipTaskCount} 项半成品</em>}</b>
          </button>)}
        </section>

        <section className="planning-toolbar" aria-label="计划筛选和操作">
          <label className="planning-search"><Search size={17} aria-hidden="true" /><input value={keyword} onChange={event => setKeyword(event.target.value)} placeholder="搜索客户、业务员、规格或品名" /></label>
          <select value={customer} onChange={event => setCustomer(event.target.value)} aria-label="筛选客户"><option value="">全部客户</option>{customers.map(item => <option value={item} key={item}>{item}</option>)}</select>
          <select value={priority} onChange={event => setPriority(event.target.value as typeof priority)} aria-label="筛选优先级"><option value="all">全部优先级</option><option value="insert">插单</option><option value="urgent">紧急</option><option value="normal">一般</option></select>
          <div className="planning-readiness-filter" ref={readinessFilterRef}>
            <button
              ref={readinessTriggerRef}
              className={readinessFilters.length ? 'planning-readiness-trigger active' : 'planning-readiness-trigger'}
              type="button"
              aria-haspopup="dialog"
              aria-expanded={readinessOpen}
              disabled={readinessDisabled}
              title={readinessDisabled ? '当前页面不支持准备状态筛选' : '筛选工时、图纸、材料和工艺准备状态'}
              onClick={() => setReadinessOpen(current => !current)}
            >
              <ListFilter size={16} aria-hidden="true" />
              <span>{readinessLabel}</span>
              {readinessFilters.length > 0 && <b>{readinessFilters.length}</b>}
              <ChevronDown size={14} aria-hidden="true" />
            </button>
            {readinessOpen && <div className="planning-readiness-popover" role="dialog" aria-label="准备状态筛选">
              <header>
                <div><strong>准备状态</strong><span>快速找出需要处理的计划</span></div>
                {readinessFilters.length > 0 && <button type="button" onClick={() => persistReadinessFilters([])}>清除</button>}
              </header>
              <div className="planning-readiness-options">
                {readinessOptions.map(option => {
                  const orderLevelAvailable = orderLevelReadinessFilters([option.id]).length > 0;
                  const unavailable = view === 'orders' && !orderLevelAvailable;
                  return <label className={unavailable ? 'planning-readiness-option disabled' : 'planning-readiness-option'} key={option.id}>
                    <input
                      type="checkbox"
                      checked={readinessFilters.includes(option.id)}
                      disabled={unavailable}
                      onChange={() => toggleReadinessFilter(option.id)}
                    />
                    <span><strong>{option.label}</strong><small>{unavailable ? '排产后可筛选' : option.description}</small></span>
                    <em>{planDataAvailable ? readinessCounts[option.id] : '—'}</em>
                  </label>;
                })}
              </div>
              <footer>{view === 'orders' ? '订单池支持资料缺项、SOP 阶段和预备就绪筛选' : '缺项与 SOP 阶段可多选；就绪状态为单选条件'}</footer>
            </div>}
          </div>
          <div className="planning-toolbar-actions">
            <a
              className="planning-secondary-action"
              href={productTimeConfigurationRoute(null, { from: 'planning', returnTo: '/weekly-plan-center?restore=1' })}
              onClick={rememberPlanningState}
              title="维护产品工序与工时"
            ><Clock3 size={16} />产品工时</a>
            <button className="planning-primary-action" type="button" onClick={event => openCreateOrder(event.currentTarget)}><Plus size={17} />新建订单</button>
          </div>
        </section>

        {error
          ? <div className="planning-error" role="alert"><AlertTriangle size={16} /><span>{error}</span><button type="button" onClick={() => setError('')} aria-label="关闭错误"><X size={15} /></button></div>
          : planLoadError
            ? <div className="planning-error" role="alert"><AlertTriangle size={16} /><span>{planDataAvailable ? `未获取到最新数据，当前保留 ${lastPlanLoadedTime || '上次'} 成功加载的内容：${planLoadError}` : `数据加载失败，尚未获取到计划数据：${planLoadError}`}</span><button type="button" disabled={loading} onClick={() => setRefreshToken(value => value + 1)} aria-label="重试加载计划数据" title="重试加载计划数据"><RefreshCw size={15} className={loading ? 'spin' : ''} /></button></div>
            : planAuxiliaryWarningText
              ? <div className="planning-error planning-auxiliary-warning" role="status" aria-live="polite"><AlertTriangle size={16} /><span>{planAuxiliaryWarningText}</span><button type="button" onClick={() => setPlanLoadWarnings([])} aria-label="关闭辅助数据提示"><X size={15} /></button></div>
              : null}

        {view === 'month' && <section className="planning-month-view">
          <header className="planning-month-heading">
            <div><span>月度产能总览</span><h2>{selectedMonth.replace('-', '年')}月</h2><p>按批次内部计划完成日归属月份，人工或其他硬控制工时保留在承诺负荷中；物料风险不再作为计划冻结。</p></div>
            <div className="planning-month-actions">
              <button type="button" aria-label="上个月" onClick={() => setSelectedMonth(current => shiftPlanningMonth(current, -1))}>‹</button>
              <input type="month" value={selectedMonth} onChange={event => setSelectedMonth(event.target.value || currentPlanningMonth())} aria-label="选择月份" />
              <button type="button" aria-label="下个月" onClick={() => setSelectedMonth(current => shiftPlanningMonth(current, 1))}>›</button>
              <button className="export" type="button" disabled={!monthData} onClick={event => { void openWeeklyPlanExport(event.currentTarget); }}><FileSpreadsheet size={15} />导出计划</button>
            </div>
          </header>
          {monthLoading && <div className="planning-loading">正在汇总月度排产与产能...</div>}
          {monthData && <>
            <div className="planning-month-kpis">
              <article><span>承诺排单工时</span><strong>{totalDuration(monthData.capacity.scheduledMilliseconds)}</strong><small>{monthData.capacity.batchCount} 批 · {monthData.capacity.missingTimeBatchCount ? `${monthData.capacity.missingTimeBatchCount} 批工时待补` : '工时完整'}</small></article>
              <article className="frozen"><span>硬控制工时</span><strong>{totalDuration(monthData.capacity.frozenMilliseconds)}</strong><small>{monthData.capacity.frozenBatchCount} 批当前被生产控制</small></article>
              <article><span>可执行工时</span><strong>{totalDuration(monthData.capacity.executableMilliseconds)}</strong><small>承诺排单扣除有效冻结</small></article>
              <article><span>计划可用工时</span><strong>{totalDuration(monthData.capacity.plannedCapacityMilliseconds)}</strong><small>{monthData.capacity.employeeCount} 人 · {monthData.capacity.workdayCount} 个工作日</small></article>
              <article className="rate"><span>计划负荷率</span><strong>{planningCapacityRate(monthData.capacity.scheduledMilliseconds, monthData.capacity.plannedCapacityMilliseconds)}</strong><small>排单工时 / 计划可用工时</small></article>
              <article className="rate"><span>排单率（考勤）</span><strong>{planningCapacityRate(monthData.capacity.attendanceScopeScheduledMilliseconds, monthData.capacity.confirmedAttendanceMilliseconds)}</strong><small>截至今日排单 / 已确认考勤 · {monthData.capacity.confirmedAttendanceRecordCount} 条</small></article>
            </div>
            <div className="planning-month-weeks" role="table" aria-label="月度生产周负荷">
              <div className="planning-month-week header" role="row"><span>生产周</span><span>批次 / 数量</span><span>承诺工时</span><span>冻结工时</span><span>可执行工时</span><span>可用工时</span><span>负荷率</span><span>操作</span></div>
              {monthData.weeks.map(week => <div className="planning-month-week" role="row" key={week.weekStartDate}>
                <span><strong>{week.weekStartDate.slice(5)} - {week.weekEndDate.slice(5)}</strong><small>{week.weekStartDate.slice(0, 4)}</small></span>
                <span><strong>{week.batchCount} 批</strong><small>{week.totalQuantity.toLocaleString()} 件</small></span>
                <span><strong>{totalDuration(week.scheduledMilliseconds)}</strong>{week.missingTimeBatchCount > 0 && <small className="warning">{week.missingTimeBatchCount} 批待补</small>}</span>
                <span className={week.frozenBatchCount ? 'frozen' : ''}><strong>{totalDuration(week.frozenMilliseconds)}</strong><small>{week.frozenBatchCount} 批</small></span>
                <span><strong>{totalDuration(week.executableMilliseconds)}</strong></span>
                <span><strong>{totalDuration(week.plannedCapacityMilliseconds)}</strong></span>
                <span className="rate"><strong>{planningCapacityRate(week.scheduledMilliseconds, week.plannedCapacityMilliseconds)}</strong></span>
                <span><button type="button" onClick={() => selectScheduleWeek(week.weekStartDate)}>进入周排程<ChevronRight size={13} /></button></span>
              </div>)}
              {!monthData.weeks.length && <div className="planning-empty"><CalendarRange /><strong>该月暂无排产批次</strong><span>可从周排程进入滚动 12 周范围安排草稿。</span></div>}
            </div>
          </>}
        </section>}

        {view === 'schedule' && <section className="planning-schedule-workspace">
          {orderPoolOpen && <div className="planning-order-pool-drawer open">
            <button className="planning-order-pool-scrim" type="button" aria-label="关闭订单池" onClick={() => { setOrderPoolOpen(false); orderPoolTriggerRef.current?.focus(); }} />
            <aside className="planning-order-pool" role="dialog" aria-modal="true" aria-label="待安排订单池">
              <header><div><span>待安排</span><h2>订单池</h2></div><b>{planDataAvailable ? orderPool.length : '—'}</b><button ref={orderPoolCloseRef} type="button" aria-label="关闭订单池" onClick={() => { setOrderPoolOpen(false); orderPoolTriggerRef.current?.focus(); }}><X size={18} /></button></header>
              <div className="planning-pool-list hm-scroll-region" tabIndex={0}>
                {orderPool.map(order => <article className={`priority-${order.priority}`} key={order.id}>
                  <div className="planning-pool-order"><span>{order.specification}</span><em>{priorityText(order.priority)}</em></div>
                  <strong title={order.specification}>{order.specification}</strong>
                  <p title={`${order.customerName} · ${order.productName}`}>{order.customerName}<small>{order.productName}</small></p>
                  <div className="planning-pool-resources" title={sopStageInfo(order).title}><span className={order.drawingFileCount ? 'ready' : 'warning'}>图纸 {order.drawingFileCount || '缺'}</span><span className={order.sopFileCount ? 'ready' : 'warning'}>SOP {order.sopFileCount || '缺'}</span><span className={`sop-stage ${sopStageInfo(order).stage}`}><FlaskConical size={11} />{sopStageInfo(order).label}</span>{Boolean(order.qualityWarningCount) && <span className={`quality-warning severity-${order.highestQualityWarningSeverity?.toLowerCase()}`}><ShieldAlert size={11} />警示 {order.qualityWarningCount}{order.qualityWarningPrintRequired ? ' · 必打' : ''}</span>}</div>
                  <dl><div><dt>未排数量</dt><dd>{order.remainingQuantity.toLocaleString()}</dd></div><div><dt>客户交期</dt><dd>{order.customerDueDate ? order.customerDueDate.slice(5) : '待确认'}</dd></div><div><dt>单件工时</dt><dd>{duration(planningUnitMilliseconds(order))}</dd></div></dl>
                  <div className="planning-pool-actions">
                    <button className="schedule" type="button" disabled={saving} onClick={event => { setOrderPoolOpen(false); openBatch(order, orderPoolTriggerRef.current || event.currentTarget); }}><Plus size={15} />安排批次</button>
                    <button className="delete" type="button" disabled={saving} title="从计划系统删除，保留图纸与产品工时" aria-label={`删除计划 ${order.specification}`} onClick={() => { void deleteOrder(order); }}><Trash2 size={15} /></button>
                  </div>
                </article>)}
                {!loading && planDataAvailable && !orderPool.length && <div className="planning-empty compact"><CheckCircle2 /><strong>订单池已安排完毕</strong><span>新增订单或调整筛选后继续排程。</span></div>}
              </div>
            </aside>
          </div>}

          <div className="planning-schedule-board">
            <header className="planning-board-heading">
              <div>
                <span>{editableWeekLabel(selectedWeekKey)}排单工作区</span>
                <h2>{selectedWeek ? `${selectedWeek.weekStartDate.slice(5)} - ${selectedWeek.weekEndDate.slice(5)}` : '生产周加载中'}</h2>
              </div>
              <div>
                <button ref={orderPoolTriggerRef} className="pool" type="button" aria-haspopup="dialog" aria-expanded={orderPoolOpen} onClick={() => setOrderPoolOpen(true)}><PanelLeftOpen size={15} />订单池<b>{planDataAvailable ? orderPool.length : '—'}</b></button>
                <button className="export" type="button" aria-haspopup="dialog" onClick={event => { void openWeeklyPlanExport(event.currentTarget); }}><FileSpreadsheet size={15} />导出计划</button>
                <button className="import" type="button" onClick={event => openPlanningImport(event.currentTarget)}><Upload size={15} />导入{editableWeekLabel(selectedWeekKey)}清单</button>
                <button type="button" onClick={selectAllDrafts}><Check size={15} />全选草稿</button>
                <em>{planDataAvailable
                  ? <>{readinessFilters.length ? `筛选 ${scheduleRows.length} / ${baseScheduleRows.length} 批` : `${scheduleRows.length} 个正常批次`} · {selectedWeekQuantity.toLocaleString()} 件 · {selectedWeekTotalMilliseconds ? duration(selectedWeekTotalMilliseconds) : '工时待补'}{selectedWipContinuations.length ? ` ｜ 半成品续作 ${selectedWipContinuations.length} 项 · ${selectedWipQuantity.toLocaleString()} 件 · ${duration(selectedWipMilliseconds)}` : ''}</>
                  : '排产数据未获取'}</em>
              </div>
            </header>
            <WeekReconciliationBar
              className="planning-week-reconciliation"
              weekStartDate={selectedWeek?.weekStartDate}
              weekEndDate={selectedWeek?.weekEndDate}
            />
            {selectedWipContinuations.length > 0 && <aside className="planning-wip-branch" aria-label={`半成品续作独立分支，共 ${selectedWipContinuations.length} 项`}>
              <span><Boxes size={17} /><strong>半成品续作独立分支</strong><em>{selectedWipContinuations.length} 项 · {selectedWipQuantity.toLocaleString()} 件 · {duration(selectedWipMilliseconds)}</em></span>
              <small>本表只保留正常订单；半成品剩余工序在独立台账管理，并已计入本周口径。</small>
              <a href={`/workspace/wip?view=scheduled&week=${encodeURIComponent(selectedWeekStartDate)}`}>查看本周半成品<ChevronRight size={13} /></a>
            </aside>}
            <section className={selectedWeekKey === 'current' && carryoverRows.length ? `planning-carryover ${carryoverOpen ? 'open' : ''}` : 'planning-carryover empty'} aria-label="历史周遗留未完">
              {selectedWeekKey === 'current' && carryoverRows.length > 0 && <>
                <button className="planning-carryover-summary" type="button" aria-expanded={carryoverOpen} onClick={() => setCarryoverOpen(current => !current)}>
                  <span><AlertTriangle size={15} /><strong>历史周遗留未完 {carryoverRows.length} 批</strong><small>{carryoverQuantity.toLocaleString()} 件仍保留原生产周，不会混入本周清单</small></span>
                  <ChevronDown size={15} aria-hidden="true" />
                </button>
                {carryoverOpen && <div className="planning-carryover-list">
                  {carryoverRows.map(({ order, batch }) => {
                    const flow = planningFlow(order, batch);
                    return <article key={batch.id}>
                      <span><small>{batch.weekStartDate.slice(5)} - {batch.weekEndDate.slice(5)}</small><strong>{order.specification}</strong><em>{order.customerName} · {batch.quantity.toLocaleString()} 件</em></span>
                      <b className={`tone-${flow.tone}`}>{flow.label}</b>
                      {batch.releaseState === 'draft'
                        ? <button type="button" onClick={event => { void previewMove(periods?.current.weekStartDate || '', event.currentTarget, [batch.id]); }}><MoveRight size={14} />移入本周</button>
                        : batch.workOrderId
                          ? <><a href={`/workspace/wip?batchId=${encodeURIComponent(batch.id)}`}>转半成品</a><a href={productionExecutionHref(batch, periods, true)}>查看执行<ChevronRight size={13} /></a></>
                          : <span className="locked">已下达</span>}
                    </article>;
                  })}
                </div>}
              </>}
            </section>
            <div ref={scheduleScrollRef} className="planning-table-scroll hm-scroll-region" tabIndex={0}>
              <table className="planning-table">
                <thead><tr><th className="production-list-sequence">序号</th><th className="select-cell">选择</th><th>订单 / 产品</th><th>排产数量</th><th>生产周</th><th>内部完成</th><th>客户交期</th><th>单件 / 总工时</th><th>生产资料</th><th>仓库</th><th>工艺</th><th>流程状态</th><th>打印</th><th className="planning-control-note">备注</th><th className="planning-control-actions">操作</th></tr></thead>
                <tbody>{scheduleRows.map(({ order, batch }, rowIndex) => {
                  const flow = planningFlow(order, batch);
                  const processDisplay = planningProcessDisplay({
                    processStatus: batch.processStatus || 'not_created',
                    productTimeProfileVersion: order.currentProductTimeVersion,
                    routeSource: batch.processRouteSource,
                    routeProductTimeProfileVersion: batch.processRouteProductTimeProfileVersion,
                  });
                  const processFinishedAt = batch.processCompletedAt || batch.processConfirmedAt;
                  const flowFinishedAt = batch.workOrderCompletedAt;
                  const workflowParams = workflowCenterParams(batch, periods);
                  const printState = travelerPrintStatus(batch);
                  const drawingLibraryHref = buildPlanningDrawingLibraryHref({
                    drawingLibraryItemId: order.drawingLibraryItemId,
                    customerName: order.customerName,
                    specification: order.specification,
                    productName: order.productName,
                    batchId: batch.id,
                    weekStartDate: batch.weekStartDate,
                    weekEndDate: batch.weekEndDate,
                  });
                  const sopInfo = sopStageInfo(order);
                  const activeHold = batch.holds?.find(hold => hold.status === 'ACTIVE') || null;
                  const movedOutContinuations = wipContinuations.filter(item => (
                    item.productionPlanBatchId === batch.id
                    && item.sourceWeekStartDate === batch.weekStartDate
                    && item.targetWeekStartDate !== item.sourceWeekStartDate
                    && item.status !== 'CANCELLED'
                  ));
                  return <Fragment key={batch.id}>
                  <tr data-batch-id={batch.id} className={`state-${batch.releaseState} ${activeHold ? 'state-frozen' : ''} ${expandedOrderId === batch.id ? 'expanded' : ''}`}>
                    <td className="production-list-sequence">{rowIndex + 1}</td>
                    <td className="select-cell"><input type="checkbox" aria-label={`选择 ${order.specification} 第 ${batch.batchNo} 批`} checked={selectedBatchIds.includes(batch.id)} disabled={batch.releaseState === 'archived'} onChange={() => toggleBatch(batch.id)} /></td>
                    <td><button className="planning-product-link" type="button" title={`${order.specification} · ${order.productName}${order.qualityWarningCount ? ` · ${order.qualityWarningCount}条质量警示` : ''}`} onClick={() => setExpandedOrderId(current => current === batch.id ? '' : batch.id)}><strong>{order.specification}{Boolean(order.qualityWarningCount) && <em className={`planning-quality-warning-badge severity-${order.highestQualityWarningSeverity?.toLowerCase()}`}><ShieldAlert size={11} />{planningWarningSeverityLabel[order.highestQualityWarningSeverity || 'LOW']} · {order.qualityWarningCount}</em>}</strong><span>{order.customerName} · {order.productName}</span><small>{order.salesperson ? `业务员 ${order.salesperson} · ` : ''}第 {batch.batchNo} 批{order.qualityWarningPrintRequired ? ' · 警示附页必打' : ''}</small>{movedOutContinuations.length > 0 && <em className="planning-wip-moved-badge"><Boxes size={11} />剩余已转至 {movedOutContinuations.map(item => item.targetWeekStartDate.slice(5)).join('、')} 周</em>}</button></td>
                    <td><b>{batch.quantity.toLocaleString()}</b><small>订单 {order.orderQuantity.toLocaleString()}</small></td>
                    <td><strong title={`${batch.weekStartDate} 至 ${batch.weekEndDate}`}>{weekLabel(batch, periods)}</strong><small>{batch.weekStartDate.slice(5)} - {batch.weekEndDate.slice(5)}</small></td>
                    <td><strong>{(batch.estimatedCompletionDate || batch.plannedCompletionDate).slice(5)}</strong><small>原计划 {batch.plannedCompletionDate.slice(5)}</small>{batch.workOrderId && canAdjustProductionDates(user) && <ProductionControlButton workOrderId={batch.workOrderId} mode="adjust_date">调整日期</ProductionControlButton>}</td>
                    <td><strong className={Boolean(order.customerDueDate) && (batch.estimatedCompletionDate || batch.plannedCompletionDate) > order.customerDueDate ? 'danger-text' : ''}>{order.customerDueDate ? order.customerDueDate.slice(5) : '待确认'}</strong></td>
                    <td><strong>{duration(batch.unitMillisecondsSnapshot || planningUnitMilliseconds(order))}</strong><small>{totalDuration(batchTotalMilliseconds(order, batch))}</small></td>
                    <td><div className="planning-document-status"><span className={order.drawingFileCount ? 'ready' : 'warning'}>图纸 {order.drawingFileCount || '缺'}</span><span className={order.sopFileCount ? 'ready' : 'warning'}>SOP {order.sopFileCount || '缺'}</span><a className={`planning-sop-stage ${sopInfo.stage}`} href={drawingLibraryHref} onClick={rememberPlanningState} title={sopInfo.title} aria-label={`SOP 状态 ${sopInfo.label}，进入图纸档案`}><FlaskConical size={12} />{sopInfo.label}</a>{Boolean(order.qualityWarningCount) && <a className={`planning-warning-link severity-${order.highestQualityWarningSeverity?.toLowerCase()}`} href={`${drawingLibraryHref}#quality-warning`} onClick={rememberPlanningState} title={`${order.qualityWarningCount} 条已归档产品异常警示`}><ShieldAlert size={12} />警示 {order.qualityWarningCount}</a>}</div></td>
                    <td><div className="planning-material-control">
                      <span className={`planning-status status-${batch.warehouseStatus}`}><strong>{batch.warehouseStatus === 'completed' ? '已配料' : batch.warehouseStatus === 'exception' ? '异常/缺料' : batch.warehouseStatus === 'not_created' ? '未下达' : '待配料'}</strong>{batch.warehouseCompletedAt && <small>{flowTime(batch.warehouseCompletedAt)}</small>}</span>
                      {activeHold && <span className="planning-status status-frozen" title={activeHold.reason}><strong><LockKeyhole size={12} />生产冻结</strong><small>{activeHold.reason}</small></span>}
                      {batch.warehouseStatus !== 'completed' && <small className="planning-material-warning">仅提示，不影响开工/报工</small>}
                    </div></td>
                    <td><span className={`planning-status status-${batch.processStatus} readiness-${processDisplay.readiness}`}><strong>{processDisplay.label}</strong>{processDisplay.detail && <small>{processDisplay.detail}</small>}{processFinishedAt && <small>{flowTime(processFinishedAt)}</small>}</span></td>
                    <td><a className={`planning-flow-link tone-${flow.tone}`} href={`/workspace/workflows?${workflowParams.toString()}`} onClick={rememberPlanningState} title="查看该批次完整流程"><strong>{flow.label}</strong>{flowFinishedAt && <small>{flowTime(flowFinishedAt)}</small>}</a></td>
                    <td><div className={`planning-print-status ${printState.tone}`}><span><strong>{printState.label}</strong>{printState.time && <small>{flowTime(printState.time)}</small>}{batch.travelerPrintMaterials && <span className="planning-print-materials">{(['TRAVELER', 'QUALITY_WARNING', 'SOP', 'DRAWING'] as const).map(material => {
                      const item = batch.travelerPrintMaterials?.[material];
                      if (!item) return null;
                      const label = material === 'TRAVELER' ? '码' : material === 'QUALITY_WARNING' ? '警' : material === 'SOP' ? 'SOP' : '图';
                      return <em key={material} className={item.status} title={`${material === 'TRAVELER' ? '二维码流转单' : material === 'QUALITY_WARNING' ? '质量异常警示附页' : material === 'SOP' ? 'SOP' : '原图'}：${item.status === 'printed' ? '已打印' : item.status === 'needs_reprint' ? '待重打' : item.status === 'legacy_unverified' ? '待核验' : '待确认'}`}>{label}</em>;
                    })}</span>}</span>{batch.workOrderId && <button type="button" title="打印生产资料" aria-label={`打印 ${order.specification} 生产资料`} onClick={() => setTravelerPrintIds([batch.workOrderId!])}><Printer size={15} /></button>}</div></td>
                    <td className="planning-control-note">{batch.workOrderId ? <ProductionControlButton workOrderId={batch.workOrderId} className="production-note-button"><ProductionNoteSummary control={batch.productionControl} /></ProductionControlButton> : <span>下达后可维护生产备注</span>}</td>
                    <td className="planning-control-actions"><div className="planning-row-actions">{batch.workOrderId && !batch.workOrderCompletedAt && <a href={`/workspace/wip?batchId=${encodeURIComponent(batch.id)}`} title="将未完成工序转入半成品仓">转半成品</a>}{batch.workOrderId && canManageProductionControl(user) && !batch.workOrderCompletedAt && <ProductionControlButton workOrderId={batch.workOrderId} mode={batch.productionControl?.pausedAt ? "resume" : "pause"}>{batch.productionControl?.pausedAt ? "恢复生产" : "暂停"}</ProductionControlButton>}<button type="button" title="调整批次" aria-label="调整批次" onClick={event => openBatch(order, event.currentTarget, batch)}><Pencil size={15} /></button>{batch.releaseState === 'draft' && <button className="danger" type="button" title="删除批次" aria-label="删除批次" onClick={() => { void deleteBatch(batch); }}><Trash2 size={15} /></button>}<button type="button" title="展开详情" aria-label="展开详情" onClick={() => setExpandedOrderId(current => current === batch.id ? '' : batch.id)}><ChevronDown size={15} /></button></div></td>
                  </tr>
                  {expandedOrderId === batch.id && <tr className="planning-inspector-row" key={`${batch.id}-detail`}><td colSpan={15}><div className="planning-inline-inspector">
                    <div><span>订单信息</span><strong>{order.salesperson ? `业务员 ${order.salesperson}` : '业务员未设置'}</strong><small>{order.remark || '无备注'}</small></div>
                    <div><span>流程状态</span><strong>{flow.label}</strong><small>仓库 {batch.warehouseStatus} · 工艺 {batch.processStatus}</small></div>
                    <div><span>数据来源</span><strong>{order.currentProductTimeVersion ? `产品工时 V${order.currentProductTimeVersion}` : order.planningUnitMilliseconds ? '订单计划工时' : '工时待维护'}</strong><small>{order.currentProductTimeVersion ? '正式工序工时' : '计划估算，投产前仍需发布工序工时'}</small></div>
                    <div><span>SOP 状态</span><strong className={`sop-text-${sopInfo.stage}`}>{sopInfo.label}{order.sopFileCount ? ` · ${order.sopFileCount} 个文件` : ' · 缺文件'}</strong><small title={order.sopRemark || '暂无备注'}>{order.sopRemark || '暂无验证备注'}</small></div>
                    <div><span>质量警示</span><strong className={order.qualityWarningCount ? `planning-warning-text severity-${order.highestQualityWarningSeverity?.toLowerCase()}` : ''}>{order.qualityWarningCount ? `${planningWarningSeverityLabel[order.highestQualityWarningSeverity || 'LOW']}风险 · ${order.qualityWarningCount} 条${order.qualityWarningPrintRequired ? ' · 必须随单打印' : ''}` : '无活动警示'}</strong><small>{order.qualityWarningCount ? '由已归档重大异常按产品自动同步' : '当前产品未命中生效警示'}</small></div>
                    <nav><a href={drawingLibraryHref} onClick={rememberPlanningState}>{order.drawingLibraryItemId ? '进入图纸档案' : '建立图纸档案'}</a><a href="/workspace/warehouse">仓库任务</a><a href={productTimeHref(order, batch, periods)} onClick={rememberPlanningState}>工艺与工时</a><a href={`/workspace/workflows?${workflowParams.toString()}`} onClick={rememberPlanningState}>查看完整流程</a></nav>
                  </div></td></tr>}
                </Fragment>;
                })}</tbody>
              </table>
              {!loading && planDataAvailable && !scheduleRows.length && <div className="planning-empty"><CalendarClock /><strong>{readinessFilters.length ? '没有符合准备状态的批次' : selectedWipContinuations.length ? '本周没有正常批次，半成品在独立分支' : `${editableWeekLabel(selectedWeekKey)}还没有排产批次`}</strong><span>{readinessFilters.length ? '清除或调整准备状态筛选后再查看。' : selectedWipContinuations.length ? '使用上方“查看本周半成品”进入独立台账，不再与正常订单挤在同一张表。' : `从左侧订单池安排到 ${selectedWeek?.weekStartDate.slice(5) || ''} - ${selectedWeek?.weekEndDate.slice(5) || ''}，或直接导入该周清单。`}</span></div>}
            </div>
          </div>
        </section>}

        {view === 'orders' && <section className="planning-orders-view">
          <header><div><span>实时订单</span><h2>生产订单池</h2><p>订单变化直接在这里维护，不再依赖重复上传 Excel。</p></div><b>{planDataAvailable ? readinessFilters.length ? `筛选 ${filteredOrders.length} / ${baseFilteredOrders.length} 单` : `${filteredOrders.length} 单` : '未获取数据'}</b></header>
          <div className="planning-table-scroll hm-scroll-region" tabIndex={0}><table className="planning-table orders"><thead><tr><th className="production-list-sequence">序号</th><th>客户 / 产品</th><th>业务员</th><th>规格 / 警示</th><th>数量</th><th>已排 / 未排</th><th>下单日期</th><th>客户交期</th><th>优先级</th><th>单件 / 总工时</th><th>操作</th></tr></thead><tbody>{filteredOrders.map((order, rowIndex) => <tr key={order.id}><td className="production-list-sequence">{rowIndex + 1}</td><td><strong>{order.customerName}</strong><small>{order.productName}</small></td><td>{order.salesperson || '未设置'}</td><td><b>{order.specification}</b>{Boolean(order.qualityWarningCount) && <span className={`planning-quality-warning-badge severity-${order.highestQualityWarningSeverity?.toLowerCase()}`}><ShieldAlert size={11} />{planningWarningSeverityLabel[order.highestQualityWarningSeverity || 'LOW']}风险 · {order.qualityWarningCount}{order.qualityWarningPrintRequired ? ' · 必打' : ''}</span>}</td><td>{order.orderQuantity.toLocaleString()}</td><td><strong>{order.allocatedQuantity.toLocaleString()} / {order.remainingQuantity.toLocaleString()}</strong></td><td>{order.orderDate}</td><td>{order.customerDueDate || '客户交期待确认'}</td><td><span className={`planning-priority ${order.priority}`}>{priorityText(order.priority)}</span></td><td><span className={`planning-status ${planningUnitMilliseconds(order) ? 'ready' : 'warning'}`}>{duration(planningUnitMilliseconds(order))}<small>{totalDuration(order.planningTotalMilliseconds)}</small></span></td><td><div className="planning-row-actions text"><button type="button" disabled={saving} onClick={event => openBatch(order, event.currentTarget)}><Plus size={14} />排产</button><button type="button" disabled={saving} onClick={event => openEditOrder(order, event.currentTarget)}><Pencil size={14} />编辑</button><button className="danger" type="button" disabled={saving} onClick={() => { void deleteOrder(order); }}><Trash2 size={14} />删除</button></div></td></tr>)}</tbody></table>{!loading && planDataAvailable && !filteredOrders.length && <div className="planning-empty"><ClipboardList /><strong>{readinessFilters.length ? '没有符合准备状态的订单' : '订单池为空'}</strong><span>{readinessFilters.length ? '清除或调整准备状态筛选后再查看。' : '点击右上角“新建订单”开始建立实时计划。'}</span></div>}</div>
        </section>}

        {view === 'preparation' && <section className="planning-preparation-view">
          <header><div><span>下周提前生产</span><h2>{periods ? `${periods.next.weekStartDate} 至 ${periods.next.weekEndDate}` : '下周生产清单'}</h2><p>排入下周后自动生成生产工单，可直接提前处理；跨周后自动转为本周执行。</p></div><a className="planning-primary-action" href="/production?scope=next"><Factory size={16} />进入下周生产</a></header>
          <div className="planning-preparation-grid"><section><div className="planning-prep-heading"><Warehouse /><span><strong>仓库配料</strong><small>{planDataAvailable ? `${preparationRows.filter(item => item.batch.warehouseStatus === 'completed').length} / ${preparationRows.length} 已完成` : '数据尚未获取'}</small></span><a href="/workspace/warehouse?scope=preparation">进入仓库</a></div>{preparationRows.map(({ order, batch }) => <article key={batch.id}><span className={`state-${batch.warehouseStatus}`}><Boxes /></span><div><strong>{order.specification}</strong><small>{order.customerName} · {batch.quantity.toLocaleString()} 件</small></div><em>{batch.warehouseStatus === 'completed' ? '已配料' : batch.warehouseStatus === 'exception' ? '仓库异常' : '待配料'}</em></article>)}</section><section><div className="planning-prep-heading"><Settings2 /><span><strong>工艺准备</strong><small>{planDataAvailable ? `${preparationRows.filter(item => item.batch.processStatus !== 'not_created' && item.batch.processStatus !== 'draft').length} / ${preparationRows.length} 已确认` : '数据尚未获取'}</small></span><a href={productTimeConfigurationRoute(null, { scope: 'next', from: 'planning', returnTo: '/weekly-plan-center?restore=1' })} onClick={rememberPlanningState}>维护工时</a></div>{preparationRows.map(({ order, batch }) => { const unitMilliseconds = batch.unitMillisecondsSnapshot || planningUnitMilliseconds(order); return <article key={batch.id}><span className={`state-${batch.processStatus}`}><Settings2 /></span><div><strong>{order.specification}</strong><small>{unitMilliseconds ? `单根 ${duration(unitMilliseconds)}${order.currentProductTimeVersion ? '' : ' · 批次计划值'}` : '单根工时待维护'}</small></div><em>{batch.processStatus === 'confirmed' || batch.processStatus === 'in_progress' || batch.processStatus === 'completed' ? '已确认' : '待工艺'}</em></article>; })}</section></div>
          {planDataAvailable && !preparationRows.length && <div className="planning-empty"><PackageCheck /><strong>当前没有下周生产任务</strong><span>将订单排入下周后，系统会自动生成生产工单并显示在这里。</span></div>}
        </section>}

        {view === 'changes' && <section className="planning-changes-view"><header><div><span>可追溯变更</span><h2>插单与计划调整记录</h2><p>已下达订单修改后同步关联工单，同时保留仓库与工艺处理进度。</p></div><b>{changes.length} 条</b></header><div className="planning-change-list hm-scroll-region">{changes.map(change => <article key={change.id}><i><FilePenLine /></i><div><strong>{changeActionText(change.action)}</strong><span>{change.actor?.displayName || change.actor?.username || '系统'} · {new Date(change.createdAt).toLocaleString('zh-CN')}</span><p>{change.reason || (change.action === 'direct_delete_plan_order' ? '未填写删除说明' : '常规计划操作')}</p></div><em>{change.planOrderId ? '订单变更' : '计划操作'}</em></article>)}{changesLoading && <div className="planning-loading">正在加载变更记录...</div>}{!changesLoading && !changes.length && <div className="planning-empty"><History /><strong>暂无计划变更</strong><span>新增、排程和下达操作会自动记录。</span></div>}</div></section>}

        {view === 'history' && <section className="planning-history-view">
          <header>
            <div>
              <span>独立历史周排单</span>
              <h2>{selectedHistoryWeek ? `${selectedHistoryWeek.weekStartDate} 至 ${selectedHistoryWeek.weekEndDate}` : '历史计划'}</h2>
              <p>每个历史周独立保存并只读展示，未完任务在本周“遗留未完”区继续跟进。</p>
            </div>
            <div className="planning-history-controls">
              <label><span>选择历史周</span><select value={selectedHistoryWeek?.weekStartDate || ''} onChange={event => selectHistoryWeek(event.target.value)}>{periods?.history.map(week => <option key={week.weekStartDate} value={week.weekStartDate}>{week.weekStartDate.slice(5)} - {week.weekEndDate.slice(5)} · {week.batchCount} 批</option>)}</select></label>
              <b>{historyRows.length} 批<small>{historyQuantity.toLocaleString()} 件</small></b>
            </div>
          </header>
          <WeekReconciliationBar
            className="planning-week-reconciliation history"
            weekStartDate={selectedHistoryWeek?.weekStartDate}
            weekEndDate={selectedHistoryWeek?.weekEndDate}
          />
          <div className="planning-table-scroll hm-scroll-region" tabIndex={0}>
            <table className="planning-table history">
              <thead><tr><th>规格</th><th>客户 / 品名</th><th>业务员</th><th>批次数量</th><th>原生产周</th><th>计划完成</th><th>计划状态</th><th>仓库</th><th>工艺</th><th>关联执行 / 操作</th></tr></thead>
              <tbody>{historyRows.map(({ order, batch }) => <tr className={`state-${batch.releaseState}`} key={batch.id}>
                <td><strong>{order.specification}</strong></td>
                <td><strong>{order.customerName}</strong><small>{order.productName}</small></td>
                <td>{order.salesperson || '未设置'}</td>
                <td><strong>{batch.quantity.toLocaleString()}</strong></td>
                <td>{batch.weekStartDate.slice(5)} - {batch.weekEndDate.slice(5)}</td>
                <td>{batch.plannedCompletionDate}</td>
                <td><span className={`planning-release state-${batch.releaseState}`}>{batch.releaseState === 'archived' ? '已归档' : batch.releaseState === 'active' ? '遗留执行中' : batch.releaseState === 'preparation' ? '遗留预备' : '遗留草稿'}</span></td>
                <td>{batch.warehouseStatus === 'completed' ? '已配料' : batch.warehouseStatus === 'exception' ? '异常' : '未完成'}</td>
                <td>{batch.processStatus === 'completed' ? '已完成' : batch.processStatus === 'confirmed' || batch.processStatus === 'in_progress' ? '已确认' : '未完成'}</td>
                <td><nav className="planning-linked-actions">
                  {batch.workOrderId ? <>
                    <a href={productionExecutionHref(batch, periods)}>生产执行</a>
                    <a href={`/workspace/workflows?${workflowCenterParams(batch, periods).toString()}`} onClick={rememberPlanningState}>流程中心</a>
                  </> : <span className="planning-unreleased-label">未下达</span>}
                  <button
                    type="button"
                    className="planning-history-delete-trigger"
                    disabled={saving}
                    aria-label={`删除订单 ${order.specification}`}
                    onClick={event => openHistoricalDelete(order, batch, event.currentTarget)}
                  ><Trash2 size={13} />删除订单</button>
                </nav></td>
              </tr>)}</tbody>
            </table>
            {!loading && planDataAvailable && !historyRows.length && <div className="planning-empty"><History /><strong>该历史周暂无计划</strong><span>选择其他历史周查看；历史计划不会再混入本周排单清单。</span></div>}
          </div>
        </section>}

        {view === 'schedule' && selectedBatchIds.length > 0 && <div className="planning-selection-bar">
          <div><CheckCircle2 /><span><strong>已选 {selectedBatchIds.length} 个批次</strong><small>合计 {selectedQuantity.toLocaleString()} 件 · {editableWeekLabel(selectedWeekKey)}</small></span></div>
          <label className="planning-move-control"><span>调配到</span><select value={moveTargetWeekStartDate} onChange={event => setMoveTargetWeekStartDate(event.target.value)}>{moveTargetWeeks.map(week => <option key={week.key} value={week.weekStartDate}>{editableWeekLabel(week.key)} {week.weekStartDate.slice(5)} - {week.weekEndDate.slice(5)}</option>)}</select></label>
          <button type="button" className="move-action" disabled={saving || !moveTargetWeekStartDate} onClick={event => { void previewMove(moveTargetWeekStartDate, event.currentTarget); }}><MoveRight size={16} />调配周次</button>
          <button type="button" className="secondary" disabled={!selectedPrintableWorkOrderIds.length} title={selectedPrintableWorkOrderIds.length ? '选择流转单与 SOP 打印方式' : '所选批次尚未下达生产，暂无生产工单'} onClick={() => setTravelerPrintIds(selectedPrintableWorkOrderIds)}><Printer size={16} />打印所选</button>
          <button type="button" className="danger-action" disabled={saving} onClick={event => { void previewDeletion(event.currentTarget); }}><Trash2 size={16} />删除计划</button>
          {selectedWeekKey === 'next' && <button type="button" className="secondary" disabled={saving} onClick={event => { void previewRelease('preparation', event.currentTarget); }}><PackageCheck size={16} />下达下周预备</button>}
          {selectedWeekKey === 'current' && <button type="button" className="primary" disabled={saving} onClick={event => { void previewRelease('active', event.currentTarget); }}><Send size={16} />下达本周执行</button>}
          <button type="button" aria-label="清除选择" title="清除选择" onClick={() => setSelectedBatchIds([])}><X size={16} /></button>
        </div>}
      </div>
    </main>

    <TravelerPrintDialog open={travelerPrintIds.length > 0} workOrderIds={travelerPrintIds} onClose={() => setTravelerPrintIds([])} onSuccess={message => { setToast(message); setRefreshToken(value => value + 1); }} />

    {activeDialog && <button
      className={`planning-dialog-scrim ${historicalDeleteTarget ? 'historical-delete-scrim' : ''} ${historicalDeleteClosing ? 'is-closing' : ''}`.trim()}
      type="button"
      aria-label="关闭弹窗"
      onClick={closeDialog}
    />}

    {weeklyPlanExportDialog && <div ref={dialogRef} className="planning-dialog weekly-export-dialog" role="dialog" aria-modal="true" aria-labelledby="weekly-plan-export-title">
      <header>
        <div><span>{weeklyPlanExportDialog.mode === 'week_execution' ? '当前周生产执行' : '计划日期范围'}</span><h2 id="weekly-plan-export-title">选择日期与 Excel 版本</h2></div>
        <button type="button" onClick={closeDialog} disabled={weeklyPlanExportDialog.exporting} aria-label="关闭导出弹窗"><X /></button>
      </header>
      <div className="planning-dialog-body weekly-export-body">
        <div className="weekly-export-range-picker">
          <label><span>开始日期</span><input type="date" value={weeklyPlanExportDialog.startDate} onChange={event => setWeeklyPlanExportDialog(current => current ? { ...current, startDate: event.target.value, mode: 'schedule_range', range: 'current', preview: null } : current)} /></label>
          <label><span>结束日期</span><input type="date" value={weeklyPlanExportDialog.endDate} onChange={event => setWeeklyPlanExportDialog(current => current ? { ...current, endDate: event.target.value, mode: 'schedule_range', range: 'current', preview: null } : current)} /></label>
          <button type="button" disabled={weeklyPlanExportDialog.loading || !weeklyPlanExportDialog.startDate || !weeklyPlanExportDialog.endDate} onClick={() => { void loadWeeklyPlanExportPreview(weeklyPlanExportDialog); }}><RefreshCw size={14} />刷新预览</button>
          <small>按内部计划完成日筛选，起止日期均包含；自定义范围最多 93 天。</small>
        </div>
        {weeklyPlanExportDialog.loading && <div className="planning-loading compact">正在计算计划范围与工时...</div>}
        {weeklyPlanExportDialog.preview && <>
          <section className="weekly-export-summary" aria-label="计划导出统计">
            <article><span>{weeklyPlanExportDialog.mode === 'week_execution' ? '本周新计划' : '范围内计划'}</span><strong>{weeklyPlanExportDialog.preview.summary.current.batchCount} 批</strong><small>{weeklyPlanExportDialog.preview.summary.current.quantity.toLocaleString()} 件 · {weeklyPlanExportHours(weeklyPlanExportDialog.preview.summary.current)}</small></article>
            <article className="carryover"><span>上周遗留</span><strong>{weeklyPlanExportDialog.preview.summary.previousCarryover.batchCount} 批</strong><small>{weeklyPlanExportDialog.preview.summary.previousCarryover.quantity.toLocaleString()} 件 · {weeklyPlanExportHours(weeklyPlanExportDialog.preview.summary.previousCarryover)}</small></article>
            <article className="carryover"><span>更早遗留</span><strong>{weeklyPlanExportDialog.preview.summary.olderCarryover.batchCount} 批</strong><small>{weeklyPlanExportDialog.preview.summary.olderCarryover.quantity.toLocaleString()} 件 · {weeklyPlanExportHours(weeklyPlanExportDialog.preview.summary.olderCarryover)}</small></article>
            <article className="total"><span>本周执行合计</span><strong>{weeklyPlanExportDialog.preview.summary.execution.batchCount} 批</strong><small>{weeklyPlanExportDialog.preview.summary.execution.quantity.toLocaleString()} 件 · {weeklyPlanExportHours(weeklyPlanExportDialog.preview.summary.execution)}</small></article>
          </section>

          <fieldset className="weekly-export-options">
            <legend>导出版本</legend>
            <div className="weekly-export-option-grid">
              <label className={weeklyPlanExportDialog.version === 'full' ? 'selected' : ''}>
                <input type="radio" name="weekly-export-version" value="full" checked={weeklyPlanExportDialog.version === 'full'} onChange={() => setWeeklyPlanExportDialog(current => current ? { ...current, version: 'full' } : current)} />
                <i><FileSpreadsheet /></i>
                <span><strong>完整生产计划版</strong><small>按模板输出 22 列，包含产品、业务员、批次、工时、资料、仓库、工艺、流程、异常与备注。</small></span>
                <em>A3 横向</em>
              </label>
              <label className={weeklyPlanExportDialog.version === 'orders' ? 'selected' : ''}>
                <input type="radio" name="weekly-export-version" value="orders" checked={weeklyPlanExportDialog.version === 'orders'} onChange={() => setWeeklyPlanExportDialog(current => current ? { ...current, version: 'orders' } : current)} />
                <i><ClipboardList /></i>
                <span><strong>订单简版</strong><small>只保留订单编号、客户、规格、数量、交期五列；同一计划订单的多个批次数量自动汇总。</small></span>
                <em>A4 横向</em>
              </label>
            </div>
          </fieldset>

          {weeklyPlanExportDialog.mode === 'week_execution' && <fieldset className="weekly-export-options range-options">
            <legend>数据范围</legend>
            <div className="weekly-export-option-grid">
              <label className={weeklyPlanExportDialog.range === 'execution' ? 'selected' : ''}>
                <input type="radio" name="weekly-export-range" value="execution" checked={weeklyPlanExportDialog.range === 'execution'} onChange={() => setWeeklyPlanExportDialog(current => current ? { ...current, range: 'execution' } : current)} />
                <i><Boxes /></i>
                <span><strong>本周执行清单（推荐）</strong><small>本周新计划加已生效的上周及更早遗留；遗留只计剩余数量和剩余标准工时。</small></span>
                <em>含遗留</em>
              </label>
              <label className={weeklyPlanExportDialog.range === 'current' ? 'selected' : ''}>
                <input type="radio" name="weekly-export-range" value="current" checked={weeklyPlanExportDialog.range === 'current'} onChange={() => setWeeklyPlanExportDialog(current => current ? { ...current, range: 'current' } : current)} />
                <i><CalendarCheck2 /></i>
                <span><strong>仅本周新计划</strong><small>排除 {weeklyPlanExportDialog.preview.summary.carryover.batchCount} 个有效遗留批次；Excel 顶部会明确注明未包含的遗留工作量。</small></span>
                <em>不含遗留</em>
              </label>
            </div>
          </fieldset>}

          <div className={`planning-dialog-note ${weeklyPlanExportDialog.range === 'current' && weeklyPlanExportDialog.preview.summary.carryover.batchCount ? 'warning' : ''}`}>
            {weeklyPlanExportDialog.mode === 'schedule_range' || weeklyPlanExportDialog.range === 'execution' ? <CheckCircle2 /> : <AlertTriangle />}
            <span>
              <strong>{weeklyPlanExportDialog.mode === 'schedule_range' ? '按内部完成日导出，每个批次只出现一次' : weeklyPlanExportDialog.range === 'execution' ? '导出完整的本周执行范围' : '本次文件不会包含遗留批次'}</strong>
              <small>{weeklyPlanExportDialog.mode === 'schedule_range'
                ? `${weeklyPlanExportDialog.startDate} 至 ${weeklyPlanExportDialog.endDate}，不自动追加遗留，避免跨周重复。`
                : weeklyPlanExportDialog.range === 'execution'
                ? `有效遗留 ${weeklyPlanExportDialog.preview.summary.carryover.batchCount} 批将进入文件，且不会重复计算已经完成的数量。`
                : `将排除 ${weeklyPlanExportDialog.preview.summary.carryover.batchCount} 批、${weeklyPlanExportDialog.preview.summary.carryover.quantity.toLocaleString()} 件遗留工作量。`}</small>
            </span>
          </div>
        </>}
        {error && <div className="planning-dialog-error"><AlertTriangle />{error}</div>}
      </div>
      <footer>
        <button type="button" onClick={closeDialog} disabled={weeklyPlanExportDialog.exporting}>取消</button>
        <button type="button" className="primary" disabled={weeklyPlanExportDialog.loading || weeklyPlanExportDialog.exporting || !weeklyPlanExportDialog.preview} onClick={() => { void downloadWeeklyPlanExport(); }}>
          {weeklyPlanExportDialog.exporting ? '正在生成 Excel...' : `导出${weeklyPlanExportDialog.version === 'full' ? '完整计划版' : '订单简版'}`}
        </button>
      </footer>
    </div>}

    {orderDialog && <div ref={dialogRef} className="planning-dialog order-dialog" role="dialog" aria-modal="true" aria-labelledby="planning-order-dialog-title">
      <header><div><span>{orderDialog.mode === 'create' ? '实时订单池' : '订单变更'}</span><h2 id="planning-order-dialog-title">{orderDialog.mode === 'create' ? '新建计划订单' : '编辑计划订单'}</h2></div><button type="button" onClick={closeDialog} aria-label="关闭"><X /></button></header>
      <div className="planning-dialog-body">
        <div className="planning-form-grid">
          <div
            ref={productPickerRef}
            className={`planning-product-picker wide mode-${productEntryMode}`}
            onBlur={event => {
              if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
              setProductPickerOpen(false);
              setActiveProductIndex(-1);
            }}
          >
            {productEntryMode === 'select' ? <>
              <label htmlFor="planning-product-search">选择图纸资料库产品 *</label>
              <div className="planning-product-search">
                <Search size={18} />
                <input
                  ref={productSearchInputRef}
                  id="planning-product-search"
                  role="combobox"
                  aria-autocomplete="list"
                  aria-expanded={productPickerOpen}
                  aria-controls="planning-product-results"
                  aria-activedescendant={productPickerOpen && activeProductIndex >= 0 ? `planning-product-option-${visibleProductOptions[activeProductIndex]?.id}` : undefined}
                  value={productKeyword}
                  onFocus={() => setProductPickerOpen(true)}
                  onChange={event => updateProductKeyword(event.target.value)}
                  onKeyDown={handleProductSearchKeyDown}
                  placeholder="搜索客户、规格或产品名称"
                />
                <div className="planning-product-search-actions">
                  {(productKeyword || orderDraft.drawingLibraryItemId) && <button type="button" aria-label="清除所选产品" title="清除所选产品" onClick={() => clearProductSelection()}><X size={16} /></button>}
                  <button type="button" aria-label={productPickerOpen ? '收起产品列表' : '展开产品列表'} title={productPickerOpen ? '收起产品列表' : '展开产品列表'} onClick={() => { setProductPickerOpen(value => !value); setActiveProductIndex(0); productSearchInputRef.current?.focus(); }}><ChevronDown size={17} /></button>
                </div>
              </div>
              {productPickerOpen && <div id="planning-product-results" className="planning-product-results" role="listbox" aria-label="图纸资料库产品">
                {visibleProductOptions.map((option, index) => {
                  const optionSop = sopStageInfo(option);
                  return <button
                    id={`planning-product-option-${option.id}`}
                    key={option.id}
                    type="button"
                    role="option"
                    aria-selected={index === activeProductIndex || option.id === orderDraft.drawingLibraryItemId}
                    onPointerMove={() => setActiveProductIndex(index)}
                    onClick={() => selectProduct(option)}
                  >
                    <span><strong>{option.specification}</strong><small>{option.customerName} · {option.productName}</small></span>
                    <div className="planning-product-option-badges"><em className={`sop-stage ${optionSop.stage}`} title={optionSop.title}>{optionSop.label}</em><em>{option.publishedProductTimeVersion ? `工时 V${option.publishedProductTimeVersion}` : '工时待发布'}</em>{Boolean(option.qualityWarningCount) && <em className={`quality-warning severity-${option.highestQualityWarningSeverity?.toLowerCase()}`}><ShieldAlert size={11} />警示 {option.qualityWarningCount}{option.qualityWarningPrintRequired ? ' · 必打' : ''}</em>}</div>
                  </button>;
                })}
                {!visibleProductOptions.length && <div className="planning-product-empty">
                  <strong>没有匹配的图纸产品</strong>
                  <span>可以直接建立新型号，订单会自动与图纸资料库绑定。</span>
                  {orderDialog.mode === 'create' && productKeyword.trim() && <button type="button" onClick={beginCreateProduct}><Plus size={15} />创建新型号“{productKeyword.trim()}”</button>}
                  <a href="/drawing-library">前往图纸资料库</a>
                </div>}
              </div>}
              {selectedProduct && <section className="planning-selected-product">
                <div><span>已绑定图纸产品</span><strong title={selectedProduct.specification}>{selectedProduct.specification}</strong><small>{selectedProduct.customerName} · {selectedProduct.productName}</small></div>
                <div><span>原图 {selectedProduct.drawingFileCount}</span><span>SOP {selectedProduct.sopFileCount}</span><span className={`sop-stage ${sopStageInfo(selectedProduct).stage}`} title={sopStageInfo(selectedProduct).title}>{sopStageInfo(selectedProduct).label}</span><span className={selectedProduct.publishedProductTimeVersion ? 'ready' : 'warning'}>{selectedProduct.publishedProductTimeVersion ? `工时 V${selectedProduct.publishedProductTimeVersion}` : '工时待发布'}</span>{Boolean(selectedProduct.qualityWarningCount) && <span className={`quality-warning severity-${selectedProduct.highestQualityWarningSeverity?.toLowerCase()}`}><ShieldAlert size={11} />{planningWarningSeverityLabel[selectedProduct.highestQualityWarningSeverity || 'LOW']}风险 {selectedProduct.qualityWarningCount}{selectedProduct.qualityWarningPrintRequired ? ' · 必打' : ''}</span>}<button type="button" onClick={() => clearProductSelection()}><Search size={14} />更换</button></div>
              </section>}
            </> : <section className="planning-new-product-mode">
              <div><span>新型号建档</span><strong>{orderDraft.specification || '请填写产品规格'}</strong><small>保存订单时同步建立空白图纸资料项；图纸和正式产品工时仍需后续维护。</small></div>
              <button type="button" onClick={() => clearProductSelection()}><Search size={15} />选择已有产品</button>
            </section>}
          </div>
          <label><span>客户{productEntryMode === 'create' ? ' *' : ''}</span><input list={productEntryMode === 'create' ? 'planning-customer-list' : undefined} value={orderDraft.customerName} readOnly={productEntryMode !== 'create'} aria-readonly={productEntryMode !== 'create'} onChange={event => setOrderDraft(current => ({ ...current, customerName: event.target.value }))} /><datalist id="planning-customer-list">{customers.map(item => <option value={item} key={item} />)}</datalist></label>
          <label><span>业务员</span><input list="planning-salesperson-list" value={orderDraft.salesperson} onChange={event => setOrderDraft(current => ({ ...current, salesperson: event.target.value }))} placeholder="按同客户最近订单推荐，可修改" /><datalist id="planning-salesperson-list">{salespeople.map(item => <option value={item} key={item} />)}</datalist></label>
          <label><span>产品规格{productEntryMode === 'create' ? ' *' : ''}</span><input value={orderDraft.specification} readOnly={productEntryMode !== 'create'} aria-readonly={productEntryMode !== 'create'} onChange={event => setOrderDraft(current => ({ ...current, specification: event.target.value }))} /></label>
          <label><span>产品名称{productEntryMode === 'create' ? ' *' : ''}</span><input value={orderDraft.productName} readOnly={productEntryMode !== 'create'} aria-readonly={productEntryMode !== 'create'} onChange={event => setOrderDraft(current => ({ ...current, productName: event.target.value }))} /></label>
          <label><span>订单数量 *</span><input type="number" min="1" value={orderDraft.orderQuantity} onChange={event => setOrderDraft(current => ({ ...current, orderQuantity: event.target.value }))} /></label>
          <label><span>单件产品工时（分钟）</span><input type="number" min="0.001" max="1440" step="0.001" value={orderDraft.planningUnitMinutes} onChange={event => setOrderDraft(current => ({ ...current, planningUnitMinutes: event.target.value }))} /><small>可暂不填写并进入订单池；下达本周或下周计划前必须补齐</small></label>
          <label className="planning-total-time"><span>订单总工时</span><output>{orderDraftTotalMilliseconds ? duration(orderDraftTotalMilliseconds) : '待维护'}</output><small>{orderDraftTotalMilliseconds ? '单件工时 × 订单数量' : '补齐单件工时后自动计算'}</small></label>
          <label><span>优先级</span><select value={orderDraft.priority} onChange={event => setOrderDraft(current => ({ ...current, priority: event.target.value as ProductionPlanPriority }))}><option value="normal">一般</option><option value="urgent">紧急</option><option value="insert">插单</option></select></label>
          <label><span>下单日期 *</span><input type="date" value={orderDraft.orderDate} onChange={event => setOrderDraft(current => ({ ...current, orderDate: event.target.value }))} /></label>
          <label><span>客户交期 *</span><input type="date" disabled={orderDialog?.mode === 'edit' && !canAdjustProductionDates(user)} value={orderDraft.customerDueDate} onChange={event => setOrderDraft(current => ({ ...current, customerDueDate: event.target.value }))} /></label>
          <label className="wide"><span>备注</span><textarea rows={3} value={orderDraft.remark} onChange={event => setOrderDraft(current => ({ ...current, remark: event.target.value }))} /></label>
          {orderDialog.mode === 'edit' && <><label className="wide"><span>订单变更原因</span><textarea rows={2} placeholder="已下达订单变更、修改客户交期时必填" value={orderDraft.reason} onChange={event => setOrderDraft(current => ({ ...current, reason: event.target.value }))} /></label><label className="wide"><span>客户确认说明（改客户交期时必填）</span><textarea rows={2} value={orderDraft.confirmation} onChange={event => setOrderDraft(current => ({ ...current, confirmation: event.target.value }))} /></label></>}
        </div>
        {error && <div className="planning-dialog-error"><AlertTriangle />{error}</div>}
      </div>
      <footer><button type="button" onClick={closeDialog}>取消</button><button type="button" className="primary" disabled={saving || !canSaveOrder} onClick={() => { void saveOrder(); }}>{saving ? '保存中...' : productEntryMode === 'create' ? '保存订单并建档' : '保存订单'}</button></footer>
    </div>}

    {batchDialog && <div ref={dialogRef} className="planning-dialog batch-dialog" role="dialog" aria-modal="true" aria-labelledby="planning-batch-dialog-title">
      <header><div><span>拆批排程</span><h2 id="planning-batch-dialog-title">{batchDialog.batchId ? '调整排产批次' : '安排生产批次'}</h2></div><button type="button" onClick={closeDialog} aria-label="关闭"><X /></button></header>
      <div className="planning-dialog-body">
        <div className="planning-form-grid">
          <label><span>本批数量 *</span><input type="number" min="1" value={batchDraft.quantity} onChange={event => setBatchDraft(current => ({ ...current, quantity: event.target.value }))} /></label>
          <label><span>单根工时（秒）</span><input type="number" min="0.001" max="86400" step="0.001" value={batchDraft.unitSeconds} onChange={event => setBatchDraft(current => ({ ...current, unitSeconds: event.target.value }))} /><small>可暂不填写；订单仍会进入生产执行，但开始工序前必须补齐并发布</small></label>
          <label><span>目标排单周 *</span><select value={batchDraft.weekStartDate} disabled={Boolean(editingBatch && editingBatch.releaseState !== 'draft')} onChange={event => changeBatchWeek(event.target.value)}>{editableWeeks.map(week => <option value={week.weekStartDate} key={week.key}>{editableWeekLabel(week.key)} · {week.weekStartDate.slice(5)} - {week.weekEndDate.slice(5)}</option>)}</select><small>{editingBatch && editingBatch.releaseState !== 'draft' ? '已下达批次不能直接跨周调配' : '每个生产周使用独立排单清单'}</small></label>
          <label><span>原计划完成日期 *</span><input type="date" disabled={Boolean(editingBatch && editingBatch.releaseState !== 'draft')} value={batchDraft.plannedCompletionDate} onChange={event => setBatchDraft(current => ({ ...current, plannedCompletionDate: event.target.value }))} />{editingBatch?.workOrderId && canAdjustProductionDates(user) && <ProductionControlButton workOrderId={editingBatch.workOrderId} mode="adjust_date">调整当前预计完成 / 客户交期</ProductionControlButton>}</label>
          <label className="wide planning-total-time"><span>本批总工时</span><output>{batchDraftTotalMilliseconds ? duration(batchDraftTotalMilliseconds) : '待维护'}</output><small>{batchDraftTotalMilliseconds ? '单根工时 × 本批数量，保存后用于生产工时统计' : '可先排产进入生产待配置，开始工序前补齐工时'}</small></label>
          {batchDialog.batchId && <label className="wide"><span>已下达批次调整原因</span><textarea rows={2} placeholder="如果批次已经下达，此项必填" value={batchDraft.reason} onChange={event => setBatchDraft(current => ({ ...current, reason: event.target.value }))} /></label>}
        </div>
        <div className="planning-dialog-note"><CalendarClock /><span><strong>{batchDraftAutomaticReleaseTarget ? '保存后自动进入生产执行' : batchDraftUnitMilliseconds ? '批次工时随排程冻结' : '先排程，后补工时'}</strong><small>{batchDraftAutomaticReleaseTarget === 'active' ? '本周排产会自动生成工单并显示在本周生产；缺工时的批次保持待配置。' : batchDraftAutomaticReleaseTarget === 'preparation' ? '下周排产会自动生成工单并显示在下周生产，可提前处理。' : batchDraftUnitMilliseconds ? '保存后会把单根工时和本批总工时应用到当前批次；不会改写产品工时库。' : '下下周先保留排程草稿，进入下周范围后由系统自动下达。'}</small></span></div>
        {batchOrder && Boolean(batchOrder.qualityWarningCount) && <div className={`planning-quality-warning-note severity-${batchOrder.highestQualityWarningSeverity?.toLowerCase()}`}><ShieldAlert /><span><strong>该产品有 {batchOrder.qualityWarningCount} 条生效异常警示</strong><small>{batchOrder.qualityWarningPrintRequired ? '至少一条为“必须随单打印”，生成流转单时系统会强制加入固定 A4 警示附页。' : '批次进入生产后会显示警示标识；计划下发时可选择附加固定 A4 警示页。'}</small></span></div>}
        {batchHasSopValidationWarning && batchOrder && <div className="planning-sop-confirmation" title={sopStageInfo(batchOrder).title}><FlaskConical /><span><strong>SOP 验证中，不阻断进入生产执行</strong><small>{batchOrder.sopRemark || '该产品 SOP 尚在验证阶段，生产执行会持续显示验证状态。'}{batchOrder.sopFileCount ? '' : ' 当前同时缺少有效 SOP 文件，将继续显示资料待补充提示。'}</small></span></div>}
        {error && <div className="planning-dialog-error"><AlertTriangle />{error}</div>}
      </div>
      <footer><button type="button" onClick={closeDialog}>取消</button><button type="button" className="primary" disabled={saving || !canSaveBatch} onClick={() => { void saveBatch(); }}>{saving ? '保存中...' : batchDraftAutomaticReleaseTarget ? '保存并进入生产' : batchDraftUnitMilliseconds ? '保存并应用工时' : '保存排程草稿'}</button></footer>
    </div>}

    {releasePreview && <div ref={dialogRef} className="planning-dialog release-dialog" role="dialog" aria-modal="true" aria-labelledby="planning-release-dialog-title">
      <header><div><span>下达预检</span><h2 id="planning-release-dialog-title">{releasePreview.target === 'active' ? '同步本周执行' : '同步下周生产'}</h2></div><button type="button" onClick={closeDialog} aria-label="关闭"><X /></button></header>
      <div className="planning-dialog-body">
        <section className="planning-release-summary four">
          <div><span>批次数</span><strong>{releasePreview.batchCount}</strong></div>
          <div><span>目标生产周</span><strong>{releasePreview.targetWeekStartDate.slice(5)} - {releasePreview.targetWeekEndDate.slice(5)}</strong></div>
          <div><span>总数量 / 提醒</span><strong className={releasePreview.warnings ? 'warning' : ''}>{releasePreview.totalQuantity.toLocaleString()} / {releasePreview.warnings}</strong></div>
          <div><span>验证中 SOP</span><strong className={releasePreview.validatingSopCount ? 'validation' : ''}>{releasePreview.validatingSopCount}</strong></div>
        </section>
        {releasePreview.target === 'preparation' && <div className="planning-dialog-note"><PackageCheck /><span><strong>进入下周生产并启动仓库准备</strong><small>生产周统一为 {releasePreview.targetWeekStartDate} 至 {releasePreview.targetWeekEndDate}；缺少工序工时的批次可先配料，补齐发布后再开始工序。</small></span></div>}
        {releasePreview.target === 'active' && <div className="planning-dialog-note"><Factory /><span><strong>进入本周生产并启动仓库准备</strong><small>同步本周执行清单与仓库配料；缺少工序工时的批次保持生产待配置，补齐发布后才能进行工序流转。</small></span></div>}
        {releasePreview.validatingSopCount > 0 && <div className="planning-sop-confirmation release"><FlaskConical /><span><strong>{releasePreview.validatingSopCount} 个 SOP 正在验证，不阻断同步生产</strong><small>验证状态会保留在生产执行清单中；SOP 状态不会因本次同步自动改成标准。</small></span></div>}
        <div className="planning-warning-list">{releasePreview.items.map(item => <article key={item.batchId} className={item.sopValidationRequired ? 'sop-validating' : ''}><strong>{item.specification} · {item.quantity.toLocaleString()} 件</strong>{item.sopValidationRequired && <span className="sop-context"><FlaskConical size={13} />验证中{item.sopRemark ? ` · ${item.sopRemark}` : ''}{formatPlanningSopUpdatedAt(item.sopMetadataUpdatedAt) ? ` · 更新 ${formatPlanningSopUpdatedAt(item.sopMetadataUpdatedAt)}` : ''}</span>}{item.blockers.map(message => <span className="blocker" key={message}>{message}</span>)}{item.warnings.filter(message => !message.startsWith('SOP处于验证中')).map(message => <span key={message}>{message}</span>)}{!item.blockers.length && !item.warnings.length && <span className="ready">资料检查通过</span>}</article>)}</div>
        {error && <div className="planning-dialog-error"><AlertTriangle />{error}</div>}
      </div>
      <footer><button type="button" onClick={closeDialog}>返回调整</button><button type="button" className="primary" disabled={saving || releasePreview.blockers > 0} onClick={() => { void commitRelease(); }}>{saving ? '同步中...' : releasePreview.validatingSopCount > 0 ? '保留验证提示并同步' : '确认同步'}</button></footer>
    </div>}

    {deletePreview && <div ref={dialogRef} className="planning-dialog delete-dialog" role="dialog" aria-modal="true" aria-labelledby="planning-delete-dialog-title"><header><div><span>危险操作预检</span><h2 id="planning-delete-dialog-title">删除所选计划</h2></div><button type="button" onClick={closeDialog} aria-label="关闭"><X /></button></header><div className="planning-dialog-body"><section className="planning-release-summary four"><div><span>所选批次</span><strong>{deletePreview.batchCount}</strong></div><div><span>删除草稿</span><strong>{deletePreview.draftDeleteCount}</strong></div><div><span>撤回未开工</span><strong>{deletePreview.withdrawCount}</strong></div><div><span>禁止删除</span><strong className={deletePreview.blockers ? 'danger' : ''}>{deletePreview.blockers}</strong></div></section><div className="planning-dialog-note danger"><ShieldAlert /><span><strong>删除数量不会回到订单池</strong><small>只移除计划订单、排产批次和未开工工单；产品档案、图纸文件、产品工序与标准工时全部保留。已开工计划仍禁止删除。</small></span></div><div className="planning-warning-list">{deletePreview.items.map(item => <article key={item.batchId}><strong>{item.specification} · {item.quantity.toLocaleString()} 件</strong><span className={item.action === 'blocked' ? 'blocker' : item.action === 'withdraw_unstarted' ? 'warning' : 'ready'}>{item.message}</span></article>)}</div>{deletePreview.blockers > 0 && <div className="planning-dialog-error"><AlertTriangle />请取消勾选已开工或已完成的批次后再删除，本次不会处理任何批次。</div>}{error && <div className="planning-dialog-error"><AlertTriangle />{error}</div>}</div><footer><button type="button" onClick={closeDialog}>取消</button><button type="button" className="danger" disabled={saving || deletePreview.blockers > 0} onClick={() => { void commitDeletion(); }}>{saving ? '删除中...' : '确认删除计划'}</button></footer></div>}

    {historicalDeleteTarget && <div
      ref={dialogRef}
      className={`planning-dialog historical-delete-dialog ${historicalDeleteClosing ? 'is-closing' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="historical-delete-dialog-title"
      aria-describedby="historical-delete-dialog-description"
      onPointerMove={moveHistoricalDeleteGlass}
      onPointerLeave={resetHistoricalDeleteGlass}
    >
      <div className="historical-delete-glass-surface">
        <span className="historical-delete-glass-light" aria-hidden="true" />
        <header>
          <div className="historical-delete-title">
            <i aria-hidden="true"><Trash2 /></i>
            <span><small>历史计划管理</small><h2 id="historical-delete-dialog-title">确认删除订单</h2></span>
          </div>
          <button type="button" onClick={closeHistoricalDeleteDialog} aria-label="关闭删除订单弹窗"><X /></button>
        </header>
        <div className="historical-delete-body">
          <p id="historical-delete-dialog-description">此操作将立即停止并移除该订单的后续执行。</p>
          <section className="historical-delete-identity" aria-label="待删除订单">
            <strong>{historicalDeleteTarget.order.specification}</strong>
            <span>{historicalDeleteTarget.order.customerName} · {historicalDeleteTarget.batch.quantity.toLocaleString()} 件 · {historicalDeleteTarget.batch.weekStartDate.slice(5)} 至 {historicalDeleteTarget.batch.weekEndDate.slice(5)}</span>
          </section>
          <section className="historical-delete-effects" aria-labelledby="historical-delete-effects-title">
            <h3 id="historical-delete-effects-title">删除后自动处理</h3>
            <ul>
              <li><Check aria-hidden="true" /><span>计划与遗留列表移除</span></li>
              <li><Check aria-hidden="true" /><span>关联生产及流程任务关闭</span></li>
              <li><Archive aria-hidden="true" /><span>仓库任务转为归档</span></li>
              <li><ShieldCheck aria-hidden="true" /><span>产品资料、报工与审计记录保留</span></li>
            </ul>
          </section>
          <div className="historical-delete-form">
            <label>
              <span>删除说明 <small>选填</small></span>
              <textarea
                rows={2}
                maxLength={300}
                value={historicalDeleteReason}
                onChange={event => setHistoricalDeleteReason(event.target.value)}
                placeholder="可填写计划重复、客户取消等说明"
              />
            </label>
            <label>
              <span><LockKeyhole aria-hidden="true" />删除确认码</span>
              <small id="historical-delete-code-help">输入 111 后即可删除</small>
              <input
                ref={historicalDeleteCodeRef}
                type="password"
                inputMode="numeric"
                autoComplete="off"
                maxLength={3}
                value={historicalDeleteCode}
                aria-describedby="historical-delete-code-help"
                aria-invalid={Boolean(error)}
                onChange={event => {
                  setHistoricalDeleteCode(event.target.value.replace(/\D/g, '').slice(0, 3));
                  if (error) setError('');
                }}
                onKeyDown={event => {
                  if (event.key === 'Enter' && historicalDeleteCode === '111' && !saving) void commitHistoricalDelete();
                }}
              />
            </label>
          </div>
          {error && <div className="historical-delete-error" role="alert"><AlertTriangle />{error}</div>}
          <p className="historical-delete-audit"><ShieldCheck aria-hidden="true" />删除完成后不可恢复到计划列表，可从变更记录查看删除快照。</p>
        </div>
        <footer>
          <button type="button" onClick={closeHistoricalDeleteDialog} disabled={saving}>取消</button>
          <button
            type="button"
            className="danger"
            disabled={saving || historicalDeleteCode !== '111'}
            onClick={() => { void commitHistoricalDelete(); }}
          >{saving ? '正在删除...' : '立即删除'}</button>
        </footer>
      </div>
    </div>}

    {activationPreview && <div ref={dialogRef} className="planning-dialog activation-dialog" role="dialog" aria-modal="true" aria-labelledby="planning-activation-title"><header><div><span>生产周切换</span><h2 id="planning-activation-title">提前切换为本周计划</h2></div><button type="button" onClick={closeDialog} aria-label="关闭"><X /></button></header><div className="planning-dialog-body"><section className="planning-release-summary"><div><span>生产周</span><strong>{activationPreview.weekStartDate.slice(5)} - {activationPreview.weekEndDate.slice(5)}</strong></div><div><span>批次 / 数量</span><strong>{activationPreview.batchCount} / {activationPreview.totalQuantity.toLocaleString()}</strong></div><div><span>阻断 / 提醒</span><strong className={activationPreview.blockerCount || activationPreview.warningCount ? 'warning' : ''}>{activationPreview.blockerCount} / {activationPreview.warningCount}</strong></div></section><div className="planning-dialog-note warning"><ShieldAlert /><span><strong>兼容性手动切换</strong><small>正常排入本周或下周会自动进入对应生产清单；这里只用于需要提前改为本周的特殊情况。</small></span></div><div className="planning-warning-list">{activationPreview.items.map(item => <article key={item.batchId}><strong>{item.specification} · {item.customerName}</strong>{item.blockers.map(message => <span className="blocker" key={message}>{message}</span>)}{item.warnings.map(message => <span key={message}>{message}</span>)}{!item.blockers.length && !item.warnings.length && <span className="ready">工时、仓库与工艺准备完成</span>}</article>)}</div>{error && <div className="planning-dialog-error"><AlertTriangle />{error}</div>}</div><footer><button type="button" onClick={closeDialog}>取消</button><button type="button" className="primary" disabled={saving || activationPreview.blockerCount > 0} onClick={() => { void commitActivation(); }}>{saving ? '切换中...' : activationPreview.blockerCount > 0 ? '请先补充单根工时' : '确认切换为本周'}</button></footer></div>}

    {movePreview && <div ref={dialogRef} className="planning-dialog move-dialog" role="dialog" aria-modal="true" aria-labelledby="planning-move-title">
      <header><div><span>周次调配预检</span><h2 id="planning-move-title">移动草稿批次</h2></div><button type="button" onClick={closeDialog} aria-label="关闭"><X /></button></header>
      <div className="planning-dialog-body">
        <section className="planning-release-summary">
          <div><span>目标生产周</span><strong>{movePreview.targetWeekStartDate.slice(5)} - {movePreview.targetWeekEndDate.slice(5)}</strong></div>
          <div><span>批次 / 数量</span><strong>{movePreview.batchCount} / {movePreview.totalQuantity.toLocaleString()}</strong></div>
          <div><span>阻断项</span><strong className={movePreview.blockers ? 'danger' : ''}>{movePreview.blockers}</strong></div>
        </section>
        <div className="planning-dialog-note"><MoveRight /><span><strong>只移动排产草稿</strong><small>计划完成日期会保留原来的星期位置；已下达或已开工批次不会被直接改周。</small></span></div>
        <div className="planning-warning-list">{movePreview.items.map(item => <article key={item.batchId}><strong>{item.specification} · {item.quantity.toLocaleString()} 件</strong><span>{item.sourceWeekStartDate.slice(5)} - {item.sourceWeekEndDate.slice(5)} → {movePreview.targetWeekStartDate.slice(5)} - {movePreview.targetWeekEndDate.slice(5)}</span>{item.blockers.map(message => <span className="blocker" key={message}>{message}</span>)}</article>)}</div>
        {movePreview.missingCount > 0 && <div className="planning-dialog-error"><AlertTriangle />有 {movePreview.missingCount} 个批次已不存在，请刷新后重试。</div>}
        {error && <div className="planning-dialog-error"><AlertTriangle />{error}</div>}
      </div>
      <footer><button type="button" onClick={closeDialog}>返回调整</button><button type="button" className="primary" disabled={saving || movePreview.blockers > 0} onClick={() => { void commitMove(); }}>{saving ? '调配中...' : '确认调配周次'}</button></footer>
    </div>}

    {importDialog && <div ref={dialogRef} className="planning-dialog import-dialog production-bulk-import" role="dialog" aria-modal="true" aria-labelledby="planning-import-title">
      <header><div><span>量产计划批量导入</span><h2 id="planning-import-title">{importDialog.step === 'upload' ? '上传排产模板' : importDialog.step === 'preview' ? '核对产品档案与排产' : importDialog.step === 'complete' ? '批量导入完成' : '最近导入记录'}</h2></div><button type="button" onClick={closeDialog} aria-label="关闭"><X /></button></header>
      <nav className="planning-import-steps" aria-label="导入步骤">
        <span className={importDialog.step === 'upload' ? 'active' : importDialog.preview ? 'done' : ''}><b>1</b>上传模板</span>
        <i />
        <span className={importDialog.step === 'preview' ? 'active' : importDialog.result ? 'done' : ''}><b>2</b>预检确认</span>
        <i />
        <span className={importDialog.step === 'complete' ? 'active' : ''}><b>3</b>导入完成</span>
      </nav>
      <div className="planning-dialog-body">
        {importDialog.step !== 'history' && <section className="planning-import-target">
          <CalendarCheck2 />
          <div><span>本次唯一目标周</span><strong>{importDialog.targetWeekStartDate} 至 {importDialog.targetWeekEndDate}</strong><small>同一订单行在目标周重复出现会自动跳过，不累加数量。</small></div>
          <em>{editableWeeks.find(week => week.weekStartDate === importDialog.targetWeekStartDate) ? editableWeekLabel(editableWeeks.find(week => week.weekStartDate === importDialog.targetWeekStartDate)!.key) : '目标周'}</em>
        </section>}

        {(importDialog.step === 'upload' || importDialog.step === 'preview') && <>
          <label className="planning-import-picker">
            <input ref={importInputRef} type="file" accept=".xls,.xlsx,.csv" onChange={event => { const file = event.target.files?.[0]; if (file) void previewPlanningImport(file); }} />
            <FileSpreadsheet />
            <span><strong>{importDialog.fileName || '选择已填写的量产计划模板'}</strong><small>{importDialog.loading ? '正在校验订单、目标周和产品图纸库…' : '文件只用于本次解析；不会保存到本地磁盘。'}</small></span>
            <b>{importDialog.fileName ? '重新选择' : '选择文件'}</b>
          </label>
          <div className="planning-import-tools"><a href="/api/planning/import/template"><FileSpreadsheet size={15} />下载简版 Excel 模板</a><button type="button" onClick={() => { void openPlanningImportHistory(); }}>导入记录</button><span>系统只在没有任何匹配档案时新建图纸库。</span></div>
        </>}

        {importDialog.loading && <div className="planning-loading compact">{importDialog.step === 'history' ? '正在读取导入记录...' : '正在生成产品匹配与排产预览...'}</div>}
        {importDialog.step === 'preview' && importDialog.preview && <section className="planning-import-preview">
          <div className="planning-import-summary production-summary">
            <span><small>总行数</small><strong>{importDialog.preview.summary.totalRows}</strong></span>
            <span className="ready"><small>复用原档案</small><strong>{importDialog.preview.summary.reuseCount}</strong></span>
            <span><small>恢复归档</small><strong>{importDialog.preview.summary.restoreCount}</strong></span>
            <span><small>自动新建</small><strong>{importDialog.preview.summary.createCount}</strong></span>
            <span><small>重复跳过</small><strong>{importDialog.preview.summary.skippedCount + importDialog.preview.summary.duplicateCount}</strong></span>
            <span className={importDialog.preview.summary.conflictCount ? 'danger' : ''}><small>待选择</small><strong>{importDialog.preview.summary.conflictCount}</strong></span>
            <span className={importDialog.preview.summary.invalidCount ? 'danger' : ''}><small>格式错误</small><strong>{importDialog.preview.summary.invalidCount}</strong></span>
          </div>
          <div className="planning-import-rule"><ShieldCheck /><span><strong>原资料保护已开启</strong><small>复用/恢复只绑定原图纸库，不复制、不覆盖图纸、SOP、工时和产品资料。</small></span></div>
          <div className="planning-import-table hm-scroll-region">
            <table><thead><tr><th>行</th><th>订单 / 产品</th><th>本周数量</th><th>档案处理</th><th>预检结果</th></tr></thead><tbody>{importDialog.preview.rows.map(row => <tr className={`status-${row.status}`} key={row.rowNo}>
              <td>{row.rowNo}</td>
              <td><strong>{row.input?.specification || '-'}</strong><small>{row.input ? `${row.input.sourceOrderNo}-${row.input.sourceLineNo} · ${row.input.customerName}` : '空行/说明行'}</small></td>
              <td>{row.input?.plannedQuantity?.toLocaleString() || '-'}</td>
              <td>{row.status === 'conflict' ? <select aria-label={`第 ${row.rowNo} 行选择图纸库`} value={importDialog.decisions[String(row.rowNo)] || ''} onChange={event => setImportDialog(current => current ? { ...current, decisions: { ...current.decisions, [String(row.rowNo)]: event.target.value } } : current)}><option value="">请选择原档案</option>{row.candidates.map(candidate => <option value={candidate.id} key={candidate.id}>{candidate.specification} · 图{candidate.drawingFileCount}/SOP{candidate.sopFileCount}{candidate.productTimeVersion ? `/V${candidate.productTimeVersion}` : ''}{candidate.deletedAt ? ' · 已归档' : ''}</option>)}</select> : <span className={`product-action action-${row.productAction}`}>{row.productAction === 'reuse' ? '复用原档案' : row.productAction === 'restore' ? '恢复原档案' : row.productAction === 'create' ? '新建空档案' : '不处理'}</span>}</td>
              <td><span>{row.status === 'ready' ? row.warning || '校验通过' : row.status === 'duplicate' ? row.reason : row.status === 'skipped' ? row.reason : row.status === 'conflict' ? '选择一个原档案后可导入' : row.reason}</span></td>
            </tr>)}</tbody></table>
          </div>
        </section>}

        {importDialog.step === 'complete' && importDialog.result && <section className="planning-import-complete">
          <div className="planning-import-complete-mark"><CheckCircle2 /><span><strong>已写入 {importDialog.result.summary.created} 个排产批次</strong><small>重复行已安全跳过，产品资料未被覆盖。</small></span></div>
          <div className="planning-import-summary production-summary"><span className="ready"><small>复用原档案</small><strong>{importDialog.result.summary.reusedProducts}</strong></span><span><small>恢复归档</small><strong>{importDialog.result.summary.restoredProducts}</strong></span><span><small>新建档案</small><strong>{importDialog.result.summary.createdProducts}</strong></span><span><small>重复跳过</small><strong>{importDialog.result.summary.skipped}</strong></span></div>
          <div className="planning-import-result-list hm-scroll-region">{importDialog.result.results.map(item => <article key={`${item.row}-${item.specification}`}><span>第 {item.row} 行</span><strong>{item.specification}</strong><em className={item.status}>{item.message}</em></article>)}</div>
        </section>}

        {importDialog.step === 'history' && !importDialog.loading && <section className="planning-import-history">
          {importDialog.history.map(record => <article key={record.id}><span><strong>{record.sourceFileName}</strong><small>{record.targetWeekStartDate} 至 {record.targetWeekEndDate} · {record.operator}</small></span><em className={`status-${record.status}`}>{record.status === 'completed' ? `成功 ${record.result?.summary?.created || 0} 批` : '已预检未提交'}</em><time>{flowTime(record.committedAt || record.createdAt)}</time></article>)}
          {!importDialog.history.length && <div className="planning-empty compact"><FileSpreadsheet /><strong>暂无批量导入记录</strong><span>完成首次导入后会在这里保留结果。</span></div>}
        </section>}
        {error && <div className="planning-dialog-error"><AlertTriangle />{error}</div>}
      </div>
      <footer>
        {importDialog.step === 'upload' && <><button type="button" onClick={closeDialog}>取消</button><span>请先下载模板并选择文件</span></>}
        {importDialog.step === 'preview' && <><button type="button" onClick={() => setImportDialog(current => current ? { ...current, step: 'upload', fileName: '', preview: null, decisions: {} } : current)}>重新上传</button><button type="button" className="primary" disabled={saving || importDialog.loading || Boolean(importDialog.preview?.summary.invalidCount) || Boolean(importDialog.preview?.rows.some(row => row.status === 'conflict' && !importDialog.decisions[String(row.rowNo)])) || !importDialog.preview || (importDialog.preview.summary.readyCount + importDialog.preview.summary.conflictCount === 0)} onClick={() => { void commitPlanningImport(); }}>{saving ? '正在原子写入...' : `确认导入 ${((importDialog.preview?.summary.readyCount || 0) + (importDialog.preview?.summary.conflictCount || 0))} 行`}</button></>}
        {importDialog.step === 'complete' && <><button type="button" onClick={() => { void openPlanningImportHistory(); }}>查看导入记录</button><button type="button" className="primary" onClick={closeDialog}>完成并查看计划</button></>}
        {importDialog.step === 'history' && <><button type="button" onClick={() => setImportDialog(current => current ? { ...current, step: current.preview ? 'preview' : 'upload' } : current)}>返回导入</button><button type="button" className="primary" onClick={closeDialog}>关闭</button></>}
      </footer>
    </div>}

  </>;
}
