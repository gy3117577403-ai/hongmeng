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
  Maximize2,
  SlidersHorizontal,
  Warehouse,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import './material/MaterialWorkbench.css';
import './material/MaterialFollowUp.css';
import './material/MaterialGlass.css';
import './material/MaterialTaskActions.css';
import MaterialTaskActions from './material/MaterialTaskActions';
import { MaterialOwner } from './material/MaterialSignal';
import MaterialActionDialog from './material/MaterialActionDialog';
import MaterialFieldEditor, { type MaterialEditMode } from './material/MaterialFieldEditor';
import './material/MaterialCompact.css';
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
    ownerId: task?.owner?.id || '',
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

function warehouseReturnHref(task: MaterialFollowUpTaskDTO | null, returnTo: string): string {
  // A warehouse deep link may remain in the address bar while the user browses
  // other follow-up tasks. Preserve its filters only for the originating task.
  if (/^\/workspace\/warehouse(?:[/?#]|$)/.test(returnTo)) {
    const linkedTaskId = new URL(returnTo, 'http://localhost').searchParams.get('taskId');
    if (!task || linkedTaskId === (task.sampleTaskId || task.warehouseTaskId)) return returnTo;
  }
  if (!task) return '/workspace/warehouse';
  const params = new URLSearchParams({ taskId: task.sampleTaskId || task.warehouseTaskId });
  if (task.sampleTaskId) params.set('branch', 'samples');
  return `/workspace/warehouse?${params.toString()}`;
}

export default function MaterialFollowUpShell({ user, embeddedTaskId, onClose, onChanged, onDraftState, onVerify }: { user: CurrentUserDTO; embeddedTaskId?: string; onClose?: () => void; onChanged?: () => void; onVerify?: () => void; onDraftState?: (dirty: boolean, busy: boolean) => void }) {
  const [source, setSource] = useState('ALL');
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ total: 0, totalPages: 1 });
  const [overdue, setOverdue] = useState(false);
  const [batchIds, setBatchIds] = useState<string[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [editMode, setEditMode] = useState<MaterialEditMode | null>(null);
  const [noteEditorOpen, setNoteEditorOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [assignmentDirty, setAssignmentDirty] = useState(false);
  const [actionError, setActionError] = useState('');
  const [returnTo, setReturnTo] = useState('');
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
  const [selectedId, setSelectedId] = useState(embeddedTaskId || '');
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
  const deepLinkedIdRef = useRef('');
  const loadedTaskId = useRef('');
  const detailScroll = useRef<HTMLDivElement>(null);
  const queueScroll = useRef<HTMLDivElement>(null);
  const revealedTask = useRef('');
  useEffect(() => {
    if (!selectedId || revealedTask.current === selectedId) return;
    const queue = queueScroll.current;
    const row = queue?.querySelector<HTMLElement>('.mf-order.active');
    if (!queue || !row) return;
    const bounds = queue.getBoundingClientRect();
    const selectedBounds = row.getBoundingClientRect();
    if (selectedBounds.top < bounds.top) queue.scrollTop += selectedBounds.top - bounds.top - 8;
    else if (selectedBounds.bottom > bounds.bottom) queue.scrollTop += selectedBounds.bottom - bounds.bottom + 8;
    revealedTask.current = selectedId;
  }, [selectedId, tasks]);
  useEffect(() => { detailScroll.current?.scrollTo({ top: 0 }); setHistoryOpen(false); }, [selected?.id]);
  useToastBridge(toast, setToast); useToastBridge(error, setError);
  const progressDirty = Boolean(selected && JSON.stringify(form) !== JSON.stringify(formFor(selected, user.id)));
  useEffect(() => { onDraftState?.(progressDirty || assignmentDirty || Boolean(editMode), saving); }, [progressDirty, assignmentDirty, editMode, saving, onDraftState]);
  useEffect(() => { if (selected && selected.id === selectedId) { if(progressDirty) drafts.current[selected.id] = form; else delete drafts.current[selected.id]; } }, [form, selected, selectedId, progressDirty]);
  const canManage = user.access.capabilities.includes('PROCUREMENT:UPDATE');
  const moduleReadOnly = user.access.modulePermissions?.materials === 'READ';
  const canUpdatePlan = user.access.capabilities.includes('PLANNING:UPDATE');

  useEffect(() => {
    if (embeddedTaskId) { setSelectedId(embeddedTaskId); return; }
    const params = new URLSearchParams(window.location.search);
    const requested = params.get('taskId');
    if (requested) {
      pendingDeepLinkRef.current = requested;
      deepLinkedIdRef.current = requested;
      setSelectedId(requested);
    }
    const requestedScope = params.get('scope');
    const requestedSource = params.get('source');
    if (requestedSource && ['ALL','PURCHASED','CUSTOMER','UNKNOWN'].includes(requestedSource)) setSource(requestedSource);
    if (requestedScope === 'history' || requestedScope === 'preparation') setScope(requestedScope);
    const weekStart = params.get('weekStart');
    if (weekStart) setSelectedWeek(weekStart);
    const requestedReturnTo = params.get('returnTo') || '';
    if (/^\/workspace\/warehouse(?:[/?#]|$)/.test(requestedReturnTo)) setReturnTo(requestedReturnTo);
  }, [embeddedTaskId]);

  useEffect(() => {
    const timer = window.setTimeout(() => { setQuery(keyword.trim()); setPage(1); }, 220);
    return () => window.clearTimeout(timer);
  }, [keyword]);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ status, scope, source, page: String(page), pageSize: embeddedTaskId ? '1' : '40', risk: overdue ? 'overdue' : '' });
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
        setPagination(body.pagination || { total: 0, totalPages: 1 });
        setBatchIds(ids => ids.filter(id => nextTasks.some(t => t.id === id)));
        setUsers(body.users || []);
        setWeeks(body.weeks || []);
        setSelectedId(current => {
          if (embeddedTaskId) return embeddedTaskId;
          const deepLink = pendingDeepLinkRef.current;
          if (deepLink) {
            pendingDeepLinkRef.current = '';
            return deepLink;
          }
          if (current && current === deepLinkedIdRef.current) return current;
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
  }, [owner, query, reloadToken, scope, selectedWeek, status, source, page, overdue, embeddedTaskId]);

  useEffect(() => {
    if (!selectedId) {
      setSelected(null);
      return;
    }
    const controller = new AbortController();
    const changingTask = loadedTaskId.current !== selectedId;
    setDetailLoading(changingTask);
    setFormError('');
    setActionError('');
    fetch(`/api/material-follow-ups/${selectedId}`, { cache: 'no-store', signal: controller.signal })
      .then(async response => {
        const body = await response.json().catch(() => ({})) as { ok?: boolean; task?: MaterialFollowUpTaskDTO; error?: string };
        if (!response.ok || !body.task) throw new Error(body.error || '跟进详情加载失败');
        return body.task;
      })
      .then(task => {
        if (controller.signal.aborted) return;
        loadedTaskId.current=task.id;
        setSelected(task);
        setForm(drafts.current[task.id] || formFor(task, user.id));
        setRescheduleOpen(false);
        if (changingTask) { setEditMode(null); setNoteEditorOpen(false); }
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

  const visibleActivities = useMemo(() => selected?.activities || [], [selected?.activities]);
  const latestActivity = visibleActivities[0];
  const warehouseHref = warehouseReturnHref(selected, returnTo);
  const canReschedule = Boolean(
    canUpdatePlan
    && selected?.exceptionCase.actualArrivalAt
    && selected.workOrder.planning,
  );
  const closed = Boolean(selected && ['RESOLVED', 'CANCELLED'].includes(selected.status));
  const canEditFields = canManage && !moduleReadOnly && !closed;
  const canEditArrival = canEditFields && selected?.status !== 'PENDING' && selected?.status !== 'WAITING_WAREHOUSE';
  const saveAction = { action: 'note', note: form.note };
  const saveDisabled = moduleReadOnly || saving || !selected || closed || !form.note.trim();
  function openEditor(mode: MaterialEditMode) { setFormError(''); setEditMode(mode); }
  const selectedIndex = tasks.findIndex(task => task.id === selected?.id);
  const nextTaskId = selectedIndex >= 0 ? tasks[selectedIndex + 1]?.id : undefined;

  async function mutate(body: Record<string, unknown>, next = false): Promise<boolean> {
    if (!selected || moduleReadOnly || saving) return false;
    const ownershipAction = body.action === 'assign' || body.action === 'claim';
    setSaving(true);
    setFormError('');
    setActionError('');
    try {
      const response = await fetch(`/api/material-follow-ups/${selected.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...body, version: selected.version }),
      });
      const result = await response.json().catch(() => ({})) as { ok?: boolean; task?: MaterialFollowUpTaskDTO; error?: string };
      if (!response.ok || !result.task) throw new Error(result.error || '物料异常跟进更新失败');
      setSelected(result.task);
      const nextForm = { ...formFor(result.task, user.id), note: body.action === 'note' ? '' : form.note };
      drafts.current[result.task.id] = nextForm;
      setForm(nextForm);
      if (next && nextTaskId) { deepLinkedIdRef.current = ''; setSelectedId(nextTaskId); }
      else deepLinkedIdRef.current = result.task.id;
      onChanged?.();
      setTasks(current => current.map(task => task.id === result.task?.id ? result.task : task));
      setToast(body.action === 'claim' ? '已接收任务，开始跟进' : body.action === 'assign' ? `已分配给 ${result.task.owner?.displayName || result.task.owner?.username}，等待本人接收` : '跟进进度已保存');
      setReloadToken(value => value + 1);
      return true;
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : '物料异常跟进更新失败';
      if (ownershipAction) setActionError(message); else setFormError(message);
      return false;
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
    <main className={`ms-workbench mf-workbench mg-workbench mc-workbench ${embeddedTaskId ? 'mg-embedded' : 'hm-workbench-root'}`}>
      {!embeddedTaskId && <>
      <AppWorkbenchHeader subtitle="物料协同" menuItems={[]} user={user} activeHref="/workspace/procurement" hideHeader sidebarTriggerTargetId="mf-sidebar" />
      </>}
      <div className="ms-frame mf-frame mg-frame">
        {embeddedTaskId ? <header className="mg-sheet-head"><span className="mg-module-icon"><Layers3 size={20}/></span><div><small>仓库配料 · 原位处理</small><h2>物料协同处理</h2></div><button aria-label="关闭物料跟进" disabled={saving} onClick={onClose}><X size={18}/></button></header> : <>
        <div className="mc-toolbar">
          <header className="mc-toprow">
            <div id="mf-sidebar"/><Layers3 className="mc-brand" size={22}/><h1>物料跟进</h1>
            <nav className="mc-sources" aria-label="物料来源">{([['ALL','全部'],['PURCHASED','采购'],['CUSTOMER','客供'],['UNKNOWN','来源待确认']] as const).map(([value,label]) => <button type="button" key={value} className={source === value ? 'active' : ''} aria-current={source === value ? 'page' : undefined} onClick={() => { deepLinkedIdRef.current=''; setSource(value); setPage(1); setBatchIds([]); }}>{label}</button>)}</nav>
            <label className="ms-search"><Search size={17}/><input aria-label="搜索物料跟进" value={keyword} onChange={event => { deepLinkedIdRef.current=''; setKeyword(event.target.value); }} placeholder="搜索物料、产品、客户…"/></label>
            <select aria-label="跟进计划周" value={scope} onChange={event => { deepLinkedIdRef.current=''; setScope(event.target.value as WeekScope); setSelectedWeek(''); setPage(1); }}><option value="current">本周与历史未结</option><option value="preparation">下周预备</option><option value="history">历史周</option></select>
            <a className="mc-warehouse-link" href={warehouseHref}><Warehouse size={17}/><span>仓库配料</span></a>
            <button type="button" aria-label="刷新物料跟进" disabled={loading || saving} onClick={() => setReloadToken(value => value + 1)}><RefreshCw size={17}/></button>
          </header>
          <div className="mc-filterrow">
            <nav className="mc-stages" aria-label="跟进状态">{([['ACTIVE','未结',summary.total],['PENDING','待接收',summary.pending],['IN_PROGRESS','跟进中',summary.inProgress],['WAITING_ARRIVAL','等待到料',summary.waitingArrival],['WAITING_WAREHOUSE','待仓库核实',summary.waitingWarehouse],['RESOLVED','已解决',summary.resolved],['ALL','全部记录',null]] as const).map(([value,label,count]) => <button type="button" key={value} className={status === value ? 'active' : ''} aria-current={status === value ? 'page' : undefined} onClick={() => {deepLinkedIdRef.current=''; setStatus(value as StatusFilter); setPage(1);}}>{label}{count !== null && <b>{count}</b>}</button>)}</nav>
            <div className="mc-filter-actions">
              <button className={owner === user.id ? 'active' : ''} aria-pressed={owner === user.id} onClick={() => {deepLinkedIdRef.current='';setOwner(owner === user.id ? '' : user.id);setPage(1);}}>我负责的</button>
              <button className={overdue ? 'active risk' : ''} aria-pressed={overdue} onClick={() => {deepLinkedIdRef.current='';setOverdue(value => !value);setPage(1);}}>到料逾期</button>
              <button aria-haspopup="dialog" className={owner && owner !== user.id || scope !== 'current' ? 'active' : ''} onClick={() => setFiltersOpen(true)}><SlidersHorizontal size={16}/>{owner && owner !== user.id ? users.find(item=>item.id===owner)?.displayName || '待分配' : '筛选'}{scope !== 'current' && <i/>}</button>
              {(keyword || owner || overdue || source !== 'ALL' || status !== 'ACTIVE' || scope !== 'current') && <button aria-label="清除筛选" onClick={() => {setOwner('');setKeyword('');setSource('ALL');setStatus('ACTIVE');setScope('current');setSelectedWeek('');setOverdue(false);setPage(1);deepLinkedIdRef.current='';}}><X size={16}/></button>}
            </div>
          </div>
        </div>
        </>}
        <div className={`ms-workspace mf-workspace mg-workspace ${historyOpen ? 'ms-with-history' : ''}`}>
          {!embeddedTaskId && <aside className="ms-panel ms-queue mf-queue mg-queue">
            <header><strong>物料事项 <span>{pagination.total}</span></strong><small>{loading ? '更新中…' : scope === 'current' ? '本周与历史未结' : scope === 'preparation' ? '下周预备' : rangeText(weeks.find(week => week.weekStartDate === selectedWeek))}</small></header>
            {source === 'UNKNOWN' && canManage && <div className="ms-batchbar">
              <label className="ms-check"><input type="checkbox" aria-label="选择本页待分类" checked={tasks.filter(task => !['RESOLVED', 'CANCELLED'].includes(task.status)).length > 0 && tasks.filter(task => !['RESOLVED', 'CANCELLED'].includes(task.status)).every(task => batchIds.includes(task.id))} onChange={event => setBatchIds(event.target.checked ? tasks.filter(task => !['RESOLVED', 'CANCELLED'].includes(task.status)).map(task => task.id) : [])} />本页</label>
              <button type="button" disabled={!batchIds.length || saving} onClick={() => void classifyBatch('PURCHASED')}>归采购</button>
              <button type="button" disabled={!batchIds.length || saving} onClick={() => void classifyBatch('CUSTOMER')}>归客供</button>
            </div>}
            <div ref={queueScroll} className="ms-scroll ms-list mf-list" aria-busy={loading}>
              {tasks.map(task => <div className="ms-task-row" key={task.id}>
                {source === 'UNKNOWN' && canManage && !['RESOLVED', 'CANCELLED'].includes(task.status) && <input aria-label={`选择 ${task.workOrder.specification || task.workOrder.code}`} type="checkbox" checked={batchIds.includes(task.id)} onChange={event => setBatchIds(ids => event.target.checked ? [...ids, task.id] : ids.filter(id => id !== task.id))} />}
                <button type="button" className={`ms-order mf-order mg-order ${selectedId === task.id ? 'active' : ''} ${task.risk === 'overdue' ? 'overdue' : ''}`} disabled={saving} onClick={() => { deepLinkedIdRef.current = ''; setSelectedId(task.id); }}>
                  <span className="mc-card-title"><strong>{task.exceptionCase.materialModel || task.exceptionCase.exceptionNote}</strong>{task.risk === 'overdue' && <em className="mc-risk-tag">逾期</em>}</span>
                  <span className="mf-order-material" title={`${task.workOrder.specification || task.workOrder.code} · ${task.workOrder.customerName || ''}`}>{task.workOrder.specification || task.workOrder.code} · {task.workOrder.customerName || '客户待补充'}</span>
                  <span className="mc-card-meta"><MaterialOwner event={{...task.exceptionCase,owner:task.owner}}/><em className={`mf-status-chip ${task.status === 'RESOLVED' ? 'resolved' : task.status === 'WAITING_WAREHOUSE' ? 'warehouse' : ''}`}>{task.statusText}</em><time className={task.risk === 'overdue' ? 'mc-danger' : ''}>{dateText(task.expectedAt)}</time></span>
                  <span className="mc-card-progress" title={task.latestProgress || ''}>{task.activities?.[0]?.actor?.displayName && <b>{task.activities[0].actor.displayName} · </b>}{task.activities?.[0]?.content || task.latestProgress || '暂无跟进记录'}</span>
                  <span className="mc-card-week">{task.workOrder.weekStartDate ? `计划周 ${dateText(task.workOrder.weekStartDate)} — ${dateText(task.workOrder.weekEndDate)}` : '未排期'}<span>{materialSourceText[task.exceptionCase.supplySource || 'UNKNOWN']}</span></span>
                </button>
              </div>)}
              {!loading && !tasks.length && <div className="ms-empty"><PackageCheck /><strong>当前筛选没有事项</strong><span>切换来源、状态或周次查看其他记录。</span></div>}
            </div>
            <footer className="ms-pagination"><button type="button" aria-label="上一页" disabled={page <= 1 || loading} onClick={() => setPage(value => value - 1)}>上一页</button><span>{page} / {pagination.totalPages}</span><button type="button" aria-label="下一页" disabled={page >= pagination.totalPages || loading} onClick={() => setPage(value => value + 1)}>下一页</button></footer>
          </aside>}

          <section className="ms-panel ms-detail mf-detail" aria-busy={detailLoading}>
            {selected && !detailLoading ? <>
              <header className="mc-detail-head">
                <div className="mc-titleline"><h2 title={selected.exceptionCase.materialModel || selected.exceptionCase.exceptionNote}>{selected.exceptionCase.materialModel || selected.exceptionCase.exceptionNote}</h2><span className={`mf-status-chip ${selected.status === 'RESOLVED' ? 'resolved' : selected.status === 'WAITING_WAREHOUSE' ? 'warehouse' : ''}`}>{selected.statusText}</span><button type="button" aria-expanded={historyOpen} onClick={() => setHistoryOpen(value=>!value)}><Clock3 size={16}/>跟进记录</button></div>
                <div className="mc-subline"><span>{selected.workOrder.specification || selected.workOrder.code} · {selected.workOrder.customerName || '客户待补充'}</span>{!selected.exceptionCase.materialModel && <em>型号待补充</em>}<span>{selected.workOrder.weekStartDate ? `计划周 ${dateText(selected.workOrder.weekStartDate)} — ${dateText(selected.workOrder.weekEndDate)}` : '计划周待确认'}</span></div>
                <MaterialTaskActions key={selected.id} task={selected} user={user} users={users} busy={saving} error={actionError} onAction={mutate} onDirty={setAssignmentDirty}/>
              </header>
              <div ref={detailScroll} className="ms-scroll ms-detail-body mf-detail-scroll">
                <section className="mc-facts" aria-label="缺料信息">
                  <div><span>物料来源</span><strong>{materialSourceText[selected.exceptionCase.supplySource || 'UNKNOWN']}</strong>{canEditFields && <button disabled={saving} onClick={()=>openEditor('source')}>{selected.exceptionCase.supplySource === 'UNKNOWN' ? '确认来源' : '修改来源'}</button>}</div>
                  <div><span>预计到料</span><strong className={selected.risk === 'overdue' ? 'mc-danger' : ''}>{dateText(selected.expectedAt)}{selected.risk === 'overdue' && <em className="mc-risk-tag">逾期</em>}</strong>{canEditArrival && <button disabled={saving} onClick={()=>openEditor('eta')}>改交期</button>}</div>
                  <div><span>缺料数量 / 累计已到</span><strong>{selected.exceptionCase.shortageQuantity ?? '待确认'} <em>/ {selected.exceptionCase.receivedQuantity || 0} {selected.exceptionCase.unit || '个'}</em></strong>{canEditArrival && <button disabled={saving} onClick={()=>openEditor('arrival')}>登记到料</button>}</div>
                  <div><span>还需到料</span><strong>{selected.exceptionCase.shortageQuantity == null ? '待确认' : Number(Math.max(0,selected.exceptionCase.shortageQuantity - (selected.exceptionCase.receivedQuantity || 0)).toFixed(3))}<em> {selected.exceptionCase.unit || '个'}</em></strong>{selected.status === 'WAITING_WAREHOUSE' && (onVerify ? <button className="mc-verify" onClick={onVerify}>核对到料 <ChevronRight size={14}/></button> : <a className="mc-verify" href={warehouseHref}>前往仓库核实 <ChevronRight size={14}/></a>)}</div>
                </section>
                <section className="mf-latest"><div className="mc-section-head"><h3>最近进展</h3><small>{latestActivity?.actor?.displayName || latestActivity?.actor?.username || (latestActivity ? '系统' : '')} {dateTimeText(latestActivity?.createdAt || selected.lastFollowedAt)}</small></div><p>{latestActivity?.content || selected.latestProgress || '暂无跟进记录'}</p></section>
                {visibleActivities.length > 1 && <section className="mc-recent" aria-label="近期记录"><div className="mc-section-head"><h3>近期记录</h3><button onClick={()=>setHistoryOpen(true)}>全部记录 <ArrowRight size={15}/></button></div>{visibleActivities.slice(1,4).map(activity=><article key={activity.id}><p>{activity.content}</p><small>{activity.actor?.displayName || activity.actor?.username || '系统'} · {dateTimeText(activity.createdAt)}</small></article>)}</section>}
                <section className="mc-origin"><div className="mc-section-head"><h3>仓库反馈</h3><small>{selected.exceptionCase.reportedBy?.displayName || selected.exceptionCase.reportedBy?.username || '仓库'} · {dateTimeText(selected.exceptionCase.reportedAt)}</small></div><p>{selected.exceptionCase.exceptionNote}</p><span>{selected.workOrder.productName} · 计划 {quantityText(selected)} 件</span></section>
                {closed && <div className="mf-closed"><CheckCircle2 size={20}/><div><strong>{selected.status === 'RESOLVED' ? `仓库已核验 · ${dateTimeText(selected.resolvedAt)}` : '事项已取消'}</strong>{selected.exceptionCase.resolutionNote && <p>{selected.exceptionCase.resolutionNote}</p>}</div></div>}
              </div>
              {!closed && !moduleReadOnly && <footer className="mc-composer">
                {formError && !editMode && <div className="mc-error" role="alert">{formError}<button onClick={()=>setReloadToken(value=>value+1)}>刷新数据</button></div>}
                <div className="mc-compose-row"><textarea aria-label="本次进展" rows={1} maxLength={600} disabled={saving} placeholder="写下本次进展…" value={form.note} onChange={event=>setForm(current=>({...current,note:event.target.value}))}/><button aria-label="展开进展编辑" title="展开进展编辑" onClick={()=>setNoteEditorOpen(true)}><Maximize2 size={17}/></button><button type="button" className="ms-primary" disabled={saveDisabled} onClick={()=>void mutate(saveAction)}><Send size={16}/>{saving ? '保存中…' : '保存进展'}</button>{!embeddedTaskId && nextTaskId && <button type="button" disabled={saveDisabled} onClick={()=>void mutate(saveAction,true)}>保存并下一项</button>}</div>
              </footer>}
              <footer className="mc-footer">{!embeddedTaskId && <a href={warehouseHref}><Warehouse size={15}/>对应仓库工单</a>}{moduleReadOnly && <span>只读</span>}{canReschedule && <button onClick={openReschedule}>到料后改期</button>}<span className="mc-updated">更新 {dateTimeText(selected.updatedAt)}</span></footer>
            </> : <div className="ms-empty"><Layers3 size={38} /><strong>{detailLoading ? '正在加载事项…' : '请选择物料异常'}</strong></div>}
          </section>

          {historyOpen && <aside className="ms-panel ms-history"><header><strong>完整处理时间线</strong><button type="button" aria-label="关闭跟进记录" onClick={() => setHistoryOpen(false)}><X size={16} /></button></header><div className="ms-scroll ms-timeline">{visibleActivities.map(activity => <article key={activity.id}><i /><div><strong>{activity.content || '更新跟进'}</strong><small>{activity.actor?.displayName || activity.actor?.username || '系统'} · {dateTimeText(activity.createdAt)}</small></div></article>)}{!visibleActivities.length && <div className="ms-empty">暂无跟进记录</div>}</div></aside>}
        </div>
      </div>
      {filtersOpen && <MaterialActionDialog title="筛选物料事项" onClose={()=>setFiltersOpen(false)} footer={<button className="ms-primary" onClick={()=>setFiltersOpen(false)}>完成</button>}>
        <label>负责人<select aria-label="跟进负责人" value={owner} onChange={event=>{deepLinkedIdRef.current='';setOwner(event.target.value);setPage(1);}}><option value="">全部负责人</option><option value="unassigned">待分配</option>{users.map(candidate=><option key={candidate.id} value={candidate.id}>{candidate.displayName || candidate.username}</option>)}</select></label>
        {scope !== 'current' && <label>计划周<select aria-label="选择生产周" value={selectedWeek} onChange={event=>{deepLinkedIdRef.current='';setSelectedWeek(event.target.value);setPage(1);}}><option value="">{scope === 'history' ? '全部历史周' : '默认下周'}</option>{weeks.map(week=><option key={week.weekStartDate} value={week.weekStartDate}>{rangeText(week)}</option>)}</select></label>}
      </MaterialActionDialog>}
      {editMode && selected && <MaterialFieldEditor key={`${selected.id}-${editMode}`} mode={editMode} task={selected} busy={saving} error={formError} onSave={mutate} onClose={()=>setEditMode(null)} onRefresh={()=>setReloadToken(value=>value+1)}/>}
      {noteEditorOpen && <MaterialActionDialog title="填写进展" busy={saving} onClose={()=>setNoteEditorOpen(false)} footer={<button className="ms-primary" onClick={()=>setNoteEditorOpen(false)}>完成编辑</button>}><label>进展<textarea aria-label="完整进展" rows={8} maxLength={600} value={form.note} onChange={event=>setForm(current=>({...current,note:event.target.value}))}/></label><small>{form.note.length} / 600</small></MaterialActionDialog>}
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
