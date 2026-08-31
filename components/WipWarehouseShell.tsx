'use client';

import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  Clock3,
  Layers3,
  LoaderCircle,
  PackageOpen,
  RefreshCw,
  Search,
  Warehouse,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppWorkbenchHeader } from '@/components/layout/AppWorkbenchHeader';
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
};

type Lot = {
  id: string;
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
  };
  return labels[status] || status;
}

function newRequestKey(prefix: string): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? `${prefix}:${crypto.randomUUID()}`
    : `${prefix}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

async function responseData<T>(response: Response): Promise<{ data?: T; error?: string }> {
  return response.json().catch(() => ({}));
}

export default function WipWarehouseShell({
  user,
  initialBatchId,
}: {
  user: CurrentUserDTO;
  initialBatchId: string;
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
      setSelectedLotId(current => current && body.data!.lots.some(lot => lot.id === current)
        ? current
        : body.data!.lots[0]?.id || '');
      if (initialBatchId && body.data.candidates[0] && !entryCandidate) {
        const candidate = body.data.candidates[0];
        setEntryCandidate(candidate);
        setEntryDraft(current => ({ ...current, quantity: String(candidate.availableQuantity) }));
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '半成品仓加载失败');
    } finally {
      setLoading(false);
    }
  }, [entryCandidate, initialBatchId, keyword]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(''), 3_000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const selectedLot = data.lots.find(lot => lot.id === selectedLotId) || null;
  const openLots = useMemo(() => data.lots.filter(lot => !['COMPLETED', 'CANCELLED'].includes(lot.scheduleStatus)), [data.lots]);

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
      setToast('剩余工序与工时已计入目标周计划，来源周不再重复计算');
      setScheduleDraft(current => ({ ...current, quantity: '', week: '' }));
      await load(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '半成品排程失败');
    } finally {
      setSaving(false);
    }
  }

  async function reschedule(allocation: Allocation): Promise<void> {
    const defaultWeek = data.weeks.find(week => week.startDate !== allocation.targetWeekStartDate)?.startDate || '';
    const targetWeekStartDate = window.prompt('请输入新的目标周开始日期（YYYY-MM-DD，只能本周或未来周）', defaultWeek)?.trim();
    if (!targetWeekStartDate) return;
    const reason = window.prompt('请输入改排原因（已完成部分仍保留在原目标周）', '物料到货时间变化，改排剩余未完成工序')?.trim();
    if (!reason) return;
    setSaving(true);
    setError('');
    try {
      await post({
        action: 'reschedule',
        allocationId: allocation.id,
        targetWeekStartDate,
        reason,
        idempotencyKey: newRequestKey('wip-reschedule-ui'),
      });
      setToast('改排完成：原周只保留已完成部分，未完成工时已迁移到新目标周');
      await load(true);
    } catch (reasonError) {
      setError(reasonError instanceof Error ? reasonError.message : '改排失败');
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
        <header><span><small>动态计划口径</small><strong>半成品批次</strong></span><em>{openLots.length} 个未关闭</em></header>
        <div className="wip-week-strip">
          {data.weeks.slice(0, 5).map(week => <article key={week.startDate}><small>{week.label} · {week.startDate.slice(5)}</small><strong>{week.plannedQuantity.toLocaleString()} 件</strong><span>{week.plannedHours.toLocaleString()} 小时 · {week.lotCount} 批</span></article>)}
        </div>
        <div className="wip-lot-table hm-scroll-region">
          {data.lots.map(lot => <button type="button" key={lot.id} className={selectedLotId === lot.id ? 'selected' : ''} onClick={() => { setSelectedLotId(lot.id); setScheduleDraft(current => ({ ...current, quantity: String(lot.unscheduledQuantity) })); }}>
            <span><small>{lot.lotNo}</small><strong>{lot.specification}</strong><em>{lot.customerName} · {lot.workOrderCode}</em></span>
            <b>{lot.quantity.toLocaleString()}<small> 件</small></b>
            <i className={lot.scheduleStatus.toLowerCase()}>{statusLabel(lot.scheduleStatus)}</i>
            <span><small>来源周 {lot.sourceWeekStartDate}</small><em>未排 {lot.unscheduledQuantity} · {lot.remainingHours} 小时</em></span>
          </button>)}
          {!loading && !data.lots.length && <p className="wip-empty">半成品仓暂无批次。可从左侧任意来源周转入。</p>}
        </div>
      </section>

      <aside className="wip-detail-panel">
        {selectedLot ? <>
          <header><span><small>{selectedLot.lotNo}</small><strong>{selectedLot.specification}</strong><em>{selectedLot.productName}</em></span><i className={selectedLot.scheduleStatus.toLowerCase()}>{statusLabel(selectedLot.scheduleStatus)}</i></header>
          <section className="wip-origin-card"><span><small>来源生产周</small><strong>{selectedLot.sourceWeekStartDate} 至 {selectedLot.sourceWeekEndDate}</strong></span><span><small>原则</small><strong>已报工与员工工时不迁移</strong></span></section>
          {selectedLot.materialStatusSnapshot && <p className="wip-material-note"><AlertTriangle size={15} />{selectedLot.materialStatusSnapshot}</p>}
          <section className="wip-step-list"><header><strong>剩余工序与工时</strong><em>{selectedLot.steps.length} 道</em></header>{selectedLot.steps.map(step => <article key={step.id}><b>{String(step.position).padStart(2, '0')}</b><span><strong>{step.processName}</strong><small>剩余 {step.remainingQty} 件</small></span><em>{step.remainingHours} 小时</em></article>)}</section>
          {data.permissions.canWrite && selectedLot.unscheduledQuantity > 0 && <section className="wip-schedule-form">
            <header><strong>排入目标生产周</strong><small>未排仓内不计任何周计划</small></header>
            <div><label>数量<input type="number" min="1" max={selectedLot.unscheduledQuantity} value={scheduleDraft.quantity} onChange={event => setScheduleDraft({ ...scheduleDraft, quantity: event.target.value })} /></label><label>目标周<select value={scheduleDraft.week} onChange={event => setScheduleDraft({ ...scheduleDraft, week: event.target.value })}><option value="">请选择</option>{data.weeks.map(week => <option key={week.startDate} value={week.startDate}>{week.label} · {week.startDate} 至 {week.endDate}</option>)}</select></label></div>
            <label>执行班组<select value={scheduleDraft.teamId} onChange={event => setScheduleDraft({ ...scheduleDraft, teamId: event.target.value })}><option value="">暂不指定</option>{data.teams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>
            <label>原因<input maxLength={300} value={scheduleDraft.reason} onChange={event => setScheduleDraft({ ...scheduleDraft, reason: event.target.value })} /></label>
            <button type="button" disabled={saving || !scheduleDraft.week || !Number(scheduleDraft.quantity)} onClick={() => void scheduleLot()}>{saving ? <LoaderCircle className="spin" size={16} /> : <CalendarClock size={16} />}确认排入目标周</button>
          </section>}
          <section className="wip-allocation-list"><header><strong>周次安排记录</strong><em>{selectedLot.allocations.length}</em></header>{selectedLot.allocations.map(allocation => <article key={allocation.id}><div><small>{allocation.targetWeekStartDate} 至 {allocation.targetWeekEndDate}</small><strong>{allocation.quantity} 件 · {allocation.plannedHours} 小时</strong><span>{allocation.team?.name || '未指定班组'} · {allocation.reason}</span></div><i className={allocation.status.toLowerCase()}>{statusLabel(allocation.status)}</i>{['ACTIVE', 'IN_PROGRESS'].includes(allocation.status) && data.permissions.canWrite && <button type="button" disabled={saving} onClick={() => void reschedule(allocation)}>改排未完成</button>}</article>)}</section>
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
  </main>;
}
