'use client';

import {
  AlertTriangle,
  ArrowLeft,
  ArrowUpRight,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Clock3,
  GitPullRequestArrow,
  LayoutDashboard,
  Loader2,
  LocateFixed,
  PackageCheck,
  RefreshCw,
  Search,
  ShieldCheck,
  UserRound,
  Workflow,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { WeekReconciliationBar } from '@/components/WeekReconciliationBar';
import { AppWorkbenchHeader } from '@/components/layout/AppWorkbenchHeader';
import { productTimeConfigurationRoute } from '@/lib/workflow-routes';
import type {
  CurrentUserDTO,
  WorkflowEntityType,
  WorkflowItemDTO,
  WorkflowProcessStatus,
  WorkflowStepDTO,
  WorkflowSummaryDTO,
  WorkflowWeekNavigationDTO,
  WorkflowWeekScope,
} from '@/types';

type WorkflowCenterShellProps = { user: CurrentUserDTO };
type WorkflowResponse = {
  ok: boolean;
  items: WorkflowItemDTO[];
  summary: WorkflowSummaryDTO;
  navigation: WorkflowWeekNavigationDTO;
  error?: string;
};
type Filters = {
  entityType: WorkflowEntityType | 'all';
  status: WorkflowProcessStatus | 'all';
  overdue: boolean;
  weekScope: WorkflowWeekScope;
};
type WorkflowDeepLink = {
  batchId: string;
  workOrderId: string;
  stepId: string;
  fromPlanning: boolean;
  fromProduction: boolean;
  returnTo: string;
};

const emptySummary: WorkflowSummaryDTO = {
  total: 0, waiting: 0, processing: 0, verifying: 0, closed: 0, overdue: 0, issue: 0, change: 0, production: 0,
};
const emptyNavigation: WorkflowWeekNavigationDTO = {
  current: { weekStartDate: '', weekEndDate: '', count: 0 },
  next: { weekStartDate: '', weekEndDate: '', count: 0 },
  afterNext: { weekStartDate: '', weekEndDate: '', count: 0 },
  history: [],
};
const entityLabels: Record<WorkflowEntityType, string> = { issue: '问题', change: '变更', production: '生产' };
const statusLabels: Record<WorkflowProcessStatus, string> = { waiting: '待推进', processing: '处理中', verifying: '待验证', closed: '已完成' };
const priorityLabels = { urgent: '紧急', high: '高', normal: '一般' } as const;
const entityIcons = { issue: ShieldCheck, change: GitPullRequestArrow, production: LayoutDashboard };
const weekScopeLabels: Record<WorkflowWeekScope, string> = {
  history: '历史周', current: '本周', next: '下周', afterNext: '下下周',
};
const stageLabels = { frontend: '前端', backend: '后端', finish: '完工' } as const;
const routeStatusLabels = { draft: '待确认', confirmed: '已确认', in_progress: '生产中', completed: '已完成' } as const;

function safeLocalRoute(value: string | null): string {
  return value && value.startsWith('/') && !value.startsWith('//') ? value : '/production';
}

function formatDuration(milliseconds?: number | null): string {
  if (!milliseconds || milliseconds <= 0) return '未设标准工时';
  const seconds = milliseconds / 1000;
  if (seconds < 60) return `${Number(seconds.toFixed(seconds < 10 ? 1 : 0))} 秒/套`;
  const minutes = seconds / 60;
  if (minutes < 60) return `${Number(minutes.toFixed(minutes < 10 ? 1 : 0))} 分/套`;
  return `${Number((minutes / 60).toFixed(2))} 小时/套`;
}

function processStepStateLabel(step: WorkflowStepDTO): string {
  if (step.state === 'done') return '已完成';
  if (step.state === 'current') return '当前工序';
  return '待进入';
}

function formatDate(value?: string | null, includeTime = true): string {
  if (!value) return '未设置';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '未设置';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit',
    ...(includeTime ? { hour: '2-digit', minute: '2-digit', hour12: false } : {}),
  }).format(date);
}

async function jsonRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', ...init });
  const data = await response.json().catch(() => ({ ok: false, error: '服务返回格式异常' })) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || '请求失败');
  return data;
}

