'use client';

import {
  AlertTriangle,
  ArrowRight,
  BellRing,
  CalendarCheck2,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock3,
  History,
  Eye,
  ListFilter,
  LoaderCircle,
  LockOpen,
  Menu,
  MessageSquareText,
  PackageCheck,
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
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { AppWorkbenchHeader } from '@/components/layout/AppWorkbenchHeader';
import {
  fetchDailyShipmentWorkbench,
  fetchShipmentCarryoverOverview,
  fetchShipmentHistoryOverview,
  fetchShipmentWarningOverview,
  mutateDailyShipment,
  type DailyShipmentCandidateDTO,
  type DailyShipmentEventDTO,
  type DailyShipmentItemDTO,
  type DailyShipmentPriority,
  type DailyShipmentWorkbenchDTO,
  type ShipmentCarryoverOverviewDTO,
  type ShipmentHistoryOverviewDTO,
  type ShipmentProgressState,
  type ShipmentWarningOverviewDTO,
} from '@/lib/daily-shipment-client';
import type { CurrentUserDTO } from '@/types';

type CandidateDraft = {
  quantity: string;
  plannedShipAt: string;
  shipmentPriority: DailyShipmentPriority;
  note: string;
};
type CandidateReservation = DailyShipmentCandidateDTO['reservations'][number];
export type ShipmentView = 'today' | 'warning' | 'carryover' | 'history';
type DialogState =
  | { kind: 'edit'; item: DailyShipmentItemDTO }
  | { kind: 'cancel'; item: DailyShipmentItemDTO }
  | { kind: 'ship'; item: DailyShipmentItemDTO }
  | { kind: 'events'; item: DailyShipmentItemDTO }
  | { kind: 'reverse'; item: DailyShipmentItemDTO; event: DailyShipmentEventDTO }
  | { kind: 'confirm' }
  | { kind: 'close' }
  | { kind: 'rollover' }
  | { kind: 'reservations'; candidate: DailyShipmentCandidateDTO }
  | { kind: 'releaseReservation'; candidate: DailyShipmentCandidateDTO; reservation: CandidateReservation }
  | { kind: 'transferReservation'; candidate: DailyShipmentCandidateDTO; reservation: CandidateReservation };

const DAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

const STATE_TEXT: Record<ShipmentProgressState, string> = {
  SHIPPED: '已出货',
  PARTIAL: '部分出货',
  OVERDUE: '已超时',
  READY: '已完工待出货',
  IN_PRODUCTION: '生产中',
  NOT_STARTED: '未开工',
  CARRIED_OVER: '已结转',
};

const PLAN_STATUS_TEXT = {
  DRAFT: '草稿',
  CONFIRMED: '已确认',
  CLOSED: '已关闭',
  CLOSED_WITH_CARRYOVER: '已关闭并结转',
  CANCELLED: '已取消',
} as const;

const PRIORITY_META: Record<DailyShipmentPriority, { label: string; description: string }> = {
  URGENT: { label: '今日必出', description: '红色 · 当日刚性任务' },
  PRIORITY: { label: '重点跟进', description: '黄色 · 重点协同推进' },
  NORMAL: { label: '常规', description: '蓝色 · 正常顺序' },
};

const PRIORITY_VALUES: DailyShipmentPriority[] = ['URGENT', 'PRIORITY', 'NORMAL'];

const ASSOCIATION_TEXT: Record<DailyShipmentItemDTO['associationType'], string> = {
  AUTO_DUE_DATE: '交期自动关联',
  MANUAL: '手工补单',
  CARRYOVER: '顺延转入',
  DUE_DATE_CHANGE: '交期变更同步',
};

const VIEW_META: Record<ShipmentView, { label: string; description: string }> = {
  today: { label: '今日协同清单', description: '待出余额与今日完成分区' },
  warning: { label: '未来 3 天预警', description: '提前提醒，不混入当日计划' },
  carryover: { label: '连续顺延', description: '未出余额持续滚动' },
  history: { label: '出货历史', description: '实发与撤销完整留痕' },
};

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

function defaultShipmentPriority(value: string): DailyShipmentPriority {
  const normalized = value.trim().toLocaleLowerCase();
  if (['urgent', 'insert', '紧急', '插单'].includes(normalized)) return 'URGENT';
  if (['high', 'priority', '优先'].includes(normalized)) return 'PRIORITY';
  return 'NORMAL';
}

function reservationStatusText(reservation: CandidateReservation): string {
  if (reservation.itemStatus === 'CARRIED_OVER') return '历史实发记录';
  if (reservation.itemStatus === 'SHIPPED') return '已完成出货记录';
  return `${PLAN_STATUS_TEXT[reservation.planStatus]}计划`;
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

function PrioritySelector({ value, onChange, disabled = false, compact = false }: {
  value: DailyShipmentPriority;
  onChange: (value: DailyShipmentPriority) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  return <div className={`shipment-priority-selector ${compact ? 'compact' : ''}`} role="radiogroup" aria-label="出货优先级">
    {PRIORITY_VALUES.map(priority => <button
      type="button"
      key={priority}
      role="radio"
      aria-checked={value === priority}
      className={`priority-${priority.toLocaleLowerCase()} ${value === priority ? 'active' : ''}`}
      disabled={disabled}
      onClick={() => onChange(priority)}
    >{PRIORITY_META[priority].label}</button>)}
  </div>;
}

const PRODUCTION_REASON_TEXT: Record<NonNullable<DailyShipmentItemDTO['productionFollowUp']>['category'], string> = {
  material: '缺料', quality: '品质', equipment: '设备', customer: '客户', process: '工艺', other: '其他',
};

function ShipmentMarker({ item, busy, onChange }: {
  item: DailyShipmentItemDTO;
  busy: boolean;
  onChange: (priority: DailyShipmentPriority) => void;
}) {
  return <details className="shipment-marker">
    <summary className={`shipment-priority-badge priority-${item.shipmentPriority.toLocaleLowerCase()}`}>
      <b>{PRIORITY_META[item.shipmentPriority].label}</b>
      <small>{item.isCarryover ? '上日遗留' : PRIORITY_META[item.shipmentPriority].description.split(' · ')[1]}</small>
      <ChevronDown size={12} />
    </summary>
    <div className="shipment-marker-popover">
      <header><span>协同标注</span><strong>今天怎么跟进这批订单？</strong></header>
      {PRIORITY_VALUES.map(priority => <button
        type="button"
        key={priority}
        className={`priority-${priority.toLocaleLowerCase()} ${priority === item.shipmentPriority ? 'active' : ''}`}
        disabled={busy || priority === item.shipmentPriority}
        onClick={event => {
          event.currentTarget.closest('details')?.removeAttribute('open');
          onChange(priority);
        }}
      ><i /><span><b>{PRIORITY_META[priority].label}</b><small>{PRIORITY_META[priority].description}</small></span>{priority === item.shipmentPriority && <Check size={14} />}</button>)}
      <footer>{item.markerAudit ? `${item.markerAudit.actor.name} · ${timeText(item.markerAudit.updatedAt)}` : '尚无人工标注记录'}</footer>
    </div>
  </details>;
}

function ProductionFollowUp({ item }: { item: DailyShipmentItemDTO }) {
  const followUp = item.productionFollowUp;
  if (!followUp) return null;
  return <details className="shipment-production-followup">
    <summary title={followUp.text}><MessageSquareText size={12} /><span>生产跟进</span><b>{PRODUCTION_REASON_TEXT[followUp.category]}</b></summary>
    <div>
      <small>来自生产执行 · 只读同步</small>
      <strong>{followUp.text}</strong>
      <span>{followUp.owner ? `跟进：${followUp.owner}` : '未指定跟进人'}{followUp.updatedBy ? ` · ${followUp.updatedBy}` : ''}</span>
      {followUp.followUpAt && <em>计划跟进 {timeText(followUp.followUpAt)}</em>}
    </div>
  </details>;
}

function OrderIdentity({ item }: { item: Pick<DailyShipmentItemDTO, 'workOrderCode' | 'sourceOrderNo' | 'customerName' | 'productName' | 'specification' | 'batchNo' | 'isCarryover' | 'carryoverDayCount' | 'carriedOverToDate'> }) {
  return <div className="shipment-order-identity">
    <strong className="shipment-customer-name">{item.customerName}</strong>
    <span className="shipment-product-spec">{item.productName} · {item.specification}</span>
    <div className="shipment-order-meta">
      <CompactOrderCode value={item.workOrderCode} />
      <small>{item.sourceOrderNo} · 第 {item.batchNo} 批</small>
    </div>
    {(item.isCarryover || item.carriedOverToDate) && <div className="shipment-lineage-badges">
      {item.isCarryover && <b>上日遗留{item.carryoverDayCount > 1 ? ` · 连续 ${item.carryoverDayCount} 天` : ''}</b>}
      {item.carriedOverToDate && <em>已结转至 {shortDate(item.carriedOverToDate)}</em>}
    </div>}
  </div>;
}

function CompactOrderCode({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const compact = value.length > 25 ? `${value.slice(0, 10)}…${value.slice(-11)}` : value;
  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      // The full code remains available through focus/hover even if clipboard access is denied.
    }
  }
  return <button
    type="button"
    className="shipment-order-code"
    data-full-code={value}
    aria-label={`工单号 ${value}，点击复制`}
    onClick={() => { void copy(); }}
  >{copied ? '已复制' : compact}</button>;
}

function ShipmentMetricValue({ loaded, value, unit, detail }: { loaded: boolean; value: React.ReactNode; unit: string; detail?: string }) {
  return <strong className={loaded ? undefined : 'loading'} aria-label={loaded ? undefined : '加载中'}>
    {loaded ? <>{value}<small>{unit}</small>{detail && <em>{detail}</em>}</> : <i aria-hidden="true" />}
  </strong>;
}

function InsightLoading({ label }: { label: string }) {
  return <section className="shipment-insight-loading" role="status">
    <LoaderCircle className="spin" size={30} />
    <strong>{label}</strong>
    <span>正在同步交期、生产进度和实际出货流水…</span>
  </section>;
}

function WarningPanel({ data, date, loading, onDateChange, onRefresh, onOpenDate }: {
  data: ShipmentWarningOverviewDTO | null;
  date: string;
  loading: boolean;
  onDateChange: (date: string) => void;
  onRefresh: () => void;
  onOpenDate: (date: string) => void;
}) {
  const [statusFilter, setStatusFilter] = useState<'all' | 'risk' | 'pending' | 'completed' | 'unlinked'>('all');
  const [query, setQuery] = useState('');
  useEffect(() => {
    setStatusFilter('all');
    setQuery('');
  }, [date]);
  if (!data) return <InsightLoading label="正在加载未来 3 天预警" />;
  const term = query.trim().toLocaleLowerCase('zh-CN');
  const visibleGroups = data.groups.map(group => ({
    ...group,
    items: group.items.filter(item => {
      if (statusFilter === 'risk' && (item.pendingQuantity <= 0 || item.completedQuantity - item.shippedQuantity >= item.pendingQuantity)) return false;
      if (statusFilter === 'pending' && item.shipmentState === 'SHIPPED') return false;
      if (statusFilter === 'completed' && item.shipmentState !== 'SHIPPED') return false;
      if (statusFilter === 'unlinked' && item.associationHealthy) return false;
      if (!term) return true;
      return [item.workOrderCode, item.sourceOrderNo, item.customerName, item.productName, item.specification]
        .some(value => value.toLocaleLowerCase('zh-CN').includes(term));
    }),
  })).filter(group => group.items.length > 0);
  const warningLabel = (days: number) => days < 0
    ? `已逾期 ${Math.abs(days)} 天`
    : days === 0 ? '今日到期' : days === 1 ? '明日到期' : `距交期 ${days} 天`;
  return <>
    <section className="shipment-insight-head shipment-glass-surface">
      <div><CalendarClock size={22} /><span><small>交期预警窗口</small><strong>{data.rangeStartDate} — {data.rangeEndDate}</strong></span></div>
      <div className="shipment-insight-date"><label htmlFor="shipment-warning-date">基准日</label><input id="shipment-warning-date" type="date" value={date} onChange={event => onDateChange(event.target.value)} /></div>
      <button type="button" onClick={onRefresh} disabled={loading}><RefreshCw className={loading ? 'spin' : ''} size={17} />刷新</button>
    </section>
    <section className="shipment-insight-kpis shipment-glass-surface" aria-label="交期预警指标">
      <article><span>窗口订单</span><strong>{data.summary.itemCount}<small>批</small></strong><BellRing /></article>
      <article className="risk"><span>已逾期</span><strong>{data.summary.overdueCount}<small>批</small></strong><ShieldAlert /></article>
      <article className="pending"><span>今日到期</span><strong>{data.summary.todayCount}<small>批</small></strong><CalendarCheck2 /></article>
      <article className="priority-priority"><span>明日到期</span><strong>{data.summary.tomorrowCount}<small>批</small></strong><Clock3 /></article>
      <article><span>2 天后</span><strong>{data.summary.twoDaysCount}<small>批</small></strong><CalendarClock /></article>
      <article><span>3 天后</span><strong>{data.summary.threeDaysCount}<small>批</small></strong><CalendarClock /></article>
      <article className="risk"><span>生产风险</span><strong>{data.summary.productionRiskCount}<small>批</small></strong><AlertTriangle /></article>
      <article className="ready"><span>已完成出货</span><strong>{data.summary.completedCount}<small>批</small></strong><CheckCircle2 /></article>
    </section>
    <section className="shipment-insight-banner warning shipment-glass-surface">
      <AlertTriangle size={19} /><div><strong>{shortDate(data.rangeStartDate)} 起至未来 3 天共 {data.summary.itemCount} 批，待出 {numberText(data.summary.pendingQuantity)} 件</strong><span>已完成、未完成与历史预期订单统一保留；启用日前订单不计入。</span></div>
      <nav className="shipment-warning-filters" aria-label="预警状态筛选">
        {([['all', '全部'], ['pending', `未完成 ${data.summary.incompleteCount}`], ['completed', `已完成 ${data.summary.completedCount}`], ['risk', '生产风险'], ['unlinked', `待关联 ${data.summary.associationIssueCount}`]] as const).map(([value, label]) => <button type="button" key={value} className={statusFilter === value ? 'active' : ''} onClick={() => setStatusFilter(value)}>{label}</button>)}
      </nav>
    </section>
    <section className="shipment-insight-toolbar shipment-glass-surface">
      <div><span>交期预警</span><strong>{data.rangeStartDate.slice(5)} — {data.rangeEndDate.slice(5)} · 含逾期与未来 3 天</strong></div>
      <label><Search size={16} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索工单、产品、客户" /></label>
      <b>{visibleGroups.reduce((sum, group) => sum + group.items.length, 0)} / {data.summary.itemCount} 批</b>
    </section>
    <section className="shipment-insight-table shipment-glass-surface">
      <div className="shipment-table-scroll hm-scroll-region" tabIndex={0}>
        <table><thead><tr><th>预警</th><th>客户 / 产品规格</th><th>客户交期</th><th>待出数量</th><th>生产状态</th><th>出货状态</th><th>日计划关联</th><th>操作</th></tr></thead>
          <tbody>{visibleGroups.map(group => <Fragment key={group.level}>
            <tr className="shipment-group-row"><td colSpan={8}><strong>{group.label}</strong><span>{group.items.length} 批 · 待出 {numberText(group.items.reduce((sum, item) => sum + item.pendingQuantity, 0))} 件</span></td></tr>
            {group.items.map(item => <tr key={item.batchId}>
              <td><span className={`shipment-warning-badge level-${item.warningLevel.toLocaleLowerCase()}`}>{warningLabel(item.daysUntilDue)}</span></td>
              <td><div className="shipment-order-identity"><strong className="shipment-customer-name">{item.customerName}</strong><span className="shipment-product-spec">{item.productName} · {item.specification}</span><div className="shipment-order-meta"><CompactOrderCode value={item.workOrderCode} /><small>{item.sourceOrderNo}</small></div></div></td>
              <td><div className="shipment-due"><strong>{item.customerDueDate.slice(5)}</strong><span>原客户交期</span></div></td>
              <td><div className="shipment-plan-quantity"><strong>{numberText(item.pendingQuantity)} 件</strong><small>计划 {numberText(item.batchQuantity)} · 已出 {numberText(item.shippedQuantity)}</small></div></td>
              <td><div className="shipment-production"><span><b>{productionStageText(item.productionStage)}</b><em>{numberText(item.completedQuantity)} / {numberText(item.batchQuantity)}</em></span><div><i style={{ width: `${Math.min(100, item.productionProgress)}%` }} /></div><small>{numberText(item.productionProgress)}%</small></div></td>
              <td><div className="shipment-current-process"><strong>{item.shipmentState === 'SHIPPED' ? '已完成出货' : item.shipmentState === 'PARTIAL' ? '部分已发' : item.shipmentState === 'OVERDUE' ? '逾期未出' : '等待出货'}</strong><span>{item.currentProcess}</span></div></td>
              <td><div className={`shipment-association ${item.associationHealthy ? 'healthy' : 'issue'}`}><strong>{item.associationHealthy ? (item.planningState === 'CARRIED_OVER' ? '已顺延关联' : '关联正常') : '关联待修复'}</strong><span>{item.associatedPlanDate || '历史预期 · 尚未生成'}</span></div></td>
              <td><button type="button" className="shipment-table-action" onClick={() => onOpenDate(item.associatedPlanDate || (item.daysUntilDue < 0 ? data.anchorDate : item.customerDueDate))}>查看日计划</button></td>
            </tr>)}</Fragment>)}</tbody>
        </table>
      </div>
    </section>
  </>;
}

function CarryoverPanel({ data, date, loading, onDateChange, onRefresh, onShip }: {
  data: ShipmentCarryoverOverviewDTO | null;
  date: string;
  loading: boolean;
  onDateChange: (date: string) => void;
  onRefresh: () => void;
  onShip: (item: DailyShipmentItemDTO) => void;
}) {
  const [query, setQuery] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  if (!data) return <InsightLoading label="正在加载连续顺延清单" />;
  const term = query.trim().toLocaleLowerCase('zh-CN');
  const visible = data.items.filter(entry => !term || [entry.item.workOrderCode, entry.item.sourceOrderNo, entry.item.customerName, entry.item.productName, entry.item.specification]
    .some(value => value.toLocaleLowerCase('zh-CN').includes(term)));
  return <>
    <section className="shipment-insight-head shipment-glass-surface">
      <div><RotateCcw size={22} /><span><small>顺延基准</small><strong>截至 {data.asOfDate}</strong></span></div>
      <div className="shipment-insight-date"><label htmlFor="shipment-carryover-date">截止日</label><input id="shipment-carryover-date" type="date" value={date} onChange={event => onDateChange(event.target.value)} /></div>
      <button type="button" onClick={onRefresh} disabled={loading}><RefreshCw className={loading ? 'spin' : ''} size={17} />刷新</button>
    </section>
    <section className="shipment-insight-kpis shipment-glass-surface" aria-label="连续顺延指标">
      <article className="carryover"><span>顺延中</span><strong>{data.summary.itemCount}<small>批</small></strong><RotateCcw /></article>
      <article><span>顺延数量</span><strong>{numberText(data.summary.pendingQuantity)}<small>件</small></strong><Truck /></article>
      <article><span>顺延 1 天</span><strong>{data.summary.oneDayCount}<small>批</small></strong><Clock3 /></article>
      <article className="carryover"><span>顺延 2 天</span><strong>{data.summary.twoDayCount}<small>批</small></strong><Clock3 /></article>
      <article className="risk"><span>3 天以上</span><strong>{data.summary.threePlusDayCount}<small>批</small></strong><ShieldAlert /></article>
      <article className="ready"><span>已完工待出</span><strong>{data.summary.readyCount}<small>批</small></strong><CheckCircle2 /></article>
      <article className="risk"><span>生产未完成</span><strong>{data.summary.productionRiskCount}<small>批</small></strong><AlertTriangle /></article>
      <article><span>最长顺延</span><strong>{data.summary.maxDayCount}<small>天</small></strong><CalendarClock /></article>
    </section>
    <section className="shipment-insight-banner carryover shipment-glass-surface"><BellRing size={19} /><div><strong>{data.summary.itemCount} 批未出订单已连续滚动到当前日</strong><span>自动顺延只移动未出数量，原日期实发流水永久保留；生产结单状态不受影响。</span></div></section>
    <section className="shipment-insight-toolbar shipment-glass-surface"><div><span>连续顺延清单</span><strong>只展示当前仍有待出数量的有效任务</strong></div><label><Search size={16} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索工单、产品、客户" /></label><b>{visible.length} / {data.items.length} 批</b></section>
    <section className="shipment-insight-table shipment-glass-surface"><div className="shipment-table-scroll hm-scroll-region" tabIndex={0}><table><thead><tr><th>顺延状态</th><th>订单 / 产品</th><th>原客户交期</th><th>当前计划日</th><th>未出数量</th><th>生产 / 可出</th><th>顺延轨迹</th><th>操作</th></tr></thead><tbody>{visible.map(entry => <Fragment key={entry.item.id}><tr>
      <td><span className={`shipment-carryover-badge ${entry.item.carryoverDayCount >= 3 ? 'critical' : ''}`}>{entry.item.carryoverDayCount >= 3 ? '连续' : '顺延'} {entry.item.carryoverDayCount} 天</span></td>
      <td><OrderIdentity item={entry.item} /></td><td><div className="shipment-due"><strong>{entry.originalDueDate.slice(5)}</strong><span>原始交期</span></div></td><td><div className="shipment-due current"><strong>{entry.currentPlanDate.slice(5)}</strong><span>当前待发日</span></div></td>
      <td><div className="shipment-plan-quantity"><strong>{numberText(entry.item.pendingQuantity)} 件</strong><small>原计划 {numberText(entry.item.batchQuantity)} 件</small></div></td>
      <td><div className="shipment-production"><span><b>{entry.item.currentProcess}</b><em>{numberText(entry.item.completedQuantity)} / {numberText(entry.item.batchQuantity)}</em></span><div><i style={{ width: `${Math.min(100, entry.item.productionProgress)}%` }} /></div><small>{entry.item.completedQuantity >= entry.item.pendingQuantity ? '已具备出货量' : '等待生产完成'}</small></div></td>
      <td><button type="button" className="shipment-trace-button" aria-expanded={expandedId === entry.item.id} onClick={() => setExpandedId(current => current === entry.item.id ? null : entry.item.id)}><History size={15} />{expandedId === entry.item.id ? '收起轨迹' : `查看 ${entry.lineage.length} 日轨迹`}</button></td>
      <td><button type="button" className="shipment-table-action primary" disabled={entry.item.completedQuantity <= 0 || entry.item.pendingQuantity <= 0} onClick={() => onShip(entry.item)}><Truck size={15} />发送出货</button></td>
    </tr>{expandedId === entry.item.id && <tr className="shipment-lineage-row"><td colSpan={8}><div>{entry.lineage.map((node, index) => <Fragment key={`${node.date}-${index}`}><span className={node.status.toLocaleLowerCase()}><b>{node.date.slice(5)}</b><em>计划 {numberText(node.plannedQuantity)} · 已出 {numberText(node.shippedQuantity)} · 未出 {numberText(node.pendingQuantity)}</em></span>{index < entry.lineage.length - 1 && <ArrowRight size={15} />}</Fragment>)}</div></td></tr>}</Fragment>)}</tbody></table></div></section>
  </>;
}

function HistoryPanel({ data, from, to, loading, onRangeChange, onRefresh }: {
  data: ShipmentHistoryOverviewDTO | null;
  from: string;
  to: string;
  loading: boolean;
  onRangeChange: (next: { from?: string; to?: string }) => void;
  onRefresh: () => void;
}) {
  const [query, setQuery] = useState('');
  if (!data) return <InsightLoading label="正在加载出货历史" />;
  const term = query.trim().toLocaleLowerCase('zh-CN');
  const visible = data.events.filter(event => !term || [event.workOrderCode, event.sourceOrderNo, event.customerName, event.productName, event.specification, event.actor.name]
    .some(value => value.toLocaleLowerCase('zh-CN').includes(term)));
  return <>
    <section className="shipment-insight-head shipment-glass-surface"><div><History size={22} /><span><small>出货历史</small><strong>{data.from} — {data.to}</strong></span></div><div className="shipment-history-range"><label>开始日<input type="date" value={from} onChange={event => onRangeChange({ from: event.target.value })} /></label><label>结束日<input type="date" value={to} onChange={event => onRangeChange({ to: event.target.value })} /></label></div><button type="button" onClick={onRefresh} disabled={loading}><RefreshCw className={loading ? 'spin' : ''} size={17} />刷新</button></section>
    <section className="shipment-insight-kpis shipment-history-kpis shipment-glass-surface"><article><span>流水记录</span><strong>{data.summary.eventCount}<small>笔</small></strong><History /></article><article className="shipped"><span>实发笔数</span><strong>{data.summary.shipmentCount}<small>笔</small></strong><Truck /></article><article className="shipped"><span>实发数量</span><strong>{numberText(data.summary.shippedQuantity)}<small>件</small></strong><Send /></article><article className="risk"><span>撤销笔数</span><strong>{data.summary.reversalCount}<small>笔</small></strong><RotateCcw /></article><article className="risk"><span>撤销数量</span><strong>{numberText(data.summary.reversedQuantity)}<small>件</small></strong><RotateCcw /></article><article className="ready"><span>净出货</span><strong>{numberText(data.summary.netQuantity)}<small>件</small></strong><CheckCircle2 /></article></section>
    <section className="shipment-insight-banner history shipment-glass-surface"><ShieldAlert size={19} /><div><strong>实发与撤销均保留独立流水</strong><span>撤销不删除原记录，净出货数量按实发减撤销计算。</span></div></section>
    <section className="shipment-insight-toolbar shipment-glass-surface"><div><span>出货流水明细</span><strong>{data.from.slice(5)} — {data.to.slice(5)}</strong></div><label><Search size={16} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索工单、客户、产品或操作人" /></label><b>{visible.length} / {data.events.length} 笔</b></section>
    <section className="shipment-insight-table shipment-history-table shipment-glass-surface"><div className="shipment-table-scroll hm-scroll-region" tabIndex={0}><table><thead><tr><th>流水类型</th><th>订单 / 产品</th><th>出货时间</th><th>数量</th><th>计划日</th><th>客户交期</th><th>操作人</th><th>备注</th></tr></thead><tbody>{visible.map(event => <tr key={event.id}><td><span className={`shipment-event-badge ${event.eventType.toLocaleLowerCase()}`}>{event.eventType === 'SHIPMENT' ? '实际出货' : '撤销实发'}</span></td><td><div className="shipment-order-identity"><strong>{event.workOrderCode}</strong><span>{event.customerName} · {event.productName}</span><small>{event.specification}</small></div></td><td><div className="shipment-time-track"><span className="actual"><b>{fullTimeText(event.shippedAt)}</b></span></div></td><td><strong className={event.netQuantity < 0 ? 'shipment-negative' : 'shipment-positive'}>{event.netQuantity > 0 ? '+' : ''}{numberText(event.netQuantity)} 件</strong></td><td>{event.planShipDate}</td><td>{event.customerDueDate}</td><td>{event.actor.name}</td><td>{event.reason || '—'}</td></tr>)}</tbody></table></div></section>
  </>;
}

export default function DailyShipmentWorkbench({
  user,
  initialDate,
  initialData,
  initialView = 'today',
  initialWarningData = null,
  initialCarryoverData = null,
  initialHistoryData = null,
}: {
  user: CurrentUserDTO;
  initialDate: string;
  initialData: DailyShipmentWorkbenchDTO;
  initialView?: ShipmentView;
  initialWarningData?: ShipmentWarningOverviewDTO | null;
  initialCarryoverData?: ShipmentCarryoverOverviewDTO | null;
  initialHistoryData?: ShipmentHistoryOverviewDTO | null;
}) {
  const [activeView, setActiveView] = useState<ShipmentView>(initialView);
  const [selectedDate, setSelectedDate] = useState(initialDate);
  const [data, setData] = useState<DailyShipmentWorkbenchDTO | null>(initialData);
  const [refreshToken, setRefreshToken] = useState(0);
  const [insightRefreshToken, setInsightRefreshToken] = useState(0);
  const [warningData, setWarningData] = useState<ShipmentWarningOverviewDTO | null>(initialWarningData);
  const [carryoverData, setCarryoverData] = useState<ShipmentCarryoverOverviewDTO | null>(initialCarryoverData);
  const [historyData, setHistoryData] = useState<ShipmentHistoryOverviewDTO | null>(initialHistoryData);
  const [insightLoading, setInsightLoading] = useState(false);
  const [historyFrom, setHistoryFrom] = useState(`${initialDate.slice(0, 8)}01`);
  const [historyTo, setHistoryTo] = useState(initialDate);
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
  const [priorityFilter, setPriorityFilter] = useState<'all' | DailyShipmentPriority>('all');
  const [stateFilter, setStateFilter] = useState<'all' | ShipmentProgressState>('all');
  const [carryoverOnly, setCarryoverOnly] = useState(false);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const cacheRef = useRef(new Map<string, DailyShipmentWorkbenchDTO>([[initialDate, initialData]]));

  useEffect(() => {
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('date', selectedDate);
      window.history.replaceState(window.history.state, '', url);
    } catch {
      // URL synchronization is optional in restricted browser shells.
    }
    const controller = new AbortController();
    const cached = cacheRef.current.get(selectedDate);
    if (cached && refreshToken === 0) {
      setData(cached);
      setLoading(false);
      return () => controller.abort();
    }
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
    return () => controller.abort();
  }, [initialDate, selectedDate, refreshToken]);

  useEffect(() => {
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('view', activeView);
      window.history.replaceState(window.history.state, '', url);
    } catch {
      // URL synchronization is optional in restricted browser shells.
    }
    if (activeView === 'today') {
      setInsightLoading(false);
      return undefined;
    }
    const hasInitialInsight = activeView === 'warning'
      ? Boolean(initialWarningData)
      : activeView === 'carryover'
        ? Boolean(initialCarryoverData)
        : Boolean(initialHistoryData);
    const initialInsightMatches = activeView === 'history'
      ? historyFrom === initialHistoryData?.from && historyTo === initialHistoryData?.to
      : selectedDate === initialDate;
    if (insightRefreshToken === 0 && hasInitialInsight && initialInsightMatches) {
      setInsightLoading(false);
      return undefined;
    }
    if (activeView === 'history' && historyFrom > historyTo) {
      setHistoryData(null);
      setError('出货历史的开始日期不能晚于结束日期');
      setInsightLoading(false);
      return undefined;
    }
    const controller = new AbortController();
    setInsightLoading(true);
    setError('');
    const request = activeView === 'warning'
      ? fetchShipmentWarningOverview(selectedDate, controller.signal).then(setWarningData)
      : activeView === 'carryover'
        ? fetchShipmentCarryoverOverview(selectedDate, controller.signal).then(setCarryoverData)
        : fetchShipmentHistoryOverview(historyFrom, historyTo, controller.signal).then(setHistoryData);
    void request.catch(reason => {
      if ((reason as Error).name !== 'AbortError') {
        setError(reason instanceof Error ? reason.message : '出货视图加载失败');
      }
    }).finally(() => {
      if (!controller.signal.aborted) setInsightLoading(false);
    });
    return () => controller.abort();
  }, [activeView, historyFrom, historyTo, initialCarryoverData, initialDate, initialHistoryData, initialWarningData, insightRefreshToken, selectedDate]);

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
  const canSupplement = !plan || plan.status === 'DRAFT' || plan.status === 'CONFIRMED';
  const filteredItems = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('zh-CN');
    return (data?.displayItems || []).filter(item => {
      if (priorityFilter !== 'all' && item.shipmentPriority !== priorityFilter) return false;
      if (stateFilter !== 'all' && item.progressState !== stateFilter) return false;
      if (carryoverOnly && !item.isCarryover) return false;
      if (!term) return true;
      return [item.workOrderCode, item.sourceOrderNo, item.customerName, item.productName, item.specification, item.currentProcess]
        .some(value => String(value || '').toLocaleLowerCase('zh-CN').includes(term));
    });
  }, [carryoverOnly, data, priorityFilter, search, stateFilter]);

  const filteredCandidates = useMemo(() => {
    const term = candidateSearch.trim().toLocaleLowerCase('zh-CN');
    return (data?.candidates || []).filter(candidate => {
      if (!candidate.eligibleForSelectedDate) return false;
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
    if (!canSupplement || candidate.availableQuantity <= 0) return;
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
          shipmentPriority: defaultShipmentPriority(candidate.priority),
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
      cacheRef.current.clear();
      setDialog(null);
      if (!options?.keepDrawer) setDrawerOpen(false);
      setToast(successMessage);
      setRefreshToken(value => value + 1);
      setInsightRefreshToken(value => value + 1);
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
      shipmentPriority: candidateDrafts[batchId].shipmentPriority,
      note: candidateDrafts[batchId].note,
    }));
    void execute({ action: 'ADD_ITEMS', shipDate: selectedDate, items }, `已加入 ${items.length} 个订单`);
  }

  function setItemMarker(item: DailyShipmentItemDTO, shipmentPriority: DailyShipmentPriority): void {
    if (item.shipmentPriority === shipmentPriority) return;
    void execute({
      action: 'SET_ITEM_MARK',
      itemId: item.id,
      itemVersion: item.version,
      shipmentPriority,
    }, `已标注为“${PRIORITY_META[shipmentPriority].label}”`);
  }

  function openDialog(next: DialogState): void {
    setError('');
    setDialog(next);
    if (next.kind === 'edit') setForm({
      quantity: String(next.item.plannedQuantity),
      plannedShipAt: chinaLocalInputFromIso(next.item.plannedShipAt),
      shipmentPriority: next.item.shipmentPriority,
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

  function viewReservationPlan(reservation: CandidateReservation): void {
    setDialog(null);
    setDrawerOpen(false);
    setError('');
    setSelectedDate(reservation.shipDate);
  }

  function releaseReservation(reservation: CandidateReservation): void {
    void execute({
      action: 'RELEASE_RESERVATION',
      itemId: reservation.itemId,
      itemVersion: reservation.itemVersion,
    }, `已释放 ${shortDate(reservation.shipDate)} 的旧计划占用`, { keepDrawer: true });
  }

  function transferReservation(reservation: CandidateReservation): void {
    void execute({
      action: 'TRANSFER_RESERVATION',
      itemId: reservation.itemId,
      itemVersion: reservation.itemVersion,
      targetShipDate: selectedDate,
    }, `已结转到 ${shortDate(selectedDate)} 出货计划`, { keepDrawer: true });
  }

  function submitDialog(): void {
    if (!dialog) return;
    if (dialog.kind === 'edit') void execute({
      action: 'UPDATE_ITEM',
      itemId: dialog.item.id,
      itemVersion: dialog.item.version,
      plannedQuantity: Number(form.quantity),
      plannedShipAt: form.plannedShipAt,
      shipmentPriority: form.shipmentPriority,
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
    if (dialog.kind === 'rollover' && plan) void execute({
      action: 'ROLL_OVER_PLAN',
      planId: plan.id,
      planVersion: plan.version,
    }, '未完成订单已结转到次日计划');
  }

  const allShipped = Boolean(plan?.items.length) && plan!.items.every(item => item.pendingQuantity === 0);
  const planStatus = data ? (plan ? PLAN_STATUS_TEXT[plan.status] : data.displayItems.length ? '自动汇总' : '未创建') : '同步中';

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
      <nav className="shipment-view-tabs shipment-glass-surface" aria-label="日出货计划视图">
        {(['today', 'warning', 'carryover', 'history'] as const).map(view => {
          const Icon = view === 'today' ? CalendarCheck2 : view === 'warning' ? BellRing : view === 'carryover' ? RotateCcw : History;
          const count = view === 'today'
            ? data?.summary.itemCount
            : view === 'warning'
              ? warningData?.summary.itemCount
              : view === 'carryover'
                ? carryoverData?.summary.itemCount
                : historyData?.summary.eventCount;
          return <button
            type="button"
            key={view}
            className={activeView === view ? 'active' : ''}
            aria-current={activeView === view ? 'page' : undefined}
            onClick={() => { setActiveView(view); setError(''); setDrawerOpen(false); }}
          >
            <Icon size={18} />
            <span><strong>{VIEW_META[view].label}</strong><small>{VIEW_META[view].description}</small></span>
            {typeof count === 'number' && <b>{count}</b>}
          </button>;
        })}
        <div className="shipment-view-rule"><CheckCircle2 size={16} /><span>生产结单与出货状态独立</span></div>
      </nav>

      {activeView === 'today' && <>
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
          <span><small>交期清单</small><strong>{planStatus}</strong></span>
          {plan?.confirmedBy && <em>{plan.confirmedBy.name} 已确认</em>}
        </div>
        <div className="shipment-top-actions">
          <button type="button" className="secondary" disabled={!canSupplement || loading} onClick={openDrawer}><Plus size={17} />手工补单</button>
          {!data && <span className="shipment-action-skeleton" role="status" aria-label="正在同步计划状态" />}
          {data && editable && <button type="button" className="primary" disabled={!plan?.items.length || busy} onClick={() => openDialog({ kind: 'confirm' })}><Check size={17} />确认计划</button>}
          {data && plan?.status === 'CONFIRMED' && <button type="button" className="primary" disabled={!allShipped || busy} onClick={() => openDialog({ kind: 'close' })}><PackageCheck size={17} />关闭计划</button>}
          <details><summary aria-label="更多操作"><Menu size={17} />更多</summary><div>
            <button type="button" onClick={() => setRefreshToken(value => value + 1)}><RefreshCw size={15} />刷新数据</button>
          </div></details>
        </div>
      </section>

      <section className="shipment-kpis" aria-label="当日出货指标" aria-busy={!data}>
        <article><span>待处理</span><ShipmentMetricValue loaded={Boolean(data)} value={data?.summary.itemCount} unit="批" detail={data ? `${numberText(data.summary.pendingQuantity)} 件待出` : undefined} /><CalendarClock /></article>
        <article className="priority-urgent"><span>今日必出</span><ShipmentMetricValue loaded={Boolean(data)} value={data?.summary.urgent.itemCount} unit="批" detail={data ? `${numberText(data.summary.urgent.quantity)} 件` : undefined} /><ShieldAlert /></article>
        <article className="priority-priority"><span>重点跟进</span><ShipmentMetricValue loaded={Boolean(data)} value={data?.summary.priority.itemCount} unit="批" detail={data ? `${numberText(data.summary.priority.quantity)} 件` : undefined} /><Clock3 /></article>
        <article className="priority-normal"><span>常规</span><ShipmentMetricValue loaded={Boolean(data)} value={data?.summary.normal.itemCount} unit="批" detail={data ? `${numberText(data.summary.normal.quantity)} 件` : undefined} /><ListFilter /></article>
        <article className="shipped"><span>今日已出</span><ShipmentMetricValue loaded={Boolean(data)} value={data?.summary.completed.itemCount} unit="批" detail={data ? `${numberText(data.summary.completed.quantity)} 件` : undefined} /><Send /></article>
      </section>

      {data && data.summary.carryover.itemCount > 0 && <section className="shipment-carryover-banner incoming">
        <BellRing size={18} />
        <div><strong>上日遗留 {data.summary.carryover.itemCount} 批 · {numberText(data.summary.carryover.quantity)} 件</strong><span>已自动同步到今日计划{data.summary.carryover.maxDayCount > 1 ? `，最长连续遗留 ${data.summary.carryover.maxDayCount} 天` : ''}</span></div>
        <button type="button" onClick={() => { setCarryoverOnly(true); setPriorityFilter('all'); setStateFilter('all'); }}>查看遗留</button>
        {data.summary.carryover.sourceDate && <button type="button" className="primary" onClick={() => setSelectedDate(data.summary.carryover.sourceDate!)}>查看来源</button>}
      </section>}
      {data && data.summary.carryover.itemCount === 0 && data.summary.carriedOut.itemCount > 0 && <section className="shipment-carryover-banner outgoing">
        <CheckCircle2 size={18} />
        <div><strong>未完成订单已结转</strong><span>{data.summary.carriedOut.itemCount} 批 · {numberText(data.summary.carriedOut.quantity)} 件已同步到次日计划</span></div>
      </section>}
      {data?.carryoverReconciliation?.blockedReason && <div className="shipment-error compact" role="alert"><AlertTriangle size={16} /><span>{data.carryoverReconciliation.blockedReason}</span></div>}
      {data?.repairSummary?.failed.length ? <div className="shipment-error compact" role="alert"><AlertTriangle size={16} /><span>{data.repairSummary.failed.length} 个交期订单自动关联待重试；当前页面保留已同步数据。</span></div> : null}

      <section className="shipment-list-toolbar">
        <div><span>今日协同清单</span><strong>{data ? `${shortDate(data.range.startDate)}—${shortDate(data.range.endDate)} · ${planStatus}` : `${shortDate(selectedDate)} · ${planStatus}`}</strong></div>
        <label><Search size={16} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="搜索工单、客户、产品或规格" /></label>
        <select value={priorityFilter} onChange={event => { setPriorityFilter(event.target.value as typeof priorityFilter); setCarryoverOnly(false); }} aria-label="筛选出货优先级">
          <option value="all">全部优先级</option>
          <option value="URGENT">今日必出 · 红色</option>
          <option value="PRIORITY">重点跟进 · 黄色</option>
          <option value="NORMAL">常规 · 蓝色</option>
        </select>
        <select value={stateFilter} onChange={event => setStateFilter(event.target.value as typeof stateFilter)} aria-label="筛选进度状态">
          <option value="all">全部状态</option>
          <option value="READY">已完工待出货</option>
          <option value="IN_PRODUCTION">生产中</option>
          <option value="NOT_STARTED">未开工</option>
          <option value="OVERDUE">已超时</option>
          <option value="PARTIAL">部分出货</option>
          <option value="SHIPPED">已出货</option>
          <option value="CARRIED_OVER">已结转</option>
        </select>
        {carryoverOnly && <button type="button" className="shipment-filter-chip" onClick={() => setCarryoverOnly(false)}>仅看遗留 <X size={12} /></button>}
        <b>{data ? `${filteredItems.length} / ${data.displayItems.length} 批` : '— / — 批'}</b>
      </section>

      {error && !dialog && !drawerOpen && <div className="shipment-error" role="alert"><AlertTriangle size={17} /><span>{error}</span><button type="button" onClick={() => setError('')} aria-label="关闭错误"><X size={16} /></button></div>}

      <section className={`shipment-table-card ${loading ? 'loading' : ''}`} aria-busy={loading}>
        {loading && <div className="shipment-loading-line" />}
        {!data && <div className="shipment-initial-loading"><LoaderCircle className="spin" /><strong>正在加载日出货计划</strong><span>同步本周订单、生产进度与出货记录…</span></div>}
        {data && filteredItems.length > 0 && <div className="shipment-table-scroll hm-scroll-region" tabIndex={0}>
          <table>
            <thead><tr><th>协同标注</th><th>客户 / 产品规格</th><th>计划出货</th><th>生产进度</th><th>出货进度</th><th>时间跟踪</th><th>客户交期</th><th>操作</th></tr></thead>
            <tbody>{filteredItems.map((item, index) => {
              const availableToShip = candidateAvailableToShip(item, data.candidates);
              const startsDueDate = index === 0 || filteredItems[index - 1]?.customerDueDate !== item.customerDueDate;
              return <Fragment key={item.id}>
                {startsDueDate && <tr className="shipment-completed-divider shipment-due-divider"><td colSpan={8}><div><CalendarClock size={14} /><strong>{item.customerDueDate === selectedDate ? '今日到期' : `${shortDate(item.customerDueDate)} 交期`}</strong><span>{item.customerDueDate < selectedDate ? `已纳入 ${shortDate(selectedDate)} 日清单，未出余额自动顺延` : '客户交期与所选日期一致'}</span></div></td></tr>}
                <tr className={`shipment-row-priority-${item.shipmentPriority.toLocaleLowerCase()} ${item.isCarryover ? 'is-carryover' : ''} ${item.status === 'SHIPPED' ? 'is-completed' : ''}`}>
                <td><ShipmentMarker item={item} busy={busy} onChange={shipmentPriority => setItemMarker(item, shipmentPriority)} /></td>
                <td><OrderIdentity item={item} /></td>
                <td><div className="shipment-plan-quantity"><strong>{numberText(item.plannedQuantity)} 件</strong><span>{timeText(item.plannedShipAt)}</span><em className={`shipment-source-chip source-${item.associationType.toLocaleLowerCase()}`}>{ASSOCIATION_TEXT[item.associationType]}</em>{item.note && <small title={item.note}>{item.note}</small>}</div></td>
                <td><div className="shipment-production"><span><b>{item.currentProcess}</b><em>{numberText(item.completedQuantity)} / {numberText(item.batchQuantity)}</em></span><div><i style={{ width: `${Math.min(100, item.productionProgress)}%` }} /></div><small>{numberText(item.productionProgress)}% · {productionStageText(item.productionStage)}</small><ProductionFollowUp item={item} /></div></td>
                <td><div className="shipment-delivery-progress"><span className={`state-${item.progressState.toLocaleLowerCase()}`}>{STATE_TEXT[item.progressState]}</span><strong>{numberText(item.shippedQuantity)} / {numberText(item.plannedQuantity)} 件</strong><small>待出 {numberText(item.pendingQuantity)} 件</small></div></td>
                <td><div className="shipment-time-track"><span><small>计划</small><b>{timeText(item.plannedShipAt)}</b></span><span className={item.actualShipAt ? 'actual' : 'missing'}><small>实发</small><b>{item.actualShipAt ? timeText(item.actualShipAt) : item.progressState === 'OVERDUE' ? '超时未出' : '尚未出货'}</b></span></div></td>
                <td><div className="shipment-due"><strong>{item.customerDueDate.slice(5)}</strong><span>{item.priority === 'urgent' || item.priority === 'insert' ? '优先订单' : '正常交期'}</span></div></td>
                <td><div className="shipment-row-actions">
                  {editable && item.isOperationalOnSelectedDate && <button type="button" title="修改计划" onClick={() => openDialog({ kind: 'edit', item })}><Pencil size={15} /></button>}
                  {editable && item.isOperationalOnSelectedDate && <button type="button" className="danger" title="取消计划项" onClick={() => openDialog({ kind: 'cancel', item })}><X size={15} /></button>}
                  {plan?.status === 'CONFIRMED' && item.isOperationalOnSelectedDate && item.pendingQuantity > 0 && <button type="button" className="ship" disabled={availableToShip <= 0} title={availableToShip > 0 ? '登记实际出货' : '暂无已完工可出货数量'} onClick={() => openDialog({ kind: 'ship', item })}><Truck size={15} />实发</button>}
                  {item.events.length > 0 && <button type="button" className="history" onClick={() => openDialog({ kind: 'events', item })}><History size={15} />{item.events.length}</button>}
                </div></td>
                </tr>
              </Fragment>;
            })}</tbody>
          </table>
        </div>}
        {data && filteredItems.length === 0 && <div className="shipment-empty">
          <div><Truck size={30} /></div>
          <strong>{data.displayItems.length ? '没有匹配的出货订单' : `${shortDate(selectedDate)} 暂无交期订单`}</strong>
          <span>{data.displayItems.length ? '调整搜索词或进度筛选条件。' : `${shortDate(data.range.startDate)} 至 ${shortDate(data.range.endDate)} 没有符合规则的确认交期订单。`}</span>
          {!data.displayItems.length && <button type="button" disabled={!canSupplement} onClick={openDrawer}><Plus size={17} />手工补单</button>}
        </div>}
      </section>

      {data && <details className="shipment-completed-panel shipment-glass-surface">
        <summary>
          <span><CheckCircle2 size={18} /><b>今日已出</b><small>完成后仅保留在实际出货当天，明日不再顺延</small></span>
          <strong>{data.shippedTodayItems.length} 批 · {numberText(data.summary.completed.quantity)} 件</strong>
          <ChevronDown size={16} />
        </summary>
        <div className="shipment-completed-list">
          {data.shippedTodayItems.map(item => <article key={item.id}>
            <i><Check size={14} /></i>
            <OrderIdentity item={item} />
            <div><small>实际出货</small><strong>{timeText(item.actualShipAt)}</strong></div>
            <div><small>出货数量</small><strong>{numberText(item.shippedQuantity)} 件</strong></div>
            <button type="button" onClick={() => openDialog({ kind: 'events', item })}><History size={14} />流水</button>
          </article>)}
          {!data.shippedTodayItems.length && <div className="shipment-completed-empty"><CheckCircle2 size={18} />所选日期暂无已完成出货批次</div>}
        </div>
      </details>}
      </>}

      {activeView !== 'today' && error && <div className="shipment-error" role="alert"><AlertTriangle size={17} /><span>{error}</span><button type="button" onClick={() => setError('')} aria-label="关闭错误"><X size={16} /></button></div>}
      {activeView === 'warning' && <WarningPanel
        data={warningData}
        date={selectedDate}
        loading={insightLoading}
        onDateChange={setSelectedDate}
        onRefresh={() => setInsightRefreshToken(value => value + 1)}
        onOpenDate={date => { setSelectedDate(date); setActiveView('today'); }}
      />}
      {activeView === 'carryover' && <CarryoverPanel
        data={carryoverData}
        date={selectedDate}
        loading={insightLoading}
        onDateChange={setSelectedDate}
        onRefresh={() => setInsightRefreshToken(value => value + 1)}
        onShip={item => openDialog({ kind: 'ship', item })}
      />}
      {activeView === 'history' && <HistoryPanel
        data={historyData}
        from={historyFrom}
        to={historyTo}
        loading={insightLoading}
        onRangeChange={next => { if (next.from !== undefined) setHistoryFrom(next.from); if (next.to !== undefined) setHistoryTo(next.to); }}
        onRefresh={() => setInsightRefreshToken(value => value + 1)}
      />}
    </div>

    {activeView === 'today' && drawerOpen && <div className="shipment-candidate-layer open">
      <button type="button" className="shipment-drawer-scrim" aria-label="关闭本周订单抽屉" onClick={() => { if (!busy) { setDrawerOpen(false); setError(''); } }} />
      <aside role="dialog" aria-modal="true" aria-label="添加本周订单">
        <header><div><span>交期同日订单</span><h2>补充到 {shortDate(selectedDate)} 出货计划</h2><p>只显示客户交期与当天一致的已下达批次，未来交期不会提前混入。</p></div><button type="button" aria-label="关闭" disabled={busy} onClick={() => { setDrawerOpen(false); setError(''); }}><X size={20} /></button></header>
        <div className="shipment-candidate-tools">
          <label><Search size={16} /><input value={candidateSearch} onChange={event => setCandidateSearch(event.target.value)} placeholder="搜索订单、客户、产品或业务员" /></label>
          <nav>{(['all', 'ready', 'available', 'scheduled'] as const).map(filter => <button type="button" className={candidateFilter === filter ? 'active' : ''} key={filter} onClick={() => setCandidateFilter(filter)}>{filter === 'all' ? '全部' : filter === 'ready' ? '可出货' : filter === 'available' ? '可排计划' : '已拆分'}</button>)}</nav>
        </div>
        {error && <div className="shipment-inline-error drawer" role="alert"><AlertTriangle size={17} /><span>{error}</span></div>}
        <div className="shipment-candidate-list hm-scroll-region">
          {filteredCandidates.map(candidate => {
            const draft = candidateDrafts[candidate.batchId];
            const selected = Boolean(draft);
            const blockingReservations = candidate.reservations.filter(reservation => reservation.reservedQuantity > 0);
            const primaryReservation = blockingReservations[0];
            return <article className={`${selected ? 'selected' : ''} ${candidate.availableQuantity <= 0 ? 'unavailable' : ''}`} key={candidate.batchId}>
              <button type="button" className="shipment-candidate-select" aria-pressed={selected} disabled={!canSupplement || candidate.availableQuantity <= 0} onClick={() => toggleCandidate(candidate)}><i>{selected && <Check size={13} />}</i><span><strong>{candidate.workOrderCode}</strong><small>{candidate.customerName} · {candidate.productName}</small><em>{candidate.specification} · 第 {candidate.batchNo} 批</em></span></button>
              <dl><div><dt>批次数量</dt><dd>{numberText(candidate.batchQuantity)}</dd></div><div><dt>已排计划</dt><dd>{numberText(candidate.scheduledQuantity)}</dd></div><div><dt>剩余可排</dt><dd>{numberText(candidate.availableQuantity)}</dd></div><div><dt>已完工</dt><dd>{numberText(candidate.completedQuantity)}</dd></div></dl>
              <div className="shipment-candidate-progress"><span><b>{candidate.currentProcess}</b><em>{numberText(candidate.productionProgress)}%</em></span><div><i style={{ width: `${Math.min(100, candidate.productionProgress)}%` }} /></div>{candidate.scheduledDates.length > 0 && <small>已安排：{candidate.scheduledDates.map(shortDate).join('、')}</small>}</div>
              {candidate.availableQuantity <= 0 && <div className="shipment-reservation-notice">
                <span><ShieldAlert size={15} /><b>{primaryReservation
                  ? `已被 ${shortDate(primaryReservation.shipDate)} ${reservationStatusText(primaryReservation)}占用 ${numberText(primaryReservation.reservedQuantity)} 件`
                  : '批次数量已被计划或实发记录全部占用'}</b></span>
                <small>这是防止重复排单的数量保护，并非订单失效。</small>
                {blockingReservations.length > 0 && <button type="button" onClick={() => openDialog({ kind: 'reservations', candidate })}>查看并处理占用<ArrowRight size={13} /></button>}
              </div>}
              {selected && <div className="shipment-candidate-form">
                <div className="shipment-candidate-priority"><span>出货优先级</span><PrioritySelector compact value={draft.shipmentPriority} onChange={shipmentPriority => updateCandidateDraft(candidate.batchId, { shipmentPriority })} /></div>
                <label>计划数量<input type="number" min="1" max={candidate.availableQuantity} value={draft.quantity} onChange={event => updateCandidateDraft(candidate.batchId, { quantity: event.target.value })} /></label><label>计划时间<input type="datetime-local" min={`${selectedDate}T00:00`} max={`${selectedDate}T23:59`} value={draft.plannedShipAt} onChange={event => updateCandidateDraft(candidate.batchId, { plannedShipAt: event.target.value })} /></label><label className="note">备注<input value={draft.note} maxLength={500} onChange={event => updateCandidateDraft(candidate.batchId, { note: event.target.value })} placeholder="可选" /></label>
              </div>}
            </article>;
          })}
          {!filteredCandidates.length && <div className="shipment-candidate-empty"><PackageCheck size={26} /><strong>没有可补充的同日交期订单</strong><span>当天交期批次已自动关联，或尚未下达生产。</span></div>}
        </div>
        <footer><span>已选 <b>{selectedCandidateIds.length}</b> 批 · 共 <b>{numberText(selectedCandidateQuantity)}</b> 件</span><div><button type="button" disabled={busy} onClick={() => { setDrawerOpen(false); setError(''); }}>取消</button><button type="button" className="primary" disabled={busy || selectedCandidateIds.length === 0} onClick={addSelectedCandidates}>{busy ? <LoaderCircle className="spin" size={16} /> : <Plus size={16} />}加入当日计划</button></div></footer>
      </aside>
    </div>}

    {dialog && <DialogShell
      title={dialog.kind === 'edit' ? '修改出货计划' : dialog.kind === 'cancel' ? '取消计划项' : dialog.kind === 'ship' ? '登记实际出货' : dialog.kind === 'events' ? '出货流水' : dialog.kind === 'reverse' ? '撤销实发记录' : dialog.kind === 'confirm' ? '确认当日计划' : dialog.kind === 'rollover' ? '结转未完成订单' : dialog.kind === 'reservations' ? '历史占用详情' : dialog.kind === 'releaseReservation' ? '释放旧计划占用' : dialog.kind === 'transferReservation' ? '结转到当前日' : '关闭当日计划'}
      description={'item' in dialog ? `${dialog.item.workOrderCode} · ${dialog.item.customerName}` : 'candidate' in dialog ? `${dialog.candidate.workOrderCode} · ${dialog.candidate.customerName}` : `${selectedDate} · ${plan?.items.length || 0} 批订单`}
      error={error}
      busy={busy}
      onClose={() => { if (!busy) { setDialog(null); setError(''); } }}
    >
      {dialog.kind === 'edit' && <form onSubmit={event => { event.preventDefault(); submitDialog(); }}><OrderIdentity item={dialog.item} /><div className="shipment-dialog-grid"><div className="shipment-dialog-priority"><span>出货优先级</span><PrioritySelector value={(form.shipmentPriority || dialog.item.shipmentPriority) as DailyShipmentPriority} onChange={shipmentPriority => setForm(current => ({ ...current, shipmentPriority }))} /></div><label>计划数量<input required type="number" min="1" max={dialog.item.batchQuantity} value={form.quantity || ''} onChange={event => setForm(current => ({ ...current, quantity: event.target.value }))} /></label><label>计划出货时间<input required type="datetime-local" min={`${selectedDate}T00:00`} max={`${selectedDate}T23:59`} value={form.plannedShipAt || ''} onChange={event => setForm(current => ({ ...current, plannedShipAt: event.target.value }))} /></label><label className="full">备注<textarea value={form.note || ''} maxLength={500} onChange={event => setForm(current => ({ ...current, note: event.target.value }))} /></label></div><footer><button type="button" onClick={() => setDialog(null)}>取消</button><button className="primary" disabled={busy} type="submit">保存修改</button></footer></form>}
      {dialog.kind === 'cancel' && <form onSubmit={event => { event.preventDefault(); submitDialog(); }}><OrderIdentity item={dialog.item} /><div className="shipment-warning"><AlertTriangle size={18} /><span>取消后会释放该批次的可排数量；历史修改仍会保留。</span></div><label className="shipment-single-field">取消原因<textarea required value={form.reason || ''} maxLength={500} onChange={event => setForm({ reason: event.target.value })} placeholder="请填写取消原因" /></label><footer><button type="button" onClick={() => setDialog(null)}>返回</button><button className="danger" disabled={busy} type="submit">确认取消</button></footer></form>}
      {dialog.kind === 'ship' && <form onSubmit={event => { event.preventDefault(); submitDialog(); }}><OrderIdentity item={dialog.item} /><div className="shipment-availability"><span>本日待出 <b>{numberText(dialog.item.pendingQuantity)}</b> 件</span><span>当前完工可出 <b>{numberText(candidateAvailableToShip(dialog.item, data?.candidates || []))}</b> 件</span></div><div className="shipment-dialog-grid"><label>实际出货数量<input required type="number" min="1" max={Math.min(dialog.item.pendingQuantity, candidateAvailableToShip(dialog.item, data?.candidates || []))} value={form.quantity || ''} onChange={event => setForm(current => ({ ...current, quantity: event.target.value }))} /></label><label>实际出货时间<input required type="datetime-local" max={chinaDateTimeInput()} value={form.shippedAt || ''} onChange={event => setForm(current => ({ ...current, shippedAt: event.target.value }))} /></label><label className="full">出货备注<textarea value={form.note || ''} maxLength={500} onChange={event => setForm(current => ({ ...current, note: event.target.value }))} /></label></div><footer><button type="button" onClick={() => setDialog(null)}>取消</button><button className="primary" disabled={busy || Number(form.quantity) <= 0} type="submit"><Truck size={16} />确认实发</button></footer></form>}
      {dialog.kind === 'events' && <div className="shipment-event-panel"><OrderIdentity item={dialog.item} /><div className="shipment-event-summary"><span>计划 <b>{numberText(dialog.item.plannedQuantity)}</b></span><span>实发 <b>{numberText(dialog.item.shippedQuantity)}</b></span><span>待出 <b>{numberText(dialog.item.pendingQuantity)}</b></span></div><div className="shipment-event-list">{dialog.item.events.map(event => {
        const reversed = dialog.item.events.filter(item => item.eventType === 'REVERSAL' && item.reversalOfEventId === event.id).reduce((total, item) => total + item.quantity, 0);
        return <article className={event.eventType.toLocaleLowerCase()} key={event.id}><i>{event.eventType === 'SHIPMENT' ? <Truck size={15} /> : <RotateCcw size={15} />}</i><span><strong>{event.eventType === 'SHIPMENT' ? `实发 ${numberText(event.quantity)} 件` : `撤销 ${numberText(event.quantity)} 件`}</strong><small>{fullTimeText(event.shippedAt)} · {event.actor.name}</small>{event.reason && <em>{event.reason}</em>}</span>{event.eventType === 'SHIPMENT' && reversed < event.quantity && <button type="button" onClick={() => openDialog({ kind: 'reverse', item: dialog.item, event })}>撤销</button>}</article>;
      })}</div><footer><button className="primary" type="button" onClick={() => setDialog(null)}>完成</button></footer></div>}
      {dialog.kind === 'reverse' && <form onSubmit={event => { event.preventDefault(); submitDialog(); }}><OrderIdentity item={dialog.item} /><div className="shipment-warning"><RotateCcw size={18} /><span>撤销不会删除原记录，而是新增反向流水；已关闭计划会恢复为已确认。</span></div><div className="shipment-dialog-grid"><label>撤销数量<input required type="number" min="1" max={dialog.event.quantity} value={form.quantity || ''} onChange={event => setForm(current => ({ ...current, quantity: event.target.value }))} /></label><label>撤销时间<input required type="datetime-local" max={chinaDateTimeInput()} value={form.reversedAt || ''} onChange={event => setForm(current => ({ ...current, reversedAt: event.target.value }))} /></label><label className="full">撤销原因<textarea required value={form.reason || ''} maxLength={500} onChange={event => setForm(current => ({ ...current, reason: event.target.value }))} /></label></div><footer><button type="button" onClick={() => openDialog({ kind: 'events', item: dialog.item })}>返回流水</button><button className="danger" disabled={busy} type="submit">确认撤销</button></footer></form>}
      {dialog.kind === 'confirm' && <form onSubmit={event => { event.preventDefault(); submitDialog(); }}><div className="shipment-confirm-card"><CalendarCheck2 size={28} /><strong>确认 {shortDate(selectedDate)} 出货计划</strong><span>共 {plan?.items.length || 0} 批、{numberText(data?.summary.plannedQuantity || 0)} 件。确认后不能再增删或修改计划项，只能登记实际出货。</span></div><footer><button type="button" onClick={() => setDialog(null)}>继续编辑</button><button className="primary" disabled={busy} type="submit">确认计划</button></footer></form>}
      {dialog.kind === 'close' && <form onSubmit={event => { event.preventDefault(); submitDialog(); }}><div className="shipment-confirm-card success"><CheckCircle2 size={28} /><strong>关闭 {shortDate(selectedDate)} 出货计划</strong><span>全部 {plan?.items.length || 0} 批订单已完成出货。关闭后如撤销实发，计划会自动恢复为已确认。</span></div><footer><button type="button" onClick={() => setDialog(null)}>返回</button><button className="primary" disabled={busy} type="submit">确认关闭</button></footer></form>}
      {dialog.kind === 'rollover' && <form onSubmit={event => { event.preventDefault(); submitDialog(); }}><div className="shipment-confirm-card"><RotateCcw size={28} /><strong>结转 {numberText(data?.summary.pendingQuantity || 0)} 件到次日</strong><span>仅转移尚未出货的数量，已出货流水保留在今天；次日计划会继承红黄蓝优先级并标注“上日遗留”。该操作会关闭今天的计划。</span></div><footer><button type="button" onClick={() => setDialog(null)}>暂不结转</button><button className="primary" disabled={busy || !data?.summary.pendingQuantity} type="submit">确认结转</button></footer></form>}
      {dialog.kind === 'reservations' && <div className="shipment-reservation-panel">
        <div className="shipment-reservation-summary"><ShieldAlert size={21} /><span><strong>剩余可排为 0，不代表订单失效</strong><small>以下计划或实发记录正在占用该批次数量。先查看来源，再决定释放或结转。</small></span></div>
        <div className="shipment-reservation-list">{dialog.candidate.reservations.map(reservation => <article key={reservation.itemId}>
          <header><span><b>{shortDate(reservation.shipDate)}</b><em>{reservationStatusText(reservation)}</em></span><strong>占用 {numberText(reservation.reservedQuantity)} 件</strong></header>
          <dl><div><dt>原计划</dt><dd>{numberText(reservation.plannedQuantity)}</dd></div><div><dt>已实发</dt><dd>{numberText(reservation.shippedQuantity)}</dd></div><div><dt>待处理</dt><dd>{numberText(reservation.pendingQuantity)}</dd></div></dl>
          <footer>
            <button type="button" onClick={() => viewReservationPlan(reservation)}><Eye size={14} />查看原计划</button>
            {reservation.canRelease && <button type="button" className="release" onClick={() => openDialog({ kind: 'releaseReservation', candidate: dialog.candidate, reservation })}><LockOpen size={14} />释放占用</button>}
            {reservation.canTransferToSelectedDate && <button type="button" className="transfer" onClick={() => openDialog({ kind: 'transferReservation', candidate: dialog.candidate, reservation })}><ArrowRight size={14} />结转到 {shortDate(selectedDate)}</button>}
          </footer>
        </article>)}</div>
        <footer><button className="primary" type="button" onClick={() => setDialog(null)}>完成</button></footer>
      </div>}
      {dialog.kind === 'releaseReservation' && <form onSubmit={event => { event.preventDefault(); releaseReservation(dialog.reservation); }}>
        <div className="shipment-confirm-card danger"><LockOpen size={28} /><strong>释放 {shortDate(dialog.reservation.shipDate)} 的 {numberText(dialog.reservation.reservedQuantity)} 件占用</strong><span>原计划项会标记为已取消并保留审计记录，释放后该数量可以重新安排。已有实际出货的占用不允许使用此操作。</span></div>
        <footer><button type="button" onClick={() => openDialog({ kind: 'reservations', candidate: dialog.candidate })}>返回详情</button><button className="danger" disabled={busy} type="submit">确认释放</button></footer>
      </form>}
      {dialog.kind === 'transferReservation' && <form onSubmit={event => { event.preventDefault(); transferReservation(dialog.reservation); }}>
        <div className="shipment-confirm-card"><ArrowRight size={28} /><strong>{shortDate(dialog.reservation.shipDate)} → {shortDate(selectedDate)}，结转 {numberText(dialog.reservation.pendingQuantity)} 件</strong><span>仅移动未出货数量，原计划和实发流水继续保留；当前日会继承原优先级并标注历史遗留。</span></div>
        <footer><button type="button" onClick={() => openDialog({ kind: 'reservations', candidate: dialog.candidate })}>返回详情</button><button className="primary" disabled={busy} type="submit">确认结转</button></footer>
      </form>}
    </DialogShell>}

    {toast && <div className="shipment-toast" role="status"><CheckCircle2 size={17} />{toast}</div>}
  </main>;
}
