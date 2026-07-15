'use client';

import type { CSSProperties } from 'react';
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { PortalMenu } from '@/components/PortalMenu';
import type { CurrentUserDTO } from '@/types';
import type { HomeActionItem, HomeDashboardData, HomeDistributionItem, HomeTone } from '@/types/home-dashboard';

type CompanyHomeDashboardProps = {
  user: CurrentUserDTO;
  data: HomeDashboardData;
};

type HomeSearchItem = {
  id: string;
  group: string;
  title: string;
  detail: string;
  route: string;
};

type SearchWorkOrder = { id: string; code: string; displayCode?: string; specification?: string | null; customerName?: string | null; productName?: string | null };
type SearchResourceFile = { id: string; workOrderId: string; categoryId: string; originalName: string; displayName?: string | null; workOrderCode?: string | null; categoryName?: string | null };
type SearchDrawingItem = { id: string; specification: string; customerName: string; productName?: string | null };
type SearchDrawingFile = { id: string; libraryItemId: string; originalName: string; displayName?: string | null; categoryName?: string | null; item: { specification: string; customerName: string } };
type SearchParameter = { id: string; model?: string | null; outerPeelMm?: string | null; innerPeelMm?: string | null; insertionLengthMm?: string | null };
type SearchManual = { id: string; title: string; manufacturer?: string | null; models: string[]; latestVersion?: { id: string; revision: string } | null };
type SearchManualAsset = { id: string; manualId: string; versionId: string; manualTitle: string; revision: string; originalName: string; displayName?: string | null; pageNo?: number | null };
type SearchPayload = {
  workOrders?: SearchWorkOrder[];
  resourceFiles?: SearchResourceFile[];
  drawingLibraryItems?: SearchDrawingItem[];
  drawingLibraryFiles?: SearchDrawingFile[];
  connectorParameters?: SearchParameter[];
  connectorAssemblyManuals?: SearchManual[];
  connectorAssemblyManualAssets?: SearchManualAsset[];
};
type SearchResponse = SearchPayload & { ok?: boolean; error?: string; data?: SearchPayload };

const sidebarGroups = [
  { label: '计划协同', items: [{ href: '/weekly-plan-center', label: '周计划', icon: '周' }] },
  { label: '技术资料', items: [
    { href: '/drawing-library', label: '图纸资料库', icon: '图' },
    { href: '/connector-parameters', label: '连接器参数', icon: '参' },
    { href: '/connector-assembly-manuals', label: '组装说明书', icon: '册' },
  ] },
  { label: '生产现场', items: [
    { href: '/production', label: '生产执行', icon: '产' },
    { href: '/dashboard', label: '工单资料库', icon: '单' },
  ] },
];

const quickLinks = [
  { href: '/production', label: '生产执行', detail: '阶段进度与异常', icon: '产', tone: 'orange' as HomeTone },
  { href: '/dashboard', label: '工单资料库', detail: '工单文件与预览', icon: '单', tone: 'blue' as HomeTone },
  { href: '/weekly-plan-center', label: '周计划', detail: '计划导入与切换', icon: '周', tone: 'green' as HomeTone },
  { href: '/drawing-library', label: '图纸资料库', detail: '图纸归档与查找', icon: '图', tone: 'yellow' as HomeTone },
  { href: '/connector-parameters', label: '连接器参数', detail: '工艺参数查询', icon: '参', tone: 'slate' as HomeTone },
  { href: '/connector-assembly-manuals', label: '组装说明书', detail: '版本与目录预览', icon: '册', tone: 'red' as HomeTone },
];

function decodedName(value: string): string {
  try { return decodeURIComponent(value); } catch { return value; }
}