export default function WorkflowCenterShell({ user }: WorkflowCenterShellProps) {
  const [keyword, setKeyword] = useState('');
  const [filters, setFilters] = useState<Filters>({ entityType: 'production', status: 'all', overdue: false, weekScope: 'current' });
  const [items, setItems] = useState<WorkflowItemDTO[]>([]);
  const [summary, setSummary] = useState<WorkflowSummaryDTO>(emptySummary);
  const [navigation, setNavigation] = useState<WorkflowWeekNavigationDTO>(emptyNavigation);
  const [historyWeekStart, setHistoryWeekStart] = useState('');
  const [selected, setSelected] = useState<WorkflowItemDTO | null>(null);
  const selectedIdRef = useRef('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const deepLinkStepRef = useRef<HTMLElement | null>(null);
  const processNodeRefs = useRef(new Map<string, HTMLButtonElement>());
  const [selectedProcessStepKey, setSelectedProcessStepKey] = useState('');
  const [selectedPreparationKey, setSelectedPreparationKey] = useState('');
  const [deepLink, setDeepLink] = useState<WorkflowDeepLink>({
    batchId: '', workOrderId: '', stepId: '', fromPlanning: false, fromProduction: false, returnTo: '/production',
  });
  const [deepLinkReady, setDeepLinkReady] = useState(false);
  const [routeActionPending, setRouteActionPending] = useState(false);
  const [routeActionMessage, setRouteActionMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [historyRepairOpen, setHistoryRepairOpen] = useState(false);
  const [historyRepairStepKey, setHistoryRepairStepKey] = useState('');
  const [historyRepairQuantity, setHistoryRepairQuantity] = useState('0');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedKeyword = String(params.get('keyword') || '').trim().slice(0, 160);
    const requestedWeekScope = params.get('weekScope');
    const requestedWeekStart = String(params.get('weekStart') || '').trim().slice(0, 10);
    const weekScope: WorkflowWeekScope = requestedWeekScope === 'history'
      || requestedWeekScope === 'current'
      || requestedWeekScope === 'next'
      || requestedWeekScope === 'afterNext'
      ? requestedWeekScope
      : requestedWeekScope === 'carryover'
        ? 'history'
        : 'current';
    const next: WorkflowDeepLink = {
      batchId: params.get('batchId') || '',
      workOrderId: params.get('workOrderId') || '',
      stepId: params.get('stepId') || '',
      fromPlanning: params.get('from') === 'planning',
      fromProduction: params.get('from') === 'production',
      returnTo: safeLocalRoute(params.get('returnTo')),
    };
    if (next.batchId) selectedIdRef.current = `production-plan:${next.batchId}`;
    if (requestedKeyword) setKeyword(requestedKeyword);
    if (requestedWeekStart) setHistoryWeekStart(requestedWeekStart);
    setDeepLink(next);
    if (next.batchId || next.workOrderId) {
      setFilters(current => ({ ...current, entityType: 'production', weekScope }));
    } else setFilters(current => ({ ...current, weekScope }));
    setDeepLinkReady(true);
  }, []);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (keyword.trim()) params.set('keyword', keyword.trim());
      if (filters.entityType !== 'all') params.set('entityType', filters.entityType);
      if (filters.status !== 'all') params.set('status', filters.status);
      if (filters.overdue) params.set('overdue', 'true');
      params.set('weekScope', filters.weekScope);
      if (filters.weekScope === 'history' && historyWeekStart) params.set('weekStart', historyWeekStart);
      if (deepLink.batchId) params.set('batchId', deepLink.batchId);
      if (deepLink.workOrderId) params.set('workOrderId', deepLink.workOrderId);
      const data = await jsonRequest<WorkflowResponse>(`/api/workflows?${params.toString()}`);
      setItems(data.items);
      setSummary(data.summary);
      setNavigation(data.navigation);
      if (filters.weekScope === 'history' && !historyWeekStart && data.navigation.history[0]?.weekStartDate) {
        setHistoryWeekStart(data.navigation.history[0].weekStartDate);
      }
      const desired = selectedIdRef.current || sessionStorage.getItem('hm-workflow-selected') || '';
      const nextSelected = data.items.find(item => deepLink.batchId && item.batchId === deepLink.batchId)
        || data.items.find(item => deepLink.workOrderId && item.workOrderId === deepLink.workOrderId)
        || data.items.find(item => item.id === desired)
        || data.items[0]
        || null;
      selectedIdRef.current = nextSelected?.id || '';
      setSelected(nextSelected);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '流程中心加载失败');
    } finally {
      setLoading(false);
    }
  }, [deepLink.batchId, deepLink.workOrderId, filters, historyWeekStart, keyword]);

  useEffect(() => {
    if (!deepLinkReady) return;
    const timer = window.setTimeout(() => { void load(); }, keyword ? 260 : 0);
    return () => window.clearTimeout(timer);
  }, [deepLinkReady, keyword, load]);

  useEffect(() => {
    if (!deepLinkReady) return;
    const url = new URL(window.location.href);
    url.searchParams.set('weekScope', filters.weekScope);
    if (filters.weekScope === 'history' && historyWeekStart) url.searchParams.set('weekStart', historyWeekStart);
    else url.searchParams.delete('weekStart');
    if (deepLink.batchId) url.searchParams.set('batchId', deepLink.batchId);
    else url.searchParams.delete('batchId');
    if (deepLink.workOrderId) url.searchParams.set('workOrderId', deepLink.workOrderId);
    else url.searchParams.delete('workOrderId');
    if (deepLink.stepId) url.searchParams.set('stepId', deepLink.stepId);
    else url.searchParams.delete('stepId');
    window.history.replaceState(window.history.state, '', `${url.pathname}?${url.searchParams.toString()}`);
  }, [deepLink.batchId, deepLink.stepId, deepLink.workOrderId, deepLinkReady, filters.weekScope, historyWeekStart]);

  useEffect(() => {
    if (!selected) return;
    selectedIdRef.current = selected.id;
    sessionStorage.setItem('hm-workflow-selected', selected.id);
    const preferredStep = selected.steps.find(step => step.key === deepLink.stepId)
      || selected.steps.find(step => step.state === 'current')
      || selected.steps[0];
    setSelectedProcessStepKey(preferredStep?.key || '');
    setSelectedPreparationKey(
      selected.preparationSteps?.find(step => step.state === 'current')?.key
      || selected.preparationSteps?.find(step => step.state === 'pending')?.key
      || selected.preparationSteps?.at(-1)?.key
      || '',
    );
    setHistoryRepairOpen(false);
    setHistoryRepairStepKey(selected.historicalRouteRepair?.suggestedStepKey || '');
    setHistoryRepairQuantity(String(selected.historicalRouteRepair?.completedQuantity || 0));
  }, [deepLink.stepId, selected]);

  useEffect(() => {
    if (loading || !selected || (!deepLink.batchId && !deepLink.workOrderId)) return;
    window.requestAnimationFrame(() => {
      listRef.current?.querySelector<HTMLElement>('.workflow-list-card.selected')?.scrollIntoView({ block: 'nearest' });
    });
  }, [deepLink.batchId, deepLink.workOrderId, loading, selected]);

  useEffect(() => {
    if (loading || !deepLink.stepId || !selected) return;
    window.requestAnimationFrame(() => deepLinkStepRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
  }, [deepLink.stepId, loading, selected]);

  useEffect(() => {
    const element = listRef.current;
    if (!element) return;
    element.scrollTop = Number(sessionStorage.getItem('hm-workflow-list-scroll') || 0);
    const save = (): void => sessionStorage.setItem('hm-workflow-list-scroll', String(element.scrollTop));
    element.addEventListener('scroll', save, { passive: true });
    return () => element.removeEventListener('scroll', save);
  }, [loading]);

  async function logout(): Promise<void> {
    await fetch('/api/auth/logout', { method: 'POST' });
    location.href = '/login';
  }

  const activeFilterCount = [filters.entityType !== 'production', filters.status !== 'all', filters.overdue].filter(Boolean).length;
  const selectedRouteGroups = useMemo(() => {
    if (!selected || selected.entityType !== 'production') return [];
    const groups = new Map<number, WorkflowStepDTO[]>();
    selected.steps.forEach((step, index) => {
      const group = step.sequenceGroup ?? index + 1;
      const current = groups.get(group) || [];
      current.push(step);
      groups.set(group, current);
    });
    return Array.from(groups.entries()).sort((first, second) => first[0] - second[0]);
  }, [selected]);
  const selectedRouteRows = useMemo(() => {
    const groupsPerRow = 4;
    return Array.from(
      { length: Math.ceil(selectedRouteGroups.length / groupsPerRow) },
      (_, rowIndex) => selectedRouteGroups.slice(rowIndex * groupsPerRow, (rowIndex + 1) * groupsPerRow),
    );
  }, [selectedRouteGroups]);
  const selectedCurrentStep = useMemo(() => {
    if (!selected) return null;
    return selected.steps.find(step => step.key === deepLink.stepId)
      || selected.steps.find(step => step.state === 'current')
      || null;
  }, [deepLink.stepId, selected]);
  const selectedProcessStep = useMemo(() => {
    if (!selected) return null;
    return selected.steps.find(step => step.key === selectedProcessStepKey)
      || selectedCurrentStep
      || selected.steps[0]
      || null;
  }, [selected, selectedCurrentStep, selectedProcessStepKey]);
  const activityVersions = useMemo(() => {
    if (!selected) return { current: [], historical: [] };
    const repairIndex = selected.activities.findIndex(item => item.action === 'repair_historical_product_time_route');
    if (repairIndex < 0) return { current: selected.activities, historical: [] };
    return {
      current: selected.activities.slice(0, repairIndex + 1),
      historical: selected.activities.slice(repairIndex + 1),
    };
  }, [selected]);
  const isHistoricalRouteReference = Boolean(
    selected?.entityType === 'production'
    && selected.routeDisplayMode === 'published_reference'
    && selected.historicalRouteRepair,
  );
  const hasPublishedProductRoute = Boolean(
    isHistoricalRouteReference
    || (
    selected?.entityType === 'production'
    && selected.processRouteId
    && selected.routeSource === 'product_time_profile'
    && selected.productTimeProfileVersion !== null
    ),
  );
  function manualReportHref(step: WorkflowStepDTO): string | null {
    if (!selected?.workOrderId || !step.hasLaborPool) return null;
    const params = new URLSearchParams({
      view: 'labor',
      workOrderId: selected.workOrderId,
      stepId: step.key,
      from: 'workflow',
      returnTo: `/workspace/workflows?workOrderId=${selected.workOrderId}&stepId=${step.key}&weekScope=${filters.weekScope}`,
    });
    if (step.laborPoolId) params.set('poolId', step.laborPoolId);
    if (step.laborWorkDate) params.set('workDate', step.laborWorkDate);
    return `/workspace/reports?${params.toString()}`;
  }
  const manualReportRoute = selectedProcessStep ? manualReportHref(selectedProcessStep) : null;
  const availableProductTimeVersion = selected?.availableProductTimeProfileVersion || null;
  const canApplyProductTime = Boolean(
    selected?.entityType === 'production'
    && selected.workOrderId
    && selected.canApplyProductTimeProfile
    && availableProductTimeVersion,
  );
  const productTimeActionLabel = selected?.productTimeRouteLinkState === 'upgrade_available'
    ? `升级至 V${availableProductTimeVersion}`
    : `应用 V${availableProductTimeVersion} 到本工单`;

  async function applyProductTimeToSelectedWorkOrder(): Promise<void> {
    if (!selected?.workOrderId || !availableProductTimeVersion || routeActionPending) return;
    const confirmed = window.confirm(
      `确认将已发布的产品工艺 V${availableProductTimeVersion} 应用到工单 ${selected.code}？\n\n系统只会处理尚未开工且没有报工记录的路线。`,
    );
    if (!confirmed) return;
    setRouteActionPending(true);
    setRouteActionMessage(null);
    try {
      const result = await jsonRequest<{ ok: boolean; message: string }>(
        `/api/work-orders/${encodeURIComponent(selected.workOrderId)}/process-route/apply-product-time`,
        { method: 'POST' },
      );
      setRouteActionMessage({ tone: 'success', text: result.message });
      await load();
    } catch (actionError) {
      setRouteActionMessage({
        tone: 'error',
        text: actionError instanceof Error ? actionError.message : '应用产品工艺失败',
      });
    } finally {
      setRouteActionPending(false);
    }
  }

  function openHistoricalRouteRepair(): void {
    if (!selected?.historicalRouteRepair) return;
    setHistoryRepairStepKey(
      historyRepairStepKey
      || selected.historicalRouteRepair.suggestedStepKey,
    );
    setHistoryRepairQuantity(
      historyRepairQuantity
      || String(selected.historicalRouteRepair.completedQuantity),
    );
    setHistoryRepairOpen(true);
  }

  async function repairHistoricalRoute(): Promise<void> {
    if (
      !selected?.workOrderId
      || !selected.historicalRouteRepair
      || !historyRepairStepKey
      || routeActionPending
    ) return;
    const processedQuantity = Number(historyRepairQuantity);
    if (!Number.isInteger(processedQuantity) || processedQuantity < 0) {
      setRouteActionMessage({ tone: 'error', text: '历史已完成数量必须是非负整数' });
      return;
    }
    setRouteActionPending(true);
    setRouteActionMessage(null);
    try {
      const result = await jsonRequest<{ ok: boolean; message: string }>(
        `/api/work-orders/${encodeURIComponent(selected.workOrderId)}/process-route/repair-history`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            currentProductTimeEntryId: historyRepairStepKey,
            processedQuantity,
          }),
        },
      );
      setHistoryRepairOpen(false);
      setRouteActionMessage({ tone: 'success', text: result.message });
      await load();
    } catch (actionError) {
      setRouteActionMessage({
        tone: 'error',
        text: actionError instanceof Error ? actionError.message : '历史工艺路线核对失败',
      });
    } finally {
      setRouteActionPending(false);
    }
  }

  function focusProcessStep(step: WorkflowStepDTO): void {
    setSelectedProcessStepKey(step.key);
    window.requestAnimationFrame(() => {
      processNodeRefs.current.get(step.key)?.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'nearest',
      });
    });
  }

  function changeWorkflowWeekScope(scope: WorkflowWeekScope, selectedHistoryWeek?: string): void {
    selectedIdRef.current = '';
    setDeepLink(current => ({ ...current, batchId: '', workOrderId: '', stepId: '' }));
    setFilters(current => ({
      ...current,
      entityType: 'production',
      weekScope: scope,
    }));
    if (scope === 'history') {
      setHistoryWeekStart(selectedHistoryWeek || historyWeekStart || navigation.history[0]?.weekStartDate || '');
    }
  }

  const activeWeek = filters.weekScope === 'history'
    ? navigation.history.find(item => item.weekStartDate === historyWeekStart)
      || null
    : navigation[filters.weekScope];

  return (
    <main className="hm-workbench-root hm-workbench-navigation-overlay hm-workflow-center">
      <AppWorkbenchHeader
        user={user}
        activeHref="/workspace/workflows"
        subtitle="真实业务流程统一查看"
        menuItems={[{ label: '系统设置', href: '/dashboard?openSettings=1' }, { label: '退出登录', onSelect: () => { void logout(); } }]}
        hideHeader
        sidebarTriggerTargetId="workflow-navigation-trigger"
      />

      <div className="workflow-page-frame">
        <section className="workflow-command-bar" aria-label="流程周期与操作">
          <span className="workflow-navigation-trigger" id="workflow-navigation-trigger" aria-label="平台导航入口" />
          <div className="workflow-inline-title">
            <Workflow size={18} aria-hidden="true" />
            <div><strong>流程中心</strong><small>真实工艺路线</small></div>
          </div>
          <div className="workflow-week-tabs" role="group" aria-label="生产周范围">
            <div className={`workflow-history-week ${filters.weekScope === 'history' ? 'active' : ''}`.trim()}>
              <button type="button" onClick={() => changeWorkflowWeekScope('history')}>
                <CalendarDays size={13} aria-hidden="true" />历史周
              </button>
              <select
                aria-label="选择历史流程周"
                disabled={!navigation.history.length}
                value={filters.weekScope === 'history' ? historyWeekStart : ''}
                onFocus={() => {
                  if (filters.weekScope !== 'history') changeWorkflowWeekScope('history');
                }}
                onChange={event => changeWorkflowWeekScope('history', event.target.value)}
              >
                <option value="" disabled>选择历史周</option>
                {navigation.history.map(item => <option key={item.weekStartDate} value={item.weekStartDate}>{item.weekStartDate.slice(5)} - {item.weekEndDate.slice(5)} · {item.count} 批</option>)}
              </select>
            </div>
            {(['current', 'next', 'afterNext'] as const).map(scope => (
              <button
                type="button"
                key={scope}
                className={filters.weekScope === scope ? 'active' : ''}
                onClick={() => changeWorkflowWeekScope(scope)}
              >
                <CalendarDays size={13} aria-hidden="true" />
                {weekScopeLabels[scope]} <b>{navigation[scope].count}</b>
              </button>
            ))}
          </div>
          <div className="workflow-command-actions">
            {deepLink.fromProduction && <a href={deepLink.returnTo}><ArrowLeft size={14} />返回生产执行</a>}
            {deepLink.fromPlanning && !deepLink.fromProduction && <a href="/weekly-plan-center?restore=1"><ArrowLeft size={14} />返回计划中心</a>}
            <button type="button" disabled={loading} onClick={() => { void load(); }}>
              <RefreshCw size={14} className={loading ? 'spin' : ''} />刷新
            </button>
            <details className="workflow-create-menu">
              <summary><GitPullRequestArrow size={14} />新建事项<ChevronDown size={13} /></summary>
              <div>
                <a href="/workspace/issues?action=new"><ShieldCheck size={15} /><span><strong>新建问题</strong><small>记录生产、计划或技术问题</small></span></a>
                <a href="/workspace/changes?action=new"><GitPullRequestArrow size={15} /><span><strong>新建变更</strong><small>发起影响评估与验证闭环</small></span></a>
              </div>
            </details>
          </div>
        </section>

        <section className="workflow-summary" aria-label="流程统计">
          {([
            ['全部流程', summary.total, 'all'], ['待推进', summary.waiting, 'waiting'], ['处理中', summary.processing, 'processing'],
            ['待验证', summary.verifying, 'verifying'], ['已完成', summary.closed, 'closed'],
          ] as const).map(([label, count, status]) => <button key={status} type="button" className={filters.status === status ? 'active' : ''} onClick={() => setFilters(current => ({ ...current, status }))}><span>{label}</span><strong>{count}</strong></button>)}
          <button type="button" className={`danger ${filters.overdue ? 'active' : ''}`} onClick={() => setFilters(current => ({ ...current, overdue: !current.overdue }))}><span>已逾期</span><strong>{summary.overdue}</strong></button>
        </section>

        <WeekReconciliationBar
          className="workflow-week-reconciliation"
          weekStartDate={activeWeek?.weekStartDate}
          weekEndDate={activeWeek?.weekEndDate}
        />

        <div className="workflow-workspace">
          <section className="workflow-list" aria-label="流程列表">
            <header><div><h2>流程实例</h2><span>{items.length} 条当前结果</span></div>{activeFilterCount > 0 && <button type="button" onClick={() => setFilters(current => ({ entityType: 'production', status: 'all', overdue: false, weekScope: current.weekScope }))}>清除 {activeFilterCount}</button>}</header>
            <label className="workflow-list-search"><Search size={15} aria-hidden="true" /><input value={keyword} onChange={event => setKeyword(event.target.value)} placeholder="搜索编号、产品或负责人" aria-label="搜索流程" />{keyword && <button type="button" aria-label="清空搜索" title="清空搜索" onClick={() => setKeyword('')}><X size={13} /></button>}</label>
            <div className="workflow-type-filters" role="group" aria-label="流程类型筛选">
              {(['all', 'issue', 'change', 'production'] as const).map(type => <button type="button" key={type} className={filters.entityType === type ? 'active' : ''} onClick={() => setFilters(current => ({ ...current, entityType: type }))}>{type === 'all' ? '全部' : entityLabels[type]}<span>{type === 'all' ? summary.total : summary[type]}</span></button>)}
            </div>
            <div className="workflow-list-scroll hm-scroll-region" ref={listRef} tabIndex={0}>
              {loading && <div className="workflow-loading"><Loader2 className="spin" />正在汇总真实流程...</div>}
              {!loading && error && <div className="workflow-error"><AlertTriangle /><p>{error}</p><button type="button" onClick={() => { void load(); }}>重试</button></div>}
              {!loading && !error && !items.length && <div className="workflow-empty"><Workflow /><h3>没有符合条件的流程</h3><p>可调整类型、状态或逾期筛选。</p></div>}
              {!loading && !error && items.map(item => {
                const Icon = entityIcons[item.entityType];
                return <button type="button" key={item.id} className={`workflow-list-card ${selected?.id === item.id ? 'selected' : ''}`} onClick={() => setSelected(item)}>
                  <span className={`workflow-entity-icon entity-${item.entityType}`}><Icon size={16} aria-hidden="true" /></span>
                  <div><div className="workflow-card-top"><em>{entityLabels[item.entityType]}</em><span>{item.code}</span><i className={`priority-${item.priority}`}>{priorityLabels[item.priority]}</i></div><strong title={item.title}>{item.title}</strong><p title={item.subtitle}>{item.subtitle}</p><footer><span className={`status-${item.processStatus}`}>{statusLabels[item.processStatus]}</span><span>{item.owner || '待分派'}</span><span className={item.isOverdue ? 'overdue' : ''}>{item.isOverdue ? '已逾期' : formatDate(item.dueAt, false)}</span></footer></div>
                </button>;
              })}
            </div>
          </section>

          <section className="workflow-detail" aria-label="流程详情">
            {!selected ? <div className="workflow-detail-empty"><Workflow /><h2>选择一条流程查看节点</h2><p>流程中心显示真实业务记录，不生成独立副本。</p></div> : <>
              {selected.entityType !== 'production' && <header className="workflow-detail-header"><div><span>{entityLabels[selected.entityType]}流程 · {selected.code}</span><h2 title={selected.title}>{selected.title}</h2><p>{selected.subtitle}</p></div><div><span className={`workflow-status status-${selected.processStatus}`}>{statusLabels[selected.processStatus]}</span><a href={selected.route}>进入处理<ArrowUpRight size={14} /></a></div></header>}
              <div className="workflow-detail-scroll hm-scroll-region">
                {routeActionMessage && <div className={`workflow-route-action-message ${routeActionMessage.tone}`}>
                  {routeActionMessage.tone === 'success' ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
                  <span>{routeActionMessage.text}</span>
                  <button type="button" aria-label="关闭提示" onClick={() => setRouteActionMessage(null)}><X size={13} /></button>
                </div>}
                {selected.entityType === 'production' && selected.preparationSteps?.length ? <section className="workflow-preparation-strip" aria-label="生产准备状态">
                  <header>
                    <div><span>开工准备</span><h3>生产条件已联动校验</h3></div>
                    <small>{selected.preparationSteps.filter(step => step.state === 'done').length} / {selected.preparationSteps.length} 项已就绪</small>
                  </header>
                  <ol>{selected.preparationSteps.map((step, index) => <li className={`${step.state}${selectedPreparationKey === step.key ? ' selected' : ''}`} key={step.key}>
                    <button type="button" aria-pressed={selectedPreparationKey === step.key} onClick={() => setSelectedPreparationKey(step.key)}>
                      <span>{step.state === 'done' ? <CheckCircle2 size={14} /> : step.state === 'current' ? <CircleDot size={14} /> : index + 1}</span>
                      <strong>{step.label}</strong>
                      <small>{step.state === 'done' ? '已就绪' : step.state === 'current' ? '校验中' : '待校验'}</small>
                    </button>
                  </li>)}</ol>
                </section> : null}
                {hasPublishedProductRoute ? <>
                  <section className="workflow-process-route">
                    <header>
                      <div><span>{isHistoricalRouteReference ? '发布版本预览' : '动态工艺图'}</span><h3>产品工序流转</h3></div>
                      <div className="workflow-route-meta">
                        <span><PackageCheck size={13} />{(selected.quantity || 0).toLocaleString()} 件</span>
                        <span>{isHistoricalRouteReference
                          ? `V${availableProductTimeVersion || 1} · 历史起点待确认`
                          : `R${selected.routeVersion || 1} · ${selected.routeStatus ? routeStatusLabels[selected.routeStatus] : '待确认'}`}</span>
                        <span>{formatDate(selected.weekStartDate, false)} - {formatDate(selected.weekEndDate, false)}</span>
                        {isHistoricalRouteReference && <button type="button" onClick={openHistoricalRouteRepair}>
                          <PackageCheck size={13} />确认历史起点
                        </button>}
                        {canApplyProductTime && selected.productTimeRouteLinkState === 'upgrade_available' && <button type="button" disabled={routeActionPending} onClick={() => { void applyProductTimeToSelectedWorkOrder(); }}>
                          {routeActionPending ? <Loader2 className="spin" size={13} /> : <RefreshCw size={13} />}{productTimeActionLabel}
                        </button>}
                        {selectedCurrentStep && <button type="button" onClick={() => focusProcessStep(selectedCurrentStep)}><LocateFixed size={13} />定位当前</button>}
                      </div>
                    </header>
                    {isHistoricalRouteReference && <div className="workflow-route-reference-notice">
                      <AlertTriangle size={15} />
                      <span><strong>已同步最新产品工艺，尚未改写历史生产事实</strong><small>当前节点和数量为历史数据投影；核对实际所在工序后，才会写入本工单路线，且不会生成过去的员工工时。</small></span>
                      <button type="button" onClick={openHistoricalRouteRepair}>现在核对</button>
                    </div>}
                    <div className="workflow-flow-viewport" aria-label="按工序顺序向下延伸的工艺流程图">
                      <div className="workflow-flow-canvas">
                        {selectedRouteRows.map((row, rowIndex) => {
                          const reverse = rowIndex % 2 === 1;
                          const [, lastSteps] = row[row.length - 1];
                          const lastState = lastSteps.every(step => step.state === 'done')
                            ? 'done'
                            : lastSteps.some(step => step.state === 'current') ? 'current' : 'pending';
                          return <div className={`workflow-flow-row${reverse ? ' reverse' : ''}`} key={`route-row-${rowIndex + 1}`}>
                            {row.map(([group, steps], groupIndex) => {
                              const groupState = steps.every(step => step.state === 'done')
                                ? 'done'
                                : steps.some(step => step.state === 'current') ? 'current' : 'pending';
                              return <section className={`workflow-flow-stage ${groupState}`} key={group}>
                                <header className="workflow-flow-stage-header">
                                  <span>{groupState === 'done' ? <CheckCircle2 size={14} /> : groupState === 'current' ? <CircleDot size={14} /> : group}</span>
                                  <div><strong>阶段 {group}</strong><small>{steps.length > 1 ? `${steps.length} 道并行` : '顺序工序'}</small></div>
                                </header>
                                <div className="workflow-flow-nodes">
                                  {steps.map(step => {
                                    const input = step.inputQuantity ?? selected.quantity ?? 0;
                                    const processed = step.processedQuantity || 0;
                                    const unitLabel = step.unitLabel || '件';
                                    const progress = input > 0
                                      ? Math.min(100, Math.round((processed / input) * 100))
                                      : step.state === 'done' ? 100 : 0;
                                    const isDeepLinked = step.key === deepLink.stepId;
                                    const laborStatusText = step.laborPendingStandard
                                      ? '工时标准待补'
                                      : step.hasLaborPool
                                        ? (step.laborRemainingQuantity || 0) > 0
                                          ? `${step.latestEmployeeName ? `${step.latestEmployeeName} · ` : ''}待领 ${(step.laborRemainingQuantity || 0).toLocaleString()} ${unitLabel}`
                                          : step.latestEmployeeName || '工时已领取'
                                        : '工时尚未生成';
                                    return <button
                                      type="button"
                                      key={step.key}
                                      ref={node => {
                                        if (node) processNodeRefs.current.set(step.key, node);
                                        else processNodeRefs.current.delete(step.key);
                                        if (isDeepLinked) deepLinkStepRef.current = node;
                                      }}
                                      aria-pressed={selectedProcessStep?.key === step.key}
                                      onClick={() => focusProcessStep(step)}
                                      className={`workflow-flow-node ${step.state}${isDeepLinked ? ' deep-linked' : ''}${selectedProcessStep?.key === step.key ? ' selected' : ''}`}
                                    >
                                      <header>
                                        <span className={`stage-${step.stageGroup || 'frontend'}`}>{step.stageGroup ? stageLabels[step.stageGroup] : '工序'}</span>
                                        <em>{processStepStateLabel(step)}</em>
                                      </header>
                                      <strong>{step.label}</strong>
                                      <div className="workflow-flow-node-main">
                                        <span>{processed.toLocaleString()} / {input.toLocaleString()} {unitLabel}</span>
                                        <b>{progress}%</b>
                                      </div>
                                      <div className="workflow-flow-progress" aria-label={`${step.label}完成${progress}%`}><span style={{ transform: `scaleX(${progress / 100})` }} /></div>
                                      <footer><span><Clock3 size={12} />{formatDuration(step.standardMillisecondsPerUnit)}</span><span><UserRound size={12} />{laborStatusText}</span></footer>
                                    </button>;
                                  })}
                                </div>
                                {groupIndex < row.length - 1 && <div className="workflow-flow-connector" aria-hidden="true"><span /><ChevronRight size={16} />{groupState === 'current' && <i />}</div>}
                              </section>;
                            })}
                            {rowIndex < selectedRouteRows.length - 1 && <div className={`workflow-flow-row-turn ${lastState}`} aria-hidden="true"><span /><ChevronDown size={16} />{lastState === 'current' && <i />}</div>}
                          </div>;
                        })}
                      </div>
                    </div>
                  </section>
                </> : selected.entityType === 'production' ? <section className={`workflow-route-missing ${selected.processStatus === 'closed' ? 'completed' : ''}`}>
                  <span>{selected.processStatus === 'closed' ? <CheckCircle2 size={24} /> : <AlertTriangle size={24} />}</span>
                  <div>
                    <small>真实产品工艺</small>
                    <h3>{selected.currentStep}</h3>
                    <p>{selected.processStatus === 'closed'
                      ? '该历史工单已经完成，不再回放旧版“前端 / 后端”阶段。'
                      : availableProductTimeVersion && selected.productTimeRouteLinkState === 'available'
                        ? `产品工序与工时 V${availableProductTimeVersion} 已发布，但当前工单还没有生成路线快照。应用后将按真实工序流转。`
                        : availableProductTimeVersion && selected.productTimeRouteLinkState === 'locked'
                          ? `产品工序与工时 V${availableProductTimeVersion} 已发布，但该工单已经产生生产事实，系统不会静默覆盖历史路线。`
                      : selected.steps[0]?.key === 'route-repair-required'
                        ? '该工单已经产生生产事实，系统不会静默改写历史。请先补齐已发布的产品工艺路线，再继续查看和推进工序。'
                        : '尚未找到已发布的产品工艺路线。请先在产品工序与工时中完成配置，生产流程会自动按真实工序显示。'}</p>
                    {availableProductTimeVersion && <div className="workflow-product-time-facts">
                      <span>产品标准 V{availableProductTimeVersion}</span>
                      <span>{selected.availableProductTimeProcessCount || 0} 道工序</span>
                      <span>{selected.productTimeRouteLinkState === 'locked' ? '工单快照已锁定' : '工单快照待生成'}</span>
                    </div>}
                  </div>
                  {selected.processStatus !== 'closed' && (canApplyProductTime
                    ? <button type="button" disabled={routeActionPending} onClick={() => { void applyProductTimeToSelectedWorkOrder(); }}>
                        {routeActionPending ? <Loader2 className="spin" size={14} /> : <PackageCheck size={14} />}{productTimeActionLabel}
                      </button>
                    : <a href={availableProductTimeVersion
                      ? selected.route
                      : productTimeConfigurationRoute(selected.drawingLibraryItemId)}>
                        {availableProductTimeVersion ? '查看生产工单' : selected.steps[0]?.key === 'route-repair-required' ? '补齐产品工序' : '配置产品工序'}<ArrowUpRight size={14} />
                      </a>)}
                </section> : <>
                  <section className="workflow-current-state"><div><span>当前节点</span><strong>{selected.currentStep}</strong><p>{selected.nextStep ? `下一节点：${selected.nextStep}` : '流程已到达终态'}</p></div><dl><div><dt>负责人</dt><dd>{selected.owner || '待分派'}</dd></div><div><dt>截止时间</dt><dd className={selected.isOverdue ? 'overdue' : ''}>{formatDate(selected.dueAt)}</dd></div><div><dt>最近更新</dt><dd>{formatDate(selected.updatedAt)}</dd></div></dl></section>
                  <section className="workflow-stepper"><header><h3>流程节点</h3><span>{entityLabels[selected.entityType]}闭环</span></header><ol>{selected.steps.map((step, index) => <li className={step.state} key={step.key}><span>{step.state === 'done' ? <CheckCircle2 size={16} /> : step.state === 'current' ? <CircleDot size={16} /> : index + 1}</span><div><strong>{step.label}</strong><small>{processStepStateLabel(step)}</small></div>{index < selected.steps.length - 1 && <ChevronRight size={15} aria-hidden="true" />}</li>)}</ol></section>
                </>}
                <section className="workflow-activity">
                  <header><h3>最近记录</h3><span>{activityVersions.historical.length ? `当前版本 ${activityVersions.current.length} 条` : `最近 ${Math.min(5, selected.activities.length)} / ${selected.activities.length} 条`}</span></header>
                  <div>
                    {activityVersions.current.slice(0, 5).map(item => <article key={item.id}><span /><div><strong>{item.label}</strong><p>{item.actor || '系统'} · {formatDate(item.createdAt)}</p></div></article>)}
                    {!selected.activities.length && <p className="activity-empty">该流程暂时没有可展示的业务记录。</p>}
                    {activityVersions.current.length > 5 && <details className="workflow-activity-more"><summary>展开当前版本其余 {activityVersions.current.length - 5} 条记录</summary><div>{activityVersions.current.slice(5).map(item => <article key={item.id}><span /><div><strong>{item.label}</strong><p>{item.actor || '系统'} · {formatDate(item.createdAt)}</p></div></article>)}</div></details>}
                    {activityVersions.historical.length > 0 && <details className="workflow-activity-more historical"><summary>迁移前历史记录 {activityVersions.historical.length} 条</summary><div>{activityVersions.historical.map(item => <article key={item.id}><span /><div><strong>{item.label}</strong><p>{item.actor || '系统'} · {formatDate(item.createdAt)}</p></div></article>)}</div></details>}
                  </div>
                </section>
              </div>
              <footer className="workflow-detail-actions">
                {manualReportRoute && <a href={manualReportRoute}>工时领取<ArrowUpRight size={14} /></a>}
                <a className={manualReportRoute ? 'secondary' : ''} href={selected.route}>{selected.entityType === 'production' ? '打开生产执行' : '打开来源业务'}<ArrowUpRight size={14} /></a>
                {selected.sourceRoute && <a className="secondary" href={selected.sourceRoute}>查看关联资料</a>}
              </footer>
            </>}
          </section>
        </div>
      </div>

      {historyRepairOpen && selected?.historicalRouteRepair && <div className="workflow-history-repair-backdrop" role="presentation" onMouseDown={event => {
        if (event.currentTarget === event.target && !routeActionPending) setHistoryRepairOpen(false);
      }}>
        <section className="workflow-history-repair-dialog" role="dialog" aria-modal="true" aria-labelledby="workflow-history-repair-title">
          <header>
            <div><small>历史工艺核对</small><h2 id="workflow-history-repair-title">{selected.code} · 接入 V{availableProductTimeVersion}</h2></div>
            <button type="button" disabled={routeActionPending} aria-label="关闭历史工艺核对" onClick={() => setHistoryRepairOpen(false)}><X size={18} /></button>
          </header>
          <div className="workflow-history-repair-warning">
            <AlertTriangle size={18} />
            <span><strong>只建立继续生产所需的工艺与数量基线</strong><small>原生产数量、旧进度和历史记录会完整保留；系统不会补造过去的报工或员工工时。</small></span>
          </div>
          <div className="workflow-history-repair-facts">
            <span><small>计划数量</small><strong>{selected.historicalRouteRepair.targetQuantity.toLocaleString()} 件</strong></span>
            <span><small>前端已转交</small><strong>{selected.historicalRouteRepair.transferredQuantity.toLocaleString()} 件</strong></span>
            <span><small>旧系统已完成</small><strong>{selected.historicalRouteRepair.completedQuantity.toLocaleString()} 件</strong></span>
            <span><small>原阶段</small><strong>{selected.historicalRouteRepair.legacyStage === 'backend' ? '后端' : selected.historicalRouteRepair.legacyStage === 'frontend' ? '前端' : '待开始'}</strong></span>
          </div>
          <label>
            <span>当前实际所在工序</span>
            <select value={historyRepairStepKey} onChange={event => {
              const stepKey = event.target.value;
              const step = selected.steps.find(item => item.key === stepKey);
              setHistoryRepairStepKey(stepKey);
              setHistoryRepairQuantity(step?.stageGroup === 'frontend'
                ? '0'
                : String(selected.historicalRouteRepair?.completedQuantity || 0));
            }}>
              {selected.steps.map((step, index) => <option key={step.key} value={step.key}>
                {index + 1}. {step.label}（{step.stageGroup ? stageLabels[step.stageGroup] : '工序'}）
              </option>)}
            </select>
            <small>该工序之前的节点会标记为“历史已完成”，之后从这里继续。</small>
          </label>
          <label>
            <span>该工序历史已完成数量</span>
            <input inputMode="numeric" min={0} value={historyRepairQuantity} onChange={event => setHistoryRepairQuantity(event.target.value.replace(/[^\d]/g, ''))} />
            <small>用于计算当前工序剩余数量；不会生成历史工时领取任务。</small>
          </label>
          <footer>
            <button type="button" disabled={routeActionPending} onClick={() => setHistoryRepairOpen(false)}>取消</button>
            <button className="primary" type="button" disabled={routeActionPending || !historyRepairStepKey} onClick={() => { void repairHistoricalRoute(); }}>
              {routeActionPending ? <Loader2 className="spin" size={15} /> : <PackageCheck size={15} />}
              确认并接入当前工序
            </button>
          </footer>
        </section>
      </div>}
    </main>
  );
}
