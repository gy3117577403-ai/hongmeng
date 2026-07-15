'use client';

import Image from 'next/image';
import type { CSSProperties } from 'react';
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  Archive,
  BarChart3,
  Bell,
  BookOpen,
  Boxes,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  ClipboardCheck,
  Clock3,
  FileCheck2,
  FileStack,
  FileText,
  FolderKanban,
  GitPullRequestArrow,
  Home,
  Inbox,
  LayoutDashboard,
  ListChecks,
  MessageSquareText,
  PackageCheck,
  PanelLeftOpen,
  PlusCircle,
  RefreshCw,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Star,
  Users,
  Workflow,
  Wrench,
  X,
  type LucideIcon,
} from 'lucide-react';
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

type NavigationItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  badge?: 'actions';
};

type UtilityPanel = 'notifications' | 'messages' | 'help' | null;

const topNavigation = [
  { href: '/home', label: '首页' },
  { href: '/weekly-plan-center', label: '计划' },
  { href: '/workspace/reviews', label: '评审' },
  { href: '/workspace/issues', label: '问题' },
  { href: '/workspace/knowledge', label: '知识' },
  { href: '/workspace/reports', label: '报表' },
];

const sidebarGroups: Array<{ label: string; items: NavigationItem[] }> = [
  {
    label: '我的工作',
    items: [
      { href: '/production?view=exceptions', label: '待办事项', icon: ClipboardCheck, badge: 'actions' },
      { href: '/workspace/initiated', label: '我发起的', icon: Send },
      { href: '/workspace/involved', label: '我参与的', icon: Inbox },
      { href: '/workspace/copied', label: '抄送我的', icon: Archive },
      { href: '/workspace/following', label: '我关注的', icon: Star },
    ],
  },
  {
    label: '业务中心',
    items: [
      { href: '/production', label: '生产执行', icon: LayoutDashboard },
      { href: '/dashboard', label: '生产工单', icon: FileCheck2 },
      { href: '/weekly-plan-center', label: '周计划', icon: CalendarDays },
      { href: '/drawing-library', label: '图纸资料库', icon: FolderKanban },
      { href: '/connector-assembly-manuals', label: '组装说明书', icon: BookOpen },
      { href: '/connector-parameters', label: '连接器参数', icon: Boxes },
    ],
  },
  {
    label: '协同中心',
    items: [
      { href: '/workspace/issues', label: '问题管理', icon: ShieldCheck },
      { href: '/workspace/changes', label: '变更管理', icon: GitPullRequestArrow },
      { href: '/workspace/workflows', label: '流程中心', icon: Workflow },
      { href: '/workspace/knowledge', label: '知识库', icon: BookOpen },
    ],
  },
  {
    label: '基础管理',
    items: [
      { href: '/workspace/organization', label: '组织架构', icon: Users },
      { href: '/workspace/permissions', label: '权限管理', icon: ShieldCheck },
      { href: '/dashboard?openSettings=1', label: '系统设置', icon: Settings },
    ],
  },
];

const quickLinks: Array<{ href: string; label: string; icon: LucideIcon; tone: HomeTone }> = [
  { href: '/workspace/issues?action=new', label: '新建问题', icon: AlertTriangle, tone: 'orange' },
  { href: '/production', label: '生产执行', icon: LayoutDashboard, tone: 'blue' },
  { href: '/weekly-plan-center', label: '查看计划', icon: CalendarDays, tone: 'green' },
  { href: '/drawing-library', label: '图纸资料', icon: FolderKanban, tone: 'yellow' },
  { href: '/connector-assembly-manuals', label: '工艺文件', icon: BookOpen, tone: 'slate' },
  { href: '/workspace/changes', label: '技术变更', icon: GitPullRequestArrow, tone: 'orange' },
  { href: '/dashboard', label: '生产工单', icon: FileStack, tone: 'green' },
  { href: '/connector-parameters', label: '连接器参数', icon: Boxes, tone: 'blue' },
  { href: '/workspace/more', label: '更多功能', icon: Wrench, tone: 'slate' },
];

const kpiIcons: Record<string, LucideIcon> = {
  weekly: CalendarDays,
  due: Clock3,
  overdue: AlertTriangle,
  drawing: FileCheck2,
  material: PackageCheck,
  tail: ListChecks,
};

function decodedName(value: string): string {
  try { return decodeURIComponent(value); } catch { return value; }
}

