'use client';

import {
  AlertTriangle,
  ArrowLeft,
  ArrowUpDown,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CircleDot,
  Clock3,
  Filter,
  LoaderCircle,
  RefreshCw,
  Search,
  Trash2,
  UserRoundPlus,
  UsersRound,
  Workflow,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppWorkbenchHeader } from '@/components/layout/AppWorkbenchHeader';
import { chinaDateKey } from '@/lib/china-date';
import type { CurrentUserDTO } from '@/types';

type WeeklyProcessState = 'READY' | 'REVIEW' | 'WAITING' | 'BLOCKED' | 'PARTIAL' | 'PLANNED' | 'COMPLETED';
type WeeklyCompletionState = 'NOT_STARTED' | 'IN_PROGRESS' | 'PENDING_COVERAGE' | 'COMPLETED';
type WeeklyDueTone = 'OVERDUE' | 'TODAY' | 'SOON' | 'NORMAL' | 'COMPLETED';
type WeeklyCompletionFilter = 'ALL' | 'INCOMPLETE' | 'COMPLETED';
type WeeklySort = 'DUE_ASC' | 'REMAINING_LABOR_DESC' | 'REMAINING_LABOR_ASC' | 'TOTAL_LABOR_DESC' | 'ROUTE_ASC';

type EmployeeOption = {
  id: string;
  employeeNo: string;
  name: string;
  department: string | null;
  position: string | null;
  team: string | null;
  attendanceEnabled: boolean;
};

type WorkerPreset = {
  id: string;
  weekStartDate: string;
  scope: 'PROCESS' | 'STEP';
  scopeKey: string;
  processKey: string;
  processDefinitionId: string | null;
  stepId: string | null;
  version: number;
  employees: Array<EmployeeOption & { isActive: boolean; priority: number }>;
  updatedAt: string;
};

type WeeklyProcessItem = {
  id: string;
  productionPlanBatchId: string;
  workOrderCode: string;
  customerName: string;
  productName: string;
  specification: string;
  dueDate: string;
  batchQuantity: number;
  stepId: string | null;
  processDefinitionId: string | null;
  processKey: string;
  processCode: string;
  processName: string;
  stageGroup: string;
  position: number;
  processedQuantity: number;
  reportedQuantity: number;
  pendingCoverageQuantity: number;
  allocatedQuantity: number;
  remainingQuantity: number;
  plannedMinutes: number;
  completionState: WeeklyCompletionState;
  completionLabel: string;
  dueTone: WeeklyDueTone;
  totalLaborMilliseconds: string;
  completedLaborMilliseconds: string;
  remainingLaborMilliseconds: string;
  pendingLaborMilliseconds: string;
  unallocatedLaborMilliseconds: string;
  state: WeeklyProcessState;
  stateLabel: string;
  hardBlocked: boolean;
  warnings: string[];
  eligibleTeams: Array<{ id: string; name: string }>;
  workerPresetScope: 'PROCESS' | 'STEP' | null;
  workerPresetVersion: number | null;
  preferredEmployees: Array<{
    id: string;
    employeeNo: string;
    name: string;
    team: string | null;
    position: string | null;
  }>;
  inactivePreferenceCount: number;
};

type WeeklyProcessData = {
  generatedAt: string;
  weekStartDate: string;
  weekEndDate: string;
  summary: {
    total: number;
    ready: number;
    planned: number;
    blocked: number;
    completed: number;
    incomplete: number;
    pendingCoverage: number;
    unassignedOwnership: number;
  };
  filteredSummary: {
    processes: number;
    affectedOrders: number;
    completed: number;
    incomplete: number;
    pendingCoverage: number;
    totalLaborMilliseconds: string;
    completedLaborMilliseconds: string;
    remainingLaborMilliseconds: string;
    pendingLaborMilliseconds: string;
    unallocatedLaborMilliseconds: string;
  };
  processOptions: Array<{
    key: string;
    processDefinitionId: string | null;
    name: string;
    total: number;
    completed: number;
    incomplete: number;
    affectedOrders: number;
    remainingLaborMilliseconds: string;
    preferredEmployeeCount: number;
  }>;
  teamOptions: Array<{ id: string; name: string; capabilityCount: number }>;
  employeeOptions: EmployeeOption[];
  presets: WorkerPreset[];
  completionFacets: {
    total: number;
    incomplete: number;
    completed: number;
  };
  filteredCount: number;
  items: WeeklyProcessItem[];
};

