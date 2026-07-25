'use client';

import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  BarChart3,
  Bell,
  Boxes,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  Clock3,
  Factory,
  FileCheck2,
  Gauge,
  Layers3,
  MessageSquareText,
  PackageCheck,
  RefreshCw,
  Search,
  TimerReset,
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

const kpiIcons: Record<string, LucideIcon> = {
  weekly: CalendarDays,
  due: Clock3,
  overdue: AlertTriangle,
  drawing: FileCheck2,
  material: PackageCheck,
  tail: BarChart3,
};

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

function kpiUnit(id: string): string {
  if (id === 'weekly') return '个';
  if (id === 'overdue' || id === 'tail') return '件';
  return '项';
}

function AmbientParticleField({ riskCount }: { riskCount: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const context = canvas.getContext('2d');
    if (!context) return undefined;
    const surface = canvas;
    const painter = context;

    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    let width = 0;
    let height = 0;
    let frame = 0;
    let active = false;
    let reducedMotion = motionQuery.matches;
    const pointer = { x: 0, y: 0, active: false };
    const warmThreshold = Math.min(.45, .08 + riskCount * .035);
    const particles = Array.from({ length: 76 }, (_, index) => ({
      angle: Math.random() * Math.PI * 2,
      orbit: .12 + Math.random() * .38,
      speed: .000018 + Math.random() * .000035,
      depth: Math.random(),
      phase: Math.random() * Math.PI * 2,
      warm: index / 76 < warmThreshold,
    }));

    function resize(): void {
      const rect = surface.getBoundingClientRect();
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      surface.width = Math.round(width * dpr);
      surface.height = Math.round(height * dpr);
      painter.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function render(time: number): void {
      if (reducedMotion || document.visibilityState !== 'visible') {
        active = false;
        return;
      }
      painter.clearRect(0, 0, width, height);
      const centerX = width * .5;
      const centerY = height * .53;

      for (const particle of particles) {
        const angle = particle.angle + time * particle.speed;
        const depthPulse = .5 + Math.sin(angle * 1.7 + particle.phase) * .5;
        const scale = .62 + (particle.depth * .56) + depthPulse * .18;
        const orbitX = width * particle.orbit;
        const orbitY = height * (particle.orbit * .42 + .035);
        const pointerX = pointer.active ? pointer.x * (5 + particle.depth * 10) : 0;
        const pointerY = pointer.active ? pointer.y * (3 + particle.depth * 7) : 0;
        const x = centerX + Math.cos(angle + particle.phase) * orbitX + pointerX;
        const y = centerY + Math.sin(angle * .9 + particle.phase) * orbitY + pointerY;
        const alpha = .1 + particle.depth * .24;
        const radius = (.75 + particle.depth * 1.45) * scale;
        const color = particle.warm ? `rgba(243, 106, 39, ${alpha})` : `rgba(55, 124, 205, ${alpha})`;

        painter.beginPath();
        painter.arc(x, y, radius, 0, Math.PI * 2);
        painter.fillStyle = color;
        painter.shadowBlur = 8 * scale;
        painter.shadowColor = color;
        painter.fill();

        if (particle.depth > .7) {
          painter.beginPath();
          painter.moveTo(x, y);
          painter.lineTo(x - Math.cos(angle) * 16 * scale, y - Math.sin(angle) * 7 * scale);
          painter.strokeStyle = particle.warm
            ? `rgba(243, 106, 39, ${alpha * .28})`
            : `rgba(55, 124, 205, ${alpha * .24})`;
          painter.lineWidth = .6;
          painter.stroke();
        }
      }
      painter.shadowBlur = 0;
      frame = window.requestAnimationFrame(render);
    }

    function start(): void {
      if (active || reducedMotion || document.visibilityState !== 'visible') return;
      active = true;
      frame = window.requestAnimationFrame(render);
    }

    function onPointerMove(event: PointerEvent): void {
      pointer.x = (event.clientX / Math.max(window.innerWidth, 1) - .5) * 2;
      pointer.y = (event.clientY / Math.max(window.innerHeight, 1) - .5) * 2;
      pointer.active = true;
    }

    function onPointerLeave(): void {
      pointer.active = false;
    }

    function onMotionChange(event: MediaQueryListEvent): void {
      reducedMotion = event.matches;
      if (reducedMotion) {
        window.cancelAnimationFrame(frame);
        active = false;
        painter.clearRect(0, 0, width, height);
      } else {
        start();
      }
    }

    function onVisibilityChange(): void {
      if (document.visibilityState === 'visible') start();
      else {
        window.cancelAnimationFrame(frame);
        active = false;
      }
    }

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(surface);
    resize();
    start();
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('pointerleave', onPointerLeave);
    document.addEventListener('visibilitychange', onVisibilityChange);
    motionQuery.addEventListener('change', onMotionChange);

    return () => {
      window.cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerleave', onPointerLeave);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      motionQuery.removeEventListener('change', onMotionChange);
    };
  }, [riskCount]);

  return <canvas ref={canvasRef} className="hm-command-particles" aria-hidden="true" />;
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

function handleTiltMove(event: ReactPointerEvent<HTMLButtonElement>): void {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const element = event.currentTarget;
  const rect = element.getBoundingClientRect();
  const x = (event.clientX - rect.left) / rect.width - .5;
  const y = (event.clientY - rect.top) / rect.height - .5;
  element.style.setProperty('--tilt-x', `${(-y * 7).toFixed(2)}deg`);
  element.style.setProperty('--tilt-y', `${(x * 9).toFixed(2)}deg`);
  element.style.setProperty('--shine-x', `${((x + .5) * 100).toFixed(1)}%`);
  element.style.setProperty('--shine-y', `${((y + .5) * 100).toFixed(1)}%`);
}

function resetTilt(event: ReactPointerEvent<HTMLButtonElement>): void {
  event.currentTarget.style.removeProperty('--tilt-x');
  event.currentTarget.style.removeProperty('--tilt-y');
  event.currentTarget.style.removeProperty('--shine-x');
  event.currentTarget.style.removeProperty('--shine-y');
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
  const commandKpis = (hasOperationalData
    ? data.kpis
    : data.kpis.filter(kpi => ['weekly', 'due', 'drawing', 'overdue'].includes(kpi.id)))
    .slice(0, 4);
  const riskCount = data.workstreams.reduce((sum, stream) => sum + stream.riskCount, 0);
  const taskCount = data.workstreams.reduce((sum, stream) => sum + stream.count, 0);
  const activeStream = data.workstreams.find(stream => stream.id === activeStreamId) || null;
  const progressRate = data.planChart.executionRate;
  const topAction = data.actionItems[0] || null;

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
    <main className={`hm-home-shell hm-workbench-root hm-workbench-navigation-overlay hm-command-root ${hasOperationalData ? 'has-live-data' : 'is-plan-empty'}`}>
      <AppWorkbenchHeader
        user={user}
        activeHref="/home"
        subtitle="实时生产态势"
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

      <div className="hm-home-frame hm-command-frame">
        <AmbientParticleField riskCount={riskCount} />
        <div className="hm-command-aurora" aria-hidden="true"><i /><i /><i /></div>

        <div className="hm-command-content">
          {data.error && <div className="hm-home-error hm-command-error" role="alert"><span>首页数据加载失败</span><p>{data.error}</p><button type="button" onClick={refresh} disabled={refreshing}>重新加载</button></div>}

          <header className="hm-command-heading">
            <div>
              <span className="hm-command-eyebrow"><Activity size={13} aria-hidden="true" /> LIVE OPERATIONS</span>
              <h1>生产态势指挥舱</h1>
              <p>{data.greeting}，{displayName} · {data.dateLabel} · {data.periodLabel}</p>
            </div>
            <div className="hm-command-live-state" aria-live="polite">
              <span className={refreshing ? 'refreshing' : ''} aria-hidden="true" />
              <p><strong>{refreshing ? '同步中' : '运行正常'}</strong><small>数据更新 {updatedTime(data.generatedAt)}</small></p>
            </div>
          </header>

          <section className="hm-command-kpis" aria-label="核心生产指标">
            {commandKpis.map((kpi, index) => {
              const Icon = kpiIcons[kpi.id] || Gauge;
              return (
                <a className={`hm-command-kpi tone-${kpi.tone}`} href={kpi.route} key={kpi.id} style={{ '--kpi-index': index } as CSSProperties}>
                  <span aria-hidden="true"><Icon size={17} /></span>
                  <p><small>{kpi.label}</small><strong>{kpi.value === null ? '--' : kpi.value}<em>{kpiUnit(kpi.id)}</em></strong></p>
                  <i>{kpi.value && kpi.value > 0 ? '实时' : '正常'}</i>
                </a>
              );
            })}
          </section>

          <section className="hm-command-deck" aria-labelledby="hm-command-deck-title">
            <div className="hm-command-grid-plane" aria-hidden="true" />
            <svg className="hm-command-energy-map" viewBox="0 0 1000 520" preserveAspectRatio="none" aria-hidden="true">
              <path className="flow blue flow-one" d="M210 140 C350 120 390 220 500 260" />
              <path className="flow orange flow-two" d="M790 140 C650 120 610 220 500 260" />
              <path className="flow amber flow-three" d="M210 390 C350 410 390 300 500 260" />
              <path className="flow green flow-four" d="M790 390 C650 410 610 300 500 260" />
            </svg>

            <div className="hm-command-core" aria-label={`本周计划执行率${progressRate === null ? '暂未生成' : `${progressRate}%`}`}>
              <div className="hm-command-orbit orbit-one" aria-hidden="true"><i /><i /><i /></div>
              <div className="hm-command-orbit orbit-two" aria-hidden="true"><i /><i /></div>
              <div className="hm-command-core-disc">
                <span>本周计划执行率</span>
                <strong>{progressRate === null ? '--' : progressRate}<em>{progressRate === null ? '' : '%'}</em></strong>
                <small>{data.planChart.completed} 已完成 · {data.planChart.inProgress} 执行中</small>
                <a href={hasOperationalData ? '/production' : '/weekly-plan-center'}>
                  {hasOperationalData ? '进入生产执行' : '建立本周计划'}<ArrowUpRight size={15} aria-hidden="true" />
                </a>
              </div>
              <div className="hm-command-radar" aria-hidden="true" />
            </div>

            {data.workstreams.map((stream, index) => {
              const Icon = workstreamIcons[stream.id];
              const topItem = stream.items[0];
              return (
                <button
                  className={`hm-command-node node-${stream.id} tone-${stream.tone}`}
                  type="button"
                  key={stream.id}
                  style={{ '--node-index': index } as CSSProperties}
                  aria-label={`展开${stream.label}任务，待处理${stream.count}项`}
                  onClick={event => openStream(stream, event.currentTarget)}
                  onPointerMove={handleTiltMove}
                  onPointerLeave={resetTilt}
                >
                  <span className="hm-command-node-icon" aria-hidden="true"><Icon size={21} /></span>
                  <p><small>{stream.description}</small><strong>{stream.label}</strong></p>
                  <b>{stream.count}</b>
                  <i className={stream.riskCount > 0 ? 'has-risk' : ''}>{stream.riskCount > 0 ? `${stream.riskCount} 项优先` : '状态正常'}</i>
                  <div><span>{topItem?.title || '当前没有待处理任务'}</span><small>{topItem?.status || '运行平稳'}</small><ChevronRight size={14} aria-hidden="true" /></div>
                </button>
              );
            })}

            <div className="hm-command-deck-caption">
              <span><Layers3 size={14} aria-hidden="true" />实时业务流</span>
              <h2 id="hm-command-deck-title">{topAction ? topAction.title : '当前生产协同运行平稳'}</h2>
              <p>{topAction ? topAction.subtitle : '生产、仓库、缺料与工时数据均已接入统一态势面板'}</p>
            </div>
          </section>

          <footer className="hm-command-statusbar">
            <div><span>生产计划</span><strong>{data.planChart.total}</strong><small>个工单</small></div>
            <div><span>当前待处理</span><strong>{taskCount}</strong><small>项任务</small></div>
            <div className={riskCount > 0 ? 'has-risk' : ''}><span>优先风险</span><strong>{riskCount}</strong><small>项关注</small></div>
            <div className={data.issues.length > 0 ? 'has-risk' : ''}><span>质量与问题</span><strong>{data.issues.length}</strong><small>项未关闭</small></div>
            <button ref={analyticsButtonRef} type="button" aria-expanded={analyticsOpen} aria-controls="hm-command-analytics" onClick={toggleAnalytics}>
              <BarChart3 size={16} aria-hidden="true" /><span>数据分析</span><ChevronRight size={14} aria-hidden="true" />
            </button>
          </footer>
        </div>

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
            <div><small>SECONDARY INSIGHTS</small><h2 id="hm-command-analytics-title">生产数据分析</h2></div>
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