function searchItems(payload: SearchPayload, keyword: string): HomeSearchItem[] {
  const items: HomeSearchItem[] = [];
  for (const order of payload.workOrders || []) {
    items.push({
      id: `work-order:${order.id}`,
      group: '生产工单',
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
  return <div className="hm-home-empty"><span aria-hidden="true"><CheckCircle2 size={18} /></span><p>{children}</p></div>;
}

function SectionHeading({ title, meta, href }: { title: string; meta?: string; href?: string }) {
  return (
    <header className="hm-home-section-heading">
      <div><h2>{title}</h2>{meta && <span>{meta}</span>}</div>
      {href && <a href={href}>查看全部 <ChevronRight size={14} aria-hidden="true" /></a>}
    </header>
  );
}

function ActionList({ items }: { items: HomeActionItem[] }) {
  if (!items.length) return <EmptyState>当前没有需要集中处理的事项</EmptyState>;
  return (
    <div className="hm-home-action-list">
      {items.slice(0, 5).map(item => (
        <a className="hm-home-action-row" href={item.targetRoute} key={item.id}>
          <span className={`hm-home-priority ${item.priority}`}>{item.type === 'due_today' ? '生产节点' : item.type === 'drawing_confirmation' ? '技术确认' : '生产问题'}</span>
          <span className="hm-home-action-copy"><strong title={item.title}>{item.title}</strong><small title={item.subtitle}>{item.subtitle}</small></span>
          <span className="hm-home-action-source"><b>{item.sourceModule}</b><small>{item.status}</small></span>
          <span className={`hm-home-importance ${item.priority}`}>{priorityLabel(item.priority)}</span>
          <ChevronRight size={15} aria-hidden="true" />
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
  const [utilityPanel, setUtilityPanel] = useState<UtilityPanel>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [keyword, setKeyword] = useState('');
  const [results, setResults] = useState<HomeSearchItem[]>([]);
  const [refreshing, startRefresh] = useTransition();
  const sidebarButtonRef = useRef<HTMLButtonElement>(null);
  const accountButtonRef = useRef<HTMLButtonElement>(null);
  const utilityButtonRef = useRef<HTMLButtonElement | null>(null);
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
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchInputRef.current?.focus();
        return;
      }
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

  function openUtility(event: React.MouseEvent<HTMLButtonElement>, panel: Exclude<UtilityPanel, null>): void {
    utilityButtonRef.current = event.currentTarget;
    setUtilityPanel(current => current === panel ? null : panel);
  }

  const donutStyle = { '--hm-home-rate': `${data.planChart.executionRate || 0}%` } as CSSProperties;

  return (
    <main className={`hm-home-shell ${sidebarOpen ? 'sidebar-open' : ''}`}>
      <button className="hm-home-sidebar-scrim" type="button" aria-label="关闭导航" onClick={() => { setSidebarOpen(false); sidebarButtonRef.current?.focus(); }} />
      <aside className="hm-home-sidebar" id="hm-home-sidebar" aria-label="杭连协同平台主导航">
        <a className="hm-home-brand" href="/home" aria-label="杭连协同平台首页">
          <Image src="/icon-192.png" width={40} height={40} alt="" priority />
          <div><strong>杭连协同平台</strong><small>计划 · 技术 · 生产高效闭环</small></div>
        </a>
        <nav>
          <a className="hm-home-nav-item active" href="/home" aria-current="page" title="首页"><Home size={17} aria-hidden="true" /><b>首页</b></a>
          {sidebarGroups.map(group => (
            <section className="hm-home-nav-group" key={group.label}>
              <h2>{group.label}</h2>
              {group.items.map(item => {
                const Icon = item.icon;
                const badge = item.badge === 'actions' ? data.actionItems.length : 0;
                return <a className="hm-home-nav-item" href={item.href} key={item.href} title={item.label}><Icon size={17} aria-hidden="true" /><b>{item.label}</b>{badge > 0 && <em>{badge > 99 ? '99+' : badge}</em>}</a>;
              })}
            </section>
          ))}
        </nav>
        <a className="hm-home-new-issue" href="/workspace/issues?action=new"><PlusCircle size={17} aria-hidden="true" /><span>新建问题</span></a>
      </aside>

      <div className="hm-home-frame">
        <header className="hm-home-toolbar">
          <button ref={sidebarButtonRef} className="hm-home-menu-button" type="button" aria-label="打开主导航" aria-controls="hm-home-sidebar" aria-expanded={sidebarOpen} onClick={() => setSidebarOpen(true)}><PanelLeftOpen size={20} aria-hidden="true" /></button>
          <nav className="hm-home-top-nav" aria-label="一级导航">
            {topNavigation.map(item => <a className={item.href === '/home' ? 'active' : ''} href={item.href} key={item.href}>{item.label}</a>)}
          </nav>
          <div className="hm-home-search" ref={searchWrapRef}>
            <label className="sr-only" htmlFor="hm-home-global-search">全局搜索</label>
            <Search size={18} aria-hidden="true" />
            <input ref={searchInputRef} id="hm-home-global-search" value={keyword} onChange={event => setKeyword(event.target.value)} onFocus={() => keyword.trim() && setSearchOpen(true)} placeholder="搜索工单、计划、图纸、问题、文档..." autoComplete="off" />
            {keyword ? <button type="button" aria-label="清空搜索" title="清空搜索" onClick={() => { setKeyword(''); searchInputRef.current?.focus(); }}><X size={16} /></button> : <kbd>Ctrl K</kbd>}
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
          <div className="hm-home-toolbar-actions">
            <button type="button" aria-label="通知" title="通知" onClick={event => openUtility(event, 'notifications')}><Bell size={19} />{data.actionItems.length > 0 && <span>{Math.min(data.actionItems.length, 9)}</span>}</button>
            <button type="button" aria-label="消息" title="消息" onClick={event => openUtility(event, 'messages')}><MessageSquareText size={19} /></button>
            <button type="button" aria-label="帮助" title="帮助" onClick={event => openUtility(event, 'help')}><CircleHelp size={19} /></button>
            <button className="hm-home-refresh" type="button" aria-label="刷新首页数据" title="刷新首页数据" disabled={refreshing} onClick={refresh}><RefreshCw className={refreshing ? 'is-spinning' : ''} size={18} /></button>
          </div>
          <div className="hm-home-account-wrap">
            <button ref={accountButtonRef} className="hm-home-account" type="button" aria-label={`${displayName}，打开账号菜单`} aria-expanded={accountOpen} onClick={() => setAccountOpen(value => !value)}>
              <span aria-hidden="true">{displayName.slice(0, 1)}</span><p><b>{displayName}</b><small>生产协同账号</small></p><ChevronDown size={15} aria-hidden="true" />
            </button>
            <PortalMenu open={accountOpen} anchorRef={accountButtonRef} className="hm-home-user-menu" width={184} onClose={() => setAccountOpen(false)}>
              <button type="button" onClick={() => { setAccountOpen(false); location.href = '/dashboard?openSettings=1'; }}><Settings size={16} />系统设置</button>
              <button type="button" onClick={() => { setAccountOpen(false); void logout(); }}><Send size={16} />退出登录</button>
            </PortalMenu>
          </div>
          <PortalMenu open={utilityPanel !== null} anchorRef={utilityButtonRef} className="hm-home-utility-menu" width={300} closeOnSelect={false} onClose={() => setUtilityPanel(null)}>
            {utilityPanel === 'notifications' && <div><header><Bell size={17} /><strong>待办通知</strong></header>{data.actionItems.length ? data.actionItems.slice(0, 3).map(item => <a href={item.targetRoute} key={item.id}><b>{item.title}</b><span>{item.subtitle}</span></a>) : <p>当前没有新的待办通知</p>}<a className="hm-home-utility-all" href="/production?view=exceptions">查看全部待办</a></div>}
            {utilityPanel === 'messages' && <div><header><MessageSquareText size={17} /><strong>消息中心</strong></header><p>消息模块框架已就绪，后续可接入部门通知和协同消息。</p><a className="hm-home-utility-all" href="/workspace/messages">进入消息中心</a></div>}
            {utilityPanel === 'help' && <div><header><CircleHelp size={17} /><strong>帮助与支持</strong></header><a href="/workspace/help"><b>使用帮助</b><span>查看平台模块和使用入口</span></a><a href="/dashboard?openSettings=1"><b>系统设置</b><span>安装、诊断和账号设置</span></a></div>}
          </PortalMenu>
        </header>

        <div className="hm-home-content">
          {data.error && <div className="hm-home-error" role="alert"><span>首页数据加载失败</span><p>{data.error}</p><button type="button" onClick={refresh} disabled={refreshing}>重新加载</button></div>}
          <section className="hm-home-welcome">
            <div className="hm-home-welcome-copy"><h1>{data.greeting}，{displayName} <span aria-hidden="true">👋</span></h1><p>今天是 {data.dateLabel}</p><small>{data.periodLabel}</small></div>
            <div className="hm-home-welcome-art" aria-hidden="true">
              <span className="tile tile-one"><CalendarDays size={22} /></span>
              <span className="tile tile-two"><Image src="/icon-192.png" width={56} height={56} alt="" /></span>
              <span className="tile tile-three"><PackageCheck size={23} /></span>
              <i /><b /><em />
            </div>
            <div className="hm-home-updated"><span>数据更新</span><strong>{updatedTime(data.generatedAt)}</strong><small>{refreshing ? '正在刷新' : '读取当前业务数据'}</small></div>
          </section>

          <section className="hm-home-kpis" aria-label="生产关键指标">
            {data.kpis.map((kpi, index) => {
              const Icon = kpiIcons[kpi.id] || BarChart3;
              const deltaLabel = kpi.id === 'weekly' ? '当前计划' : kpi.value && kpi.value > 0 ? '需要关注' : '状态正常';
              return (
                <a className={`hm-home-kpi tone-${kpi.tone}`} href={kpi.route} key={kpi.id}>
                  <span className="hm-home-kpi-icon" aria-hidden="true"><Icon size={23} /></span>
                  <div><small>{kpi.label}</small><strong>{kpi.value === null ? '--' : kpi.value}<em>{index === 2 || index === 5 ? ' 件' : index === 0 ? ' 个' : ' 项'}</em></strong><p>{deltaLabel}</p></div>
                  <ChevronRight size={15} aria-hidden="true" />
                </a>
              );
            })}
          </section>

          <section className="hm-home-primary-grid">
            <article className="hm-home-panel hm-home-actions-panel">
              <SectionHeading title="我的待办事项" meta={`全部 ${data.actionItems.length}`} href="/production?view=exceptions" />
              <ActionList items={data.actionItems} />
            </article>

            <article className="hm-home-panel hm-home-quick-panel">
              <SectionHeading title="快捷入口" />
              <div className="hm-home-quick-grid">
                {quickLinks.map(link => {
                  const Icon = link.icon;
                  return <a href={link.href} key={link.href}><span className={`tone-${link.tone}`} aria-hidden="true"><Icon size={21} /></span><strong>{link.label}</strong></a>;
                })}
              </div>
            </article>

            <div className="hm-home-right-stack">
              <article className="hm-home-panel hm-home-timeline-panel">
                <SectionHeading title="今日节点" href="/production?view=today" />
                {!data.todayNodes.length ? <EmptyState>今天没有已记录的关键节点</EmptyState> : <div className="hm-home-timeline">{data.todayNodes.slice(0, 4).map((node, index) => <a href={node.targetRoute} key={node.id}><time>{String(9 + index * 2).padStart(2, '0')}:00</time><span /><div><strong title={node.title}>{node.title}</strong><p>{node.source} · {node.status}</p></div><em>{node.type}</em></a>)}</div>}
              </article>
              <article className="hm-home-panel hm-home-issues-panel">
                <SectionHeading title="生产问题看板" href="/production?view=exceptions" />
                {!data.issues.length ? <EmptyState>当前没有现场异常</EmptyState> : <div className="hm-home-issue-list">{data.issues.slice(0, 4).map(issue => <a href={issue.targetRoute} key={issue.id}><span className={`hm-home-issue-level ${issue.priority}`}>{priorityLabel(issue.priority)}</span><div><strong>{issue.title}</strong><p title={issue.subtitle}>{issue.subtitle}</p></div><small>{issue.dateLabel}</small></a>)}</div>}
              </article>
            </div>
          </section>

          <section className="hm-home-charts" aria-label="协同数据图表">
            <article className="hm-home-panel hm-home-plan-chart">
              <SectionHeading title="计划执行情况" meta="本周" />
              <div className="hm-home-plan-chart-body">
                <div className="hm-home-donut" style={donutStyle}><div><strong>{data.planChart.executionRate === null ? '--' : `${data.planChart.executionRate}%`}</strong><span>执行率</span></div></div>
                <dl><div><dt>已完成</dt><dd>{data.planChart.completed}</dd></div><div><dt>执行中</dt><dd>{data.planChart.inProgress}</dd></div><div><dt>未开始</dt><dd>{data.planChart.notStarted}</dd></div><div><dt>逾期</dt><dd>{data.planChart.overdue}</dd></div></dl>
              </div>
            </article>
            <article className="hm-home-panel"><SectionHeading title="工单状态分布" meta={`${data.planChart.total} 个工单`} /><DistributionChart items={data.stageDistribution} /></article>
            <article className="hm-home-panel"><SectionHeading title="技术资料状态" meta="当前周计划" /><DistributionChart items={data.technicalDistribution} /></article>
          </section>

          <section className="hm-home-collaboration" aria-label="计划到完成协作链路">
            <SectionHeading title="协同流程状态" meta="计划、技术与生产共享同一套数据" />
            <div>{data.collaboration.map((node, index) => <span className="hm-home-flow-part" key={node.id}>{index > 0 && <ChevronRight aria-hidden="true" />}<a className={`tone-${node.tone}`} href={node.route}><small>0{index + 1}</small><p><strong>{node.label}</strong><span>{node.description}</span></p><b>{node.value}</b></a></span>)}</div>
          </section>

          <footer className="hm-home-footer"><span>© 2026 杭连协同平台 · 企业内部使用</span><small>计划 · 技术 · 生产高效闭环</small></footer>
        </div>
      </div>
    </main>
  );
}
