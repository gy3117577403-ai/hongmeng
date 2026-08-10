'use client';

import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  Box,
  CalendarDays,
  ChevronRight,
  CheckCircle2,
  CircleDot,
  ClipboardList,
  Clock3,
  Gauge,
  Layers3,
  PackageCheck,
  Radio,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  Truck,
  Warehouse,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useToastBridge } from '@/components/ToastProvider';
import { AppWorkbenchHeader } from '@/components/layout/AppWorkbenchHeader';
import { useModalLayer } from '@/components/useModalLayer';
import type {
  CurrentUserDTO,
  WarehouseExceptionType,
  WarehouseMaterialStatus,
  WarehouseMaterialSummaryDTO,
  WarehouseMaterialTaskDTO,
  WarehouseWeekOptionDTO,
} from '@/types';

type WarehousePayload = {
  ok: boolean;
  tasks: WarehouseMaterialTaskDTO[];
  summary: WarehouseMaterialSummaryDTO;
  selectedWeekStart?: string | null;
  weeks: WarehouseWeekOptionDTO[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
  error?: string;
};

type ExceptionForm = {
  exceptionType: WarehouseExceptionType;
  exceptionNote: string;
  expectedAt: string;
  resolutionNote: string;
  reopenNote: string;
};

type ExceptionModalPanel = 'update' | 'resolve';

const emptySummary: WarehouseMaterialSummaryDTO = { total: 0, pending: 0, completed: 0, exception: 0, expectedOverdue: 0 };
const exceptionOptions: Array<{ value: WarehouseExceptionType; label: string }> = [
  { value: 'shortage', label: '缺料' },
  { value: 'wrong_material', label: '料错' },
  { value: 'insufficient_quantity', label: '数量不足' },
  { value: 'quality_issue', label: '来料质量异常' },
  { value: 'other', label: '其他异常' },
];
const warehouseFlowStages = [
  { label: '任务下达', hint: '计划同步', icon: ClipboardList },
  { label: '仓库配料', hint: '物料拣配', icon: Box },
  { label: '仓库复核', hint: '数量校验', icon: ShieldCheck },
  { label: '已配料', hint: '等待生产', icon: PackageCheck },
];
const warehouseFlowParticles = Array.from({ length: 14 }, (_, index) => index);

function emptyExceptionForm(task?: WarehouseMaterialTaskDTO | null): ExceptionForm {
  return {
    exceptionType: task?.exceptionType || 'shortage',
    exceptionNote: task?.exceptionNote || '',
    expectedAt: task?.followUpTask?.expectedAt?.slice(0, 10)
      || task?.expectedAt?.slice(0, 10)
      || '',
    resolutionNote: '',
    reopenNote: '',
  };
}

function dateText(value?: string | null): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit',
  }).format(date);
}

function dateTimeText(value?: string | null): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date);
}

function rangeText(week?: WarehouseWeekOptionDTO): string {
  if (!week) return '全部历史周';
  return `${dateText(week.weekStartDate)} - ${dateText(week.weekEndDate)}`;
}

