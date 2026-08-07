'use client';

import {
  AlertTriangle,
  CalendarCheck2,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock3,
  History,
  LoaderCircle,
  Menu,
  PackageCheck,
  PanelRightOpen,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  ShieldAlert,
  Truck,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AppWorkbenchHeader } from '@/components/layout/AppWorkbenchHeader';
import {
  fetchDailyShipmentWorkbench,
  mutateDailyShipment,
  type DailyShipmentCandidateDTO,
  type DailyShipmentEventDTO,
  type DailyShipmentItemDTO,
  type DailyShipmentWorkbenchDTO,
  type ShipmentProgressState,
} from '@/lib/daily-shipment-client';
import type { CurrentUserDTO } from '@/types';

type CandidateDraft = { quantity: string; plannedShipAt: string; note: string };
type DialogState =
  | { kind: 'edit'; item: DailyShipmentItemDTO }
  | { kind: 'cancel'; item: DailyShipmentItemDTO }
  | { kind: 'ship'; item: DailyShipmentItemDTO }
  | { kind: 'events'; item: DailyShipmentItemDTO }
  | { kind: 'reverse'; item: DailyShipmentItemDTO; event: DailyShipmentEventDTO }
  | { kind: 'confirm' }
  | { kind: 'close' };

const DAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

const STATE_TEXT: Record<ShipmentProgressState, string> = {
  SHIPPED: '已出货',
  PARTIAL: '部分出货',
  OVERDUE: '已超时',
  READY: '已完工待出货',
  IN_PRODUCTION: '生产中',
  NOT_STARTED: '未开工',
};

const PLAN_STATUS_TEXT = {
  DRAFT: '草稿',
  CONFIRMED: '已确认',
  CLOSED: '已关闭',
  CANCELLED: '已取消',
} as const;

function chinaDateKey(value = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(value);
}

function chinaDateTimeInput(value = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(value);
  const part = (type: string) => parts.find(item => item.type === type)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;
}

function chinaLocalInputFromIso(value: string): string {
  return chinaDateTimeInput(new Date(value));
}

function chinaIsoFromInput(value: string): string {
  return new Date(`${value}:00+08:00`).toISOString();
}

function shortDate(value: string): string {
  return `${Number(value.slice(5, 7))}/${Number(value.slice(8, 10))}`;
}

function timeText(value: string | null): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(value));
}

function fullTimeText(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(value));
}

function numberText(value: number): string {
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 }).format(value);
}

function productionStageText(value: string): string {
  const normalized = value.trim().toLocaleLowerCase();
  if (['completed', 'complete', 'done', '已完成'].includes(normalized)) return '已完成';
  if (['production', 'producing', 'in_progress', 'processing', '生产中'].includes(normalized)) return '生产中';
  if (['not_started', 'not_issued', 'pending', '未开工', '未下达'].includes(normalized)) return '未开工';
  return value || '进度待同步';
}

function candidateAvailableToShip(item: DailyShipmentItemDTO, candidates: DailyShipmentCandidateDTO[]): number {
  const candidate = candidates.find(entry => entry.batchId === item.batchId);
  return Math.max(0, (candidate?.completedQuantity ?? item.completedQuantity) - (candidate?.shippedQuantity ?? item.shippedQuantity));
}

function DialogShell({ title, description, error, busy, children, onClose }: {
  title: string;
  description?: string;
  error?: string;
  busy: boolean;
  children: React.ReactNode;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { closeRef.current?.focus(); }, []);
  return <div className="shipment-modal-layer" role="presentation">
    <button type="button" className="shipment-modal-scrim" aria-label="关闭弹窗" disabled={busy} onClick={onClose} />
    <section className="shipment-modal" role="dialog" aria-modal="true" aria-labelledby="shipment-modal-title">
      <header>
        <div><span>日出货计划</span><h2 id="shipment-modal-title">{title}</h2>{description && <p>{description}</p>}</div>
        <button ref={closeRef} type="button" aria-label="关闭" disabled={busy} onClick={onClose}><X size={19} /></button>
      </header>
      {error && <div className="shipment-inline-error" role="alert"><AlertTriangle size={17} /><span>{error}</span></div>}
      {children}
    </section>
  </div>;
}

