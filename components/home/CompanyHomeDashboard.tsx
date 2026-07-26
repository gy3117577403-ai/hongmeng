'use client';

import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  ArrowUpRight,
  BarChart3,
  Bell,
  Boxes,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  Factory,
  FileCheck2,
  MessageSquareText,
  RefreshCw,
  Search,
  ShieldCheck,
  TimerReset,
  UsersRound,
  Warehouse,
  X,
  type LucideIcon,
} from 'lucide-react';
import { AppWorkbenchHeader } from '@/components/layout/AppWorkbenchHeader';
import { PortalMenu } from '@/components/PortalMenu';
import type { CurrentUserDTO } from '@/types';
import type {
  HomeDashboardData,
  HomeDistributionItem,
  HomeTone,
  HomeWorkstream,
  HomeWorkstreamId,
} from '@/types/home-dashboard';

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
type SearchIssue = { id: string; code: string; title: string; status: string; priority: string; sourceCode?: string | null; workOrder?: { customerName?: string | null; specification?: string | null; code: string } | null };
type SearchChange = { id: string; code: string; title: string; status: string; priority: string; workOrder?: { customerName?: string | null; specification?: string | null; code: string } | null };
type SearchKnowledgeArticle = { id: string; code: string; title: string; category: string; summary?: string | null; customerName?: string | null; specification?: string | null; productModel?: string | null };
type SearchPayload = {
  workOrders?: SearchWorkOrder[];
  resourceFiles?: SearchResourceFile[];
  drawingLibraryItems?: SearchDrawingItem[];
  drawingLibraryFiles?: SearchDrawingFile[];
  connectorParameters?: SearchParameter[];
  connectorAssemblyManuals?: SearchManual[];
  connectorAssemblyManualAssets?: SearchManualAsset[];
  knowledgeArticles?: SearchKnowledgeArticle[];
  issues?: SearchIssue[];
  changes?: SearchChange[];
};
type SearchResponse = SearchPayload & { ok?: boolean; error?: string; data?: SearchPayload };

type UtilityPanel = 'notifications' | 'messages' | 'help' | null;

const workstreamIcons: Record<HomeWorkstreamId, LucideIcon> = {
  production: Factory,
  warehouse: Warehouse,
  material: Boxes,
  labor: TimerReset,
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
      route: `/production?workOrderId=${encodeURIComponent(order.id)}`,
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
  for (const article of payload.knowledgeArticles || []) {
    items.push({
      id: `knowledge:${article.id}`,
      group: '知识库',
      title: article.title,
      detail: `${article.code} · ${article.specification || article.productModel || article.customerName || '通用知识'}`,
      route: `/workspace/knowledge?source=article&q=${encodeURIComponent(article.title)}&articleId=${encodeURIComponent(article.id)}`,
    });
  }
  for (const issue of payload.issues || []) {
    items.push({
      id: `issue:${issue.id}`,
      group: '问题管理',
      title: issue.title,
      detail: `${issue.code} · ${issue.workOrder?.customerName || '未关联客户'} · ${issue.workOrder?.specification || issue.sourceCode || '未关联工单'}`,
      route: `/workspace/issues?issueId=${encodeURIComponent(issue.id)}`,
    });
  }
  for (const change of payload.changes || []) {
    items.push({
      id: `change:${change.id}`,
      group: '变更管理',
      title: change.title,
      detail: `${change.code} · ${change.workOrder?.customerName || '未关联客户'} · ${change.workOrder?.specification || change.workOrder?.code || '未关联工单'}`,
      route: `/workspace/changes?changeId=${encodeURIComponent(change.id)}`,
    });
  }
  return items.slice(0, 18);
}

function updatedTime(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(value));
}