function addDaysText(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function quantityText(task: WarehouseMaterialTaskDTO): string {
  if (task.workOrder.productionTargetQty !== null && task.workOrder.productionTargetQty !== undefined) {
    return task.workOrder.productionTargetQty.toLocaleString('zh-CN');
  }
  return task.workOrder.uncompletedQty?.trim() || '待补充';
}

function isArrivalException(type: WarehouseExceptionType): boolean {
  return type === 'shortage' || type === 'insufficient_quantity';
}

function chinaDateKey(value = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes): string => parts.find(item => item.type === type)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function taskFlowIndex(task: WarehouseMaterialTaskDTO): number {
  if (task.status === 'completed') return 3;
  if (task.status === 'exception') return 2;
  return 1;
}

export default function WarehouseManagementShell({ user }: { user: CurrentUserDTO }) {
  const [scope, setScope] = useState<'current' | 'preparation' | 'history'>('current');
  const [selectedWeek, setSelectedWeek] = useState('');
  const [status, setStatus] = useState<'all' | WarehouseMaterialStatus>('all');
  const [exceptionType, setExceptionType] = useState<'all' | WarehouseExceptionType>('all');
  const [expectedOverdue, setExpectedOverdue] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [payload, setPayload] = useState<WarehousePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [savingId, setSavingId] = useState('');
  const [drawerTask, setDrawerTask] = useState<WarehouseMaterialTaskDTO | null>(null);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [form, setForm] = useState<ExceptionForm>(() => emptyExceptionForm());
  const [formBaseline, setFormBaseline] = useState<ExceptionForm>(() => emptyExceptionForm());
  const [modalPanel, setModalPanel] = useState<ExceptionModalPanel>('update');
  const [formError, setFormError] = useState('');
  const [toast, setToast] = useState('');
  useToastBridge(toast, setToast);
  const [refreshToken, setRefreshToken] = useState(0);
  const [selectedTaskId, setSelectedTaskId] = useState('');
  const mainRef = useRef<HTMLElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  useModalLayer({
    open: Boolean(drawerTask),
    layerRef: drawerRef,
    triggerRef,
    backgroundRef: mainRef,
    onClose: closeDrawer,
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedScope = params.get('scope');
    if (requestedScope === 'preparation' || requestedScope === 'history') {
      setScope(requestedScope);
    }
    const requestedTaskId = params.get('taskId');
    if (!requestedTaskId) return;
    setDrawerLoading(true);
    fetch(`/api/warehouse/material-tasks/${encodeURIComponent(requestedTaskId)}`, { cache: 'no-store' })
      .then(async response => {
        const body = await response.json().catch(() => ({})) as { ok?: boolean; task?: WarehouseMaterialTaskDTO; error?: string };
        if (!response.ok || !body.task) throw new Error(body.error || '配料任务加载失败');
        return body.task;
      })
      .then(task => {
        setDrawerTask(task);
        hydrateTaskForm(task);
        setModalPanel('update');
      })
      .catch(reason => setError(reason instanceof Error ? reason.message : '配料任务加载失败'))
      .finally(() => setDrawerLoading(false));
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { setQuery(keyword.trim()); setPage(1); }, 250);
    return () => window.clearTimeout(timer);
  }, [keyword]);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ scope, status, page: String(page), pageSize: '100' });
    if ((scope === 'history' || scope === 'preparation') && selectedWeek) params.set('weekStart', selectedWeek);
    if (exceptionType !== 'all') params.set('exceptionType', exceptionType);
    if (expectedOverdue) params.set('expected', 'overdue');
    if (query) params.set('keyword', query);
    setLoading(true);
    setError('');
    fetch(`/api/warehouse/material-tasks?${params.toString()}`, { signal: controller.signal })
      .then(async response => {
        const body = await response.json().catch(() => ({})) as WarehousePayload;
        if (response.status === 401) { location.href = '/login'; return null; }
        if (!response.ok) throw new Error(body.error || '仓库配料任务加载失败');
        return body;
      })
      .then(body => { if (body) setPayload(body); })
      .catch(reason => { if (reason instanceof Error && reason.name !== 'AbortError') setError(reason.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [scope, selectedWeek, status, exceptionType, expectedOverdue, query, page, refreshToken]);

  const summary = payload?.summary || emptySummary;
  const visibleTasks = useMemo(() => payload?.tasks || [], [payload?.tasks]);
  const selectedTask = useMemo(
    () => visibleTasks.find(task => task.id === selectedTaskId) || visibleTasks[0] || null,
    [selectedTaskId, visibleTasks],
  );
  const exceptionTasks = useMemo(
    () => visibleTasks.filter(task => task.status === 'exception').slice(0, 3),
    [visibleTasks],
  );
  const followUpTasks = useMemo(
    () => visibleTasks.filter(task => task.followUpTask).slice(0, 2),
    [visibleTasks],
  );
  const recentTasks = useMemo(
    () => [...visibleTasks]
      .sort((first, second) => new Date(second.updatedAt).getTime() - new Date(first.updatedAt).getTime())
      .slice(0, 5),
    [visibleTasks],
  );
  const selectedFlowIndex = selectedTask ? taskFlowIndex(selectedTask) : 0;
  const selectedFlowProgress = selectedTask
    ? Math.round((selectedFlowIndex / (warehouseFlowStages.length - 1)) * 100)
    : 0;
  const formDirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(formBaseline), [form, formBaseline]);
  const todayDate = useMemo(() => chinaDateKey(), []);
  const selectedWeekOption = useMemo(() => {
    const weekStartDate = selectedWeek || payload?.selectedWeekStart || '';
    if (!weekStartDate) return undefined;
    return payload?.weeks.find(week => week.weekStartDate === weekStartDate) || {
      weekStartDate,
      weekEndDate: addDaysText(weekStartDate, 6),
      active: false,
      taskCount: 0,
    };
  }, [payload?.selectedWeekStart, payload?.weeks, selectedWeek]);

  function resetFilters(): void {
    setStatus('all');
    setExceptionType('all');
    setExpectedOverdue(false);
    setKeyword('');
    setPage(1);
  }

  function chooseSummary(nextStatus: 'all' | WarehouseMaterialStatus, overdue = false): void {
    setStatus(nextStatus);
    setExpectedOverdue(overdue);
    if (!overdue) setExceptionType('all');
    setPage(1);
  }

  function hydrateTaskForm(task: WarehouseMaterialTaskDTO): void {
    const nextForm = emptyExceptionForm(task);
    setForm(nextForm);
    setFormBaseline(nextForm);
  }

  async function openDrawer(task: WarehouseMaterialTaskDTO, trigger: HTMLElement): Promise<void> {
    triggerRef.current = trigger;
    setDrawerTask(task);
    hydrateTaskForm(task);
    setModalPanel('update');
    setFormError('');
    setDrawerLoading(true);
    try {
      const response = await fetch(`/api/warehouse/material-tasks/${task.id}`);
      const body = await response.json().catch(() => ({})) as { ok?: boolean; task?: WarehouseMaterialTaskDTO; error?: string };
      if (!response.ok || !body.task) throw new Error(body.error || '详情加载失败');
      setDrawerTask(body.task);
      hydrateTaskForm(body.task);
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : '详情加载失败');
    } finally {
      setDrawerLoading(false);
    }
  }

  function closeDrawer(): void {
    if (savingId) return;
    if (formDirty && !window.confirm('当前异常信息尚未保存，确认放弃本次修改并关闭吗？')) return;
    setDrawerTask(null);
    setFormError('');
    setModalPanel('update');
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }

  async function updateTask(task: WarehouseMaterialTaskDTO, body: Record<string, string>): Promise<WarehouseMaterialTaskDTO | null> {
    setSavingId(task.id);
    setFormError('');
    try {
      const response = await fetch(`/api/warehouse/material-tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, version: task.version }),
      });
      const result = await response.json().catch(() => ({})) as { ok?: boolean; task?: WarehouseMaterialTaskDTO; error?: string };
      if (response.status === 401) { location.href = '/login'; return null; }
      if (!response.ok || !result.task) throw new Error(result.error || '配料任务更新失败');
      const updatedTask = result.task;
      setDrawerTask(current => current?.id === updatedTask.id ? updatedTask : current);
      hydrateTaskForm(updatedTask);
      if (updatedTask.status !== 'exception') setModalPanel('update');
      setRefreshToken(value => value + 1);
      return updatedTask;
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : '配料任务更新失败';
      setFormError(message);
      setToast(message);
      return null;
    } finally {
      setSavingId('');
    }
  }

  async function markCompleted(task: WarehouseMaterialTaskDTO): Promise<void> {
    const updated = await updateTask(task, { action: 'complete' });
    if (updated) setToast('已完成配料');
  }

  async function saveException(task: WarehouseMaterialTaskDTO): Promise<void> {
    const updated = await updateTask(task, {
      action: task.status === 'exception' ? 'update_exception' : 'report_exception',
      exceptionType: form.exceptionType,
      exceptionNote: form.exceptionNote,
    });
    if (updated) {
      setToast(task.status === 'exception'
        ? '仓库异常与物料跟进已同步更新'
        : '仓库异常已进入物料跟进中心');
    }
  }

  async function resolveException(task: WarehouseMaterialTaskDTO, resolution: 'pending' | 'completed'): Promise<void> {
    const updated = await updateTask(task, { action: 'resolve', resolution, note: form.resolutionNote });
    if (updated) setToast(resolution === 'completed' ? '异常已解决并完成配料' : '异常已解决，任务回到待配料');
  }

  async function reopenTask(task: WarehouseMaterialTaskDTO): Promise<void> {
    const updated = await updateTask(task, { action: 'reopen', note: form.reopenNote });
    if (updated) setToast('已取消配料完成状态');
  }

  async function logout(): Promise<void> {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    location.href = '/login';
  }

  return <>
    <main ref={mainRef} className="warehouse-workbench hm-workbench-root">
      <AppWorkbenchHeader
        user={user}
        activeHref="/workspace/warehouse"
        subtitle="本周物料准备与异常闭环"
        hideHeader
        sidebarTriggerTargetId="warehouse-sidebar-trigger"
        menuItems={[{ label: '系统设置', href: '/dashboard?openSettings=1' }, { label: '退出登录', onSelect: () => { void logout(); } }]}
      />
      <div className="warehouse-page-frame">
        <section className="warehouse-summary" aria-label="仓库配料统计">
          <button className={status === 'all' && !expectedOverdue ? 'active total' : 'total'} type="button" onClick={() => chooseSummary('all')}><Warehouse aria-hidden="true" /><span>{scope === 'current' ? '本周配料任务' : scope === 'preparation' ? '下周预备任务' : '历史配料任务'}<small>{scope === 'current' ? '当前生产周全部产品' : scope === 'preparation' ? '提前配料，不进入生产执行' : '当前历史筛选范围'}</small></span><strong>{summary.total}</strong></button>
          <button className={status === 'pending' ? 'active pending' : 'pending'} type="button" onClick={() => chooseSummary('pending')}><Clock3 aria-hidden="true" /><span>待配料<small>等待仓库处理</small></span><strong>{summary.pending}</strong></button>
          <button className={status === 'completed' ? 'active completed' : 'completed'} type="button" onClick={() => chooseSummary('completed')}><PackageCheck aria-hidden="true" /><span>已配料<small>仓库已确认完成</small></span><strong>{summary.completed}</strong></button>
          <button className={status === 'exception' && !expectedOverdue ? 'active exception' : 'exception'} type="button" onClick={() => chooseSummary('exception')}><AlertTriangle aria-hidden="true" /><span>仓库异常<small>缺料、料错等</small></span><strong>{summary.exception}</strong></button>
          <button className={expectedOverdue ? 'active overdue' : 'overdue'} type="button" onClick={() => chooseSummary('exception', true)}><Truck aria-hidden="true" /><span>到料逾期<small>预计时间已超过</small></span><strong>{summary.expectedOverdue}</strong></button>
        </section>

        <section className="warehouse-toolbar" aria-label="仓库任务筛选">
          <div id="warehouse-sidebar-trigger" className="warehouse-inline-sidebar-trigger" />
          <div className="warehouse-scope-tabs" role="tablist" aria-label="生产周范围">
            <button className={scope === 'current' ? 'active' : ''} type="button" role="tab" aria-selected={scope === 'current'} onClick={() => { setScope('current'); setSelectedWeek(''); setPage(1); }}>当前周</button>
            <button className={scope === 'preparation' ? 'active' : ''} type="button" role="tab" aria-selected={scope === 'preparation'} onClick={() => { setScope('preparation'); setSelectedWeek(''); setPage(1); }}>下周预备</button>
            <button className={scope === 'history' ? 'active' : ''} type="button" role="tab" aria-selected={scope === 'history'} onClick={() => { setScope('history'); setSelectedWeek(''); setPage(1); }}>历史周</button>
          </div>
          {(scope === 'history' || scope === 'preparation') && <label className="warehouse-week-select"><span>生产周</span><select value={selectedWeek} onChange={event => { setSelectedWeek(event.target.value); setPage(1); }}><option value="">{scope === 'preparation' ? '下周预备' : '全部历史周'}</option>{payload?.weeks.map(week => <option value={week.weekStartDate} key={week.weekStartDate}>{rangeText(week)} · {week.taskCount} 单</option>)}</select></label>}
          <label className="warehouse-search"><Search size={17} aria-hidden="true" /><input value={keyword} onChange={event => setKeyword(event.target.value)} placeholder="搜索客户、规格、品名或工单号" /></label>
          <label className="warehouse-exception-select"><span>异常类型</span><select value={exceptionType} onChange={event => { setExceptionType(event.target.value as 'all' | WarehouseExceptionType); setPage(1); }}><option value="all">全部异常</option>{exceptionOptions.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
          <button className="warehouse-reset" type="button" title="重置筛选" aria-label="重置筛选" onClick={resetFilters}><RotateCcw size={15} aria-hidden="true" />重置</button>
          <div className="warehouse-toolbar-actions" aria-label="仓库管理操作">
            <a className="hm-workbench-button" href="/workspace/procurement" title="打开物料异常跟进"><ClipboardList size={15} aria-hidden="true" /><span>物料跟进</span></a>
            <a className="hm-workbench-button" href="/weekly-plan-center" title="打开计划中心"><CalendarDays size={15} aria-hidden="true" /><span>计划中心</span></a>
            <button className="hm-workbench-button" type="button" title="刷新仓库任务" disabled={loading} onClick={() => setRefreshToken(value => value + 1)}><RefreshCw size={15} className={loading ? 'spin' : ''} aria-hidden="true" /><span>刷新</span></button>
          </div>
        </section>

        {error && <div className="warehouse-error" role="alert"><span><strong>加载失败</strong>{error}</span><button type="button" onClick={() => setRefreshToken(value => value + 1)}>重新加载</button></div>}

        <section className="warehouse-control-grid" aria-label="仓库配料控制台">
          <aside className="warehouse-queue-panel" aria-labelledby="warehouse-task-heading">
            <header>
              <div><span>{scope === 'current' ? '当前生产周' : scope === 'preparation' ? `下周预备 · ${rangeText(selectedWeekOption)}` : rangeText(selectedWeekOption)}</span><h2 id="warehouse-task-heading">配料任务队列</h2></div>
              <em>{payload?.pagination.total || 0}</em>
            </header>
            <div className="warehouse-queue-list hm-scroll-region" tabIndex={0} aria-label="仓库配料任务列表">
              {visibleTasks.map(task => <button
                className={`warehouse-queue-card ${task.status} ${task.isExpectedOverdue ? 'expected-overdue' : ''} ${selectedTask?.id === task.id ? 'selected' : ''}`}
                type="button"
                aria-pressed={selectedTask?.id === task.id}
                onClick={() => setSelectedTaskId(task.id)}
                key={task.id}
              >
                <span className="warehouse-queue-icon"><Box aria-hidden="true" /></span>
                <span className="warehouse-queue-copy">
                  <span><b>{task.workOrder.customerName || '客户未设置'}</b><em className={task.status}>{task.isExpectedOverdue ? '逾期' : task.statusText}</em></span>
                  <strong title={task.workOrder.specification || task.workOrder.code}>{task.workOrder.specification || task.workOrder.code}</strong>
                  <small title={task.workOrder.productName}>{task.workOrder.productName}</small>
                  <span className="warehouse-queue-meta"><i>{quantityText(task)} 套</i><i>{task.workOrder.deliveryDay || dateText(task.workOrder.plannedAt)}</i></span>
                </span>
                <ChevronRight aria-hidden="true" />
              </button>)}
              {loading && <div className="warehouse-loading"><RefreshCw className="spin" aria-hidden="true" /><span>正在同步任务流...</span></div>}
              {!loading && !visibleTasks.length && <div className="warehouse-empty"><PackageCheck aria-hidden="true" /><strong>当前筛选没有配料任务</strong><span>{scope === 'current' ? '下达本周计划后，系统会自动生成待配料任务。' : scope === 'preparation' ? '从计划中心下达“下周预备”后，任务会在这里提前出现。' : '请选择其他历史生产周或清除筛选条件。'}</span></div>}
            </div>
            {payload && payload.pagination.totalPages > 1 && <footer className="warehouse-pagination"><button type="button" disabled={payload.pagination.page <= 1} onClick={() => setPage(value => Math.max(1, value - 1))}>上一批</button><b>{payload.pagination.page} / {payload.pagination.totalPages}</b><button type="button" disabled={payload.pagination.page >= payload.pagination.totalPages} onClick={() => setPage(value => value + 1)}>下一批</button></footer>}
          </aside>

          <section className="warehouse-flow-workspace" aria-labelledby="warehouse-flow-title">
            {selectedTask ? <>
              <header className="warehouse-focus-header">
                <div className="warehouse-focus-heading">
                  <span><CircleDot aria-hidden="true" /> 当前配料任务</span>
                  <h2 id="warehouse-flow-title">{selectedTask.workOrder.specification || selectedTask.workOrder.code}</h2>
                  <small>{selectedTask.workOrder.customerName || '客户未设置'} · {selectedTask.workOrder.productName}</small>
                </div>
                <div className="warehouse-focus-status">
                  <span className={selectedTask.status}>{selectedTask.statusText}</span>
                  <small>更新 {dateTimeText(selectedTask.updatedAt)}</small>
                </div>
              </header>

              <section className={`warehouse-flow-scene ${selectedTask.status}`} aria-label={`${selectedTask.statusText}动态配料流程`}>
                <div className="warehouse-scene-glow" aria-hidden="true" />
                <div className="warehouse-scene-particles" aria-hidden="true">
                  {warehouseFlowParticles.map(particle => <i key={particle} />)}
                </div>
                <header>
                  <div><span>动态作业流</span><h3>仓库物料流转</h3></div>
                  <div className="warehouse-scene-live"><i /><span>{loading ? '正在同步' : '实时连接'}</span></div>
                </header>

                <div
                  className="warehouse-flow-track"
                  style={{ '--warehouse-flow-progress': `${selectedFlowProgress}%` } as CSSProperties}
                >
                  <div className="warehouse-flow-rail" aria-hidden="true">
                    <span />
                    <div className="warehouse-rail-particles">
                      {warehouseFlowParticles.slice(0, 8).map(particle => <i key={particle} />)}
                    </div>
                  </div>
                  <ol>
                    {warehouseFlowStages.map((stage, index) => {
                      const stageState = index < selectedFlowIndex ? 'completed' : index === selectedFlowIndex ? 'current' : 'waiting';
                      const StageIcon = stage.icon;
                      return <li className={stageState} key={stage.label}>
                        <span className="warehouse-stage-order">0{index + 1}</span>
                        <span className="warehouse-flow-node">{stageState === 'completed' ? <CheckCircle2 aria-hidden="true" /> : <StageIcon aria-hidden="true" />}</span>
                        <span className="warehouse-stage-copy">
                          <strong>{stage.label}</strong>
                          <small>{stageState === 'completed' ? '已通过' : stageState === 'current' ? selectedTask.statusText : stage.hint}</small>
                        </span>
                        <i className="warehouse-stage-signal" aria-hidden="true" />
                      </li>;
                    })}
                  </ol>
                </div>

                <div className="warehouse-material-rail" aria-label="任务实时信息">
                  <article><span><Layers3 aria-hidden="true" /> 计划数量</span><strong>{quantityText(selectedTask)} 套</strong><small>计划下达数量</small></article>
                  <article><span><CalendarDays aria-hidden="true" /> 计划交期</span><strong>{selectedTask.workOrder.deliveryDay || dateText(selectedTask.workOrder.plannedAt)}</strong><small>{selectedTask.isExpectedOverdue ? '当前存在到料逾期' : '按计划准备'}</small></article>
                  <article><span><ShieldCheck aria-hidden="true" /> 仓库状态</span><strong>{selectedTask.statusText}</strong><small>{selectedTask.exceptionTypeText || '物料状态正常'}</small></article>
                </div>
              </section>

              <section className="warehouse-focus-facts" aria-label="当前任务信息">
                <article><span>内部编号</span><strong>{selectedTask.workOrder.code}</strong></article>
                <article><span>生产周</span><strong>{selectedTask.workOrder.weekStartDate ? `${dateText(selectedTask.workOrder.weekStartDate)} - ${dateText(selectedTask.workOrder.weekEndDate)}` : '未指定'}</strong></article>
                <article><span>配料状态</span><strong className={selectedTask.status}>{selectedTask.statusText}</strong></article>
                <article><span>预计到料/解决</span><strong>{selectedTask.followUpTask?.expectedAt ? dateText(selectedTask.followUpTask.expectedAt) : selectedTask.expectedAt ? dateText(selectedTask.expectedAt) : '—'}</strong></article>
              </section>

              {selectedTask.status === 'exception' && <section className="warehouse-focus-alert">
                <AlertTriangle aria-hidden="true" />
                <div><strong>{selectedTask.exceptionTypeText || '仓库异常'}</strong><span>{selectedTask.exceptionNote || '等待补充异常说明'}</span></div>
                {selectedTask.followUpTask && <a href={`/workspace/procurement?taskId=${encodeURIComponent(selectedTask.followUpTask.id)}`}>打开跟进<ArrowUpRight aria-hidden="true" /></a>}
              </section>}

              <footer className="warehouse-action-dock">
                <div><Activity aria-hidden="true" /><span><strong>任务操作</strong><small>所有操作沿用当前仓库处理规则</small></span></div>
                <div>
                  <button type="button" disabled={savingId === selectedTask.id} onClick={event => { void openDrawer(selectedTask, event.currentTarget); }}>{selectedTask.status === 'exception' ? '处理异常' : selectedTask.status === 'completed' ? '查看记录' : '报告异常'}</button>
                  {selectedTask.status === 'pending' && <button className="primary" type="button" disabled={savingId === selectedTask.id} onClick={() => { void markCompleted(selectedTask); }}><PackageCheck aria-hidden="true" />{savingId === selectedTask.id ? '保存中...' : '确认已配料'}</button>}
                </div>
              </footer>
            </> : <div className="warehouse-flow-idle">
              <header>
                <span><CircleDot aria-hidden="true" /> 仓库作业台</span>
                <h2 id="warehouse-flow-title">{loading ? '正在同步本周任务' : scope === 'current' ? '本周尚未下达配料任务' : '当前范围暂无配料任务'}</h2>
                <small>{scope === 'current' ? '计划中心启用本周生产后，配料任务会自动进入这里；历史任务仍可在“历史周”查看。' : '切换生产周或调整筛选条件后继续查看。'}</small>
              </header>
              <section className="warehouse-idle-scene" aria-label="仓库物料流转待命状态">
                <div className="warehouse-scene-glow" aria-hidden="true" />
                <div className="warehouse-scene-particles" aria-hidden="true">
                  {warehouseFlowParticles.map(particle => <i key={particle} />)}
                </div>
                <div className="warehouse-idle-rail" aria-hidden="true"><span /></div>
                <ol>
                  {warehouseFlowStages.map((stage, index) => {
                    const StageIcon = stage.icon;
                    return <li key={stage.label}>
                      <span className="warehouse-stage-order">0{index + 1}</span>
                      <span className="warehouse-flow-node"><StageIcon aria-hidden="true" /></span>
                      <span className="warehouse-stage-copy"><strong>{stage.label}</strong><small>等待任务</small></span>
                    </li>;
                  })}
                </ol>
              </section>
              <footer>
                <span><Radio aria-hidden="true" /> 数据通道正常，当前生产周为独立范围</span>
                <a href="/weekly-plan-center">进入计划中心<ArrowUpRight aria-hidden="true" /></a>
              </footer>
            </div>}
          </section>

          <aside className="warehouse-collaboration" aria-label="仓库实时协同">
            <header><div><span><Radio aria-hidden="true" /> 实时协同</span><h2>仓库协同台</h2></div><i className={loading ? 'syncing' : ''} title={loading ? '正在同步' : '数据已同步'} /></header>

            <section className="warehouse-collab-section exceptions">
              <div className="warehouse-collab-heading"><span><AlertTriangle aria-hidden="true" /><strong>待处理异常</strong></span><em>{summary.exception}</em></div>
              <div className="warehouse-collab-list">
                {exceptionTasks.map(task => <button type="button" key={task.id} onClick={event => { void openDrawer(task, event.currentTarget); }}>
                  <span><b>{task.exceptionTypeText || '仓库异常'}</b><small>{task.workOrder.specification || task.workOrder.code}</small></span>
                  <em className={task.isExpectedOverdue ? 'danger' : ''}>{task.isExpectedOverdue ? '逾期' : task.expectedAt ? dateText(task.expectedAt) : '待处理'}</em>
                </button>)}
                {!exceptionTasks.length && <p><CheckCircle2 aria-hidden="true" /> 当前没有待处理异常</p>}
              </div>
            </section>

            <section className="warehouse-collab-section follow-ups">
              <div className="warehouse-collab-heading"><span><ClipboardList aria-hidden="true" /><strong>物料跟进</strong></span><a href="/workspace/procurement">查看全部</a></div>
              <div className="warehouse-collab-list">
                {followUpTasks.map(task => <a href={`/workspace/procurement?taskId=${encodeURIComponent(task.followUpTask!.id)}`} key={task.id}>
                  <span><b>{task.workOrder.specification || task.workOrder.code}</b><small>{task.followUpTask?.latestProgress || task.exceptionNote || '等待更新进度'}</small></span>
                  <em>{task.followUpTask?.statusText}</em>
                </a>)}
                {!followUpTasks.length && <p>当前筛选没有物料跟进任务</p>}
              </div>
            </section>

            <section className="warehouse-collab-section load">
              <div className="warehouse-collab-heading"><span><Gauge aria-hidden="true" /><strong>任务负载</strong></span><em>{summary.total}</em></div>
              <div className="warehouse-load-bars">
                <span><i>待配料</i><b><em style={{ width: `${summary.total ? Math.round((summary.pending / summary.total) * 100) : 0}%` }} /></b><strong>{summary.pending}</strong></span>
                <span><i>已配料</i><b><em style={{ width: `${summary.total ? Math.round((summary.completed / summary.total) * 100) : 0}%` }} /></b><strong>{summary.completed}</strong></span>
                <span><i>异常</i><b><em style={{ width: `${summary.total ? Math.round((summary.exception / summary.total) * 100) : 0}%` }} /></b><strong>{summary.exception}</strong></span>
              </div>
            </section>

            <section className="warehouse-collab-section timeline">
              <div className="warehouse-collab-heading"><span><Clock3 aria-hidden="true" /><strong>近期动态</strong></span></div>
              <div className="warehouse-mini-timeline">
                {recentTasks.map(task => <article key={task.id}><i className={task.status} /><div><strong>{task.workOrder.specification || task.workOrder.code}</strong><span>{task.statusText} · {dateTimeText(task.updatedAt)}</span></div></article>)}
                {!recentTasks.length && <p>暂无任务动态</p>}
              </div>
            </section>
          </aside>
        </section>
      </div>
    </main>

    {drawerTask && <>
      <button className="warehouse-modal-scrim" type="button" aria-label="关闭仓库任务详情" onClick={closeDrawer} />
      <aside ref={drawerRef} className="warehouse-task-modal" role="dialog" aria-modal="true" aria-labelledby="warehouse-modal-title">
        <header className="warehouse-modal-header">
          <div className="warehouse-modal-title">
            <span>{drawerTask.workOrder.customerName || '客户未设置'}</span>
            <div><h2 id="warehouse-modal-title" title={drawerTask.workOrder.specification || drawerTask.workOrder.code}>{drawerTask.workOrder.specification || drawerTask.workOrder.code}</h2><em className={drawerTask.status}>{drawerTask.statusText}</em></div>
            <small>{drawerTask.workOrder.productName} · {drawerTask.workOrder.code}</small>
          </div>
          <button className="warehouse-modal-close" type="button" aria-label="关闭仓库任务详情" title="关闭" disabled={savingId === drawerTask.id} onClick={closeDrawer}><X aria-hidden="true" /></button>
        </header>

        <div className="warehouse-modal-body">
          <div className="warehouse-modal-main hm-scroll-region">
            {drawerTask.status === 'exception' && <div className="warehouse-modal-switch" role="tablist" aria-label="异常处理方式">
              <button className={modalPanel === 'update' ? 'active' : ''} type="button" role="tab" aria-selected={modalPanel === 'update'} onClick={() => { setModalPanel('update'); setFormError(''); }}><AlertTriangle aria-hidden="true" />更新异常</button>
              <button className={modalPanel === 'resolve' ? 'active' : ''} type="button" role="tab" aria-selected={modalPanel === 'resolve'} onClick={() => { setModalPanel('resolve'); setFormError(''); }}><CheckCircle2 aria-hidden="true" />解决异常</button>
            </div>}

            {drawerTask.status !== 'completed' && modalPanel === 'update' && <section className="warehouse-modal-form">
              <div className="warehouse-modal-section-heading"><span className="warehouse-modal-icon warning"><AlertTriangle aria-hidden="true" /></span><span><strong>{drawerTask.status === 'exception' ? '更新仓库异常' : '登记仓库异常'}</strong><small>所有仓库异常都会同步生成独立的物料跟进事件。</small></span></div>
              <fieldset disabled={savingId === drawerTask.id}>
                <legend>异常类型</legend>
                <div className="warehouse-exception-types">
                  {exceptionOptions.map(item => <button className={form.exceptionType === item.value ? 'active' : ''} type="button" aria-pressed={form.exceptionType === item.value} key={item.value} onClick={() => setForm(current => ({ ...current, exceptionType: item.value }))}>{item.label}</button>)}
                </div>
              </fieldset>
              <label className="warehouse-modal-field"><span>异常说明 <b>必填</b><em>{form.exceptionNote.length}/400</em></span><textarea rows={5} maxLength={400} value={form.exceptionNote} disabled={savingId === drawerTask.id} onChange={event => setForm(current => ({ ...current, exceptionNote: event.target.value }))} placeholder="请说明缺少的物料、数量、已采取的措施或核对依据" /></label>
              <div className="warehouse-date-panel">
                <div className="warehouse-modal-field-heading"><span><CalendarDays aria-hidden="true" />采购预计到料时间 <b>由采购维护</b></span><small>仓库只登记异常；采购在物料跟进中标注预计到料，时间会自动同步回这里。</small></div>
                <input type="date" value={form.expectedAt} disabled aria-label="采购预计到料时间（只读）" />
              </div>
            </section>}

            {drawerTask.status === 'exception' && modalPanel === 'resolve' && <section className="warehouse-modal-form resolved">
              <div className="warehouse-modal-section-heading"><span className="warehouse-modal-icon success"><CheckCircle2 aria-hidden="true" /></span><span><strong>确认异常已经解决</strong><small>处理记录会永久保留，当前异常标记将在提交后清除。</small></span></div>
              <label className="warehouse-modal-field"><span>解决说明 <b>必填</b><em>{form.resolutionNote.length}/300</em></span><textarea rows={7} maxLength={300} value={form.resolutionNote} disabled={savingId === drawerTask.id} onChange={event => setForm(current => ({ ...current, resolutionNote: event.target.value }))} placeholder="例如：物料已于今日到仓，型号与数量复核无误" /></label>
              <div className="warehouse-resolution-guide"><ShieldCheck aria-hidden="true" /><span><strong>提交前请完成复核</strong><small>“继续配料”会回到待配料；“完成配料”会直接标记为已配料。</small></span></div>
            </section>}

            {drawerTask.status === 'completed' && <section className="warehouse-modal-form reopen">
              <div className="warehouse-modal-section-heading"><span className="warehouse-modal-icon danger"><RotateCcw aria-hidden="true" /></span><span><strong>取消已配料</strong><small>仅在误操作或物料复核不通过时使用，历史完成记录不会被删除。</small></span></div>
              <label className="warehouse-modal-field"><span>取消原因 <b>必填</b><em>{form.reopenNote.length}/300</em></span><textarea rows={7} maxLength={300} value={form.reopenNote} disabled={savingId === drawerTask.id} onChange={event => setForm(current => ({ ...current, reopenNote: event.target.value }))} placeholder="例如：复核发现端子型号不符，退回待配料" /></label>
            </section>}

            {formError && <div className="warehouse-form-error" role="alert"><AlertTriangle aria-hidden="true" />{formError}</div>}
          </div>

          <aside className="warehouse-modal-side hm-scroll-region">
            <section className="warehouse-modal-summary">
              <div><span>当前状态</span><strong className={drawerTask.status}>{drawerTask.statusText}</strong></div>
              <div><span>计划数量</span><strong>{quantityText(drawerTask)}</strong></div>
              <div><span>计划交期</span><strong>{drawerTask.workOrder.deliveryDay || dateText(drawerTask.workOrder.plannedAt)}</strong></div>
              <div><span>内部编号</span><strong title={drawerTask.workOrder.code}>{drawerTask.workOrder.code}</strong></div>
            </section>

            <section className={`warehouse-impact-card ${isArrivalException(form.exceptionType) ? 'linked' : ''}`}>
              <div><span className="warehouse-modal-icon"><Activity aria-hidden="true" /></span><span><strong>异常同步影响</strong><small>生产执行 + 物料跟进</small></span></div>
              <p>登记后自动创建独立物料跟进事件；采购维护预计到料，仓库确认解决后进入已解决名单。</p>
            </section>

            {drawerTask.followUpTask && <section className="warehouse-follow-up-card"><div><ClipboardList aria-hidden="true" /><span><strong>物料异常正在跟进</strong><small>{drawerTask.followUpTask.owner?.displayName || drawerTask.followUpTask.owner?.username || '等待负责人接收'} · {drawerTask.followUpTask.statusText}</small></span></div><p>{drawerTask.followUpTask.latestProgress || drawerTask.exceptionNote || '等待跟进进度'}</p><span className="warehouse-follow-up-date"><Truck aria-hidden="true" />{drawerTask.followUpTask.expectedAt ? `采购预计 ${dateText(drawerTask.followUpTask.expectedAt)} 到料` : '等待采购标注预计到料'}</span><a href={`/workspace/procurement?taskId=${encodeURIComponent(drawerTask.followUpTask.id)}`}>打开跟进任务<ArrowUpRight size={14} /></a></section>}

            {drawerTask.lastResolvedException && <section className="warehouse-follow-up-card resolved"><div><CheckCircle2 aria-hidden="true" /><span><strong>最近异常已解决</strong><small>{dateTimeText(drawerTask.lastResolvedException.resolvedAt)} · {drawerTask.lastResolvedException.resolvedBy?.displayName || drawerTask.lastResolvedException.resolvedBy?.username || '仓库确认'}</small></span></div><p>{drawerTask.lastResolvedException.resolutionNote || drawerTask.lastResolvedException.exceptionNote}</p></section>}

            <section className="warehouse-activity-section"><div className="warehouse-modal-section-heading"><span className="warehouse-modal-icon"><Clock3 aria-hidden="true" /></span><span><strong>处理记录</strong><small>最近 40 条仓库操作</small></span></div>{drawerLoading && <div className="warehouse-loading">正在加载处理记录...</div>}<div className="warehouse-activity-list">{drawerTask.activities?.map(activity => <article key={activity.id}><i /><div><strong>{activity.content || activity.action}</strong><span>{activity.actor?.displayName || activity.actor?.username || '系统'} · {dateTimeText(activity.createdAt)}</span></div></article>)}{!drawerLoading && !drawerTask.activities?.length && <p>暂无人工处理记录</p>}</div></section>
          </aside>
        </div>

        <footer className="warehouse-modal-footer">
          <span>{savingId === drawerTask.id ? <><RefreshCw className="spin" aria-hidden="true" />正在保存，请稍候...</> : formDirty ? '当前有尚未保存的修改' : drawerTask.status === 'completed' ? '该任务已经完成配料' : '请核对信息后提交'}</span>
          <div>
            <button className="warehouse-modal-secondary" type="button" disabled={savingId === drawerTask.id} onClick={closeDrawer}>关闭</button>
            {drawerTask.status === 'pending' && <button className="warehouse-modal-success" type="button" disabled={savingId === drawerTask.id} onClick={() => { void markCompleted(drawerTask); }}><PackageCheck aria-hidden="true" />物料已配齐</button>}
            {drawerTask.status !== 'completed' && modalPanel === 'update' && <button className="warehouse-modal-primary" type="button" disabled={savingId === drawerTask.id || !form.exceptionNote.trim()} onClick={() => { void saveException(drawerTask); }}><AlertTriangle aria-hidden="true" />{savingId === drawerTask.id ? '保存中...' : drawerTask.status === 'exception' ? '保存异常更新' : '登记仓库异常'}</button>}
            {drawerTask.status === 'exception' && modalPanel === 'resolve' && <><button className="warehouse-modal-secondary" type="button" disabled={savingId === drawerTask.id || !form.resolutionNote.trim()} onClick={() => { void resolveException(drawerTask, 'pending'); }}>解决后继续配料</button><button className="warehouse-modal-primary" type="button" disabled={savingId === drawerTask.id || !form.resolutionNote.trim()} onClick={() => { void resolveException(drawerTask, 'completed'); }}><CheckCircle2 aria-hidden="true" />解决并完成配料</button></>}
            {drawerTask.status === 'completed' && <button className="warehouse-modal-danger" type="button" disabled={savingId === drawerTask.id || !form.reopenNote.trim()} onClick={() => { void reopenTask(drawerTask); }}><RotateCcw aria-hidden="true" />确认取消已配料</button>}
          </div>
        </footer>
      </aside>
    </>}

  </>;
}