function searchItems(payload: SearchPayload, keyword: string): HomeSearchItem[] {
  const items: HomeSearchItem[] = [];
  for (const order of payload.workOrders || []) {
    items.push({
      id: `work-order:${order.id}`, group: '生产工单',
      title: order.specification || order.displayCode || order.code,
      detail: `${order.customerName || '客户未设置'} · ${order.productName || '品名未设置'}`,
      route: `/dashboard?workOrderId=${encodeURIComponent(order.id)}`,
    });
  }
  for (const file of payload.resourceFiles || []) {
    const params = new URLSearchParams({ workOrderId: file.workOrderId, categoryId: file.categoryId, fileId: file.id });
    items.push({ id: `resource:${file.id}`, group: '生产文件', title: decodedName(file.displayName || file.originalName), detail: `${file.workOrderCode || '工单'} · ${file.categoryName || '未分类'}`, route: `/dashboard?${params.toString()}` });
  }
  for (const item of payload.drawingLibraryItems || []) {
    const params = new URLSearchParams({ itemId: item.id, keyword });
    items.push({ id: `drawing-item:${item.id}`, group: '图纸资料', title: item.specification, detail: `${item.customerName} · ${item.productName || '品名未设置'}`, route: `/drawing-library?${params.toString()}` });
  }
  for (const file of payload.drawingLibraryFiles || []) {
    const params = new URLSearchParams({ itemId: file.libraryItemId, fileId: file.id, keyword });
    items.push({ id: `drawing-file:${file.id}`, group: '图纸文件', title: decodedName(file.displayName || file.originalName), detail: `${file.item.specification} · ${file.categoryName || '未分类'}`, route: `/drawing-library?${params.toString()}` });
  }
  for (const parameter of payload.connectorParameters || []) {
    items.push({ id: `parameter:${parameter.id}`, group: '连接器参数', title: parameter.model || '型号未设置', detail: `外剥 ${parameter.outerPeelMm || '-'} · 内剥 ${parameter.innerPeelMm || '-'} · 入长 ${parameter.insertionLengthMm || '-'}`, route: `/connector-parameters?keyword=${encodeURIComponent(keyword)}` });
  }
  for (const manual of payload.connectorAssemblyManuals || []) {
    const params = new URLSearchParams({ manualId: manual.id });
    if (manual.latestVersion?.id) params.set('versionId', manual.latestVersion.id);
    items.push({ id: `manual:${manual.id}`, group: '组装说明书', title: manual.title, detail: `${manual.models.join(' / ') || '未关联型号'} · ${manual.latestVersion?.revision || '暂无版本'}`, route: `/connector-assembly-manuals?${params.toString()}` });
  }
  for (const asset of payload.connectorAssemblyManualAssets || []) {
    const params = new URLSearchParams({ manualId: asset.manualId, versionId: asset.versionId });
    if (asset.pageNo) params.set('page', String(asset.pageNo));
    items.push({ id: `manual-asset:${asset.id}`, group: '说明书文件', title: decodedName(asset.displayName || asset.originalName), detail: `${asset.manualTitle} · ${asset.revision}`, route: `/connector-assembly-manuals?${params.toString()}` });
  }
  return items.slice(0, 18);
}

function updatedTime(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(value));
}

function priorityLabel(value: HomeActionItem['priority']): string {
  return value === 'urgent' ? '紧急' : value === 'high' ? '重要' : '常规';
}

function EmptyState({ children }: { children: string }) {
  return <div className="hm-home-empty"><span aria-hidden="true">✓</span><p>{children}</p></div>;
}

function SectionHeading({ title, meta, href }: { title: string; meta?: string; href?: string }) {
  return (
    <header className="hm-home-section-heading">
      <div><h2>{title}</h2>{meta && <span>{meta}</span>}</div>
      {href && <a href={href}>查看全部 <span aria-hidden="true">→</span></a>}
    </header>
  );
}

function ActionList({ items }: { items: HomeActionItem[] }) {
  if (!items.length) return <EmptyState>当前没有需要集中处理的事项</EmptyState>;
  return (
    <div className="hm-home-action-list">
      {items.map(item => (
        <a className="hm-home-action-row" href={item.targetRoute} key={item.id}>
          <span className={`hm-home-priority ${item.priority}`}>{priorityLabel(item.priority)}</span>
          <span className="hm-home-action-copy"><strong title={item.subtitle}>{item.title}</strong><small title={item.subtitle}>{item.subtitle}</small></span>
          <span className="hm-home-action-status"><b>{item.status}</b><small>{item.dateLabel}</small></span>
          <span className="hm-home-row-arrow" aria-hidden="true">›</span>
        </a>
      ))}
    </div>
  );
}

