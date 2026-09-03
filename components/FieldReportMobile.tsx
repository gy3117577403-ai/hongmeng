'use client';

import {
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleDot,
  Clock3,
  GitPullRequestArrow,
  History,
  LoaderCircle,
  ListChecks,
  LogOut,
  PackageCheck,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  TimerOff,
  UserRoundCheck,
  Users,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FieldReportRouteChangeProposal } from '@/components/field-report/FieldReportRouteChangeProposal';
import { ABNORMAL_TIME_CATEGORIES } from '@/lib/attendance';
import { resolveFieldReportStepPresentation } from '@/lib/field-report-progress';
import type { ProcessCompletionContext } from '@/lib/process-completion-service';
import {
  processRouteStepChangeLabel,
  secondsFromMilliseconds,
  type ProcessRouteStepChangeNotice,
} from '@/lib/process-route-change-contract';
import type { FieldReportTicketView } from '@/lib/work-order-qr-service';
import type {
  AbnormalTimeCategory,
  CompletionWithdrawalPreviewDTO,
  CompletionWithdrawalRequestDTO,
} from '@/types';

export type FieldReportIdentityDTO = {
  id: string;
  displayName: string;
  employeeId: string | null;
};

type EmployeeOption = ProcessCompletionContext['employees'][number];
type FieldReportPayload = {
  ticket: FieldReportTicketView;
  context: ProcessCompletionContext | null;
  currentEmployee: EmployeeOption | null;
  identityMessage: string;
};

type ReportForm = {
  processedQty: string;
  defectQty: string;
  reportedUnitQty: string;
  reportedDefectUnitQty: string;
  defectDisposition: 'rework' | 'scrap_replenish' | 'quality_pending';
  workDate: string;
  employeeIds: string[];
  team: string;
  workstation: string;
  remark: string;
  wipAllocationId: string;
};

type BatchStepForm = {
  stepId: string;
  processName: string;
  position: number;
  processedQty: string;
  defectQty: string;
  defectDisposition: 'rework' | 'scrap_replenish';
};

type FieldReportStepChangeSnapshot = ProcessRouteStepChangeNotice & {
  previousStandardMillisecondsPerUnit?: number | null;
};

type FieldReportSupplementSnapshot = {
  id: string;
  requiredQty: number;
  systemCoveredQty: number;
  actualRequiredQty: number;
  reportedQty: number;
  reportedUnitQty: number;
  reportedGoodUnitQty: number;
  reportedDefectUnitQty: number;
  reportQuantityBasis: 'product' | 'action';
  reportUnitLabel: string;
  remainingQty: number;
  fulfillmentMode: 'ACTUAL' | 'MIXED' | 'SYSTEM_COVERED' | 'FUTURE_ONLY' | 'RECALL_REQUIRED';
  releasePolicy: string;
  isCritical: boolean;
  status: 'ACTIVE' | 'FULFILLED' | 'CANCELLED';
  version: number;
};

type RecentCompletion = ProcessCompletionContext['recentCompletions'][number];

type CompletionCorrectionPreview = {
  ownership: 'SELF' | 'OTHER';
  canRequestCorrection: boolean;
  completion?: {
    id: string;
    processName: string;
    processedQty: number;
    completedAt: string;
  };
  preview?: CompletionWithdrawalPreviewDTO;
  requests: CompletionWithdrawalRequestDTO[];
  activeRequest: CompletionWithdrawalRequestDTO | null;
};

type CompletionCorrectionState = {
  completion: RecentCompletion;
  loading: boolean;
  saving: boolean;
  reason: string;
  error: string;
  data: CompletionCorrectionPreview | null;
};

type FieldAbnormalTimeDraft = {
  stepId: string;
  processName: string;
  category: '' | AbnormalTimeCategory;
  subcategory: string;
  workDate: string;
  durationMinutes: string;
  affectedQuantity: string;
  employeeIds: string[];
  reason: string;
  responsibilityDepartment: string;
  responsibilityObject: string;
  idempotencyKey: string;
  error: string;
};

function stepChangeSnapshot(value: unknown): FieldReportStepChangeSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const tag = String(record.changeTag || record.changeKind || 'NONE');
  if (tag !== 'ADDED' && tag !== 'TIME_CHANGED' && tag !== 'ADDED_AND_TIME_CHANGED') return null;
  const routeVersion = Number(record.changeVersion ?? record.introducedRouteVersion ?? record.timeChangedRouteVersion ?? 0);
  return {
    tag,
    routeVersion: Number.isSafeInteger(routeVersion) ? routeVersion : 0,
    previousStandardMillisecondsPerUnit: Number.isSafeInteger(Number(record.previousStandardMillisecondsPerUnit))
      ? Number(record.previousStandardMillisecondsPerUnit)
      : null,
    currentStandardMillisecondsPerUnit: Number.isSafeInteger(Number(record.standardMillisecondsPerUnit))
      ? Number(record.standardMillisecondsPerUnit)
      : null,
    sourceChangeId: typeof record.sourceChangeId === 'string' ? record.sourceChangeId : null,
  };
}

function stepSupplementSnapshot(value: unknown): FieldReportSupplementSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const obligation = (value as Record<string, unknown>).supplementObligation;
  if (!obligation || typeof obligation !== 'object') return null;
  const record = obligation as Record<string, unknown>;
  const requiredQty = Number(record.requiredQty);
  const systemCoveredQty = Number(record.systemCoveredQty || 0);
  const actualRequiredQty = Number(record.actualRequiredQty ?? Math.max(0, requiredQty - systemCoveredQty));
  const reportedQty = Number(record.reportedQty);
  const reportedUnitQty = Number(record.reportedUnitQty);
  const reportedGoodUnitQty = Number(record.reportedGoodUnitQty);
  const reportedDefectUnitQty = Number(record.reportedDefectUnitQty);
  const version = Number(record.version);
  const status = String(record.status || 'ACTIVE');
  if (!String(record.id || '').trim() || !Number.isSafeInteger(requiredQty) || requiredQty <= 0) return null;
  if (status !== 'ACTIVE' && status !== 'FULFILLED' && status !== 'CANCELLED') return null;
  return {
    id: String(record.id),
    requiredQty,
    systemCoveredQty: Number.isSafeInteger(systemCoveredQty) && systemCoveredQty >= 0 ? systemCoveredQty : 0,
    actualRequiredQty: Number.isSafeInteger(actualRequiredQty) && actualRequiredQty >= 0 ? actualRequiredQty : requiredQty,
    reportedQty: Number.isSafeInteger(reportedQty) && reportedQty >= 0 ? reportedQty : 0,
    reportedUnitQty: Number.isSafeInteger(reportedUnitQty) && reportedUnitQty >= 0 ? reportedUnitQty : 0,
    reportedGoodUnitQty: Number.isSafeInteger(reportedGoodUnitQty) && reportedGoodUnitQty >= 0 ? reportedGoodUnitQty : 0,
    reportedDefectUnitQty: Number.isSafeInteger(reportedDefectUnitQty) && reportedDefectUnitQty >= 0 ? reportedDefectUnitQty : 0,
    reportQuantityBasis: record.reportQuantityBasis === 'action' ? 'action' : 'product',
    reportUnitLabel: String(record.reportUnitLabel || '件'),
    remainingQty: Math.max(0, Number.isSafeInteger(Number(record.remainingQty)) ? Number(record.remainingQty) : actualRequiredQty - reportedQty),
    fulfillmentMode: ['MIXED', 'SYSTEM_COVERED', 'FUTURE_ONLY', 'RECALL_REQUIRED'].includes(String(record.fulfillmentMode))
      ? String(record.fulfillmentMode) as FieldReportSupplementSnapshot['fulfillmentMode']
      : 'ACTUAL',
    releasePolicy: String(record.releasePolicy || 'NONE'),
    isCritical: record.isCritical === true,
    status,
    version: Number.isSafeInteger(version) && version >= 0 ? version : 0,
  };
}

function todayKey(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

function quantity(value: number): string {
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 }).format(Math.max(0, value || 0));
}

