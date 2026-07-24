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
import { AppWorkbenchHeader } from '@/components/layout/AppWorkbenchHeader';
import type {
  CurrentUserDTO,
  WorkflowEntityType,
  WorkflowItemDTO,
  WorkflowProcessStatus,
  WorkflowStepDTO,
  WorkflowSummaryDTO,
  WorkflowWeekScope,
} from '@/types';

type WorkflowCenterShellProps = { user: CurrentUserDTO };
type WorkflowResponse = {
  ok: boolean;
  items: WorkflowItemDTO[];
  summary: WorkflowSummaryDTO;
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
const entityLabels: Record<WorkflowEntityType, string> = { issue: '问题', change: '变更', production: '生产' };
const statusLabels: Record<WorkflowProcessStatus, string> = { waiting: '待推进', processing: '处理中', verifying: '待验证', closed: '已完成' };
const priorityLabels = { urgent: '紧急', high: '高', normal: '一般' } as const;
const entityIcons = { issue: ShieldCheck, change: GitPullRequestArrow, production: LayoutDashboard };
const weekScopeLabels: Record<WorkflowWeekScope, string> = {
  all: '全部周期', carryover: '遗留未完', current: '本周', next: '下周', history: '历史周',
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

async function jsonRequest<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: 'no-store' });
  const data = await response.json().catch(() => ({ ok: false, error: '服务返回格式异常' })) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || '请求失败');
  return data;
}

