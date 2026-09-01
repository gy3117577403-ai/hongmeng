'use client';

import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  Clock3,
  Factory,
  History,
  Layers3,
  LoaderCircle,
  PackageOpen,
  RefreshCw,
  RotateCcw,
  Search,
  Undo2,
  Warehouse,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppWorkbenchHeader } from '@/components/layout/AppWorkbenchHeader';
import { publishProductionDataInvalidation } from '@/lib/production-data-client-sync';
import type { CurrentUserDTO } from '@/types';

type Candidate = {
  id: string;
  batchNo: number;
  workOrderId: string;
  workOrderCode: string;
  customerName: string;
  productName: string;
  specification: string;
  quantity: number;
  availableQuantity: number;
  weekStartDate: string;
  weekEndDate: string;
  routeStatus: string;
  completedProcessCount: number;
  processCount: number;
  materialStatus: string;
  materialExceptionType: string | null;
  productionPaused: boolean;
};

type Allocation = {
  id: string;
  version: number;
  sourceAllocationId: string | null;
  targetWeekStartDate: string;
  targetWeekEndDate: string;
  team: { id: string; name: string } | null;
  quantity: number;
  plannedHours: number;
  completedQty: number;
  completedHours: number;
  status: string;
  reason: string;
  scheduledBy: { id: string; displayName: string };
  scheduledAt: string;
  supersededAt: string | null;
  steps: Array<{
    id: string;
    stepId: string;
    processName: string;
    position: number;
    plannedQty: number;
    completedQty: number;
    remainingQty: number;
    plannedHours: number;
    completedHours: number;
    remainingHours: number;
    status: string;
  }>;
};

type Lot = {
  id: string;
  version: number;
  lotNo: string;
  kind: string;
  productionPlanBatchId: string;
  workOrderId: string;
  workOrderCode: string;
  customerName: string;
  productName: string;
  specification: string;
  batchNo: number;
  sourceWeekStartDate: string;
  sourceWeekEndDate: string;
  quantity: number;
  scheduledQuantity: number;
  unscheduledQuantity: number;
  locationCode: string | null;
  containerCode: string | null;
  materialStatusSnapshot: string | null;
  physicalStatus: string;
  scheduleStatus: string;
  reason: string;
  remainingHours: number;
  enteredAt: string;
  enteredBy: { id: string; displayName: string };
  steps: Array<{
    id: string;
    stepId: string;
    processName: string;
    position: number;
    remainingQty: number;
    remainingHours: number;
    status: string;
  }>;
  allocations: Allocation[];
};

type WipPayload = {
  permissions: { canWrite: boolean };
  summary: {
    lotCount: number;
    totalQuantity: number;
    unscheduledQuantity: number;
    scheduledQuantity: number;
    totalRemainingHours: number;
  };
  weeks: Array<{
    startDate: string;
    endDate: string;
    label: string;
    plannedQuantity: number;
    plannedHours: number;
    lotCount: number;
  }>;
  teams: Array<{ id: string; code: string; name: string }>;
  candidates: Candidate[];
  lots: Lot[];
};

type EntryPreview = {
  batchId: string;
  sourceWeekStartDate: string;
  sourceWeekEndDate: string;
  quantity: number;
  availableQuantity: number;
  kind: string;
  completedSteps: Array<{ id: string; processName: string; position: number }>;
  remainingSteps: Array<{
    id: string;
    processName: string;
    position: number;
    remainingQty: number;
    remainingHours: number;
  }>;
  remainingHours: number;
  materialWarning: string | null;
};

type EntryDraft = {
  quantity: string;
  reasonCode: string;
  reason: string;
  locationCode: string;
  containerCode: string;
};

type RescheduleDraft = {
  targetWeekStartDate: string;
  teamId: string;
  reasonCode: 'MATERIAL_CHANGE' | 'CAPACITY_BALANCE' | 'CUSTOMER_CHANGE' | 'OTHER';
  note: string;
};

type RescheduleResult = {
  allocationId: string;
  targetWeekStartDate: string;
  targetWeekEndDate: string;
};

type ReversalPreview = {
  action: 'UNSCHEDULE_ALLOCATION' | 'RETURN_TO_SOURCE_ORDER';
  allocationId?: string;
  allocationVersion?: number;
  lotId: string;
  lotVersion?: number;
  lotNo: string;
  workOrderId: string;
  workOrderCode: string;
  targetWeekStartDate?: string;
  targetWeekEndDate?: string;
  sourceWeekStartDate?: string;
  sourceWeekEndDate?: string;
  quantity: number;
  plannedHours?: number;
  activeAllocationCount?: number;
  physicalStatus?: string;
  locationCode?: string | null;
  containerCode?: string | null;
  requiresPhysicalReturnConfirmation?: boolean;
  resultScheduleStatus?: string;
  preservesProductionFacts: true;
};

type ReversalDraft = {
  kind: 'unschedule' | 'return';
  allocation: Allocation | null;
  lot: Lot;
  reason: string;
  physicalReturnConfirmed: boolean;
  preview: ReversalPreview | null;
  error: string;
};

const emptyData: WipPayload = {
  permissions: { canWrite: false },
  summary: { lotCount: 0, totalQuantity: 0, unscheduledQuantity: 0, scheduledQuantity: 0, totalRemainingHours: 0 },
  weeks: [],
  teams: [],
  candidates: [],
  lots: [],
};

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    UNSCHEDULED: '待排程',
    PARTIALLY_SCHEDULED: '部分已排',
    SCHEDULED: '已排程',
    IN_PROGRESS: '生产中',
    COMPLETED: '已完成',
    CANCELLED: '已取消',
    ACTIVE: '待执行',
    SUPERSEDED: '已改排',
    VIRTUAL: '虚拟在仓',
    STORED: '已入库',
    ISSUED: '已发料',
  };
  return labels[status] || status;
}