function OrderIdentity({ item }: { item: Pick<DailyShipmentItemDTO, 'workOrderCode' | 'customerName' | 'productName' | 'specification' | 'batchNo'> }) {
  return <div className="shipment-order-identity">
    <strong>{item.workOrderCode}</strong>
    <span>{item.customerName} · {item.productName}</span>
    <small>{item.specification} · 第 {item.batchNo} 批</small>
  </div>;
}

function ShipmentMetricValue({ loaded, value, unit }: { loaded: boolean; value: React.ReactNode; unit: string }) {
  return <strong className={loaded ? undefined : 'loading'} aria-label={loaded ? undefined : '加载中'}>
    {loaded ? <>{value}<small>{unit}</small></> : <i aria-hidden="true" />}
  </strong>;
}

export default function DailyShipmentWorkbench({
  user,
  initialDate,
  initialData,
}: {
  user: CurrentUserDTO;
  initialDate: string;
  initialData: DailyShipmentWorkbenchDTO;
}) {
  const [selectedDate, setSelectedDate] = useState(initialDate);
  const [data, setData] = useState<DailyShipmentWorkbenchDTO | null>(initialData);
  const [refreshToken, setRefreshToken] = useState(0);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [candidateSearch, setCandidateSearch] = useState('');
  const [candidateFilter, setCandidateFilter] = useState<'all' | 'ready' | 'available' | 'scheduled'>('all');
  const [candidateDrafts, setCandidateDrafts] = useState<Record<string, CandidateDraft>>({});
  const [search, setSearch] = useState('');
  const [stateFilter, setStateFilter] = useState<'all' | ShipmentProgressState>('all');
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const cacheRef = useRef(new Map<string, DailyShipmentWorkbenchDTO>([[initialDate, initialData]]));
  const initialRequestRef = useRef(true);

  useEffect(() => {
    if (initialRequestRef.current && selectedDate === initialDate && refreshToken === 0) {
      initialRequestRef.current = false;
      return undefined;
    }
    initialRequestRef.current = false;
    const controller = new AbortController();
    const cached = cacheRef.current.get(selectedDate);
    setData(current => {
      if (cached) return cached;
      return current?.selectedDate === selectedDate ? current : null;
    });
    setLoading(true);
    setError('');
    void fetchDailyShipmentWorkbench(selectedDate, controller.signal).then(next => {
      cacheRef.current.set(selectedDate, next);
      setData(next);
    }).catch(reason => {
      if ((reason as Error).name !== 'AbortError') setError(reason instanceof Error ? reason.message : '日出货计划加载失败');
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('date', selectedDate);
      window.history.replaceState(window.history.state, '', url);
    } catch {
      // URL synchronization is optional in restricted browser shells.
    }
    return () => controller.abort();
  }, [initialDate, selectedDate, refreshToken]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(''), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!drawerOpen && !dialog) return undefined;
    function onKeyDown(event: globalThis.KeyboardEvent): void {
      if (event.key !== 'Escape' || busy) return;
      if (dialog) setDialog(null);
      else setDrawerOpen(false);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [drawerOpen, dialog, busy]);

  const plan = data?.plan || null;
  const editable = !plan || plan.status === 'DRAFT';
  const filteredItems = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('zh-CN');
    return (plan?.items || []).filter(item => {
      if (stateFilter !== 'all' && item.progressState !== stateFilter) return false;
      if (!term) return true;
      return [item.workOrderCode, item.sourceOrderNo, item.customerName, item.productName, item.specification, item.currentProcess]
        .some(value => String(value || '').toLocaleLowerCase('zh-CN').includes(term));
    });
  }, [plan, search, stateFilter]);

  const filteredCandidates = useMemo(() => {
    const term = candidateSearch.trim().toLocaleLowerCase('zh-CN');
    return (data?.candidates || []).filter(candidate => {
      if (candidateFilter === 'ready' && candidate.completedQuantity <= candidate.shippedQuantity) return false;
      if (candidateFilter === 'available' && candidate.availableQuantity <= 0) return false;
      if (candidateFilter === 'scheduled' && candidate.scheduledQuantity <= 0) return false;
      if (!term) return true;
      return [candidate.workOrderCode, candidate.sourceOrderNo, candidate.customerName, candidate.productName, candidate.specification, candidate.salesperson]
        .some(value => String(value || '').toLocaleLowerCase('zh-CN').includes(term));
    });
  }, [candidateFilter, candidateSearch, data]);

  const selectedCandidateIds = Object.keys(candidateDrafts);
  const selectedCandidateQuantity = selectedCandidateIds.reduce((total, id) => (
    total + Math.max(0, Number(candidateDrafts[id]?.quantity || 0))
  ), 0);

  function openDrawer(): void {
    setError('');
    setCandidateDrafts({});
    setCandidateSearch('');
    setCandidateFilter('all');
    setDrawerOpen(true);
  }

  function toggleCandidate(candidate: DailyShipmentCandidateDTO): void {
    if (!editable || candidate.availableQuantity <= 0) return;
    setCandidateDrafts(current => {
      if (current[candidate.batchId]) {
        const next = { ...current };
        delete next[candidate.batchId];
        return next;
      }
      return {
        ...current,
        [candidate.batchId]: {
          quantity: String(candidate.availableQuantity),
          plannedShipAt: `${selectedDate}T16:00`,
          note: '',
        },
      };
    });
  }

  function updateCandidateDraft(batchId: string, patch: Partial<CandidateDraft>): void {
    setCandidateDrafts(current => ({
      ...current,
      [batchId]: { ...current[batchId], ...patch },
    }));
  }

  async function execute(body: Record<string, unknown>, successMessage: string, options?: { keepDrawer?: boolean }): Promise<void> {
    setBusy(true);
    setError('');
    try {
      await mutateDailyShipment(body);
      cacheRef.current.delete(selectedDate);
      setDialog(null);
      if (!options?.keepDrawer) setDrawerOpen(false);
      setToast(successMessage);
      setRefreshToken(value => value + 1);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '操作失败');
    } finally {
      setBusy(false);
    }
  }

  function addSelectedCandidates(): void {
    const items = selectedCandidateIds.map(batchId => ({
      productionPlanBatchId: batchId,
      plannedQuantity: Number(candidateDrafts[batchId].quantity),
      plannedShipAt: candidateDrafts[batchId].plannedShipAt,
      note: candidateDrafts[batchId].note,
    }));
    void execute({ action: 'ADD_ITEMS', shipDate: selectedDate, items }, `已加入 ${items.length} 个订单`);
  }

  function openDialog(next: DialogState): void {
    setError('');
    setDialog(next);
    if (next.kind === 'edit') setForm({
      quantity: String(next.item.plannedQuantity),
      plannedShipAt: chinaLocalInputFromIso(next.item.plannedShipAt),
      note: next.item.note || '',
    });
    if (next.kind === 'cancel') setForm({ reason: '' });
    if (next.kind === 'ship') {
      const available = candidateAvailableToShip(next.item, data?.candidates || []);
      setForm({
        quantity: String(Math.max(0, Math.min(next.item.pendingQuantity, available))),
        shippedAt: chinaDateTimeInput(),
        note: '',
      });
    }
    if (next.kind === 'reverse') {
      const reversed = next.item.events
        .filter(event => event.eventType === 'REVERSAL' && event.reversalOfEventId === next.event.id)
        .reduce((total, event) => total + event.quantity, 0);
      setForm({ quantity: String(next.event.quantity - reversed), reversedAt: chinaDateTimeInput(), reason: '' });
    }
  }

  function submitDialog(): void {
    if (!dialog) return;
    if (dialog.kind === 'edit') void execute({
      action: 'UPDATE_ITEM',
      itemId: dialog.item.id,
      itemVersion: dialog.item.version,
      plannedQuantity: Number(form.quantity),
      plannedShipAt: form.plannedShipAt,
      note: form.note,
    }, '计划项已更新');
    if (dialog.kind === 'cancel') void execute({
      action: 'CANCEL_ITEM',
      itemId: dialog.item.id,
      itemVersion: dialog.item.version,
      reason: form.reason,
    }, '计划项已取消');
    if (dialog.kind === 'ship') void execute({
      action: 'RECORD_SHIPMENT',
      itemId: dialog.item.id,
      itemVersion: dialog.item.version,
      quantity: Number(form.quantity),
      shippedAt: chinaIsoFromInput(form.shippedAt),
      note: form.note,
    }, '实发记录已登记');
    if (dialog.kind === 'reverse') void execute({
      action: 'REVERSE_SHIPMENT',
      eventId: dialog.event.id,
      itemVersion: dialog.item.version,
      quantity: Number(form.quantity),
      reversedAt: chinaIsoFromInput(form.reversedAt),
      reason: form.reason,
    }, '实发记录已撤销');
    if (dialog.kind === 'confirm' && plan) void execute({
      action: 'CONFIRM_PLAN',
      planId: plan.id,
      planVersion: plan.version,
    }, '当日出货计划已确认');
    if (dialog.kind === 'close' && plan) void execute({
      action: 'CLOSE_PLAN',
      planId: plan.id,
      planVersion: plan.version,
    }, '当日出货计划已关闭');
  }

  const allShipped = Boolean(plan?.items.length) && plan!.items.every(item => item.pendingQuantity === 0);
  const planStatus = data ? (plan ? PLAN_STATUS_TEXT[plan.status] : '未创建') : '同步中';

  return <main className="shipment-shell hm-workbench-root hm-workbench-navigation-overlay">
    <AppWorkbenchHeader
      user={user}
      activeHref="/workspace/daily-plans"
      subtitle="按日编制出货计划并跟踪实发"
      menuItems={[]}
      hideHeader
      sidebarTriggerTargetId="shipment-navigation-trigger"
    />

    <div className="shipment-main">
      <section className="shipment-topbar">
        <div id="shipment-navigation-trigger" className="shipment-navigation-trigger" aria-label="平台导航入口" />
        <div className="shipment-date-navigator">
          <div className={`shipment-history ${historyOpen ? 'open' : ''}`}>
            <button type="button" aria-expanded={historyOpen} onClick={() => setHistoryOpen(value => !value)}><History size={16} /><span>历史日</span><ChevronDown size={13} /></button>
            {historyOpen && <div role="dialog" aria-label="选择出货日期"><label>选择日期<input type="date" value={selectedDate} onChange={event => { setSelectedDate(event.target.value); setHistoryOpen(false); }} /></label><button type="button" onClick={() => { setSelectedDate(chinaDateKey()); setHistoryOpen(false); }}><RotateCcw size={14} />返回今天</button></div>}
          </div>
          <div className="shipment-week-strip" role="group" aria-label="本周出货日期">
            {(data?.week.days || []).map((day, index) => <button
              type="button"
              key={day.date}
              className={`${day.date === selectedDate ? 'selected' : ''} ${day.date === chinaDateKey() ? 'today' : ''}`}
              aria-pressed={day.date === selectedDate}
              onClick={() => setSelectedDate(day.date)}
            >
              <small>{DAY_LABELS[index]}</small><strong>{shortDate(day.date)}</strong>
              {day.date === chinaDateKey() && <em>今天</em>}
              {day.itemCount > 0 && <b>{day.itemCount}</b>}
            </button>)}
            {!data && Array.from({ length: 7 }, (_, index) => <span className="shipment-day-skeleton" key={index} />)}
          </div>
        </div>
        <div className="shipment-plan-context" aria-busy={!data}>
          <CalendarCheck2 size={17} />
          <span><small>当日计划</small><strong>{planStatus}</strong></span>
          {plan?.confirmedBy && <em>{plan.confirmedBy.name} 已确认</em>}
        </div>
        <div className="shipment-top-actions">
          <button type="button" className="secondary" disabled={!editable || loading} onClick={openDrawer}><Plus size={17} />添加本周订单</button>
          {!data && <span className="shipment-action-skeleton" role="status" aria-label="正在同步计划状态" />}
          {data && editable && <button type="button" className="primary" disabled={!plan?.items.length || busy} onClick={() => openDialog({ kind: 'confirm' })}><Check size={17} />确认计划</button>}
          {data && plan?.status === 'CONFIRMED' && <button type="button" className="primary" disabled={!allShipped || busy} onClick={() => openDialog({ kind: 'close' })}><PackageCheck size={17} />关闭计划</button>}
          <details><summary aria-label="更多操作"><Menu size={17} />更多</summary><div><button type="button" onClick={() => setRefreshToken(value => value + 1)}><RefreshCw size={15} />刷新数据</button></div></details>
        </div>
      </section>

      <section className="shipment-kpis" aria-label="当日出货指标" aria-busy={!data}>
        <article><span>计划订单</span><ShipmentMetricValue loaded={Boolean(data)} value={data?.summary.itemCount} unit="批" /><CalendarClock /></article>
        <article><span>计划出货</span><ShipmentMetricValue loaded={Boolean(data)} value={data ? numberText(data.summary.plannedQuantity) : null} unit="件" /><Truck /></article>
        <article className="ready"><span>已完工可备货</span><ShipmentMetricValue loaded={Boolean(data)} value={data ? numberText(data.summary.readyQuantity) : null} unit="件" /><CheckCircle2 /></article>
        <article className="shipped"><span>实际已出货</span><ShipmentMetricValue loaded={Boolean(data)} value={data ? numberText(data.summary.shippedQuantity) : null} unit="件" /><Send /></article>
        <article className="pending"><span>待出货</span><ShipmentMetricValue loaded={Boolean(data)} value={data ? numberText(data.summary.pendingQuantity) : null} unit="件" /><Clock3 /></article>
        <article className="risk"><span>风险订单</span><ShipmentMetricValue loaded={Boolean(data)} value={data?.summary.riskItemCount} unit="批" /><ShieldAlert /></article>
      </section>

      <section className="shipment-list-toolbar">
        <div><span>当日出货清单</span><strong>{shortDate(selectedDate)} · {planStatus}</strong></div>
        <label><Search size={16} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="搜索工单、客户、产品或规格" /></label>
        <select value={stateFilter} onChange={event => setStateFilter(event.target.value as typeof stateFilter)} aria-label="筛选进度状态">
          <option value="all">全部状态</option>
          <option value="READY">已完工待出货</option>
          <option value="IN_PRODUCTION">生产中</option>
          <option value="NOT_STARTED">未开工</option>
          <option value="OVERDUE">已超时</option>
          <option value="PARTIAL">部分出货</option>
          <option value="SHIPPED">已出货</option>
        </select>
        <b>{data ? `${filteredItems.length} / ${plan?.items.length ?? 0} 批` : '— / — 批'}</b>
      </section>

      {error && !dialog && !drawerOpen && <div className="shipment-error" role="alert"><AlertTriangle size={17} /><span>{error}</span><button type="button" onClick={() => setError('')} aria-label="关闭错误"><X size={16} /></button></div>}

      <section className={`shipment-table-card ${loading ? 'loading' : ''}`} aria-busy={loading}>
        {loading && <div className="shipment-loading-line" />}
        {!data && <div className="shipment-initial-loading"><LoaderCircle className="spin" /><strong>正在加载日出货计划</strong><span>同步本周订单、生产进度与出货记录…</span></div>}
        {data && filteredItems.length > 0 && <div className="shipment-table-scroll hm-scroll-region" tabIndex={0}>
          <table>
            <thead><tr><th>订单 / 产品</th><th>计划出货</th><th>生产进度</th><th>出货进度</th><th>时间跟踪</th><th>客户交期</th><th>操作</th></tr></thead>
            <tbody>{filteredItems.map(item => {
              const availableToShip = candidateAvailableToShip(item, data.candidates);
              return <tr key={item.id}>
                <td><OrderIdentity item={item} /></td>
                <td><div className="shipment-plan-quantity"><strong>{numberText(item.plannedQuantity)} 件</strong><span>{timeText(item.plannedShipAt)}</span>{item.note && <small title={item.note}>{item.note}</small>}</div></td>
                <td><div className="shipment-production"><span><b>{item.currentProcess}</b><em>{numberText(item.completedQuantity)} / {numberText(item.batchQuantity)}</em></span><div><i style={{ width: `${Math.min(100, item.productionProgress)}%` }} /></div><small>{numberText(item.productionProgress)}% · {productionStageText(item.productionStage)}</small></div></td>
                <td><div className="shipment-delivery-progress"><span className={`state-${item.progressState.toLocaleLowerCase()}`}>{STATE_TEXT[item.progressState]}</span><strong>{numberText(item.shippedQuantity)} / {numberText(item.plannedQuantity)} 件</strong><small>待出 {numberText(item.pendingQuantity)} 件</small></div></td>
                <td><div className="shipment-time-track"><span><small>计划</small><b>{timeText(item.plannedShipAt)}</b></span><span className={item.actualShipAt ? 'actual' : 'missing'}><small>实发</small><b>{item.actualShipAt ? timeText(item.actualShipAt) : item.progressState === 'OVERDUE' ? '超时未出' : '尚未出货'}</b></span></div></td>
                <td><div className="shipment-due"><strong>{item.customerDueDate.slice(5)}</strong><span>{item.priority === 'urgent' || item.priority === 'insert' ? '优先订单' : '正常交期'}</span></div></td>
                <td><div className="shipment-row-actions">
                  {editable && <button type="button" title="修改计划" onClick={() => openDialog({ kind: 'edit', item })}><Pencil size={15} /></button>}
                  {editable && <button type="button" className="danger" title="取消计划项" onClick={() => openDialog({ kind: 'cancel', item })}><X size={15} /></button>}
                  {plan?.status === 'CONFIRMED' && item.pendingQuantity > 0 && <button type="button" className="ship" disabled={availableToShip <= 0} title={availableToShip > 0 ? '登记实际出货' : '暂无已完工可出货数量'} onClick={() => openDialog({ kind: 'ship', item })}><Truck size={15} />实发</button>}
                  {item.events.length > 0 && <button type="button" className="history" onClick={() => openDialog({ kind: 'events', item })}><History size={15} />{item.events.length}</button>}
                </div></td>
              </tr>;
            })}</tbody>
          </table>
        </div>}
        {data && filteredItems.length === 0 && <div className="shipment-empty">
          <div><Truck size={30} /></div>
          <strong>{plan?.items.length ? '没有匹配的出货订单' : `${shortDate(selectedDate)} 暂无出货计划`}</strong>
          <span>{plan?.items.length ? '调整搜索词或进度筛选条件。' : '从本周已排产订单中选择一批或多批，生成当日出货预览。'}</span>
          {!plan?.items.length && <button type="button" disabled={!editable} onClick={openDrawer}><Plus size={17} />添加本周订单</button>}
        </div>}
      </section>
    </div>

    {drawerOpen && <div className="shipment-candidate-layer open">
      <button type="button" className="shipment-drawer-scrim" aria-label="关闭本周订单抽屉" onClick={() => { if (!busy) { setDrawerOpen(false); setError(''); } }} />
      <aside role="dialog" aria-modal="true" aria-label="添加本周订单">
        <header><div><span>本周订单</span><h2>添加到 {shortDate(selectedDate)} 出货计划</h2><p>支持多选和跨日拆分，累计计划量不能超过生产批次数量。</p></div><button type="button" aria-label="关闭" disabled={busy} onClick={() => { setDrawerOpen(false); setError(''); }}><X size={20} /></button></header>
        <div className="shipment-candidate-tools">
          <label><Search size={16} /><input value={candidateSearch} onChange={event => setCandidateSearch(event.target.value)} placeholder="搜索订单、客户、产品或业务员" /></label>
          <nav>{(['all', 'ready', 'available', 'scheduled'] as const).map(filter => <button type="button" className={candidateFilter === filter ? 'active' : ''} key={filter} onClick={() => setCandidateFilter(filter)}>{filter === 'all' ? '全部' : filter === 'ready' ? '可出货' : filter === 'available' ? '可排计划' : '已拆分'}</button>)}</nav>
        </div>
        {error && <div className="shipment-inline-error drawer" role="alert"><AlertTriangle size={17} /><span>{error}</span></div>}
        <div className="shipment-candidate-list hm-scroll-region">
          {filteredCandidates.map(candidate => {
            const draft = candidateDrafts[candidate.batchId];
            const selected = Boolean(draft);
            return <article className={`${selected ? 'selected' : ''} ${candidate.availableQuantity <= 0 ? 'unavailable' : ''}`} key={candidate.batchId}>
              <button type="button" className="shipment-candidate-select" aria-pressed={selected} disabled={!editable || candidate.availableQuantity <= 0} onClick={() => toggleCandidate(candidate)}><i>{selected && <Check size={13} />}</i><span><strong>{candidate.workOrderCode}</strong><small>{candidate.customerName} · {candidate.productName}</small><em>{candidate.specification} · 第 {candidate.batchNo} 批</em></span></button>
              <dl><div><dt>批次数量</dt><dd>{numberText(candidate.batchQuantity)}</dd></div><div><dt>已排计划</dt><dd>{numberText(candidate.scheduledQuantity)}</dd></div><div><dt>剩余可排</dt><dd>{numberText(candidate.availableQuantity)}</dd></div><div><dt>已完工</dt><dd>{numberText(candidate.completedQuantity)}</dd></div></dl>
              <div className="shipment-candidate-progress"><span><b>{candidate.currentProcess}</b><em>{numberText(candidate.productionProgress)}%</em></span><div><i style={{ width: `${Math.min(100, candidate.productionProgress)}%` }} /></div>{candidate.scheduledDates.length > 0 && <small>已安排：{candidate.scheduledDates.map(shortDate).join('、')}</small>}</div>
              {selected && <div className="shipment-candidate-form"><label>计划数量<input type="number" min="1" max={candidate.availableQuantity} value={draft.quantity} onChange={event => updateCandidateDraft(candidate.batchId, { quantity: event.target.value })} /></label><label>计划时间<input type="datetime-local" min={`${selectedDate}T00:00`} max={`${selectedDate}T23:59`} value={draft.plannedShipAt} onChange={event => updateCandidateDraft(candidate.batchId, { plannedShipAt: event.target.value })} /></label><label className="note">备注<input value={draft.note} maxLength={500} onChange={event => updateCandidateDraft(candidate.batchId, { note: event.target.value })} placeholder="可选" /></label></div>}
            </article>;
          })}
          {!filteredCandidates.length && <div className="shipment-candidate-empty"><PackageCheck size={26} /><strong>没有匹配的本周订单</strong><span>当前周未下达生产，或订单已全部分配完毕。</span></div>}
        </div>
        <footer><span>已选 <b>{selectedCandidateIds.length}</b> 批 · 共 <b>{numberText(selectedCandidateQuantity)}</b> 件</span><div><button type="button" disabled={busy} onClick={() => { setDrawerOpen(false); setError(''); }}>取消</button><button type="button" className="primary" disabled={busy || selectedCandidateIds.length === 0} onClick={addSelectedCandidates}>{busy ? <LoaderCircle className="spin" size={16} /> : <Plus size={16} />}加入当日计划</button></div></footer>
      </aside>
    </div>}

    {dialog && <DialogShell
      title={dialog.kind === 'edit' ? '修改出货计划' : dialog.kind === 'cancel' ? '取消计划项' : dialog.kind === 'ship' ? '登记实际出货' : dialog.kind === 'events' ? '出货流水' : dialog.kind === 'reverse' ? '撤销实发记录' : dialog.kind === 'confirm' ? '确认当日计划' : '关闭当日计划'}
      description={'item' in dialog ? `${dialog.item.workOrderCode} · ${dialog.item.customerName}` : `${selectedDate} · ${plan?.items.length || 0} 批订单`}
      error={error}
      busy={busy}
      onClose={() => { if (!busy) { setDialog(null); setError(''); } }}
    >
      {dialog.kind === 'edit' && <form onSubmit={event => { event.preventDefault(); submitDialog(); }}><OrderIdentity item={dialog.item} /><div className="shipment-dialog-grid"><label>计划数量<input required type="number" min="1" max={dialog.item.batchQuantity} value={form.quantity || ''} onChange={event => setForm(current => ({ ...current, quantity: event.target.value }))} /></label><label>计划出货时间<input required type="datetime-local" min={`${selectedDate}T00:00`} max={`${selectedDate}T23:59`} value={form.plannedShipAt || ''} onChange={event => setForm(current => ({ ...current, plannedShipAt: event.target.value }))} /></label><label className="full">备注<textarea value={form.note || ''} maxLength={500} onChange={event => setForm(current => ({ ...current, note: event.target.value }))} /></label></div><footer><button type="button" onClick={() => setDialog(null)}>取消</button><button className="primary" disabled={busy} type="submit">保存修改</button></footer></form>}
      {dialog.kind === 'cancel' && <form onSubmit={event => { event.preventDefault(); submitDialog(); }}><OrderIdentity item={dialog.item} /><div className="shipment-warning"><AlertTriangle size={18} /><span>取消后会释放该批次的可排数量；历史修改仍会保留。</span></div><label className="shipment-single-field">取消原因<textarea required value={form.reason || ''} maxLength={500} onChange={event => setForm({ reason: event.target.value })} placeholder="请填写取消原因" /></label><footer><button type="button" onClick={() => setDialog(null)}>返回</button><button className="danger" disabled={busy} type="submit">确认取消</button></footer></form>}
      {dialog.kind === 'ship' && <form onSubmit={event => { event.preventDefault(); submitDialog(); }}><OrderIdentity item={dialog.item} /><div className="shipment-availability"><span>本日待出 <b>{numberText(dialog.item.pendingQuantity)}</b> 件</span><span>当前完工可出 <b>{numberText(candidateAvailableToShip(dialog.item, data?.candidates || []))}</b> 件</span></div><div className="shipment-dialog-grid"><label>实际出货数量<input required type="number" min="1" max={Math.min(dialog.item.pendingQuantity, candidateAvailableToShip(dialog.item, data?.candidates || []))} value={form.quantity || ''} onChange={event => setForm(current => ({ ...current, quantity: event.target.value }))} /></label><label>实际出货时间<input required type="datetime-local" max={chinaDateTimeInput()} value={form.shippedAt || ''} onChange={event => setForm(current => ({ ...current, shippedAt: event.target.value }))} /></label><label className="full">出货备注<textarea value={form.note || ''} maxLength={500} onChange={event => setForm(current => ({ ...current, note: event.target.value }))} /></label></div><footer><button type="button" onClick={() => setDialog(null)}>取消</button><button className="primary" disabled={busy || Number(form.quantity) <= 0} type="submit"><Truck size={16} />确认实发</button></footer></form>}
      {dialog.kind === 'events' && <div className="shipment-event-panel"><OrderIdentity item={dialog.item} /><div className="shipment-event-summary"><span>计划 <b>{numberText(dialog.item.plannedQuantity)}</b></span><span>实发 <b>{numberText(dialog.item.shippedQuantity)}</b></span><span>待出 <b>{numberText(dialog.item.pendingQuantity)}</b></span></div><div className="shipment-event-list">{dialog.item.events.map(event => {
        const reversed = dialog.item.events.filter(item => item.eventType === 'REVERSAL' && item.reversalOfEventId === event.id).reduce((total, item) => total + item.quantity, 0);
        return <article className={event.eventType.toLocaleLowerCase()} key={event.id}><i>{event.eventType === 'SHIPMENT' ? <Truck size={15} /> : <RotateCcw size={15} />}</i><span><strong>{event.eventType === 'SHIPMENT' ? `实发 ${numberText(event.quantity)} 件` : `撤销 ${numberText(event.quantity)} 件`}</strong><small>{fullTimeText(event.shippedAt)} · {event.actor.name}</small>{event.reason && <em>{event.reason}</em>}</span>{event.eventType === 'SHIPMENT' && reversed < event.quantity && <button type="button" onClick={() => openDialog({ kind: 'reverse', item: dialog.item, event })}>撤销</button>}</article>;
      })}</div><footer><button className="primary" type="button" onClick={() => setDialog(null)}>完成</button></footer></div>}
      {dialog.kind === 'reverse' && <form onSubmit={event => { event.preventDefault(); submitDialog(); }}><OrderIdentity item={dialog.item} /><div className="shipment-warning"><RotateCcw size={18} /><span>撤销不会删除原记录，而是新增反向流水；已关闭计划会恢复为已确认。</span></div><div className="shipment-dialog-grid"><label>撤销数量<input required type="number" min="1" max={dialog.event.quantity} value={form.quantity || ''} onChange={event => setForm(current => ({ ...current, quantity: event.target.value }))} /></label><label>撤销时间<input required type="datetime-local" max={chinaDateTimeInput()} value={form.reversedAt || ''} onChange={event => setForm(current => ({ ...current, reversedAt: event.target.value }))} /></label><label className="full">撤销原因<textarea required value={form.reason || ''} maxLength={500} onChange={event => setForm(current => ({ ...current, reason: event.target.value }))} /></label></div><footer><button type="button" onClick={() => openDialog({ kind: 'events', item: dialog.item })}>返回流水</button><button className="danger" disabled={busy} type="submit">确认撤销</button></footer></form>}
      {dialog.kind === 'confirm' && <form onSubmit={event => { event.preventDefault(); submitDialog(); }}><div className="shipment-confirm-card"><CalendarCheck2 size={28} /><strong>确认 {shortDate(selectedDate)} 出货计划</strong><span>共 {plan?.items.length || 0} 批、{numberText(data?.summary.plannedQuantity || 0)} 件。确认后不能再增删或修改计划项，只能登记实际出货。</span></div><footer><button type="button" onClick={() => setDialog(null)}>继续编辑</button><button className="primary" disabled={busy} type="submit">确认计划</button></footer></form>}
      {dialog.kind === 'close' && <form onSubmit={event => { event.preventDefault(); submitDialog(); }}><div className="shipment-confirm-card success"><CheckCircle2 size={28} /><strong>关闭 {shortDate(selectedDate)} 出货计划</strong><span>全部 {plan?.items.length || 0} 批订单已完成出货。关闭后如撤销实发，计划会自动恢复为已确认。</span></div><footer><button type="button" onClick={() => setDialog(null)}>返回</button><button className="primary" disabled={busy} type="submit">确认关闭</button></footer></form>}
    </DialogShell>}

    {toast && <div className="shipment-toast" role="status"><CheckCircle2 size={17} />{toast}</div>}
  </main>;
}
