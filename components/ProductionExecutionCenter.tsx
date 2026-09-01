'use client';
import { ProductionControlButton, ProductionNoteSummary } from '@/components/ProductionControl';
import { canManageProductionControl, canAdjustProductionDates, type ProductionControlView } from '@/lib/production-control';


import { AlertTriangle, ArrowRight, BarChart3, CalendarDays, CheckCircle2, ChevronDown, Clock3, Copy, Download, Expand, GitPullRequestArrow, Info, ListChecks, Loader2, MoreHorizontal, PanelRightClose, PanelRightOpen, Pencil, Plus, Printer, RefreshCw, Rows3, Search, UserRoundCog, Users, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useToastBridge } from '@/components/ToastProvider';
import { WeekReconciliationBar } from '@/components/WeekReconciliationBar';
import { AppWorkbenchHeader } from '@/components/layout/AppWorkbenchHeader';
import { ModuleModeDrawer, ModuleModeTrigger, useModuleModeDrawer } from '@/components/layout/ModuleModeDrawer';
import { PortalMenu } from '@/components/PortalMenu';
import { OlderCarryoverDrawer } from '@/components/production/OlderCarryoverDrawer';
import { TravelerPrintDialog } from '@/components/TravelerPrintDialog';
import { VoiceInputButton } from '@/components/VoiceInputButton';
import { writeClipboardText } from '@/lib/client-platform';
import {
  AUTO_REFRESH_BASE_DELAY_MS,
  autoRefreshDelayMs,
  cacheBoundSnapshotValue,
  retainCacheBoundSnapshot,
  shouldStartAutoRefresh,
  type CacheBoundSnapshot,
} from '@/lib/client-load-resilience';
import { getProductionAlerts, isDrawingConfirmationAlert, type ProductionAlert } from '@/lib/production-alerts';
import { productionDrawingStageLabel } from '@/lib/production-drawing-readiness';
import { resolveProductionLifecycle } from '@/lib/production-lifecycle';
import { resolveProductionPrimaryAction } from '@/lib/production-primary-action';
import { formatProductionPercentage, formatProductionQuantity, getProductionQuantitySummary, type ProductionQuantitySummary } from '@/lib/production-quantity';
import { formatProcessDuration } from '@/lib/process-time';
import { processRouteExecutionReadiness } from '@/lib/process-route-readiness';
import { subscribeProductionDataInvalidations } from '@/lib/production-data-client-sync';
import { productTimeConfigurationRoute, type ProductTimeRouteScope } from '@/lib/workflow-routes';
import { canManageWipWarehouse } from '@/lib/wip-access';
import type {
  CurrentUserDTO,
  InternalQualityRiskSeverity,
  ProcessReportQuantityBasis,
  ProductionPlanningWipContinuationDTO,
  WorkOrderQualityAlertsDTO,
  WorkOrderProcessRouteDTO,
} from '@/types';

type StageKey = 'not_issued' | 'frontend' | 'backend' | 'completed';
type ViewKey = 'board' | 'today' | 'exceptions';
type WeekScope = 'current' | 'carryover' | 'next' | 'afterNext' | 'history';
type QuickFilter = 'paused' | 'overdue' | 'urgent' | 'drawing' | 'drawing_confirmation' | 'material' | 'documents' | 'tail_remaining' | 'completed' | 'due_today' | 'due_soon' | 'updated_today' | 'completed_today' | 'delivery_missing' | 'specification_invalid' | 'customer_missing' | 'in_production' | 'not_started' | 'has_next_process' | 'waiting_transfer' | 'arrangement_unassigned' | 'arrangement_scheduled' | 'arrangement_today' | 'arrangement_overdue' | 'arrangement_partial';
type DetailTab = 'production' | 'quality' | 'drawing' | 'progress' | 'source';
type BatchOperation = 'set_priority' | 'add_remark';
type DuePreset = '' | 'today' | 'tomorrow' | 'overdue' | 'week' | 'custom';
type ProductionFlowAction = 'start_process_route';
type DispatchDensity = 'comfortable' | 'compact';
type DispatchPreset = 'paused' | 'all' | 'today' | 'in_production' | 'not_started' | 'next_process' | 'due_soon' | 'exceptions' | 'completed';
type DispatchTone = 'normal' | 'warning' | 'danger';

type DispatchRisk = {
  label: string;
  detail: string;
  tone: DispatchTone;
  alert?: ProductionAlert;
  quality?: boolean;
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

type ProductionArrangementStatus = 'suspended' | 'planned' | 'today' | 'partial' | 'completed' | 'overdue' | 'carried_over' | 'needs_review';

type ProductionArrangementWorker = {
  employeeId: string;
  employeeNo: string;
  name: string;
  quantity: number;
  plannedStandardMilliseconds: string;
};

type ProductionArrangement = {
  id: string;
  planId: string;
  workDate: string;
  shiftCode: string;
  teamId: string;
  teamName: string;
  planStatus: string;
  status: ProductionArrangementStatus;
  plannedQty: number;
  completedQty: number;
  defectQty: number;
  remainingQty: number;
  completedTaskCount: number;
  totalTaskCount: number;
  partial: boolean;
  overdue: boolean;
  crossWeek: boolean;
  continuable: boolean;
  taskIds: string[];
  sourceTaskIds: string[];
  processNames: string[];
  employees: ProductionArrangementWorker[];
};

type ProductionArrangementMetrics = {
  unassigned: number;
  scheduled: number;
  today: number;
  overdue: number;
  partial: number;
};

type ProductionArrangementContext = {
  workDate: string;
  weekStartDate: string;
  weekEndDate: string;
  shiftCode: string;
  selectedTeamId: string;
  personnelSource: 'HR_PRODUCTION_DEPARTMENT';
  productionEmployeeCount: number;
  canSchedule: boolean;
  candidates: Array<{
    workOrderId: string;
    workOrderCode: string;
    productName: string;
    customerName: string;
    stepId: string;
    processName: string;
    sequenceGroup: number;
    status: string;
    plannedQty: number;
    availableQty: number;
    estimatedStandardMilliseconds: string;
    batchWeekStartDate: string;
    batchWeekEndDate: string;
    riskWarnings: string[];
  }>;
  blocked: Array<{ workOrderId?: string; workOrderCode?: string; stepId?: string; reason: string; message: string }>;
  employeeCapacity: Array<{
    employeeId: string;
    employeeNo: string;
    employeeName: string;
    department?: string | null;
    position?: string | null;
    team?: string | null;
    attendanceEnabled?: boolean;
    capacityMilliseconds: string | number;
    assignedMilliseconds: string | number;
    remainingMilliseconds: string | number;
    source: string;
    attendanceStatus?: string | null;
    attendanceType?: string | null;
    leaveMilliseconds?: string | number | null;
  }>;
  recommendedEmployeeIds: string[];
  summary: {
    workOrderCount: number;
    taskCount: number;
    readyCount: number;
    waitingUpstreamCount: number;
    blockedCount: number;
    estimatedStandardMilliseconds: string;
  };
};

type ProductionArrangementRequest = {
  orders: ProductionOrder[];
  mode: 'schedule' | 'continue';
  sourceArrangement?: ProductionArrangement;
};

type ProductionArrangementForm = {
  workDate: string;
  shiftCode: string;
  teamId: string;
  employeeIds: string[];
  includeWaitingUpstream: boolean;
};

type ProductionReassignmentRequest = {
  mode: 'arrangement' | 'employee_exception';
  orders: ProductionOrder[];
  planId?: string;
  sourceEmployeeId?: string;
  title: string;
};

type ProductionReassignmentContext = {
  mode: 'arrangement' | 'employee_exception';
  planId: string | null;
  sourceEmployeeId: string | null;
  currentEmployeeIds: string[];
  defaultTargetEmployeeIds: string[];
  employees: Array<{
    id: string;
    employeeNo: string;
    name: string;
    department?: string | null;
    position?: string | null;
    team?: string | null;
  }>;
  tasks: Array<{
    id: string;
    version: number;
    planId: string;
    planVersion: number;
    workDate: string;
    shiftCode: string;
    processCode: string;
    processName: string;
    position: number;
    plannedQty: number;
    completedQty: number;
    remainingQty: number;
    team: { id: string; code: string; name: string };
    workOrder: { id: string; code: string; customerName?: string | null; productName?: string | null };
    assignments: Array<{
      id: string;
      version: number;
      employeeId: string;
      quantity: number;
      plannedStandardMilliseconds: string;
      employee: { id: string; employeeNo: string; name: string; position?: string | null };
    }>;
  }>;
  summary: {
    taskCount: number;
    workOrderCount: number;
    plannedQty: number;
    completedQty: number;
    remainingQty: number;
  };
  rule: string;
};

type ProductionReassignmentForm = {
  sourceEmployeeId: string;
  targetEmployeeIds: string[];
  taskIds: string[];
  reasonCode: string;
  reason: string;
};

type ProductionOrder = {
  executionKey: string;
  productionControl?: ProductionControlView;
  id: string;
  productionPlanBatchId?: string | null;
  planReleaseState?: string | null;
  planActivatedAt?: string | null;
  code: string;
  businessCode?: string | null;
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
    businessCode?: string | null;
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
  sopStage?: 'standard' | 'new_product' | 'validating' | null;
  sopRemark?: string | null;
  sopMetadataUpdatedAt?: string | null;
  qualityRiskAlertCount: number;
  qualityRiskHighestSeverity?: InternalQualityRiskSeverity | null;
  documentCompleteness: string;
  documentFilledCount: number;
  documentTotalCount: number;
  documentsComplete: boolean;
  documentCategoryCodes: string[];
  exceptionCodes: string[];
  exceptionLabels: string[];
  quantitySummary: ProductionQuantitySummary;
  standardLaborProgress: {
    totalStandardMilliseconds: string;
    completedStandardMilliseconds: string;
    remainingStandardMilliseconds: string;
    percentage: number | null;
    stepCount: number;
    configuredStepCount: number;
    missingStandardStepCount: number;
    pendingCompletionStandardCount: number;
    targetQuantityMissing: boolean;
  };
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
  planActive: boolean;
  unitWorkHours?: string | null;
  totalWorkHours?: string | null;
  remark?: string | null;
  weekStartDate?: string | null;
  weekEndDate?: string | null;
  updatedAt: string;
  carryover?: {
    id: string;
    sourceWeekStartDate: string;
    targetWeekStartDate: string;
    originalWeekStartDate: string;
    inclusionType: string;
    weeksOld: number;
  } | null;
  wipContinuation?: ProductionPlanningWipContinuationDTO | null;
  wipContinuations?: ProductionPlanningWipContinuationDTO[];
  wipMovedOutContinuations?: ProductionPlanningWipContinuationDTO[];
  arrangements: ProductionArrangement[];
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
  dispatchMetrics: {
    paused?: number;
    inProduction: number;
    notStarted: number;
    withNextProcess: number;
    dueSoon: number;
    completed: number;
  };
  planTotals: {
    totalOrders: number;
    completedOrders: number;
    percentage: number | null;
  };
  executionCountBreakdown?: {
    nativeCurrent: number;
    carryover: number;
    wipContinuation: number;
    total: number;
  } | null;
  wipPlanMetrics: {
    weekStartDate: string;
    weekEndDate: string;
    nativePlannedMilliseconds: number;
    movedOutMilliseconds: number;
    scheduledInMilliseconds: number;
    effectivePlannedMilliseconds: number;
    completedMilliseconds: number;
    percentage: number | null;
    missingStandardStepCount: number;
    unscheduledWipQuantity: number;
  } | null;
  arrangementMetrics: ProductionArrangementMetrics;
  quantityTotals: {
    targetQty: number;
    completedQty: number;
    percentage: number | null;
    knownOrders: number;
    missingOrders: number;
  };
  navigation?: {
    current: { weekStartDate: string; weekEndDate: string; count: number };
    next: { weekStartDate: string; weekEndDate: string; count: number };
    afterNext: { weekStartDate: string; weekEndDate: string; count: number };
    carryoverCount: number;
    olderCarryoverCount: number;
    history: Array<{ weekStartDate: string; weekEndDate: string; count: number }>;
  } | null;
};

type BoardPayload = {
  scope: WeekScope;
  readOnly: boolean;
  weekStartDate?: string | null;
  weekEndDate?: string | null;
  stageCounts: Record<StageKey, number>;
  items: ProductionOrder[];
  arrangementMetrics: ProductionArrangementMetrics;
  filterOptions: { customers: string[] };
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
  summary?: ProductionSummary;
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
  reportingPolicy: 'free_sequence' | 'strict_sequence';
  step: {
    id: string;
    processName: string;
    position: number;
    sequenceGroup: number;
    status: string;
    startedAt: string | null;
    reportQuantityBasis: ProcessReportQuantityBasis;
    reportUnitLabel: string;
    unitsPerProduct: number;
    executionMode: 'NORMAL' | 'SUPPLEMENTAL_OBLIGATION';
    supplementObligation: {
      id: string;
      requiredQty: number;
      systemCoveredQty: number;
      actualRequiredQty: number;
      reportedQty: number;
      remainingQty: number;
      status: string;
      version: number;
    } | null;
  };
  routeSteps: Array<{
    id: string;
    processName: string;
    position: number;
    sequenceGroup: number;
    status: string;
    unitLabel: string | null;
    reportQuantityBasis: ProcessReportQuantityBasis;
    reportUnitLabel: string;
    unitsPerProduct: number;
    inputQty: number;
    processedQty: number;
    reportedQty: number;
    coveredReportedQty: number;
    pendingCoverageQty: number;
    reportableQty: number;
    reportTargetQty: number;
    reportedUnitQty: number;
    reportedGoodUnitQty: number;
    reportedDefectUnitQty: number;
    reportableUnitQty: number;
    availableCoverageQty: number;
    executionMode: 'NORMAL' | 'SUPPLEMENTAL_OBLIGATION';
    supplementObligation: {
      id: string;
      requiredQty: number;
      systemCoveredQty: number;
      actualRequiredQty: number;
      reportedQty: number;
      remainingQty: number;
      status: string;
      version: number;
    } | null;
  }>;
  targetQty: number;
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
  reportedQty: number;
  coveredReportedQty: number;
  pendingCoverageQty: number;
  reportableQty: number;
  reportTargetQty: number;
  reportedUnitQty: number;
  reportedGoodUnitQty: number;
  reportedDefectUnitQty: number;
  reportableUnitQty: number;
  employees: Array<{
    id: string;
    employeeNo: string;
    name: string;
    department?: string | null;
    position?: string | null;
    team?: string | null;
  }>;
  workerPreset: {
    weekStartDate: string;
    scope: 'PROCESS' | 'STEP';
    version: number;
    employees: Array<{
      id: string;
      employeeNo: string;
      name: string;
      team?: string | null;
      position?: string | null;
      priority: number;
    }>;
  } | null;
  recentCompletions: Array<{
    id: string;
    processedQty: number;
    goodQty: number;
    defectQty: number;
    reportedUnitQty: number;
    reportedGoodUnitQty: number;
    reportedDefectUnitQty: number;
    reportQuantityBasis: ProcessReportQuantityBasis;
    reportUnitLabel: string;
    reportMode: 'sequential' | 'advance';
    coverageStatus: 'pending' | 'partial' | 'covered';
    coveredQty: number;
    pendingCoverageQty: number;
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
      businessCode?: string | null;
      branchType?: string | null;
      branchStatus?: string | null;
    } | null;
  }>;
};

type ProcessCompletionForm = {
  processedQty: string;
  defectQty: string;
  reportedUnitQty: string;
  reportedDefectUnitQty: string;
  defectDisposition: DefectDisposition;
  workDate: string;
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
  { key: 'not_issued', label: '待开始', step: '01', hint: '等待启动生产' },
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
    { key: 'documents', label: '原图/SOP缺失' },
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
  'due_soon', 'paused', 'in_production', 'not_started', 'has_next_process', 'waiting_transfer',
  'arrangement_unassigned', 'arrangement_scheduled', 'arrangement_today', 'arrangement_overdue', 'arrangement_partial',
]);

const arrangementQuickFilters = new Set<QuickFilter>([
  'arrangement_unassigned', 'arrangement_scheduled', 'arrangement_today', 'arrangement_overdue', 'arrangement_partial',
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

function chinaDateKey(value = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(value);
}

function addDateKeyDays(value: string, days: number): string {
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return value;
  const date = new Date(Date.UTC(year, month - 1, day + days, 12));
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
}

function compactDateText(value: string): string {
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return value;
  return `${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}`;
}

function durationHours(value: string | number | bigint | null | undefined): number {
  try {
    const milliseconds = typeof value === 'bigint' ? value : BigInt(String(value || 0));
    return Number(milliseconds) / 3_600_000;
  } catch {
    return 0;
  }
}

const arrangementStatusText: Record<ProductionArrangementStatus, string> = {
  suspended: '暂停停用 · 待重排',
  planned: '已安排',
  today: '今日生产',
  partial: '部分完成',
  completed: '已完成',
  overdue: '逾期未完',
  carried_over: '已续排',
  needs_review: '待复核',
};

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
  return order.deliveryDay?.trim() || '';
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

function wipReportDate(continuation: ProductionPlanningWipContinuationDTO): string {
  const today = todayShanghaiDateKey();
  if (today < continuation.targetWeekStartDate) return continuation.targetWeekStartDate;
  if (today > continuation.targetWeekEndDate) return continuation.targetWeekEndDate;
  return today;
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
  const delivery = dateKeyNumber(shanghaiDateKey(order.deliveryDay));
  const today = dateKeyNumber(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date()));
  if (delivery === null || today === null) return null;
  return Math.round((delivery - today) / 86_400_000);
}

function currentProcessName(order: ProductionOrder): string {
  if (order.processRoute?.currentStep?.processName) return order.processRoute.currentStep.processName;
  if (order.processRoute?.status === 'confirmed') {
    const executableSteps = order.processRoute.steps.filter(step => step.status !== 'skipped');
    if (executableSteps.length) {
      const firstSequenceGroup = Math.min(...executableSteps.map(step => step.sequenceGroup));
      return executableSteps
        .filter(step => step.sequenceGroup === firstSequenceGroup)
        .map(step => step.processName)
        .join(' / ');
    }
  }
  return order.stage === 'not_issued'
    ? productionDrawingStageLabel({
        drawingStatus: order.drawingStatus,
        hasOriginalDrawing: order.documentCategoryCodes.includes('drawing'),
        planActive: order.planActive,
      })
    : order.stageText;
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
  if (order.qualityRiskAlertCount > 0) {
    const highRisk = order.qualityRiskHighestSeverity === 'CRITICAL' || order.qualityRiskHighestSeverity === 'HIGH';
    return {
      label: `质量预警 ${order.qualityRiskAlertCount} 条`,
      detail: highRisk ? '重大异常，进入详情查看控制要求' : '进入详情查看原因与结论',
      tone: highRisk ? 'danger' : 'warning',
      quality: true,
    };
  }
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
  wipAllocationId = '',
): URLSearchParams {
  const params = new URLSearchParams({ view, page: '1', pageSize: '60' });
  if (page > 1) params.set('displayPage', String(page));
  if (displaySize !== 12) params.set('displaySize', String(displaySize));
  params.set('scope', scope);
  if (workOrderId) params.set('workOrderId', workOrderId);
  if (wipAllocationId) params.set('wipAllocationId', wipAllocationId);
  if (keyword) params.set('keyword', keyword);
  if (quick.length) params.set('quick', quick.join(','));
  if (scope === 'history' && weekStart) params.set('weekStart', weekStart);
  appendAdvancedParams(params, advanced);
  return params;
}

async function fetchCompleteProductionBoard(
  params: URLSearchParams,
  signal: AbortSignal,
): Promise<BoardPayload> {
  const fetchPage = async (serverPage: number, offset?: number, pageSize?: number): Promise<BoardPayload> => {
    const pageParams = new URLSearchParams(params);
    pageParams.set('page', String(serverPage));
    pageParams.delete('displayPage');
    if (offset === undefined) {
      pageParams.set('includeSummary', '1');
      pageParams.delete('offset');
    } else {
      pageParams.delete('includeSummary');
      pageParams.set('skipReconcile', '1');
      pageParams.set('offset', String(offset));
      if (pageSize) pageParams.set('pageSize', String(pageSize));
    }
    const response = await fetch(`/api/work-orders/execution?${pageParams.toString()}`, { cache: 'no-store', signal });
    const body = await response.json().catch(() => ({}));
    if (response.status === 401) location.href = '/login';
    if (!response.ok) throw new Error(body.error || '生产看板加载失败');
    return body.data as BoardPayload;
  };

  const firstPage = await fetchPage(1);
  if (firstPage.items.length >= firstPage.pagination.total) return firstPage;

  const items = [...firstPage.items];
  const seen = new Set(items.map(item => item.id));
  const chunkSize = 500;
  const remainingOffsets: number[] = [];
  for (let offset = firstPage.items.length; offset < firstPage.pagination.total; offset += chunkSize) {
    remainingOffsets.push(offset);
  }
  for (let index = 0; index < remainingOffsets.length; index += 3) {
    const pageBatch = await Promise.all(remainingOffsets.slice(index, index + 3).map((offset, batchIndex) => (
      fetchPage(index + batchIndex + 2, offset, Math.min(chunkSize, firstPage.pagination.total - offset))
    )));
    for (const nextPage of pageBatch) {
      for (const item of nextPage.items) {
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        items.push(item);
      }
    }
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
    hasOriginalDrawing: order.documentCategoryCodes.includes('drawing'),
    warehouseMaterialStatus: order.warehouseMaterial?.status,
    warehouseExceptionType: order.warehouseMaterial?.exceptionType,
    warehouseExceptionNote: order.warehouseMaterial?.exceptionNote,
    warehouseExpectedAt: order.warehouseMaterial?.expectedAt,
  });
  return { ...order, quantitySummary, productionAlerts };
}