function newRequestKey(prefix: string): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? `${prefix}:${crypto.randomUUID()}`
    : `${prefix}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

function productionExecutionLink(input: {
  targetWeekStartDate: string;
  targetWeekEndDate: string;
  workOrderId: string;
  allocationId: string;
  weeks: WipPayload['weeks'];
}): string {
  const index = input.weeks.findIndex(week => week.startDate === input.targetWeekStartDate);
  const scope = index === 0 ? 'current' : index === 1 ? 'next' : index === 2 ? 'afterNext' : 'history';
  const params = new URLSearchParams({
    scope,
    workOrderId: input.workOrderId,
    wipAllocationId: input.allocationId,
  });
  if (scope === 'history') {
    params.set('weekStart', input.targetWeekStartDate);
    params.set('weekEnd', input.targetWeekEndDate);
  }
  return `/production?${params.toString()}`;
}

async function responseData<T>(response: Response): Promise<{ data?: T; error?: string }> {
  return response.json().catch(() => ({}));
}

export default function WipWarehouseShell({
  user,
  initialBatchId,
  initialView,
  initialWeekStartDate,
  initialAllocationId,
}: {
  user: CurrentUserDTO;
  initialBatchId: string;
  initialView: string;
  initialWeekStartDate: string;
  initialAllocationId: string;
}) {
  const [data, setData] = useState<WipPayload>(emptyData);
  const [keyword, setKeyword] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [selectedLotId, setSelectedLotId] = useState('');
  const [entryCandidate, setEntryCandidate] = useState<Candidate | null>(null);
  const [entryDraft, setEntryDraft] = useState<EntryDraft>({
    quantity: '',
    reasonCode: 'PRODUCTION_INTERRUPTED',
    reason: '本周无法继续剩余工序，转入半成品仓等待重新安排',
    locationCode: '',
    containerCode: '',
  });
  const [entryPreview, setEntryPreview] = useState<EntryPreview | null>(null);
  const [scheduleDraft, setScheduleDraft] = useState({ quantity: '', week: '', teamId: '', reason: '安排剩余半成品工序到目标生产周' });
  const [rescheduleAllocation, setRescheduleAllocation] = useState<Allocation | null>(null);
  const [rescheduleDraft, setRescheduleDraft] = useState<RescheduleDraft>({
    targetWeekStartDate: '',
    teamId: '',
    reasonCode: 'MATERIAL_CHANGE',
    note: '物料到货时间变化，改排剩余未完成工序',
  });
  const [rescheduleResult, setRescheduleResult] = useState<RescheduleResult | null>(null);
  const [rescheduleError, setRescheduleError] = useState('');
  const [reversalDraft, setReversalDraft] = useState<ReversalDraft | null>(null);
  const rescheduleDialogRef = useRef<HTMLElement | null>(null);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (keyword.trim()) params.set('keyword', keyword.trim());
      if (initialBatchId) params.set('batchId', initialBatchId);
      const response = await fetch(`/api/wip?${params.toString()}`, { cache: 'no-store' });
      const body = await responseData<WipPayload>(response);
      if (!response.ok || !body.data) throw new Error(body.error || '半成品仓加载失败');
      setData(body.data);
      setSelectedLotId(current => {
        if (current && body.data!.lots.some(lot => lot.id === current)) return current;
        const linkedLot = initialAllocationId
          ? body.data!.lots.find(lot => lot.allocations.some(allocation => allocation.id === initialAllocationId))
          : null;
        const weekLot = initialWeekStartDate
          ? body.data!.lots.find(lot => lot.allocations.some(allocation => (
            allocation.targetWeekStartDate === initialWeekStartDate
            && ['ACTIVE', 'IN_PROGRESS', 'COMPLETED'].includes(allocation.status)
          )))
          : null;
        return linkedLot?.id || weekLot?.id || body.data!.lots[0]?.id || '';
      });
      if (initialBatchId && body.data.candidates[0] && !entryCandidate) {
        const candidate = body.data.candidates[0];
        setEntryCandidate(candidate);
        setEntryDraft(current => ({ ...current, quantity: String(candidate.availableQuantity) }));
      } else if (initialBatchId && body.data.candidates.length === 0) {
        setError('该工单当前暂无可转数量：可能已全部转入半成品仓，或末道工序已全部完工。');
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '半成品仓加载失败');
    } finally {
      setLoading(false);
    }
  }, [entryCandidate, initialAllocationId, initialBatchId, initialWeekStartDate, keyword]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(''), 3_000);
    return () => window.clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (!rescheduleAllocation) return undefined;
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = 'hidden';
    const frame = window.requestAnimationFrame(() => rescheduleDialogRef.current?.focus());
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !saving) {
        event.preventDefault();
        setRescheduleAllocation(null);
        setRescheduleResult(null);
        setRescheduleError('');
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
      previousFocus?.focus({ preventScroll: true });
    };
  }, [rescheduleAllocation, saving]);

  const lotView = ['scheduled', 'unscheduled'].includes(initialView) ? initialView : 'all';
  const visibleLots = useMemo(() => data.lots.filter(lot => {
    if (lotView === 'unscheduled' && lot.unscheduledQuantity <= 0) return false;
    if (lotView === 'scheduled' && !lot.allocations.some(allocation => (
      ['ACTIVE', 'IN_PROGRESS', 'COMPLETED'].includes(allocation.status)
      && (!initialWeekStartDate || allocation.targetWeekStartDate === initialWeekStartDate)
    ))) return false;
    if (lotView === 'all' && initialWeekStartDate && !lot.allocations.some(allocation => (
      ['ACTIVE', 'IN_PROGRESS', 'COMPLETED'].includes(allocation.status)
      && allocation.targetWeekStartDate === initialWeekStartDate
    ))) return false;
    return true;
  }), [data.lots, initialWeekStartDate, lotView]);
  const selectedLot = visibleLots.find(lot => lot.id === selectedLotId) || visibleLots[0] || null;
  const currentAllocations = useMemo(
    () => selectedLot?.allocations.filter(allocation => ['ACTIVE', 'IN_PROGRESS', 'COMPLETED'].includes(allocation.status)) || [],
    [selectedLot],
  );
  const historicalAllocations = useMemo(
    () => selectedLot?.allocations.filter(allocation => ['SUPERSEDED', 'CANCELLED'].includes(allocation.status)) || [],
    [selectedLot],
  );

  function openEntry(candidate: Candidate): void {
    setEntryCandidate(candidate);
    setEntryPreview(null);
    setEntryDraft({
      quantity: String(candidate.availableQuantity),
      reasonCode: 'PRODUCTION_INTERRUPTED',
      reason: '本周无法继续剩余工序，转入半成品仓等待重新安排',
      locationCode: '',
      containerCode: '',
    });
  }

  async function post<T>(body: Record<string, unknown>): Promise<T> {
    const response = await fetch('/api/wip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const payload = await responseData<T>(response);
    if (!response.ok || !payload.data) throw new Error(payload.error || '半成品仓操作失败');
    return payload.data;
  }

  async function previewEntry(): Promise<void> {
    if (!entryCandidate) return;
    setSaving(true);
    setError('');
    try {
      const preview = await post<EntryPreview>({
        action: 'preview_entry',
        batchId: entryCandidate.id,
        quantity: Number(entryDraft.quantity),
      });
      setEntryPreview(preview);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '转仓预检失败');
    } finally {
      setSaving(false);
    }
  }

  async function commitEntry(): Promise<void> {
    if (!entryCandidate || !entryPreview) return;
    setSaving(true);
    setError('');
    try {
      await post({
        action: 'enter',
        batchId: entryCandidate.id,
        quantity: Number(entryDraft.quantity),
        reasonCode: entryDraft.reasonCode,
        reason: entryDraft.reason,
        locationCode: entryDraft.locationCode,
        containerCode: entryDraft.containerCode,
        idempotencyKey: newRequestKey('wip-enter-ui'),
      });
      publishProductionDataInvalidation({ kind: 'wip-entered', entityId: entryCandidate.workOrderId });
      setEntryCandidate(null);
      setEntryPreview(null);
      setToast('已转入半成品仓；历史报工和原周已完工工时保持不变');
      await load(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '转入半成品仓失败');
    } finally {
      setSaving(false);
    }
  }

  async function scheduleLot(): Promise<void> {
    if (!selectedLot) return;
    setSaving(true);
    setError('');
    try {
      await post({
        action: 'schedule',
        lotId: selectedLot.id,
        quantity: Number(scheduleDraft.quantity),
        targetWeekStartDate: scheduleDraft.week,
        teamId: scheduleDraft.teamId || null,
        reason: scheduleDraft.reason,
        idempotencyKey: newRequestKey('wip-schedule-ui'),
      });
      publishProductionDataInvalidation({ kind: 'wip-scheduled', entityId: selectedLot.id });
      setToast('剩余工序与工时已计入目标周计划，来源周不再重复计算');
      setScheduleDraft(current => ({ ...current, quantity: '', week: '' }));
      await load(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '半成品排程失败');
    } finally {
      setSaving(false);
    }
  }

  function openReschedule(allocation: Allocation): void {
    const defaultWeek = data.weeks.find(week => week.startDate !== allocation.targetWeekStartDate)?.startDate || '';
    setRescheduleAllocation(allocation);
    setRescheduleDraft({
      targetWeekStartDate: defaultWeek,
      teamId: allocation.team?.id || '',
      reasonCode: 'MATERIAL_CHANGE',
      note: '物料到货时间变化，改排剩余未完成工序',
    });
    setRescheduleResult(null);
    setRescheduleError('');
  }

  function closeReschedule(): void {
    if (saving) return;
    setRescheduleAllocation(null);
    setRescheduleResult(null);
    setRescheduleError('');
  }

  async function commitReschedule(): Promise<void> {
    if (!rescheduleAllocation || !rescheduleDraft.targetWeekStartDate) return;
    const reasonLabels: Record<RescheduleDraft['reasonCode'], string> = {
      MATERIAL_CHANGE: '物料到货变化',
      CAPACITY_BALANCE: '产能调整',
      CUSTOMER_CHANGE: '客户交期调整',
      OTHER: '其他原因',
    };
    const reason = `${reasonLabels[rescheduleDraft.reasonCode]}：${rescheduleDraft.note.trim()}`;
    if (rescheduleDraft.note.trim().length < 2) {
      setRescheduleError('请填写至少 2 个字的改排说明');
      return;
    }
    setSaving(true);
    setRescheduleError('');
    try {
      const result = await post<{ id: string }>({
        action: 'reschedule',
        allocationId: rescheduleAllocation.id,
        targetWeekStartDate: rescheduleDraft.targetWeekStartDate,
        teamId: rescheduleDraft.teamId || null,
        reason,
        idempotencyKey: newRequestKey('wip-reschedule-ui'),
      });
      publishProductionDataInvalidation({ kind: 'wip-rescheduled', entityId: result.id });
      setToast('改排完成：原周只保留已完成部分，未完成工时已迁移到新目标周');
      await load(true);
      const targetWeek = data.weeks.find(week => week.startDate === rescheduleDraft.targetWeekStartDate);
      setRescheduleResult({
        allocationId: result.id,
        targetWeekStartDate: rescheduleDraft.targetWeekStartDate,
        targetWeekEndDate: targetWeek?.endDate || '',
      });
    } catch (reasonError) {
      setRescheduleError(reasonError instanceof Error ? reasonError.message : '改排失败');
    } finally {
      setSaving(false);
    }
  }

  function openUnschedule(allocation: Allocation): void {
    if (!selectedLot) return;
    setReversalDraft({
      kind: 'unschedule',
      allocation,
      lot: selectedLot,
      reason: '安排有误，撤销目标周安排并退回半成品仓待排',
      physicalReturnConfirmed: false,
      preview: null,
      error: '',
    });
  }

  function openReturnToOrder(): void {
    if (!selectedLot) return;
    setReversalDraft({
      kind: 'return',
      allocation: null,
      lot: selectedLot,
      reason: '转仓操作有误，撤销半成品覆盖并恢复原订单继续执行',
      physicalReturnConfirmed: false,
      preview: null,
      error: '',
    });
  }

  async function previewReversal(): Promise<void> {
    if (!reversalDraft || reversalDraft.reason.trim().length < 2) return;
    setSaving(true);
    setReversalDraft(current => current ? { ...current, error: '' } : null);
    try {
      const preview = reversalDraft.kind === 'unschedule'
        ? await post<ReversalPreview>({ action: 'preview_unschedule', allocationId: reversalDraft.allocation?.id })
        : await post<ReversalPreview>({ action: 'preview_return_to_order', lotId: reversalDraft.lot.id });
      setReversalDraft(current => current ? { ...current, preview } : null);
    } catch (reason) {
      setReversalDraft(current => current ? {
        ...current,
        error: reason instanceof Error ? reason.message : '撤销预检失败',
      } : null);
    } finally {
      setSaving(false);
    }
  }

  async function commitReversal(): Promise<void> {
    if (!reversalDraft?.preview) return;
    if (reversalDraft.preview.requiresPhysicalReturnConfirmation && !reversalDraft.physicalReturnConfirmed) {
      setReversalDraft(current => current ? { ...current, error: '请先确认实物已经退回原订单流转位置' } : null);
      return;
    }
    setSaving(true);
    setReversalDraft(current => current ? { ...current, error: '' } : null);
    try {
      if (reversalDraft.kind === 'unschedule') {
        await post({
          action: 'unschedule',
          allocationId: reversalDraft.allocation?.id,
          expectedVersion: reversalDraft.preview.allocationVersion,
          reason: reversalDraft.reason,
          idempotencyKey: newRequestKey('wip-unschedule-ui'),
        });
        publishProductionDataInvalidation({ kind: 'wip-unscheduled', entityId: reversalDraft.allocation?.id || reversalDraft.lot.id });
        setToast('目标周安排已撤销；该数量已退回半成品仓待排，原订单和报工事实未改动');
      } else {
        await post({
          action: 'return_to_order',
          lotId: reversalDraft.lot.id,
          expectedVersion: reversalDraft.preview.lotVersion,
          physicalReturnConfirmed: reversalDraft.physicalReturnConfirmed,
          reason: reversalDraft.reason,
          idempotencyKey: newRequestKey('wip-return-order-ui'),
        });
        publishProductionDataInvalidation({ kind: 'wip-returned', entityId: reversalDraft.lot.id });
        setToast('半成品覆盖已撤销，剩余数量已回归原订单；历史报工、数量和工时保持不变');
      }
      setReversalDraft(null);
      await load(true);
    } catch (reason) {
      setReversalDraft(current => current ? {
        ...current,
        error: reason instanceof Error ? reason.message : '撤销操作失败',
      } : null);
    } finally {
      setSaving(false);
    }
  }

  async function logout(): Promise<void> {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    location.href = '/login';
  }

  return <main className="wip-workbench hm-workbench-root">
    <AppWorkbenchHeader
      user={user}
      activeHref="/workspace/wip"
      subtitle="跨周半成品、剩余工序与工时重排"
      hideHeader
      sidebarTriggerTargetId="wip-sidebar-trigger"
      menuItems={[{ label: '系统设置', href: '/dashboard?openSettings=1' }, { label: '退出登录', onSelect: () => { void logout(); } }]}
    />
    <header className="wip-topbar">
      <span id="wip-sidebar-trigger" />
      <div><small>生产计划 / 独立台账</small><h1><Warehouse size={23} />半成品仓</h1><p>已报工事实留原周 · 仓内未排不计计划 · 剩余工时只进入目标周</p></div>
      <label><Search size={17} /><input value={keyword} onChange={event => setKeyword(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void load(); }} placeholder="搜索规格、产品、客户或半成品批次" /></label>
      <button type="button" disabled={loading} onClick={() => void load()}><RefreshCw className={loading ? 'spin' : ''} size={17} />刷新</button>
    </header>

    <section className="wip-summary" aria-label="半成品仓统计">
      <article><Layers3 /><span><small>在仓批次</small><strong>{data.summary.lotCount}</strong><em>批</em></span></article>
      <article><PackageOpen /><span><small>在仓数量</small><strong>{data.summary.totalQuantity.toLocaleString()}</strong><em>件</em></span></article>
      <article className="warning"><CalendarClock /><span><small>尚未排周</small><strong>{data.summary.unscheduledQuantity.toLocaleString()}</strong><em>件</em></span></article>
      <article className="success"><CheckCircle2 /><span><small>已进入周计划</small><strong>{data.summary.scheduledQuantity.toLocaleString()}</strong><em>件</em></span></article>
      <article><Clock3 /><span><small>剩余标准工时</small><strong>{data.summary.totalRemainingHours.toLocaleString()}</strong><em>小时</em></span></article>
    </section>

    {error && <div className="wip-message error" role="alert"><AlertTriangle size={17} />{error}<button type="button" aria-label="关闭错误" onClick={() => setError('')}><X size={15} /></button></div>}
    {toast && <div className="wip-message success" role="status"><CheckCircle2 size={17} />{toast}</div>}

    <section className="wip-layout">
      <aside className="wip-source-panel">
        <header><span><small>任意来源周</small><strong>可转产品</strong></span><em>{data.candidates.length}</em></header>
        <div className="hm-scroll-region">
          {data.candidates.map(candidate => <article key={candidate.id} className={initialBatchId === candidate.id ? 'focused' : ''}>
            <div><small>{candidate.weekStartDate} · 第 {candidate.batchNo} 批</small><strong title={candidate.specification}>{candidate.specification}</strong><span>{candidate.customerName} · {candidate.productName}</span></div>
            <footer><span><b>{candidate.availableQuantity.toLocaleString()}</b> / {candidate.quantity.toLocaleString()} 件可转</span><em>{candidate.completedProcessCount}/{candidate.processCount} 道有进度</em></footer>
            <p className={candidate.materialStatus === 'completed' ? 'ready' : 'warning'}>{candidate.materialStatus === 'completed' ? '物料已齐' : `物料${candidate.materialStatus === 'exception' ? '异常/料错' : '未齐'}：仅提示，不影响开工`}</p>
            <button type="button" disabled={!data.permissions.canWrite || candidate.availableQuantity <= 0} onClick={() => openEntry(candidate)}>转入半成品仓<ArrowRight size={15} /></button>
          </article>)}
          {!loading && !data.candidates.length && <p className="wip-empty">没有可转入的已下达产品。</p>}
        </div>
      </aside>

      <section className="wip-lot-panel">
        <header><span><small>动态计划口径</small><strong>{initialWeekStartDate ? `${initialWeekStartDate} 半成品续作` : '半成品批次'}</strong></span><em>{visibleLots.length} 个当前结果</em></header>
        <nav className="wip-lot-views" aria-label="半成品批次视图">
          <a className={lotView === 'all' && !initialWeekStartDate ? 'active' : ''} href="/workspace/wip">全部</a>
          <a className={lotView === 'unscheduled' ? 'active' : ''} href="/workspace/wip?view=unscheduled">待排周</a>
          <a className={lotView === 'scheduled' ? 'active' : ''} href="/workspace/wip?view=scheduled">已排周</a>
          {initialWeekStartDate && <span>已定位目标周 {initialWeekStartDate}<a href="/workspace/wip?view=scheduled" aria-label="清除目标周筛选"><X size={12} /></a></span>}
        </nav>
        <div className="wip-week-strip">
          {data.weeks.map(week => <a className={initialWeekStartDate === week.startDate ? 'selected' : ''} href={`/workspace/wip?view=scheduled&week=${encodeURIComponent(week.startDate)}`} key={week.startDate}><small>{week.label} · {week.startDate.slice(5)}</small><strong>{week.plannedQuantity.toLocaleString()} 件</strong><span>{week.plannedHours.toLocaleString()} 小时 · {week.lotCount} 批</span></a>)}
        </div>
        <div className="wip-lot-table hm-scroll-region">
          {visibleLots.map(lot => <button type="button" key={lot.id} className={selectedLot?.id === lot.id ? 'selected' : ''} onClick={() => { setSelectedLotId(lot.id); setScheduleDraft(current => ({ ...current, quantity: String(lot.unscheduledQuantity) })); }}>
            <span><small>{lot.lotNo}</small><strong>{lot.specification}</strong><em>{lot.customerName} · {lot.workOrderCode}</em></span>
            <b>{lot.quantity.toLocaleString()}<small> 件</small></b>
            <i className={lot.scheduleStatus.toLowerCase()}>{statusLabel(lot.scheduleStatus)}</i>
            <span><small>来源周 {lot.sourceWeekStartDate}</small><em>未排 {lot.unscheduledQuantity} · {lot.remainingHours} 小时</em></span>
          </button>)}
          {!loading && !visibleLots.length && <p className="wip-empty">当前筛选下没有半成品批次。可切换“全部”或其他目标周查看。</p>}
        </div>
      </section>

      <aside className="wip-detail-panel">
        {selectedLot ? <>
          <header><span><small>{selectedLot.lotNo}</small><strong>{selectedLot.specification}</strong><em>{selectedLot.productName}</em></span><i className={selectedLot.scheduleStatus.toLowerCase()}>{statusLabel(selectedLot.scheduleStatus)}</i></header>
          <section className="wip-origin-card"><span><small>来源生产周</small><strong>{selectedLot.sourceWeekStartDate} 至 {selectedLot.sourceWeekEndDate}</strong></span><span><small>原则</small><strong>已报工与员工工时不迁移</strong></span>{data.permissions.canWrite && !['COMPLETED', 'CANCELLED'].includes(selectedLot.scheduleStatus) && <button type="button" className="wip-return-order" disabled={saving} onClick={openReturnToOrder}><RotateCcw size={14} />撤销转仓并回归原订单</button>}</section>
          {selectedLot.materialStatusSnapshot && <p className="wip-material-note"><AlertTriangle size={15} />{selectedLot.materialStatusSnapshot}</p>}
          <section className="wip-step-list"><header><strong>剩余工序与工时</strong><em>{selectedLot.steps.length} 道</em></header>{selectedLot.steps.map(step => <article key={step.id}><b>{String(step.position).padStart(2, '0')}</b><span><strong>{step.processName}</strong><small>剩余 {step.remainingQty} 件</small></span><em>{step.remainingHours} 小时</em></article>)}</section>
          {data.permissions.canWrite && selectedLot.unscheduledQuantity > 0 && <section className="wip-schedule-form">
            <header><strong>排入目标生产周</strong><small>未排仓内不计任何周计划</small></header>
            <div><label>数量<input type="number" min="1" max={selectedLot.unscheduledQuantity} value={scheduleDraft.quantity} onChange={event => setScheduleDraft({ ...scheduleDraft, quantity: event.target.value })} /></label><label>目标周<select value={scheduleDraft.week} onChange={event => setScheduleDraft({ ...scheduleDraft, week: event.target.value })}><option value="">请选择</option>{data.weeks.map(week => <option key={week.startDate} value={week.startDate}>{week.label} · {week.startDate} 至 {week.endDate}</option>)}</select></label></div>
            <label>执行班组<select value={scheduleDraft.teamId} onChange={event => setScheduleDraft({ ...scheduleDraft, teamId: event.target.value })}><option value="">暂不指定</option>{data.teams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>
            <label>原因<input maxLength={300} value={scheduleDraft.reason} onChange={event => setScheduleDraft({ ...scheduleDraft, reason: event.target.value })} /></label>
            <button type="button" disabled={saving || !scheduleDraft.week || !Number(scheduleDraft.quantity)} onClick={() => void scheduleLot()}>{saving ? <LoaderCircle className="spin" size={16} /> : <CalendarClock size={16} />}确认排入目标周</button>
          </section>}
          <section className="wip-allocation-list wip-effective-arrangements"><header><span><small>当前有效口径</small><strong>当前安排</strong></span><em>{currentAllocations.length}</em></header>{currentAllocations.map(allocation => <article className={`effective ${initialAllocationId === allocation.id ? 'focused' : ''}`} key={allocation.id}><div><small>{allocation.targetWeekStartDate} 至 {allocation.targetWeekEndDate}</small><strong>{allocation.quantity.toLocaleString()} 件 · 剩余 {Math.max(0, allocation.quantity - allocation.completedQty).toLocaleString()} 件</strong><span>{allocation.team?.name || '未指定班组'} · 剩余 {(allocation.plannedHours - allocation.completedHours).toFixed(2)} 小时</span></div><i className={allocation.status.toLowerCase()}>{statusLabel(allocation.status)}</i>{['ACTIVE', 'IN_PROGRESS'].includes(allocation.status) && data.permissions.canWrite && <nav className="wip-allocation-actions"><button type="button" disabled={saving} onClick={() => openReschedule(allocation)}>改排剩余部分</button><button type="button" className="danger" disabled={saving} onClick={() => openUnschedule(allocation)}><Undo2 size={12} />撤销周安排</button></nav>}</article>)}{!currentAllocations.length && <p className="wip-empty compact">当前没有有效周次安排，可在上方排入目标周。</p>}</section>
          {historicalAllocations.length > 0 && <details className="wip-allocation-history"><summary><span><History size={14} />历史安排</span><em>{historicalAllocations.length} 条</em></summary><div>{historicalAllocations.map(allocation => <article key={allocation.id}><div><small>{allocation.targetWeekStartDate} 至 {allocation.targetWeekEndDate}</small><strong>{allocation.quantity.toLocaleString()} 件 · 已完成 {allocation.completedQty.toLocaleString()} 件</strong><span>{allocation.reason}</span></div><i className={allocation.status.toLowerCase()}>{statusLabel(allocation.status)}</i></article>)}</div></details>}
        </> : <div className="wip-detail-empty"><PackageOpen size={36} /><strong>选择半成品批次</strong><span>查看剩余工序、标准工时和跨周安排。</span></div>}
      </aside>
    </section>

    {entryCandidate && <div className="wip-modal-backdrop" role="presentation"><section className="wip-entry-modal" role="dialog" aria-modal="true" aria-labelledby="wip-entry-title">
      <header><span><small>{entryCandidate.weekStartDate} 来源周 · {entryCandidate.workOrderCode}</small><strong id="wip-entry-title">转入半成品仓</strong><em>{entryCandidate.specification}</em></span><button type="button" disabled={saving} onClick={() => { setEntryCandidate(null); setEntryPreview(null); }}><X /></button></header>
      <div className="wip-entry-body">
        <section className="wip-entry-fields"><div><label>转仓数量<input type="number" min="1" max={entryCandidate.availableQuantity} value={entryDraft.quantity} disabled={Boolean(entryPreview)} onChange={event => setEntryDraft({ ...entryDraft, quantity: event.target.value })} /></label><label>原因类别<select value={entryDraft.reasonCode} disabled={Boolean(entryPreview)} onChange={event => setEntryDraft({ ...entryDraft, reasonCode: event.target.value })}><option value="PRODUCTION_INTERRUPTED">本周无法继续</option><option value="MATERIAL_WAIT">等待物料</option><option value="CAPACITY_BALANCE">产能平衡</option><option value="OTHER">其他</option></select></label></div><label>转仓原因<textarea maxLength={300} value={entryDraft.reason} disabled={Boolean(entryPreview)} onChange={event => setEntryDraft({ ...entryDraft, reason: event.target.value })} /></label><div><label>库位（可选）<input value={entryDraft.locationCode} disabled={Boolean(entryPreview)} onChange={event => setEntryDraft({ ...entryDraft, locationCode: event.target.value })} /></label><label>容器码（多批建议填写）<input value={entryDraft.containerCode} disabled={Boolean(entryPreview)} onChange={event => setEntryDraft({ ...entryDraft, containerCode: event.target.value })} /></label></div></section>
        {entryPreview ? <section className="wip-entry-preview"><header><CheckCircle2 /><span><strong>转仓影响已核对</strong><small>不会撤回或迁移任何已报工事实</small></span></header><div><span><small>保留在来源周</small><strong>{entryPreview.completedSteps.length ? entryPreview.completedSteps.map(step => step.processName).join('、') : '尚无整道完成工序'}</strong></span><span><small>进入半成品仓</small><strong>{entryPreview.remainingSteps.map(step => step.processName).join('、')}</strong></span><span><small>暂不计周计划</small><strong>{entryPreview.quantity} 件 · {entryPreview.remainingHours} 小时</strong></span></div>{entryPreview.materialWarning && <p><AlertTriangle />{entryPreview.materialWarning}</p>}</section> : <section className="wip-entry-rule"><AlertTriangle /><span><strong>转仓不是撤单或暂停</strong><small>产品仍可正常开工和二维码报工。只有进入半成品仓的剩余数量需要按目标周执行；物料未齐或料错本身不会冻结。</small></span></section>}
      </div>
      <footer><span>{entryPreview ? '确认后生成独立半成品批次和完整审计记录' : '先预检剩余工序、数量和工时'}</span>{entryPreview ? <><button type="button" className="secondary" disabled={saving} onClick={() => setEntryPreview(null)}>返回修改</button><button type="button" disabled={saving} onClick={() => void commitEntry()}>{saving ? <LoaderCircle className="spin" /> : <PackageOpen />}确认转入</button></> : <button type="button" disabled={saving || !Number(entryDraft.quantity) || entryDraft.reason.trim().length < 2} onClick={() => void previewEntry()}>{saving ? <LoaderCircle className="spin" /> : <ArrowRight />}预检影响</button>}</footer>
    </section></div>}

    {rescheduleAllocation && selectedLot && <div className="wip-modal-backdrop wip-reschedule-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) closeReschedule(); }}><section ref={rescheduleDialogRef} className="wip-reschedule-modal" role="dialog" aria-modal="true" aria-labelledby="wip-reschedule-title" tabIndex={-1} data-testid="wip-reschedule-dialog">
      <header>
        <div><span>半成品续作 · 只迁移未完成事实</span><h2 id="wip-reschedule-title">改排剩余半成品</h2><p>{selectedLot.specification} · {selectedLot.lotNo}</p></div>
        <button type="button" aria-label="关闭改排窗口" disabled={saving} onClick={closeReschedule}><X size={20} /></button>
      </header>
      <nav className="wip-reschedule-progress" aria-label="改排步骤">
        <span className={rescheduleDraft.targetWeekStartDate || rescheduleResult ? 'done' : 'active'}><b>1</b><em>选择周次</em></span>
        <i />
        <span className={!rescheduleResult && rescheduleDraft.targetWeekStartDate ? 'active' : rescheduleResult ? 'done' : ''}><b>2</b><em>确认影响</em></span>
        <i />
        <span className={rescheduleResult ? 'active' : ''}><b>3</b><em>完成</em></span>
      </nav>
      {rescheduleResult ? <div className="wip-reschedule-success" data-testid="wip-reschedule-success">
        <CheckCircle2 size={46} />
        <h3>改排已完成</h3>
        <p>原周已报工数量、报工记录和员工工时保持不变；剩余工序已进入 {rescheduleResult.targetWeekStartDate} 至 {rescheduleResult.targetWeekEndDate}。</p>
        <div><span><small>新半成品安排</small><strong>{Math.max(0, rescheduleAllocation.quantity - rescheduleAllocation.completedQty).toLocaleString()} 件</strong></span><span><small>剩余标准工时</small><strong>{Math.max(0, rescheduleAllocation.plannedHours - rescheduleAllocation.completedHours).toFixed(2)} 小时</strong></span></div>
        <nav>
          <a href={productionExecutionLink({ targetWeekStartDate: rescheduleResult.targetWeekStartDate, targetWeekEndDate: rescheduleResult.targetWeekEndDate, workOrderId: selectedLot.workOrderId, allocationId: rescheduleResult.allocationId, weeks: data.weeks })}><Factory size={16} />查看生产执行</a>
          <a href={`/weekly-plan-center?week=${encodeURIComponent(rescheduleResult.targetWeekStartDate)}`}><CalendarClock size={16} />查看计划中心</a>
        </nav>
      </div> : <>
        <div className="wip-reschedule-body">
          <section className="wip-current-arrangement"><span><small>当前有效安排</small><strong>{rescheduleAllocation.targetWeekStartDate} 至 {rescheduleAllocation.targetWeekEndDate}</strong></span><span><small>已完成事实保留</small><strong>{rescheduleAllocation.completedQty.toLocaleString()} 件 · {rescheduleAllocation.completedHours.toFixed(2)} 小时</strong></span><span><small>本次迁移</small><strong>{Math.max(0, rescheduleAllocation.quantity - rescheduleAllocation.completedQty).toLocaleString()} 件 · {Math.max(0, rescheduleAllocation.plannedHours - rescheduleAllocation.completedHours).toFixed(2)} 小时</strong></span></section>

          <section className="wip-reschedule-section"><header><span><b>1</b><strong>选择目标生产周</strong></span><small>目标周会立即获得一条可执行的半成品续作任务</small></header><div className="wip-reschedule-weeks" role="radiogroup" aria-label="目标生产周">
            {data.weeks.map(week => {
              const disabled = week.startDate === rescheduleAllocation.targetWeekStartDate;
              const selected = rescheduleDraft.targetWeekStartDate === week.startDate;
              return <button key={week.startDate} type="button" role="radio" aria-checked={selected} disabled={disabled || saving} className={selected ? 'selected' : ''} onClick={() => setRescheduleDraft({ ...rescheduleDraft, targetWeekStartDate: week.startDate })}><span><small>{week.label}</small><strong>{week.startDate.slice(5)} - {week.endDate.slice(5)}</strong></span><em>{disabled ? '当前安排' : `${week.lotCount} 批 · ${week.plannedHours.toLocaleString()} 小时`}</em><i /></button>;
            })}
          </div></section>

          <section className="wip-reschedule-section"><header><span><b>2</b><strong>核对迁移影响</strong></span><small>数据库工艺路线不回退，界面按半成品任务投影剩余工序</small></header><div className="wip-reschedule-impact"><div className="head"><span>剩余工序</span><span>剩余数量</span><span>剩余工时</span><span>改排结果</span></div>{rescheduleAllocation.steps.filter(step => step.remainingQty > 0).map(step => <div key={step.id}><span><b>{String(step.position).padStart(2, '0')}</b>{step.processName}</span><span>{step.remainingQty.toLocaleString()} 件</span><span>{step.remainingHours.toFixed(2)} 小时</span><span>进入目标周</span></div>)}</div><p className="wip-reschedule-rule"><AlertTriangle size={15} />已完成数量、报工记录、员工工时和原始工艺路线全部保留；本次仅生成新的剩余任务投影。</p></section>

          <section className="wip-reschedule-section"><header><span><b>3</b><strong>执行信息与原因</strong></span><small>用于计划追踪和审计</small></header><div className="wip-reschedule-fields"><label>执行班组<select value={rescheduleDraft.teamId} disabled={saving} onChange={event => setRescheduleDraft({ ...rescheduleDraft, teamId: event.target.value })}><option value="">暂不指定</option>{data.teams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label><label>原因类别<select value={rescheduleDraft.reasonCode} disabled={saving} onChange={event => setRescheduleDraft({ ...rescheduleDraft, reasonCode: event.target.value as RescheduleDraft['reasonCode'] })}><option value="MATERIAL_CHANGE">物料到货变化</option><option value="CAPACITY_BALANCE">产能调整</option><option value="CUSTOMER_CHANGE">客户交期调整</option><option value="OTHER">其他原因</option></select></label><label className="wide">改排说明<textarea maxLength={300} value={rescheduleDraft.note} disabled={saving} onChange={event => setRescheduleDraft({ ...rescheduleDraft, note: event.target.value })} /></label></div></section>
          {rescheduleError && <p className="wip-reschedule-error" role="alert"><AlertTriangle size={15} />{rescheduleError}</p>}
        </div>
        <footer><span>提交后，可直接跳转核对计划中心和生产执行</span><button type="button" disabled={saving} onClick={closeReschedule}>取消</button><button type="button" className="primary" disabled={saving || !rescheduleDraft.targetWeekStartDate || rescheduleDraft.note.trim().length < 2} onClick={() => void commitReschedule()} data-testid="wip-reschedule-submit">{saving ? <><LoaderCircle className="spin" size={16} />正在改排</> : <><CalendarClock size={16} />确认改排剩余任务</>}</button></footer>
      </>}
    </section></div>}

    {reversalDraft && <div className="wip-modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !saving) setReversalDraft(null); }}><section className="wip-reversal-modal" role="dialog" aria-modal="true" aria-labelledby="wip-reversal-title">
      <header><div><small>{reversalDraft.kind === 'unschedule' ? '只撤销当前目标周投影' : '关闭整个半成品覆盖层'}</small><h2 id="wip-reversal-title">{reversalDraft.kind === 'unschedule' ? '撤销周安排' : '撤销转仓并回归原订单'}</h2><p>{reversalDraft.lot.lotNo} · {reversalDraft.lot.specification}</p></div><button type="button" aria-label="关闭撤销窗口" disabled={saving} onClick={() => setReversalDraft(null)}><X size={19} /></button></header>
      <div className="wip-reversal-body">
        <p className="wip-reversal-warning"><AlertTriangle size={18} /><span><strong>{reversalDraft.kind === 'unschedule' ? '不会回归原订单' : '仅允许没有半成品续作进度的批次'}</strong><small>{reversalDraft.kind === 'unschedule' ? '撤销后数量回到半成品仓“待排周”，以后可重新安排。' : '任何半成品报工、完成数量或员工工时都会阻止整批回归。'}</small></span></p>
        <label>撤销原因<textarea maxLength={300} disabled={saving || Boolean(reversalDraft.preview)} value={reversalDraft.reason} onChange={event => setReversalDraft(current => current ? { ...current, reason: event.target.value } : null)} /></label>
        {reversalDraft.preview && <section className="wip-reversal-preview"><header><CheckCircle2 size={18} /><strong>影响预检通过</strong></header><dl><div><dt>原订单</dt><dd>{reversalDraft.preview.workOrderCode}</dd></div><div><dt>影响数量</dt><dd>{reversalDraft.preview.quantity.toLocaleString()} 件</dd></div>{reversalDraft.preview.targetWeekStartDate && <div><dt>撤销目标周</dt><dd>{reversalDraft.preview.targetWeekStartDate} 至 {reversalDraft.preview.targetWeekEndDate}</dd></div>}{reversalDraft.preview.sourceWeekStartDate && <div><dt>回归来源周</dt><dd>{reversalDraft.preview.sourceWeekStartDate} 至 {reversalDraft.preview.sourceWeekEndDate}</dd></div>}<div><dt>事实保护</dt><dd>原报工、数量、工时、工艺路线均不改写</dd></div></dl></section>}
        {reversalDraft.preview?.requiresPhysicalReturnConfirmation && <label className="wip-physical-confirm"><input type="checkbox" checked={reversalDraft.physicalReturnConfirmed} disabled={saving} onChange={event => setReversalDraft(current => current ? { ...current, physicalReturnConfirmed: event.target.checked } : null)} /><span><strong>我已确认实物退回原订单流转位置</strong><small>当前状态 {statusLabel(reversalDraft.preview?.physicalStatus || '')} · 库位 {reversalDraft.preview?.locationCode || '未登记'} · 容器 {reversalDraft.preview?.containerCode || '未登记'}</small></span></label>}
        {reversalDraft.error && <p className="wip-reversal-error" role="alert"><AlertTriangle size={15} />{reversalDraft.error}</p>}
      </div>
      <footer><span>{reversalDraft.preview ? '再次确认后执行，操作会写入计划变更和审计日志' : '先检查进度、版本和原订单状态'}</span><button type="button" disabled={saving} onClick={() => setReversalDraft(null)}>取消</button>{reversalDraft.preview ? <button type="button" className="danger" disabled={saving || Boolean(reversalDraft.preview.requiresPhysicalReturnConfirmation && !reversalDraft.physicalReturnConfirmed)} onClick={() => void commitReversal()}>{saving ? <LoaderCircle className="spin" size={15} /> : <RotateCcw size={15} />}确认执行撤销</button> : <button type="button" className="primary" disabled={saving || reversalDraft.reason.trim().length < 2} onClick={() => void previewReversal()}>{saving ? <LoaderCircle className="spin" size={15} /> : <ArrowRight size={15} />}预检影响</button>}</footer>
    </section></div>}
  </main>;
}