function DistributionBars({ items }: { items: HomeDistributionItem[] }) {
  const max = Math.max(...items.map(item => item.value), 1);
  return (
    <div className="hm-command-distribution">
      {items.map(item => (
        <div key={item.id}>
          <span><i className={`tone-${item.tone}`} />{item.label}</span>
          <b><em className={`tone-${item.tone}`} style={{ '--bar-size': `${Math.max(item.value ? 8 : 0, (item.value / max) * 100)}%` } as CSSProperties} /></b>
          <strong>{item.value}</strong>
        </div>
      ))}
    </div>
  );
}

function handleTiltMove(event: ReactPointerEvent<HTMLElement>): void {
  const element = event.currentTarget;
  element.dataset.interacting = 'true';
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const rect = element.getBoundingClientRect();
  const x = (event.clientX - rect.left) / rect.width - .5;
  const y = (event.clientY - rect.top) / rect.height - .5;
  element.style.setProperty('--tilt-x', `${(-y * 7).toFixed(2)}deg`);
  element.style.setProperty('--tilt-y', `${(x * 9).toFixed(2)}deg`);
  element.style.setProperty('--shine-x', `${((x + .5) * 100).toFixed(1)}%`);
  element.style.setProperty('--shine-y', `${((y + .5) * 100).toFixed(1)}%`);
}

function resetTilt(event: ReactPointerEvent<HTMLElement>): void {
  delete event.currentTarget.dataset.interacting;
  event.currentTarget.style.removeProperty('--tilt-x');
  event.currentTarget.style.removeProperty('--tilt-y');
  event.currentTarget.style.removeProperty('--shine-x');
  event.currentTarget.style.removeProperty('--shine-y');
}

function handleScenePointerMove(event: ReactPointerEvent<HTMLElement>): void {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const rect = event.currentTarget.getBoundingClientRect();
  const x = ((event.clientX - rect.left) / Math.max(rect.width, 1) - .5) * 2;
  const y = ((event.clientY - rect.top) / Math.max(rect.height, 1) - .5) * 2;
  event.currentTarget.style.setProperty('--scene-x', `${(x * 9).toFixed(2)}px`);
  event.currentTarget.style.setProperty('--scene-y', `${(y * 6).toFixed(2)}px`);
  event.currentTarget.style.setProperty('--scene-x-soft', `${(x * 3.5).toFixed(2)}px`);
  event.currentTarget.style.setProperty('--scene-y-soft', `${(y * 2.5).toFixed(2)}px`);
  event.currentTarget.style.setProperty('--scene-x-back', `${(-x * 5).toFixed(2)}px`);
  event.currentTarget.style.setProperty('--scene-y-back', `${(-y * 3).toFixed(2)}px`);
}

function resetScenePointer(event: ReactPointerEvent<HTMLElement>): void {
  event.currentTarget.style.removeProperty('--scene-x');
  event.currentTarget.style.removeProperty('--scene-y');
  event.currentTarget.style.removeProperty('--scene-x-soft');
  event.currentTarget.style.removeProperty('--scene-y-soft');
  event.currentTarget.style.removeProperty('--scene-x-back');
  event.currentTarget.style.removeProperty('--scene-y-back');
}

