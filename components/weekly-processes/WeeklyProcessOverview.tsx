'use client';

import {
  AlertTriangle,
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  Clock3,
  Filter,
  LoaderCircle,
  RefreshCw,
  Search,
  Settings2,
  UsersRound,
  Workflow,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppWorkbenchHeader } from '@/components/layout/AppWorkbenchHeader';
import { chinaDateKey } from '@/lib/china-date';
import type { CurrentUserDTO } from '@/types';

type WeeklyProcessState = 'READY' | 'REVIEW' | 'WAITING' | 'BLOCKED' | 'PARTIAL' | 'PLANNED' | 'COMPLETED';

type WeeklyProcessItem = {
  id: string;
  workOrderCode: string;
  customerName: string;
  productName: string;
  specification: string;
  dueDate: string;
  batchQuantity: number;
  processCode: string;
  processName: string;
  stageGroup: string;
  position: number;
  processedQuantity: number;
  allocatedQuantity: number;
  remainingQuantity: number;
  plannedMinutes: number;
  state: WeeklyProcessState;
  stateLabel: string;
  hardBlocked: boolean;
  warnings: string[];
  eligibleTeams: Array<{ id: string; name: string }>;
  allocations: Array<{
    taskId: string;
    workDate: string;
    teamId: string;
    teamName: string;
    plannedQuantity: number;
    employees: string[];
  }>;
};

type WeeklyProcessData = {
  generatedAt: string;
  weekStartDate: string;
  weekEndDate: string;
  mappingConfigured: boolean;
  summary: {
    total: number;
    ready: number;
    planned: number;
    blocked: number;
    completed: number;
    unassignedOwnership: number;
  };
  teamOptions: Array<{ id: string; name: string; capabilityCount: number }>;
  filteredCount: number;
  items: WeeklyProcessItem[];
};