type PresetTarget = {
  processKey: string;
  processName: string;
  stepId: string | null;
  label: string;
};

const stateOptions: Array<{ value: string; label: string }> = [
  { value: 'ALL', label: '全部执行条件' },
  { value: 'READY', label: '可安排' },
  { value: 'REVIEW', label: '开工前确认' },
  { value: 'WAITING', label: '等待上道' },
  { value: 'PARTIAL', label: '部分安排' },
  { value: 'PLANNED', label: '已安排' },
  { value: 'BLOCKED', label: '待维护' },
];

const sortOptions: Array<{ value: WeeklySort; label: string }> = [
  { value: 'DUE_ASC', label: '交期最近优先' },
  { value: 'REMAINING_LABOR_DESC', label: '剩余工时从高到低' },
  { value: 'REMAINING_LABOR_ASC', label: '剩余工时从低到高' },
  { value: 'TOTAL_LABOR_DESC', label: '总工时从高到低' },
  { value: 'ROUTE_ASC', label: '工艺顺序' },
];

function dateKey(value = new Date()): string {
  return chinaDateKey(value) || value.toISOString().slice(0, 10);
}

function shiftDate(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function formatWeekDate(value: string): string {
  return `${Number(value.slice(5, 7))}月${Number(value.slice(8, 10))}日`;
}

function formatLabor(value: string, compact = false): string {
  try {
    const milliseconds = BigInt(value || '0');
    const minutes = Number((milliseconds + 30_000n) / 60_000n);
    if (minutes <= 0) return '0分钟';
    if (minutes < 60) return `${minutes}分钟`;
    const hours = minutes / 60;
    return compact ? `${hours.toFixed(hours >= 10 ? 0 : 1)}小时` : `${Math.floor(hours)}小时${minutes % 60 ? `${minutes % 60}分` : ''}`;
  } catch {
    return '待核对';
  }
}

function stageLabel(value: string): string {
  if (value === 'frontend') return '前段';
  if (value === 'backend') return '后段';
  return value || '工艺路线';
}

function friendlyOrderLabel(item: WeeklyProcessItem): string {
  return item.specification || item.productName || '产品信息待补充';
}

function presetScopeKey(target: PresetTarget): string {
  return target.stepId ? `step:${target.stepId}` : `process:${target.processKey}`;
}

async function readData(response: Response): Promise<WeeklyProcessData> {
  const body = await response.json() as { ok?: boolean; data?: WeeklyProcessData; error?: string };
  if (response.status === 401) {
    window.location.href = `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
    throw new Error('登录状态已失效，请重新登录');
  }
  if (!response.ok || !body.data) throw new Error(body.error || '周工序总览加载失败');
  return body.data;
}

export default function WeeklyProcessOverview({ user }: { user: CurrentUserDTO }) {
  const canManagePresets = user.canAccessDailyPlans
    && (user.access.capabilities.includes('PRODUCTION:UPDATE')
      || user.access.capabilities.includes('PLANNING:UPDATE'));
  const [weekDate, setWeekDate] = useState(dateKey());
  const [teamId, setTeamId] = useState('');
  const [state, setState] = useState('ALL');
  const [completion, setCompletion] = useState<WeeklyCompletionFilter>('ALL');
  const [processKey, setProcessKey] = useState('');
  const [sort, setSort] = useState<WeeklySort>('DUE_ASC');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [data, setData] = useState<WeeklyProcessData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshToken, setRefreshToken] = useState(0);
  const [notice, setNotice] = useState('');
  const [presetTarget, setPresetTarget] = useState<PresetTarget | null>(null);
  const [presetEmployeeIds, setPresetEmployeeIds] = useState<string[]>([]);
  const [presetSearch, setPresetSearch] = useState('');
  const [presetSaving, setPresetSaving] = useState(false);
  const [presetError, setPresetError] = useState('');

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(searchInput.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({ date: weekDate, state, completion, sort });
    if (teamId) query.set('teamId', teamId);
    if (processKey) query.set('processKey', processKey);
    if (search) query.set('search', search);
    setLoading(true);
    setError('');
    void fetch(`/api/weekly-processes?${query.toString()}`, { cache: 'no-store', credentials: 'same-origin', signal: controller.signal })
      .then(readData)
      .then(result => setData(result))
      .catch(reason => {
        if (reason instanceof DOMException && reason.name === 'AbortError') return;
        setError(reason instanceof Error ? reason.message : '周工序总览加载失败');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [completion, processKey, refreshToken, search, sort, state, teamId, weekDate]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 2600);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (!presetTarget) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !presetSaving) setPresetTarget(null);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [presetSaving, presetTarget]);

  const weekLabel = data ? `${formatWeekDate(data.weekStartDate)}—${formatWeekDate(data.weekEndDate)}` : '正在计算本周范围';
  const currentWeek = useMemo(() => dateKey(), []);
  const selectedProcess = data?.processOptions.find(option => option.key === processKey) || null;
  const currentPreset = presetTarget && data
    ? data.presets.find(preset => preset.scopeKey === presetScopeKey(presetTarget)) || null
    : null;
  const filteredPresetEmployees = (data?.employeeOptions || []).filter(employee => {
    const keyword = presetSearch.trim().toLocaleLowerCase('zh-CN');
    return !keyword || `${employee.name} ${employee.employeeNo} ${employee.team || ''} ${employee.position || ''}`
      .toLocaleLowerCase('zh-CN')
      .includes(keyword);
  });
  const selectedPresetEmployees = presetEmployeeIds
    .map(id => data?.employeeOptions.find(employee => employee.id === id))
    .filter((employee): employee is EmployeeOption => !!employee);

  const resetFilters = useCallback(() => {
    setTeamId('');
    setState('ALL');
    setCompletion('ALL');
    setProcessKey('');
    setSort('DUE_ASC');
    setSearchInput('');
    setSearch('');
  }, []);

  function openPreset(target: PresetTarget): void {
    if (!canManagePresets) return;
    const preset = data?.presets.find(item => item.scopeKey === presetScopeKey(target));
    setPresetTarget(target);
    setPresetEmployeeIds(preset?.employees.filter(employee => employee.isActive).map(employee => employee.id) || []);
    setPresetSearch('');
    setPresetError('');
  }

  function movePresetEmployee(employeeId: string, delta: number): void {
    const index = presetEmployeeIds.indexOf(employeeId);
    const nextIndex = index + delta;
    if (index < 0 || nextIndex < 0 || nextIndex >= presetEmployeeIds.length) return;
    const next = [...presetEmployeeIds];
    [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
    setPresetEmployeeIds(next);
  }

  async function savePreset(employeeIds = presetEmployeeIds): Promise<void> {
    if (!presetTarget || presetSaving) return;
    setPresetSaving(true);
    setPresetError('');
    try {
      const response = await fetch('/api/weekly-processes/worker-presets', {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          weekDate: data?.weekStartDate || weekDate,
          processKey: presetTarget.processKey,
          stepId: presetTarget.stepId,
          employeeIds,
          ...(currentPreset ? { expectedVersion: currentPreset.version } : {}),
        }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error || '预选人员保存失败');
      setPresetTarget(null);
      setRefreshToken(value => value + 1);
      setNotice(employeeIds.length ? '预选人员已同步到后续生产报工' : '本周预选人员已清空');
    } catch (reason) {
      setPresetError(reason instanceof Error ? reason.message : '预选人员保存失败');
    } finally {
      setPresetSaving(false);
    }
  }

  return <main className="weekly-process-shell hm-workbench-root hm-workbench-navigation-overlay">
    <AppWorkbenchHeader user={user} activeHref="/workspace/weekly-processes" subtitle="按工序汇总本周任务、工时与预选人员" menuItems={[]} hideHeader sidebarTriggerTargetId="weekly-process-navigation-trigger" />
    <div className="weekly-process-main">
      <section className="weekly-process-toolbar">
        <div id="weekly-process-navigation-trigger" className="weekly-process-navigation-trigger" aria-label="平台导航入口" />
        <div className="weekly-process-title"><span>生产计划</span><strong>周工序总览</strong><small>{weekLabel}</small></div>
        <div className="weekly-process-week-controls">
          <button type="button" aria-label="上一周" onClick={() => setWeekDate(value => shiftDate(value, -7))}><ChevronLeft size={17} /></button>
          <label><CalendarDays size={16} /><span>定位周</span><input type="date" value={weekDate} onChange={event => setWeekDate(event.target.value || currentWeek)} /></label>
          <button type="button" aria-label="下一周" onClick={() => setWeekDate(value => shiftDate(value, 7))}><ChevronRight size={17} /></button>
          <button type="button" className="weekly-process-current" onClick={() => setWeekDate(currentWeek)}>本周</button>
        </div>
        <div className="weekly-process-actions">
          {user.canAccessDailyPlans
            ? <a href={`/workspace/daily-plans?date=${encodeURIComponent(data?.weekStartDate || weekDate)}`}><ArrowLeft size={16} />返回日计划</a>
            : <a href="/production"><ArrowLeft size={16} />返回生产执行</a>}
          <button type="button" onClick={() => setRefreshToken(value => value + 1)} disabled={loading}><RefreshCw size={16} className={loading ? 'spin' : ''} />刷新</button>
        </div>
      </section>

      <section className="weekly-process-kpis" aria-label="周工序统计">
        <article><Workflow /><span>本周工序<strong>{data?.summary.total || 0}</strong></span></article>
        <article className="ready"><CircleDot /><span>未完成<strong>{data?.summary.incomplete || 0}</strong></span></article>
        <article className="completed"><CheckCircle2 /><span>已完成<strong>{data?.summary.completed || 0}</strong></span></article>
        <article className="pending"><Clock3 /><span>已报待核销<strong>{data?.summary.pendingCoverage || 0}</strong></span></article>
        <article className="blocked"><AlertTriangle /><span>待维护<strong>{data?.summary.blocked || 0}</strong></span></article>
      </section>

      <section className="weekly-process-filter-card">
        <div className="weekly-process-filter-row">
          <label className="weekly-process-search"><Search size={17} /><input value={searchInput} onChange={event => setSearchInput(event.target.value)} placeholder="搜索客户、产品、规格或工序" /></label>
          <label className="weekly-process-select process"><Workflow size={16} /><select value={processKey} onChange={event => setProcessKey(event.target.value)}><option value="">全部工序</option>{data?.processOptions.map(option => <option key={option.key} value={option.key}>{option.name} · {option.total}项 · 剩余{formatLabor(option.remainingLaborMilliseconds, true)}</option>)}</select></label>
          <label className="weekly-process-select"><UsersRound size={16} /><select value={teamId} onChange={event => setTeamId(event.target.value)}><option value="">全部班组</option><option value="__UNASSIGNED__">未配置归属</option>{data?.teamOptions.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>
          <label className="weekly-process-select"><Filter size={16} /><select value={state} onChange={event => setState(event.target.value)}>{stateOptions.map(option => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label>
          <label className="weekly-process-select sort"><ArrowUpDown size={16} /><select value={sort} onChange={event => setSort(event.target.value as WeeklySort)}>{sortOptions.map(option => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label>
        </div>
        <div className="weekly-process-filter-actions">
          <nav aria-label="完成分类">
            {([
              ['ALL', '全部', data?.completionFacets.total || 0],
              ['INCOMPLETE', '未完成', data?.completionFacets.incomplete || 0],
              ['COMPLETED', '已完成', data?.completionFacets.completed || 0],
            ] as const).map(option => <button type="button" className={completion === option[0] ? 'active' : ''} key={option[0]} onClick={() => setCompletion(option[0])}>{option[1]}<b>{option[2]}</b></button>)}
          </nav>
          <span>当前显示 <b>{data?.filteredCount || 0}</b> 项</span>
          {(teamId || state !== 'ALL' || completion !== 'ALL' || processKey || searchInput || sort !== 'DUE_ASC') && <button className="weekly-process-clear" type="button" onClick={resetFilters}>清除筛选</button>}
          {canManagePresets && <button className="weekly-process-bulk-worker" type="button" disabled={!selectedProcess || loading} onClick={() => selectedProcess && openPreset({ processKey: selectedProcess.key, processName: selectedProcess.name, stepId: null, label: '本周同名工序全部明细' })}><UserRoundPlus size={16} />批量预选人员{selectedProcess?.preferredEmployeeCount ? <b>{selectedProcess.preferredEmployeeCount}</b> : null}</button>}
        </div>
      </section>

      <section className="weekly-process-filter-summary" aria-label="当前筛选工时汇总">
        <article><span>匹配工序</span><strong>{data?.filteredSummary.processes || 0}</strong><small>涉及 {data?.filteredSummary.affectedOrders || 0} 个订单</small></article>
        <article><span>总标准工时</span><strong>{formatLabor(data?.filteredSummary.totalLaborMilliseconds || '0', true)}</strong><small>按发布工时快照</small></article>
        <article className="done"><span>已完成工时</span><strong>{formatLabor(data?.filteredSummary.completedLaborMilliseconds || '0', true)}</strong><small>{data?.filteredSummary.completed || 0} 项已完成</small></article>
        <article className="remain"><span>剩余工时</span><strong>{formatLabor(data?.filteredSummary.remainingLaborMilliseconds || '0', true)}</strong><small>{data?.filteredSummary.incomplete || 0} 项未完成</small></article>
        <article className="pending"><span>待核销工时</span><strong>{formatLabor(data?.filteredSummary.pendingLaborMilliseconds || '0', true)}</strong><small>包含在剩余工时内</small></article>
        <article className="assign"><span>待安排工时</span><strong>{formatLabor(data?.filteredSummary.unallocatedLaborMilliseconds || '0', true)}</strong><small>可继续分派给现场人员</small></article>
      </section>

      {error && <div className="weekly-process-error" role="alert"><AlertTriangle size={18} /><span>{error}</span><button type="button" onClick={() => setRefreshToken(value => value + 1)}>重试</button></div>}
      {notice && <div className="weekly-process-toast" role="status"><CheckCircle2 size={17} />{notice}</div>}

      <section className="weekly-process-table-wrap" aria-busy={loading}>
        <header><span>产品 / 交期</span><span>工序</span><span>数量进度</span><span>工时汇总</span><span>班组 / 预选人员</span><span>状态</span></header>
        <div className="weekly-process-rows">
          {loading && !data && <div className="weekly-process-empty"><LoaderCircle className="spin" /><strong>正在汇总本周全部工序…</strong></div>}
          {!loading && data && !data.items.length && <div className="weekly-process-empty"><Workflow /><strong>当前筛选范围没有工序</strong><span>请切换完成分类、工序或清除筛选条件。</span></div>}
          {data?.items.map(item => <article title={`内部工单：${item.workOrderCode}`} key={item.id} className={`weekly-process-row state-${item.state.toLowerCase()} due-${item.dueTone.toLowerCase()}`}>
            <div className="weekly-process-order"><strong>{friendlyOrderLabel(item)}</strong><span>{item.customerName} · {item.productName}</span><small><em className={`due-${item.dueTone.toLowerCase()}`}>交期 {item.dueDate}</em>{!item.workOrderCode.startsWith('PLN-') && <b>{item.workOrderCode}</b>}</small></div>
            <div className="weekly-process-step"><span>{String(item.position || 0).padStart(2, '0')}</span><strong>{item.processName}</strong><small>{stageLabel(item.stageGroup)}</small></div>
            <div className="weekly-process-quantity"><strong>{item.processedQuantity}<small> / {item.batchQuantity}</small></strong><span>已完成 / 批次数量</span><progress max={Math.max(1, item.batchQuantity)} value={Math.min(item.batchQuantity, item.processedQuantity)} />{item.pendingCoverageQuantity > 0 && <small className="pending"><Clock3 size={12} />另有 {item.pendingCoverageQuantity} 待前序核销</small>}</div>
            <div className="weekly-process-labor"><div><span>总计</span><strong>{formatLabor(item.totalLaborMilliseconds, true)}</strong></div><div><span>完成</span><b>{formatLabor(item.completedLaborMilliseconds, true)}</b></div><div><span>剩余</span><b>{formatLabor(item.remainingLaborMilliseconds, true)}</b></div>{item.unallocatedLaborMilliseconds !== '0' && <small>待安排 {formatLabor(item.unallocatedLaborMilliseconds, true)}</small>}</div>
            <div className="weekly-process-workers"><div className="weekly-process-team-tags">{item.eligibleTeams.length ? item.eligibleTeams.map(team => <span key={team.id}>{team.name}</span>) : <em>未配置班组</em>}</div><div className="weekly-process-worker-tags">{item.preferredEmployees.slice(0, 3).map(employee => <span title={`${employee.employeeNo}${employee.team ? ` · ${employee.team}` : ''}`} key={employee.id}>{employee.name}</span>)}{item.preferredEmployees.length > 3 && <b>+{item.preferredEmployees.length - 3}</b>}{!item.preferredEmployees.length && <small>未预选人员</small>}{canManagePresets && <button type="button" disabled={!item.stepId} onClick={() => openPreset({ processKey: item.processKey, processName: item.processName, stepId: item.stepId, label: `${friendlyOrderLabel(item)} · 第${item.position}道` })}>{item.workerPresetScope === 'STEP' ? '调整专属' : '设为专属'}</button>}</div></div>
            <div className="weekly-process-state"><div><b>{item.completionLabel}</b><em>{item.stateLabel}</em></div>{item.warnings.slice(0, 2).map(warning => <span key={warning}>{warning}</span>)}{item.warnings.length > 2 && <small>另有 {item.warnings.length - 2} 项提醒</small>}</div>
          </article>)}
        </div>
      </section>
    </div>

    {canManagePresets && presetTarget && <div className="weekly-process-preset-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !presetSaving) setPresetTarget(null); }}>
      <aside className="weekly-process-preset-drawer" role="dialog" aria-modal="true" aria-labelledby="weekly-process-preset-title">
        <header><div><span>快速批量配置</span><strong id="weekly-process-preset-title">预选作业人员</strong><small>{presetTarget.processName} · {presetTarget.label}</small></div><button type="button" aria-label="关闭人员配置" disabled={presetSaving} onClick={() => setPresetTarget(null)}><X size={19} /></button></header>
        <section className="weekly-process-preset-summary"><Workflow size={20} /><div><strong>{presetTarget.processName}</strong><span>{presetTarget.stepId ? '仅覆盖当前工单工序，优先级高于本周批量配置' : `应用于 ${weekLabel} 的全部同名工序`}</span></div><b>{selectedPresetEmployees.length} 人</b></section>
        {!!selectedPresetEmployees.length && <section className="weekly-process-preset-selected"><header><strong>优先顺序</strong><span>报工时按此顺序置顶</span></header>{selectedPresetEmployees.map((employee, index) => <div key={employee.id}><b>{index + 1}</b><span><strong>{employee.name}</strong><small>{employee.employeeNo} · {employee.team || employee.position || '未设置班组'}</small></span><button type="button" aria-label={`${employee.name}上移`} disabled={presetSaving || index === 0} onClick={() => movePresetEmployee(employee.id, -1)}><ChevronUp size={15} /></button><button type="button" aria-label={`${employee.name}下移`} disabled={presetSaving || index === selectedPresetEmployees.length - 1} onClick={() => movePresetEmployee(employee.id, 1)}><ChevronDown size={15} /></button><button type="button" aria-label={`移除${employee.name}`} disabled={presetSaving} onClick={() => setPresetEmployeeIds(ids => ids.filter(id => id !== employee.id))}><X size={15} /></button></div>)}</section>}
        <section className="weekly-process-preset-picker"><label><Search size={16} /><input autoFocus value={presetSearch} disabled={presetSaving} onChange={event => setPresetSearch(event.target.value)} placeholder="搜索姓名、工号、班组或岗位" /></label><div>{filteredPresetEmployees.map(employee => { const checked = presetEmployeeIds.includes(employee.id); return <label className={checked ? 'selected' : ''} key={employee.id}><input type="checkbox" checked={checked} disabled={presetSaving} onChange={() => setPresetEmployeeIds(ids => checked ? ids.filter(id => id !== employee.id) : [...ids, employee.id])} /><span><strong>{employee.name}</strong><small>{employee.employeeNo} · {employee.team || employee.position || '未设置班组'}</small></span>{!employee.attendanceEnabled && <em>考勤未启用</em>}</label>; })}{!filteredPresetEmployees.length && <p>没有匹配的在职员工</p>}</div></section>
        {presetError && <div className="weekly-process-preset-error" role="alert"><AlertTriangle size={16} />{presetError}</div>}
        <footer><button className="danger" type="button" disabled={presetSaving || !currentPreset} onClick={() => void savePreset([])}><Trash2 size={15} />清空配置</button><span>预选只影响后续报工排序，不会自动产生员工工时。</span><button type="button" disabled={presetSaving} onClick={() => setPresetTarget(null)}>取消</button><button className="primary" type="button" disabled={presetSaving || !presetEmployeeIds.length} onClick={() => void savePreset()}>{presetSaving ? <LoaderCircle className="spin" size={16} /> : <UserRoundPlus size={16} />}保存并同步报工</button></footer>
      </aside>
    </div>}
  </main>;
}
