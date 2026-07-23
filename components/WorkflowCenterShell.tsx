'use client';

import {
  AlertTriangle,
  ArrowLeft,
  ArrowUpRight,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  Clock3,
  FileText,
  GitPullRequestArrow,
  LayoutDashboard,
  ListChecks,
  Loader2,
  RefreshCw,
  Search,
  ShieldCheck,
  TimerReset,
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
  WorkflowTemplateDTO,
  WorkflowWeekScope,
} from '@/types';

type WorkflowCenterShellProps = { user: CurrentUserDTO };
type WorkflowResponse = {
  ok: boolean;
  items: WorkflowItemDTO[];
  summary: WorkflowSummaryDTO;
  templates: WorkflowTemplateDTO[];
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
  const [templates, setTemplates] = useState<WorkflowTemplateDTO[]>([]);
  const [selected, setSelected] = useState<WorkflowItemDTO | null>(null);
  const selectedIdRef = useRef('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [contextOpen, setContextOpen] = useState(false);
  const [compactContext, setCompactContext] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const contextRef = useRef<HTMLElement>(null);
  const contextTriggerRef = useRef<HTMLButtonElement>(null);
  const deepLinkStepRef = useRef<HTMLElement>(null);
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
      setTemplates(data.templates);
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
  }, [selected]);

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

  useEffect(() => {
    const media = window.matchMedia('(max-width: 1100px)');
    const sync = (): void => setCompactContext(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    if (!contextOpen || !compactContext) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const panel = contextRef.current;
    const focusable = (): HTMLElement[] => panel ? Array.from(panel.querySelectorAll<HTMLElement>('button:not([disabled]), a[href]')) : [];
    window.requestAnimationFrame(() => focusable()[0]?.focus());
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        setContextOpen(false);
        window.requestAnimationFrame(() => contextTriggerRef.current?.focus());
        return;
      }
      if (event.key !== 'Tab') return;
      const nodes = focusable();
      if (!nodes.length) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [compactContext, contextOpen]);

  useEffect(() => {
    const panel = contextRef.current;
    if (!panel) return;
    if (compactContext && !contextOpen) panel.setAttribute('inert', '');
    else panel.removeAttribute('inert');
  }, [compactContext, contextOpen]);

  async function logout(): Promise<void> {
    await fetch('/api/auth/logout', { method: 'POST' });
    location.href = '/login';
  }

  const activeFilterCount = [filters.entityType !== 'all', filters.status !== 'all', filters.overdue, filters.weekScope !== 'all'].filter(Boolean).length;
  const selectedTemplate = useMemo(() => templates.find(item => item.key === selected?.entityType) || null, [selected, templates]);
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
  const selectedCurrentStep = useMemo(() => {
    if (!selected) return null;
    return selected.steps.find(step => step.key === deepLink.stepId)
      || selected.steps.find(step => step.state === 'current')
      || null;
  }, [deepLink.stepId, selected]);
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
  const manualReportRoute = selectedCurrentStep ? manualReportHref(selectedCurrentStep) : null;

  return (
    <main className="hm-workbench-root hm-workflow-center">
      <AppWorkbenchHeader
        user={user}
        activeHref="/workspace/workflows"
        subtitle="真实业务流程统一查看"
        menuItems={[{ label: '系统设置', href: '/dashboard?openSettings=1' }, { label: '退出登录', onSelect: () => { void logout(); } }]}
        searchSlot={<label className="workflow-global-search"><Search size={16} aria-hidden="true" /><input value={keyword} onChange={event => setKeyword(event.target.value)} placeholder="搜索流程编号、标题、工单、规格或负责人" aria-label="搜索流程" />{keyword && <button type="button" aria-label="清空搜索" title="清空搜索" onClick={() => setKeyword('')}><X size={14} /></button>}</label>}
        utilityActions={<a className="workflow-new-change" href="/workspace/changes?action=new"><GitPullRequestArrow size={15} />发起变更</a>}
      />

      <div className="workflow-page-frame">
        <section className="workflow-command-bar" aria-labelledby="workflow-page-title">
          <div className="workflow-command-title">
            <span>协同中心</span>
            <strong id="workflow-page-title">流程中心</strong>
            <small>问题、变更与生产工序统一跟踪</small>
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
              <header className="workflow-detail-header"><div><span>{entityLabels[selected.entityType]}流程 · {selected.code}</span><h2 title={selected.title}>{selected.title}</h2><p>{selected.subtitle}</p></div><div><span className={`workflow-status status-${selected.processStatus}`}>{statusLabels[selected.processStatus]}</span><a href={selected.route}>进入处理<ArrowUpRight size={14} /></a></div></header>
              <div className="workflow-detail-scroll hm-scroll-region">
                {hasPublishedProductRoute ? <>
                  <section className="workflow-route-overview">
                    <div className="workflow-route-current">
                      <span>当前工序</span>
                      <strong>{selected.currentStep}</strong>
                      <p>{selected.nextStep ? `下一步：${selected.nextStep}` : '全部工序完成后进入归档'}</p>
                    </div>
                    <dl>
                      <div><dt>生产数量</dt><dd>{(selected.quantity || 0).toLocaleString()} 件</dd></div>
                      <div><dt>路线版本</dt><dd>R{selected.routeVersion || 1} · {selected.routeStatus ? routeStatusLabels[selected.routeStatus] : '待确认'}</dd></div>
                      <div><dt>生产周期</dt><dd>{formatDate(selected.weekStartDate, false)} - {formatDate(selected.weekEndDate, false)}</dd></div>
                      <div><dt>最近更新</dt><dd>{formatDate(selected.updatedAt)}</dd></div>
                    </dl>
                  </section>

                  <section className="workflow-process-route">
                    <header>
                      <div><span>真实生产路线</span><h3>产品工序流转</h3></div>
                      <p>并行组内工序可同时推进，整组完成后进入下一组。</p>
                    </header>
                    <div className="workflow-route-groups">
                      {selectedRouteGroups.map(([group, steps], groupIndex) => {
                        const groupState = steps.every(step => step.state === 'done')
                          ? 'done'
                          : steps.some(step => step.state === 'current') ? 'current' : 'pending';
                        return <div className={`workflow-route-group ${groupState}`} key={group}>
                          <div className="workflow-group-marker">
                            <span>{groupState === 'done' ? <CheckCircle2 size={15} /> : groupState === 'current' ? <CircleDot size={15} /> : group}</span>
                            <div><strong>第 {group} 组</strong><small>{steps.length > 1 ? `${steps.length} 道并行工序` : '顺序工序'}</small></div>
                          </div>
                          <div className="workflow-process-cards">
                            {steps.map(step => {
                               const input = step.inputQuantity ?? selected.quantity ?? 0;
                               const processed = step.processedQuantity || 0;
                               const good = step.reportedGoodQuantity || 0;
                               const defect = step.defectQuantity || 0;
                               const released = step.releasedGoodQuantity || 0;
                               const unitLabel = step.unitLabel || '件';
                               const progress = input > 0
                                 ? Math.min(100, Math.round((processed / input) * 100))
                                 : step.state === 'done' ? 100 : 0;
                               const isDeepLinked = step.key === deepLink.stepId;
                               const stepManualReportRoute = manualReportHref(step);
                               const laborStatusText = step.laborPendingStandard
                                 ? '工时标准待补'
                                 : step.hasLaborPool
                                   ? (step.laborRemainingQuantity || 0) > 0
                                      ? `${step.latestEmployeeName ? `${step.latestEmployeeName} · ` : ''}待领 ${(step.laborRemainingQuantity || 0).toLocaleString()} ${unitLabel}`
                                     : step.latestEmployeeName || '工时已领取'
                                   : '工时尚未生成';
                              return <article
                                key={step.key}
                                ref={isDeepLinked ? deepLinkStepRef : undefined}
                                className={`workflow-process-card ${step.state}${isDeepLinked ? ' deep-linked' : ''}`}
                              >
                                <header>
                                  <span className={`stage-${step.stageGroup || 'frontend'}`}>{step.stageGroup ? stageLabels[step.stageGroup] : '工序'}</span>
                                  <strong>{step.label}</strong>
                                  <em>{processStepStateLabel(step)}</em>
                                </header>
                                <div className="workflow-process-metrics">
                                  <span><Clock3 size={13} />{formatDuration(step.standardMillisecondsPerUnit)}</span>
                                  <span><ListChecks size={13} />已处理 {processed.toLocaleString()} / {input.toLocaleString()} {unitLabel}</span>
                                  <span><UserRound size={13} />{laborStatusText}</span>
                                </div>
                                <div className="workflow-process-progress" aria-label={`${step.label}完成${progress}%`}>
                                  <span style={{ width: `${progress}%` }} />
                                </div>
                                <footer>
                                  <div>
                                   <span>{step.completedAt ? `完成 ${formatDate(step.completedAt)}` : step.startedAt ? `开始 ${formatDate(step.startedAt)}` : '尚未开始'}</span>
                                   <span>良品 {good.toLocaleString()} · 不良 {defect.toLocaleString()} · 已放行 {released.toLocaleString()} {unitLabel}</span>
                                   <span>待处理 {(step.remainingProcessQuantity ?? Math.max(0, input - processed)).toLocaleString()} {unitLabel} · 工时已领 {(step.laborClaimedQuantity || 0).toLocaleString()} / {(step.laborEligibleQuantity || 0).toLocaleString()} {unitLabel}</span>
                                  </div>
                                  {stepManualReportRoute && <a href={stepManualReportRoute}>工时领取<ArrowUpRight size={13} /></a>}
                                </footer>
                                {(step.productRemark || step.remark) && <div className="workflow-step-notes">
                                  {step.productRemark && <p><strong>产品标准</strong>{step.productRemark}</p>}
                                  {step.remark && <p><strong>工序备注</strong>{step.remark}</p>}
                                </div>}
                              </article>;
                            })}
                          </div>
                          {groupIndex < selectedRouteGroups.length - 1 && <div className="workflow-group-connector"><span /><ChevronRight size={15} /></div>}
                        </div>;
                      })}
                    </div>
                  </section>

                  <section className="workflow-route-notes">
                    <article><FileText size={16} /><div><strong>产品标准备注</strong><p>{selected.productRemark || '未填写产品标准备注'}</p></div></article>
                    <article><FileText size={16} /><div><strong>当前工单临时备注</strong><p>{selected.orderRemark || '未填写本批次临时备注'}</p></div></article>
                  </section>
                </> : <>
                  <section className="workflow-current-state"><div><span>当前节点</span><strong>{selected.currentStep}</strong><p>{selected.nextStep ? `下一节点：${selected.nextStep}` : '流程已到达终态'}</p></div><dl><div><dt>负责人</dt><dd>{selected.owner || '待分派'}</dd></div><div><dt>截止时间</dt><dd className={selected.isOverdue ? 'overdue' : ''}>{formatDate(selected.dueAt)}</dd></div><div><dt>最近更新</dt><dd>{formatDate(selected.updatedAt)}</dd></div></dl></section>
                  <section className="workflow-stepper"><header><h3>流程节点</h3><span>{selectedTemplate?.name || `${entityLabels[selected.entityType]}流程`}</span></header><ol>{selected.steps.map((step, index) => <li className={step.state} key={step.key}><span>{step.state === 'done' ? <CheckCircle2 size={16} /> : step.state === 'current' ? <CircleDot size={16} /> : index + 1}</span><div><strong>{step.label}</strong><small>{processStepStateLabel(step)}</small></div>{index < selected.steps.length - 1 && <ChevronRight size={15} aria-hidden="true" />}</li>)}</ol></section>
                </>}
                <section className="workflow-activity"><header><h3>最近记录</h3><span>{selected.activities.length} 条</span></header><div>{selected.activities.map(item => <article key={item.id}><span /><div><strong>{item.label}</strong><p>{item.actor || '系统'} · {formatDate(item.createdAt)}</p></div></article>)}{!selected.activities.length && <p className="activity-empty">该流程暂时没有可展示的业务记录。</p>}</div></section>
                <section className="workflow-source-note"><ListChecks size={18} /><div><strong>数据来源</strong><p>该条记录直接来自{selected.entityType === 'issue' ? '问题管理' : selected.entityType === 'change' ? '变更管理' : '计划批次及其关联生产工单'}，状态更新请在来源模块完成。</p></div></section>
              </div>
              <footer className="workflow-detail-actions">
                {manualReportRoute && <a href={manualReportRoute}>工时领取<ArrowUpRight size={14} /></a>}
                <a className={manualReportRoute ? 'secondary' : ''} href={selected.route}>{selected.entityType === 'production' ? '打开生产执行' : '打开来源业务'}<ArrowUpRight size={14} /></a>
                {selected.sourceRoute && <a className="secondary" href={selected.sourceRoute}>查看关联资料</a>}
                {compactContext && <button ref={contextTriggerRef} type="button" onClick={() => setContextOpen(true)}>流程上下文与入口</button>}
              </footer>
            </>}
          </section>

          {compactContext && <button className={`workflow-context-scrim ${contextOpen ? 'open' : ''}`} type="button" aria-label="关闭流程上下文面板" onClick={() => setContextOpen(false)} />}
          <aside ref={contextRef} className={`workflow-context ${compactContext && contextOpen ? 'open' : ''}`} aria-label="流程上下文和快速入口">
            <header><div><span>业务流程</span><h2>流程上下文与入口</h2></div>{compactContext && <button type="button" aria-label="关闭流程上下文面板" title="关闭" onClick={() => { setContextOpen(false); window.requestAnimationFrame(() => contextTriggerRef.current?.focus()); }}><X size={18} /></button>}</header>
            <div className="workflow-context-scroll hm-scroll-region">
              <section className="workflow-governance"><TimerReset size={20} /><div><strong>一处查看，回源处理</strong><p>流程中心不复制业务数据，避免同一事项出现两套状态。</p></div></section>
              <section className="workflow-templates"><h3>已接入流程</h3>{templates.map(template => {
                const Icon = entityIcons[template.key];
                return <article key={template.key} className={selected?.entityType === template.key ? 'active' : ''}><header><span className={`entity-${template.key}`}><Icon size={16} /></span><div><strong>{template.name}</strong><small>{summary[template.key]} 条真实记录</small></div><a href={template.route} aria-label={`打开${template.name}`} title={`打开${template.name}`}><ArrowUpRight size={14} /></a></header><p>{template.description}</p><ol>{template.steps.map((step, index) => <li key={step}><span>{index + 1}</span>{step}</li>)}</ol></article>;
              })}</section>
              <section className="workflow-quick-actions"><h3>新建协同事项</h3><a href="/workspace/issues?action=new"><ShieldCheck size={15} /><div><strong>新建问题</strong><span>记录并跟踪生产、计划或技术问题</span></div><ChevronRight size={14} /></a><a href="/workspace/changes?action=new"><GitPullRequestArrow size={15} /><div><strong>新建变更</strong><span>发起影响评估、实施和验证闭环</span></div><ChevronRight size={14} /></a></section>
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}