export default function WorkflowCenterShell({ user }: WorkflowCenterShellProps) {
  const [keyword, setKeyword] = useState('');
  const [filters, setFilters] = useState<Filters>({ entityType: 'all', status: 'all', overdue: false, weekScope: 'all' });
  const [items, setItems] = useState<WorkflowItemDTO[]>([]);
  const [summary, setSummary] = useState<WorkflowSummaryDTO>(emptySummary);
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

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedWeekScope = params.get('weekScope');
    const weekScope: WorkflowWeekScope = requestedWeekScope === 'carryover'
      || requestedWeekScope === 'current'
      || requestedWeekScope === 'next'
      || requestedWeekScope === 'history'
      ? requestedWeekScope
      : 'all';
    const next: WorkflowDeepLink = {
      batchId: params.get('batchId') || '',
      workOrderId: params.get('workOrderId') || '',
      stepId: params.get('stepId') || '',
      fromPlanning: params.get('from') === 'planning',
      fromProduction: params.get('from') === 'production',
      returnTo: safeLocalRoute(params.get('returnTo')),
    };
    if (next.batchId) selectedIdRef.current = `production-plan:${next.batchId}`;
    setDeepLink(next);
    if (next.batchId || next.workOrderId) {
      setFilters(current => ({ ...current, entityType: 'production', weekScope }));
    } else if (weekScope !== 'all') {
      setFilters(current => ({ ...current, weekScope }));
    }
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
      if (filters.weekScope !== 'all') params.set('weekScope', filters.weekScope);
      if (deepLink.batchId) params.set('batchId', deepLink.batchId);
      if (deepLink.workOrderId) params.set('workOrderId', deepLink.workOrderId);
      const data = await jsonRequest<WorkflowResponse>(`/api/workflows?${params.toString()}`);
      setItems(data.items);
      setSummary(data.summary);
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
  }, [deepLink.batchId, deepLink.workOrderId, filters, keyword]);

  useEffect(() => {
    if (!deepLinkReady) return;
    const timer = window.setTimeout(() => { void load(); }, keyword ? 260 : 0);
    return () => window.clearTimeout(timer);
  }, [deepLinkReady, keyword, load]);

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

  const activeFilterCount = [filters.entityType !== 'all', filters.status !== 'all', filters.overdue, filters.weekScope !== 'all'].filter(Boolean).length;
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
  const hasPublishedProductRoute = Boolean(
    selected?.entityType === 'production'
    && selected.processRouteId
    && selected.routeSource === 'product_time_profile'
    && selected.productTimeProfileVersion !== null,
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
            {(['all', 'carryover', 'current', 'next', 'history'] as const).map(scope => (
              <button
                type="button"
                key={scope}
                className={filters.weekScope === scope ? 'active' : ''}
                onClick={() => setFilters(current => ({
                  ...current,
                  weekScope: scope,
                  entityType: scope === 'all' ? current.entityType : 'production',
                }))}
              >
                <CalendarDays size={13} aria-hidden="true" />
                {weekScopeLabels[scope]}
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

        <div className="workflow-workspace">
          <section className="workflow-list" aria-label="流程列表">
            <header><div><h2>流程实例</h2><span>{items.length} 条当前结果</span></div>{activeFilterCount > 0 && <button type="button" onClick={() => setFilters({ entityType: 'all', status: 'all', overdue: false, weekScope: 'all' })}>清除 {activeFilterCount}</button>}</header>
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
                      <div><span>动态工艺图</span><h3>产品工序流转</h3></div>
                      <div className="workflow-route-meta">
                        <span><PackageCheck size={13} />{(selected.quantity || 0).toLocaleString()} 件</span>
                        <span>R{selected.routeVersion || 1} · {selected.routeStatus ? routeStatusLabels[selected.routeStatus] : '待确认'}</span>
                        <span>{formatDate(selected.weekStartDate, false)} - {formatDate(selected.weekEndDate, false)}</span>
                        {selectedCurrentStep && <button type="button" onClick={() => focusProcessStep(selectedCurrentStep)}><LocateFixed size={13} />定位当前</button>}
                      </div>
                    </header>
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
                      : selected.steps[0]?.key === 'route-repair-required'
                        ? '该工单已经产生生产事实，系统不会静默改写历史。请先补齐已发布的产品工艺路线，再继续查看和推进工序。'
                        : '尚未找到已发布的产品工艺路线。请先在产品工序与工时中完成配置，生产流程会自动按真实工序显示。'}</p>
                  </div>
                  {selected.processStatus !== 'closed' && <a href={selected.route}>{selected.steps[0]?.key === 'route-repair-required' ? '补齐产品工序' : '配置产品工序'}<ArrowUpRight size={14} /></a>}
                </section> : <>
                  <section className="workflow-current-state"><div><span>当前节点</span><strong>{selected.currentStep}</strong><p>{selected.nextStep ? `下一节点：${selected.nextStep}` : '流程已到达终态'}</p></div><dl><div><dt>负责人</dt><dd>{selected.owner || '待分派'}</dd></div><div><dt>截止时间</dt><dd className={selected.isOverdue ? 'overdue' : ''}>{formatDate(selected.dueAt)}</dd></div><div><dt>最近更新</dt><dd>{formatDate(selected.updatedAt)}</dd></div></dl></section>
                  <section className="workflow-stepper"><header><h3>流程节点</h3><span>{entityLabels[selected.entityType]}闭环</span></header><ol>{selected.steps.map((step, index) => <li className={step.state} key={step.key}><span>{step.state === 'done' ? <CheckCircle2 size={16} /> : step.state === 'current' ? <CircleDot size={16} /> : index + 1}</span><div><strong>{step.label}</strong><small>{processStepStateLabel(step)}</small></div>{index < selected.steps.length - 1 && <ChevronRight size={15} aria-hidden="true" />}</li>)}</ol></section>
                </>}
                <section className="workflow-activity"><header><h3>最近记录</h3><span>最近 {Math.min(5, selected.activities.length)} / {selected.activities.length} 条</span></header><div>{selected.activities.slice(0, 5).map(item => <article key={item.id}><span /><div><strong>{item.label}</strong><p>{item.actor || '系统'} · {formatDate(item.createdAt)}</p></div></article>)}{!selected.activities.length && <p className="activity-empty">该流程暂时没有可展示的业务记录。</p>}{selected.activities.length > 5 && <details className="workflow-activity-more"><summary>展开其余 {selected.activities.length - 5} 条记录</summary><div>{selected.activities.slice(5).map(item => <article key={item.id}><span /><div><strong>{item.label}</strong><p>{item.actor || '系统'} · {formatDate(item.createdAt)}</p></div></article>)}</div></details>}</div></section>
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
    </main>
  );
}