function DistributionChart({ items }: { items: HomeDistributionItem[] }) {
  const max = Math.max(...items.map(item => item.value), 1);
  return (
    <div className="hm-home-distribution">
      {items.map(item => (
        <div className="hm-home-distribution-row" key={item.id}>
          <span><i className={`tone-${item.tone}`} />{item.label}</span>
          <div aria-hidden="true"><b className={`tone-${item.tone}`} style={{ width: `${Math.max(item.value > 0 ? 7 : 0, (item.value / max) * 100)}%` }} /></div>
          <strong>{item.value}</strong>
        </div>
      ))}
    </div>
  );
}

export default function CompanyHomeDashboard({ user, data }: CompanyHomeDashboardProps) {
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [keyword, setKeyword] = useState('');
  const [results, setResults] = useState<HomeSearchItem[]>([]);
  const [refreshing, startRefresh] = useTransition();
  const sidebarButtonRef = useRef<HTMLButtonElement>(null);
  const accountButtonRef = useRef<HTMLButtonElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchWrapRef = useRef<HTMLDivElement>(null);
  const displayName = user.displayName || user.username;

  useEffect(() => {
    const query = keyword.trim();
    if (!query) {
      setResults([]);
      setSearchError('');
      setSearchOpen(false);
      setSearchLoading(false);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setSearchLoading(true);
      setSearchError('');
      setSearchOpen(true);
      try {
        const response = await fetch(`/api/search?keyword=${encodeURIComponent(query)}`, { cache: 'no-store', signal: controller.signal });
        const body = await response.json() as SearchResponse;
        if (!response.ok) throw new Error(body.error || '搜索失败');
        setResults(searchItems(body.data || body, query));
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setResults([]);
        setSearchError(error instanceof Error ? error.message : '搜索失败，请稍后重试');
      } finally {
        setSearchLoading(false);
      }
    }, 280);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [keyword]);

  useEffect(() => {
    function onPointerDown(event: PointerEvent): void {
      if (searchWrapRef.current && !searchWrapRef.current.contains(event.target as Node)) setSearchOpen(false);
    }
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'Escape') return;
      if (sidebarOpen) {
        setSidebarOpen(false);
        window.requestAnimationFrame(() => sidebarButtonRef.current?.focus());
      } else if (searchOpen) {
        setSearchOpen(false);
        window.requestAnimationFrame(() => searchInputRef.current?.focus());
      }
    }
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [searchOpen, sidebarOpen]);

  const searchGroups = useMemo(() => {
    const groups = new Map<string, HomeSearchItem[]>();
    for (const item of results) groups.set(item.group, [...(groups.get(item.group) || []), item]);
    return [...groups.entries()];
  }, [results]);

  async function logout(): Promise<void> {
    await fetch('/api/auth/logout', { method: 'POST' });
    location.href = '/login';
  }

  function refresh(): void {
    startRefresh(() => router.refresh());
  }

  const donutStyle = { '--hm-home-rate': `${data.planChart.executionRate || 0}%` } as CSSProperties;

  return (
    <main className={`hm-home-shell ${sidebarOpen ? 'sidebar-open' : ''}`}>
      <button className="hm-home-sidebar-scrim" type="button" aria-label="关闭导航" onClick={() => { setSidebarOpen(false); sidebarButtonRef.current?.focus(); }} />
      <aside className="hm-home-sidebar" id="hm-home-sidebar" aria-label="公司协同主导航">
        <div className="hm-home-brand">
          <span aria-hidden="true">制</span>
          <div><strong>工单资料库</strong><small>计划 · 技术 · 生产协同平台</small></div>
        </div>
        <nav>
          <a className="hm-home-nav-item active" href="/home" aria-current="page" title="首页"><span aria-hidden="true">首</span><b>首页</b></a>
          {sidebarGroups.map(group => (
            <section className="hm-home-nav-group" key={group.label}>
              <h2>{group.label}</h2>
              {group.items.map(item => <a className="hm-home-nav-item" href={item.href} key={item.href} title={item.label}><span aria-hidden="true">{item.icon}</span><b>{item.label}</b></a>)}
            </section>
          ))}
        </nav>
        <div className="hm-home-sidebar-foot"><span aria-hidden="true">协</span><p><strong>协同工作台</strong><small>共享业务数据</small></p></div>
      </aside>

      <div className="hm-home-frame">
        <header className="hm-home-toolbar">
          <button ref={sidebarButtonRef} className="hm-home-menu-button" type="button" aria-label="打开主导航" aria-controls="hm-home-sidebar" aria-expanded={sidebarOpen} onClick={() => setSidebarOpen(true)}><span aria-hidden="true">☰</span></button>
          <div className="hm-home-toolbar-title"><strong>首页</strong><span>协同总览</span></div>
          <div className="hm-home-search" ref={searchWrapRef}>
            <label className="sr-only" htmlFor="hm-home-global-search">全局搜索</label>
            <span aria-hidden="true">⌕</span>
            <input ref={searchInputRef} id="hm-home-global-search" value={keyword} onChange={event => setKeyword(event.target.value)} onFocus={() => keyword.trim() && setSearchOpen(true)} placeholder="搜索工单、文件、图纸、参数和说明书" autoComplete="off" />
            {keyword && <button type="button" aria-label="清空搜索" title="清空搜索" onClick={() => { setKeyword(''); searchInputRef.current?.focus(); }}>×</button>}
            {searchOpen && keyword.trim() && (
              <div className="hm-home-search-results" role="region" aria-label="全局搜索结果" aria-live="polite">
                {searchLoading && <div className="hm-home-search-state"><span className="hm-home-spinner" />正在搜索</div>}
                {!searchLoading && searchError && <div className="hm-home-search-state error">{searchError}</div>}
                {!searchLoading && !searchError && !results.length && <div className="hm-home-search-state">未找到匹配结果</div>}
                {!searchLoading && !searchError && searchGroups.map(([group, items]) => (
                  <section key={group}><h3>{group}</h3>{items.map(item => <a href={item.route} key={item.id} onClick={() => setSearchOpen(false)}><strong>{item.title}</strong><span>{item.detail}</span></a>)}</section>
                ))}
              </div>
            )}
          </div>
          <button className="hm-home-icon-button" type="button" aria-label="刷新首页数据" title="刷新首页数据" disabled={refreshing} onClick={refresh}><span className={refreshing ? 'is-spinning' : ''} aria-hidden="true">↻</span></button>
          <div className="hm-home-account-wrap">
            <button ref={accountButtonRef} className="hm-home-account" type="button" aria-label={`${displayName}，打开账号菜单`} aria-expanded={accountOpen} onClick={() => setAccountOpen(value => !value)}>
              <span aria-hidden="true">{displayName.slice(0, 1)}</span><b>{displayName}</b><i aria-hidden="true">⌄</i>
            </button>
            <PortalMenu open={accountOpen} anchorRef={accountButtonRef} className="hm-home-user-menu" width={176} onClose={() => setAccountOpen(false)}>
              <button type="button" onClick={() => { setAccountOpen(false); location.href = '/dashboard?openSettings=1'; }}>系统设置</button>
              <button type="button" onClick={() => { setAccountOpen(false); void logout(); }}>退出登录</button>
            </PortalMenu>
          </div>
        </header>

        <div className="hm-home-content">
          {data.error && <div className="hm-home-error" role="alert"><span>首页数据加载失败</span><p>{data.error}</p><button type="button" onClick={refresh} disabled={refreshing}>重新加载</button></div>}
          <section className="hm-home-welcome">
            <div><span>计划、技术、生产协同工作台</span><h1>{data.greeting}，{displayName}</h1><p>{data.dateLabel} · {data.periodLabel}</p></div>
            <div className="hm-home-updated"><span>数据最后更新</span><strong>{updatedTime(data.generatedAt)}</strong><small>{refreshing ? '正在刷新' : '实时读取当前业务数据'}</small></div>
          </section>

          <section className="hm-home-kpis" aria-label="本周生产关键指标">
            {data.kpis.map(kpi => (
              <a className={`hm-home-kpi tone-${kpi.tone}`} href={kpi.route} key={kpi.id}>
                <span className="hm-home-kpi-icon" aria-hidden="true">{kpi.icon}</span>
                <div><small>{kpi.label}</small><strong>{kpi.value === null ? '--' : kpi.value}</strong><p>{kpi.description}</p></div>
                <i aria-hidden="true">↗</i>
              </a>
            ))}
          </section>

          <section className="hm-home-primary-grid">
            <article className="hm-home-panel hm-home-actions-panel">
              <SectionHeading title="待处理事项" meta={`${data.actionItems.length} 项优先展示`} href="/production?view=exceptions" />
              <ActionList items={data.actionItems} />
            </article>

            <div className="hm-home-middle-stack">
              <article className="hm-home-panel hm-home-quick-panel">
                <SectionHeading title="快速入口" meta="现有业务模块" />
                <div className="hm-home-quick-grid">
                  {quickLinks.map(link => <a href={link.href} key={link.href}><span className={`tone-${link.tone}`} aria-hidden="true">{link.icon}</span><p><strong>{link.label}</strong><small>{link.detail}</small></p><i aria-hidden="true">›</i></a>)}
                </div>
              </article>
              <article className="hm-home-panel hm-home-timeline-panel">
                <SectionHeading title="今日节点" meta="不虚构具体时间" />
                {!data.todayNodes.length ? <EmptyState>今天没有已记录的关键节点</EmptyState> : <div className="hm-home-timeline">{data.todayNodes.map(node => <a href={node.targetRoute} key={node.id}><span /><div><small>{node.dateLabel} · {node.type}</small><strong title={node.title}>{node.title}</strong><p>{node.source} · {node.status}</p></div></a>)}</div>}
              </article>
            </div>

            <article className="hm-home-panel hm-home-issues-panel">
              <SectionHeading title="现场问题看板" meta="真实生产异常" href="/production?view=exceptions" />
              {!data.issues.length ? <EmptyState>当前没有现场异常</EmptyState> : <div className="hm-home-issue-list">{data.issues.map(issue => <a href={issue.targetRoute} key={issue.id}><span className={`hm-home-severity ${issue.priority}`} /> <div><strong>{issue.title}</strong><p title={issue.subtitle}>{issue.subtitle}</p><small>{issue.status} · {issue.dateLabel}</small></div><i aria-hidden="true">›</i></a>)}</div>}
            </article>
          </section>

          <section className="hm-home-charts" aria-label="协同数据图表">
            <article className="hm-home-panel hm-home-plan-chart">
              <SectionHeading title="本周计划执行情况" meta={`${data.planChart.total} 个有效工单`} />
              <div className="hm-home-plan-chart-body">
                <div className="hm-home-donut" style={donutStyle}><div><strong>{data.planChart.executionRate === null ? '--' : `${data.planChart.executionRate}%`}</strong><span>执行率</span></div></div>
                <dl><div><dt>已完成</dt><dd>{data.planChart.completed}</dd></div><div><dt>执行中</dt><dd>{data.planChart.inProgress}</dd></div><div><dt>未开始</dt><dd>{data.planChart.notStarted}</dd></div><div><dt>逾期</dt><dd>{data.planChart.overdue}</dd></div></dl>
              </div>
            </article>
            <article className="hm-home-panel"><SectionHeading title="工单阶段分布" meta="按数量分段卡片口径" /><DistributionChart items={data.stageDistribution} /></article>
            <article className="hm-home-panel"><SectionHeading title="技术资料状态" meta="当前周计划工单" /><DistributionChart items={data.technicalDistribution} /></article>
          </section>

          <section className="hm-home-collaboration" aria-label="计划到完成协作链路">
            <SectionHeading title="协作链路概览" meta="现有业务数据汇总，不改变工单状态" />
            <div>{data.collaboration.map((node, index) => <span className="hm-home-flow-part" key={node.id}>{index > 0 && <i aria-hidden="true">→</i>}<a className={`tone-${node.tone}`} href={node.route}><small>0{index + 1}</small><p><strong>{node.label}</strong><span>{node.description}</span></p><b>{node.value}</b></a></span>)}</div>
          </section>
        </div>
      </div>
    </main>
  );
}
