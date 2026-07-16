'use client';

import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  ChevronRight,
  CircleDot,
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
import { WorkbenchPageHeader } from '@/components/layout/WorkbenchPageHeader';
import type {
  CurrentUserDTO,
  WorkflowEntityType,
  WorkflowItemDTO,
  WorkflowProcessStatus,
  WorkflowSummaryDTO,
  WorkflowTemplateDTO,
} from '@/types';

type WorkflowCenterShellProps = { user: CurrentUserDTO };
type WorkflowResponse = {
  ok: boolean;
  items: WorkflowItemDTO[];
  summary: WorkflowSummaryDTO;
  templates: WorkflowTemplateDTO[];
  error?: string;
};
type Filters = { entityType: WorkflowEntityType | 'all'; status: WorkflowProcessStatus | 'all'; overdue: boolean };

const emptySummary: WorkflowSummaryDTO = {
  total: 0, waiting: 0, processing: 0, verifying: 0, closed: 0, overdue: 0, issue: 0, change: 0, production: 0,
};
const entityLabels: Record<WorkflowEntityType, string> = { issue: '问题', change: '变更', production: '生产' };
const statusLabels: Record<WorkflowProcessStatus, string> = { waiting: '待推进', processing: '处理中', verifying: '待验证', closed: '已完成' };
const priorityLabels = { urgent: '紧急', high: '高', normal: '一般' } as const;
const entityIcons = { issue: ShieldCheck, change: GitPullRequestArrow, production: LayoutDashboard };

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
  const [filters, setFilters] = useState<Filters>({ entityType: 'all', status: 'all', overdue: false });
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

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (keyword.trim()) params.set('keyword', keyword.trim());
      if (filters.entityType !== 'all') params.set('entityType', filters.entityType);
      if (filters.status !== 'all') params.set('status', filters.status);
      if (filters.overdue) params.set('overdue', 'true');
      const data = await jsonRequest<WorkflowResponse>(`/api/workflows?${params.toString()}`);
      setItems(data.items);
      setSummary(data.summary);
      setTemplates(data.templates);
      const desired = selectedIdRef.current || sessionStorage.getItem('hm-workflow-selected') || '';
      const nextSelected = data.items.find(item => item.id === desired) || data.items[0] || null;
      selectedIdRef.current = nextSelected?.id || '';
      setSelected(nextSelected);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '流程中心加载失败');
    } finally {
      setLoading(false);
    }
  }, [filters, keyword]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, keyword ? 260 : 0);
    return () => window.clearTimeout(timer);
  }, [keyword, load]);

  useEffect(() => {
    if (!selected) return;
    selectedIdRef.current = selected.id;
    sessionStorage.setItem('hm-workflow-selected', selected.id);
  }, [selected]);

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

  const activeFilterCount = [filters.entityType !== 'all', filters.status !== 'all', filters.overdue].filter(Boolean).length;
  const selectedTemplate = useMemo(() => templates.find(item => item.key === selected?.entityType) || null, [selected, templates]);

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
        <WorkbenchPageHeader
          kicker="协同中心"
          title="流程中心"
          titleId="workflow-page-title"
          description="统一查看问题闭环、变更闭环和生产流转，不重复创建业务数据。"
          actions={<button className="hm-workbench-button" type="button" disabled={loading} onClick={() => { void load(); }}><RefreshCw size={15} className={loading ? 'spin' : ''} />刷新流程</button>}
        />

        <section className="workflow-summary" aria-label="流程统计">
          {([
            ['全部流程', summary.total, 'all'], ['待推进', summary.waiting, 'waiting'], ['处理中', summary.processing, 'processing'],
            ['待验证', summary.verifying, 'verifying'], ['已完成', summary.closed, 'closed'],
          ] as const).map(([label, count, status]) => <button key={status} type="button" className={filters.status === status ? 'active' : ''} onClick={() => setFilters(current => ({ ...current, status }))}><span>{label}</span><strong>{count}</strong></button>)}
          <button type="button" className={`danger ${filters.overdue ? 'active' : ''}`} onClick={() => setFilters(current => ({ ...current, overdue: !current.overdue }))}><span>已逾期</span><strong>{summary.overdue}</strong></button>
        </section>

        <div className="workflow-workspace">
          <section className="workflow-list" aria-label="流程列表">
            <header><div><h2>流程实例</h2><span>{items.length} 条当前结果</span></div>{activeFilterCount > 0 && <button type="button" onClick={() => setFilters({ entityType: 'all', status: 'all', overdue: false })}>清除 {activeFilterCount}</button>}</header>
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
                <section className="workflow-current-state"><div><span>当前节点</span><strong>{selected.currentStep}</strong><p>{selected.nextStep ? `下一节点：${selected.nextStep}` : '流程已到达终态'}</p></div><dl><div><dt>负责人</dt><dd>{selected.owner || '待分派'}</dd></div><div><dt>截止时间</dt><dd className={selected.isOverdue ? 'overdue' : ''}>{formatDate(selected.dueAt)}</dd></div><div><dt>最近更新</dt><dd>{formatDate(selected.updatedAt)}</dd></div></dl></section>
                <section className="workflow-stepper"><header><h3>流程节点</h3><span>{selectedTemplate?.name || `${entityLabels[selected.entityType]}流程`}</span></header><ol>{selected.steps.map((step, index) => <li className={step.state} key={step.key}><span>{step.state === 'done' ? <CheckCircle2 size={16} /> : step.state === 'current' ? <CircleDot size={16} /> : index + 1}</span><div><strong>{step.label}</strong><small>{step.state === 'done' ? '已完成' : step.state === 'current' ? '当前节点' : '待进入'}</small></div>{index < selected.steps.length - 1 && <ChevronRight size={15} aria-hidden="true" />}</li>)}</ol></section>
                <section className="workflow-activity"><header><h3>最近记录</h3><span>{selected.activities.length} 条</span></header><div>{selected.activities.map(item => <article key={item.id}><span /><div><strong>{item.label}</strong><p>{item.actor || '系统'} · {formatDate(item.createdAt)}</p></div></article>)}{!selected.activities.length && <p className="activity-empty">该流程暂时没有可展示的业务记录。</p>}</div></section>
                <section className="workflow-source-note"><ListChecks size={18} /><div><strong>数据来源</strong><p>该条记录直接来自{selected.entityType === 'issue' ? '问题管理' : selected.entityType === 'change' ? '变更管理' : '当前启用的生产工单'}，状态更新请在来源模块完成。</p></div></section>
              </div>
              <footer className="workflow-detail-actions"><a href={selected.route}>打开来源业务<ArrowUpRight size={14} /></a>{selected.sourceRoute && <a className="secondary" href={selected.sourceRoute}>查看关联资料</a>}{compactContext && <button ref={contextTriggerRef} type="button" onClick={() => setContextOpen(true)}>流程模板与入口</button>}</footer>
            </>}
          </section>

          {compactContext && <button className={`workflow-context-scrim ${contextOpen ? 'open' : ''}`} type="button" aria-label="关闭流程模板面板" onClick={() => setContextOpen(false)} />}
          <aside ref={contextRef} className={`workflow-context ${compactContext && contextOpen ? 'open' : ''}`} aria-label="流程模板和快速入口">
            <header><div><span>业务流程</span><h2>模板与快速入口</h2></div>{compactContext && <button type="button" aria-label="关闭流程模板面板" title="关闭" onClick={() => { setContextOpen(false); window.requestAnimationFrame(() => contextTriggerRef.current?.focus()); }}><X size={18} /></button>}</header>
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