export default function ProductionExecutionCenter({
  user,
  modeDrawerInitiallyOpen = false,
}: {
  user: CurrentUserDTO;
  modeDrawerInitiallyOpen?: boolean;
}) {
  const router = useRouter();
  const modeDrawer = useModuleModeDrawer(modeDrawerInitiallyOpen);
  const [navigationOpen, setNavigationOpen] = useState(false);
  const canConfigureSystem = user.access.capabilities.includes('SYSTEM_CONFIGURATION:MANAGE');
  const canAdministerProduction = user.access.capabilities.includes('PRODUCTION:UPDATE')
    || user.access.capabilities.includes('BUSINESS:UPDATE');
  const canScheduleProduction = user.canAccessDailyPlans
    && (
      user.access.capabilities.includes('PRODUCTION:UPDATE')
      || user.access.capabilities.includes('PLANNING:UPDATE')
    );
  const canSelectProduction = canAdministerProduction || canScheduleProduction;
  const canManageWip = canManageWipWarehouse(user);
  const canPrintTravelers = user.access.capabilities.includes('PRODUCTION:EXECUTE_WORKFLOW')
    || user.access.capabilities.includes('SYSTEM_CONFIGURATION:READ');
  const canViewQualityRisks = user.laborRole === 'ADMIN'
    || user.access.modules.includes('QUALITY')
    || user.access.modules.includes('ISSUE_MANAGEMENT');
  const canManageQualityRisks = user.laborRole === 'ADMIN'
    || user.access.capabilities.includes('QUALITY:UPDATE');
  const canAcknowledgeQualityRisks = canManageQualityRisks
    || user.access.capabilities.includes('PRODUCTION:UPDATE')
    || user.access.capabilities.includes('BUSINESS:UPDATE')
    || user.access.capabilities.includes('PLANNING:UPDATE');
  const [summarySnapshot, setSummarySnapshot] = useState<CacheBoundSnapshot<ProductionSummary> | null>(null);
  const [boardSnapshot, setBoardSnapshot] = useState<CacheBoundSnapshot<BoardPayload> | null>(null);
  const [view, setView] = useState<ViewKey>('board');
  const [keyword, setKeyword] = useState('');
  const [debouncedKeyword, setDebouncedKeyword] = useState('');
  const [targetWorkOrderId, setTargetWorkOrderId] = useState('');
  const [targetWipAllocationId, setTargetWipAllocationId] = useState('');
  const [quick, setQuick] = useState<QuickFilter[]>([]);
  const [advanced, setAdvanced] = useState<AdvancedFilters>(emptyAdvanced);
  const [draftAdvanced, setDraftAdvanced] = useState<AdvancedFilters>(emptyAdvanced);
  const [scope, setScope] = useState<WeekScope>('current');
  const [weekStart, setWeekStart] = useState('');
  const [stateReady, setStateReady] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [dispatchPageSize, setDispatchPageSize] = useState(12);
  const activeBoardCacheKey = useMemo(() => executionParams(
    view,
    debouncedKeyword,
    quick,
    advanced,
    scope,
    weekStart,
    1,
    targetWorkOrderId,
    12,
    targetWipAllocationId,
  ).toString(), [advanced, debouncedKeyword, quick, scope, targetWipAllocationId, targetWorkOrderId, view, weekStart]);
  const activeBoardCacheKeyRef = useRef(activeBoardCacheKey);
  activeBoardCacheKeyRef.current = activeBoardCacheKey;
  const board = cacheBoundSnapshotValue(boardSnapshot, activeBoardCacheKey);
  const summary = board
    ? cacheBoundSnapshotValue(summarySnapshot, activeBoardCacheKey)
    : null;
  const displayedCurrentCarryoverCount = summary?.executionCountBreakdown?.carryover
    ?? summary?.navigation?.carryoverCount;
  const [refreshToken, setRefreshToken] = useState(0);
  const productionRequestInFlightRef = useRef(false);
  const autoRefreshFailureCountRef = useRef(0);
  const nextAutoRefreshAtRef = useRef(0);
  useEffect(() => {
    const refreshControl = () => {
      if (productionRequestInFlightRef.current) return;
      setRefreshToken(value => value + 1);
    };
    window.addEventListener('production-control-updated', refreshControl);
    return () => window.removeEventListener('production-control-updated', refreshControl);
  }, []);
  const [summaryRefreshToken, setSummaryRefreshToken] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [toast, setToast] = useState('');
  useToastBridge(toast, setToast);
  const [batchMode, setBatchMode] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [detailOrder, setDetailOrder] = useState<ProductionOrder | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>('production');
  const [progressLogs, setProgressLogs] = useState<ProgressLog[]>([]);
  const [progressLoading, setProgressLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [travelerPrintIds, setTravelerPrintIds] = useState<string[]>([]);
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
  const [arrangementRequest, setArrangementRequest] = useState<ProductionArrangementRequest | null>(null);
  const [arrangementForm, setArrangementForm] = useState<ProductionArrangementForm>({
    workDate: chinaDateKey(), shiftCode: 'DAY', teamId: '', employeeIds: [], includeWaitingUpstream: true,
  });
  const [arrangementContext, setArrangementContext] = useState<ProductionArrangementContext | null>(null);
  const [arrangementLoading, setArrangementLoading] = useState(false);
  const [arrangementSaving, setArrangementSaving] = useState(false);
  const [arrangementError, setArrangementError] = useState('');
  const [arrangementSearch, setArrangementSearch] = useState('');
  const [reassignmentRequest, setReassignmentRequest] = useState<ProductionReassignmentRequest | null>(null);
  const [reassignmentContext, setReassignmentContext] = useState<ProductionReassignmentContext | null>(null);
  const [reassignmentForm, setReassignmentForm] = useState<ProductionReassignmentForm>({
    sourceEmployeeId: '', targetEmployeeIds: [], taskIds: [], reasonCode: 'ABSENCE', reason: '',
  });
  const [reassignmentSearch, setReassignmentSearch] = useState('');
  const [reassignmentLoading, setReassignmentLoading] = useState(false);
  const [reassignmentSaving, setReassignmentSaving] = useState(false);
  const [reassignmentError, setReassignmentError] = useState('');
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [commandMenuOpen, setCommandMenuOpen] = useState(false);
  const [insightsOpen, setInsightsOpen] = useState(false);
  const [olderCarryoverOpen, setOlderCarryoverOpen] = useState(false);
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
  const arrangementRequestRef = useRef(0);
  const reassignmentRequestRef = useRef(0);
  const arrangementAutoSelectionRef = useRef('');
  const exportButtonRef = useRef<HTMLButtonElement | null>(null);
  const commandMenuButtonRef = useRef<HTMLButtonElement | null>(null);
  const boardShellRef = useRef<HTMLDivElement | null>(null);
  const dispatchLoadMoreRef = useRef<HTMLDivElement | null>(null);
  const pendingRestoreRef = useRef<ProductionExecutionViewState | null>(null);
  const returnKeyRef = useRef('');
  const requestRef = useRef(0);
  const processedSummaryRefreshRef = useRef(0);
  const reconciliationRefreshTokenRef = useRef(-1);
  const reconciledScopeKeysRef = useRef(new Set<string>());
  const boardRef = useRef<BoardPayload | null>(null);
  const keywordReadyRef = useRef(false);
  const todayLabel = useMemo(() => new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: 'long', day: 'numeric', weekday: 'short',
  }).format(new Date()), []);

  useEffect(() => { boardRef.current = board; }, [board]);

  useEffect(() => subscribeProductionDataInvalidations(() => {
    if (productionRequestInFlightRef.current) return;
    productionBoardCache.clear();
    reconciledScopeKeysRef.current.clear();
    setRefreshToken(value => value + 1);
  }), []);

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
    setTargetWipAllocationId((sourceParams.get('wipAllocationId') || '').trim().slice(0, 120));
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
    setScope(restoredScope === 'carryover' || restoredScope === 'next' || restoredScope === 'afterNext' || restoredScope === 'history'
      ? restoredScope
      : restoredWeekStart ? 'history' : 'current');
    setWeekStart(restoredWeekStart);
    setPage(Math.max(1, restored?.page || Number(sourceParams.get('displayPage')) || Number(sourceParams.get('page')) || 1));
    const restoredPageSize = restored?.pageSize || Number(sourceParams.get('displaySize')) || 12;
    setDispatchPageSize(restoredPageSize === 8 || restoredPageSize === 16 ? restoredPageSize : 12);
    if (restored) {
      setBatchMode(canSelectProduction && restored.batchMode);
      setSelected(canSelectProduction && Array.isArray(restored.selectedIds) ? restored.selectedIds : []);
    }
    setStateReady(true);
  }, [canSelectProduction]);

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
    const params = executionParams(view, debouncedKeyword, quick, advanced, scope, weekStart, page, targetWorkOrderId, dispatchPageSize, targetWipAllocationId);
    if (returnKeyRef.current) params.set('returnKey', returnKeyRef.current);
    window.history.replaceState(window.history.state, '', `/production?${params.toString()}`);
  }, [advanced, debouncedKeyword, dispatchPageSize, page, quick, scope, stateReady, targetWipAllocationId, targetWorkOrderId, view, weekStart]);

  useEffect(() => {
    if (!stateReady || summaryRefreshToken === 0 || processedSummaryRefreshRef.current === summaryRefreshToken) return undefined;
    processedSummaryRefreshRef.current = summaryRefreshToken;
    const controller = new AbortController();
    const params = new URLSearchParams();
    params.set('scope', scope);
    params.set('skipReconcile', '1');
    if (scope === 'history' && weekStart) params.set('weekStart', weekStart);
    const cacheKey = activeBoardCacheKey;
    fetch(`/api/dashboard/production-summary?${params.toString()}`, { cache: 'no-store', signal: controller.signal })
      .then(async response => {
        const body = await response.json().catch(() => ({}));
        if (response.status === 401) location.href = '/login';
        if (!response.ok) throw new Error(body.error || '生产摘要加载失败');
        return body.data as ProductionSummary;
      })
      .then(data => {
        if (activeBoardCacheKeyRef.current !== cacheKey) return;
        setSummarySnapshot({ cacheKey, value: data });
        if (scope === 'history' && !weekStart && data.weekStartDate) setWeekStart(data.weekStartDate);
      })
      .catch(reason => {
        if (reason instanceof DOMException && reason.name === 'AbortError') return;
        setLoadError(reason instanceof Error ? reason.message : '生产摘要加载失败');
      });
    return () => controller.abort();
  }, [activeBoardCacheKey, scope, stateReady, summaryRefreshToken, weekStart]);

  useEffect(() => {
    if (!stateReady) return undefined;
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    productionRequestInFlightRef.current = true;
    const controller = new AbortController();
    const params = executionParams(view, debouncedKeyword, quick, advanced, scope, weekStart, 1, targetWorkOrderId, 12, targetWipAllocationId);
    const cacheKey = activeBoardCacheKey;
    if (reconciliationRefreshTokenRef.current !== refreshToken) {
      reconciliationRefreshTokenRef.current = refreshToken;
      reconciledScopeKeysRef.current.clear();
    }
    const reconciliationScopeKey = `${scope}:${weekStart}:${targetWorkOrderId}`;
    if (reconciledScopeKeysRef.current.has(reconciliationScopeKey)) params.set('skipReconcile', '1');
    else reconciledScopeKeysRef.current.add(reconciliationScopeKey);
    const cached = productionBoardCache.get(cacheKey);
    if (cached) {
      setBoardSnapshot({ cacheKey, value: cached });
      setSummarySnapshot(cached.summary ? { cacheKey, value: cached.summary } : null);
      setLoading(false);
    } else {
      setBoardSnapshot(current => retainCacheBoundSnapshot(current, cacheKey));
      setSummarySnapshot(current => retainCacheBoundSnapshot(current, cacheKey));
      setLoading(true);
    }
    setLoadError('');
    fetchCompleteProductionBoard(params, controller.signal)
      .then(data => {
        if (requestId !== requestRef.current) return;
        productionBoardCache.set(cacheKey, data);
        if (productionBoardCache.size > 8) productionBoardCache.delete(productionBoardCache.keys().next().value || '');
        setBoardSnapshot({ cacheKey, value: data });
        setSummarySnapshot(data.summary ? { cacheKey, value: data.summary } : null);
        setLastRefreshedAt(new Date());
        setLoadError('');
        autoRefreshFailureCountRef.current = 0;
        nextAutoRefreshAtRef.current = Date.now() + AUTO_REFRESH_BASE_DELAY_MS;
        setSelected(current => current.filter(id => data.items.some(item => item.id === id)));
      })
      .catch(reason => {
        if (reason instanceof DOMException && reason.name === 'AbortError') return;
        if (requestId === requestRef.current) {
          const failures = autoRefreshFailureCountRef.current + 1;
          autoRefreshFailureCountRef.current = failures;
          nextAutoRefreshAtRef.current = Date.now() + autoRefreshDelayMs(failures);
          setLoadError(reason instanceof Error ? reason.message : '生产看板加载失败');
        }
      })
      .finally(() => {
        if (requestId !== requestRef.current) return;
        productionRequestInFlightRef.current = false;
        setLoading(false);
      });
    return () => controller.abort();
  }, [activeBoardCacheKey, advanced, debouncedKeyword, quick, refreshToken, scope, stateReady, targetWipAllocationId, targetWorkOrderId, view, weekStart]);

  useEffect(() => {
    if (!board || !targetWipAllocationId) return undefined;
    const frame = window.requestAnimationFrame(() => {
      const selector = `[data-wip-allocation-id="${CSS.escape(targetWipAllocationId)}"]`;
      const row = boardShellRef.current?.querySelector<HTMLElement>(selector);
      if (!row) return;
      row.scrollIntoView({ block: 'center', behavior: 'smooth' });
      row.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [board, targetWipAllocationId]);

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
          const params = executionParams(view, debouncedKeyword, quick, advanced, scope, weekStart, page, targetWorkOrderId, dispatchPageSize, targetWipAllocationId);
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
  }, [advanced, board, debouncedKeyword, dispatchPageSize, loading, page, quick, scope, targetWipAllocationId, targetWorkOrderId, view, weekStart]);

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
    if (!autoRefresh) return undefined;
    const refresh = (): void => {
      const now = Date.now();
      if (!shouldStartAutoRefresh({
        visible: document.visibilityState === 'visible',
        requestInFlight: productionRequestInFlightRef.current,
        now,
        nextAllowedAt: nextAutoRefreshAtRef.current,
      })) return;
      nextAutoRefreshAtRef.current = now + AUTO_REFRESH_BASE_DELAY_MS;
      productionBoardCache.clear();
      setRefreshToken(value => value + 1);
    };
    const timer = window.setInterval(refresh, AUTO_REFRESH_BASE_DELAY_MS);
    return () => window.clearInterval(timer);
  }, [autoRefresh]);

  useEffect(() => {
    if (!arrangementRequest) return undefined;
    const requestId = arrangementRequestRef.current + 1;
    arrangementRequestRef.current = requestId;
    const controller = new AbortController();
    const params = new URLSearchParams({
      workDate: arrangementForm.workDate,
      shiftCode: arrangementForm.shiftCode,
      includeWaitingUpstream: arrangementForm.includeWaitingUpstream ? '1' : '0',
    });
    arrangementRequest.orders.forEach(order => params.append('workOrderId', order.id));
    if (arrangementForm.teamId) params.set('teamId', arrangementForm.teamId);
    setArrangementLoading(true);
    setArrangementError('');
    fetch(`/api/production/arrangements/context?${params.toString()}`, { cache: 'no-store', signal: controller.signal })
      .then(async response => {
        const body = await response.json().catch(() => ({}));
        if (response.status === 401) location.href = '/login';
        if (!response.ok || !body.data) throw new Error(body.error || '生产安排信息加载失败');
        return body.data as ProductionArrangementContext;
      })
      .then(data => {
        if (requestId !== arrangementRequestRef.current) return;
        setArrangementContext(data);
        setArrangementForm(current => {
          const nextTeamId = current.teamId || data.selectedTeamId;
          const selectionKey = `${arrangementRequest.mode}:${arrangementRequest.orders.map(order => order.id).join(',')}:${data.workDate}:${nextTeamId}`;
          const previousEmployees = arrangementRequest.sourceArrangement?.employees.map(employee => employee.employeeId) || [];
          const defaultEmployees = previousEmployees.length ? previousEmployees : data.recommendedEmployeeIds;
          const shouldAutoSelect = current.employeeIds.length === 0
            && defaultEmployees.length > 0
            && arrangementAutoSelectionRef.current !== selectionKey;
          if (shouldAutoSelect) arrangementAutoSelectionRef.current = selectionKey;
          return {
            ...current,
            teamId: nextTeamId,
            employeeIds: shouldAutoSelect ? defaultEmployees : current.employeeIds,
          };
        });
      })
      .catch(reason => {
        if (reason instanceof DOMException && reason.name === 'AbortError') return;
        if (requestId === arrangementRequestRef.current) {
          setArrangementContext(null);
          setArrangementError(reason instanceof Error ? reason.message : '生产安排信息加载失败');
        }
      })
      .finally(() => { if (requestId === arrangementRequestRef.current) setArrangementLoading(false); });
    return () => controller.abort();
  }, [arrangementForm.includeWaitingUpstream, arrangementForm.shiftCode, arrangementForm.teamId, arrangementForm.workDate, arrangementRequest]);

  useEffect(() => {
    if (!reassignmentRequest) return undefined;
    const sourceEmployeeId = reassignmentForm.sourceEmployeeId || reassignmentRequest.sourceEmployeeId || '';
    if (reassignmentRequest.mode === 'employee_exception' && !sourceEmployeeId) {
      setReassignmentContext(null);
      setReassignmentLoading(false);
      return undefined;
    }
    const requestId = reassignmentRequestRef.current + 1;
    reassignmentRequestRef.current = requestId;
    const controller = new AbortController();
    const params = new URLSearchParams();
    reassignmentRequest.orders.forEach(order => params.append('workOrderId', order.id));
    if (reassignmentRequest.planId) params.set('planId', reassignmentRequest.planId);
    if (sourceEmployeeId) params.set('sourceEmployeeId', sourceEmployeeId);
    setReassignmentLoading(true);
    setReassignmentError('');
    fetch(`/api/production/arrangements/reassignment/context?${params.toString()}`, { cache: 'no-store', signal: controller.signal })
      .then(async response => {
        const body = await response.json().catch(() => ({}));
        if (response.status === 401) location.href = '/login';
        if (!response.ok || !body.data) throw new Error(body.error || '调班影响预览加载失败');
        return body.data as ProductionReassignmentContext;
      })
      .then(data => {
        if (requestId !== reassignmentRequestRef.current) return;
        setReassignmentContext(data);
        setReassignmentForm(current => ({
          ...current,
          sourceEmployeeId,
          targetEmployeeIds: data.defaultTargetEmployeeIds,
          taskIds: data.tasks.map(task => task.id),
        }));
      })
      .catch(reason => {
        if (reason instanceof DOMException && reason.name === 'AbortError') return;
        if (requestId === reassignmentRequestRef.current) {
          setReassignmentContext(null);
          setReassignmentError(reason instanceof Error ? reason.message : '调班影响预览加载失败');
        }
      })
      .finally(() => { if (requestId === reassignmentRequestRef.current) setReassignmentLoading(false); });
    return () => controller.abort();
  }, [reassignmentForm.sourceEmployeeId, reassignmentRequest]);

  useEffect(() => {
    if (!insightsOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    const overlayMode = !window.matchMedia('(min-width: 1920px)').matches;
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
  const dispatchBatchCount = Math.max(1, Math.ceil(dispatchAllItems.length / dispatchPageSize));
  const dispatchItems = useMemo(
    () => dispatchAllItems.slice(0, page * dispatchPageSize),
    [dispatchAllItems, dispatchPageSize, page],
  );
  const dispatchHasMore = dispatchItems.length < dispatchAllItems.length;

  useEffect(() => {
    if (page <= dispatchBatchCount) return;
    setPage(dispatchBatchCount);
  }, [dispatchBatchCount, page]);

  useEffect(() => {
    const root = boardShellRef.current;
    const target = dispatchLoadMoreRef.current;
    if (!root || !target || loading || !dispatchHasMore) return undefined;
    const observer = new IntersectionObserver(entries => {
      if (!entries[0]?.isIntersecting) return;
      setPage(current => Math.min(dispatchBatchCount, current + 1));
    }, {
      root,
      rootMargin: '0px 0px 240px',
      threshold: 0.01,
    });
    observer.observe(target);
    return () => observer.disconnect();
  }, [dispatchBatchCount, dispatchHasMore, dispatchItems.length, loading]);

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
      if (order.stage === 'completed' || order.productionControl?.pausedAt) continue;
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
    inProduction: summary?.dispatchMetrics.inProduction || 0,
    notStarted: summary?.dispatchMetrics.notStarted || 0,
    withNextProcess: summary?.dispatchMetrics.withNextProcess || 0,
    dueSoon: summary?.dispatchMetrics.dueSoon || 0,
    completed: summary?.dispatchMetrics.completed || 0,
    percentage: summary?.wipPlanMetrics?.percentage ?? summary?.planTotals.percentage ?? null,
  }), [summary]);
  const initialBoardLoading = loading && !board;

  const dispatchPreset: DispatchPreset = quick.includes('paused') ? 'paused' : view === 'today'
    ? 'today'
    : view === 'exceptions'
      ? 'exceptions'
      : quick.includes('due_soon')
        ? 'due_soon'
        : quick.includes('in_production')
          ? 'in_production'
          : quick.includes('not_started') || advanced.stage === 'not_issued'
            ? 'not_started'
            : quick.includes('has_next_process') || quick.includes('waiting_transfer')
              ? 'next_process'
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
    if (preset === 'paused') setQuick(['paused']);
    if (preset === 'in_production') setQuick(['in_production']);
    if (preset === 'not_started') setQuick(['not_started']);
    if (preset === 'next_process') setQuick(['has_next_process']);
    if (preset === 'due_soon') setQuick(['due_soon']);
    setAdvanced(preset === 'completed' ? { ...emptyAdvanced, stage: 'completed' } : emptyAdvanced);
  }

  function changeWeekScope(next: WeekScope, historyWeekStart?: string): void {
    setTargetWorkOrderId('');
    setScope(next);
    setWeekStart(next === 'history' ? (historyWeekStart || summary?.navigation?.history?.[0]?.weekStartDate || '') : '');
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

  function handleNavigationExpandedChange(expanded: boolean): void {
    setNavigationOpen(expanded);
    if (!expanded) return;
    modeDrawer.close(false);
    setInsightsOpen(false);
  }

  function toggleModeDrawer(): void {
    if (!modeDrawer.open) {
      setNavigationOpen(false);
      setInsightsOpen(false);
    }
    modeDrawer.toggle();
  }

  function toggleInsights(): void {
    const nextOpen = !insightsOpen;
    if (nextOpen) {
      setNavigationOpen(false);
      modeDrawer.close(false);
    }
    setInsightsOpen(nextOpen);
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

  function toggleArrangementQuickFilter(key: QuickFilter): void {
    setTargetWorkOrderId('');
    setView('board');
    setSelected([]);
    setQuick(current => {
      const withoutArrangement = current.filter(item => !arrangementQuickFilters.has(item));
      return current.includes(key) ? withoutArrangement : [...withoutArrangement, key];
    });
    setPage(1);
  }

  function openProductionArrangement(orders: ProductionOrder[], sourceArrangement?: ProductionArrangement): void {
    if (!canScheduleProduction) {
      setToast('仅车间主管或管理员可以安排生产日期和人员');
      return;
    }
    if (board?.readOnly) {
      setToast('历史周仅供查看，不能安排生产');
      return;
    }
    const uniqueOrders = [...new Map(orders.map(order => [order.id, order] as const)).values()];
    if (!uniqueOrders.length) return;
    if (uniqueOrders.length > 50) {
      setToast('一次最多批量安排 50 个工单');
      return;
    }
    const today = chinaDateKey();
    const sourceNextDay = sourceArrangement ? addDateKeyDays(sourceArrangement.workDate, 1) : today;
    const workDate = sourceArrangement && sourceNextDay > today ? sourceNextDay : today;
    setArrangementRequest({
      orders: uniqueOrders,
      mode: sourceArrangement ? 'continue' : 'schedule',
      sourceArrangement,
    });
    setArrangementForm({
      workDate,
      shiftCode: sourceArrangement?.shiftCode || 'DAY',
      teamId: sourceArrangement?.teamId || '',
      employeeIds: sourceArrangement?.employees.map(employee => employee.employeeId) || [],
      includeWaitingUpstream: true,
    });
    arrangementAutoSelectionRef.current = '';
    setArrangementContext(null);
    setArrangementSearch('');
    setArrangementError('');
  }

  function closeProductionArrangement(force = false): void {
    if (arrangementSaving && !force) return;
    arrangementRequestRef.current += 1;
    setArrangementRequest(null);
    setArrangementContext(null);
    setArrangementSearch('');
    setArrangementError('');
  }

  async function saveProductionArrangement(): Promise<void> {
    if (!arrangementRequest || arrangementSaving) return;
    if (!arrangementForm.workDate) {
      setArrangementError('请选择生产日期');
      return;
    }
    if (!arrangementForm.employeeIds.length) {
      setArrangementError('请至少选择 1 名作业员工');
      return;
    }
    if (arrangementRequest.mode === 'schedule' && !arrangementForm.teamId) {
      setArrangementError('生产人员名单尚未加载完成，请稍后重试');
      return;
    }
    const source = arrangementRequest.sourceArrangement;
    if (arrangementRequest.mode === 'continue' && (!source?.sourceTaskIds.length || arrangementForm.workDate <= source.workDate)) {
      setArrangementError(`续排日期必须晚于原安排 ${source?.workDate || ''}`.trim());
      return;
    }
    const idempotencyKey = typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `production-arrangement-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setArrangementSaving(true);
    setArrangementError('');
    try {
      const response = await fetch('/api/production/arrangements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify(arrangementRequest.mode === 'continue'
          ? {
              action: 'continue',
              workDate: arrangementForm.workDate,
              shiftCode: arrangementForm.shiftCode,
              sourceTaskIds: source?.sourceTaskIds || [],
              employeeIds: arrangementForm.employeeIds,
              reason: '生产执行未完成续排',
              idempotencyKey,
            }
          : {
              action: 'schedule',
              workDate: arrangementForm.workDate,
              shiftCode: arrangementForm.shiftCode,
              teamId: arrangementForm.teamId,
              workOrderIds: arrangementRequest.orders.map(order => order.id),
              employeeIds: arrangementForm.employeeIds,
              includeWaitingUpstream: arrangementForm.includeWaitingUpstream,
              reason: arrangementRequest.orders.length > 1 ? '生产执行批量前置安排' : '生产执行主管前置安排',
              idempotencyKey,
            }),
      });
      const body = await response.json().catch(() => ({}));
      if (response.status === 401) location.href = '/login';
      if (!response.ok) throw new Error(body.error || '生产安排保存失败');
      const count = arrangementRequest.orders.length;
      closeProductionArrangement(true);
      setSelected([]);
      setBatchMode(false);
      productionBoardCache.clear();
      setRefreshToken(value => value + 1);
      setToast(arrangementRequest.mode === 'continue'
        ? '续排已保存，原安排记录已保留'
        : `已安排 ${count} 个工单的生产日期和人员`);
    } catch (reason) {
      setArrangementError(reason instanceof Error ? reason.message : '生产安排保存失败');
    } finally {
      setArrangementSaving(false);
    }
  }

  function openProductionReassignment(order: ProductionOrder, arrangement: ProductionArrangement): void {
    if (!canScheduleProduction || board?.readOnly) {
      setToast(board?.readOnly ? '历史周仅供查看，不能调整人员' : '当前账号不能调整生产人员');
      return;
    }
    if (arrangement.status === 'completed' || arrangement.status === 'carried_over' || arrangement.remainingQty <= 0) {
      setToast('该安排已完成，只能查看历史，不能修改人员');
      return;
    }
    setReassignmentRequest({
      mode: 'arrangement',
      orders: [order],
      planId: arrangement.planId,
      title: `${specText(order)} · ${compactDateText(arrangement.workDate)}`,
    });
    setReassignmentForm({
      sourceEmployeeId: '',
      targetEmployeeIds: arrangement.employees.map(employee => employee.employeeId),
      taskIds: [],
      reasonCode: 'TEMPORARY_TRANSFER',
      reason: '',
    });
    setReassignmentContext(null);
    setReassignmentSearch('');
    setReassignmentError('');
  }

  function openEmployeeExceptionReassignment(): void {
    if (!canScheduleProduction || board?.readOnly) {
      setToast(board?.readOnly ? '历史周仅供查看，不能调整人员' : '当前账号不能调整生产人员');
      return;
    }
    const orders = (board?.items || []).filter(order => order.arrangements.some(arrangement => (
      arrangement.remainingQty > 0
      && arrangement.status !== 'completed'
      && arrangement.status !== 'carried_over'
      && arrangement.employees.length > 0
    )));
    if (!orders.length) {
      setToast('当前筛选范围没有可调班的未完成安排');
      return;
    }
    setReassignmentRequest({
      mode: 'employee_exception',
      orders,
      title: `当前范围 ${orders.length} 个工单`,
    });
    setReassignmentForm({
      sourceEmployeeId: '', targetEmployeeIds: [], taskIds: [], reasonCode: 'ABSENCE', reason: '',
    });
    setReassignmentContext(null);
    setReassignmentSearch('');
    setReassignmentError('');
  }

  function closeProductionReassignment(force = false): void {
    if (reassignmentSaving && !force) return;
    reassignmentRequestRef.current += 1;
    setReassignmentRequest(null);
    setReassignmentContext(null);
    setReassignmentSearch('');
    setReassignmentError('');
  }

  async function saveProductionReassignment(): Promise<void> {
    if (!reassignmentRequest || !reassignmentContext || reassignmentSaving) return;
    const selectedTasks = reassignmentContext.tasks.filter(task => reassignmentForm.taskIds.includes(task.id));
    if (!selectedTasks.length) {
      setReassignmentError('请至少选择 1 道待调整工序');
      return;
    }
    if (reassignmentRequest.mode === 'arrangement' && !reassignmentForm.targetEmployeeIds.length) {
      setReassignmentError('调整后必须至少保留 1 名作业员工');
      return;
    }
    const idempotencyKey = typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `production-reassignment-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setReassignmentSaving(true);
    setReassignmentError('');
    try {
      const response = await fetch('/api/production/arrangements/reassignment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({
          taskIds: selectedTasks.map(task => task.id),
          sourceEmployeeId: reassignmentForm.sourceEmployeeId || undefined,
          targetEmployeeIds: reassignmentForm.targetEmployeeIds,
          expectedTasks: selectedTasks.map(task => ({
            taskId: task.id,
            taskVersion: task.version,
            planVersion: task.planVersion,
            completedQty: task.completedQty,
            assignmentVersions: task.assignments.map(assignment => ({
              assignmentId: assignment.id,
              version: assignment.version,
            })),
          })),
          reasonCode: reassignmentForm.reasonCode,
          reason: reassignmentForm.reason,
          idempotencyKey,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (response.status === 401) location.href = '/login';
      if (!response.ok) throw new Error(body.error || '生产调班保存失败');
      const redistributedQty = Number(body.data?.redistributedQty || 0);
      const updatedTaskCount = Number(body.data?.updatedTaskCount || selectedTasks.length);
      closeProductionReassignment(true);
      productionBoardCache.clear();
      setRefreshToken(value => value + 1);
      setToast(`已重排 ${updatedTaskCount} 道工序的剩余 ${formatProductionQuantity(redistributedQty)} 件次，既有报工与员工工时未改变`);
    } catch (reason) {
      setReassignmentError(reason instanceof Error ? reason.message : '生产调班保存失败');
    } finally {
      setReassignmentSaving(false);
    }
  }

  function toggleBatchMode(): void {
    if (board?.readOnly) {
      setToast('历史周仅供查看，不能批量修改');
      return;
    }
    setBatchMode(current => {
      if (current) setSelected([]);
      return !current;
    });
  }

  function applyLocalOrder(order: ProductionOrder): void {
    const cacheKey = activeBoardCacheKey;
    setBoardSnapshot(current => {
      if (!current || current.cacheKey !== cacheKey) return current;
      return { cacheKey, value: replaceOrder(current.value, order) || current.value };
    });
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
      const cacheKey = activeBoardCacheKey;
      setBoardSnapshot(current => (
        previousBoard && current?.cacheKey === cacheKey
          ? { cacheKey, value: previousBoard }
          : current
      ));
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
    const step = route?.steps.find(item => item.id === stepId);
    if (!route || !step) {
      setCompletionError('所选工序已不在该生产路线中，请刷新调度中心后重试');
      return;
    }
    const requestId = completionRequestRef.current + 1;
    completionRequestRef.current = requestId;
    const previousForm = completionForm;
    const workDate = previousForm?.workDate
      || (order.wipContinuation ? wipReportDate(order.wipContinuation) : todayShanghaiDateKey());
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
      const continuationStep = order.wipContinuation?.steps.find(item => item.stepId === step.id);
      const effectiveReportableQty = continuationStep
        ? Math.min(context.reportableQty, continuationStep.remainingQty)
        : context.reportableQty;
      const effectiveContext = continuationStep
        ? {
            ...context,
            reportableQty: effectiveReportableQty,
            routeSteps: context.routeSteps.map(item => item.id === step.id
              ? { ...item, reportableQty: Math.min(item.reportableQty, continuationStep.remainingQty) }
              : item),
          }
        : context;
      const previousEmployeeIds = previousForm?.employeeIds.filter(id => (
        context.employees.some(employee => employee.id === id)
      )) || [];
      const preferredEmployeeIds = new Set(context.workerPreset?.employees.map(employee => employee.id) || []);
      const defaultEmployeeIds = previousEmployeeIds.length
        ? previousEmployeeIds
        : user.employeeId
          && context.employees.some(employee => employee.id === user.employeeId)
          && (!context.workerPreset || preferredEmployeeIds.has(user.employeeId))
          ? [user.employeeId]
          : [];
      setCompletionContext(effectiveContext);
      const actionReporting = effectiveContext.step.reportQuantityBasis === 'action';
      setCompletionForm({
        processedQty: actionReporting ? '0' : effectiveReportableQty > 0 ? String(effectiveReportableQty) : '',
        defectQty: '0',
        reportedUnitQty: '0',
        reportedDefectUnitQty: '0',
        defectDisposition,
        workDate,
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
    const continuationStepId = order.wipContinuation?.steps.find(step => step.remainingQty > 0)?.stepId;
    const step = (continuationStepId ? route?.steps.find(item => item.id === continuationStepId) : null)
      || route?.currentSteps[0]
      || route?.currentStep;
    if (!route || !step) {
      setToast('当前没有可完成的执行工序，请先检查工艺路线');
      return;
    }
    setCompletionOrder(order);
    await loadProcessCompletionContext(order, step.id);
  }

  async function saveProcessCompletion(): Promise<void> {
    if (!completionOrder || !completionContext || !completionForm) return;
    const actionReporting = completionContext.step.reportQuantityBasis === 'action';
    const processedText = completionForm.processedQty.trim();
    const defectText = completionForm.defectQty.trim();
    const reportedUnitText = completionForm.reportedUnitQty.trim();
    const reportedDefectUnitText = completionForm.reportedDefectUnitQty.trim();
    if (!(actionReporting ? /^\d+$/.test(processedText) : /^[1-9]\d*$/.test(processedText))) {
      setCompletionError(actionReporting ? '形成完整产品数量必须是大于或等于 0 的整数' : '本次实际处理数量必须是正整数');
      return;
    }
    if (!/^\d+$/.test(defectText)) {
      setCompletionError('不良品数量必须是大于或等于 0 的整数');
      return;
    }
    const processedQty = Number(processedText);
    const defectQty = Number(defectText);
    const reportedUnitQty = actionReporting ? Number(reportedUnitText) : processedQty;
    const reportedDefectUnitQty = actionReporting ? Number(reportedDefectUnitText) : defectQty;
    const reportedGoodUnitQty = reportedUnitQty - reportedDefectUnitQty;
    const supplement = completionContext.step.supplementObligation;
    if (!Number.isSafeInteger(processedQty) || processedQty < 0 || processedQty > completionContext.reportableQty) {
      setCompletionError(`本次报工不能超过该工序剩余可报数量 ${formatProductionQuantity(completionContext.reportableQty)}`);
      return;
    }
    if (!Number.isSafeInteger(defectQty) || defectQty < 0 || defectQty > processedQty) {
      setCompletionError('不良品数量不能超过本次实际处理数量');
      return;
    }
    if (supplement && defectQty > 0) {
      setCompletionError('补充工序不重复改变整套质量分支，整套不良必须为 0');
      return;
    }
    if (actionReporting && (
      !/^\d+$/.test(reportedUnitText)
      || !/^\d+$/.test(reportedDefectUnitText)
      || !Number.isSafeInteger(reportedUnitQty)
      || !Number.isSafeInteger(reportedDefectUnitQty)
      || reportedDefectUnitQty < 0
      || reportedDefectUnitQty > reportedUnitQty
    )) {
      setCompletionError('实际动作与动作不良必须是有效整数，且动作不良不能超过实际动作');
      return;
    }
    if (actionReporting && processedQty <= 0 && reportedUnitQty <= 0) {
      setCompletionError('请填写实际动作数量；形成整套后再填写整套数量');
      return;
    }
    if (actionReporting && reportedGoodUnitQty > completionContext.reportableUnitQty) {
      setCompletionError(`本次合格动作不能超过剩余可报 ${formatProductionQuantity(completionContext.reportableUnitQty)} ${completionContext.step.reportUnitLabel}`);
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
          reportedUnitQty: actionReporting ? reportedUnitQty : undefined,
          reportedDefectUnitQty: actionReporting ? reportedDefectUnitQty : undefined,
          defectDisposition: defectQty > 0 ? completionForm.defectDisposition : undefined,
          workDate: completionForm.workDate,
          employeeIds: completionForm.employeeIds,
          team: completionForm.team,
          workstation: completionForm.workstation,
          remark: completionForm.remark,
          idempotencyKey: completionIdempotencyKey,
          expectedRouteVersion: completionContext.routeVersion,
          obligationId: supplement?.id,
          expectedObligationVersion: supplement?.version,
          wipAllocationId: completionOrder.wipContinuation?.allocationId || undefined,
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
      const autoAssignedEmployeeCount = Math.max(0, Number(body.data.autoAssignedEmployeeCount) || 0);
      const pendingCoverageQty = Math.max(0, Number(body.data.pendingCoverageQty) || 0);
      const laborMessage = supplement
        ? Number(body.data.standardLaborMilliseconds || 0) > 0
          ? '，真实标准工时已自动建账'
          : '，本次未生成标准工时'
        : body.data.laborPoolPendingStandard
        ? '，工时已记入待补标准清单'
        : autoAssignedEmployeeCount > 0
        ? `，标准工时已自动记入 ${autoAssignedEmployeeCount} 名作业员工`
        : body.data.laborPoolId
        ? '，标准工时已自动建账'
        : completedStep?.timeBasis === 'per_batch'
          ? '，本批标准工时将在上下游闭环后自动记入作业员工'
          : !completedStep?.standardMillisecondsPerUnit
            ? '，未生成工时池，请维护该工序标准工时'
            : '，本次未生成标准工时';
      const unitLabel = completedStep?.unitLabel || '件';
      const productTransferMessage = pendingCoverageQty > 0
        ? `${formatProductionQuantity(processedQty)} ${unitLabel}已报工，${formatProductionQuantity(pendingCoverageQty)} ${unitLabel}等待前序数量自动核销`
        : goodTransferredQty > 0
        ? `${formatProductionQuantity(goodTransferredQty)} ${unitLabel}良品已流转${goodWaitingForGroupQty > 0 ? `，${formatProductionQuantity(goodWaitingForGroupQty)} ${unitLabel}等待同组工序齐套` : ''}`
        : goodQty > 0
          ? `${formatProductionQuantity(goodQty)} ${unitLabel}良品已登记，等待同组工序齐套后转序`
          : '本批没有良品可流转';
      const supplementMessage = supplement
        ? `${formatProductionQuantity(processedQty)} ${unitLabel}补充报工已登记，剩余 ${formatProductionQuantity(Number(body.data.remainingQty) || 0)} ${unitLabel}；不重复向后序转数量`
        : '';
      const transferMessage = supplement
        ? supplementMessage
        : actionReporting
        ? `${formatProductionQuantity(reportedGoodUnitQty)} ${completionContext.step.reportUnitLabel}合格动作已登记，${productTransferMessage}`
        : productTransferMessage;
      setToast(`${transferMessage}${laborMessage}${branchMessage}`);
      closeProcessCompletion(true);
      productionBoardCache.clear();
      setRefreshToken(value => value + 1);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : '工序完成转序失败';
      setCompletionError(message);
      if (message.includes('已被其他操作更新') || message.includes('版本')) {
        productionBoardCache.clear();
        setRefreshToken(value => value + 1);
      }
    } finally {
      setCompletionSaving(false);
    }
  }

  function openNextStep(order: ProductionOrder, displayStage: StageKey): void {
    if (board?.readOnly) {
      setToast('历史周仅供查看，不能继续流转工单');
      return;
    }
    setStatusMenuOrder(null);
    setDrawingMenuOrder(null);
    const routeReadiness = processRouteExecutionReadiness(order.processRoute?.steps || []);
    if (!order.processRoute || order.processRoute.status === 'draft' || !routeReadiness.ready) {
      if (!canAdministerProduction) {
        setToast('当前产品工序路线或标准工时尚未完整发布，请联系管理员维护');
        return;
      }
      if (!order.drawingLibraryItemId) {
        setToast('当前工单尚未关联图纸产品，无法匹配产品工序与工时');
        return;
      }
      openProductTimes(order, displayStage);
      return;
    }
    if (order.wipContinuation && order.processRoute.status !== 'confirmed') {
      void openProcessCompletion(order);
      return;
    }
    if (order.processRoute.status === 'completed') return;
    if (order.processRoute.status === 'confirmed') {
      setNextStepRequest({ order, displayStage, action: 'start_process_route' });
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
      setToast('工艺路线已启动，工单已进入首道工序');
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : '生产数量流转失败';
      if (message === '工单进度已被其他操作更新，请刷新后重试') {
        setNextStepRequest(null);
        setToast(message);
        productionBoardCache.clear();
        setRefreshToken(value => value + 1);
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

  function openDetail(order: ProductionOrder, initialTab: DetailTab = 'production'): void {
    setDetailOrder(order);
    setDetailTab(initialTab);
    setProgressLogs([]);
  }

  function switchDetailTab(tab: DetailTab): void {
    setDetailTab(tab);
    if (tab === 'progress' && detailOrder) void loadProgress(detailOrder.id);
  }

  function captureReturnState(returnKey: string, focusedOrderId: string, focusedStage?: StageKey): string {
    const params = executionParams(view, debouncedKeyword, quick, advanced, scope, weekStart, page, targetWorkOrderId, dispatchPageSize, targetWipAllocationId);
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

  function openProductTimes(order: ProductionOrder, focusedStage?: StageKey): void {
    const returnKey = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const returnTo = captureReturnState(returnKey, order.id, focusedStage);
    const productTimeScope: ProductTimeRouteScope | undefined = scope === 'afterNext' ? undefined : scope;
    router.push(productTimeConfigurationRoute(order.drawingLibraryItemId, {
      scope: productTimeScope,
      from: 'production',
      returnTo,
      returnKey,
      workOrderId: order.id,
      weekStartDate: weekStart,
    }), { scroll: false });
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
      setToast('历史周仅供查看，不能批量修改');
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

  function printTravelers(workOrderIds: string[]): void {
    const cleanIds = [...new Set(workOrderIds.filter(Boolean))];
    if (!cleanIds.length) return;
    setTravelerPrintIds(cleanIds);
  }

  function productionDocumentParams(selectedOnly = false): URLSearchParams {
    const params = executionParams(view, debouncedKeyword, quick, advanced, scope, weekStart, 1, targetWorkOrderId, 12, targetWipAllocationId);
    params.delete('page'); params.delete('pageSize');
    if (selectedOnly) selected.forEach(id => params.append('selectedWorkOrderId', id));
    return params;
  }

  function exportDispatchWorkbook(selectedOnly = false): void {
    setExportMenuOpen(false);
    location.href = `/api/export/production-dispatch.xlsx?${productionDocumentParams(selectedOnly).toString()}`;
  }

  function printDispatchSchedule(selectedOnly = false): void {
    setExportMenuOpen(false);
    const popup = window.open(`/api/production/dispatch-print?${productionDocumentParams(selectedOnly).toString()}`, '_blank');
    if (popup) popup.opener = null;
    else setToast('浏览器拦截了打印窗口，请允许本站打开新窗口后重试');
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

  function retryProductionLoad(): void {
    if (productionRequestInFlightRef.current) return;
    productionBoardCache.clear();
    nextAutoRefreshAtRef.current = Date.now() + AUTO_REFRESH_BASE_DELAY_MS;
    setRefreshToken(value => value + 1);
  }

  const weeklyPlanWeekStart = weekStart || summary?.weekStartDate || '';
  const weeklyPlanHref = weeklyPlanWeekStart ? `/weekly-plan-center?week=${encodeURIComponent(weeklyPlanWeekStart)}` : '/weekly-plan-center';
  const customFutureWeek = scope === 'history'
    && Boolean(weekStart)
    && Boolean(summary?.navigation?.current.weekStartDate)
    && weekStart >= (summary?.navigation?.current.weekStartDate || '');
  const weekScopeTitle = scope === 'carryover'
    ? '跨周遗留'
    : scope === 'next'
      ? '下周预览'
      : scope === 'afterNext'
        ? '下下周预览'
        : scope === 'history'
          ? customFutureWeek ? '指定未来周' : '历史周'
          : '当前执行周';
  const lastProductionLoadedTime = lastRefreshedAt?.toLocaleTimeString('zh-CN', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
  const weekScopeRangeText = initialBoardLoading
    ? '生产周数据加载中…'
    : loadError && !board
    ? '生产周数据未加载'
    : !summary?.weekStartDate
    ? '前往周计划中心启用'
    : scope === 'carryover'
      ? `早于 ${dateText(summary.weekStartDate)}`
      : `${dateText(summary.weekStartDate)} - ${dateText(summary.weekEndDate)}`;

  return (
    <main className={`production-page hm-production-workbench hm-workbench-root production-dispatch-density-${density}${initialBoardLoading ? ' production-initial-loading' : ''}`}>
      <AppWorkbenchHeader
        user={user}
        activeHref="/production"
        subtitle="现场排程与工序流转"
        hideHeader
        sidebarTriggerTargetId="production-dispatch-sidebar-trigger"
        sidebarExpanded={navigationOpen}
        onSidebarExpandedChange={handleNavigationExpandedChange}
        moduleModeSwitcher={{ mode: 'mass', drawerId: 'production-mode-drawer', drawerOpen: modeDrawer.open, onToggle: toggleModeDrawer, openFromSidebar: false }}
        menuItems={[
          ...(canConfigureSystem ? [{ label: '系统设置', href: '/dashboard?openSettings=1' }] : []),
          { label: '退出登录', onSelect: () => { void logout(); } },
        ]}
      />

      <div className="production-execution-main">
        <section className="production-dispatch-command" aria-labelledby="production-page-title">
          <div className="production-dispatch-title">
            <span id="production-dispatch-sidebar-trigger" className="production-dispatch-nav-trigger" />
            <div>
              <span>现场生产</span>
              <span className="production-dispatch-heading-line">
                <strong id="production-page-title">生产调度中心</strong>
                <ModuleModeTrigger buttonRef={modeDrawer.triggerRef} open={modeDrawer.open} mode="mass" onClick={toggleModeDrawer} controls="production-mode-drawer" compact />
              </span>
              <small>{todayLabel} · {weekScopeRangeText}</small>
            </div>
          </div>
          <nav className="production-dispatch-week-tabs" aria-label="生产周范围">
            <label className={scope === 'history' ? 'active' : ''}>
              <span>{customFutureWeek ? '指定周' : '历史 / 指定周'}</span>
              <select
                aria-label="选择历史或指定生产周"
                value={scope === 'history' ? weekStart : ''}
                onFocus={() => {
                  if (scope !== 'history') changeWeekScope('history');
                }}
                onChange={event => changeWeekScope('history', event.target.value)}
              >
                <option value="" disabled>选择历史 / 指定周</option>
                {scope === 'history' && weekStart && !(summary?.navigation?.history ?? []).some(item => item.weekStartDate === weekStart) && <option value={weekStart}>{customFutureWeek ? '指定未来周' : '指定周'} · {dateText(summary?.weekStartDate || weekStart)} - {dateText(summary?.weekEndDate || weekStart)}</option>}
                {(summary?.navigation?.history ?? []).map(item => <option key={item.weekStartDate} value={item.weekStartDate}>{dateText(item.weekStartDate)} - {dateText(item.weekEndDate)} · {item.count} 批</option>)}
              </select>
            </label>
            <button
              className={`${scope === 'current' ? 'active ' : ''}production-current-week-tab`.trim()}
              type="button"
              aria-pressed={scope === 'current'}
              title={scope === 'current' && summary?.executionCountBreakdown
                ? `本周计划批次 ${summary.navigation?.current.count ?? '暂不可用'}；本周执行工单 ${summary.executionCountBreakdown.nativeCurrent}；遗留执行 ${summary.executionCountBreakdown.carryover}；半成品续作 ${summary.executionCountBreakdown.wipContinuation}；执行合计 ${summary.executionCountBreakdown.total}`
                : '本周计划批次与生产执行范围'}
              onClick={() => changeWeekScope('current')}
            >
              <span>本周计划 <b>{summary?.navigation?.current?.count ?? '—'}</b></span>
              {scope === 'current' && summary?.executionCountBreakdown
                ? <i
                    aria-label={`本周执行 ${summary.executionCountBreakdown.nativeCurrent}，遗留执行 ${summary.executionCountBreakdown.carryover}，半成品续作 ${summary.executionCountBreakdown.wipContinuation}，合计 ${summary.executionCountBreakdown.total}`}
                    title="本周执行 + 遗留执行 + 半成品续作 = 当前执行合计"
                  >执行{summary.executionCountBreakdown.nativeCurrent}+遗留{summary.executionCountBreakdown.carryover}+半成品{summary.executionCountBreakdown.wipContinuation}={summary.executionCountBreakdown.total}</i>
                : Boolean(displayedCurrentCarryoverCount) && <em>+ 遗留 {displayedCurrentCarryoverCount}</em>}
            </button>
            <button className={scope === 'next' ? 'active' : ''} type="button" aria-pressed={scope === 'next'} onClick={() => changeWeekScope('next')}>下周 <b>{summary?.navigation?.next?.count ?? '—'}</b></button>
            <button className={scope === 'afterNext' ? 'active' : ''} type="button" aria-pressed={scope === 'afterNext'} onClick={() => changeWeekScope('afterNext')}>下下周 <b>{summary?.navigation?.afterNext?.count ?? '—'}</b></button>
          </nav>
          <div className="production-dispatch-command-actions">
            {canSelectProduction && <button
              className="hm-workbench-button production-carryover-trigger"
              type="button"
              aria-haspopup="dialog"
              aria-expanded={olderCarryoverOpen}
              title="从两周前及更早的未完成订单中选择加入本周"
              onClick={() => setOlderCarryoverOpen(true)}
            >
              <AlertTriangle size={15} aria-hidden="true" />更早遗留 <b>{summary?.navigation?.olderCarryoverCount ?? '—'}</b>
            </button>}
            <span className="production-command-secondary" aria-label="生产调度辅助操作">
              {(canAdministerProduction || canScheduleProduction) && <Link className="hm-workbench-button" href={weeklyPlanHref} prefetch={false}><CalendarDays size={15} aria-hidden="true" />周计划</Link>}
              {canScheduleProduction && <button className="hm-workbench-button production-reassignment-trigger" type="button" disabled={board?.readOnly} title="员工请假、临时缺勤时批量重排未完成数量" onClick={openEmployeeExceptionReassignment}><UserRoundCog size={15} aria-hidden="true" />人员异常</button>}
              {canSelectProduction && <button className={`hm-workbench-button ${batchMode ? 'active' : ''}`.trim()} type="button" disabled={board?.readOnly} title={board?.readOnly ? '历史周仅供查看' : ''} onClick={toggleBatchMode}><ListChecks size={15} aria-hidden="true" />{batchMode ? '退出批量' : '批量'}</button>}
            </span>
            {canPrintTravelers && <button ref={exportButtonRef} className={`hm-workbench-button ${exportMenuOpen ? 'active' : ''}`.trim()} type="button" aria-haspopup="menu" aria-expanded={exportMenuOpen} onClick={() => setExportMenuOpen(value => !value)}><Download size={15} aria-hidden="true" />导出/打印<ChevronDown size={13} aria-hidden="true" /></button>}
            {(canAdministerProduction || canScheduleProduction || canSelectProduction) && <button
              ref={commandMenuButtonRef}
              className={`hm-workbench-button production-command-more-trigger ${commandMenuOpen ? 'active' : ''}`.trim()}
              type="button"
              aria-label="更多生产调度操作"
              aria-haspopup="menu"
              aria-expanded={commandMenuOpen}
              onClick={() => setCommandMenuOpen(value => !value)}
            ><MoreHorizontal size={16} aria-hidden="true" /><span>更多</span><ChevronDown size={13} aria-hidden="true" /></button>}
            <button className="hm-workbench-button production-fullscreen-trigger" type="button" onClick={() => void toggleFullscreen()}><Expand size={15} aria-hidden="true" />{isFullscreen ? '退出大屏' : '大屏模式'}</button>
          </div>
        </section>

        <ModuleModeDrawer
          id="production-mode-drawer"
          open={modeDrawer.open}
          moduleLabel="生产执行"
          mode="mass"
          mass={{ href: '/production', title: '量产执行', description: '按工单、工序、人员和数量推进正式生产', count: summary?.total, countLabel: '单' }}
          sample={{ href: '/production?branch=samples', title: '样品执行', description: '扫码填写选填数据、拍摄过程与成品照片' }}
          onClose={modeDrawer.close}
        />

        {scope !== 'carryover' && <WeekReconciliationBar
          className="production-week-reconciliation"
          weekStartDate={summary?.weekStartDate}
          weekEndDate={summary?.weekEndDate}
          checkExecutionEligibility={scope === 'current'}
          refreshSignature={scope === 'current'
            ? [
                summary?.navigation?.current?.count ?? '',
                summary?.executionCountBreakdown?.nativeCurrent ?? '',
                summary?.executionCountBreakdown?.carryover ?? '',
                summary?.executionCountBreakdown?.total ?? '',
              ].join(':')
            : undefined}
        />}

        <section className="production-dispatch-metrics" aria-label="生产调度指标" aria-busy={initialBoardLoading}>
          <button type="button" className={dispatchPreset === 'in_production' ? 'active' : ''} onClick={() => applyDispatchPreset('in_production')}><span><CheckCircle2 size={18} aria-hidden="true" />生产中</span><strong>{summary ? dispatchMetric.inProduction : '—'}</strong><small>已启动首工序 · {weekScopeTitle} {summary?.total ?? '—'} 单</small></button>
          <button type="button" className={dispatchPreset === 'not_started' ? 'active pending' : 'pending'} onClick={() => applyDispatchPreset('not_started')}><span><ListChecks size={18} aria-hidden="true" />待开始</span><strong>{summary ? dispatchMetric.notStarted : '—'}</strong><small>点击查看阻塞或待启动工单</small></button>
          <button type="button" className={dispatchPreset === 'next_process' ? 'active waiting' : 'waiting'} onClick={() => applyDispatchPreset('next_process')}><span><ArrowRight size={18} aria-hidden="true" />有后续工序</span><strong>{summary ? dispatchMetric.withNextProcess : '—'}</strong><small>工艺路线存在下一道工序</small></button>
          <button type="button" className={dispatchPreset === 'due_soon' ? 'active warning' : 'warning'} onClick={() => applyDispatchPreset('due_soon')}><span><Clock3 size={18} aria-hidden="true" />即将超时</span><strong>{summary ? dispatchMetric.dueSoon : '—'}</strong><small>客户交期在未来 0-2 天</small></button>
          <button type="button" className={dispatchPreset === 'completed' ? 'active completed' : 'completed'} onClick={() => applyDispatchPreset('completed')}><span><CheckCircle2 size={18} aria-hidden="true" />已完成</span><strong>{summary ? dispatchMetric.completed : '—'}</strong><small>当前周完成归档</small></button>
          <div className="production-dispatch-metric-rate"><span><BarChart3 size={18} aria-hidden="true" />{scope === 'current' ? '本周动态计划达成率' : '动态计划达成率'}</span><strong>{formatProductionPercentage(dispatchMetric.percentage)}</strong><small>{summary?.wipPlanMetrics ? `有效计划 ${(summary.wipPlanMetrics.effectivePlannedMilliseconds / 3_600_000).toFixed(1)} 小时 · 完成 ${(summary.wipPlanMetrics.completedMilliseconds / 3_600_000).toFixed(1)} 小时 · 仓内未排 ${summary.wipPlanMetrics.unscheduledWipQuantity} 件不计入` : `${scope === 'current' ? '本周完成' : '完成订单'} ${summary?.planTotals.completedOrders ?? '—'} / ${scope === 'current' ? '本周计划' : '总订单'} ${summary?.planTotals.totalOrders ?? '—'}`}</small></div>
        </section>

        <section className="production-dispatch-toolbar" aria-label="生产调度筛选">
          <label className="production-dispatch-search"><Search size={18} aria-hidden="true" /><input value={keyword} onChange={event => { setTargetWorkOrderId(''); setTargetWipAllocationId(''); setKeyword(event.target.value); }} placeholder="搜索客户、型号、工单或品名" /></label>
          <div className="production-dispatch-presets" aria-label="调度视图">
            <button className={dispatchPreset === 'all' ? 'active' : ''} type="button" aria-pressed={dispatchPreset === 'all'} onClick={() => applyDispatchPreset('all')}>全部</button>
            <button className={dispatchPreset === 'today' ? 'active' : ''} type="button" aria-pressed={dispatchPreset === 'today'} onClick={() => applyDispatchPreset('today')}>今日交付</button>
            <button className={dispatchPreset === 'not_started' ? 'active' : ''} type="button" aria-pressed={dispatchPreset === 'not_started'} onClick={() => applyDispatchPreset('not_started')}>待开始</button>
            <button className={dispatchPreset === 'next_process' ? 'active' : ''} type="button" aria-pressed={dispatchPreset === 'next_process'} onClick={() => applyDispatchPreset('next_process')}>有后续工序</button>
            <button className={dispatchPreset === 'due_soon' ? 'active' : ''} type="button" aria-pressed={dispatchPreset === 'due_soon'} onClick={() => applyDispatchPreset('due_soon')}>即将超时</button>
            <button className={dispatchPreset === 'exceptions' ? 'active' : ''} type="button" aria-pressed={dispatchPreset === 'exceptions'} onClick={() => applyDispatchPreset('exceptions')}>异常</button>
            <button className={dispatchPreset === 'paused' ? 'active' : ''} type="button" aria-pressed={dispatchPreset === 'paused'} onClick={() => applyDispatchPreset('paused')}>已暂停 {summary?.dispatchMetrics.paused ?? '—'}</button>
            <button className={dispatchPreset === 'completed' ? 'active' : ''} type="button" aria-pressed={dispatchPreset === 'completed'} onClick={() => applyDispatchPreset('completed')}>已完成</button>
          </div>
          <button ref={filterButtonRef} className={`production-dispatch-filter ${filtersOpen || activeFilterCount ? 'active' : ''}`.trim()} type="button" aria-expanded={filtersOpen} onClick={() => { setDraftAdvanced(cloneAdvanced(advanced)); setFiltersOpen(value => !value); }}>更多筛选{activeFilterCount ? ` ${activeFilterCount}` : ''}</button>
          <PortalMenu open={filtersOpen} anchorRef={filterButtonRef} align="right" className="production-filter-menu hm-production-menu hm-production-filter-menu" width={420} onClose={() => setFiltersOpen(false)} closeOnSelect={false}>
            <AdvancedFilterPanel customers={board?.filterOptions.customers || []} value={draftAdvanced} setValue={setDraftAdvanced} clear={() => setDraftAdvanced(emptyAdvanced)} apply={() => { setAdvanced(cloneAdvanced(draftAdvanced)); setFiltersOpen(false); setPage(1); }} />
          </PortalMenu>
          <button className={`production-auto-refresh ${autoRefresh ? 'active' : ''}`} type="button" aria-pressed={autoRefresh} title="正常每 30 秒刷新；失败后自动退避，最长 5 分钟" onClick={() => setAutoRefresh(value => !value)}><RefreshCw size={15} aria-hidden="true" />自动刷新 <span>30 秒起</span></button>
          {loading
            ? <span className="production-refresh-status loading" aria-live="polite"><Loader2 size={13} aria-hidden="true" />同步中</span>
            : lastRefreshedAt && <span className="production-refresh-status" aria-live="polite">更新 {new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(lastRefreshedAt)}</span>}
          <button ref={insightsButtonRef} className={`hm-workbench-button production-insight-trigger production-toolbar-insight ${insightsOpen ? 'active' : ''}`.trim()} type="button" aria-label={insightsOpen ? '关闭调度侧栏' : '打开调度侧栏'} title={insightsOpen ? '关闭调度侧栏' : '打开调度侧栏'} aria-expanded={insightsOpen} aria-controls="production-insight-panel" onClick={toggleInsights}>{insightsOpen ? <PanelRightClose size={15} aria-hidden="true" /> : <PanelRightOpen size={15} aria-hidden="true" />}<span>侧栏</span></button>
          <div className="production-density-control" aria-label="列表密度">
            <button className={density === 'comfortable' ? 'active' : ''} type="button" aria-label="舒适列表" title="舒适列表" onClick={() => { setDensity('comfortable'); setPage(1); }}><Rows3 size={16} aria-hidden="true" /></button>
            <button className={density === 'compact' ? 'active' : ''} type="button" aria-label="紧凑列表" title="紧凑列表" onClick={() => { setDensity('compact'); setPage(1); }}><ListChecks size={16} aria-hidden="true" /></button>
          </div>
          <span className="production-dispatch-result" aria-label={initialBoardLoading ? '工单数量加载中' : !board ? '工单数量尚未获取' : undefined}>{board ? board.pagination.total : '—'} 项</span>
        </section>
        {!!filterChips.length && <div className="production-filter-chips production-dispatch-filter-chips" aria-label="已应用筛选">{filterChips.map(chip => <button key={chip.key} type="button" onClick={() => { chip.remove(); setPage(1); }} title={`移除${chip.label}`}>{chip.label}<span>×</span></button>)}<button className="clear" type="button" onClick={() => { setTargetWorkOrderId(''); setAdvanced(emptyAdvanced); setQuick([]); setKeyword(''); setPage(1); }}>清空全部</button></div>}
        <section className="production-arrangement-filters" aria-label="生产安排筛选" aria-busy={initialBoardLoading}>
          <span><CalendarDays size={15} aria-hidden="true" />主管安排</span>
          {([
            ['arrangement_unassigned', '未安排', summary?.arrangementMetrics?.unassigned ?? '—'],
            ['arrangement_scheduled', '已安排', summary?.arrangementMetrics?.scheduled ?? '—'],
            ['arrangement_today', '今日安排', summary?.arrangementMetrics?.today ?? '—'],
            ['arrangement_overdue', '逾期未完', summary?.arrangementMetrics?.overdue ?? '—'],
            ['arrangement_partial', '部分完成', summary?.arrangementMetrics?.partial ?? '—'],
          ] as Array<[QuickFilter, string, number | string]>).map(([key, label, count]) => <button className={`${quick.includes(key) ? 'active' : ''} ${key.includes('overdue') ? 'danger' : key.includes('partial') ? 'warning' : ''}`.trim()} type="button" aria-pressed={quick.includes(key)} key={key} onClick={() => toggleArrangementQuickFilter(key)}>{label}<b>{count}</b></button>)}
        </section>

        {loadError && <div className="production-error" role="alert"><span><strong>{board ? '未获取到最新数据' : '数据加载失败'}</strong>{board ? `当前保留 ${lastProductionLoadedTime || '上次'} 成功加载的内容：${loadError}` : `尚未获取到生产执行数据：${loadError}`}</span><button type="button" disabled={loading} onClick={retryProductionLoad}>{loading ? '加载中' : '重新加载'}</button></div>}
        {scope === 'current' && summary?.total === 0 && !loading && <div className="production-empty-week"><strong>本周暂无已启用生产工单</strong><span>历史遗留工单可从“跨周遗留”继续处理；新计划请在计划中心下达。</span><Link href={weeklyPlanHref} prefetch={false}>进入计划中心</Link></div>}

        <div className={`production-dispatch-layout ${insightsOpen ? 'rail-open' : ''}`.trim()}>
          <section className="production-dispatch-list-panel" aria-label="生产工单调度列表">
            <header className="production-dispatch-list-head">
              <span>序号</span><span>产品信息</span><span>工序进度</span><span>生产日期</span><span>安排人员</span><span>工时完成进度</span><span>交期 / 风险</span><span>备注</span><span>现场操作</span>
            </header>
            <div ref={boardShellRef} className="production-dispatch-list hm-scroll-region" tabIndex={0} aria-label={initialBoardLoading ? '生产工单列表，正在加载' : board ? `生产工单列表，共 ${board.pagination.total} 项` : '生产工单列表，数据加载失败'}>
              {dispatchItems.map((item, rowIndex) => <ProductionDispatchRow
                key={item.order.executionKey}
                item={item}
                rowNumber={rowIndex + 1}
                canManageControl={canManageProductionControl(user)}
                canAdjustDates={canAdjustProductionDates(user)}
                readOnly={board?.readOnly || (scope === 'history' && item.order.stage === 'completed')}
                canAdministerProduction={canAdministerProduction}
                canManageWip={canManageWip}
                canSelectProduction={canSelectProduction}
                canScheduleProduction={canScheduleProduction}
                batchMode={batchMode}
                selected={selected}
                saving={saving}
                highlighted={Boolean(targetWipAllocationId && item.order.wipContinuation?.allocationId === targetWipAllocationId)}
                toggleSelected={toggleSelected}
                openDetail={openDetail}
                openNextStep={openNextStep}
                openDrawingLibrary={openDrawingLibrary}
                openWorkflow={openWorkflow}
                openIssue={openProductionIssue}
                copySpecification={copySpecification}
                openArrangement={(order, sourceArrangement) => openProductionArrangement([order], sourceArrangement)}
                openReassignment={openProductionReassignment}
              />)}
              {loading && !board && <DispatchRowSkeleton count={dispatchPageSize} />}
              {!loading && board && !board.items.length && <div className="production-dispatch-empty"><Rows3 size={28} aria-hidden="true" /><strong>当前没有匹配工单</strong><span>调整周范围或筛选条件后重试。</span></div>}
              {!loading && dispatchAllItems.length > 0 && <div ref={dispatchLoadMoreRef} className={`production-dispatch-load-more ${dispatchHasMore ? 'loading' : 'complete'}`} aria-live="polite">
                {dispatchHasMore
                  ? <><Loader2 size={14} aria-hidden="true" /><span>正在加载更多</span></>
                  : <><CheckCircle2 size={14} aria-hidden="true" /><span>无更多数据 · 共 {dispatchAllItems.length} 单</span></>}
              </div>}
            </div>
          </section>

          {insightsOpen && <button className="production-dispatch-scrim" type="button" aria-label="关闭调度侧栏" onClick={closeInsights} />}
          <aside ref={insightsPanelRef} id="production-insight-panel" className={`production-dispatch-rail ${insightsOpen ? 'open' : ''}`} aria-label="生产调度侧栏" aria-hidden={!insightsOpen} aria-busy={initialBoardLoading} tabIndex={-1}>
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

      {canSelectProduction && batchMode && !board?.readOnly && <div className="production-batch-bar"><strong>已选 {selected.length} 单</strong>{canScheduleProduction && <button className="primary" type="button" disabled={!selected.length} onClick={() => openProductionArrangement((board?.items || []).filter(order => selected.includes(order.id)))}><CalendarDays size={15} />批量安排日期与人员</button>}{canPrintTravelers && <button type="button" disabled={!selected.length} onClick={() => printTravelers(selected)}><Printer size={15} />打印流转单 / SOP</button>}{canAdministerProduction && <button type="button" disabled={!selected.length} onClick={() => openBatch('set_priority')}>设置优先级</button>}{canAdministerProduction && <button type="button" disabled={!selected.length} onClick={() => openBatch('add_remark')}>添加进度备注</button>}<button type="button" onClick={() => setSelected([])}>清空选择</button><button type="button" onClick={toggleBatchMode}>退出批量</button></div>}

      <PortalMenu open={commandMenuOpen} anchorRef={commandMenuButtonRef} align="right" className="production-command-menu hm-production-menu" width={230} onClose={() => setCommandMenuOpen(false)}>
        {(canAdministerProduction || canScheduleProduction) && <Link role="menuitem" href={weeklyPlanHref} prefetch={false}><CalendarDays size={16} aria-hidden="true" /><span><b>周计划</b><small>打开当前生产周计划</small></span></Link>}
        {canScheduleProduction && <button role="menuitem" type="button" disabled={board?.readOnly} onClick={openEmployeeExceptionReassignment}><UserRoundCog size={16} aria-hidden="true" /><span><b>人员异常</b><small>批量重排未完成数量</small></span></button>}
        {canSelectProduction && <button role="menuitem" type="button" disabled={board?.readOnly} onClick={toggleBatchMode}><ListChecks size={16} aria-hidden="true" /><span><b>{batchMode ? '退出批量' : '批量操作'}</b><small>{board?.readOnly ? '历史周仅供查看' : '勾选工单后批量处理'}</small></span></button>}
      </PortalMenu>

      <PortalMenu open={canPrintTravelers && exportMenuOpen} anchorRef={exportButtonRef} align="right" className="production-export-menu hm-production-menu" width={250} onClose={() => setExportMenuOpen(false)} closeOnSelect={false}>
        <span className="production-export-menu-label">当前筛选范围</span>
        <button type="button" onClick={() => exportDispatchWorkbook(false)}><Download size={15} aria-hidden="true" /><span><b>导出 Excel 排班明细</b><small>含日期、工序、员工与剩余量</small></span></button>
        <button type="button" onClick={() => printDispatchSchedule(false)}><Printer size={15} aria-hidden="true" /><span><b>打印 A4 调度排班表</b><small>横向布局，带现场签字栏</small></span></button>
        <span className="production-export-menu-label">已选工单</span>
        <button type="button" disabled={!selected.length} onClick={() => exportDispatchWorkbook(true)}><Download size={15} aria-hidden="true" /><span><b>仅导出已选 {selected.length} 单</b><small>需先进入批量模式勾选工单</small></span></button>
        <button type="button" disabled={!selected.length} onClick={() => printDispatchSchedule(true)}><Printer size={15} aria-hidden="true" /><span><b>仅打印已选 {selected.length} 单</b><small>适合班前会或现场派工</small></span></button>
      </PortalMenu>

      <PortalMenu open={canAdministerProduction && !!statusMenuOrder} anchorRef={statusButtonRef} className="production-status-menu hm-production-menu hm-production-status-menu" width={164} onClose={() => setStatusMenuOrder(null)} closeOnSelect={false}>
        {statusMenuOrder && stageMenuItems(statusMenuOrder).map(stage => <button type="button" disabled={saving} key={stage.key} onClick={() => requestStageChange(statusMenuOrder, stage.key)}>{stage.label}</button>)}
      </PortalMenu>

      <PortalMenu open={canAdministerProduction && !!drawingMenuOrder} anchorRef={drawingButtonRef} className="production-status-menu hm-production-menu hm-production-status-menu" width={184} onClose={() => setDrawingMenuOrder(null)} closeOnSelect={false}>
        {drawingMenuOrder && drawingStatuses.map(status => <button className={drawingMenuOrder.drawingStatus === status ? 'active' : ''} type="button" disabled={saving} key={status} onClick={() => void saveDrawingStatus(drawingMenuOrder, status)}>{status}</button>)}
      </PortalMenu>

      {detailOrder && <DetailDialog order={detailOrder} tab={detailTab} setTab={switchDetailTab} progressLogs={progressLogs} progressLoading={progressLoading} close={() => setDetailOrder(null)} resources={() => openWorkOrderResources(detailOrder)} drawingLibrary={() => openDrawingLibrary(detailOrder, detailOrder.stage)} canPrintTraveler={canPrintTravelers} travelerPrinting={false} printTraveler={() => printTravelers([detailOrder.id])} canViewQualityRisks={canViewQualityRisks} canManageQualityRisks={canManageQualityRisks} canAcknowledgeQualityRisks={canAcknowledgeQualityRisks} userId={user.id} />}
      <OlderCarryoverDrawer
        open={olderCarryoverOpen}
        targetWeekStart={summary?.navigation?.current?.weekStartDate || ''}
        onClose={() => setOlderCarryoverOpen(false)}
        onIncluded={count => {
          setToast(`已将 ${count} 个更早遗留订单加入本周，原订单和资料保持不变`);
          changeWeekScope('current');
          setRefreshToken(value => value + 1);
          setSummaryRefreshToken(value => value + 1);
        }}
      />
      <TravelerPrintDialog open={travelerPrintIds.length > 0} workOrderIds={travelerPrintIds} onClose={() => setTravelerPrintIds([])} onSuccess={message => { setToast(message); setSelected([]); }} />
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
      {canScheduleProduction && arrangementRequest && <ProductionArrangementDialog
        request={arrangementRequest}
        context={arrangementContext}
        value={arrangementForm}
        setValue={setArrangementForm}
        search={arrangementSearch}
        setSearch={setArrangementSearch}
        loading={arrangementLoading}
        saving={arrangementSaving}
        error={arrangementError}
        close={() => closeProductionArrangement()}
        save={() => void saveProductionArrangement()}
      />}
      {canScheduleProduction && reassignmentRequest && <ProductionReassignmentDialog
        request={reassignmentRequest}
        sourceEmployees={scheduledEmployeeOptions(board?.items || [])}
        context={reassignmentContext}
        value={reassignmentForm}
        setValue={setReassignmentForm}
        search={reassignmentSearch}
        setSearch={setReassignmentSearch}
        loading={reassignmentLoading}
        saving={reassignmentSaving}
        error={reassignmentError}
        close={() => closeProductionReassignment()}
        save={() => void saveProductionReassignment()}
      />}
      {completionOrder && <ProcessCompletionDialog
        order={completionOrder}
        activeSteps={completionOrder.wipContinuation
          ? (completionOrder.processRoute?.steps || []).filter(step => (
              completionOrder.wipContinuation?.steps.some(item => item.stepId === step.id)
            ))
          : completionOrder.processRoute?.steps || []}
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
  rowNumber: number;
  canManageControl: boolean;
  canAdjustDates: boolean;
  item: ProductionCardView;
  readOnly: boolean;
  canAdministerProduction: boolean;
  canManageWip: boolean;
  canSelectProduction: boolean;
  canScheduleProduction: boolean;
  batchMode: boolean;
  selected: string[];
  saving: boolean;
  highlighted: boolean;
  toggleSelected: (id: string) => void;
  openDetail: (order: ProductionOrder, tab?: DetailTab) => void;
  openNextStep: (order: ProductionOrder, displayStage: StageKey) => void;
  openDrawingLibrary: (order: ProductionOrder, focusedStage?: StageKey) => void;
  openWorkflow: (order: ProductionOrder, focusedStage?: StageKey) => void;
  openIssue: (order: ProductionOrder, alertCode: string, focusedStage?: StageKey) => void;
  copySpecification: (order: ProductionOrder) => Promise<void>;
  openArrangement: (order: ProductionOrder, sourceArrangement?: ProductionArrangement) => void;
  openReassignment: (order: ProductionOrder, arrangement: ProductionArrangement) => void;
};

function DispatchRowSkeleton({ count }: { count: number }) {
  return <>{Array.from({ length: count }, (_, index) => <div className="production-dispatch-row production-dispatch-row-skeleton" aria-hidden="true" key={index}>
    <span /><span /><span /><span /><span /><span /><span />
  </div>)}</>;
}

function scheduledEmployeeOptions(orders: ProductionOrder[]): Array<{ employeeId: string; employeeNo: string; name: string; affectedOrderCount: number }> {
  const employees = new Map<string, { employeeId: string; employeeNo: string; name: string; workOrderIds: Set<string> }>();
  for (const order of orders) {
    for (const arrangement of order.arrangements || []) {
      if (arrangement.remainingQty <= 0 || arrangement.status === 'completed' || arrangement.status === 'carried_over') continue;
      for (const employee of arrangement.employees) {
        const current = employees.get(employee.employeeId) || {
          employeeId: employee.employeeId,
          employeeNo: employee.employeeNo,
          name: employee.name,
          workOrderIds: new Set<string>(),
        };
        current.workOrderIds.add(order.id);
        employees.set(employee.employeeId, current);
      }
    }
  }
  return [...employees.values()]
    .map(employee => ({ ...employee, affectedOrderCount: employee.workOrderIds.size }))
    .sort((left, right) => right.affectedOrderCount - left.affectedOrderCount || left.employeeNo.localeCompare(right.employeeNo, 'zh-CN'));
}

function ProductionDispatchRow({
  rowNumber, canManageControl, canAdjustDates,
  item,
  readOnly,
  canAdministerProduction,
  canManageWip,
  canSelectProduction,
  canScheduleProduction,
  batchMode,
  selected,
  saving,
  highlighted,
  toggleSelected,
  openDetail,
  openNextStep,
  openDrawingLibrary,
  openWorkflow,
  openIssue,
  copySpecification,
  openArrangement,
  openReassignment,
}: ProductionDispatchRowProps) {
  const { order, displayStage } = item;
  const route = order.processRoute;
  const wipContinuation = order.wipContinuation || null;
  const isWipContinuation = Boolean(wipContinuation);
  const movedOutContinuation = !isWipContinuation ? order.wipMovedOutContinuations?.[0] || null : null;
  const isMovedOutSource = Boolean(movedOutContinuation);
  const wipRemainingSteps = wipContinuation?.steps.filter(step => step.remainingQty > 0) || [];
  const wipTargetStartsInFuture = Boolean(
    wipContinuation && todayShanghaiDateKey() < wipContinuation.targetWeekStartDate,
  );
  const targetQuantity = dispatchTargetQuantity(order);
  const laborProgress = order.standardLaborProgress;
  const laborPercentage = laborProgress.percentage;
  const progressPercentage = Math.max(0, Math.min(laborPercentage ?? 0, 100));
  const completedLaborText = formatProcessDuration(Number(laborProgress.completedStandardMilliseconds));
  const totalLaborText = formatProcessDuration(Number(laborProgress.totalStandardMilliseconds));
  const remainingLaborText = formatProcessDuration(Number(laborProgress.remainingStandardMilliseconds));
  const laborWarning = laborProgress.stepCount === 0
    ? '工艺路线待建立'
    : laborProgress.targetQuantityMissing
      ? '计划数量待补充'
      : laborProgress.missingStandardStepCount > 0
        ? `${laborProgress.missingStandardStepCount} 道工序缺标准工时`
        : laborProgress.pendingCompletionStandardCount > 0
          ? `${laborProgress.pendingCompletionStandardCount} 笔报工待补标准工时`
          : '';
  const risk = dispatchRisk(order);
  const selectedRow = selected.includes(order.id);
  const lifecycle = resolveProductionLifecycle({
    routeCompleted: route?.status === 'completed',
    workOrderCompletedAt: order.completedAt,
  });
  const currentProcess = wipRemainingSteps[0]?.processName
    || (lifecycle.awaitingBranchClosure ? '主路线完成' : currentProcessName(order));
  const nextProcess = wipRemainingSteps[1]?.processName || (isWipContinuation ? '完成续作' : nextProcessName(order));
  const upcomingSteps = isWipContinuation ? wipRemainingSteps.slice(1) : nextRouteSteps(order);
  const routeProgress = isWipContinuation ? laborPercentage ?? 0 : route?.progress ?? 0;
  const continuationStepById = new Map(wipContinuation?.steps.map(step => [step.stepId, step] as const) || []);
  const firstRemainingStepId = wipRemainingSteps[0]?.stepId;
  const routeSteps = isWipContinuation && route
    ? route.steps
        .filter(step => continuationStepById.has(step.id))
        .map(step => ({
          ...step,
          status: (continuationStepById.get(step.id)?.remainingQty || 0) <= 0
            ? 'completed' as const
            : step.id === firstRemainingStepId
              ? 'current' as const
              : 'pending' as const,
        }))
    : route?.steps || [];
  const activeRouteIndex = routeSteps.findIndex(step => step.status === 'current');
  const routePreviewStart = Math.max(0, Math.min(activeRouteIndex > 0 ? activeRouteIndex - 1 : 0, Math.max(0, routeSteps.length - 4)));
  const routePreview = routeSteps.slice(routePreviewStart, routePreviewStart + 4);
  const arrangements = [...(order.arrangements || [])].sort((left, right) => right.workDate.localeCompare(left.workDate) || right.id.localeCompare(left.id));
  const visibleArrangements = arrangements.slice(0, 2);
  const activeArrangements = arrangements.filter(arrangement => arrangement.status !== 'completed' && arrangement.status !== 'carried_over');
  const continuableArrangement = arrangements.find(arrangement => arrangement.continuable);
  const canCreateArrangement = !isWipContinuation && !isMovedOutSource && !order.productionControl?.pausedAt && !readOnly && canScheduleProduction && displayStage !== 'completed'
    && (Boolean(continuableArrangement) || activeArrangements.length === 0);
  const unitLabel = route?.currentStep?.unitLabel || route?.steps[0]?.unitLabel || '件';
  const routeReadiness = processRouteExecutionReadiness(route?.steps || []);
  const routeNeedsMaintenance = !route || route.status === 'draft' || !routeReadiness.ready;
  const primaryText = wipTargetStartsInFuture && wipContinuation
    ? `${wipContinuation.targetWeekStartDate.slice(5)} 起可报工`
    : readOnly
    ? '查看记录'
    : lifecycle.aggregateCompleted
      ? '查看记录'
      : lifecycle.awaitingBranchClosure
        ? '查看分支'
        : routeNeedsMaintenance
          ? canAdministerProduction ? '配置工序与工时' : '查看记录'
          : route?.status === 'confirmed'
            ? '开始生产'
            : '下一步';

  function runPrimaryAction(): void {
    const action = resolveProductionPrimaryAction({
      readOnly,
      aggregateCompleted: lifecycle.aggregateCompleted,
      awaitingBranchClosure: lifecycle.awaitingBranchClosure,
      canAdministerProduction,
      routeNeedsMaintenance,
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

  return <article className={`production-dispatch-row stage-${displayStage} risk-${risk.tone} ${order.carryover ? 'is-carryover' : ''} ${isWipContinuation ? 'is-wip-continuation' : ''} ${highlighted ? 'is-deep-link-target' : ''} ${selectedRow ? 'selected' : ''}`.trim()} data-production-order-id={order.id} data-wip-allocation-id={wipContinuation?.allocationId || undefined} data-production-stage={displayStage} tabIndex={highlighted ? -1 : undefined}>
    <div className="production-list-sequence">{rowNumber}</div>
    <div className="production-dispatch-row-identity">
      <div className="production-dispatch-row-select">
        {canSelectProduction && batchMode && !readOnly && !isWipContinuation
          ? <input type="checkbox" checked={selectedRow} aria-label={`选择 ${specText(order)}`} onChange={() => toggleSelected(order.id)} />
          : <span className="production-dispatch-stage-dot" aria-hidden="true" />}
      </div>
      <div className="production-dispatch-product">
        <span><b title={order.customerName || '客户待补充'}>{order.customerName || '客户待补充'}</b>{order.carryover && <em className="carryover-badge" title={`原生产周 ${order.carryover.originalWeekStartDate}，订单与资料未复制`}>{order.carryover.inclusionType === 'MANUAL_OLDER_WEEK' ? '更早遗留' : '上周遗留'}</em>}{isWipContinuation && <em className="wip-continuation-badge" title={`半成品批次 ${wipContinuation?.lotNo}，仅显示目标周剩余工序和工时`}>半成品续作</em>}{isMovedOutSource && <em className="wip-continuation-badge moved-out" title="本周保留已报工事实，未完成工序已转到新的目标周">剩余已转出</em>}{order.branchType ? <em className="branch">{branchTypeText(order.branchType)}</em> : <em className={order.priority}>{priorityText(order.priority)}</em>}</span>
        <button type="button" title={`${specText(order)}；进入图纸资料库`} onClick={() => openDrawingLibrary(order, displayStage)}>{specText(order)}</button>
        <small title={`${order.productName || '品名待补充'}${order.businessCode ? ` · ${order.businessCode}` : ''}`}>{order.productName || '品名待补充'}{order.businessCode ? ` · ${order.businessCode}` : ''}</small>
        {wipContinuation && <span className="production-wip-continuation-meta">{wipContinuation.lotNo} · 来源周 {wipContinuation.sourceWeekStartDate.slice(5)} → 目标周 {wipContinuation.targetWeekStartDate.slice(5)} · 剩余 {wipContinuation.remainingQty.toLocaleString()} 件</span>}
        {movedOutContinuation && <span className="production-wip-continuation-meta moved-out">本周只保留已报工事实 · 剩余任务在 {movedOutContinuation.targetWeekStartDate.slice(5)} 周</span>}
        {(order.planReleaseState === 'preparation' || order.sopStage === 'validating' || !order.documentCategoryCodes.includes('sop')) && <span className="production-dispatch-readiness-badges">
          {order.planReleaseState === 'preparation' && <em className="preparation" title="本周计划已形成工单，但尚未激活；不影响在生产执行中查看和安排">本周预备</em>}
          {order.sopStage === 'validating' && <em className="sop-validating" title={order.sopRemark || 'SOP 正在验证；状态仅提示，不阻断开工和报工'}>SOP验证中</em>}
          {!order.documentCategoryCodes.includes('sop') && <em className="sop-missing" title="尚未上传有效 SOP；订单仍显示在生产执行，现场需关注资料补充">SOP待补</em>}
        </span>}
        <div className="production-dispatch-product-quantity"><span>数量</span><b>{targetQuantity > 0 ? formatProductionQuantity(targetQuantity) : '待补充'} {unitLabel}</b></div>
      </div>
      <div className="production-dispatch-row-icon-actions">
        <button type="button" aria-label={`复制 ${specText(order)} 规格`} title="复制完整规格" onClick={() => void copySpecification(order)}><Copy size={14} aria-hidden="true" /></button>
        <button type="button" aria-label={`查看 ${specText(order)} 详情`} title="查看工单详情" onClick={() => openDetail(order)}><Info size={14} aria-hidden="true" /></button>
      </div>
    </div>

    <button className="production-dispatch-process-flow" type="button" title="进入流程中心查看完整工序进度" onClick={() => openWorkflow(order, displayStage)}>
      <span className="production-dispatch-process-flow-head">
        <span><b>{routeNeedsMaintenance ? '工序待维护' : currentProcess}</b><small>{isWipContinuation ? '执行半成品剩余工序' : lifecycle.awaitingBranchClosure ? '等待返工/补产分支闭环' : route?.statusText || order.stageText}</small></span>
        <em>{isWipContinuation ? `${wipContinuation?.steps.filter(step => step.remainingQty <= 0).length || 0}/${wipContinuation?.steps.length || 0}` : route ? `${route.completedStepCount}/${route.stepCount}` : '未建路线'}</em>
        <span className="production-dispatch-process-next"><ArrowRight size={13} aria-hidden="true" /><b>{nextProcess}</b><small>{upcomingSteps.length ? `${upcomingSteps.length} 道待衔接` : lifecycle.aggregateCompleted ? '生产已结束' : routeNeedsMaintenance ? '等待发布' : '末道工序'}</small></span>
      </span>
      <i className="production-dispatch-process-flow-bar"><span style={{ width: `${routeProgress}%` }} /></i>
      <span className="production-dispatch-route-track" aria-label={routePreview.length ? `工艺路线：${routePreview.map(step => step.processName).join('、')}` : '工艺路线待维护'}>
        {routePreview.length
          ? routePreview.map(step => <i className={`state-${step.status}`} title={`${step.processName} · ${step.status === 'completed' ? '已完成' : step.status === 'current' ? '当前工序' : '待处理'}${step.changeTag === 'TIME_CHANGED' ? ' · 工时已变更' : step.changeTag && step.changeTag !== 'NONE' ? ' · 新增工序' : ''}${(step.systemCoveredQty || 0) > 0 ? ` · 系统历史承接 ${step.systemCoveredQty}，不记人员报工` : ''}`} key={step.id}><span /><em>{step.processName}{step.changeTag && step.changeTag !== 'NONE' && <b className="production-route-new-badge">{step.changeTag === 'TIME_CHANGED' ? '工时 NEW' : 'NEW'}</b>}{(step.systemCoveredQty || 0) > 0 && <b className="production-route-coverage-badge">承接 {step.systemCoveredQty}</b>}</em></i>)
          : <i className="state-pending"><span /><em>待维护</em></i>}
      </span>
    </button>

    <div className="production-arrangement-date-cell">
      {visibleArrangements.map(arrangement => <div className={`production-arrangement-record status-${arrangement.status}`} key={arrangement.id}>
        <span><b>{compactDateText(arrangement.workDate)}</b>{arrangement.crossWeek && <em>跨周</em>}</span>
        <small>{arrangementStatusText[arrangement.status]} · {arrangement.completedTaskCount}/{arrangement.totalTaskCount} 工序</small>
      </div>)}
      {!visibleArrangements.length && <span className="production-arrangement-empty">{isWipContinuation ? `${wipContinuation?.targetWeekStartDate.slice(5)} 周续作` : '未安排'}</span>}
      {arrangements.length > visibleArrangements.length && <small className="production-arrangement-history">另有 {arrangements.length - visibleArrangements.length} 条历史</small>}
      {canCreateArrangement && <button className="production-arrangement-add" type="button" onClick={() => openArrangement(order, continuableArrangement)}><Plus size={13} aria-hidden="true" />{continuableArrangement ? '续排' : '安排'}</button>}
    </div>

    <div className="production-arrangement-worker-cell">
      {visibleArrangements.map(arrangement => {
        const adjustable = !order.productionControl?.pausedAt && !readOnly && canScheduleProduction && arrangement.remainingQty > 0 && arrangement.status !== 'completed' && arrangement.status !== 'carried_over';
        return <button className={`production-arrangement-worker-record status-${arrangement.status} ${adjustable ? 'adjustable' : ''}`.trim()} type="button" disabled={!adjustable} title={adjustable ? '点击调整未完成数量的作业人员' : '已完成或历史安排仅供查看'} onClick={() => openReassignment(order, arrangement)} key={arrangement.id}>
        <span>{arrangement.employees.slice(0, 3).map(employee => <b title={`${employee.employeeNo} · ${employee.name}`} key={employee.employeeId}>{employee.name}</b>)}{arrangement.employees.length > 3 && <em>+{arrangement.employees.length - 3}</em>}</span>
        <small>{arrangement.shiftCode === 'NIGHT' ? '夜班' : '白班'}{arrangement.remainingQty > 0 ? ` · 余 ${formatProductionQuantity(arrangement.remainingQty)}` : ' · 已完成'}{adjustable && <Pencil size={11} aria-hidden="true" />}</small>
      </button>;})}
      {!visibleArrangements.length && <span className="production-arrangement-empty">{isWipContinuation ? wipContinuation?.team?.name || '班组待安排' : '待主管安排'}</span>}
    </div>

    <div className={`production-dispatch-progress ${laborWarning ? 'incomplete' : ''}`.trim()} title={laborWarning || `总标准工时 ${totalLaborText}`}>
      <span><b>{laborPercentage === null ? '待维护' : formatProductionPercentage(laborPercentage)}</b><small>已完成 {completedLaborText}</small></span>
      <i><span style={{ width: `${progressPercentage}%` }} /></i>
      <em className="production-dispatch-progress-summary">
        <span>剩余 {remainingLaborText}</span>
        <span>总计 {totalLaborText}</span>
      </em>
      {laborWarning && <small className="production-dispatch-progress-warning">{laborWarning}</small>}
    </div>

    <div className={`production-dispatch-risk ${risk.tone}`}>
      <strong>客户 {deliveryText(order) || '待确认'}</strong><small>预计 {order.productionControl?.estimatedCompletionDate || '未设置'}</small>
      {!!order.productionControl?.adjustmentCount && <small>已调整 {order.productionControl.adjustmentCount} 次</small>}
      {canAdjustDates && !readOnly && !isWipContinuation && !isMovedOutSource && displayStage !== 'completed' && <ProductionControlButton workOrderId={order.id} mode="adjust_date">调整</ProductionControlButton>}
      {risk.quality
        ? <button type="button" title="查看该工单质量问题预警" onClick={() => openDetail(order, 'quality')}>{risk.label}</button>
        : risk.alert
        ? <button type="button" title="进入问题管理处理该异常" onClick={() => openIssue(order, risk.alert!.code, displayStage)}>{risk.label}</button>
        : <span>{risk.label}</span>}
      <small>{risk.detail}</small>
    </div>

    <div className="production-dispatch-note"><ProductionControlButton workOrderId={order.id} mode="note" className="production-note-button"><ProductionNoteSummary control={order.productionControl} /></ProductionControlButton></div>
    <div className="production-dispatch-row-actions">
      <>{order.productionControl?.pausedAt
        ? <ProductionControlButton workOrderId={order.id} mode={canManageControl && !readOnly ? "resume" : "history"} className="primary">{canManageControl && !readOnly ? "恢复生产" : "查看暂停"}</ProductionControlButton>
        : isMovedOutSource && movedOutContinuation
          ? <Link className="primary" href={`/production?scope=history&weekStart=${encodeURIComponent(movedOutContinuation.targetWeekStartDate)}&weekEnd=${encodeURIComponent(movedOutContinuation.targetWeekEndDate)}&workOrderId=${encodeURIComponent(order.id)}&wipAllocationId=${encodeURIComponent(movedOutContinuation.allocationId)}`}>查看续作</Link>
          : <button
              className="primary"
              type="button"
              disabled={saving || wipTargetStartsInFuture}
              title={wipTargetStartsInFuture ? '半成品续作已进入目标周计划，目标周开始后可扫码或在此报工' : undefined}
              onClick={runPrimaryAction}
            >{primaryText}</button>}
      {canManageWip && !readOnly && !isWipContinuation && !isMovedOutSource && displayStage !== "completed" && order.productionPlanBatchId && order.processRoute
        && <Link
          className="production-wip-transfer-action"
          href={`/workspace/wip?batchId=${encodeURIComponent(order.productionPlanBatchId)}`}
          prefetch={false}
          title="进入半成品仓预检；确认剩余数量和原因后才会正式转入"
        >转入半成品仓</Link>}
      {canManageControl && !readOnly && !isWipContinuation && !isMovedOutSource && !order.productionControl?.pausedAt && displayStage !== "completed" && <ProductionControlButton workOrderId={order.id} mode="pause">暂停生产</ProductionControlButton>}</>
    </div>
  </article>;
}

function ProductionArrangementDialog({ request, context, value, setValue, search, setSearch, loading, saving, error, close, save }: {
  request: ProductionArrangementRequest;
  context: ProductionArrangementContext | null;
  value: ProductionArrangementForm;
  setValue: (value: ProductionArrangementForm) => void;
  search: string;
  setSearch: (value: string) => void;
  loading: boolean;
  saving: boolean;
  error: string;
  close: () => void;
  save: () => void;
}) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const closeRef = useRef(close);
  const savingRef = useRef(saving);
  closeRef.current = close;
  savingRef.current = saving;
  const normalizedSearch = search.trim().toLocaleLowerCase('zh-CN');
  const recommendedIds = new Set(context?.recommendedEmployeeIds || []);
  const employees = [...(context?.employeeCapacity || [])]
    .filter(employee => !normalizedSearch
      || `${employee.employeeNo} ${employee.employeeName} ${employee.position || ''}`.toLocaleLowerCase('zh-CN').includes(normalizedSearch))
    .sort((left, right) => Number(recommendedIds.has(right.employeeId)) - Number(recommendedIds.has(left.employeeId))
      || durationHours(right.remainingMilliseconds) - durationHours(left.remainingMilliseconds)
      || left.employeeNo.localeCompare(right.employeeNo, 'zh-CN'));
  const sourceEstimatedMilliseconds = request.sourceArrangement?.employees.reduce(
    (sum, employee) => sum + durationHours(employee.plannedStandardMilliseconds) * 3_600_000,
    0,
  ) || 0;
  const estimatedHours = durationHours(context?.summary.estimatedStandardMilliseconds || sourceEstimatedMilliseconds);
  const selectedCapacity = (context?.employeeCapacity || []).filter(employee => value.employeeIds.includes(employee.employeeId));
  const perPersonHours = value.employeeIds.length ? estimatedHours / value.employeeIds.length : estimatedHours;
  const overloadEmployees = selectedCapacity.filter(employee => durationHours(employee.remainingMilliseconds) + 0.001 < perPersonHours);
  const leaveEmployees = selectedCapacity.filter(employee => durationHours(employee.leaveMilliseconds) > 0 || employee.attendanceStatus === 'LEAVE');
  const crossWeekCount = context?.candidates.filter(candidate => value.workDate < candidate.batchWeekStartDate || value.workDate > candidate.batchWeekEndDate).length || 0;
  const processNames = [...new Set((context?.candidates || []).map(candidate => candidate.processName))];
  const blockedMessages = [...new Set((context?.blocked || []).map(item => item.message).filter(Boolean))];

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = 'hidden';
    const frame = window.requestAnimationFrame(() => dialogRef.current?.focus());
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !savingRef.current) {
        event.preventDefault();
        closeRef.current();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
      previousFocus?.focus({ preventScroll: true });
    };
  }, []);

  function toggleEmployee(employeeId: string): void {
    setValue({
      ...value,
      employeeIds: value.employeeIds.includes(employeeId)
        ? value.employeeIds.filter(id => id !== employeeId)
        : [...value.employeeIds, employeeId],
    });
  }

  return <div className="production-arrangement-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !saving) close(); }}>
    <section ref={dialogRef} className="production-arrangement-dialog" role="dialog" aria-modal="true" aria-labelledby="production-arrangement-title" tabIndex={-1}>
      <header>
        <div><span>主管排产 · {request.mode === 'continue' ? '保留历史续排' : request.orders.length > 1 ? '批量前置安排' : '前置安排'}</span><h2 id="production-arrangement-title">{request.mode === 'continue' ? '续排生产日期与人员' : `安排生产日期与人员${request.orders.length > 1 ? `（${request.orders.length} 单）` : ''}`}</h2><p>{request.orders.length === 1 ? `${specText(request.orders[0])} · ${request.orders[0].productName}` : `已选择 ${request.orders.length} 个生产工单，保存后同步到日计划与报工人员推荐。`}</p></div>
        <button type="button" aria-label="关闭生产安排" disabled={saving} onClick={close}><X size={20} aria-hidden="true" /></button>
      </header>

      <div className="production-arrangement-dialog-body">
        <section className="production-arrangement-config">
          <div className="production-arrangement-fields">
            <label><span>生产日期</span><input type="date" value={value.workDate} min={request.mode === 'continue' && request.sourceArrangement ? addDateKeyDays(request.sourceArrangement.workDate, 1) : undefined} onChange={event => setValue({ ...value, workDate: event.target.value })} /></label>
            <label><span>班次</span><select value={value.shiftCode} onChange={event => setValue({ ...value, shiftCode: event.target.value })}><option value="DAY">白班</option><option value="NIGHT">夜班</option></select></label>
          </div>

          {request.mode === 'schedule' && <label className="production-arrangement-scope-toggle"><input type="checkbox" checked={value.includeWaitingUpstream} onChange={event => setValue({ ...value, includeWaitingUpstream: event.target.checked })} /><span><b>安排全部未完成工序</b><small>包含等待上道的后续工序，适合小批次前置安排；关闭后只安排当前可执行工序。</small></span></label>}

          <div className="production-arrangement-overview">
            <div><span>工单</span><strong>{request.orders.length}</strong><small>个</small></div>
            <div><span>计划工序</span><strong>{request.mode === 'continue' ? request.sourceArrangement?.sourceTaskIds.length || 0 : context?.summary.taskCount || 0}</strong><small>道</small></div>
            <div><span>预计标准工时</span><strong>{estimatedHours.toFixed(1)}</strong><small>小时</small></div>
            <div><span>已选人员</span><strong>{value.employeeIds.length}</strong><small>人</small></div>
          </div>

          <div className="production-arrangement-processes">
            <div><strong>本次工序范围</strong><small>全部生产人员 · {compactDateText(value.workDate)}</small></div>
            <span>{(request.mode === 'continue' ? request.sourceArrangement?.processNames || [] : processNames).slice(0, 16).map(name => <b key={name}>{name}</b>)}</span>
            {!loading && request.mode === 'schedule' && !processNames.length && <p>当前选择下没有可新安排工序，请检查是否已安排或工序资料是否完整。</p>}
          </div>

          <div className="production-arrangement-workers-head">
            <div><strong>选择作业员工</strong><small>实时同步人事档案中的生产部在职人员，共 {context?.productionEmployeeCount || 0} 人。</small></div>
            <div><button type="button" disabled={!context?.recommendedEmployeeIds.length} onClick={() => setValue({ ...value, employeeIds: [...(context?.recommendedEmployeeIds || [])] })}>选择推荐</button><button type="button" disabled={!value.employeeIds.length} onClick={() => setValue({ ...value, employeeIds: [] })}>清空</button></div>
          </div>
          <label className="production-arrangement-employee-search"><Search size={16} aria-hidden="true" /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="输入员工编号或姓名搜索" /></label>

          <div className="production-arrangement-employee-grid">
            {employees.map(employee => {
              const selected = value.employeeIds.includes(employee.employeeId);
              const remainingHours = durationHours(employee.remainingMilliseconds);
              const leave = durationHours(employee.leaveMilliseconds) > 0 || employee.attendanceStatus === 'LEAVE';
              const overload = selected && remainingHours + 0.001 < perPersonHours;
              return <button className={`${selected ? 'selected' : ''} ${leave ? 'leave' : ''} ${overload ? 'overload' : ''}`.trim()} type="button" aria-pressed={selected} onClick={() => toggleEmployee(employee.employeeId)} key={employee.employeeId}>
                <span>{employee.employeeName.slice(0, 1)}</span><b>{employee.employeeName}<small>{employee.employeeNo} · {employee.position || '生产员工'}</small></b><em>{recommendedIds.has(employee.employeeId) && <i>推荐</i>}{leave ? '请假' : `余 ${remainingHours.toFixed(1)}h`}</em>
              </button>;
            })}
            {!loading && !employees.length && <p>没有匹配的生产部在职员工，请核对工号或人事档案。</p>}
            {loading && Array.from({ length: 6 }, (_, index) => <span className="production-arrangement-employee-skeleton" key={index} />)}
          </div>
        </section>

        <aside className="production-arrangement-advice">
          <div className="production-arrangement-advice-title"><CalendarDays size={18} aria-hidden="true" /><span><small>安排预览</small><strong>{compactDateText(value.workDate)} · 生产全员</strong></span></div>
          <dl><div><dt>工单数量</dt><dd>{request.orders.length} 单</dd></div><div><dt>工序数量</dt><dd>{request.mode === 'continue' ? request.sourceArrangement?.sourceTaskIds.length || 0 : context?.summary.taskCount || 0} 道</dd></div><div><dt>人均预计工时</dt><dd>{perPersonHours.toFixed(1)} 小时</dd></div><div><dt>安排方式</dt><dd>{value.employeeIds.length > 1 ? `${value.employeeIds.length} 人分摊` : value.employeeIds.length ? '单人负责' : '待选人员'}</dd></div></dl>

          {(overloadEmployees.length > 0 || leaveEmployees.length > 0 || crossWeekCount > 0 || blockedMessages.length > 0) && <div className="production-arrangement-warnings"><strong><AlertTriangle size={16} aria-hidden="true" />排产提醒</strong>{overloadEmployees.length > 0 && <p className="danger">{overloadEmployees.map(employee => employee.employeeName).join('、')} 的当日剩余产能不足，仍可保存但建议增员或改期。</p>}{leaveEmployees.length > 0 && <p className="warning">{leaveEmployees.map(employee => employee.employeeName).join('、')} 当日存在请假记录，请确认实际到岗。</p>}{crossWeekCount > 0 && <p className="warning">有 {crossWeekCount} 道工序安排跨越原计划周，保存后会显示“跨周”标签。</p>}{blockedMessages.slice(0, 3).map(message => <p key={message}>{message}</p>)}</div>}
          {!loading && !error && !overloadEmployees.length && !leaveEmployees.length && !crossWeekCount && !blockedMessages.length && <div className="production-arrangement-ready"><CheckCircle2 size={18} aria-hidden="true" /><span><strong>当前安排可保存</strong><small>日期与人员容量未发现明显冲突，人员资料来自人事档案。</small></span></div>}
          {request.mode === 'continue' && request.sourceArrangement && <div className="production-arrangement-history-card"><span>原安排保留</span><strong>{compactDateText(request.sourceArrangement.workDate)} · {request.sourceArrangement.employees.map(employee => employee.name).join('、') || '未指定'}</strong><small>原记录标记“已续排”，新安排作为下一条历史记录显示。</small></div>}
          {error && <div className="production-arrangement-error"><AlertTriangle size={17} aria-hidden="true" /><span><strong>无法保存</strong><small>{error}</small></span></div>}
        </aside>
      </div>

      <footer><span>{loading ? '正在核对工序与人员容量…' : `已选择 ${value.employeeIds.length} 人${crossWeekCount ? ` · ${crossWeekCount} 道跨周` : ''}`}</span><div><button type="button" disabled={saving} onClick={close}>取消</button><button className="primary" type="button" disabled={loading || saving || !context?.canSchedule || !value.employeeIds.length || !value.teamId} onClick={save}>{saving ? <><Loader2 size={16} aria-hidden="true" />保存中…</> : request.mode === 'continue' ? '确认续排并保留历史' : request.orders.length > 1 ? `确认批量安排 ${request.orders.length} 单` : '确认安排'}</button></div></footer>
    </section>
  </div>;
}

function ProductionReassignmentDialog({ request, sourceEmployees, context, value, setValue, search, setSearch, loading, saving, error, close, save }: {
  request: ProductionReassignmentRequest;
  sourceEmployees: Array<{ employeeId: string; employeeNo: string; name: string; affectedOrderCount: number }>;
  context: ProductionReassignmentContext | null;
  value: ProductionReassignmentForm;
  setValue: (value: ProductionReassignmentForm) => void;
  search: string;
  setSearch: (value: string) => void;
  loading: boolean;
  saving: boolean;
  error: string;
  close: () => void;
  save: () => void;
}) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const closeRef = useRef(close);
  const savingRef = useRef(saving);
  closeRef.current = close;
  savingRef.current = saving;
  const sourceEmployee = sourceEmployees.find(employee => employee.employeeId === value.sourceEmployeeId) || null;
  const currentEmployeeIds = new Set(context?.currentEmployeeIds || []);
  const sourceEmployeeId = value.sourceEmployeeId || request.sourceEmployeeId || '';
  const normalizedSearch = search.trim().toLocaleLowerCase('zh-CN');
  const employees = (context?.employees || [])
    .filter(employee => employee.id !== sourceEmployeeId)
    .filter(employee => !normalizedSearch || `${employee.employeeNo} ${employee.name} ${employee.position || ''} ${employee.team || ''}`.toLocaleLowerCase('zh-CN').includes(normalizedSearch));
  const selectedTasks = context?.tasks.filter(task => value.taskIds.includes(task.id)) || [];
  const requestOrderById = new Map(request.orders.map(order => [order.id, order] as const));
  const employeeNameById = new Map<string, string>();
  (context?.employees || []).forEach(employee => employeeNameById.set(employee.id, employee.name));
  selectedTasks.forEach(task => task.assignments.forEach(assignment => employeeNameById.set(assignment.employeeId, assignment.employee.name)));
  const currentCrewIds = new Set(selectedTasks.flatMap(task => task.assignments.map(assignment => assignment.employeeId)));
  const afterCrewIds = new Set<string>();
  selectedTasks.forEach(task => {
    if (sourceEmployeeId) {
      task.assignments.forEach(assignment => {
        if (assignment.employeeId !== sourceEmployeeId) afterCrewIds.add(assignment.employeeId);
      });
    }
    value.targetEmployeeIds.forEach(employeeId => afterCrewIds.add(employeeId));
  });
  const currentCrewText = [...currentCrewIds].map(employeeId => employeeNameById.get(employeeId) || employeeId).join('、') || '未安排';
  const afterCrewText = [...afterCrewIds].map(employeeId => employeeNameById.get(employeeId) || employeeId).join('、') || '待选择';
  const isMultipleWorkOrders = (context?.summary.workOrderCount || request.orders.length) > 1;
  const selectedRemainingQty = selectedTasks.reduce((sum, task) => sum + task.remainingQty, 0);
  const selectedCompletedQty = selectedTasks.reduce((sum, task) => sum + task.completedQty, 0);
  const finalEmployeeIdsByTask = selectedTasks.map(task => new Set([
    ...(sourceEmployeeId ? task.assignments.map(item => item.employeeId).filter(id => id !== sourceEmployeeId) : []),
    ...value.targetEmployeeIds,
  ]));
  const hasEmptyFinalCrew = finalEmployeeIdsByTask.some(ids => ids.size === 0);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = 'hidden';
    const frame = window.requestAnimationFrame(() => dialogRef.current?.focus());
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !savingRef.current) {
        event.preventDefault();
        closeRef.current();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
      previousFocus?.focus({ preventScroll: true });
    };
  }, []);

  function toggleEmployee(employeeId: string): void {
    setValue({
      ...value,
      targetEmployeeIds: value.targetEmployeeIds.includes(employeeId)
        ? value.targetEmployeeIds.filter(id => id !== employeeId)
        : [...value.targetEmployeeIds, employeeId],
    });
  }

  function toggleTask(taskId: string): void {
    setValue({
      ...value,
      taskIds: value.taskIds.includes(taskId)
        ? value.taskIds.filter(id => id !== taskId)
        : [...value.taskIds, taskId],
    });
  }

  function taskOrderLabel(task: ProductionReassignmentContext['tasks'][number]): string {
    const order = requestOrderById.get(task.workOrder.id);
    return order?.specification?.trim()
      || order?.businessCode?.trim()
      || task.workOrder.productName?.trim()
      || '生产任务';
  }

  return <div className="production-arrangement-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !saving) close(); }}>
    <section ref={dialogRef} className="production-arrangement-dialog production-reassignment-dialog" role="dialog" aria-modal="true" aria-labelledby="production-reassignment-title" tabIndex={-1}>
      <header>
        <div><span>生产调度 · 剩余量重排</span><h2 id="production-reassignment-title">{request.mode === 'employee_exception' ? '员工突发异常批量调班' : '调整当前生产安排'}</h2><p>{request.title} · 已完成报工和员工实际工时不会被修改。</p></div>
        <button type="button" aria-label="关闭调班窗口" disabled={saving} onClick={close}><X size={20} aria-hidden="true" /></button>
      </header>
      <div className="production-arrangement-dialog-body">
        <section className="production-arrangement-config production-reassignment-config">
          {request.mode === 'employee_exception' && <label className="production-reassignment-source"><span>突发异常员工</span><select value={value.sourceEmployeeId} onChange={event => setValue({ ...value, sourceEmployeeId: event.target.value, targetEmployeeIds: [], taskIds: [] })}><option value="">请选择请假 / 无法到岗员工</option>{sourceEmployees.map(employee => <option value={employee.employeeId} key={employee.employeeId}>{employee.employeeNo} · {employee.name} · 影响 {employee.affectedOrderCount} 单</option>)}</select><small>选择后系统只加载该员工名下尚未完成的安排。</small></label>}

          <div className="production-arrangement-overview production-reassignment-overview">
            <div><span>影响工单</span><strong>{context?.summary.workOrderCount || 0}</strong><small>单</small></div>
            <div><span>待调工序</span><strong>{selectedTasks.length}</strong><small>道</small></div>
            <div><span>已报保留</span><strong>{formatProductionQuantity(selectedCompletedQty)}</strong><small>件次</small></div>
            <div><span>本次重排</span><strong>{formatProductionQuantity(selectedRemainingQty)}</strong><small>件次</small></div>
          </div>

          {context && <div className="production-reassignment-task-list">
            <div className="production-arrangement-workers-head"><div><strong>选择需要调整的工序</strong><small>默认选中全部剩余任务，可取消不需要调整的工序。</small></div><div><button type="button" onClick={() => setValue({ ...value, taskIds: context.tasks.map(task => task.id) })}>全选</button><button type="button" onClick={() => setValue({ ...value, taskIds: [] })}>清空</button></div></div>
            <div className="production-reassignment-task-grid" role="group" aria-label="待调整工序">{context.tasks.map(task => {
              const selected = value.taskIds.includes(task.id);
              const taskCrew = [...new Set(task.assignments.map(assignment => assignment.employee.name))].join('、') || '未安排';
              return <label className={selected ? 'selected' : ''} key={task.id}>
                <input type="checkbox" checked={selected} onChange={() => toggleTask(task.id)} aria-label={`选择第 ${task.position} 道工序 ${task.processName}`} />
                <span className="production-reassignment-task-process"><strong><b>{String(task.position).padStart(2, '0')}</b>{task.processName}</strong><small>{isMultipleWorkOrders ? `${taskOrderLabel(task)} · ` : ''}{task.workDate} · {task.team.name}</small></span>
                <span className="production-reassignment-task-crew"><small>当前人员</small><strong>{taskCrew}</strong></span>
                <span className="production-reassignment-task-quantity"><small>已报 {formatProductionQuantity(task.completedQty)} 件次</small><strong>剩余 {formatProductionQuantity(task.remainingQty)} 件次</strong></span>
              </label>;
            })}</div>
          </div>}

          {context && <>
            <div className="production-arrangement-workers-head"><div><strong>{request.mode === 'employee_exception' ? '选择接替员工' : '设置调整后作业人员'}</strong><small>{request.mode === 'employee_exception' ? `${sourceEmployee?.name || '异常员工'} 将从所选任务的后续安排中移除；原同组人员自动保留。` : '这里选择的是未完成数量的新执行人员；取消某人不会删除其历史报工。'}</small></div><div><button type="button" disabled={!value.targetEmployeeIds.length} onClick={() => setValue({ ...value, targetEmployeeIds: [] })}>{request.mode === 'employee_exception' ? '清空新增' : '清空所选'}</button></div></div>
            <label className="production-arrangement-employee-search"><Search size={16} aria-hidden="true" /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="搜索员工编号、姓名、岗位或班组" /></label>
            <div className="production-arrangement-employee-grid production-reassignment-employee-grid">{employees.map(employee => {
              const selected = value.targetEmployeeIds.includes(employee.id);
              const current = currentEmployeeIds.has(employee.id) && employee.id !== sourceEmployeeId;
              return <button className={`${selected ? 'selected' : ''} ${current ? 'current' : ''}`.trim()} type="button" aria-pressed={selected} onClick={() => toggleEmployee(employee.id)} key={employee.id}><span>{employee.name.slice(0, 1)}</span><b>{employee.name}<small>{employee.employeeNo} · {employee.position || '生产员工'}</small></b><em>{current ? '当前人员' : selected ? '已选接替' : employee.team || '生产部'}</em></button>;
            })}{!employees.length && <p>没有匹配的生产部在职人员。</p>}</div>
          </>}

          <div className="production-reassignment-reason">
            <label><span>调整原因</span><select value={value.reasonCode} onChange={event => setValue({ ...value, reasonCode: event.target.value })}><option value="ABSENCE">员工临时缺勤</option><option value="LEAVE">员工请假</option><option value="ILLNESS">员工身体不适</option><option value="TEMPORARY_TRANSFER">临时支援调配</option><option value="CAPACITY_BALANCE">产能平衡调整</option><option value="OTHER">其他现场原因</option></select></label>
            <label><span>补充说明（可选）</span><textarea maxLength={500} value={value.reason} onChange={event => setValue({ ...value, reason: event.target.value })} placeholder="例如：员工下午请假，由同组人员接替剩余任务" /></label>
          </div>
        </section>

        <aside className="production-arrangement-advice production-reassignment-advice">
          <div className="production-arrangement-advice-title"><UserRoundCog size={18} aria-hidden="true" /><span><small>变更预览</small><strong>{request.mode === 'employee_exception' ? sourceEmployee?.name || '待选异常员工' : request.title}</strong></span></div>
          <div className="production-reassignment-crew-preview"><div><small>当前人员</small><strong title={currentCrewText}>{currentCrewText}</strong></div><ArrowRight size={17} aria-hidden="true" /><div><small>调整后人员</small><strong title={afterCrewText}>{afterCrewText}</strong></div></div>
          <dl><div><dt>已报工序量</dt><dd>{formatProductionQuantity(selectedCompletedQty)} 件次 · 锁定</dd></div><div><dt>重排工序量</dt><dd>{formatProductionQuantity(selectedRemainingQty)} 件次</dd></div><div><dt>{request.mode === 'employee_exception' ? '新增接替' : '调整后人员'}</dt><dd>{value.targetEmployeeIds.length} 人</dd></div><div><dt>审计方式</dt><dd>保留前后快照</dd></div></dl>
          <div className="production-reassignment-ledger"><CheckCircle2 size={18} aria-hidden="true" /><span><strong>报工与工时账本不回写</strong><small>{context?.rule || '只有未完成数量会生成新的排班分配；已完成事实保持原日期、原员工和原工时。'}</small></span></div>
          {sourceEmployeeId && <div className="production-reassignment-history-card"><span>移出后续安排</span><strong>{sourceEmployee?.name || context?.employees.find(employee => employee.id === sourceEmployeeId)?.name || sourceEmployeeId}</strong><small>如果某道任务已有其他人员，他们会继续保留；接替人员加入后共同分摊剩余量。</small></div>}
          {hasEmptyFinalCrew && <div className="production-arrangement-error"><AlertTriangle size={17} aria-hidden="true" /><span><strong>无法保存</strong><small>至少有一道工序在移除异常员工后没有任何执行人员，请选择接替员工。</small></span></div>}
          {error && <div className="production-arrangement-error"><AlertTriangle size={17} aria-hidden="true" /><span><strong>无法保存</strong><small>{error}</small></span></div>}
          {loading && <div className="production-reassignment-loading"><Loader2 size={18} aria-hidden="true" /><span>正在核对最新报工与排班版本…</span></div>}
        </aside>
      </div>
      <footer><span>{context ? `所选 ${selectedTasks.length} 道工序 · 重排 ${formatProductionQuantity(selectedRemainingQty)} 件次` : request.mode === 'employee_exception' && !value.sourceEmployeeId ? '请先选择突发异常员工' : '正在加载影响范围…'}</span><div><button type="button" disabled={saving} onClick={close}>取消</button><button className="primary" type="button" disabled={loading || saving || !context || !selectedTasks.length || hasEmptyFinalCrew || (request.mode === 'arrangement' && !value.targetEmployeeIds.length)} onClick={save}>{saving ? <><Loader2 size={16} aria-hidden="true" />保存中…</> : request.mode === 'employee_exception' ? `确认调班人员（${selectedTasks.length}道工序）` : `确认调整人员（${selectedTasks.length}道工序）`}</button></div></footer>
    </section>
  </div>;
}

function ProcessCompletionDialog({ order, activeSteps, selectedStepId, selectStep, context, value, setValue, loading, saving, error, close, save }: {
  order: ProductionOrder;
  activeSteps: WorkOrderProcessRouteDTO['steps'];
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
  const dialogRef = useRef<HTMLElement | null>(null);
  const closeRef = useRef(close);
  const savingRef = useRef(saving);
  const [employeeSearch, setEmployeeSearch] = useState('');
  const [showAllEmployees, setShowAllEmployees] = useState(false);
  const [workerExceptionConfirmed, setWorkerExceptionConfirmed] = useState(false);
  closeRef.current = close;
  savingRef.current = saving;

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = 'hidden';
    const frame = window.requestAnimationFrame(() => dialogRef.current?.focus());
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !savingRef.current) {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])',
      ));
      if (!focusable.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const outside = !dialog.contains(document.activeElement);
      if (event.shiftKey && (document.activeElement === first || outside)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || outside)) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      window.requestAnimationFrame(() => previousFocus?.isConnected && previousFocus.focus());
    };
  }, []);

  const selectedEmployeeKey = value?.employeeIds.join('|') || '';

  useEffect(() => {
    setWorkerExceptionConfirmed(false);
  }, [context?.step.id, selectedEmployeeKey]);

  const processedQty = value && /^\d+$/.test(value.processedQty.trim()) ? Number(value.processedQty) : 0;
  const defectQty = value && /^\d+$/.test(value.defectQty.trim()) ? Number(value.defectQty) : 0;
  const goodQty = Math.max(0, processedQty - defectQty);
  const stepSnapshot = order.processRoute?.steps.find(step => step.id === context?.step.id) || order.processRoute?.currentStep;
  const unitLabel = stepSnapshot?.unitLabel || '件';
  const actionReporting = context?.step.reportQuantityBasis === 'action';
  const supplement = context?.step.supplementObligation || null;
  const reportUnitLabel = context?.step.reportUnitLabel || '个';
  const reportedUnitQty = value && /^\d+$/.test(value.reportedUnitQty.trim()) ? Number(value.reportedUnitQty) : 0;
  const reportedDefectUnitQty = value && /^\d+$/.test(value.reportedDefectUnitQty.trim()) ? Number(value.reportedDefectUnitQty) : 0;
  const reportedGoodUnitQty = Math.max(0, reportedUnitQty - reportedDefectUnitQty);
  const standardMillisecondsPerUnit = stepSnapshot?.standardMillisecondsPerUnit || 0;
  const setupMilliseconds = stepSnapshot?.setupMilliseconds || 0;
  const unitsPerProduct = stepSnapshot?.unitsPerProduct || 1;
  const isPerBatch = stepSnapshot?.timeBasis === 'per_batch';
  const estimatedPendingCoverageQty = context
    ? Math.max(0, context.pendingCoverageQty + processedQty - context.remainingInputQty)
    : 0;
  const advanceReporting = !!context && (
    context.step.status !== 'current'
    || estimatedPendingCoverageQty > 0
  );
  const laborEligibleQty = actionReporting
    ? reportedGoodUnitQty
    : isPerBatch
    ? (context && processedQty === context.reportableQty && !advanceReporting ? context.goodQty + goodQty : 0)
    : goodQty;
  const previouslyReportedLaborQty = actionReporting ? context?.reportedGoodUnitQty || 0 : context?.goodQty || 0;
  const appliedSetupMilliseconds = isPerBatch || previouslyReportedLaborQty === 0
    ? setupMilliseconds
    : 0;
  const standardLaborMilliseconds = laborEligibleQty <= 0 || standardMillisecondsPerUnit <= 0
    ? 0
    : appliedSetupMilliseconds + (isPerBatch
        ? standardMillisecondsPerUnit
        : standardMillisecondsPerUnit * laborEligibleQty * (actionReporting ? 1 : unitsPerProduct));
  const laborSummary = standardMillisecondsPerUnit <= 0
    ? '待补标准工时'
    : isPerBatch && laborEligibleQty <= 0
      ? '闭环后自动记工'
      : standardLaborMilliseconds > 0
        ? `自动记入 ${durationText(standardLaborMilliseconds)}`
        : '本次不生成';
  const nextProcessText = supplement
    ? '独立补报，不重复转序'
    : context?.nextSteps.length
    ? context.nextSteps.map(step => step.processName).join(' / ')
    : '成品入库';
  const selectedStep = activeSteps.find(step => step.id === selectedStepId)
    || activeSteps[0]
    || order.processRoute?.currentStep;
  const completionTitle = context
    ? `报工 ${context.step.processName}`
    : selectedStep
      ? `报工 ${selectedStep.processName}`
      : '登记工序报工';
  const submitText = '确认报工并自动记工';
  const waitsForParallelGroup = !!context
    && (order.processRoute?.steps.filter(step => step.sequenceGroup === context.step.sequenceGroup).length || 0) > 1;
  const goodDestinationHint = supplement
    ? '登记真实工时，不重复转序或增加成品'
    : advanceReporting
    ? `先记录报工，前序补齐后自动进入 ${nextProcessText}`
    : waitsForParallelGroup
      ? `同组齐套后进入 ${nextProcessText}`
      : `立即进入 ${nextProcessText}`;
  const selectedEmployees = context && value
    ? context.employees.filter(employee => value.employeeIds.includes(employee.id))
    : [];
  const preferredEmployeeIds = new Set(context?.workerPreset?.employees.map(employee => employee.id) || []);
  const preferredPriority = new Map(
    context?.workerPreset?.employees.map(employee => [employee.id, employee.priority] as const) || [],
  );
  const employeeKeyword = employeeSearch.trim().toLocaleLowerCase();
  const filteredEmployees = context?.employees.filter(employee => (
    !employeeKeyword
    || `${employee.name} ${employee.employeeNo} ${employee.team || ''} ${employee.department || ''}`
      .toLocaleLowerCase()
      .includes(employeeKeyword)
  )) || [];
  const filteredPreferredEmployees = filteredEmployees
    .filter(employee => preferredEmployeeIds.has(employee.id))
    .sort((left, right) => (
      (preferredPriority.get(left.id) || 0) - (preferredPriority.get(right.id) || 0)
      || left.employeeNo.localeCompare(right.employeeNo)
    ));
  const filteredOtherEmployees = filteredEmployees.filter(employee => !preferredEmployeeIds.has(employee.id));
  const visibleOtherEmployees = employeeKeyword || showAllEmployees
    ? filteredOtherEmployees
    : filteredOtherEmployees.slice(0, Math.max(0, 6 - filteredPreferredEmployees.length));
  const selectedNonPreferredEmployees = context?.workerPreset && value
    ? selectedEmployees.filter(employee => !preferredEmployeeIds.has(employee.id))
    : [];
  const needsWorkerExceptionConfirmation = selectedNonPreferredEmployees.length > 0;
  const invalid = !value
    || !context
    || !Number.isSafeInteger(processedQty)
    || processedQty < (actionReporting ? 0 : 1)
    || processedQty > context.reportableQty
    || !Number.isSafeInteger(defectQty)
    || defectQty < 0
    || defectQty > processedQty
    || (!!supplement && defectQty > 0)
    || (actionReporting && (
      !Number.isSafeInteger(reportedUnitQty)
      || !Number.isSafeInteger(reportedDefectUnitQty)
      || reportedUnitQty < 0
      || reportedDefectUnitQty < 0
      || reportedDefectUnitQty > reportedUnitQty
      || (processedQty <= 0 && reportedUnitQty <= 0)
      || reportedGoodUnitQty > context.reportableUnitQty
    ))
    || !value.employeeIds.length
    || (needsWorkerExceptionConfirmation && !workerExceptionConfirmed);

  return <div className="modal-backdrop process-completion-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}>
    <section ref={dialogRef} tabIndex={-1} className="production-dialog process-completion-dialog" role="dialog" aria-modal="true" aria-labelledby="process-completion-title" aria-describedby="process-completion-order">
      <header className="process-completion-header">
        <div className="process-completion-heading">
          <span>{context?.reportingPolicy === 'strict_sequence' ? '严格按流程报工' : '工序自由报工'}</span>
          <strong id="process-completion-title">{completionTitle}</strong>
          <small id="process-completion-order">{order.customerName || '客户待补充'} · {specText(order)}{order.businessCode ? ` · ${order.businessCode}` : ''}</small>
        </div>
        {!loading && context && <div className="process-completion-next-badge"><span>{supplement ? '补报规则' : '下一步'}</span><strong>{nextProcessText}</strong></div>}
        <button type="button" disabled={saving} aria-label="关闭转序弹窗" onClick={close}><X size={20} aria-hidden="true" /></button>
      </header>

      <div className="process-completion-scroll">

      {activeSteps.length > 1 && <section className="process-completion-step-picker" aria-label="选择本次报工工序">
        <label htmlFor="process-completion-step">
          <span>本次报工工序</span>
          <select id="process-completion-step" value={selectedStepId} disabled={saving} aria-busy={loading} onChange={event => selectStep(event.target.value)}>
            {activeSteps.map(step => {
              const routeStep = context?.routeSteps.find(item => item.id === step.id);
              const reportable = routeStep?.reportableQty;
              const actionStep = routeStep?.reportQuantityBasis === 'action';
              const pending = routeStep?.pendingCoverageQty || 0;
              const noRemaining = reportable === 0 && (!actionStep || routeStep.reportableUnitQty === 0);
              const strictBlocked = context?.reportingPolicy === 'strict_sequence'
                && routeStep?.status !== 'current';
              const statusHint = noRemaining
                ? ' · 已报完'
                : reportable === undefined
                  ? ''
                  : actionStep
                    ? ` · 可报 ${formatProductionQuantity(routeStep.reportableUnitQty)} ${routeStep.reportUnitLabel}动作 · 整套余 ${formatProductionQuantity(reportable)} ${routeStep.unitLabel || step.unitLabel || '件'}`
                    : ` · 可报 ${formatProductionQuantity(reportable)} ${routeStep?.unitLabel || step.unitLabel || '件'}${pending > 0 ? ` · 待核销 ${formatProductionQuantity(pending)}` : ''}`;
              return <option disabled={noRemaining || strictBlocked} value={step.id} key={step.id}>第 {step.position} 道 · {step.processName}{strictBlocked ? ' · 等待前序' : statusHint}</option>;
            })}
          </select>
        </label>
      </section>}

      {loading && <div className="process-completion-loading"><RefreshCw size={18} aria-hidden="true" /><span>正在核对工序数量与历史流转...</span></div>}
      {!loading && error && !context && <section className="process-completion-blocked" role="alert">
        <AlertTriangle size={22} aria-hidden="true" />
        <div><strong>当前工序暂不能流转</strong><p>{error}</p><small>系统不会修改生产目标，也不会跳过已发布工艺路线。请核对工艺路线或计划来源后重试。</small></div>
      </section>}

      {context && value && <div className="process-completion-layout">
        <div className="process-completion-main">
          {advanceReporting && <section className="process-completion-advance-note" role="status">
            <AlertTriangle size={20} aria-hidden="true" />
            <div><strong>自由报工 · 待前序自动核销</strong><small>本次可先登记中间或后道工序；物料数量始终保持非负，前序报工补齐后系统会按工艺顺序自动核销并流转。</small></div>
            <span>预计待核销 {formatProductionQuantity(estimatedPendingCoverageQty)} {unitLabel}</span>
          </section>}
          {supplement && <section className="process-completion-advance-note" role="status">
            <AlertTriangle size={20} aria-hidden="true" />
            <div><strong>整单补充报工 · 独立数量账</strong><small>本工序按整张工单目标独立报工，不受普通物料投入量限制；完成后不重复向后序转数量，也不重复增加成品。</small></div>
            <span>剩余可报 {formatProductionQuantity(context.reportableQty)} {unitLabel}</span>
          </section>}
          <section className="process-completion-route" aria-label="本次工序流转">
            <div><span>报工工序</span><strong>{context.step.processName}</strong><small>第 {context.step.position} 道 · 第 {context.step.sequenceGroup} 顺序组</small></div>
            <ArrowRight size={20} aria-hidden="true" />
            <div><span>{supplement ? '完成后' : '良品进入'}</span><strong>{nextProcessText}</strong><small>{supplement ? '仅形成真实报工与工时' : context.nextSteps.length > 1 ? `${context.nextSteps.length} 道并行工序` : context.nextSteps.length ? '下一道工序' : '成品入库'}</small></div>
            <dl>
              {actionReporting && <div><dt>累计合格动作</dt><dd>{formatProductionQuantity(context.reportedGoodUnitQty)} / {formatProductionQuantity(context.reportTargetQty)} {reportUnitLabel}</dd></div>}
              <div><dt>累计已报</dt><dd>{formatProductionQuantity(context.reportedQty)} {unitLabel}</dd></div>
              <div><dt>{supplement ? '整单目标' : '累计已核销'}</dt><dd>{formatProductionQuantity(supplement?.actualRequiredQty ?? context.coveredReportedQty)} {unitLabel}</dd></div>
            </dl>
          </section>

          <section className="process-completion-quantity-panel" aria-label="本次完成数量">
            <header><div><strong>{actionReporting ? '实际动作与整套流转' : '本次报工数量'}</strong><small>{actionReporting ? `剩余合格动作 ${formatProductionQuantity(context.reportableUnitQty)} ${reportUnitLabel}；整套剩余 ${formatProductionQuantity(context.reportableQty)} ${unitLabel}` : supplement ? `整单目标 ${formatProductionQuantity(supplement.actualRequiredQty)} ${unitLabel}；剩余可报 ${formatProductionQuantity(context.reportableQty)} ${unitLabel}` : `剩余可报 ${formatProductionQuantity(context.reportableQty)} ${unitLabel}；当前已到料可核销 ${formatProductionQuantity(context.remainingInputQty)} ${unitLabel}`}</small></div><label className="process-completion-work-date"><span><CalendarDays size={16} aria-hidden="true" />生产日期</span><input type="date" max={todayShanghaiDateKey()} value={value.workDate} disabled={saving} onChange={event => setValue({ ...value, workDate: event.target.value })} /></label></header>
            {actionReporting && <p className="process-completion-action-note">实际动作量用于计算工时；只有形成完整产品的数量才推进下一工序。每套标准为 {formatProductionQuantity(context.step.unitsPerProduct)} {reportUnitLabel}。</p>}
            <div className={`process-completion-quantity-grid${actionReporting ? ' action' : ''}`}>
              {actionReporting && <>
                <label>
                  <span>实际动作数量</span>
                  <div><input autoFocus inputMode="numeric" pattern="[0-9]*" min="0" step="1" value={value.reportedUnitQty} disabled={saving} onChange={event => setValue({ ...value, reportedUnitQty: event.target.value })} /><em>{reportUnitLabel}</em></div>
                </label>
                <label>
                  <span>动作不良</span>
                  <div><input inputMode="numeric" pattern="[0-9]*" min="0" max={reportedUnitQty || undefined} step="1" value={value.reportedDefectUnitQty} disabled={saving} onChange={event => setValue({ ...value, reportedDefectUnitQty: event.target.value })} /><em>{reportUnitLabel}</em></div>
                </label>
              </>}
              <label>
                <span>{actionReporting ? '形成完整产品' : '实际报工'}</span>
                <div><input autoFocus={!actionReporting} inputMode="numeric" pattern="[0-9]*" min={actionReporting ? 0 : 1} max={context.reportableQty} step="1" value={value.processedQty} disabled={saving} onChange={event => setValue({ ...value, processedQty: event.target.value })} /><em>{unitLabel}</em></div>
              </label>
              <label>
                <span>{supplement ? '整套不良（不重复分支）' : actionReporting ? '整套不良' : '不良品'}</span>
                <div><input inputMode="numeric" pattern="[0-9]*" min="0" max={supplement ? 0 : processedQty || context.reportableQty} step="1" value={value.defectQty} disabled={saving || !!supplement} onChange={event => setValue({ ...value, defectQty: event.target.value })} /><em>{unitLabel}</em></div>
              </label>
              <div className="process-completion-good" aria-live="polite"><span>{actionReporting ? '本次合格动作 / 整套良品' : '本次良品'}</span><strong>{actionReporting ? <>{formatProductionQuantity(reportedGoodUnitQty)} <small>{reportUnitLabel}</small> · {formatProductionQuantity(goodQty)} <small>{unitLabel}</small></> : <>{formatProductionQuantity(goodQty)} <small>{unitLabel}</small></>}</strong><em>{goodDestinationHint}</em></div>
            </div>
          </section>

          {defectQty > 0 && <fieldset className="process-completion-disposition">
            <legend>不良品后续处理</legend>
            <label className={value.defectDisposition === 'rework' ? 'selected' : ''}><input type="radio" name="defectDisposition" value="rework" checked={value.defectDisposition === 'rework'} disabled={saving} onChange={() => setValue({ ...value, defectDisposition: 'rework' })} /><span><strong>返工</strong><small>从当前工序重新处理</small></span></label>
            {!order.parentWorkOrderId && <label className={value.defectDisposition === 'scrap_replenish' ? 'selected' : ''}><input type="radio" name="defectDisposition" value="scrap_replenish" checked={value.defectDisposition === 'scrap_replenish'} disabled={saving} onChange={() => setValue({ ...value, defectDisposition: 'scrap_replenish' })} /><span><strong>报废补产</strong><small>从首道工序重新生产</small></span></label>}
          </fieldset>}

          <section className="process-completion-work-session" aria-label="本次现场作业记录">
            <header><div><strong>作业人员</strong><small>报工提交后，标准工时会直接按人数与数量自动分摊到员工达成率</small></div><span className={value.employeeIds.length ? 'selected' : ''}>{value.employeeIds.length} 人</span></header>
            {context.workerPreset && <div className="process-completion-worker-preset">
              <div><Users size={17} aria-hidden="true" /><span><strong>本周预选人员</strong><small>{context.workerPreset.scope === 'STEP' ? '当前工单工序专属配置' : `${context.workerPreset.weekStartDate} 当周工序配置`} · {context.workerPreset.employees.length} 人</small></span></div>
              <button type="button" disabled={saving || !context.workerPreset.employees.length} onClick={() => setValue({ ...value, employeeIds: context.workerPreset!.employees.map(employee => employee.id) })}>一键选中预选</button>
            </div>}
            {!!selectedEmployees.length && <div className="process-completion-selected-employees">
              {selectedEmployees.map(employee => <span className={preferredEmployeeIds.has(employee.id) ? 'preferred' : ''} key={employee.id}>{employee.name}{preferredEmployeeIds.has(employee.id) && <em>预选</em>}<button type="button" disabled={saving} aria-label={`移除${employee.name}`} onClick={() => setValue({ ...value, employeeIds: value.employeeIds.filter(id => id !== employee.id) })}><X size={13} aria-hidden="true" /></button></span>)}
            </div>}
            <div className="process-completion-employee-picker">
              <label><Search size={16} aria-hidden="true" /><input value={employeeSearch} disabled={saving} onChange={event => setEmployeeSearch(event.target.value)} placeholder="搜索姓名、工号或班组" /></label>
              <div className="process-completion-employee-list">
                {!!filteredPreferredEmployees.length && <p className="process-completion-employee-group-label"><span>本周预选</span><b>{filteredPreferredEmployees.length} 人</b></p>}
                {filteredPreferredEmployees.map(employee => {
                  const checked = value.employeeIds.includes(employee.id);
                  return <label className={`${checked ? 'selected ' : ''}preferred`} key={employee.id}>
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
                    <span><strong>{employee.name}<em>预选</em></strong><small>{employee.employeeNo}{employee.team ? ` · ${employee.team}` : ''}</small></span>
                  </label>;
                })}
                {!!visibleOtherEmployees.length && <p className="process-completion-employee-group-label"><span>{context.workerPreset ? '其他在职员工' : '在职员工'}</span><b>{filteredOtherEmployees.length} 人</b></p>}
                {visibleOtherEmployees.map(employee => {
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
                {!filteredEmployees.length && <p>没有匹配的员工</p>}
              </div>
              {!employeeKeyword && filteredEmployees.length > 6 && <button className="process-completion-show-employees" type="button" disabled={saving} onClick={() => setShowAllEmployees(current => !current)}>{showAllEmployees ? '收起人员列表' : `查看全部 ${filteredEmployees.length} 人`}</button>}
            </div>
            {needsWorkerExceptionConfirmation && <label className="process-completion-worker-warning">
              <input type="checkbox" checked={workerExceptionConfirmed} disabled={saving} onChange={event => setWorkerExceptionConfirmed(event.target.checked)} />
              <AlertTriangle size={17} aria-hidden="true" />
              <span><strong>包含 {selectedNonPreferredEmployees.length} 名非预选人员</strong><small>允许报工并会正常同步员工工时，请确认他们确实参与了本次作业。</small></span>
              <b>已核对</b>
            </label>}
            <details className="process-completion-more">
              <summary>更多现场信息 <span>班组、工位、备注</span></summary>
              <div>
                <label><span>班组</span><input maxLength={80} value={value.team} disabled={saving} onChange={event => setValue({ ...value, team: event.target.value })} placeholder="例如：前端一组" /></label>
                <label><span>工位 / 设备</span><input maxLength={80} value={value.workstation} disabled={saving} onChange={event => setValue({ ...value, workstation: event.target.value })} placeholder="例如：裁线 C-03" /></label>
                <label className="wide"><span>现场备注</span><textarea rows={2} maxLength={500} value={value.remark} disabled={saving} onChange={event => setValue({ ...value, remark: event.target.value })} placeholder="记录换线、设备、交接或质量情况" /></label>
              </div>
            </details>
          </section>

        </div>

        <aside className="process-completion-summary" aria-label="确认结果">
          <header><CheckCircle2 size={20} aria-hidden="true" /><div><strong>确认结果</strong><small>提交前请核对</small></div></header>
          <div className={`process-completion-summary-hero${advanceReporting ? ' pending' : ''}`}><span>{actionReporting ? '合格动作 / 整套良品' : advanceReporting ? '本次先报工' : '本次良品'}</span><strong>{actionReporting ? <>{formatProductionQuantity(reportedGoodUnitQty)} <small>{reportUnitLabel}</small> · {formatProductionQuantity(goodQty)} <small>{unitLabel}</small></> : <>{formatProductionQuantity(goodQty)} <small>{unitLabel}</small></>}</strong><em>{supplement ? '计入补报义务，不重复转序' : advanceReporting ? `前序补齐后自动核销至 ${nextProcessText}` : waitsForParallelGroup ? `齐套后进入 ${nextProcessText}` : `进入 ${nextProcessText}`}</em></div>
          <dl>
            <div><dt>{actionReporting ? '动作 / 整套不良' : '不良品'}</dt><dd className={defectQty > 0 || reportedDefectUnitQty > 0 ? 'danger' : ''}>{actionReporting ? `${formatProductionQuantity(reportedDefectUnitQty)} ${reportUnitLabel} / ${formatProductionQuantity(defectQty)} ${unitLabel}` : `${formatProductionQuantity(defectQty)} ${unitLabel}`}</dd></div>
            <div><dt>自动记工</dt><dd>{laborSummary}</dd></div>
            <div><dt>作业人员</dt><dd className={!selectedEmployees.length ? 'warning' : ''}>{selectedEmployees.length ? `${selectedEmployees.length} 人` : '未选择'}</dd></div>
            <div><dt>生产日期</dt><dd>{dateText(value.workDate)}</dd></div>
          </dl>
          <section className="process-completion-summary-people"><Users size={16} aria-hidden="true" /><span>{selectedEmployees.length ? selectedEmployees.map(employee => employee.name).join('、') : '请选择本次作业人员'}</span></section>
          {!!context.recentCompletions.length && <details className="process-completion-history">
            <summary>最近转序记录 <span>{context.recentCompletions.length} 条</span></summary>
            <div>
              {context.recentCompletions.slice(0, 4).map(item => <article key={item.id}>
                <time>{dateText(item.workDate)}</time>
                <strong>{item.reportQuantityBasis === 'action' ? `动作 ${formatProductionQuantity(item.reportedGoodUnitQty)} ${item.reportUnitLabel} / 整套 ${formatProductionQuantity(item.goodQty)} ${unitLabel}` : `良品 ${formatProductionQuantity(item.goodQty)} / 不良 ${formatProductionQuantity(item.defectQty)}`}</strong>
                <small>{item.pendingCoverageQty > 0 ? `待前序核销 ${formatProductionQuantity(item.pendingCoverageQty)} ${unitLabel}` : item.participants.length ? `已自动记工：${item.participants.map(participant => participant.name).join('、')}` : item.branchWorkOrder ? (item.branchWorkOrder.businessCode || '不良分支工单') : '已核销流转'}</small>
              </article>)}
            </div>
          </details>}
        </aside>
      </div>}

      {error && context && <div className="form-error" role="alert">{error}</div>}
      </div>
      <footer className="dialog-actions">
        <span className={!invalid ? 'ready' : ''}>{!context || !value || loading ? '正在核对工序数据' : !value.employeeIds.length ? '请选择作业人员后提交' : needsWorkerExceptionConfirmation && !workerExceptionConfirmed ? '请确认本次非预选作业人员' : supplement ? `将补报 ${formatProductionQuantity(processedQty)} ${unitLabel}并记入 ${selectedEmployees.length} 人真实工时，不重复转序` : actionReporting ? `将登记 ${formatProductionQuantity(reportedGoodUnitQty)} ${reportUnitLabel}合格动作、${formatProductionQuantity(goodQty)} ${unitLabel}整套良品` : advanceReporting ? `将先登记 ${formatProductionQuantity(processedQty)} ${unitLabel}，待前序自动核销` : `将报工并自动记入 ${selectedEmployees.length} 人工时`}</span>
        <button type="button" disabled={saving} onClick={close}>取消</button>
        <button className="primary-button" type="button" disabled={loading || saving || invalid} onClick={save}>{saving ? '正在报工...' : submitText}</button>
      </footer>
    </section>
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
  const firstSteps = order.processRoute?.steps.filter(step => step.status !== 'skipped') || [];
  const firstSequenceGroup = firstSteps.length ? Math.min(...firstSteps.map(step => step.sequenceGroup)) : null;
  const firstProcessName = firstSequenceGroup === null
    ? '首道工序'
    : firstSteps.filter(step => step.sequenceGroup === firstSequenceGroup).map(step => step.processName).join(' / ');
  const title = `开始生产并进入${firstProcessName}`;
  return <div className="modal-backdrop"><section className="production-dialog production-next-step-dialog" role="dialog" aria-modal="true" aria-label={title}>
    <div className="dialog-title"><div><strong>{title}</strong><small>{order.customerName || '客户待补充'} · {specText(order)}</small></div><button type="button" disabled={saving} onClick={close} aria-label="关闭">×</button></div>
    <div className="production-flow-summary" aria-label="当前生产数量">
      <div><span>总目标 T</span><strong>{formatProductionQuantity(flow.targetQty)}</strong></div>
      <div><span>前端剩余 T-F</span><strong>{formatProductionQuantity(flow.frontendRemainingQty)}</strong></div>
      <div><span>后端待完成 F-C</span><strong>{formatProductionQuantity(flow.backendRemainingQty)}</strong></div>
      <div><span>累计已完成 C</span><strong>{formatProductionQuantity(flow.completedQty)}</strong></div>
    </div>
    <section className="production-start-readiness" aria-label="开工条件核对">
      <div className="ready"><CheckCircle2 size={17} aria-hidden="true" /><span><b>工序与工时</b><small>路线已发布，全部工序标准工时完整</small></span><em>开工条件</em></div>
      <div><CalendarDays size={17} aria-hidden="true" /><span><b>计划周期</b><small>{order.planActive ? '当前执行周' : `${order.weekStartDate || '预排周'} · 允许提前生产`}</small></span><em>不阻断</em></div>
      <div><Info size={17} aria-hidden="true" /><span><b>图纸状态</b><small>{order.drawingStatus || (order.documentCategoryCodes.includes('drawing') ? '已有原图' : '待补充')}</small></span><em>风险提醒</em></div>
      <div><AlertTriangle size={17} aria-hidden="true" /><span><b>配料状态</b><small>{warehouseMaterialText(order)}</small></span><em>风险提醒</em></div>
    </section>
    <p className="production-flow-confirm-copy">确认后只启动已发布的工艺路线并进入首道工序，不修改计划周、图纸或配料状态。未配料、待配料、缺料、料不齐或料错仅保留风险提示，不影响正常开工和二维码报工；只有明确的人工暂停或独立质量冻结才会阻止执行。</p>
    {error && <div className="form-error" role="alert">{error}</div>}
    <div className="dialog-actions"><button type="button" disabled={saving} onClick={close}>取消</button><button className="primary-button" type="button" disabled={saving} onClick={confirm}>{saving ? '启动中...' : '确认开始生产'}</button></div>
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

function qualityRiskSeverityText(severity: InternalQualityRiskSeverity): string {
  return ({ LOW: '低风险', MEDIUM: '中风险', HIGH: '高风险', CRITICAL: '重大风险' } as const)[severity];
}

function qualityAlertStateText(state: WorkOrderQualityAlertsDTO['alerts'][number]['state']): string {
  return ({ ACTIVE: '待知悉', ACKNOWLEDGED: '已知悉', SUPERSEDED: '已被新版替代', REVOKED: '已撤销', EXPIRED: '已到期' } as const)[state];
}

function DetailDialog({ order, tab, setTab, progressLogs, progressLoading, close, resources, drawingLibrary, canPrintTraveler, travelerPrinting, printTraveler, canViewQualityRisks, canManageQualityRisks, canAcknowledgeQualityRisks, userId }: { order: ProductionOrder; tab: DetailTab; setTab: (tab: DetailTab) => void; progressLogs: ProgressLog[]; progressLoading: boolean; close: () => void; resources: () => void; drawingLibrary: () => void; canPrintTraveler: boolean; travelerPrinting: boolean; printTraveler: () => void; canViewQualityRisks: boolean; canManageQualityRisks: boolean; canAcknowledgeQualityRisks: boolean; userId: string }) {
  const [qualityData, setQualityData] = useState<WorkOrderQualityAlertsDTO | null>(null);
  const [qualityLoading, setQualityLoading] = useState(true);
  const [qualityError, setQualityError] = useState('');
  const [qualityActionId, setQualityActionId] = useState('');
  const [qualityReloadToken, setQualityReloadToken] = useState(0);
  const [pendingProductRisk, setPendingProductRisk] = useState<{
    reportId: string;
    reportNo: string;
    reportTitle: string;
    expectedVersion: number;
  } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setQualityLoading(true);
    setQualityError('');
    fetch(`/api/work-orders/${encodeURIComponent(order.id)}/quality-alerts`, { cache: 'no-store', signal: controller.signal })
      .then(async response => {
        const body = await response.json().catch(() => ({})) as WorkOrderQualityAlertsDTO & { error?: string };
        if (response.status === 401) location.href = '/login';
        if (!response.ok) throw new Error(body.error || '质量预警加载失败');
        return body;
      })
      .then(body => setQualityData(body))
      .catch(error => {
        if ((error as { name?: string }).name !== 'AbortError') setQualityError(error instanceof Error ? error.message : '质量预警加载失败');
      })
      .finally(() => {
        if (!controller.signal.aborted) setQualityLoading(false);
      });
    return () => controller.abort();
  }, [order.id, qualityReloadToken]);

  async function acknowledgeQualityAlert(alertId: string): Promise<void> {
    setQualityActionId(alertId);
    setQualityError('');
    try {
      const response = await fetch(`/api/work-orders/${encodeURIComponent(order.id)}/quality-alerts/${encodeURIComponent(alertId)}/acknowledge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: '已在生产工单详情中确认知悉' }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error || '预警知悉失败');
      setQualityReloadToken(value => value + 1);
    } catch (error) {
      setQualityError(error instanceof Error ? error.message : '预警知悉失败');
    } finally {
      setQualityActionId('');
    }
  }

  async function confirmProductRisk(): Promise<void> {
    if (!pendingProductRisk) return;
    const { reportId, expectedVersion } = pendingProductRisk;
    setQualityActionId(reportId);
    setQualityError('');
    try {
      const response = await fetch(`/api/work-orders/${encodeURIComponent(order.id)}/quality-alerts/link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reportId, expectedVersion }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error || '产品风险关联失败');
      setPendingProductRisk(null);
      setQualityReloadToken(value => value + 1);
    } catch (error) {
      setQualityError(error instanceof Error ? error.message : '产品风险关联失败');
    } finally {
      setQualityActionId('');
    }
  }

  const qualityAlertCount = qualityData?.alerts.filter(alert => alert.state === 'ACTIVE' || alert.state === 'ACKNOWLEDGED').length ?? order.qualityRiskAlertCount;
  return (
    <><div className="modal-backdrop"><section className="production-dialog detail" role="dialog" aria-modal="true" aria-label="生产工单详情">
      <div className="dialog-title"><div><strong>{specText(order)}</strong><small>{order.customerName || '客户待补充'} · {order.productName || '品名待补充'}</small></div><button type="button" aria-label="关闭" onClick={close}>×</button></div>
      <div className="production-detail-tabs">{([['production', '生产信息'], ['quality', `质量预警 ${qualityAlertCount}`], ['drawing', '工单资料'], ['progress', '进度记录'], ['source', '来源信息']] as Array<[DetailTab, string]>).map(item => <button className={tab === item[0] ? 'active' : ''} type="button" key={item[0]} onClick={() => setTab(item[0])}>{item[1]}</button>)}</div>
      <div className="production-detail-body">
        {tab === 'production' && <><InfoGrid items={[
          ['状态', order.stageText], ['优先级', priorityText(order.priority)], ['周计划原始目标', order.importedTargetQty === null ? order.uncompletedQty || '-' : formatProductionQuantity(order.importedTargetQty)], ['当前生产目标', formatProductionQuantity(order.quantitySummary.targetQty)],
          ...(order.branchType ? [
            ['分支类型', branchTypeText(order.branchType)],
            ['主工单', order.parentWorkOrder?.code || '-'],
            ['来源工序', order.originStep?.processName || '-'],
            ['回接工序', order.rejoinStep?.processName || '成品汇总'],
          ] as Array<[string, string]> : []),
          ['工艺路线', order.processRoute?.statusText || '沿用前后端流程'], ['当前工序', order.processRoute?.currentStep?.processName || (order.processRoute?.status === 'confirmed' ? '等待开始生产' : '-')], ['工序进度', order.processRoute ? `${order.processRoute.completedStepCount}/${order.processRoute.stepCount}（${order.processRoute.progress}%）` : '-'],
          ['数量来源', quantitySourceText(order)], ['累计进入后端', formatProductionQuantity(order.quantityFlow.frontendTransferredQty)], ['累计完成', formatProductionQuantity(order.quantitySummary.completedQty)], ['整体进度', formatProductionPercentage(order.quantitySummary.percentage)],
          ['交期', deliveryText(order) || '-'], ['图纸', order.drawingStatus || '-'], ['仓库配料', warehouseMaterialText(order)], ['仓库异常', warehouseExceptionDetail(order)], ['开始时间', dateTimeText(order.startedAt)],
          ['完成时间', dateTimeText(order.completedAt)], ['最近更新', dateTimeText(order.lastProgressAt)], ['最近进度', order.latestProgressRemark || '暂无进度备注'],
        ]} />
        {!!order.branchWorkOrders?.length && <section className="production-branch-list" aria-label="关联不良品分支">
          <header><strong>关联不良品分支</strong><span>{order.branchWorkOrders.length} 单</span></header>
          <div>{order.branchWorkOrders.map(branch => <article key={branch.id}>
            <span><b>{branch.businessCode || '不良分支工单'}</b><small>{branchTypeText(branch.branchType)} · {branch.productionTargetQty || 0} {branch.unitLabel || '件'}</small></span>
            <span><b>{branch.currentProcessName || (branch.routeStatus === 'completed' ? '路线已完成' : '工序待确认')}</b><small>{branchStatusText(branch.branchStatus)}</small></span>
            <Link href={`/workspace/workflows?workOrderId=${encodeURIComponent(branch.id)}&from=production&returnTo=${encodeURIComponent('/production')}`} prefetch={false}>查看分支流程</Link>
          </article>)}</div>
        </section>}</>}
        {tab === 'quality' && <div className="production-quality-risk-panel">
          <header className="production-quality-risk-heading"><div><AlertTriangle size={18} /><span><strong>工单质量问题预警</strong><small>已归档重大异常会同步原因、结论与现场控制要求；预警本身不会自动暂停生产。</small></span></div>{canViewQualityRisks && <Link href={`/workspace/quality/internal-risks?workOrderId=${encodeURIComponent(order.id)}`} prefetch={false}>进入质量管理</Link>}</header>
          {qualityLoading && <div className="production-loading"><Loader2 className="spin" size={16} />质量预警加载中...</div>}
          {qualityError && <div className="form-error">{qualityError}<button type="button" onClick={() => setQualityReloadToken(value => value + 1)}>重试</button></div>}
          {!qualityLoading && qualityData && <>
            <section className="production-quality-risk-section"><div className="production-quality-risk-section-title"><strong>当前工单预警</strong><span>{qualityData.alerts.length} 条记录</span></div>
              <div className="production-quality-risk-list">{qualityData.alerts.map(alert => {
                const acknowledgedByMe = alert.acknowledgements.some(item => item.acknowledgedById === userId);
                return <article className={`production-quality-risk-card severity-${alert.severity.toLowerCase()} state-${alert.state.toLowerCase()}`} key={alert.id}>
                  <header><span><em>{qualityRiskSeverityText(alert.severity)}</em><b>{alert.reportNo} · {alert.reportTitle}</b></span><i>{qualityAlertStateText(alert.state)}</i></header>
                  <div className="production-quality-risk-facts"><p><span>不良现象</span><strong>{alert.defectPhenomenon || '归档记录未填写'}</strong></p><p><span>原因</span><strong>{alert.rootCause || '归档记录未填写'}</strong></p><p><span>结论</span><strong>{alert.finalConclusion || '归档记录未填写'}</strong></p><p className="wide"><span>现场控制要求</span><strong>{alert.controlRequirement || '按现行检验与工艺要求执行'}</strong></p></div>
                  <footer><span>归档版本 R{alert.revisionNumber} · {dateTimeText(alert.archivedAt)}{alert.effectiveUntil ? ` · 有效至 ${dateText(alert.effectiveUntil)}` : ' · 长期有效'}</span><div>{canViewQualityRisks && <Link href={`/workspace/quality/internal-risks?reportId=${encodeURIComponent(alert.reportId)}`} prefetch={false}>查看完整异常</Link>}{canAcknowledgeQualityRisks && (alert.state === 'ACTIVE' || alert.state === 'ACKNOWLEDGED') && <button type="button" disabled={acknowledgedByMe || qualityActionId === alert.id} onClick={() => acknowledgeQualityAlert(alert.id)}>{qualityActionId === alert.id ? '提交中...' : acknowledgedByMe ? '我已知悉' : '确认知悉'}</button>}</div></footer>
                </article>;
              })}{!qualityData.alerts.length && <div className="production-task-empty"><CheckCircle2 size={20} />当前工单没有生效中的质量异常预警</div>}</div>
            </section>
            {!!qualityData.suggestions.length && <section className="production-quality-risk-section suggestions"><div className="production-quality-risk-section-title"><strong>同产品历史风险待确认</strong><span>{qualityData.suggestions.length} 条建议</span></div><p className="production-quality-risk-explainer">系统只根据相同产品主数据提出建议，必须由质量人员人工确认后才会写入当前工单。</p><div className="production-quality-risk-list">{qualityData.suggestions.map(suggestion => <article className={`production-quality-risk-card suggestion severity-${suggestion.severity.toLowerCase()}`} key={suggestion.id}><header><span><em>{qualityRiskSeverityText(suggestion.severity)}</em><b>{suggestion.reportNo} · {suggestion.title}</b></span><i>待质量确认</i></header><p className="production-quality-risk-suggestion-reason">{suggestion.reason}</p><div className="production-quality-risk-facts"><p><span>历史原因</span><strong>{suggestion.rootCause || '未填写'}</strong></p><p><span>历史结论</span><strong>{suggestion.finalConclusion || '未填写'}</strong></p></div><footer><span>归档版本 R{suggestion.revisionNumber || 1}{suggestion.effectiveUntil ? ` · 有效至 ${dateText(suggestion.effectiveUntil)}` : ' · 长期有效'}</span><div>{canViewQualityRisks && <Link href={`/workspace/quality/internal-risks?reportId=${encodeURIComponent(suggestion.id)}`} prefetch={false}>查看依据</Link>}{canManageQualityRisks && <button className="primary-button" type="button" disabled={qualityActionId === suggestion.id} onClick={() => { setQualityError(''); setPendingProductRisk({ reportId: suggestion.id, reportNo: suggestion.reportNo, reportTitle: suggestion.title, expectedVersion: suggestion.version }); }}>{qualityActionId === suggestion.id ? '关联中...' : '确认同步预警'}</button>}</div></footer></article>)}</div></section>}
          </>}
        </div>}
        {tab === 'drawing' && <div className="production-drawing-detail"><div className="production-drawing-score"><span>工单资料完整度</span><strong>{order.documentFilledCount}/{order.documentTotalCount || 5}</strong></div><div className="production-category-status">{categoryLabels.map(category => <span className={order.documentCategoryCodes.includes(category.code) ? 'ready' : 'missing'} key={category.code}><i />{category.label}<b>{order.documentCategoryCodes.includes(category.code) ? '已有资料' : '待补充'}</b></span>)}</div><div className="production-drawing-actions"><button className="primary-button" type="button" onClick={resources}>打开工单资料</button><button type="button" onClick={drawingLibrary}>查看图纸资料库</button></div></div>}
        {tab === 'progress' && <div className="production-progress-list">{progressLoading && <div className="production-loading">进度记录加载中...</div>}{progressLogs.map(log => <article key={log.id}><time>{dateTimeText(log.createdAt)}</time><strong>{log.createdBy || '操作人未记录'}</strong><span>状态：{log.previousStageText && log.previousStage !== log.stage ? `${log.previousStageText} → ` : ''}{log.stageText}</span>{log.completedQty && <span>完成：{log.completedQty}</span>}{(log.productionOwner || log.workstation) && <span>历史记录：{log.productionOwner || ''}{log.productionOwner && log.workstation ? ' · ' : ''}{log.workstation || ''}</span>}<p>{log.remark || '未填写备注'}</p></article>)}{!progressLoading && !progressLogs.length && <div className="production-task-empty">暂无进度记录</div>}</div>}
        {tab === 'source' && <InfoGrid items={[
          ['订单日期', dateText(order.orderDate) || '-'], ['业务员', order.salesperson || '-'], ['客户等级', order.customerLevel || '-'],
          ['导入批次', order.importBatchId || '-'], ['来源工作表', order.sourceSheetName || '-'], ['来源行号', order.sourceRowNo ? String(order.sourceRowNo) : '-'], ['内部工单', order.businessCode || '-'],
          ['工序', order.processName || '-'], ['单位工时', order.unitWorkHours || '-'], ['总工时', order.totalWorkHours || '-'], ['图纸说明', order.drawingIssueNote || '-'],
        ]} />}
      </div>
      <div className="dialog-actions"><button type="button" onClick={resources}>工单资料</button>{order.processRoute && <Link href={`/workspace/workflows?workOrderId=${encodeURIComponent(order.id)}&from=production`}><GitPullRequestArrow size={15} />工艺变更</Link>}{canPrintTraveler && <button type="button" disabled={travelerPrinting || !order.processRoute || order.processRoute.status === 'draft'} title={!order.processRoute || order.processRoute.status === 'draft' ? '确认工艺路线后才能打印' : '生成一工单一码流转单'} onClick={printTraveler}><Printer size={15} />{travelerPrinting ? '生成中...' : '打印流转单'}</button>}<button className="primary-button" type="button" onClick={close}>关闭</button></div>
    </section></div>
    {pendingProductRisk && <div className="modal-backdrop production-risk-confirm-backdrop"><section className="production-dialog production-stage-confirm production-risk-confirm" role="dialog" aria-modal="true" aria-label="确认同步质量预警">
      <div className="dialog-title"><div><strong>确认同步质量预警</strong><small>由质量人员确认同产品历史风险是否适用于当前工单</small></div><button type="button" disabled={!!qualityActionId} onClick={() => setPendingProductRisk(null)} aria-label="关闭">×</button></div>
      <div className="production-risk-confirm-target"><AlertTriangle size={19} /><span><small>{pendingProductRisk.reportNo}</small><strong>{pendingProductRisk.reportTitle}</strong></span></div>
      <ul className="production-risk-confirm-rules"><li>确认后，当前工单将新增一条可知悉的质量预警。</li><li>同步归档版本中的原因、结论和现场控制要求。</li><li><b>不会自动暂停生产</b>，停线或放行仍由现场制度与人员决策。</li></ul>
      {qualityError && <div className="form-error">{qualityError}</div>}
      <div className="dialog-actions"><button type="button" disabled={!!qualityActionId} onClick={() => setPendingProductRisk(null)}>取消</button><button className="primary-button" type="button" disabled={!!qualityActionId} onClick={confirmProductRisk}>{qualityActionId ? '同步中...' : '确认并同步'}</button></div>
    </section></div>}
    </>
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
