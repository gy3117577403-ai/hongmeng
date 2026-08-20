'use client';

import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  CalendarRange,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  ClipboardCheck,
  Clock3,
  Layers3,
  PackageCheck,
  PackageOpen,
  RefreshCw,
  Search,
  Send,
  UserRoundCheck,
  UsersRound,
  Warehouse,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AppWorkbenchHeader } from '@/components/layout/AppWorkbenchHeader';
import type {
  CurrentUserDTO,
  IssueUserDTO,
  MaterialFollowUpStatusDTO,
  MaterialFollowUpSummaryDTO,
  MaterialFollowUpTaskDTO,
  WarehouseWeekOptionDTO,
} from '@/types';

type StatusFilter = 'ACTIVE' | 'ALL' | MaterialFollowUpStatusDTO;
type WeekScope = 'current' | 'preparation' | 'history';
type FollowUpPayload = {
  ok?: boolean;
  tasks?: MaterialFollowUpTaskDTO[];
  summary?: MaterialFollowUpSummaryDTO;
  users?: IssueUserDTO[];
  selectedWeekStart?: string | null;
  weeks?: WarehouseWeekOptionDTO[];
  pagination?: { page: number; pageSize: number; total: number; totalPages: number };
  error?: string;
};

type UpdateForm = {
  ownerId: string;
  status: 'IN_PROGRESS' | 'WAITING_ARRIVAL' | 'WAITING_WAREHOUSE';
  expectedAt: string;
  note: string;
};

type RescheduleForm = {
  plannedCompletionDate: string;
  customerDueDate: string;
  reason: string;
};

type ReschedulePreview = {
  taskId: string;
  batchId: string;
  workOrderId: string;
  specification: string;
  actualArrivalAt: string;
  before: {
    plannedCompletionDate: string;
    weekStartDate: string;
    weekEndDate: string;
    customerDueDate: string;
  };
  after: {
    plannedCompletionDate: string;
    weekStartDate: string;
    weekEndDate: string;
    customerDueDate: string;
  };
  crossesWeek: boolean;
  keepsWarehouseProgress: boolean;
  keepsProcessProgress: boolean;
  completedQuantityPreserved: boolean;
};

const emptySummary: MaterialFollowUpSummaryDTO = {
  total: 0,
  pending: 0,
  inProgress: 0,
  waitingArrival: 0,
  waitingWarehouse: 0,
  resolved: 0,
  overdue: 0,
  unassigned: 0,
};

const statusOptions: Array<{ value: UpdateForm['status']; label: string }> = [
  { value: 'IN_PROGRESS', label: '跟进中' },
  { value: 'WAITING_ARRIVAL', label: '等待物料' },
  { value: 'WAITING_WAREHOUSE', label: '待仓库确认' },
];

const stageNodes = [
  { key: 'PENDING', label: '仓库反馈', hint: '待接收' },
  { key: 'IN_PROGRESS', label: '跟进处理', hint: '已接收' },
  { key: 'WAITING_ARRIVAL', label: '等待物料', hint: '持续跟踪' },
  { key: 'WAITING_WAREHOUSE', label: '仓库确认', hint: '等待复核' },
  { key: 'RESOLVED', label: '反馈闭环', hint: '已解决' },
] as const;

function stageIndex(status: MaterialFollowUpStatusDTO): number {
  if (status === 'IN_PROGRESS') return 1;
  if (status === 'WAITING_ARRIVAL') return 2;
  if (status === 'WAITING_WAREHOUSE') return 3;
  if (status === 'RESOLVED') return 4;
  return 0;
}