const stateOptions: Array<{ value: string; label: string }> = [
  { value: 'ALL', label: '全部状态' },
  { value: 'READY', label: '可安排' },
  { value: 'REVIEW', label: '开工前确认' },
  { value: 'WAITING', label: '等待上道' },
  { value: 'PARTIAL', label: '部分安排' },
  { value: 'PLANNED', label: '已安排' },
  { value: 'BLOCKED', label: '待维护' },
  { value: 'COMPLETED', label: '已完成' },
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

function formatMinutes(value: number): string {
  if (value < 60) return `${value} 分钟`;
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return minutes ? `${hours}小时${minutes}分` : `${hours} 小时`;
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
  const [weekDate, setWeekDate] = useState(dateKey());
  const [teamId, setTeamId] = useState('');
  const [state, setState] = useState('ALL');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [data, setData] = useState<WeeklyProcessData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(searchInput.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({ date: weekDate, state });
    if (teamId) query.set('teamId', teamId);
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
  }, [refreshToken, search, state, teamId, weekDate]);

  const weekLabel = data ? `${formatWeekDate(data.weekStartDate)}—${formatWeekDate(data.weekEndDate)}` : '正在计算本周范围';
  const currentWeek = useMemo(() => dateKey(), []);
  const resetFilters = useCallback(() => {
    setTeamId('');
    setState('ALL');
    setSearchInput('');
    setSearch('');
  }, []);

  return <main className="weekly-process-shell hm-workbench-root hm-workbench-navigation-overlay">
    <AppWorkbenchHeader user={user} activeHref="/workspace/weekly-processes" subtitle="本周全部工序、归属班组与日计划去向" menuItems={[]} hideHeader sidebarTriggerTargetId="weekly-process-navigation-trigger" />
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
          <a href={`/workspace/daily-plans?date=${encodeURIComponent(data?.weekStartDate || weekDate)}`}><ArrowLeft size={16} />返回日计划</a>
          <button type="button" onClick={() => setRefreshToken(value => value + 1)} disabled={loading}><RefreshCw size={16} className={loading ? 'spin' : ''} />刷新</button>
        </div>
      </section>

      <section className="weekly-process-kpis" aria-label="周工序统计">
        <article><Workflow /><span>本周工序<strong>{data?.summary.total || 0}</strong></span></article>
        <article className="ready"><CircleDot /><span>可安排 / 等待<strong>{data?.summary.ready || 0}</strong></span></article>
        <article className="planned"><CalendarDays /><span>已安排 / 部分<strong>{data?.summary.planned || 0}</strong></span></article>
        <article className="blocked"><AlertTriangle /><span>待维护<strong>{data?.summary.blocked || 0}</strong></span></article>
        <article className="completed"><CheckCircle2 /><span>已完成<strong>{data?.summary.completed || 0}</strong></span></article>
        <article className="ownership"><UsersRound /><span>未配置归属<strong>{data?.summary.unassignedOwnership || 0}</strong></span></article>
      </section>

      <section className="weekly-process-filters">
        <label className="weekly-process-search"><Search size={17} /><input value={searchInput} onChange={event => setSearchInput(event.target.value)} placeholder="搜索工单、客户、产品或工序" /></label>
        <label><UsersRound size={16} /><select value={teamId} onChange={event => setTeamId(event.target.value)}><option value="">全部班组</option><option value="__UNASSIGNED__">未配置归属</option>{data?.teamOptions.map(team => <option key={team.id} value={team.id}>{team.name}（{team.capabilityCount}项工序）</option>)}</select></label>
        <label><Filter size={16} /><select value={state} onChange={event => setState(event.target.value)}>{stateOptions.map(option => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label>
        <span>当前显示 <b>{data?.filteredCount || 0}</b> 项</span>
        {(teamId || state !== 'ALL' || searchInput) && <button type="button" onClick={resetFilters}>清除筛选</button>}
        <a href="/workspace/daily-plans?tab=organization"><Settings2 size={15} />配置工序归属</a>
      </section>

      {data && (!data.mappingConfigured || data.summary.unassignedOwnership > 0) && !loading && <div className="weekly-process-notice"><AlertTriangle size={18} /><span><b>{data.mappingConfigured ? `仍有 ${data.summary.unassignedOwnership} 项工序未配置归属` : '尚未配置班组—工序归属'}</b>{data.mappingConfigured ? '已映射工序按班组收口；未映射工序暂按兼容模式向所有班组开放。' : '当前先展示本周全部工序；配置后，班组筛选和日计划生成会按归属准确收口。'}</span><a href="/workspace/daily-plans?tab=organization">现在配置</a></div>}
      {error && <div className="weekly-process-error" role="alert"><AlertTriangle size={18} /><span>{error}</span><button type="button" onClick={() => setRefreshToken(value => value + 1)}>重试</button></div>}

      <section className="weekly-process-table-wrap" aria-busy={loading}>
        <header><span>工单 / 产品</span><span>工序</span><span>数量进度</span><span>归属班组</span><span>日计划去向</span><span>状态</span></header>
        <div className="weekly-process-rows">
          {loading && !data && <div className="weekly-process-empty"><LoaderCircle className="spin" /><strong>正在汇总本周全部工序…</strong></div>}
          {!loading && data && !data.items.length && <div className="weekly-process-empty"><Workflow /><strong>当前筛选范围没有工序</strong><span>请切换周次或清除筛选条件。</span></div>}
          {data?.items.map(item => <article key={item.id} className={`weekly-process-row state-${item.state.toLowerCase()}`}>
            <div className="weekly-process-order"><strong>{item.workOrderCode}</strong><span>{item.customerName} · {item.productName}</span><small>{item.specification} · 交期 {item.dueDate}</small></div>
            <div className="weekly-process-step"><span>{String(item.position || 0).padStart(2, '0')}</span><strong>{item.processName}</strong><small>{item.stageGroup || item.processCode || '工艺路线'}</small></div>
            <div className="weekly-process-quantity"><strong>{item.remainingQuantity}<small> / {item.batchQuantity}</small></strong><span>剩余 / 批次数量</span><progress max={Math.max(1, item.batchQuantity)} value={Math.min(item.batchQuantity, Math.max(item.processedQuantity, item.allocatedQuantity))} />{item.plannedMinutes > 0 && <small><Clock3 size={12} />剩余约 {formatMinutes(item.plannedMinutes)}</small>}</div>
            <div className="weekly-process-teams">{item.eligibleTeams.length ? item.eligibleTeams.map(team => <span key={team.id}>{team.name}</span>) : <em>未配置归属</em>}</div>
            <div className="weekly-process-allocations">{item.allocations.length ? item.allocations.map(allocation => <a key={allocation.taskId} href={`/workspace/daily-plans?date=${allocation.workDate}&teamId=${allocation.teamId}`}><b>{allocation.workDate.slice(5)}</b><span>{allocation.teamName} · {allocation.plannedQuantity}件</span><small>{allocation.employees.length ? allocation.employees.join('、') : '待分配人员'}</small></a>) : <span>尚未进入日计划</span>}</div>
            <div className="weekly-process-state"><b>{item.stateLabel}</b>{item.warnings.map(warning => <span key={warning}>{warning}</span>)}</div>
          </article>)}
        </div>
      </section>
    </div>
  </main>;
}
