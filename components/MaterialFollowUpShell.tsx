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
import './material/MaterialWorkbench.css';
import { useToastBridge } from '@/components/ToastProvider';
import { materialSourceText, type MaterialSource } from '@/lib/material-source';
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
  sourceSummary?: Record<string, number>;
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
  supplySource: MaterialSource;
  receivedQuantity: string;
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
    supplySource: task?.exceptionCase.supplySource || 'UNKNOWN',
    receivedQuantity: String(task?.exceptionCase.receivedQuantity || 0),
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
  const [source, setSource] = useState('ALL');
  const [sourceSummary, setSourceSummary] = useState<Record<string, number>>({});
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ total: 0, totalPages: 1 });
  const [overdue, setOverdue] = useState(false);
  const [batchIds, setBatchIds] = useState<string[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const drafts = useRef<Record<string, UpdateForm>>({});
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
  useToastBridge(toast, setToast); useToastBridge(error, setError);
  useEffect(() => { if (selected && selected.id === selectedId) drafts.current[selected.id] = form; }, [form, selected, selectedId]);
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
    const requestedSource = params.get('source');
    if (requestedSource && ['ALL','PURCHASED','CUSTOMER','UNKNOWN'].includes(requestedSource)) setSource(requestedSource);
    if (requestedScope === 'history' || requestedScope === 'preparation') setScope(requestedScope);
    const weekStart = params.get('weekStart');
    if (weekStart) setSelectedWeek(weekStart);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { setQuery(keyword.trim()); setPage(1); }, 220);
    return () => window.clearTimeout(timer);
  }, [keyword]);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ status, scope, source, page: String(page), pageSize: '40', risk: overdue ? 'overdue' : '' });
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
        if (!body || controller.signal.aborted) return;
        const nextTasks = body.tasks || [];
        setTasks(nextTasks);
        setSummary(body.summary || emptySummary);
        setSourceSummary(body.sourceSummary || {});
        setPagination(body.pagination || { total: 0, totalPages: 1 });
        setBatchIds(ids => ids.filter(id => nextTasks.some(t => t.id === id)));
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
  }, [owner, query, reloadToken, scope, selectedWeek, status, source, page, overdue]);

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
        if (controller.signal.aborted) return;
        setSelected(task);
        setForm(drafts.current[task.id] || formFor(task, user.id));
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
  }, [selectedId, user.id, reloadToken]);

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

  async function mutate(body: Record<string, unknown>, next = false): Promise<void> {
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
      drafts.current[result.task.id] = formFor(result.task, user.id);
      setForm(formFor(result.task, user.id));
      if (next) setSelectedId(tasks[tasks.findIndex(t => t.id === selected.id) + 1]?.id || tasks.find(t => t.id !== selected.id)?.id || selected.id);
      setTasks(current => current.map(task => task.id === result.task?.id ? result.task : task));
      setToast(body.action === 'claim' ? '已接收物料异常' : '跟进进度已保存');
      setReloadToken(value => value + 1);
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : '物料异常跟进更新失败');
    } finally {
      setSaving(false);
    }
  }

  async function classifyBatch(supplySource: string) {
    setSaving(true);
    try {
      const r = await fetch('/api/material-follow-ups/classify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ supplySource, items: tasks.filter(t => batchIds.includes(t.id)).map(t => ({ id: t.id, version: t.version })) }) });
      const b = await r.json(); if (!r.ok) throw Error(b.error || '分类失败');
      setBatchIds([]); setSelectedId(''); setReloadToken(n => n + 1); setToast(`已归类 ${b.count} 项，负责人和跟进记录已保留`);
    } catch(e) { setError(e instanceof Error ? e.message : '分类失败'); } finally { setSaving(false); }
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
    <main className="ms-workbench hm-workbench-root">
      <AppWorkbenchHeader subtitle="物料协同" menuItems={[]} user={user} activeHref="/workspace/procurement" hideHeader sidebarTriggerTargetId="mf-sidebar" />
      <div className="ms-frame">
        <header className="ms-top"><div id="mf-sidebar"/><Layers3 size={21}/><h1>物料跟进</h1><span className="ms-muted ms-desktop-note">采购与客供分开跟进</span><div className="ms-spacer"/><select aria-label="跟进计划周" value={scope} onChange={e => { setScope(e.target.value as WeekScope); setSelectedWeek(''); setPage(1); }}><option value="current">本周与历史未结</option><option value="preparation">下周预备</option><option value="history">历史周</option></select>{scope !== 'current' && <select aria-label="选择生产周" value={selectedWeek} onChange={e => { setSelectedWeek(e.target.value); setPage(1); }}><option value="">{scope === 'history' ? '全部历史周' : '默认下周'}</option>{weeks.map(w => <option key={w.weekStartDate} value={w.weekStartDate}>{rangeText(w)}</option>)}</select>}<a href="/workspace/warehouse"><Warehouse size={15}/>仓库配料</a><button disabled={loading} onClick={() => setReloadToken(n => n + 1)}><RefreshCw size={16}/>刷新</button></header>
        <nav className="ms-sources" aria-label="物料来源">{[['ALL','全部'],['PURCHASED','采购物料跟进'],['CUSTOMER','客供物料跟进'],['UNKNOWN','来源待确认']].map(([v,l]) => <button className={source === v ? 'active' : ''} key={v} onClick={() => { setSource(v); setPage(1); setBatchIds([]); }}>{l}<b>{v === 'ALL' ? Object.values(sourceSummary).reduce((a,b) => a + b,0) : sourceSummary[v] || 0}</b></button>)}<span className="ms-muted">未结事项</span></nav>
        <div className="ms-filterbar"><nav className="ms-tabs" aria-label="跟进状态">{[['ACTIVE','待处理',summary.total],['PENDING','待接收',summary.pending],['IN_PROGRESS','跟进中',summary.inProgress],['WAITING_ARRIVAL','等待到料',summary.waitingArrival],['WAITING_WAREHOUSE','待仓库确认',summary.waitingWarehouse],['RESOLVED','已解决',summary.resolved],['ALL','全部记录',null]].map(([v,l,n]) => <button className={status === v ? 'active' : ''} key={String(v)} onClick={() => { setStatus(v as StatusFilter); setPage(1); }}>{l}{n !== null && <b>{n}</b>}</button>)}</nav></div>
        <div className="ms-filterbar"><label className="ms-search"><Search size={16}/><input aria-label="搜索物料跟进" value={keyword} onChange={e => setKeyword(e.target.value)} placeholder="产品型号、物料、工单、客户或跟进内容"/></label><select aria-label="跟进负责人" value={owner} onChange={e => { setOwner(e.target.value); setPage(1); }}><option value="">全部负责人</option><option value="unassigned">待认领</option>{users.map(u => <option key={u.id} value={u.id}>{u.displayName || u.username}</option>)}</select><label className="ms-check"><input type="checkbox" checked={owner === user.id} onChange={e => { setOwner(e.target.checked ? user.id : ''); setPage(1); }}/>我负责的</label><label className="ms-check"><input type="checkbox" checked={overdue} onChange={e => { setOverdue(e.target.checked); setPage(1); }}/>到料逾期</label><button onClick={() => { setOwner(''); setKeyword(''); setStatus('ACTIVE'); setOverdue(false); setPage(1); }}>清除</button></div>
        <div className={`ms-workspace ${historyOpen ? 'ms-with-history' : ''}`}>
          <aside className="ms-panel ms-queue"><header><strong>异常事项</strong><span>{pagination.total} 项</span></header>
            {source === 'UNKNOWN' && canManage && <div className="ms-batchbar"><label className="ms-check"><input type="checkbox" aria-label="选择本页待分类" checked={tasks.filter(t => !['RESOLVED','CANCELLED'].includes(t.status)).length > 0 && tasks.filter(t => !['RESOLVED','CANCELLED'].includes(t.status)).every(t => batchIds.includes(t.id))} onChange={e => setBatchIds(e.target.checked ? tasks.filter(t => !['RESOLVED','CANCELLED'].includes(t.status)).map(t => t.id) : [])}/>本页</label><button disabled={!batchIds.length || saving} onClick={() => void classifyBatch('PURCHASED')}>归采购</button><button disabled={!batchIds.length || saving} onClick={() => void classifyBatch('CUSTOMER')}>归客供</button></div>}
            <div className="ms-scroll ms-list" aria-busy={loading}>{tasks.map(t => <div className="ms-task-row" key={t.id}>{source === 'UNKNOWN' && canManage && !['RESOLVED','CANCELLED'].includes(t.status) && <input aria-label={`选择 ${t.workOrder.specification || t.workOrder.code}`} type="checkbox" checked={batchIds.includes(t.id)} onChange={e => setBatchIds(ids => e.target.checked ? [...ids,t.id] : ids.filter(id => id !== t.id))}/>}<button className={`ms-order ${selectedId === t.id ? 'active' : ''}`} disabled={saving} onClick={() => setSelectedId(t.id)}><span className="ms-eyebrow">{t.workOrder.customerName || '客户待补充'}{t.carryover && ` · ${t.carryover.label}`}</span><strong>{t.workOrder.specification || t.workOrder.code}</strong><span className="ms-clamp">{t.exceptionCase.exceptionNote}</span><div className="ms-badges"><em className={`ms-source-${t.exceptionCase.supplySource || 'UNKNOWN'}`}>{materialSourceText[t.exceptionCase.supplySource || 'UNKNOWN']}</em><em className={t.status === 'RESOLVED' ? 'ms-success' : ''}>{t.statusText}</em>{t.risk === 'overdue' && <em className="ms-warning">到料逾期</em>}</div><small>{t.owner?.displayName || t.owner?.username || '待认领'} · {t.status === 'RESOLVED' ? `解决 ${dateTimeText(t.resolvedAt)}` : `预计 ${dateText(t.expectedAt)}`}</small></button></div>)}{!loading && !tasks.length && <div className="ms-empty"><PackageCheck/><strong>当前筛选没有事项</strong><span>切换来源或状态查看其他记录。</span></div>}</div>
            <footer className="ms-pagination"><button aria-label="上一页" disabled={page <= 1 || loading} onClick={() => setPage(p => p - 1)}>上一页</button><span>{page} / {pagination.totalPages}</span><button aria-label="下一页" disabled={page >= pagination.totalPages || loading} onClick={() => setPage(p => p + 1)}>下一页</button></footer>
          </aside>
          <section className="ms-panel ms-detail" aria-busy={detailLoading}>{selected && !detailLoading ? <>
            <header className="ms-detail-head"><div><span className={`ms-source-${selected.exceptionCase.supplySource || 'UNKNOWN'}`}>{selected.exceptionCase.exceptionTypeText} · 事项 #{selected.exceptionCase.sequence}</span><h2>{selected.workOrder.specification || selected.workOrder.code}</h2><small>{selected.workOrder.customerName} · {selected.workOrder.productName}</small></div><button onClick={() => setHistoryOpen(!historyOpen)}><Clock3 size={15}/>{historyOpen ? '收起记录' : '跟进记录'}</button></header>
            <nav className="ms-progress" aria-label="跟进进度">{['待接收','跟进中','等待到料','待仓库确认','已解决'].map((label,i) => <span className={i <= activeStage ? 'active' : ''} key={label}><i>{i < activeStage ? '✓' : i + 1}</i>{label}</span>)}</nav>
            <div className="ms-scroll ms-detail-body">
              <section className="ms-feedback"><span className="ms-eyebrow">仓库反馈 · {dateTimeText(selected.exceptionCase.reportedAt)}</span><h3>{selected.exceptionCase.exceptionNote}</h3><div className="mw-event-facts"><span>物料 <b>{selected.exceptionCase.materialModel || '见缺料说明'}</b></span><span>本次缺料 <b>{selected.exceptionCase.shortageQuantity == null ? '数量待确认' : `${selected.exceptionCase.shortageQuantity} ${selected.exceptionCase.unit}`}</b></span><span>累计到料 <b>{selected.exceptionCase.receivedQuantity || 0} {selected.exceptionCase.unit || '个'}</b></span><span>工单 <b>{selected.workOrder.code}</b></span></div></section>
              {selected.latestProgress && <div className="ms-latest"><span>最近进展 · {dateTimeText(selected.lastFollowedAt || selected.updatedAt)}</span><p>{selected.latestProgress}</p></div>}
              {!['RESOLVED','CANCELLED'].includes(selected.status) && canManage ? <section className="ms-edit-console"><header><h3>更新跟进</h3>{!selected.owner && <button disabled={saving} onClick={() => void mutate({ action: 'claim' })}><UserRoundCheck size={15}/>接收任务</button>}</header><div className="ms-form-grid">
                <label>物料来源<select aria-label="修改物料来源" value={form.supplySource} onChange={e => setForm(f => ({ ...f, supplySource: e.target.value as MaterialSource }))}>{Object.entries(materialSourceText).map(([v,l]) => <option key={v} value={v}>{l}</option>)}</select></label>
                <label>负责人<select value={form.ownerId} onChange={e => setForm(f => ({ ...f, ownerId: e.target.value }))}><option value="">请选择</option>{users.map(u => <option key={u.id} value={u.id}>{u.displayName || u.username}</option>)}</select></label>
                <label>跟进状态<select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value as UpdateForm['status'] }))}>{statusOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
                <label>{form.status === 'WAITING_ARRIVAL' ? '预计到料日期 *' : '预计到料日期'}<input aria-label="预计到料日期" type="date" value={form.expectedAt} onChange={e => setForm(f => ({ ...f, expectedAt: e.target.value }))}/></label>
                <label>累计已到数量（{selected.exceptionCase.unit || '个'}）<input aria-label="累计已到数量" type="number" min="0" step="0.001" value={form.receivedQuantity} onChange={e => setForm(f => ({ ...f, receivedQuantity: e.target.value }))}/></label>
                <div className="ms-field-hint">交期未确认时，选择“跟进中”即可保存。部分到料后继续记录剩余物料的进展。</div>
                <label className="ms-wide">本次进展 *<textarea aria-label="本次进展" rows={3} maxLength={600} placeholder={form.supplySource === 'CUSTOMER' ? '填写客户反馈、发货情况、运单或剩余物料安排' : '填写采购进展、供应商反馈、发货情况或运单'} value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))}/></label>
              </div>{formError && <p className="ms-form-error" role="alert">{formError}</p>}</section> : <div className="ms-closed"><CheckCircle2 size={23}/><div><strong>{selected.status === 'RESOLVED' ? `已解决 · ${dateTimeText(selected.resolvedAt)}` : '查看物料跟进'}</strong><p>{selected.exceptionCase.resolutionNote || '物料实际到仓后由仓库核验并确认。'}</p></div></div>}
            </div>
            <footer className="ms-bottom"><a href={selected.sampleTaskId ? `/workspace/warehouse?branch=samples&taskId=${selected.sampleTaskId}` : `/workspace/warehouse?taskId=${selected.warehouseTaskId}`}>仓库异常 <ChevronRight size={14}/></a>{canReschedule && <button onClick={openReschedule}>到料后改期</button>}<div className="ms-spacer"/>{!['RESOLVED','CANCELLED'].includes(selected.status) && canManage && <><button disabled={updateDisabled} onClick={() => void mutate({ action: 'update', ...form }, true)}>保存并下一项</button><button className="ms-primary" disabled={updateDisabled} onClick={() => void mutate({ action: 'update', ...form })}><Send size={15}/>{saving ? '保存中…' : '保存进展'}</button></>}</footer>
          </> : <div className="ms-empty"><Layers3 size={38}/><strong>{detailLoading ? '正在加载事项…' : '请选择物料异常'}</strong></div>}</section>
          {historyOpen && <aside className="ms-panel ms-history"><header><strong>跟进记录</strong><button aria-label="关闭跟进记录" onClick={() => setHistoryOpen(false)}><X size={16}/></button></header><div className="ms-scroll ms-timeline">{visibleActivities.map(a => <article key={a.id}><i/><div><strong>{a.content || '更新跟进'}</strong><small>{a.actor?.displayName || a.actor?.username || '系统'} · {dateTimeText(a.createdAt)}</small></div></article>)}{!visibleActivities.length && <div className="ms-empty">暂无跟进记录</div>}</div></aside>}
        </div>
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


    </main>
  );
}