function dateText(value?: string | null): string {
  if (!value) return '待确认';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function dateTimeText(value?: string | null): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

function quantityText(task: MaterialFollowUpTaskDTO): string {
  return task.workOrder.productionTargetQty?.toLocaleString('zh-CN')
    || task.workOrder.uncompletedQty?.trim()
    || '待补充';
}

function rangeText(week?: WarehouseWeekOptionDTO): string {
  if (!week) return '全部历史周';
  return `${dateText(week.weekStartDate)} - ${dateText(week.weekEndDate)}`;
}

function formFor(task: MaterialFollowUpTaskDTO | null, currentUserId: string): UpdateForm {
  const status = task?.status === 'WAITING_ARRIVAL' || task?.status === 'WAITING_WAREHOUSE'
    ? task.status
    : 'IN_PROGRESS';
  return {
    ownerId: task?.owner?.id || currentUserId,
    status,
    expectedAt: task?.expectedAt?.slice(0, 10) || '',
    note: '',
  };
}

function rescheduleFormFor(task: MaterialFollowUpTaskDTO): RescheduleForm {
  return {
    plannedCompletionDate: task.workOrder.planning?.plannedCompletionDate.slice(0, 10) || '',
    customerDueDate: task.workOrder.planning?.customerDueDate.slice(0, 10) || '',
    reason: '',
  };
}

export default function MaterialFollowUpShell({ user }: { user: CurrentUserDTO }) {
  const [status, setStatus] = useState<StatusFilter>('ACTIVE');
  const [scope, setScope] = useState<WeekScope>('current');
  const [selectedWeek, setSelectedWeek] = useState('');
  const [weeks, setWeeks] = useState<WarehouseWeekOptionDTO[]>([]);
  const [owner, setOwner] = useState('');
  const [keyword, setKeyword] = useState('');
  const [query, setQuery] = useState('');
  const [tasks, setTasks] = useState<MaterialFollowUpTaskDTO[]>([]);
  const [summary, setSummary] = useState<MaterialFollowUpSummaryDTO>(emptySummary);
  const [users, setUsers] = useState<IssueUserDTO[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [selected, setSelected] = useState<MaterialFollowUpTaskDTO | null>(null);
  const [form, setForm] = useState<UpdateForm>(() => formFor(null, user.id));
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [formError, setFormError] = useState('');
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [rescheduleForm, setRescheduleForm] = useState<RescheduleForm>({ plannedCompletionDate: '', customerDueDate: '', reason: '' });
  const [reschedulePreview, setReschedulePreview] = useState<ReschedulePreview | null>(null);
  const [rescheduleError, setRescheduleError] = useState('');
  const [rescheduleSaving, setRescheduleSaving] = useState(false);
  const [toast, setToast] = useState('');
  const [reloadToken, setReloadToken] = useState(0);
  const pendingDeepLinkRef = useRef('');
  const canManage = user.access.capabilities.includes('PROCUREMENT:UPDATE');
  const canUpdatePlan = user.access.capabilities.includes('PLANNING:UPDATE');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requested = params.get('taskId');
    if (requested) {
      pendingDeepLinkRef.current = requested;
      setSelectedId(requested);
    }
    const requestedScope = params.get('scope');
    if (requestedScope === 'history' || requestedScope === 'preparation') setScope(requestedScope);
    const weekStart = params.get('weekStart');
    if (weekStart) setSelectedWeek(weekStart);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(keyword.trim()), 220);
    return () => window.clearTimeout(timer);
  }, [keyword]);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ status, scope, pageSize: '100' });
    if ((scope === 'history' || scope === 'preparation') && selectedWeek) params.set('weekStart', selectedWeek);
    if (owner) params.set('owner', owner);
    if (query) params.set('keyword', query);
    setLoading(true);
    setError('');
    fetch(`/api/material-follow-ups?${params}`, { cache: 'no-store', signal: controller.signal })
      .then(async response => {
        const body = await response.json().catch(() => ({})) as FollowUpPayload;
        if (response.status === 401) {
          location.href = '/login?next=%2Fworkspace%2Fprocurement';
          return null;
        }
        if (!response.ok) throw new Error(body.error || '物料异常跟进任务加载失败');
        return body;
      })
      .then(body => {
        if (!body) return;
        const nextTasks = body.tasks || [];
        setTasks(nextTasks);
        setSummary(body.summary || emptySummary);
        setUsers(body.users || []);
        setWeeks(body.weeks || []);
        setSelectedId(current => {
          const deepLink = pendingDeepLinkRef.current;
          if (deepLink) {
            pendingDeepLinkRef.current = '';
            return deepLink;
          }
          return current && nextTasks.some(task => task.id === current)
            ? current
            : nextTasks[0]?.id || '';
        });
      })
      .catch(reason => {
        if ((reason as { name?: string }).name !== 'AbortError') {
          setError(reason instanceof Error ? reason.message : '物料异常跟进任务加载失败');
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [owner, query, reloadToken, scope, selectedWeek, status]);

  useEffect(() => {
    if (!selectedId) {
      setSelected(null);
      return;
    }
    const controller = new AbortController();
    setDetailLoading(true);
    setFormError('');
    fetch(`/api/material-follow-ups/${selectedId}`, { cache: 'no-store', signal: controller.signal })
      .then(async response => {
        const body = await response.json().catch(() => ({})) as { ok?: boolean; task?: MaterialFollowUpTaskDTO; error?: string };
        if (!response.ok || !body.task) throw new Error(body.error || '跟进详情加载失败');
        return body.task;
      })
      .then(task => {
        setSelected(task);
        setForm(formFor(task, user.id));
        setRescheduleOpen(false);
        setReschedulePreview(null);
        setRescheduleError('');
      })
      .catch(reason => {
        if ((reason as { name?: string }).name !== 'AbortError') {
          setFormError(reason instanceof Error ? reason.message : '跟进详情加载失败');
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setDetailLoading(false);
      });
    return () => controller.abort();
  }, [selectedId, user.id]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 2800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const activeStage = selected ? stageIndex(selected.status) : 0;
  const visibleActivities = useMemo(() => selected?.activities || [], [selected?.activities]);
  const canReschedule = Boolean(
    canUpdatePlan
    && selected?.exceptionCase.actualArrivalAt
    && selected.workOrder.planning,
  );
  const updateDisabled = !canManage
    || saving
    || !selected
    || selected.status === 'RESOLVED'
    || selected.status === 'CANCELLED'
    || !form.ownerId
    || !form.note.trim()
    || (form.status === 'WAITING_ARRIVAL' && !form.expectedAt);

  async function mutate(body: Record<string, unknown>): Promise<void> {
    if (!selected) return;
    setSaving(true);
    setFormError('');
    try {
      const response = await fetch(`/api/material-follow-ups/${selected.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...body, version: selected.version }),
      });
      const result = await response.json().catch(() => ({})) as { ok?: boolean; task?: MaterialFollowUpTaskDTO; error?: string };
      if (!response.ok || !result.task) throw new Error(result.error || '物料异常跟进更新失败');
      setSelected(result.task);
      setForm(formFor(result.task, user.id));
      setTasks(current => current.map(task => task.id === result.task?.id ? result.task : task));
      setToast(body.action === 'claim' ? '已接收物料异常' : '跟进进度已保存');
      setReloadToken(value => value + 1);
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : '物料异常跟进更新失败');
    } finally {
      setSaving(false);
    }
  }

  function openReschedule(): void {
    if (!selected || !canReschedule) return;
    setRescheduleForm(rescheduleFormFor(selected));
    setReschedulePreview(null);
    setRescheduleError('');
    setRescheduleOpen(true);
  }

  async function submitReschedule(confirm: boolean): Promise<void> {
    if (!selected?.workOrder.planning) return;
    setRescheduleSaving(true);
    setRescheduleError('');
    try {
      const response = await fetch(`/api/material-follow-ups/${selected.id}/reschedule`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...rescheduleForm,
          confirm,
          version: selected.version,
          batchUpdatedAt: selected.workOrder.planning.updatedAt,
        }),
      });
      const result = await response.json().catch(() => ({})) as {
        ok?: boolean;
        preview?: ReschedulePreview;
        task?: MaterialFollowUpTaskDTO;
        error?: string;
      };
      if (!response.ok || !result.preview) throw new Error(result.error || '受影响计划调整失败');
      if (!confirm) {
        setReschedulePreview(result.preview);
        return;
      }
      if (!result.task) throw new Error('计划已调整，但任务详情返回不完整，请刷新确认');
      setSelected(result.task);
      setTasks(current => current.map(task => task.id === result.task?.id ? result.task : task));
      setRescheduleOpen(false);
      setReschedulePreview(null);
      setToast('新计划交期已生效，原报工与配料进度保持不变');
      setReloadToken(value => value + 1);
    } catch (reason) {
      setRescheduleError(reason instanceof Error ? reason.message : '受影响计划调整失败');
    } finally {
      setRescheduleSaving(false);
    }
  }

  async function logout(): Promise<void> {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    location.href = '/login';
  }

  return (
    <main className="material-follow-up-workbench hm-workbench-root">
      <AppWorkbenchHeader
        user={user}
        activeHref="/workspace/procurement"
        subtitle="仓库物料异常与预计到料跟进"
        hideHeader
        sidebarTriggerTargetId="material-follow-up-sidebar-trigger"
        menuItems={[
          { label: '系统设置', href: '/dashboard?openSettings=1' },
          { label: '退出登录', onSelect: () => void logout() },
        ]}
      />

      <div className="mf-page-frame">
        <section className="mf-command-deck" aria-labelledby="material-follow-up-title">
          <div className="mf-command-copy">
            <div id="material-follow-up-sidebar-trigger" className="mf-inline-sidebar-trigger" />
            <span><Layers3 size={15} aria-hidden="true" />物料协同</span>
            <div><h1 id="material-follow-up-title">物料异常跟进</h1><p>仓库异常同步进入，采购维护预计到料，仓库确认后归档。</p></div>
          </div>
          <div className="mf-week-controls">
            <div className="mf-week-tabs" role="tablist" aria-label="生产周范围">
              <button className={scope === 'current' ? 'active' : ''} type="button" role="tab" aria-selected={scope === 'current'} onClick={() => { setScope('current'); setSelectedWeek(''); }}>本周</button>
              <button className={scope === 'preparation' ? 'active' : ''} type="button" role="tab" aria-selected={scope === 'preparation'} onClick={() => { setScope('preparation'); setSelectedWeek(''); }}>下周</button>
              <button className={scope === 'history' ? 'active' : ''} type="button" role="tab" aria-selected={scope === 'history'} onClick={() => { setScope('history'); setSelectedWeek(''); }}>历史周</button>
            </div>
            {(scope === 'history' || scope === 'preparation') && <select aria-label="选择生产周" value={selectedWeek} onChange={event => setSelectedWeek(event.target.value)}><option value="">{scope === 'history' ? '全部历史周' : '默认下周'}</option>{weeks.map(week => <option value={week.weekStartDate} key={week.weekStartDate}>{rangeText(week)} · {week.taskCount} 项</option>)}</select>}
          </div>
          <div className="mf-command-actions">
            <a href="/workspace/warehouse"><Warehouse size={16} />返回仓库</a>
            <button type="button" disabled={loading} onClick={() => setReloadToken(value => value + 1)}>
              <RefreshCw size={16} className={loading ? 'spin' : ''} />刷新
            </button>
          </div>
        </section>

        <section className="mf-summary-deck" aria-label="物料异常跟进统计">
          <button className={status === 'ACTIVE' ? 'active' : ''} type="button" onClick={() => setStatus('ACTIVE')}>
            <ClipboardCheck /><span>待处理异常<small>当前生产周活动事项</small></span><strong>{summary.total}</strong>
          </button>
          <button className={status === 'PENDING' ? 'active warning' : 'warning'} type="button" onClick={() => setStatus('PENDING')}>
            <UsersRound /><span>待接收<small>未分派 {summary.unassigned}</small></span><strong>{summary.pending}</strong>
          </button>
          <button className={status === 'IN_PROGRESS' ? 'active blue' : 'blue'} type="button" onClick={() => setStatus('IN_PROGRESS')}>
            <CircleDot /><span>跟进中<small>正在协调处理</small></span><strong>{summary.inProgress}</strong>
          </button>
          <button className={status === 'WAITING_ARRIVAL' ? 'active orange' : 'orange'} type="button" onClick={() => setStatus('WAITING_ARRIVAL')}>
            <PackageOpen /><span>等待物料<small>逾期 {summary.overdue}</small></span><strong>{summary.waitingArrival}</strong>
          </button>
          <button className={status === 'WAITING_WAREHOUSE' ? 'active green' : 'green'} type="button" onClick={() => setStatus('WAITING_WAREHOUSE')}>
            <PackageCheck /><span>待仓库确认<small>物料反馈已到</small></span><strong>{summary.waitingWarehouse}</strong>
          </button>
          <button className={status === 'RESOLVED' ? 'active resolved' : 'resolved'} type="button" onClick={() => setStatus('RESOLVED')}>
            <CheckCircle2 /><span>已解决<small>已归档并记录时间</small></span><strong>{summary.resolved}</strong>
          </button>
        </section>

        <section className="mf-toolbar">
          <label className="mf-search"><Search size={16} /><input value={keyword} onChange={event => setKeyword(event.target.value)} placeholder="搜索客户、规格、品名、工单或反馈内容" /></label>
          <label><span>负责人</span><select value={owner} onChange={event => setOwner(event.target.value)}><option value="">全部负责人</option><option value="unassigned">待认领</option>{users.map(item => <option value={item.id} key={item.id}>{item.displayName || item.username}</option>)}</select></label>
          {(status !== 'ACTIVE' || owner || keyword) && <button className="mf-clear" type="button" onClick={() => { setStatus('ACTIVE'); setOwner(''); setKeyword(''); }}>清除筛选</button>}
          <span className="mf-toolbar-count">当前 {tasks.length} 项</span>
        </section>

        {error && <div className="mf-error" role="alert"><AlertTriangle size={17} />{error}</div>}

        <section className="mf-workspace">
          <aside className="mf-task-queue" aria-label="物料异常反馈队列">
            <header><div><span>{status === 'RESOLVED' ? '已解决名单' : '异常队列'}</span><strong>{loading ? '加载中' : `${tasks.length} 项`}</strong></div><small>{status === 'RESOLVED' ? '按解决时间归档' : '按风险和预计到料查看'}</small></header>
            <div className="mf-task-list hm-scroll-region" tabIndex={0}>
              {tasks.map(task => <button type="button" className={`mf-task-card ${task.carryover ? 'is-carryover' : ''} ${selectedId === task.id ? 'active' : ''} risk-${task.risk}`} key={task.id} onClick={() => setSelectedId(task.id)}>
                <span className="mf-task-risk">{task.riskText}</span>
                <div><small>{task.workOrder.customerName || '客户待补充'} · {task.exceptionCase.exceptionTypeText}{task.carryover && <em title={`原生产周 ${task.carryover.originalWeekStartDate}`}> · {task.carryover.label}</em>}</small><strong>{task.workOrder.specification || task.workOrder.code}</strong><p>{task.workOrder.productName}</p></div>
                <dl><div><dt>异常</dt><dd>{task.exceptionCase.exceptionNote || '物料异常待处理'}</dd></div><div><dt>负责人</dt><dd>{task.owner?.displayName || task.owner?.username || '待认领'}</dd></div></dl>
                <footer><span className={`status-${task.status.toLowerCase()}`}>{task.statusText}</span><time>{task.status === 'RESOLVED' ? `解决 ${dateTimeText(task.resolvedAt)}` : task.expectedAt ? `预计到料 ${dateText(task.expectedAt)}` : `反馈 ${dateText(task.exceptionCase.reportedAt)}`}</time><ChevronRight size={15} /></footer>
              </button>)}
              {!loading && !tasks.length && <div className="mf-empty"><PackageCheck /><strong>{status === 'RESOLVED' ? '当前范围没有已解决记录' : '当前没有待处理物料异常'}</strong><span>仓库登记任一物料异常后会自动同步进入这里。</span></div>}
              {loading && <div className="mf-empty"><RefreshCw className="spin" /><strong>正在加载反馈任务</strong></div>}
            </div>
          </aside>

          <section className={`mf-detail-stage ${selected?.status === 'RESOLVED' ? 'is-resolved' : ''}`} aria-live="polite">
            {selected && <>
              <header className="mf-detail-header">
                <div><span>{selected.exceptionCase.exceptionTypeText} · 异常 #{selected.exceptionCase.sequence}</span><h2>{selected.workOrder.specification || selected.workOrder.code}</h2><p>{selected.workOrder.customerName || '客户待补充'} · {selected.workOrder.productName}</p></div>
                <div><span className={`mf-risk-badge risk-${selected.risk}`}>{selected.riskText}</span><strong>{selected.statusText}</strong></div>
              </header>

              <section className="mf-flow-rail" aria-label="物料异常跟进流程">
                <div className="mf-flow-line"><i style={{ '--mf-progress': `${Math.max(0, activeStage) * 25}%` } as React.CSSProperties} /></div>
                {stageNodes.map((node, index) => {
                  const nodeState = selected.status === 'CANCELLED'
                    ? index === 0 ? 'cancelled' : 'future'
                    : index < activeStage ? 'done' : index === activeStage ? 'current' : 'future';
                  return <div className={`mf-flow-node ${nodeState}`} key={node.key}><span>{nodeState === 'done' ? <CheckCircle2 /> : index + 1}</span><strong>{node.label}</strong><small>{nodeState === 'done' ? '已完成' : nodeState === 'current' ? node.hint : '待进入'}</small></div>;
                })}
              </section>

              <section className="mf-fact-grid">
                <article><span>生产工单</span><strong>{selected.workOrder.code}</strong><small>计划数量 {quantityText(selected)}</small></article>
                <article><span>仓库反馈</span><strong>{selected.exceptionCase.exceptionNote || '物料异常待处理'}</strong><small>{selected.exceptionCase.exceptionTypeText} · {dateTimeText(selected.exceptionCase.reportedAt)}</small></article>
                <article><span>负责人</span><strong>{selected.owner?.displayName || selected.owner?.username || '尚未认领'}</strong><small>{selected.lastFollowedAt ? `最近跟进 ${dateTimeText(selected.lastFollowedAt)}` : '等待接收任务'}</small></article>
                <article><span>{selected.status === 'RESOLVED' ? '解决时间' : '预计到料'}</span><strong>{selected.status === 'RESOLVED' ? dateTimeText(selected.resolvedAt) : dateText(selected.expectedAt)}</strong><small>{selected.status === 'RESOLVED' ? `由 ${selected.resolvedBy?.displayName || selected.resolvedBy?.username || '仓库'} 确认` : selected.exceptionCase.expectedArrivalBy ? `采购标注：${selected.exceptionCase.expectedArrivalBy.displayName || selected.exceptionCase.expectedArrivalBy.username}` : '等待采购标注'}</small></article>
              </section>

              <section className="mf-latest-progress">
                <div><Clock3 /><span><small>最新进展</small><strong>{selected.latestProgress || selected.exceptionCase.exceptionNote || '等待跟进更新'}</strong></span></div>
                <div className="mf-latest-actions">
                  {canReschedule && <button type="button" onClick={openReschedule}><CalendarRange size={15} />调整受影响计划</button>}
                  <time>{dateTimeText(selected.updatedAt)}</time>
                </div>
              </section>

              {selected.status !== 'RESOLVED' && selected.status !== 'CANCELLED' ? canManage ? <section className="mf-update-console">
                <header><div><span>推进任务</span><strong>更新本次跟进结果</strong></div>{!selected.owner && <button type="button" disabled={saving} onClick={() => void mutate({ action: 'claim' })}><UserRoundCheck size={15} />接收任务</button>}</header>
                <div className="mf-update-grid">
                  <label><span>负责人</span><select value={form.ownerId} onChange={event => setForm(current => ({ ...current, ownerId: event.target.value }))}><option value="">选择负责人</option>{users.map(item => <option value={item.id} key={item.id}>{item.displayName || item.username}</option>)}</select></label>
                  <label><span>跟进状态</span><select value={form.status} onChange={event => setForm(current => ({ ...current, status: event.target.value as UpdateForm['status'] }))}>{statusOptions.map(item => <option value={item.value} key={item.value}>{item.label}</option>)}</select></label>
                  <label><span>{form.status === 'WAITING_ARRIVAL' ? '预计到料时间 *' : '预计到料时间'}</span><input type="date" value={form.expectedAt} onChange={event => setForm(current => ({ ...current, expectedAt: event.target.value }))} /></label>
                  <label className="wide"><span>本次进展 *</span><textarea rows={3} maxLength={600} value={form.note} onChange={event => setForm(current => ({ ...current, note: event.target.value }))} placeholder="例如：已协调调拨，预计周一上午到仓；到料后等待仓库复核。" /></label>
                </div>
                {formError && <div className="mf-form-error" role="alert">{formError}</div>}
                <footer><span>任务只能由仓库确认异常解决后闭环。</span><button type="button" disabled={updateDisabled} onClick={() => void mutate({ action: 'update', ...form })}><Send size={15} />{saving ? '保存中' : '保存跟进进度'}</button></footer>
              </section> : <section className="mf-readonly-note"><UsersRound /><span><strong>当前为只读查看</strong><small>物料跟进更新由主管或管理员处理。</small></span></section> : <section className="mf-closed-note"><CheckCircle2 /><span><strong>{selected.statusText} · {dateTimeText(selected.resolvedAt)}</strong><small>{selected.exceptionCase.resolutionNote || selected.latestProgress || '仓库已经确认本次反馈结束。'}</small></span><a href={`/workspace/warehouse?taskId=${encodeURIComponent(selected.warehouseTaskId)}`}>查看仓库记录</a></section>}

              <section className="mf-mobile-history"><header><strong>最近动态</strong><span>{visibleActivities.length} 条</span></header>{visibleActivities.slice(0, 4).map(activity => <article key={activity.id}><i /><div><strong>{activity.content || '更新物料跟进'}</strong><small>{activity.actor?.displayName || activity.actor?.username || '系统'} · {dateTimeText(activity.createdAt)}</small></div></article>)}</section>
            </>}
            {!selected && !detailLoading && <div className="mf-detail-empty"><Layers3 /><strong>请选择一条物料异常</strong><span>这里会显示任务阶段、当前风险和跟进操作。</span></div>}
            {detailLoading && <div className="mf-detail-empty"><RefreshCw className="spin" /><strong>正在加载任务详情</strong></div>}
          </section>

          <aside className="mf-activity-panel">
            <header><div><span>协同记录</span><strong>动态时间轴</strong></div><Clock3 size={17} /></header>
            {selected && <section className={`mf-risk-orbit risk-${selected.risk}`}>
              <span><AlertTriangle size={16} /></span>
              <div><small>当前风险</small><strong>{selected.riskText}</strong><p>{selected.risk === 'overdue' ? '预计到料时间已超过，请优先更新进展。' : selected.risk === 'unassigned' ? '任务尚无负责人，请及时接收。' : selected.status === 'RESOLVED' ? `已于 ${dateTimeText(selected.resolvedAt)} 完成闭环。` : '任务正在正常跟进。'}</p></div>
            </section>}
            <div className="mf-activity-list hm-scroll-region" tabIndex={0}>
              {visibleActivities.map(activity => <article key={activity.id}><i /><div><strong>{activity.content || '更新物料跟进'}</strong><span>{activity.actor?.displayName || activity.actor?.username || '系统'}</span><time>{dateTimeText(activity.createdAt)}</time></div></article>)}
              {selected && !visibleActivities.length && <div className="mf-activity-empty"><Clock3 /><span>暂无跟进动态</span></div>}
            </div>
            {selected && <footer><a href={`/workspace/warehouse?taskId=${encodeURIComponent(selected.warehouseTaskId)}`}><Warehouse size={15} />打开仓库配料任务</a><div><CalendarClock size={15} /><span>计划交期</span><strong>{selected.workOrder.deliveryDay || dateText(selected.workOrder.plannedAt)}</strong></div></footer>}
          </aside>
        </section>
      </div>

      {rescheduleOpen && selected?.workOrder.planning && <div className="mf-reschedule-backdrop" role="presentation" onMouseDown={event => {
        if (event.target === event.currentTarget && !rescheduleSaving) setRescheduleOpen(false);
      }}>
        <section className="mf-reschedule-dialog" role="dialog" aria-modal="true" aria-labelledby="mf-reschedule-title">
          <header>
            <div><span><CalendarRange size={15} />到料后改期</span><h2 id="mf-reschedule-title">调整受影响的正式计划</h2><p>{selected.workOrder.specification || selected.workOrder.code} · 实际到料 {dateTimeText(selected.exceptionCase.actualArrivalAt)}</p></div>
            <button type="button" aria-label="关闭" disabled={rescheduleSaving} onClick={() => setRescheduleOpen(false)}><X /></button>
          </header>

          <div className="mf-reschedule-plan-id"><span>排产批次</span><strong>{selected.workOrder.planning.batchId}</strong><em>{selected.workOrder.planning.releaseState}</em></div>

          <div className="mf-reschedule-fields">
            <label><span>新计划完成日期 *</span><input type="date" value={rescheduleForm.plannedCompletionDate} onChange={event => { setRescheduleForm(current => ({ ...current, plannedCompletionDate: event.target.value })); setReschedulePreview(null); }} /></label>
            <label><span>新客户交期</span><input type="date" value={rescheduleForm.customerDueDate} onChange={event => { setRescheduleForm(current => ({ ...current, customerDueDate: event.target.value })); setReschedulePreview(null); }} /></label>
            <label className="wide"><span>改期原因 *</span><textarea rows={3} maxLength={300} value={rescheduleForm.reason} onChange={event => setRescheduleForm(current => ({ ...current, reason: event.target.value }))} placeholder="例如：物料已于 8 月 20 日到仓，结合剩余产能将计划完成日调整至 8 月 22 日。" /></label>
          </div>

          {reschedulePreview ? <section className="mf-reschedule-preview">
            <header><span>影响预览</span><strong>{reschedulePreview.crossesWeek ? '将跨生产周调整' : '仍在原生产周'}</strong></header>
            <div className="mf-reschedule-compare">
              <article><small>调整前</small><strong>{reschedulePreview.before.plannedCompletionDate}</strong><span>{reschedulePreview.before.weekStartDate} - {reschedulePreview.before.weekEndDate}</span><em>客户交期 {reschedulePreview.before.customerDueDate}</em></article>
              <ArrowRight aria-hidden="true" />
              <article className="after"><small>调整后</small><strong>{reschedulePreview.after.plannedCompletionDate}</strong><span>{reschedulePreview.after.weekStartDate} - {reschedulePreview.after.weekEndDate}</span><em>客户交期 {reschedulePreview.after.customerDueDate}</em></article>
            </div>
            <ul><li><CheckCircle2 />已完成报工数量不回退</li><li><CheckCircle2 />现有工序进度不重置</li><li><CheckCircle2 />仓库配料与到料记录不覆盖</li></ul>
          </section> : <section className="mf-reschedule-guidance"><AlertTriangle /><span><strong>先预览，再确认生效</strong><small>系统会检查任务版本、排产版本和是否已经完工；跨周时自动同步工单所属生产周。</small></span></section>}

          {rescheduleError && <div className="mf-form-error" role="alert">{rescheduleError}</div>}
          <footer>
            <button className="secondary" type="button" disabled={rescheduleSaving} onClick={() => setRescheduleOpen(false)}>取消</button>
            {!reschedulePreview ? <button type="button" disabled={rescheduleSaving || !rescheduleForm.plannedCompletionDate} onClick={() => void submitReschedule(false)}>{rescheduleSaving ? '检查中…' : '预览计划影响'}</button> : <button type="button" disabled={rescheduleSaving || !rescheduleForm.reason.trim()} onClick={() => void submitReschedule(true)}>{rescheduleSaving ? '提交中…' : '确认调整计划'}</button>}
          </footer>
        </section>
      </div>}

      {toast && <div className="mf-toast" role="status"><CheckCircle2 size={17} />{toast}</div>}
    </main>
  );
}