export default function CompanyHomeDashboard({ user, data }: CompanyHomeDashboardProps) {
  const router = useRouter();
  const [utilityPanel, setUtilityPanel] = useState<UtilityPanel>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [keyword, setKeyword] = useState('');
  const [results, setResults] = useState<HomeSearchItem[]>([]);
  const [activeStreamId, setActiveStreamId] = useState<HomeWorkstreamId | null>(null);
  const [analyticsOpen, setAnalyticsOpen] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const utilityButtonRef = useRef<HTMLButtonElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchWrapRef = useRef<HTMLDivElement>(null);
  const drawerCloseRef = useRef<HTMLButtonElement>(null);
  const drawerTriggerRef = useRef<HTMLButtonElement | null>(null);
  const analyticsButtonRef = useRef<HTMLButtonElement>(null);
  const displayName = user.displayName || user.username;

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('focusSearch') !== '1') return;
    window.requestAnimationFrame(() => searchInputRef.current?.focus());
  }, []);

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
      if (searchOpen) {
        setSearchOpen(false);
        window.requestAnimationFrame(() => searchInputRef.current?.focus());
      }
      if (activeStreamId) {
        setActiveStreamId(null);
        window.requestAnimationFrame(() => drawerTriggerRef.current?.focus());
      }
      if (analyticsOpen) {
        setAnalyticsOpen(false);
        window.requestAnimationFrame(() => analyticsButtonRef.current?.focus());
      }
    }
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [activeStreamId, analyticsOpen, searchOpen]);

  useEffect(() => {
    if (!activeStreamId) return;
    window.requestAnimationFrame(() => drawerCloseRef.current?.focus());
  }, [activeStreamId]);

  const searchGroups = useMemo(() => {
    const groups = new Map<string, HomeSearchItem[]>();
    for (const item of results) groups.set(item.group, [...(groups.get(item.group) || []), item]);
    return [...groups.entries()];
  }, [results]);

  const hasOperationalData = data.planChart.total > 0
    || data.actionItems.length > 0
    || data.workstreams.some(stream => stream.count > 0)
    || data.todayNodes.length > 0
    || data.issues.length > 0
    || data.kpis.some(kpi => typeof kpi.value === 'number' && kpi.value > 0);
  const riskCount = data.workstreams.reduce((sum, stream) => sum + stream.riskCount, 0);
  const taskCount = data.workstreams.reduce((sum, stream) => sum + stream.count, 0);
  const activeStream = data.workstreams.find(stream => stream.id === activeStreamId) || null;
  const progressRate = data.planChart.executionRate;
  const topAction = data.actionItems[0] || null;
  const productionStream = data.workstreams.find(stream => stream.id === 'production');
  const materialStream = data.workstreams.find(stream => stream.id === 'material');
  const laborStream = data.workstreams.find(stream => stream.id === 'labor');
  const warehouseStream = data.workstreams.find(stream => stream.id === 'warehouse');
  const drawingKpi = data.kpis.find(kpi => kpi.id === 'drawing');
  const drawingCount = drawingKpi?.value
    ?? data.technicalDistribution.reduce((sum, item) => sum + item.value, 0);
  const collaborationCards: Array<{
    id: string;
    position: string;
    label: string;
    eyebrow: string;
    value: number;
    unit: string;
    badge: string;
    detail: string;
    route: string;
    tone: HomeTone;
    Icon: LucideIcon;
    stream?: HomeWorkstream;
  }> = [
    {
      id: 'plan',
      position: 'plan',
      label: '计划中心',
      eyebrow: '本周计划',
      value: data.planChart.total,
      unit: '项',
      badge: `进行中 ${data.planChart.inProgress}`,
      detail: `${data.planChart.completed} 项已完成`,
      route: '/weekly-plan-center',
      tone: 'blue',
      Icon: CalendarDays,
    },
    {
      id: 'drawing',
      position: 'drawing',
      label: '图纸资料库',
      eyebrow: '技术资料',
      value: drawingCount,
      unit: '份',
      badge: drawingKpi?.description || '资料协同',
      detail: data.technicalDistribution[0]
        ? `${data.technicalDistribution[0].label} ${data.technicalDistribution[0].value}`
        : '资料状态正常',
      route: '/drawing-library',
      tone: 'blue',
      Icon: FileCheck2,
    },
    {
      id: 'issue',
      position: 'issue',
      label: '问题管理',
      eyebrow: '质量闭环',
      value: data.issues.length,
      unit: '项',
      badge: data.issues.length > 0 ? `待处理 ${data.issues.length}` : '运行正常',
      detail: data.issues[0]?.title || '当前没有未关闭问题',
      route: '/workspace/issues',
      tone: data.issues.length > 0 ? 'red' : 'green',
      Icon: ShieldCheck,
    },
    {
      id: 'production',
      position: 'production',
      label: '生产执行',
      eyebrow: '现场协同',
      value: productionStream?.count || 0,
      unit: '项',
      badge: productionStream?.riskCount ? `${productionStream.riskCount} 项优先` : '状态正常',
      detail: productionStream?.items[0]?.title || '当前生产运行平稳',
      route: productionStream?.route || '/production',
      tone: productionStream?.tone || 'green',
      Icon: Factory,
      stream: productionStream,
    },
    {
      id: 'material',
      position: 'material',
      label: '缺料跟进',
      eyebrow: '物料保障',
      value: materialStream?.count || 0,
      unit: '项',
      badge: materialStream?.riskCount ? `${materialStream.riskCount} 项优先` : '状态正常',
      detail: materialStream?.items[0]?.title || '当前没有待跟进缺料',
      route: materialStream?.route || '/workspace/procurement',
      tone: materialStream?.tone || 'yellow',
      Icon: Boxes,
      stream: materialStream,
    },
    {
      id: 'labor',
      position: 'labor',
      label: '今日工时',
      eyebrow: '员工报工',
      value: laborStream?.count || 0,
      unit: '项',
      badge: laborStream?.riskCount ? `${laborStream.riskCount} 项待确认` : '状态正常',
      detail: laborStream?.items[0]?.title || '今日工时领取正常',
      route: laborStream?.route || '/workspace/reports',
      tone: laborStream?.tone || 'green',
      Icon: TimerReset,
      stream: laborStream,
    },
  ];
  const insightDrawings = data.todayNodes.slice(0, 3);
  const priorityRisks = data.actionItems.slice(0, 3);
  const qualityIssues = data.issues.slice(0, 3);

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

  function openStream(stream: HomeWorkstream, trigger: HTMLButtonElement): void {
    drawerTriggerRef.current = trigger;
    setAnalyticsOpen(false);
    setActiveStreamId(stream.id);
  }

  function closeOverlays(): void {
    if (activeStreamId) {
      setActiveStreamId(null);
      window.requestAnimationFrame(() => drawerTriggerRef.current?.focus());
    }
    if (analyticsOpen) {
      setAnalyticsOpen(false);
      window.requestAnimationFrame(() => analyticsButtonRef.current?.focus());
    }
  }

  function toggleAnalytics(): void {
    setActiveStreamId(null);
    setAnalyticsOpen(value => !value);
  }

  return (
    <main className={`hm-home-shell hm-workbench-root hm-collab-root ${hasOperationalData ? 'has-live-data' : 'is-plan-empty'}`}>
      <AppWorkbenchHeader
        user={user}
        activeHref="/home"
        subtitle="跨部门协同工作台"
        brandTitle="杭连电子协同平台"
        menuItems={[
          { label: '系统设置', href: '/dashboard?openSettings=1' },
          { label: '退出登录', onSelect: () => { void logout(); } },
        ]}
        searchSlot={(
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
        )}
        utilityActions={(
          <div className="hm-home-toolbar-actions">
            <button type="button" aria-label="通知" title="通知" onClick={event => openUtility(event, 'notifications')}><Bell size={19} />{data.actionItems.length > 0 && <span>{Math.min(data.actionItems.length, 9)}</span>}</button>
            <button type="button" aria-label="消息" title="消息" onClick={event => openUtility(event, 'messages')}><MessageSquareText size={19} /></button>
            <button type="button" aria-label="帮助" title="帮助" onClick={event => openUtility(event, 'help')}><CircleHelp size={19} /></button>
            <button className="hm-home-refresh" type="button" aria-label="刷新首页数据" title="刷新首页数据" disabled={refreshing} onClick={refresh}><RefreshCw className={refreshing ? 'is-spinning' : ''} size={18} /></button>
          </div>
        )}
      />

      <PortalMenu open={utilityPanel !== null} anchorRef={utilityButtonRef} className="hm-home-utility-menu" width={300} closeOnSelect={false} onClose={() => setUtilityPanel(null)}>
        {utilityPanel === 'notifications' && <div><header><Bell size={17} /><strong>待办通知</strong></header>{data.actionItems.length ? data.actionItems.slice(0, 3).map(item => <a href={item.targetRoute} key={item.id}><b>{item.title}</b><span>{item.subtitle}</span></a>) : <p>当前没有新的待办通知</p>}<a className="hm-home-utility-all" href="/production?view=exceptions">查看全部待办</a></div>}
        {utilityPanel === 'messages' && <div><header><MessageSquareText size={17} /><strong>消息中心</strong></header><p>消息能力正在规划，当前入口不影响生产业务。</p><a className="hm-home-utility-all" href="/workspace/messages">查看规划说明</a></div>}
        {utilityPanel === 'help' && <div><header><CircleHelp size={17} /><strong>帮助与支持</strong></header><a href="/workspace/help"><b>使用帮助</b><span>查看平台模块和规划入口</span></a><a href="/dashboard?openSettings=1"><b>系统设置</b><span>安装、诊断和账号设置</span></a></div>}
      </PortalMenu>

      <div className="hm-home-frame hm-collab-frame">
        {data.error && <div className="hm-home-error hm-collab-error" role="alert"><span>首页数据加载失败</span><p>{data.error}</p><button type="button" onClick={refresh} disabled={refreshing}>重新加载</button></div>}

        <section
          className="hm-collab-workbench"
          aria-labelledby="hm-collab-title"
          onPointerMove={handleScenePointerMove}
          onPointerLeave={resetScenePointer}
        >
          <div className="hm-collab-scene-background" aria-hidden="true" />
          <header className="hm-collab-scene-heading">
            <div>
              <span>协同运行总览</span>
              <p>{data.greeting}，{displayName} · {data.dateLabel} · {data.periodLabel}</p>
            </div>
            <div className="hm-collab-live-state" aria-live="polite">
              <i className={refreshing ? 'refreshing' : ''} aria-hidden="true" />
              <span><strong>{refreshing ? '正在同步' : '数据已连接'}</strong><small>{updatedTime(data.generatedAt)} 更新</small></span>
            </div>
          </header>

          <svg className="hm-collab-paths" viewBox="0 0 1000 560" preserveAspectRatio="none" aria-hidden="true">
            <path className="path-blue path-one" d="M500 282 C430 210 350 130 245 105" />
            <path className="path-blue path-two" d="M500 282 C570 205 660 128 765 108" />
            <path className="path-red path-three" d="M500 282 C390 270 290 270 155 290" />
            <path className="path-green path-four" d="M500 282 C620 272 720 270 845 292" />
            <path className="path-orange path-five" d="M500 282 C430 360 345 432 245 455" />
            <path className="path-green path-six" d="M500 282 C570 360 655 432 760 455" />
          </svg>

          <div className="hm-collab-core" aria-label={`本周协同执行率${progressRate === null ? '暂未生成' : `${progressRate}%`}`}>
            <div className="hm-collab-core-platform" aria-hidden="true" />
            <div className="hm-collab-core-disc">
              <span className="hm-collab-core-icon" aria-hidden="true"><UsersRound size={24} /></span>
              <small id="hm-collab-title">本周协同执行率</small>
              <strong>{progressRate === null ? '--' : progressRate}<em>{progressRate === null ? '' : '%'}</em></strong>
              <p>{data.planChart.completed} 项完成 · {data.planChart.inProgress} 项进行中</p>
              <a href={hasOperationalData ? '/production' : '/weekly-plan-center'}>
                进入工作台<ArrowUpRight size={15} aria-hidden="true" />
              </a>
            </div>
          </div>

          <div className="hm-collab-card-grid">
            {collaborationCards.map((card, index) => (
              <article
                className={`hm-collab-card position-${card.position} tone-${card.tone}`}
                key={card.id}
                style={{ '--card-index': index } as CSSProperties}
                onPointerMove={handleTiltMove}
                onPointerLeave={resetTilt}
              >
                <a className="hm-collab-card-link" href={card.route} aria-label={`进入${card.label}`}>
                  <span className="hm-collab-card-icon" aria-hidden="true"><card.Icon size={21} /></span>
                  <div className="hm-collab-card-copy">
                    <small>{card.eyebrow}</small>
                    <h2>{card.label}</h2>
                  </div>
                  <span className="hm-collab-card-badge">{card.badge}</span>
                  <dl>
                    <div><dt>当前</dt><dd>{card.value}<small>{card.unit}</small></dd></div>
                    <div><dt>协同状态</dt><dd>{card.detail}</dd></div>
                  </dl>
                  <footer><span>查看业务详情</span><ChevronRight size={14} aria-hidden="true" /></footer>
                </a>
                {card.stream && (
                  <button
                    className="hm-collab-card-tasks"
                    type="button"
                    aria-label={`展开${card.label}待办任务`}
                    onClick={event => openStream(card.stream!, event.currentTarget)}
                  >
                    待办
                  </button>
                )}
              </article>
            ))}
          </div>
        </section>

        <section className="hm-collab-insights" aria-label="业务洞察">
          <article className="hm-collab-insight">
            <header><div><FileCheck2 size={16} aria-hidden="true" /><h2>当前处理图纸</h2></div><a href="/drawing-library">全部 {drawingCount}<ChevronRight size={13} /></a></header>
            <div className="hm-collab-insight-list">
              {insightDrawings.length ? insightDrawings.map(item => (
                <a href={item.targetRoute} key={item.id}><span>{item.title}</span><small>{item.status}</small></a>
              )) : <p className="hm-collab-empty">当前没有待处理图纸</p>}
            </div>
          </article>

          <article className="hm-collab-insight">
            <header><div><AlertTriangle size={16} aria-hidden="true" /><h2>优先风险</h2></div><a href="/production?view=exceptions">全部 {riskCount}<ChevronRight size={13} /></a></header>
            <div className="hm-collab-insight-list">
              {priorityRisks.length ? priorityRisks.map(item => (
                <a href={item.targetRoute} key={item.id}><i className={`priority-${item.priority}`}>{item.priority === 'urgent' ? '紧急' : item.priority === 'high' ? '关注' : '提示'}</i><span>{item.title}</span><small>{item.dateLabel}</small></a>
              )) : <p className="hm-collab-empty">当前没有优先风险</p>}
            </div>
          </article>

          <article className="hm-collab-insight hm-collab-quality">
            <header><div><ShieldCheck size={16} aria-hidden="true" /><h2>质量与问题</h2></div><a href="/workspace/issues">全部 {data.issues.length}<ChevronRight size={13} /></a></header>
            <div className="hm-collab-quality-body">
              <div className="hm-collab-quality-rate" style={{ '--issue-rate': `${Math.min(100, data.issues.length * 12)}%` } as CSSProperties}><strong>{data.issues.length}</strong><small>未关闭</small></div>
              <div className="hm-collab-quality-list">
                {qualityIssues.length ? qualityIssues.map(item => <a href={item.targetRoute} key={item.id}><span>{item.title}</span><small>{item.status}</small></a>) : <p className="hm-collab-empty">质量状态正常</p>}
              </div>
            </div>
          </article>

          <article className="hm-collab-insight hm-collab-operations">
            <header><div><BarChart3 size={16} aria-hidden="true" /><h2>运营分析</h2></div><button ref={analyticsButtonRef} type="button" aria-expanded={analyticsOpen} aria-controls="hm-command-analytics" onClick={toggleAnalytics}>展开分析<ChevronRight size={13} /></button></header>
            <div className="hm-collab-operation-grid">
              <div><span>订单协同达成</span><strong>{progressRate === null ? '--' : `${progressRate}%`}</strong><b><i style={{ width: `${progressRate || 0}%` }} /></b></div>
              <div><span>当前协同任务</span><strong>{taskCount}</strong><small>跨部门待处理</small></div>
              <div><span>仓库配料</span><strong>{warehouseStream?.count || 0}</strong><small>{warehouseStream?.riskCount ? `${warehouseStream.riskCount} 项需优先` : '运行正常'}</small></div>
              <div><span>风险关注</span><strong className={riskCount > 0 ? 'has-risk' : ''}>{riskCount}</strong><small>{topAction?.title || '当前运行平稳'}</small></div>
            </div>
          </article>
        </section>

        <button className={`hm-command-overlay ${activeStream || analyticsOpen ? 'open' : ''}`} type="button" aria-label="关闭展开面板" aria-hidden={!activeStream && !analyticsOpen} tabIndex={activeStream || analyticsOpen ? 0 : -1} onClick={closeOverlays} />

        <aside className={`hm-command-task-drawer ${activeStream ? 'open' : ''}`} aria-hidden={!activeStream} aria-labelledby="hm-command-task-title">
          {activeStream && (
            <>
              <header>
                <span className={`tone-${activeStream.tone}`} aria-hidden="true">{(() => {
                  const Icon = workstreamIcons[activeStream.id];
                  return <Icon size={21} />;
                })()}</span>
                <div><small>实时任务抽屉</small><h2 id="hm-command-task-title">{activeStream.label}</h2><p>{activeStream.description}</p></div>
                <button ref={drawerCloseRef} type="button" aria-label={`关闭${activeStream.label}任务`} onClick={closeOverlays}><X size={19} /></button>
              </header>
              <div className="hm-command-drawer-summary">
                <div><span>待处理</span><strong>{activeStream.count}</strong></div>
                <div className={activeStream.riskCount > 0 ? 'has-risk' : ''}><span>需优先</span><strong>{activeStream.riskCount}</strong></div>
              </div>
              <div className="hm-command-drawer-list hm-scroll-region">
                {!activeStream.items.length ? (
                  <div className="hm-command-drawer-empty"><CheckCircle2 size={26} aria-hidden="true" /><strong>当前没有待处理任务</strong><p>该业务节点运行平稳。</p></div>
                ) : activeStream.items.map(item => (
                  <a className={`risk-${item.risk}`} href={item.targetRoute} key={item.id}>
                    <span>{item.status}</span>
                    <div><strong>{item.title}</strong><p>{item.subtitle}</p><small>{item.meta}</small></div>
                    <ChevronRight size={16} aria-hidden="true" />
                  </a>
                ))}
              </div>
              <footer><a href={activeStream.route}>进入{activeStream.label}<ArrowUpRight size={15} aria-hidden="true" /></a></footer>
            </>
          )}
        </aside>

        <section className={`hm-command-analytics ${analyticsOpen ? 'open' : ''}`} id="hm-command-analytics" aria-hidden={!analyticsOpen} aria-labelledby="hm-command-analytics-title">
          <header>
            <div><small>业务洞察</small><h2 id="hm-command-analytics-title">生产数据分析</h2></div>
            <button type="button" aria-label="关闭数据分析" tabIndex={analyticsOpen ? 0 : -1} onClick={closeOverlays}><X size={19} /></button>
          </header>
          <div className="hm-command-analytics-grid">
            <article>
              <span>计划执行</span>
              <div className="hm-command-mini-donut" style={{ '--rate': `${progressRate || 0}%` } as CSSProperties}><strong>{progressRate === null ? '--' : `${progressRate}%`}</strong></div>
              <dl><div><dt>已完成</dt><dd>{data.planChart.completed}</dd></div><div><dt>执行中</dt><dd>{data.planChart.inProgress}</dd></div><div><dt>逾期</dt><dd>{data.planChart.overdue}</dd></div></dl>
            </article>
            <article><span>工单状态分布</span><DistributionBars items={data.stageDistribution} /></article>
            <article><span>技术资料状态</span><DistributionBars items={data.technicalDistribution} /></article>
          </div>
        </section>
      </div>
    </main>
  );
}