function dateText(value: string | null): string {
  if (!value) return '待维护';
  const normalized = value.replace(/\//g, '-');
  const parts = normalized.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  return parts ? `${parts[1]}/${parts[2].padStart(2, '0')}/${parts[3].padStart(2, '0')}` : value;
}

function dateTimeText(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date).replace(/\//g, '-');
}

function withdrawalRequestStatusText(status: CompletionWithdrawalRequestDTO['status']): string {
  return {
    PENDING: '待审批',
    APPLIED: '已批准并撤回',
    REJECTED: '已驳回',
    CANCELLED: '已取消',
    BLOCKED: '撤回异常',
    STALE: '已失效',
  }[status];
}

function completionWorkerNames(completion: {
  principalEmployee: { name: string } | null;
  participants: Array<{ name: string }>;
}): string {
  const names = completion.participants.map(employee => employee.name);
  if (completion.principalEmployee && !names.includes(completion.principalEmployee.name)) {
    names.unshift(completion.principalEmployee.name);
  }
  return names.join('、') || '人员待核对';
}

function standardTime(milliseconds: number | null, basis: string | null, units: number): string {
  if (!milliseconds || milliseconds <= 0) return '标准工时待维护';
  const seconds = milliseconds / 1000;
  const shown = Number.isInteger(seconds) ? seconds : seconds.toFixed(1);
  return basis === 'per_batch' ? `${shown} 秒/批` : `${shown} 秒 × ${Math.max(1, units)}`;
}

function newIdempotencyKey(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? `qr-${crypto.randomUUID()}`
    : `qr-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function fieldAbnormalIdempotencyKey(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? `qra-${crypto.randomUUID()}`
    : `qra-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function formFor(context: ProcessCompletionContext, currentEmployee: EmployeeOption): ReportForm {
  return {
    processedQty: '0',
    defectQty: '0',
    reportedUnitQty: '0',
    reportedDefectUnitQty: '0',
    defectDisposition: 'rework',
    workDate: todayKey(),
    employeeIds: [currentEmployee.id],
    team: currentEmployee.team || '',
    workstation: '',
    remark: '',
    wipAllocationId: '',
  };
}

export default function FieldReportMobile({
  code,
  user,
}: {
  code: string;
  user: FieldReportIdentityDTO;
}) {
  const [payload, setPayload] = useState<FieldReportPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [reportMode, setReportMode] = useState<'single' | 'batch'>('single');
  const [batchSelecting, setBatchSelecting] = useState(false);
  const [selectedStepIds, setSelectedStepIds] = useState<string[]>([]);
  const [batchItems, setBatchItems] = useState<BatchStepForm[]>([]);
  const [form, setForm] = useState<ReportForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [employeeSearch, setEmployeeSearch] = useState('');
  const [showAllEmployees, setShowAllEmployees] = useState(false);
  const [exceptionConfirmed, setExceptionConfirmed] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState('');
  const [success, setSuccess] = useState<{ title: string; detail: string } | null>(null);
  const [fullQuantityConfirmOpen, setFullQuantityConfirmOpen] = useState(false);
  const [correction, setCorrection] = useState<CompletionCorrectionState | null>(null);
  const [abnormalDraft, setAbnormalDraft] = useState<FieldAbnormalTimeDraft | null>(null);
  const [abnormalSaving, setAbnormalSaving] = useState(false);
  const [abnormalMoreOpen, setAbnormalMoreOpen] = useState(false);

  const load = useCallback(async (stepId?: string, quiet = false): Promise<FieldReportPayload | null> => {
    if (!quiet) setLoading(true); else setRefreshing(true);
    setError('');
    try {
      const query = stepId ? `?stepId=${encodeURIComponent(stepId)}` : '';
      const response = await fetch(`/api/field-report/tickets/${encodeURIComponent(code)}${query}`, { cache: 'no-store' });
      const body = await response.json().catch(() => ({}));
      if (response.status === 401) {
        sessionStorage.setItem('hm-login-notice', '登录已过期，请重新使用员工编号登录');
        location.href = `/login?next=${encodeURIComponent(`/field-report/${code}`)}`;
        return null;
      }
      if (!response.ok) throw new Error(body.error || '工单加载失败');
      const nextPayload = body.data as FieldReportPayload;
      setPayload(nextPayload);
      return nextPayload;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '工单加载失败');
      return null;
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [code]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!sheetOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) setSheetOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [saving, sheetOpen]);

  const routeSteps: ProcessCompletionContext['routeSteps'] = payload?.context?.routeSteps
    || payload?.ticket.route?.steps.map(step => ({
      id: step.id,
      processName: step.processName,
      position: step.position,
      sequenceGroup: step.sequenceGroup,
      executionMode: step.executionMode || 'NORMAL',
      supplementObligation: step.supplementObligation || null,
      status: step.status,
      unitLabel: step.unitLabel,
      reportQuantityBasis: step.reportQuantityBasis || 'product',
      reportUnitLabel: step.reportUnitLabel || step.unitLabel || payload.ticket.workOrder.unitLabel,
      unitsPerProduct: step.unitsPerProduct || 1,
      inputQty: payload.ticket.workOrder.targetQty,
      processedQty: step.processedQty,
      reportedQty: step.processedQty,
      coveredReportedQty: step.processedQty,
      pendingCoverageQty: 0,
      reportableQty: 0,
      reportTargetQty: payload.ticket.workOrder.targetQty,
      reportedUnitQty: step.processedQty,
      reportedGoodUnitQty: step.processedQty,
      reportedDefectUnitQty: 0,
      reportableUnitQty: 0,
      availableCoverageQty: 0,
      latestCompletion: null,
    }))
    || [];
  const completedSteps = routeSteps.filter(step => (
    step.pendingCoverageQty <= 0
    && (
      step.reportQuantityBasis === 'action'
        ? step.reportedGoodUnitQty >= step.reportTargetQty
          && step.coveredReportedQty >= (step.supplementObligation?.actualRequiredQty ?? payload?.ticket.workOrder.targetQty ?? 0)
        : step.status === 'completed'
          || step.coveredReportedQty >= (step.supplementObligation?.actualRequiredQty ?? payload?.ticket.workOrder.targetQty ?? 0)
    )
  )).length;
  const progress = routeSteps.length ? Math.round(completedSteps / routeSteps.length * 100) : 0;
  const selectedStep = payload?.context?.step || null;
  const selectedStepSnapshot = payload?.ticket.route?.steps.find(step => step.id === selectedStep?.id) || null;
  const selectedSupplement = payload?.context?.step.supplementObligation
    || stepSupplementSnapshot(selectedStepSnapshot);
  const currentEmployeeId = payload?.currentEmployee?.id || '';
  const availableWipAllocations = (payload?.ticket.wipAllocations || []).filter(allocation => (
    Boolean(form?.workDate)
    && allocation.targetWeekStartDate <= form!.workDate
    && allocation.targetWeekEndDate >= form!.workDate
    && (reportMode === 'batch'
      ? batchItems.some(item => allocation.steps.some(step => step.stepId === item.stepId && step.remainingQty > 0))
      : allocation.steps.some(step => step.stepId === payload?.context?.step.id && step.remainingQty > 0))
  ));
  const selectedWipAllocation = availableWipAllocations.find(allocation => allocation.id === form?.wipAllocationId) || null;
  const assignedWipWorkerIds = selectedWipAllocation?.workers.map(worker => worker.employeeId) || [];
  const preferredIds = new Set([
    ...(payload?.context?.workerPreset?.employees.map(employee => employee.id) || []),
    ...assignedWipWorkerIds,
  ]);
  const selectedEmployees = payload?.context && form
    ? payload.context.employees.filter(employee => form.employeeIds.includes(employee.id))
    : [];
  const nonPreferredCollaborators = selectedEmployees.filter(employee => employee.id !== currentEmployeeId && !preferredIds.has(employee.id));
  const searchedEmployees = (payload?.context?.employees || []).filter(employee => {
    const key = employeeSearch.trim().toLocaleLowerCase();
    return !key || `${employee.employeeNo} ${employee.name} ${employee.team || ''} ${employee.position || ''}`.toLocaleLowerCase().includes(key);
  });
  const orderedEmployees = [...searchedEmployees].sort((left, right) => {
    if (left.id === currentEmployeeId) return -1;
    if (right.id === currentEmployeeId) return 1;
    const leftPreferred = preferredIds.has(left.id) ? 0 : 1;
    const rightPreferred = preferredIds.has(right.id) ? 0 : 1;
    return leftPreferred - rightPreferred || left.employeeNo.localeCompare(right.employeeNo);
  });
  const visibleEmployees = employeeSearch || showAllEmployees ? orderedEmployees : orderedEmployees.slice(0, 8);
  const processedQty = Number(form?.processedQty || 0);
  const defectQty = Number(form?.defectQty || 0);
  const goodQty = Math.max(0, processedQty - defectQty);
  const actionReporting = payload?.context?.step.reportQuantityBasis === 'action';
  const reportedUnitQty = actionReporting
    ? Number(form?.reportedUnitQty || 0)
    : processedQty;
  const reportedDefectUnitQty = actionReporting
    ? Number(form?.reportedDefectUnitQty || 0)
    : defectQty;
  const reportedGoodUnitQty = Math.max(0, reportedUnitQty - reportedDefectUnitQty);
  const hasReportableQuantity = Boolean(payload?.context && (
    payload.context.reportableQty > 0
    || (actionReporting && payload.context.reportableUnitQty > 0)
  ));
  const batchSelectedSteps = routeSteps.filter(step => selectedStepIds.includes(step.id));
  const invalidBatchItems = batchItems.some(item => {
    const step = routeSteps.find(candidate => candidate.id === item.stepId);
    const itemProcessed = Number(item.processedQty);
    const itemDefect = Number(item.defectQty);
    return !step
      || !Number.isSafeInteger(itemProcessed) || itemProcessed <= 0 || itemProcessed > step.reportableQty
      || !Number.isSafeInteger(itemDefect) || itemDefect < 0 || itemDefect > itemProcessed;
  });
  const advanceReporting = !selectedSupplement && Boolean(payload?.context && hasReportableQuantity && (reportMode === 'batch'
    ? batchItems.some(item => {
        const step = routeSteps.find(candidate => candidate.id === item.stepId);
        return Boolean(step && (step.status !== 'current' || Number(item.processedQty) > step.availableCoverageQty));
      })
    : payload.context.step.status !== 'current' || processedQty > payload.context.remainingInputQty
  ));
  const invalid = !payload?.context || !payload.currentEmployee || !form
    || (reportMode === 'batch'
      ? batchItems.length < 2 || invalidBatchItems
      : actionReporting
        ? !Number.isSafeInteger(processedQty) || processedQty < 0 || processedQty > payload.context.reportableQty
          || !Number.isSafeInteger(defectQty) || defectQty < 0 || defectQty > processedQty
          || !Number.isSafeInteger(reportedUnitQty) || reportedUnitQty < 0
          || !Number.isSafeInteger(reportedDefectUnitQty) || reportedDefectUnitQty < 0 || reportedDefectUnitQty > reportedUnitQty
          || (processedQty <= 0 && reportedUnitQty <= 0)
          || reportedGoodUnitQty > payload.context.reportableUnitQty
        : !Number.isSafeInteger(processedQty) || processedQty <= 0 || processedQty > payload.context.reportableQty
          || !Number.isSafeInteger(defectQty) || defectQty < 0 || defectQty > processedQty)
    || !form.workDate || !form.employeeIds.includes(currentEmployeeId)
    || (nonPreferredCollaborators.length > 0 && !exceptionConfirmed);

  async function openReport(stepId: string): Promise<void> {
    if (!payload?.currentEmployee) return;
    setFormError('');
    setEmployeeSearch('');
    setShowAllEmployees(false);
    setExceptionConfirmed(false);
    const nextPayload = await load(stepId);
    if (!nextPayload?.context || !nextPayload.currentEmployee) return;
    setReportMode('single');
    setBatchItems([]);
    setForm(formFor(nextPayload.context, nextPayload.currentEmployee));
    setIdempotencyKey(newIdempotencyKey());
    setSheetOpen(true);
  }

  function openAbnormalTime(step: ProcessCompletionContext['routeSteps'][number]): void {
    if (!payload?.currentEmployee) return;
    setAbnormalMoreOpen(false);
    setAbnormalDraft({
      stepId: step.id,
      processName: step.processName,
      category: '',
      subcategory: '',
      workDate: todayKey(),
      durationMinutes: '0',
      affectedQuantity: '',
      employeeIds: [payload.currentEmployee.id],
      reason: '',
      responsibilityDepartment: '',
      responsibilityObject: '',
      idempotencyKey: fieldAbnormalIdempotencyKey(),
      error: '',
    });
  }

  async function submitAbnormalTime(): Promise<void> {
    if (!abnormalDraft || !payload?.currentEmployee || abnormalSaving) return;
    const minutes = Number(abnormalDraft.durationMinutes);
    if (!abnormalDraft.category) {
      setAbnormalDraft({ ...abnormalDraft, error: '请选择异常问题分类' });
      return;
    }
    if (!Number.isSafeInteger(minutes) || minutes <= 0) {
      setAbnormalDraft({ ...abnormalDraft, error: '请输入大于 0 的整数分钟' });
      return;
    }
    if (!abnormalDraft.employeeIds.includes(payload.currentEmployee.id)) {
      setAbnormalDraft({ ...abnormalDraft, error: '受影响员工必须包含当前登录人' });
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(abnormalDraft.workDate)) {
      setAbnormalDraft({ ...abnormalDraft, error: '请选择有效的异常日期' });
      return;
    }
    setAbnormalSaving(true);
    setAbnormalDraft({ ...abnormalDraft, error: '' });
    try {
      const response = await fetch(`/api/field-report/tickets/${encodeURIComponent(code)}/abnormal-time-events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stepId: abnormalDraft.stepId,
          category: abnormalDraft.category,
          subcategory: abnormalDraft.subcategory,
          workDate: abnormalDraft.workDate,
          durationMinutes: minutes,
          affectedQuantity: abnormalDraft.affectedQuantity,
          employeeIds: abnormalDraft.employeeIds,
          reason: abnormalDraft.reason,
          responsibilityDepartment: abnormalDraft.responsibilityDepartment,
          responsibilityObject: abnormalDraft.responsibilityObject,
          idempotencyKey: abnormalDraft.idempotencyKey,
        }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string; data?: { event?: { sequence?: number } } };
      if (!response.ok) throw new Error(body.error || '异常工时登记失败');
      const sequence = body.data?.event?.sequence;
      setAbnormalDraft(null);
      setSuccess({
        title: '异常工时已提交主管审核',
        detail: `${sequence ? `记录 #${sequence} 已建立，` : ''}本次登记不改变报工数量和工序完整性，可继续正常报工。`,
      });
    } catch (reason) {
      setAbnormalDraft(current => current ? {
        ...current,
        error: reason instanceof Error ? reason.message : '异常工时登记失败',
      } : current);
    } finally {
      setAbnormalSaving(false);
    }
  }

  function toggleBatchStep(stepId: string): void {
    setSelectedStepIds(current => current.includes(stepId)
      ? current.filter(id => id !== stepId)
      : [...current, stepId]);
  }

  function selectBatchSteps(kind: 'all' | 'backend' | 'clear'): void {
    if (kind === 'clear') {
      setSelectedStepIds([]);
      return;
    }
    const ids = routeSteps.filter(step => {
      if (step.reportableQty <= 0) return false;
      if (step.reportQuantityBasis === 'action') return false;
      const snapshot = payload?.ticket.route?.steps.find(item => item.id === step.id);
      if (stepSupplementSnapshot(snapshot)) return false;
      return kind === 'all' || snapshot?.stageGroup === 'backend';
    }).map(step => step.id);
    setSelectedStepIds(ids);
  }

  function openBatchReport(): void {
    if (!payload?.context || !payload.currentEmployee || batchSelectedSteps.length < 2) return;
    setFormError('');
    setEmployeeSearch('');
    setShowAllEmployees(false);
    setExceptionConfirmed(false);
    setReportMode('batch');
    setForm({
      ...formFor(payload.context, payload.currentEmployee),
      processedQty: '0',
      defectQty: '0',
      reportedUnitQty: '0',
      reportedDefectUnitQty: '0',
    });
    setBatchItems(batchSelectedSteps.map(step => ({
      stepId: step.id,
      processName: step.processName,
      position: step.position,
      processedQty: '0',
      defectQty: '0',
      defectDisposition: 'rework',
    })));
    setIdempotencyKey(newIdempotencyKey().replace(/^qr-/, 'qrb-'));
    setSheetOpen(true);
  }

  function setCommonBatchQuantity(value: string): void {
    if (!form) return;
    setForm({ ...form, processedQty: value });
    setBatchItems(items => items.map(item => ({ ...item, processedQty: value })));
  }

  function submitUsesAllRemainingQuantity(): boolean {
    if (!payload?.context) return false;
    if (reportMode === 'batch') {
      return batchItems.some(item => {
        const step = routeSteps.find(candidate => candidate.id === item.stepId);
        return Boolean(step && Number(item.processedQty) === step.reportableQty);
      });
    }
    return processedQty === payload.context.reportableQty
      || (actionReporting && reportedGoodUnitQty === payload.context.reportableUnitQty);
  }

  function requestSubmit(): void {
    if (invalid) return;
    if (submitUsesAllRemainingQuantity()) {
      setFullQuantityConfirmOpen(true);
      return;
    }
    void submit();
  }

  async function openCorrection(completion: RecentCompletion): Promise<void> {
    setCorrection({ completion, loading: true, saving: false, reason: '', error: '', data: null });
    try {
      const response = await fetch(
        `/api/field-report/tickets/${encodeURIComponent(code)}/completions/${encodeURIComponent(completion.id)}/correction`,
        { cache: 'no-store' },
      );
      const body = await response.json().catch(() => ({}));
      if (response.status === 401) {
        sessionStorage.setItem('hm-login-notice', '登录已过期，请重新使用员工编号登录');
        location.href = `/login?next=${encodeURIComponent(`/field-report/${code}`)}`;
        return;
      }
      if (!response.ok) throw new Error(body.error || '纠错影响读取失败');
      setCorrection(current => current?.completion.id === completion.id
        ? { ...current, loading: false, data: body.data as CompletionCorrectionPreview }
        : current);
    } catch (reason) {
      setCorrection(current => current?.completion.id === completion.id
        ? {
            ...current,
            loading: false,
            error: reason instanceof Error ? reason.message : '纠错影响读取失败',
          }
        : current);
    }
  }

  async function submitCorrection(): Promise<void> {
    if (!correction || !payload?.context || correction.loading || correction.saving) return;
    setCorrection({ ...correction, saving: true, error: '' });
    try {
      const response = await fetch(
        `/api/field-report/tickets/${encodeURIComponent(code)}/completions/${encodeURIComponent(correction.completion.id)}/correction`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            reason: correction.reason,
            idempotencyKey: newIdempotencyKey().replace(/^qr-/, 'qrc-'),
            expectedRouteVersion: payload.context.routeVersion,
          }),
        },
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || '纠错提交失败');
      const result = body.data as {
        status: 'REQUESTED';
        request: CompletionWithdrawalRequestDTO;
      };
      setCorrection(null);
      setSheetOpen(false);
      setForm(null);
      setSuccess({
        title: result.status === 'REQUESTED' ? '撤回申请已提交' : '申请已受理',
        detail: '申请已进入流程中心的专用撤回审批；审批完成前，原数量、工时和流转记录保持不变。',
      });
      await load(undefined, true);
    } catch (reason) {
      setCorrection(current => current
        ? {
            ...current,
            saving: false,
            error: reason instanceof Error ? reason.message : '纠错提交失败',
          }
        : current);
    }
  }

  async function cancelCorrectionRequest(): Promise<void> {
    const activeRequest = correction?.data?.activeRequest;
    if (!correction || !activeRequest || correction.loading || correction.saving) return;
    setCorrection({ ...correction, saving: true, error: '' });
    try {
      const response = await fetch(
        `/api/field-report/tickets/${encodeURIComponent(code)}/completions/${encodeURIComponent(correction.completion.id)}/correction`,
        {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            requestId: activeRequest.id,
            expectedVersion: activeRequest.version,
            idempotencyKey: newIdempotencyKey().replace(/^qr-/, 'qrc-cancel-'),
          }),
        },
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || '撤回申请取消失败');
      setCorrection(null);
      setSuccess({
        title: '撤回申请已取消',
        detail: '原报工记录没有发生变更；如仍需纠错，可重新发起撤回申请。',
      });
    } catch (reason) {
      setCorrection(current => current
        ? {
            ...current,
            saving: false,
            error: reason instanceof Error ? reason.message : '撤回申请取消失败',
          }
        : current);
    }
  }

  async function submit(): Promise<void> {
    if (invalid || !payload?.context || !form || !payload.currentEmployee) return;
    setSaving(true);
    setFormError('');
    try {
      const requestBody = reportMode === 'batch'
        ? {
            items: batchItems.map(item => ({
              stepId: item.stepId,
              processedQty: Number(item.processedQty),
              defectQty: Number(item.defectQty),
              defectDisposition: Number(item.defectQty) > 0 ? item.defectDisposition : null,
            })),
          }
        : {
            stepId: payload.context.step.id,
            processedQty,
            defectQty,
            reportedUnitQty: actionReporting ? reportedUnitQty : undefined,
            reportedDefectUnitQty: actionReporting ? reportedDefectUnitQty : undefined,
            defectDisposition: defectQty > 0 ? form.defectDisposition : null,
          };
      const supplement = reportMode === 'single'
        ? stepSupplementSnapshot(payload.ticket.route?.steps.find(step => step.id === payload.context!.step.id))
        : null;
      const endpoint = supplement
        ? `/api/field-report/tickets/${encodeURIComponent(code)}/supplement-obligations/${encodeURIComponent(supplement.id)}/completions`
        : `/api/field-report/tickets/${encodeURIComponent(code)}/completions`;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...requestBody,
          workDate: form.workDate,
          employeeIds: form.employeeIds,
          team: form.team,
          workstation: form.workstation,
          remark: form.remark,
          idempotencyKey,
          expectedRouteVersion: payload.context.routeVersion,
          expectedVersion: supplement?.version,
          wipAllocationId: form.wipAllocationId || undefined,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 409) {
          const selectedId = reportMode === 'single' ? payload.context.step.id : undefined;
          await load(selectedId, true);
        }
        throw new Error(body.error || '报工提交失败');
      }
      const pending = Number(body.data?.pendingCoverageQty || 0);
      const employeeCount = Number(body.data?.autoAssignedEmployeeCount || form.employeeIds.length);
      const completionCount = Number(body.data?.completionCount || 1);
      setSheetOpen(false);
      setForm(null);
      setBatchItems([]);
      setSelectedStepIds([]);
      setBatchSelecting(false);
      setSuccess({
        title: reportMode === 'batch' ? `${completionCount} 道工序批量报工成功` : `${payload.context.step.processName} 报工成功`,
        detail: pending > 0
          ? `所选工序已全部登记，另有 ${quantity(pending)} ${payload.ticket.workOrder.unitLabel}待前序自动覆盖；已为 ${employeeCount} 人自动记工。`
          : reportMode === 'batch'
            ? `${completionCount} 道工序已分别落账并正常流转；已为 ${employeeCount} 人自动记工。`
            : supplement
              ? `补充工序已报 ${quantity(processedQty)} ${payload.ticket.workOrder.unitLabel}，已为 ${employeeCount} 人自动记工；已报后序不回退。`
              : actionReporting
                ? `${quantity(reportedGoodUnitQty)} ${payload.context.step.reportUnitLabel}合格动作已记工，${quantity(goodQty)} ${payload.ticket.workOrder.unitLabel}进入流转。`
                : `${quantity(goodQty)} ${payload.ticket.workOrder.unitLabel}已正常流转；已为 ${employeeCount} 人自动记工。`,
      });
      await load(undefined, true);
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : '报工提交失败');
    } finally {
      setSaving(false);
    }
  }

  async function logout(): Promise<void> {
    await fetch('/api/auth/logout', { method: 'POST' });
    location.href = `/login?next=${encodeURIComponent(`/field-report/${code}`)}`;
  }

  if (loading && !payload) return <main className="field-report-loading"><LoaderCircle className="spin" size={34} /><strong>正在读取工单二维码</strong><span>核对最新工艺路线与生产数量...</span></main>;
  if (!payload) return <main className="field-report-failure"><AlertTriangle size={40} /><strong>无法打开工单</strong><p>{error || '二维码无效或工单不存在'}</p><button type="button" onClick={() => void load()}>重新读取</button></main>;

  const ticket = payload.ticket;
  return <main className="field-report-app">
    <header className="field-report-topbar">
      <div className="field-report-mark">杭</div>
      <span><small>现场扫码报工</small><strong>{ticket.workOrder.specification || ticket.workOrder.productName}</strong></span>
      <button type="button" onClick={() => void logout()} aria-label="切换登录账号"><LogOut size={18} /><em>切换</em></button>
    </header>

    <section className="field-report-identity">
      {payload.currentEmployee ? <><UserRoundCheck size={20} /><span><small>当前报工身份</small><strong>{payload.currentEmployee.employeeNo} · {payload.currentEmployee.name}</strong></span><BadgeCheck size={20} /></> : <><AlertTriangle size={20} /><span><small>当前账号</small><strong>{user.displayName}</strong></span><em>只读</em></>}
    </section>

    <section className="field-report-order-card">
      <header><span>生产工单</span><b className={`priority-${ticket.workOrder.priority}`}>{ticket.workOrder.priority === 'urgent' ? '紧急' : ticket.workOrder.priority === 'high' ? '高优先' : '一般'}</b></header>
      <h1>{ticket.workOrder.specification || ticket.workOrder.productName}</h1>
      <p>{ticket.workOrder.customerName || '客户待维护'} · {ticket.workOrder.productName}</p>
      <dl>
        <div><dt>内部工单</dt><dd>{ticket.workOrder.businessCode}</dd></div>
        <div><dt>计划数量</dt><dd>{quantity(ticket.workOrder.targetQty)} {ticket.workOrder.unitLabel}</dd></div>
        <div><dt>计划交期</dt><dd>{dateText(ticket.workOrder.deliveryDay)}</dd></div>
        <div><dt>二维码短码</dt><dd>{ticket.shortCode}</dd></div>
      </dl>
      <div className="field-report-progress"><span><b>工序进度</b><em>{completedSteps}/{routeSteps.length || ticket.route?.steps.length || 0}</em></span><i><b style={{ width: `${progress}%` }} /></i></div>
    </section>

    {ticket.route?.paperOutdated && <section className="field-report-alert warning"><AlertTriangle size={20} /><span><strong>纸面工艺版本已过期</strong><small>纸面 V{ticket.route.printedVersion}，系统最新 V{ticket.route.version}；原二维码继续有效，无需重印，请以手机端最新工序为准。</small></span></section>}
    {!ticket.access.canReport && <section className={`field-report-alert state-${ticket.access.state.toLowerCase()}`}><ShieldCheck size={20} /><span><strong>{ticket.access.state === 'COMPLETED' ? '工单已完成' : '当前仅可查看'}</strong><small>{ticket.access.message}</small></span></section>}
    {ticket.access.canReport && !payload.currentEmployee && <section className="field-report-alert danger"><AlertTriangle size={20} /><span><strong>账号未关联生产员工</strong><small>请联系管理员把当前登录账号绑定到在职生产员工档案后再报工。</small></span></section>}

    {ticket.route && <FieldReportRouteChangeProposal
      code={code}
      routeVersion={ticket.route.version}
      steps={ticket.route.steps}
      targetQty={ticket.workOrder.targetQty}
      unitLabel={ticket.workOrder.unitLabel}
      employeeAvailable={Boolean(payload.currentEmployee)}
      onSubmitted={() => void load(undefined, true)}
    />}

    <section className="field-report-route">
      <header><span><small>工艺流程</small><strong>{ticket.route?.name || '工艺路线待确认'}</strong></span><div><button className={batchSelecting ? 'active' : ''} type="button" disabled={!ticket.access.canReport || !payload.currentEmployee} onClick={() => { setBatchSelecting(value => !value); setSelectedStepIds([]); }}><ListChecks size={17} />{batchSelecting ? '退出批量' : '批量报工'}</button><button type="button" disabled={refreshing} onClick={() => void load(undefined, true)}><RefreshCw className={refreshing ? 'spin' : ''} size={17} />刷新</button></div></header>
      {batchSelecting && <section className="field-report-batch-picker"><span><strong>选择本次一起完成的工序</strong><small>后台仍按每道工序分别记账和计算工时</small></span><div><button type="button" onClick={() => selectBatchSteps('backend')}>后端未完成</button><button type="button" onClick={() => selectBatchSteps('all')}>全部未完成</button><button type="button" onClick={() => selectBatchSteps('clear')}>清空</button></div></section>}
      <div className="field-report-step-list">
        {routeSteps.map((step, index) => {
          const snapshot = ticket.route?.steps.find(item => item.id === step.id);
          const changeNotice = stepChangeSnapshot(snapshot);
          const supplement = stepSupplementSnapshot(snapshot);
          const changeLabel = processRouteStepChangeLabel(changeNotice);
           const stepTargetQty = supplement?.actualRequiredQty ?? ticket.workOrder.targetQty;
          const stepReportedQty = supplement?.reportedQty ?? step.reportedQty;
          const stepCoveredQty = supplement?.reportedQty ?? step.coveredReportedQty;
           const baseState = resolveFieldReportStepPresentation({
            status: step.status,
            reportedQty: stepReportedQty,
            coveredReportedQty: stepCoveredQty,
            pendingCoverageQty: supplement ? 0 : step.pendingCoverageQty,
             targetQty: stepTargetQty,
           });
           const actionComplete = step.reportQuantityBasis === 'action'
             && step.reportedGoodUnitQty >= step.reportTargetQty
             && stepReportedQty >= stepTargetQty
             && step.pendingCoverageQty <= 0;
           const actionsFullSetsPending = step.reportQuantityBasis === 'action'
             && step.reportedGoodUnitQty >= step.reportTargetQty
             && stepReportedQty < stepTargetQty;
           const waitingForStrictInput = payload.context?.reportingPolicy === 'strict_sequence'
             && step.status === 'pending'
             && step.availableCoverageQty <= 0;
           const state = actionComplete
             ? { ...baseState, tone: 'completed' as const, label: '已报满' }
             : actionsFullSetsPending
               ? { ...baseState, tone: 'current' as const, label: '动作已报满·待形成整套' }
               : waitingForStrictInput
                 ? { ...baseState, tone: 'pending' as const, label: '等待前序' }
                 : payload.context?.reportingPolicy === 'free_sequence' && step.status === 'pending'
                   ? { ...baseState, tone: 'current' as const, label: '可提前报工' }
                   : baseState;
           const stepHasReportableQuantity = step.reportableQty > 0
             || (step.reportQuantityBasis === 'action' && step.reportableUnitQty > 0);
           const stepBlockedByPolicy = payload.context?.reportingPolicy === 'strict_sequence'
             && step.status === 'pending'
             && !supplement;
           const stepCanReport = stepHasReportableQuantity && !stepBlockedByPolicy;
           const isLast = index === routeSteps.length - 1;
          return <article className={`field-report-step tone-${state.tone}`} key={step.id}>
            <div className="field-report-step-rail"><b>{state.tone === 'completed' ? <Check size={17} /> : step.position}</b>{!isLast && <i />}</div>
            <div className="field-report-step-card">
              <header><span><small>第 {step.position} 道 · 顺序组 {step.sequenceGroup}</small><strong>{step.processName}{changeLabel && <i className="field-report-change-badge">{changeLabel}</i>}</strong></span><em>{state.label}</em></header>
              <div className="field-report-step-facts"><span><Clock3 size={14} />{standardTime(snapshot?.standardMillisecondsPerUnit || null, snapshot?.timeBasis || null, snapshot?.unitsPerProduct || 1)}</span><span>{step.reportQuantityBasis === 'action' ? <>{quantity(step.reportedGoodUnitQty)} / {quantity(step.reportTargetQty)} {step.reportUnitLabel}</> : <>{quantity(stepReportedQty)} / {quantity(stepTargetQty)} {step.unitLabel || ticket.workOrder.unitLabel}</>}</span></div>
              {step.reportQuantityBasis === 'action' && <small className="field-report-action-progress">整套流转：{quantity(stepReportedQty)} / {quantity(stepTargetQty)} {ticket.workOrder.unitLabel}；每套需 {quantity(step.unitsPerProduct)} {step.reportUnitLabel}</small>}
              {Boolean(changeNotice?.previousStandardMillisecondsPerUnit) && (changeNotice?.tag === 'TIME_CHANGED' || changeNotice?.tag === 'ADDED_AND_TIME_CHANGED') && <small className="field-report-change-time-note">原标准 {secondsFromMilliseconds(changeNotice.previousStandardMillisecondsPerUnit)} 秒 → 现标准 {secondsFromMilliseconds(snapshot?.standardMillisecondsPerUnit)} 秒</small>}
               {supplement && <p className="field-report-supplement-note"><GitPullRequestArrow size={14} />{supplement.fulfillmentMode === 'FUTURE_ONLY'
                 ? '该已开工路线按“仅未来生效”留存审计，不要求补报'
                 : supplement.actualRequiredQty === 0
                   ? `系统已按历史进度承接 ${quantity(supplement.systemCoveredQty)}，未生成任何人员报工或工时`
                   : supplement.systemCoveredQty > 0
                     ? `系统承接 ${quantity(supplement.systemCoveredQty)}，仅剩余 ${quantity(supplement.actualRequiredQty)} 需实际报工；不重复向后序转数量`
                     : '本工序独立补报，完成后不重复向后序转数量'}</p>}
              <div className="field-report-step-progress-detail">
                {step.reportQuantityBasis === 'action' && <>
                  <span><small>动作进度</small><b>{quantity(step.reportedGoodUnitQty)} / {quantity(step.reportTargetQty)}</b></span>
                  <div className="field-report-step-meter reported"><i style={{ width: `${Math.min(100, Math.round(step.reportedGoodUnitQty / Math.max(1, step.reportTargetQty) * 100))}%` }} /></div>
                </>}
                <span><small>{step.reportQuantityBasis === 'action' ? '整套流转' : '报工进度'}</small><b>{quantity(stepReportedQty)} / {quantity(stepTargetQty)}</b></span>
                <div className="field-report-step-meter reported"><i style={{ width: `${step.reportQuantityBasis === 'action' ? Math.min(100, Math.round(stepReportedQty / Math.max(1, stepTargetQty) * 100)) : state.reportingPercent}%` }} /></div>
                {!supplement && step.pendingCoverageQty > 0 && <>
                  <span className="coverage"><small>前序覆盖</small><b>{quantity(stepCoveredQty)} / {quantity(stepTargetQty)}</b></span>
                  <div className="field-report-step-meter coverage"><i style={{ width: `${state.coveragePercent}%` }} /></div>
                </>}
              </div>
              {step.pendingCoverageQty > 0 && <p><AlertTriangle size={14} />本工序已报 {quantity(stepReportedQty)}，其中 {quantity(step.pendingCoverageQty)} 等待前序数量补齐；不会重复开放报工</p>}
              {step.latestCompletion && <p className="field-report-latest-completion"><History size={14} /><span>最近：<b>{completionWorkerNames(step.latestCompletion)}</b> · {step.latestCompletion.reportQuantityBasis === 'action' ? <>{quantity(step.latestCompletion.reportedUnitQty)} {step.latestCompletion.reportUnitLabel} · {quantity(step.latestCompletion.processedQty)} {step.unitLabel || ticket.workOrder.unitLabel}</> : <>{quantity(step.latestCompletion.processedQty)} {step.unitLabel || ticket.workOrder.unitLabel}</>} · {dateTimeText(step.latestCompletion.completedAt)}</span></p>}
              <div className="field-report-step-actions">
                <button
                  className={batchSelecting && selectedStepIds.includes(step.id) ? 'batch-selected' : ''}
                  type="button"
                  disabled={!payload.currentEmployee || !payload.context || stepBlockedByPolicy || (batchSelecting && (!ticket.access.canReport || !stepCanReport || Boolean(supplement) || step.reportQuantityBasis === 'action'))}
                  onClick={() => batchSelecting ? toggleBatchStep(step.id) : void openReport(step.id)}
                >{stepBlockedByPolicy ? <><History size={17} />等待前序完成<ArrowRight size={17} /></> : !ticket.access.canReport || !stepHasReportableQuantity ? <><History size={17} />查看报工明细<ArrowRight size={17} /></> : batchSelecting && supplement ? <><GitPullRequestArrow size={17} />补充工序请单独报工</> : batchSelecting && step.reportQuantityBasis === 'action' ? <><CircleDot size={17} />按动作数量请单独报工</> : batchSelecting ? selectedStepIds.includes(step.id) ? <><Check size={17} />已加入批量报工</> : <><CircleDot size={17} />加入本次报工</> : <><CircleDot size={17} />选择此工序报工<ArrowRight size={17} /></>}</button>
                {!batchSelecting && <button className="abnormal" type="button" disabled={!payload.currentEmployee || (ticket.access.state !== 'READY' && ticket.access.state !== 'COMPLETED')} onClick={() => openAbnormalTime(step)}><TimerOff size={16} />登记异常工时</button>}
              </div>
            </div>
          </article>;
        })}
        {!routeSteps.length && <div className="field-report-no-route"><AlertTriangle size={24} /><strong>暂无可显示工序</strong><span>{ticket.access.message}</span></div>}
      </div>
      {batchSelecting && <div className="field-report-batch-dock"><span><small>本次已选</small><strong>{selectedStepIds.length} 道工序</strong></span><button type="button" disabled={selectedStepIds.length < 2} onClick={openBatchReport}>填写数量与人员<ArrowRight size={18} /></button></div>}
    </section>

    <footer className="field-report-footer"><PackageCheck size={17} /><span>一工单一码 · 所有报工记录实时同步生产执行、流程中心和员工达成率</span></footer>

    {success && <div className="field-report-success" role="dialog" aria-modal="true"><section><CheckCircle2 size={48} /><strong>{success.title}</strong><p>{success.detail}</p><button type="button" onClick={() => setSuccess(null)}>知道了，继续报工</button></section></div>}

    {fullQuantityConfirmOpen && <div className="field-report-confirm-backdrop" role="presentation">
      <section className="field-report-confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="field-report-full-qty-title">
        <AlertTriangle size={42} />
        <strong id="field-report-full-qty-title">确认报完全部剩余数量？</strong>
        <p>{reportMode === 'batch' ? '至少一道所选工序填了该工序全部剩余数量。' : actionReporting && reportedGoodUnitQty === payload.context?.reportableUnitQty ? `本次填写了全部剩余 ${quantity(payload.context?.reportableUnitQty || 0)} ${payload.context?.step.reportUnitLabel || '个'}合格动作。` : `本次填写了全部剩余 ${quantity(payload.context?.reportableQty || 0)} ${ticket.workOrder.unitLabel}。`} 请确认不是误触；提交后仍可从报工明细发起纠错。</p>
        <div><button type="button" disabled={saving} onClick={() => setFullQuantityConfirmOpen(false)}>返回核对</button><button type="button" disabled={saving} onClick={() => { setFullQuantityConfirmOpen(false); void submit(); }}>确认全部报工</button></div>
      </section>
    </div>}

    {correction && <div className="field-report-correction-backdrop" role="presentation">
      <section className="field-report-correction-dialog" role="dialog" aria-modal="true" aria-labelledby="field-report-correction-title">
        <header><span><small>专用撤回审批</small><strong id="field-report-correction-title">申请撤回误报</strong></span><button type="button" disabled={correction.saving} aria-label="关闭纠错窗口" onClick={() => setCorrection(null)}><X size={21} /></button></header>
        <div>
          <section className="field-report-correction-record"><History size={21} /><span><strong>{correction.data?.completion?.processName || payload.context?.step.processName} · {correction.completion.reportQuantityBasis === 'action' ? <>{quantity(correction.completion.reportedUnitQty)} {correction.completion.reportUnitLabel} · {quantity(correction.completion.processedQty)} {ticket.workOrder.unitLabel}</> : <>{quantity(correction.completion.processedQty)} {ticket.workOrder.unitLabel}</>}</strong><small>{completionWorkerNames(correction.completion)} · {dateTimeText(correction.completion.completedAt)}</small></span></section>
          {correction.loading ? <p className="field-report-correction-loading"><LoaderCircle className="spin" size={20} />正在核对数量、工时和后序影响...</p> : correction.data?.activeRequest ? <section className="field-report-correction-impact pending"><strong>已有待审批的撤回申请</strong><p>流程中心审批前不会改动原数量、工时和后续流转；请勿重复提交。申请时间：{dateTimeText(correction.data.activeRequest.createdAt)}</p></section> : <section className={`field-report-correction-impact ${correction.data?.preview?.canWithdraw ? 'safe' : 'blocked'}`}><strong>{correction.data?.preview?.canWithdraw ? '提交后由主管审批执行' : '检测到撤回阻断，仍可提交主管复核'}</strong><p>{correction.data?.preview?.canWithdraw
            ? correction.data.preview.impact.downstreamPendingQty > 0
              ? `审批通过后，下道报工保留，${quantity(correction.data.preview.impact.downstreamPendingQty)} ${ticket.workOrder.unitLabel}恢复为待前序覆盖；下道员工工时不撤销。`
              : `审批通过后，将冲销本笔数量和对应的 ${correction.data.preview.impact.laborClaimCount} 笔工时领取。`
            : `${correction.data?.preview?.blockers.map(blocker => blocker.message).join('；') || '当前无法自动撤回'}。主管审批时会再次复核；仍被阻断时记入撤回异常，不会转入问题中心。`}</p></section>}
          {!correction.loading && !correction.data?.activeRequest && correction.data?.requests?.[0] && <section className="field-report-correction-impact previous"><strong>上次申请：{withdrawalRequestStatusText(correction.data.requests[0].status)}</strong><p>{correction.data.requests[0].decisionNote || `处理时间：${dateTimeText(correction.data.requests[0].updatedAt)}`}</p></section>}
          <label><span>错误说明 / 正确数量（选填）</span><textarea rows={4} maxLength={500} disabled={correction.loading || correction.saving} value={correction.reason} placeholder="可不填写；如需说明，可写正确数量或误报情况" onChange={event => setCorrection({ ...correction, reason: event.target.value, error: '' })} /></label>
          {correction.error && <p className="field-report-form-error" role="alert">{correction.error}</p>}
        </div>
        <footer><span>申请、审批、冲销或异常结果都会保留操作日志。</span>{correction.data?.activeRequest ? <button type="button" disabled={correction.loading || correction.saving} onClick={() => void cancelCorrectionRequest()}>{correction.saving ? <><LoaderCircle className="spin" size={18} />正在取消...</> : <><X size={18} />取消待审批申请</>}</button> : <button type="button" disabled={correction.loading || correction.saving || !correction.data?.canRequestCorrection} onClick={() => void submitCorrection()}>{correction.saving ? <><LoaderCircle className="spin" size={18} />正在提交...</> : <><RotateCcw size={18} />提交撤回申请</>}</button>}</footer>
      </section>
    </div>}

    {abnormalDraft && <div className="field-report-abnormal-backdrop" role="presentation">
      <section className="field-report-abnormal-sheet" role="dialog" aria-modal="true" aria-labelledby="field-report-abnormal-title">
        <header><span><small>独立登记 · 不改变报工数量</small><strong id="field-report-abnormal-title">{abnormalDraft.processName}</strong><em>异常工时</em></span><button type="button" disabled={abnormalSaving} aria-label="关闭异常登记" onClick={() => setAbnormalDraft(null)}><X size={22} /></button></header>
        <div>
          <section className="field-report-abnormal-notice"><ShieldCheck size={21} /><span><strong>不填不影响正常报工</strong><small>本记录单独送主管审核；审核通过后完整计入个人解释工时，不增加标准产出工时。</small></span></section>
          <div className="field-report-abnormal-grid">
            <label><span>问题分类 <b>必填</b></span><select value={abnormalDraft.category} disabled={abnormalSaving} onChange={event => setAbnormalDraft({ ...abnormalDraft, category: event.target.value as FieldAbnormalTimeDraft['category'], error: '' })}><option value="">请选择</option>{ABNORMAL_TIME_CATEGORIES.map(item => <option value={item.value} key={item.value}>{item.label}</option>)}</select></label>
            <label><span>异常时长 <b>必填</b></span><div><input inputMode="numeric" type="number" min="1" step="1" value={abnormalDraft.durationMinutes} disabled={abnormalSaving} onFocus={event => event.currentTarget.select()} onChange={event => setAbnormalDraft({ ...abnormalDraft, durationMinutes: event.target.value, error: '' })} /><em>分钟</em></div></label>
            <label className="wide"><span>异常日期 <b>必填</b></span><input type="date" max={todayKey()} value={abnormalDraft.workDate} disabled={abnormalSaving} onChange={event => setAbnormalDraft({ ...abnormalDraft, workDate: event.target.value, error: '' })} /></label>
            <label><span>受影响数量 <i>可选</i></span><div><input inputMode="numeric" type="number" min="1" step="1" value={abnormalDraft.affectedQuantity} disabled={abnormalSaving} onChange={event => setAbnormalDraft({ ...abnormalDraft, affectedQuantity: event.target.value, error: '' })} /><em>{ticket.workOrder.unitLabel}</em></div></label>
            <label><span>细分原因 <i>可选</i></span><input value={abnormalDraft.subcategory} maxLength={100} disabled={abnormalSaving} onChange={event => setAbnormalDraft({ ...abnormalDraft, subcategory: event.target.value })} placeholder="例如等待确认、设备停机" /></label>
          </div>
          <section className="field-report-abnormal-workers">
            <header><span><strong>受影响员工 <b>必填</b></strong><small>本人已锁定，可添加共同受影响人员。</small></span><em>{abnormalDraft.employeeIds.length} 人</em></header>
            <div>{(payload.context?.employees || [payload.currentEmployee]).filter((employee): employee is EmployeeOption => Boolean(employee)).map(employee => {
              const checked = abnormalDraft.employeeIds.includes(employee.id);
              const locked = employee.id === currentEmployeeId;
              return <label className={checked ? 'selected' : ''} key={employee.id}><input type="checkbox" checked={checked} disabled={abnormalSaving || locked} onChange={() => setAbnormalDraft({ ...abnormalDraft, employeeIds: checked ? abnormalDraft.employeeIds.filter(id => id !== employee.id) : [...abnormalDraft.employeeIds, employee.id], error: '' })} /><span><strong>{employee.name}{locked && <em>本人</em>}</strong><small>{employee.employeeNo} · {employee.team || employee.position || '班组待维护'}</small></span></label>;
            })}</div>
          </section>
          <section className={`field-report-abnormal-more${abnormalMoreOpen ? ' open' : ''}`}>
            <button type="button" aria-expanded={abnormalMoreOpen} disabled={abnormalSaving} onClick={() => setAbnormalMoreOpen(value => !value)}><strong>补充信息</strong><span>以下全部可留空</span><ChevronDown size={17} /></button>
            {abnormalMoreOpen && <div>
              <label><span>具体原因</span><textarea rows={3} maxLength={1000} value={abnormalDraft.reason} disabled={abnormalSaving} onChange={event => setAbnormalDraft({ ...abnormalDraft, reason: event.target.value })} placeholder="可记录现场现象或等待事项" /></label>
              <label><span>责任部门</span><input maxLength={100} value={abnormalDraft.responsibilityDepartment} disabled={abnormalSaving} onChange={event => setAbnormalDraft({ ...abnormalDraft, responsibilityDepartment: event.target.value })} /></label>
              <label><span>责任对象</span><input maxLength={160} value={abnormalDraft.responsibilityObject} disabled={abnormalSaving} onChange={event => setAbnormalDraft({ ...abnormalDraft, responsibilityObject: event.target.value })} placeholder="人员、供应商、设备或其他对象" /></label>
            </div>}
          </section>
          {abnormalDraft.error && <p className="field-report-form-error" role="alert">{abnormalDraft.error}</p>}
        </div>
        <footer><span>异常登记失败也不会影响正常报工</span><button type="button" disabled={abnormalSaving || !abnormalDraft.category || !Number(abnormalDraft.durationMinutes)} onClick={() => void submitAbnormalTime()}>{abnormalSaving ? <><LoaderCircle className="spin" size={19} />正在登记...</> : <><TimerOff size={19} />提交主管审核</>}</button></footer>
      </section>
    </div>}

    {sheetOpen && payload.context && form && <div className="field-report-sheet-backdrop" role="presentation">
      <section className="field-report-sheet" role="dialog" aria-modal="true" aria-labelledby="field-report-sheet-title">
        <header><span><small>{reportMode === 'batch' ? '批量工序报工' : hasReportableQuantity && ticket.access.canReport ? payload.context.reportingPolicy === 'strict_sequence' ? '严格按流程报工' : '工序自由报工' : '报工记录与纠错'}</small><strong id="field-report-sheet-title">{reportMode === 'batch' ? `${batchItems.length} 道工序` : payload.context.step.processName}</strong><em>{reportMode === 'batch' ? '一次提交 · 分别记账' : `第 ${payload.context.step.position} 道`}</em></span><button type="button" disabled={saving} aria-label="关闭报工窗口" onClick={() => setSheetOpen(false)}><X size={22} /></button></header>
        <div className="field-report-sheet-scroll">
          {reportMode === 'batch' && <section className="field-report-batch-summary"><ListChecks size={22} /><span><strong>{batchItems.map(item => item.processName).join('、')}</strong><small>系统将按工艺顺序提交，连续工序自动正常流转，跨序工序进入待前序覆盖。</small></span></section>}
          {(reportMode === 'batch' || (ticket.access.canReport && hasReportableQuantity)) && <section className="field-report-date-card"><CalendarDays size={24} /><label><span>生产日期</span><input type="date" max={todayKey()} value={form.workDate} disabled={saving} onChange={event => setForm({ ...form, workDate: event.target.value, wipAllocationId: '' })} /></label><strong>请务必核对</strong></section>}

          {availableWipAllocations.length > 0 && <section className="field-report-source-card">
            <header><PackageCheck size={23} /><span><strong>报工来源</strong><small>请选择“原订单”或具体“半成品批次”，系统按所选来源扣减数量</small></span></header>
            <div className="field-report-source-options" role="radiogroup" aria-label="选择报工来源">
              <button type="button" role="radio" aria-checked={!form.wipAllocationId} className={!form.wipAllocationId ? 'selected native' : 'native'} disabled={saving} onClick={() => setForm({ ...form, wipAllocationId: '' })}><CircleDot size={18} /><span><strong>原订单未转出数量</strong><small>不消耗任何半成品批次</small></span><em>原订单</em></button>
              {availableWipAllocations.map(allocation => <button type="button" role="radio" aria-checked={form.wipAllocationId === allocation.id} className={form.wipAllocationId === allocation.id ? 'selected wip' : 'wip'} disabled={saving} key={allocation.id} onClick={() => setForm({ ...form, wipAllocationId: allocation.id })}><CircleDot size={18} /><span><strong>半成品批次 {allocation.lotNo}</strong><small>{allocation.containerCode ? `容器 ${allocation.containerCode} · ` : ''}{allocation.targetWeekStartDate} 至 {allocation.targetWeekEndDate} · {allocation.quantity} 件</small><small>{allocation.workers.length ? `计划人员：${allocation.workers.map(worker => worker.name).join('、')}` : '人员待安排，现场仍可核对实际作业人'}</small></span><em>半成品</em></button>)}
            </div>
            <footer>同一个产品二维码继续使用，页面只展示中文业务选项</footer>
          </section>}

          {advanceReporting && <section className="field-report-advance"><AlertTriangle size={21} /><span><strong>本次属于提前报工</strong><small>允许先报当前工序，数量不会变成负数；前序补齐后系统自动覆盖并恢复正常流转。</small></span></section>}
          {selectedSupplement && <section className="field-report-advance supplement"><GitPullRequestArrow size={21} /><span><strong>NEW · 剩余数量实际报工</strong><small>{selectedSupplement.systemCoveredQty > 0 ? `系统已承接 ${quantity(selectedSupplement.systemCoveredQty)}，本次只记录剩余 ${quantity(selectedSupplement.actualRequiredQty)} 的实际人员与工时；` : ''}原后序已报完成保持不变。</small></span></section>}

          {reportMode === 'single' && <section className="field-report-history">
            <header><span><strong>最近报工记录</strong><small>现场可直接看到报工人、数量和时间；每笔记录独立纠错。</small></span><em>{payload.context.recentCompletions.length} 笔</em></header>
            <div>{payload.context.recentCompletions.map(completion => {
              const selfQrReport = ['QR_MOBILE', 'SHARED_TERMINAL_PIN', 'SUPPLEMENT_OBLIGATION'].includes(completion.reportSource)
                && (
                  completion.principalEmployee?.id === currentEmployeeId
                  || (!completion.principalEmployee && completion.submittedBy?.id === user.id)
                );
              const coverageLabel = completion.pendingCoverageQty > 0
                ? `待前序覆盖 ${quantity(completion.pendingCoverageQty)}`
                : '已覆盖';
              return <article key={completion.id}>
                <div><span><strong>{completion.principalEmployee?.name || completion.submittedBy?.name || '报工人待核对'}</strong><em className={completion.pendingCoverageQty > 0 ? 'pending' : ''}>{coverageLabel}</em></span><small>作业人员：{completionWorkerNames(completion)}</small><small>{dateTimeText(completion.completedAt)} · {completion.reportSource === 'QR_MOBILE' ? '手机扫码' : completion.reportSource === 'SHARED_TERMINAL_PIN' ? '共享终端' : '电脑端'}</small></div>
                <b>{completion.reportQuantityBasis === 'action'
                  ? <>{quantity(completion.reportedUnitQty)} <small>{completion.reportUnitLabel}</small><em>{quantity(completion.processedQty)} {ticket.workOrder.unitLabel}</em></>
                  : <>{quantity(completion.processedQty)} <small>{ticket.workOrder.unitLabel}</small></>}</b>
                <button type="button" disabled={saving} onClick={() => void openCorrection(completion)}><RotateCcw size={15} />{selfQrReport ? '申请撤回误报' : '报告数量有误'}</button>
              </article>;
            })}</div>
            {!payload.context.recentCompletions.length && <p>该工序还没有报工记录。</p>}
          </section>}

          {reportMode === 'batch' ? <>
            <section className="field-report-quantity-card field-report-batch-quantity">
              <header><span><strong>统一报工数量</strong><small>修改后将同步到全部选中工序，下面仍可逐道调整。</small></span><em>{batchItems.length} 道工序</em></header>
              <div><label><span>每道工序数量</span><div><input inputMode="numeric" pattern="[0-9]*" min="0" value={form.processedQty} disabled={saving} onFocus={event => event.currentTarget.select()} onChange={event => setCommonBatchQuantity(event.target.value)} /><em>{ticket.workOrder.unitLabel}</em></div></label></div>
              <footer><span>将生成独立报工记录</span><strong>{batchItems.length} <small>条</small></strong></footer>
            </section>
            <section className="field-report-batch-items">
              <header><span><strong>逐道核对</strong><small>有差异时可单独修改数量或不良品。</small></span></header>
              {batchItems.map((item, index) => <article key={item.stepId}>
                <span><b>{String(item.position).padStart(2, '0')}</b><strong>{item.processName}</strong></span>
                <label><small>报工</small><div><input inputMode="numeric" pattern="[0-9]*" min="0" value={item.processedQty} disabled={saving} onFocus={event => event.currentTarget.select()} onChange={event => setBatchItems(items => items.map((entry, itemIndex) => itemIndex === index ? { ...entry, processedQty: event.target.value } : entry))} /><em>{ticket.workOrder.unitLabel}</em></div></label>
                <label><small>不良</small><div><input inputMode="numeric" pattern="[0-9]*" min="0" value={item.defectQty} disabled={saving} onChange={event => setBatchItems(items => items.map((entry, itemIndex) => itemIndex === index ? { ...entry, defectQty: event.target.value } : entry))} /><em>{ticket.workOrder.unitLabel}</em></div></label>
                {Number(item.defectQty) > 0 && <select value={item.defectDisposition} disabled={saving} aria-label={`${item.processName}不良品处理方式`} onChange={event => setBatchItems(items => items.map((entry, itemIndex) => itemIndex === index ? { ...entry, defectDisposition: event.target.value as 'rework' | 'scrap_replenish' } : entry))}><option value="rework">返工</option>{!ticket.workOrder.parentWorkOrderId && <option value="scrap_replenish">报废补产</option>}</select>}
              </article>)}
            </section>
          </> : ticket.access.canReport && hasReportableQuantity ? <section className={`field-report-quantity-card${actionReporting ? ' action-quantity' : ''}`}>
            <header><span><strong>{actionReporting ? '实际动作与整套流转' : '本次报工数量'}</strong><small>{actionReporting ? `剩余合格动作 ${quantity(payload.context.reportableUnitQty)} ${payload.context.step.reportUnitLabel}` : `剩余可报 ${quantity(payload.context.reportableQty)} ${ticket.workOrder.unitLabel}`}</small></span><em>{selectedSupplement ? `补充义务剩余 ${quantity(payload.context.reportableQty)}` : `已到料可覆盖 ${quantity(payload.context.remainingInputQty)}`}</em></header>
            {actionReporting ? <>
              <p className="field-report-action-guidance">实际动作量用于计算工时；整套完成量才推进下一工序。每套标准为 {quantity(payload.context.step.unitsPerProduct)} {payload.context.step.reportUnitLabel}。</p>
              <div className="field-report-action-grid">
                <label><span>实际动作数量</span><div><input inputMode="numeric" pattern="[0-9]*" min="0" value={form.reportedUnitQty} disabled={saving} onFocus={event => event.currentTarget.select()} onChange={event => setForm({ ...form, reportedUnitQty: event.target.value })} /><em>{payload.context.step.reportUnitLabel}</em></div></label>
                <label><span>动作不良</span><div><input inputMode="numeric" pattern="[0-9]*" min="0" max={reportedUnitQty} value={form.reportedDefectUnitQty} disabled={saving} onFocus={event => event.currentTarget.select()} onChange={event => setForm({ ...form, reportedDefectUnitQty: event.target.value })} /><em>{payload.context.step.reportUnitLabel}</em></div></label>
                <label><span>形成完整产品</span><div><input inputMode="numeric" pattern="[0-9]*" min="0" max={payload.context.reportableQty} value={form.processedQty} disabled={saving} onFocus={event => event.currentTarget.select()} onChange={event => setForm({ ...form, processedQty: event.target.value })} /><em>{ticket.workOrder.unitLabel}</em></div></label>
                <label><span>整套不良</span><div><input inputMode="numeric" pattern="[0-9]*" min="0" max={processedQty} value={form.defectQty} disabled={saving} onFocus={event => event.currentTarget.select()} onChange={event => setForm({ ...form, defectQty: event.target.value })} /><em>{ticket.workOrder.unitLabel}</em></div></label>
              </div>
              <footer><span>本次合格动作 / 整套良品</span><strong>{quantity(reportedGoodUnitQty)} <small>{payload.context.step.reportUnitLabel}</small> · {quantity(goodQty)} <small>{ticket.workOrder.unitLabel}</small></strong></footer>
            </> : <>
              <div><label><span>实际报工</span><div><input inputMode="numeric" pattern="[0-9]*" min="0" max={payload.context.reportableQty} value={form.processedQty} disabled={saving} onFocus={event => event.currentTarget.select()} onChange={event => setForm({ ...form, processedQty: event.target.value })} /><em>{ticket.workOrder.unitLabel}</em></div></label>{!selectedSupplement && <label><span>不良品</span><div><input inputMode="numeric" pattern="[0-9]*" min="0" max={processedQty} value={form.defectQty} disabled={saving} onFocus={event => event.currentTarget.select()} onChange={event => setForm({ ...form, defectQty: event.target.value })} /><em>{ticket.workOrder.unitLabel}</em></div></label>}</div>
              <footer><span>{selectedSupplement ? '本次补充报工' : '本次良品'}</span><strong>{quantity(selectedSupplement ? processedQty : goodQty)} <small>{ticket.workOrder.unitLabel}</small></strong></footer>
            </>}
          </section> : <section className="field-report-history-only"><CheckCircle2 size={22} /><span><strong>该工序当前没有剩余可报数量</strong><small>仍可查看上方记录并发起纠错；撤回成功后数量会重新开放。</small></span></section>}

          {reportMode === 'single' && ticket.access.canReport && hasReportableQuantity && !selectedSupplement && defectQty > 0 && <fieldset className="field-report-defect"><legend>整套不良品处理方式</legend>{([
            ['rework', '返工', '从当前工序重新处理'],
            ...(!ticket.workOrder.parentWorkOrderId ? [['scrap_replenish', '报废补产', '创建补产分支工单'] as const] : []),
            ['quality_pending', '质量待判', '暂停并等待质量确认'],
          ] as const).map(option => <label className={form.defectDisposition === option[0] ? 'selected' : ''} key={option[0]}><input type="radio" name="field-defect" checked={form.defectDisposition === option[0]} disabled={saving} onChange={() => setForm({ ...form, defectDisposition: option[0] })} /><span><strong>{option[1]}</strong><small>{option[2]}</small></span></label>)}</fieldset>}

          {(reportMode === 'batch' || (ticket.access.canReport && hasReportableQuantity)) && <section className="field-report-workers">
            <header><span><strong>作业人员</strong><small>本人已锁定，协作人员可继续添加；工时自动平均分配。</small></span><em>{form.employeeIds.length} 人</em></header>
            {payload.currentEmployee && <div className="field-report-self"><UserRoundCheck size={20} /><span><small>登录身份自动带入</small><strong>{payload.currentEmployee.employeeNo} · {payload.currentEmployee.name}</strong></span><b>本人</b></div>}
            {selectedWipAllocation?.workers.length ? <div className="field-report-preset wip"><Users size={18} /><span><strong>半成品计划人员</strong><small>{selectedWipAllocation.workers.map(worker => worker.name).join('、')}</small></span><button type="button" disabled={saving} onClick={() => setForm({ ...form, employeeIds: [...new Set([currentEmployeeId, ...selectedWipAllocation.workers.map(worker => worker.employeeId)])] })}>一键添加</button></div> : payload.context.workerPreset && <div className="field-report-preset"><Users size={18} /><span><strong>本周预选人员</strong><small>{payload.context.workerPreset.employees.map(employee => employee.name).join('、') || '暂无'}</small></span><button type="button" disabled={saving || !payload.context.workerPreset.employees.length} onClick={() => setForm({ ...form, employeeIds: [...new Set([currentEmployeeId, ...payload.context!.workerPreset!.employees.map(employee => employee.id)])] })}>一键添加</button></div>}
            <label className="field-report-worker-search"><Search size={17} /><input value={employeeSearch} disabled={saving} onChange={event => setEmployeeSearch(event.target.value)} placeholder="搜索姓名、工号或班组" /></label>
            <div className="field-report-worker-grid">{visibleEmployees.filter(employee => employee.id !== currentEmployeeId).map(employee => {
              const checked = form.employeeIds.includes(employee.id);
              const preferred = preferredIds.has(employee.id);
              return <label className={`${checked ? 'selected ' : ''}${preferred ? 'preferred' : ''}`} key={employee.id}><input type="checkbox" checked={checked} disabled={saving} onChange={() => { setExceptionConfirmed(false); setForm({ ...form, employeeIds: checked ? form.employeeIds.filter(id => id !== employee.id) : [...form.employeeIds, employee.id] }); }} /><span><strong>{employee.name}{preferred && <em>预选</em>}</strong><small>{employee.employeeNo} · {employee.team || employee.position || '班组待维护'}</small></span></label>;
            })}</div>
            {!employeeSearch && orderedEmployees.length > 8 && <button className="field-report-show-workers" type="button" onClick={() => setShowAllEmployees(value => !value)}>{showAllEmployees ? '收起人员列表' : `查看全部 ${orderedEmployees.length} 名生产员工`}<ChevronDown size={16} /></button>}
            {nonPreferredCollaborators.length > 0 && <label className="field-report-worker-confirm"><input type="checkbox" checked={exceptionConfirmed} disabled={saving} onChange={event => setExceptionConfirmed(event.target.checked)} /><AlertTriangle size={18} /><span><strong>包含非预选协作人员</strong><small>请确认 {nonPreferredCollaborators.map(employee => employee.name).join('、')} 确实参与本次作业。</small></span></label>}
          </section>}

          {(reportMode === 'batch' || (ticket.access.canReport && hasReportableQuantity)) && <details className="field-report-more"><summary>补充现场信息 <span>班组、工位、备注</span></summary><div><label><span>班组</span><input value={form.team} maxLength={80} disabled={saving} onChange={event => setForm({ ...form, team: event.target.value })} /></label><label><span>工位 / 设备</span><input value={form.workstation} maxLength={80} disabled={saving} onChange={event => setForm({ ...form, workstation: event.target.value })} /></label><label><span>现场备注</span><textarea value={form.remark} rows={2} maxLength={500} disabled={saving} onChange={event => setForm({ ...form, remark: event.target.value })} /></label></div></details>}
          {formError && <div className="field-report-form-error" role="alert">{formError}</div>}
        </div>
        {(reportMode === 'batch' || (ticket.access.canReport && hasReportableQuantity)) && <footer><span>{invalid ? nonPreferredCollaborators.length && !exceptionConfirmed ? '请核对非预选协作人员' : actionReporting ? '请填写实际动作数量；形成整套后再填写整套数量' : '数量默认 0，请输入本次实际完成数量' : `将为 ${form.employeeIds.length} 人自动记入标准工时`}</span><button type="button" disabled={saving || invalid} onClick={requestSubmit}>{saving ? <><LoaderCircle className="spin" size={19} />正在提交...</> : <><CheckCircle2 size={19} />{reportMode === 'batch' ? `确认批量报工 ${batchItems.length} 道` : '确认报工并自动记工'}</>}</button></footer>}
      </section>
    </div>}
  </main>;
}
