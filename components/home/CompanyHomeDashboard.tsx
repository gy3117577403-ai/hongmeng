'use client';

import HomePurchasingShortcut from './HomePurchasingShortcut';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
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
  Pause,
  Play,
  PanelLeft,
  PieChart,
  RefreshCw,
  Search,
  ShieldCheck,
  TimerReset,
  UserRound,
  UsersRound,
  Warehouse,
  X,
  type LucideIcon,
} from 'lucide-react';
import { AppWorkbenchHeader } from '@/components/layout/AppWorkbenchHeader';
import HomeNotificationCommandCenter from '@/components/home/HomeNotificationCommandCenter';
import { PortalMenu } from '@/components/PortalMenu';
import type { CurrentUserDTO, NotificationBusinessCategoryDTO, SystemNotificationDTO } from '@/types';
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

type UtilityPanel = 'notifications' | 'messages' | 'help' | 'account' | null;
type SceneModuleId = 'plan' | 'drawing' | 'production' | 'material' | 'quality' | 'labor';
type NotificationFocus = { id: number; category: 'ACTIONABLE' | NotificationBusinessCategoryDTO; label: string };
const sceneCategories: Record<SceneModuleId, NotificationFocus['category']> = {
  plan: 'PRODUCTION', drawing: 'PROCESS', production: 'PRODUCTION', material: 'MATERIAL', quality: 'QUALITY', labor: 'ACTIONABLE',
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

type PendingPointerFrame = { id: number; clientX: number; clientY: number };
const pendingPointerFrames = new WeakMap<HTMLElement, PendingPointerFrame>();

function supportsPointerMotion(event: ReactPointerEvent<HTMLElement>): boolean {
  return event.pointerType === 'mouse'
    && !event.currentTarget.closest('[data-motion="quiet"]')
    && window.matchMedia('(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)').matches;
}

function schedulePointerFrame(
  element: HTMLElement,
  clientX: number,
  clientY: number,
  update: (x: number, y: number) => void,
): void {
  const pending = pendingPointerFrames.get(element);
  if (pending) {
    pending.clientX = clientX;
    pending.clientY = clientY;
    return;
  }
  const next: PendingPointerFrame = { id: 0, clientX, clientY };
  next.id = window.requestAnimationFrame(() => {
    pendingPointerFrames.delete(element);
    update(next.clientX, next.clientY);
  });
  pendingPointerFrames.set(element, next);
}

function cancelPointerFrame(element: HTMLElement): void {
  const pending = pendingPointerFrames.get(element);
  if (!pending) return;
  window.cancelAnimationFrame(pending.id);
  pendingPointerFrames.delete(element);
}

function handleTiltMove(event: ReactPointerEvent<HTMLElement>): void {
  if (!supportsPointerMotion(event)) return;
  const element = event.currentTarget;
  element.dataset.interacting = 'true';
  schedulePointerFrame(element, event.clientX, event.clientY, (clientX, clientY) => {
    const rect = element.getBoundingClientRect();
    const x = (clientX - rect.left) / rect.width - .5;
    const y = (clientY - rect.top) / rect.height - .5;
    element.style.setProperty('--tilt-x', `${(-y * 7).toFixed(2)}deg`);
    element.style.setProperty('--tilt-y', `${(x * 9).toFixed(2)}deg`);
    element.style.setProperty('--shine-x', `${((x + .5) * 100).toFixed(1)}%`);
    element.style.setProperty('--shine-y', `${((y + .5) * 100).toFixed(1)}%`);
  });
}

function resetTilt(event: ReactPointerEvent<HTMLElement>): void {
  cancelPointerFrame(event.currentTarget);
  delete event.currentTarget.dataset.interacting;
  event.currentTarget.style.removeProperty('--tilt-x');
  event.currentTarget.style.removeProperty('--tilt-y');
  event.currentTarget.style.removeProperty('--shine-x');
  event.currentTarget.style.removeProperty('--shine-y');
}

function handleScenePointerMove(event: ReactPointerEvent<HTMLElement>): void {
  if (!supportsPointerMotion(event)) return;
  const element = event.currentTarget;
  schedulePointerFrame(element, event.clientX, event.clientY, (clientX, clientY) => {
    const rect = element.getBoundingClientRect();
    const x = ((clientX - rect.left) / Math.max(rect.width, 1) - .5) * 2;
    const y = ((clientY - rect.top) / Math.max(rect.height, 1) - .5) * 2;
    element.style.setProperty('--scene-x', `${(x * 9).toFixed(2)}px`);
    element.style.setProperty('--scene-y', `${(y * 6).toFixed(2)}px`);
    element.style.setProperty('--scene-x-soft', `${(x * 3.5).toFixed(2)}px`);
    element.style.setProperty('--scene-y-soft', `${(y * 2.5).toFixed(2)}px`);
    element.style.setProperty('--scene-x-back', `${(-x * 5).toFixed(2)}px`);
    element.style.setProperty('--scene-y-back', `${(-y * 3).toFixed(2)}px`);
  });
}

function resetScenePointer(event: ReactPointerEvent<HTMLElement>): void {
  cancelPointerFrame(event.currentTarget);
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
  const [searchPanelOpen, setSearchPanelOpen] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [keyword, setKeyword] = useState('');
  const [results, setResults] = useState<HomeSearchItem[]>([]);
  const [activeStreamId, setActiveStreamId] = useState<HomeWorkstreamId | null>(null);
  const [analyticsOpen, setAnalyticsOpen] = useState(false);
  const [selectedModule, setSelectedModule] = useState<SceneModuleId | null>(null);
  const [focusRequest, setFocusRequest] = useState<NotificationFocus>();
  const [quietMotion, setQuietMotion] = useState(false);
  const [pageVisible, setPageVisible] = useState(true);
  const [sidebarExpanded, setSidebarExpanded] = useState(false);
  const [assetFailed, setAssetFailed] = useState(false);
  const [assetRevision, setAssetRevision] = useState(0);
  const focusSequence = useRef(0);
  const sceneRef = useRef<HTMLElement>(null);
  const rootRef = useRef<HTMLElement>(null);
  const analyticsPanelRef = useRef<HTMLElement>(null);
  const taskDrawerRef = useRef<HTMLElement>(null);
  const analyticsTriggerRef = useRef<HTMLElement | null>(null);
  const [notificationPreview, setNotificationPreview] = useState<SystemNotificationDTO[]>([]);
  const [notificationUnreadCount, setNotificationUnreadCount] = useState(0);
  const [notificationLoading, setNotificationLoading] = useState(true);
  const [refreshing, startRefresh] = useTransition();
  const utilityButtonRef = useRef<HTMLButtonElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchLaunchRef = useRef<HTMLButtonElement>(null);
  const searchWrapRef = useRef<HTMLDivElement>(null);
  const drawerCloseRef = useRef<HTMLButtonElement>(null);
  const drawerTriggerRef = useRef<HTMLButtonElement | null>(null);
  const analyticsButtonRef = useRef<HTMLButtonElement>(null);
  const displayName = user.displayName || user.username;
  const canGlobalSearch = user.access.modules.includes('SYSTEM_CONFIGURATION');
  const canOpenSettings = user.access.modules.includes('SYSTEM_CONFIGURATION');
  const canReadNotifications = user.access.modules.includes('NOTIFICATIONS');

  useEffect(() => {
    const scene = sceneRef.current;
    try {
      setQuietMotion(localStorage.getItem('hm-home-motion') === 'quiet');
      const saved = sessionStorage.getItem(`hm-home-focus:${user.id}`);
      if (saved && Object.prototype.hasOwnProperty.call(sceneCategories, saved)) {
        const moduleId = saved as SceneModuleId;
        const labels: Record<SceneModuleId, string> = { plan: '计划中心', drawing: '图纸资料库', production: '生产执行', material: '物料跟进', quality: '质量与问题', labor: '工时协同' };
        setSelectedModule(moduleId);
        setFocusRequest({ id: ++focusSequence.current, category: sceneCategories[moduleId], label: labels[moduleId] });
      }
    } catch { /* Preferences are optional in restricted storage contexts. */ }
    const visibility = () => setPageVisible(!document.hidden);
    visibility();
    document.addEventListener('visibilitychange', visibility);
    return () => {
      document.removeEventListener('visibilitychange', visibility);
      if (scene) cancelPointerFrame(scene);
    };
  }, [user.id]);

  useEffect(() => {
    const panel = activeStreamId ? taskDrawerRef.current : analyticsOpen ? analyticsPanelRef.current : null;
    if (!panel) return;
    const frame = requestAnimationFrame(() => panel.querySelector<HTMLElement>('button, a[href]')?.focus());
    function keepFocus(event: KeyboardEvent): void {
      if (event.key !== 'Tab' || !panel) return;
      const nodes = [...panel.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), [tabindex="0"]')].filter(node => node.getClientRects().length > 0);
      if (!nodes.length) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (event.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement))) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !panel.contains(document.activeElement))) {
        event.preventDefault(); first.focus();
      }
    }
    window.addEventListener('keydown', keepFocus);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('keydown', keepFocus); };
  }, [activeStreamId, analyticsOpen]);

  const loadNotificationPreview = useCallback(async (signal?: AbortSignal): Promise<void> => {
    if (!canReadNotifications) {
      setNotificationPreview([]);
      setNotificationUnreadCount(0);
      setNotificationLoading(false);
      return;
    }
    setNotificationLoading(true);
    try {
      const response = await fetch('/api/notifications?limit=3&category=ALL&unreadOnly=false&state=pending', {
        cache: 'no-store',
        signal,
      });
      const body = await response.json().catch(() => ({})) as {
        ok?: boolean;
        notifications?: SystemNotificationDTO[];
        unreadCount?: number;
      };
      if (!response.ok || body.ok !== true) return;
      setNotificationPreview(Array.isArray(body.notifications) ? body.notifications : []);
      setNotificationUnreadCount(Math.max(0, Number(body.unreadCount) || 0));
    } catch (reason) {
      if ((reason as { name?: string }).name !== 'AbortError') return;
    } finally {
      if (!signal?.aborted) setNotificationLoading(false);
    }
  }, [canReadNotifications]);

  useEffect(() => {
    const controller = new AbortController();
    void loadNotificationPreview(controller.signal);
    return () => controller.abort();
  }, [loadNotificationPreview]);

  useEffect(() => {
    if (!utilityPanel) return;
    const frame = requestAnimationFrame(() => document.querySelector<HTMLElement>('.hm-home-utility-menu a[href], .hm-home-utility-menu button')?.focus());
    return () => cancelAnimationFrame(frame);
  }, [utilityPanel]);

  useEffect(() => {
    if (!canGlobalSearch) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('focusSearch') !== '1') return;
    setSearchPanelOpen(true);
    window.requestAnimationFrame(() => searchInputRef.current?.focus());
  }, [canGlobalSearch]);

  useEffect(() => {
    if (!canGlobalSearch) return undefined;
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
  }, [canGlobalSearch, keyword]);

  useEffect(() => {
    function onPointerDown(event: PointerEvent): void {
      if (searchWrapRef.current && !searchWrapRef.current.contains(event.target as Node)) {
        setSearchOpen(false);
        setSearchPanelOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent): void {
      if (canGlobalSearch && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setActiveStreamId(null);
        setAnalyticsOpen(false);
        setUtilityPanel(null);
        setSearchPanelOpen(true);
        window.requestAnimationFrame(() => searchInputRef.current?.focus());
        return;
      }
      if (event.key !== 'Escape') return;
      if (searchOpen || searchPanelOpen) {
        setSearchOpen(false);
        setSearchPanelOpen(false);
        window.requestAnimationFrame(() => searchLaunchRef.current?.focus());
      }
      if (activeStreamId) {
        setActiveStreamId(null);
        window.requestAnimationFrame(() => drawerTriggerRef.current?.focus());
      }
      if (analyticsOpen) {
        setAnalyticsOpen(false);
        window.requestAnimationFrame(() => (analyticsTriggerRef.current || analyticsButtonRef.current)?.focus());
      }
    }
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [activeStreamId, analyticsOpen, canGlobalSearch, searchOpen, searchPanelOpen]);

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
  const drawingKpi = data.kpis.find(kpi => kpi.id === 'drawing');
  const drawingCount = drawingKpi?.value ?? null;
  const planWorkbenchRoute = user.canAccessDailyPlans
    ? '/weekly-plan-center'
    : user.canAccessWeeklyProcesses
      ? '/workspace/weekly-processes'
      : '/production';
  const planWorkbenchLabel = user.canAccessDailyPlans ? '计划中心' : '周工序总览';
  const collaborationCards: Array<{
    id: SceneModuleId;
    position: string;
    label: string;
    eyebrow: string;
    value: number | null;
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
      label: planWorkbenchLabel,
      eyebrow: '本周计划',
      value: data.planChart.total,
      unit: '项',
      badge: `进行中 ${data.planChart.inProgress}`,
      detail: `${data.planChart.completed} 项已完成`,
      route: planWorkbenchRoute,
      tone: 'blue',
      Icon: CalendarDays,
    },
    {
      id: 'drawing',
      position: 'drawing',
      label: '图纸资料库',
      eyebrow: '图纸待确认',
      value: drawingCount,
      unit: '项',
      badge: drawingCount === null ? '待更新' : drawingCount > 0 ? '需要确认' : '暂无待确认',
      detail: data.technicalDistribution[0]
        ? `${data.technicalDistribution[0].label} ${data.technicalDistribution[0].value}`
        : '查看图纸与技术资料',
      route: '/drawing-library',
      tone: drawingCount ? 'yellow' : 'blue',
      Icon: FileCheck2,
    },
    {
      id: 'production',
      position: 'production',
      label: '生产执行',
      eyebrow: '现场协同',
      value: productionStream?.count || 0,
      unit: '项',
      badge: productionStream?.riskCount ? `${productionStream.riskCount} 项优先` : '暂无优先项',
      detail: productionStream?.items[0]?.title || '当前没有生产待办',
      route: productionStream?.route || '/production',
      tone: productionStream?.tone || 'green',
      Icon: Factory,
      stream: productionStream,
    },
    {
      id: 'material',
      position: 'material',
      label: '物料跟进',
      eyebrow: '物料保障',
      value: materialStream?.count || 0,
      unit: '项',
      badge: materialStream?.riskCount ? `${materialStream.riskCount} 项优先` : '暂无优先项',
      detail: materialStream?.items[0]?.title || '当前没有待跟进缺料',
      route: materialStream?.route || '/workspace/procurement',
      tone: materialStream?.riskCount ? 'yellow' : 'green',
      Icon: Boxes,
      stream: materialStream,
    },
    {
      id: 'quality',
      position: 'quality',
      label: '质量与问题',
      eyebrow: '未关闭问题',
      value: data.issueCount,
      unit: '项',
      badge: data.issueCount === null ? '待更新' : data.issueCount > 0 ? `待处理 ${data.issueCount}` : '暂无未关闭问题',
      detail: data.issueCount === null ? '问题数据未开放或等待更新' : data.issues[0]?.title || '当前没有未关闭问题',
      route: '/workspace/issues',
      tone: data.issueCount ? 'red' : 'green',
      Icon: ShieldCheck,
    },
    {
      id: 'labor',
      position: 'labor',
      label: '工时协同',
      eyebrow: '工时待办',
      value: laborStream?.count || 0,
      unit: '项',
      badge: laborStream?.riskCount ? `${laborStream.riskCount} 项待确认` : '暂无待确认',
      detail: laborStream?.items[0]?.title || '当前没有工时待办',
      route: laborStream?.route || '/workspace/reports',
      tone: laborStream?.tone || 'green',
      Icon: TimerReset,
      stream: laborStream,
    },
  ];
  const selectedCard = collaborationCards.find(card => card.id === selectedModule) || null;
  const planCompletionRate = data.planChart.total > 0
    ? Math.round((data.planChart.completed / data.planChart.total) * 100)
    : null;
  const onTimeRate = data.planChart.total > 0
    ? Math.max(0, Math.round(((data.planChart.total - data.planChart.overdue) / data.planChart.total) * 100))
    : null;
  const technicalTotal = data.technicalDistribution.reduce((sum, item) => sum + item.value, 0);
  const technicalComplete = data.technicalDistribution.find(item => item.id === 'complete')?.value || 0;
  const technicalCompleteRate = technicalTotal > 0
    ? Math.round((technicalComplete / technicalTotal) * 100)
    : null;

  async function logout(): Promise<void> {
    await fetch('/api/auth/logout', { method: 'POST', cache: 'no-store' });
    window.location.replace('/login');
  }

  function refresh(): void {
    startRefresh(() => router.refresh());
    void loadNotificationPreview();
  }

  function selectModule(id: SceneModuleId): void {
    const card = collaborationCards.find(item => item.id === id);
    if (!card) return;
    setSelectedModule(id);
    setFocusRequest({ id: ++focusSequence.current, category: sceneCategories[id], label: card.label });
    try { sessionStorage.setItem(`hm-home-focus:${user.id}`, id); } catch { /* Optional preference. */ }
  }

  function clearModule(): void {
    setSelectedModule(null);
    setFocusRequest({ id: ++focusSequence.current, category: 'ACTIONABLE', label: '' });
    try { sessionStorage.removeItem(`hm-home-focus:${user.id}`); } catch { /* Optional preference. */ }
  }

  function detachModule(): void {
    setSelectedModule(null);
    setFocusRequest(undefined);
    try { sessionStorage.removeItem(`hm-home-focus:${user.id}`); } catch { /* Optional preference. */ }
  }

  function toggleMotion(): void {
    const quiet = !quietMotion;
    setQuietMotion(quiet);
    try { localStorage.setItem('hm-home-motion', quiet ? 'quiet' : 'standard'); } catch { /* Optional preference. */ }
    if (sceneRef.current) {
      cancelPointerFrame(sceneRef.current);
      for (const property of ['--scene-x', '--scene-y', '--scene-x-soft', '--scene-y-soft', '--scene-x-back', '--scene-y-back']) sceneRef.current.style.removeProperty(property);
    }
  }

  function openUtility(event: React.MouseEvent<HTMLButtonElement>, panel: Exclude<UtilityPanel, null>): void {
    utilityButtonRef.current = event.currentTarget;
    setUtilityPanel(current => current === panel ? null : panel);
  }

  function openSearch(): void {
    setUtilityPanel(null);
    setSearchPanelOpen(true);
    window.requestAnimationFrame(() => searchInputRef.current?.focus());
  }

  function openStream(stream: HomeWorkstream, trigger: HTMLButtonElement): void {
    if (data.error) return;
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
      window.requestAnimationFrame(() => (analyticsTriggerRef.current || analyticsButtonRef.current)?.focus());
    }
  }

  function toggleAnalytics(): void {
    if (data.error) return;
    analyticsTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : analyticsButtonRef.current;
    setActiveStreamId(null);
    setAnalyticsOpen(value => !value);
  }

  return (
    <main ref={rootRef} className={`hm-home-shell hm-workbench-root hm-hcc-root hm-home-industrial ${hasOperationalData ? 'has-live-data' : 'is-plan-empty'}`} data-motion={quietMotion ? 'quiet' : 'standard'} data-page-visible={pageVisible}>
      <AppWorkbenchHeader
        user={user}
        activeHref="/home"
        subtitle="跨部门协同工作台"
        hideHeader
        sidebarExpanded={sidebarExpanded}
        onSidebarExpandedChange={setSidebarExpanded}
        menuItems={[
          { label: '系统设置', href: '/dashboard?openSettings=1' },
          { label: '退出登录', onSelect: () => { void logout(); } },
        ]}
      />

      <PortalMenu open={utilityPanel !== null} anchorRef={utilityButtonRef} className="hm-home-utility-menu" width={300} closeOnSelect={false} onClose={() => setUtilityPanel(null)}>
        {utilityPanel === 'notifications' && <div><header><Bell size={17} /><strong>业务待办</strong></header>{data.actionItems.length ? data.actionItems.slice(0, 3).map(item => <Link href={item.targetRoute} prefetch={false} key={item.id}><b>{item.title}</b><span>{item.subtitle}</span></Link>) : <p>当前没有新的业务待办</p>}</div>}
        {utilityPanel === 'messages' && <div><header><MessageSquareText size={17} /><strong>系统内通知{notificationUnreadCount > 0 ? ` · ${notificationUnreadCount} 未读` : ''}</strong></header>{notificationLoading ? <p>正在读取个人通知…</p> : notificationPreview.length ? notificationPreview.map(item => <Link href={item.targetRoute || '/workspace/messages'} prefetch={false} key={item.id}><b>{item.readAt ? item.title : `● ${item.title}`}</b><span>{item.body || '打开消息中心查看详情'}</span></Link>) : <p>当前没有系统内通知</p>}<Link className="hm-home-utility-all" href="/workspace/messages" prefetch={false}>查看全部通知</Link></div>}
        {utilityPanel === 'help' && <div><header><CircleHelp size={17} /><strong>帮助与支持</strong></header><Link href="/workspace/help" prefetch={false}><b>使用帮助</b><span>查看平台模块和规划入口</span></Link>{canOpenSettings && <Link href="/dashboard?openSettings=1" prefetch={false}><b>系统设置</b><span>安装、诊断和账号设置</span></Link>}</div>}
        {utilityPanel === 'account' && <div><header><UserRound size={17} /><strong>{displayName}</strong></header>{canOpenSettings && <Link href="/dashboard?openSettings=1" prefetch={false}><b>系统设置</b><span>安装、诊断和账号设置</span></Link>}<button type="button" onClick={() => void logout()}><b>退出登录</b><span>安全退出当前账号</span></button></div>}
      </PortalMenu>

      <div className="hm-home-frame hm-hcc-frame">
        {data.error && <div className="hm-home-error hm-hcc-error" role="alert"><span>首页数据加载失败</span><p>{data.error}</p><button type="button" onClick={refresh} disabled={refreshing}>重新加载</button></div>}

        <header className="hm-hcc-welcome-bar">
          <button className="hm-hcc-sidebar-toggle" type="button" aria-label={sidebarExpanded ? '收起平台导航' : '展开平台导航'} aria-expanded={sidebarExpanded} aria-controls="hm-platform-sidebar" onClick={() => setSidebarExpanded(value => !value)}><PanelLeft size={20} /></button>
          <div className="hm-hcc-greeting">
            <strong>{data.greeting}，{displayName}</strong>
            <span>高效协同每一单，让交付更可靠</span>
          </div>
          {canGlobalSearch && <button ref={searchLaunchRef} className="hm-hcc-search-launch" type="button" onClick={openSearch}><Search size={18} aria-hidden="true" /><span>搜索工单、图纸、物料、任务…</span><kbd>Ctrl K</kbd></button>}
          <div className="hm-hcc-top-meta">
            <div className="hm-hcc-date"><time dateTime={data.generatedAt}>{data.dateLabel}</time><small>{updatedTime(data.generatedAt)} 更新</small></div>
            <div className="hm-hcc-top-tools" aria-label="首页快捷操作">
              {canGlobalSearch && <button type="button" aria-label="打开全局搜索" title="搜索" onClick={openSearch}><Search aria-hidden="true" /></button>}
              <button type="button" aria-label="业务待办" title="业务待办" onClick={event => openUtility(event, 'notifications')}><Bell aria-hidden="true" />{data.actionItems.length > 0 && <span>{Math.min(data.actionItems.length, 9)}</span>}</button>
              {canReadNotifications && <button type="button" aria-label="系统内通知" title="系统内通知" onClick={event => openUtility(event, 'messages')}><MessageSquareText aria-hidden="true" />{notificationUnreadCount > 0 && <span>{Math.min(notificationUnreadCount, 9)}</span>}</button>}
              <button type="button" aria-label="帮助" title="帮助" onClick={event => openUtility(event, 'help')}><CircleHelp aria-hidden="true" /></button>
              <button className="hm-home-refresh" type="button" aria-label="刷新首页数据" title="刷新首页数据" disabled={refreshing} onClick={refresh}><RefreshCw className={refreshing ? 'is-spinning' : ''} aria-hidden="true" /></button>
              <button className="hm-hcc-account-button" type="button" aria-label={`${displayName}，打开账号菜单`} onClick={event => openUtility(event, 'account')}><i aria-hidden="true">{displayName.slice(0, 1)}</i><b>{displayName}</b></button>
            </div>
          </div>
          {canGlobalSearch && searchPanelOpen && (
            <div className="hm-hcc-search-popover" ref={searchWrapRef}>
              <div className="hm-home-search">
                <label className="sr-only" htmlFor="hm-home-global-search">全局搜索</label>
                <Search size={18} aria-hidden="true" />
                <input ref={searchInputRef} id="hm-home-global-search" value={keyword} onChange={event => setKeyword(event.target.value)} onFocus={() => keyword.trim() && setSearchOpen(true)} placeholder="搜索工单、计划、图纸、问题、文档..." autoComplete="off" />
                {keyword ? <button type="button" aria-label="清空搜索" title="清空搜索" onClick={() => { setKeyword(''); searchInputRef.current?.focus(); }}><X size={16} /></button> : <kbd>Ctrl K</kbd>}
              </div>
              {searchOpen && keyword.trim() && (
                <div className="hm-home-search-results" role="region" aria-label="全局搜索结果" aria-live="polite">
                  {searchLoading && <div className="hm-home-search-state"><span className="hm-home-spinner" />正在搜索</div>}
                  {!searchLoading && searchError && <div className="hm-home-search-state error">{searchError}</div>}
                  {!searchLoading && !searchError && !results.length && <div className="hm-home-search-state">未找到匹配结果</div>}
                  {!searchLoading && !searchError && searchGroups.map(([group, items]) => (
                    <section key={group}><h3>{group}</h3>{items.map(item => <Link href={item.route} prefetch={false} key={item.id} onClick={() => { setSearchOpen(false); setSearchPanelOpen(false); }}><strong>{item.title}</strong><span>{item.detail}</span></Link>)}</section>
                  ))}
                </div>
              )}
            </div>
          )}
        </header>

        <HomePurchasingShortcut />
        <div className="hm-hcc-main-grid">
          <section
            ref={sceneRef}
            className="hm-hcc-operations"
            data-focused={selectedModule || 'none'}
            aria-labelledby="hm-hcc-operations-title"
            onPointerMove={handleScenePointerMove}
            onPointerLeave={resetScenePointer}
          >
            <header className="hm-hcc-section-heading">
              <div className="hm-hcc-title-group"><h1 id="hm-hcc-operations-title">生产协同总览</h1><small>{data.error ? '数据待更新' : '协同工作台'}</small><p>全流程协同 · 看清进度 · 按期交付</p></div>
              <div className="hm-hcc-scene-controls">
                <button type="button" onClick={toggleMotion} aria-pressed={quietMotion} aria-label={quietMotion ? '开启标准动效' : '开启安静模式'}>{quietMotion ? <Play size={14} /> : <Pause size={14} />}<span>{quietMotion ? '安静模式' : '标准动效'}</span></button>
                {selectedModule && <button type="button" onClick={clearModule}><X size={14} /><span>总览</span></button>}
              </div>
            </header>

            <div className="hm-hcc-map">
              <div className="hm-industrial-backdrop" aria-hidden="true"><img src={`/assets/home/industrial-floor-v134136.webp?v=${assetRevision}`} alt="" draggable={false} onError={() => setAssetFailed(true)} /></div>
              <img className="hm-industrial-machine machine-top" src={`/assets/home/industrial-workcell-v134136.webp?v=${assetRevision}`} alt="" aria-hidden="true" draggable={false} onError={event => { event.currentTarget.style.visibility = 'hidden'; setAssetFailed(true); }} onLoad={event => { event.currentTarget.style.visibility = ''; }} />
              <svg className="hm-hcc-flow-map" viewBox="0 0 1000 680" preserveAspectRatio="none" aria-hidden="true">
                {collaborationCards.map(card => {
                  const paths: Record<SceneModuleId, string> = { plan: 'M500 338 C418 262 332 170 227 133', drawing: 'M500 338 C580 258 676 166 784 132', production: 'M500 338 C385 329 275 326 142 346', material: 'M500 338 C620 332 737 327 866 349', quality: 'M500 338 C418 420 335 506 230 548', labor: 'M500 338 C582 423 676 510 786 549' };
                  const risk = !data.error && (card.tone === 'yellow' || card.tone === 'red');
                  return <path key={card.id} className={`flow flow-${card.id} ${risk ? card.tone === 'red' ? 'danger' : 'warning' : ''} ${selectedModule === card.id ? 'is-selected' : ''}`} d={paths[card.id]} />;
                })}
              </svg>

              <button type="button" className="hm-hcc-core" disabled={Boolean(data.error)} aria-label={`本周计划完成率${progressRate === null ? '暂无数据' : `${progressRate}%`}，查看执行明细`} onClick={toggleAnalytics} aria-expanded={analyticsOpen} aria-controls="hm-command-analytics">
                <span aria-hidden="true"><UsersRound /></span>
                <small>本周计划完成率</small>
                <div
                  className="hm-hcc-core-rate"
                  style={{ '--rate': `${progressRate || 0}%` } as CSSProperties}
                >
                  <strong>{progressRate === null ? '--' : progressRate}<em>{progressRate === null ? '' : '%'}</em></strong>
                </div>
                <p>{data.error ? '等待业务数据更新' : `${data.planChart.completed} 项完成 · ${data.planChart.inProgress} 项进行中`}</p>
                <span className="hm-hcc-core-hint">查看执行明细<ChevronRight size={12} /></span>
              </button>

              <div className="hm-hcc-node-grid">
                {collaborationCards.map((card, index) => (
                  <article
                    className={`hm-hcc-node node-${card.position} tone-${card.tone}`}
                    key={card.id}
                    data-selected={selectedModule === card.id}
                    data-state={data.error || card.value === null ? 'unknown' : card.value === 0 ? 'empty' : 'active'}
                    style={{ '--card-index': index } as CSSProperties}
                    onPointerMove={handleTiltMove}
                    onPointerLeave={resetTilt}
                  >
                    <button className="hm-hcc-node-select" type="button" aria-label={`聚焦${card.label}`} aria-pressed={selectedModule === card.id} aria-controls="hm-home-module-focus" onClick={() => selectModule(card.id)}>
                      <span className="hm-hcc-node-icon" aria-hidden="true"><card.Icon /></span>
                      <div><small>{String(index + 1).padStart(2, '0')}</small><h2>{card.label}</h2></div>
                      <dl><div><dt>{card.eyebrow}</dt><dd>{data.error || card.value === null ? '--' : card.value} {card.unit}</dd></div><div><dt>协同状态</dt><dd>{data.error ? '等待更新' : card.badge}</dd></div></dl>
                      <i className={card.tone === 'red' || card.tone === 'yellow' ? 'has-risk' : ''} aria-hidden="true" />
                    </button>
                    <div className="hm-hcc-node-actions">
                      {card.stream ? <button type="button" disabled={Boolean(data.error)} aria-label={`展开${card.label}待办任务`} onClick={event => { selectModule(card.id); openStream(card.stream!, event.currentTarget); }}>待办<ChevronRight size={13} /></button> : <span>{card.id === 'plan' ? '周计划协同' : card.id === 'drawing' ? '技术资料协同' : '问题闭环'}</span>}
                      <Link href={card.route} prefetch={false} aria-label={`进入${card.label}`} onClick={() => selectModule(card.id)}>进入<ArrowUpRight size={13} /></Link>
                    </div>
                  </article>
                ))}
              </div>
              <div className="hm-hcc-map-caption"><span>杭连制造<small>让协同更清晰，让交付更可靠</small></span><div className="hm-hcc-legend" aria-label="业务状态图例"><span><i className="normal" />无优先项</span><span><i className="warning" />需关注</span><span><i className="danger" />待处理</span></div></div>
              {assetFailed && <button className="hm-hcc-asset-retry" type="button" onClick={() => { setAssetFailed(false); setAssetRevision(value => value + 1); }}>场景素材加载失败，点击重试</button>}
            </div>
            <div className={`hm-hcc-focus-summary ${selectedCard ? 'is-focused' : ''}`} id="hm-home-module-focus" aria-live="polite">
              {selectedCard ? <><span className="hm-hcc-focus-icon"><selectedCard.Icon size={20} /></span><div><strong>{selectedCard.label}<small>{data.error || selectedCard.value === null ? '数据待更新' : `${selectedCard.eyebrow} ${selectedCard.value} ${selectedCard.unit}`}</small></strong><p>{data.error ? '首页数据暂时不可用，请重新加载' : selectedCard.detail}</p></div>{selectedCard.stream && <button type="button" disabled={Boolean(data.error)} onClick={event => openStream(selectedCard.stream!, event.currentTarget)}>查看待办<ChevronRight size={14} /></button>}<Link href={selectedCard.route} prefetch={false}>进入模块<ArrowUpRight size={14} /></Link></> : <><span className="hm-hcc-focus-icon">{topAction ? <AlertTriangle size={20} /> : <CheckCircle2 size={20} />}</span><div><strong>{data.error ? '协同数据待更新' : topAction ? topAction.title : '从这里开始今天的协同'}<small>{riskCount > 0 ? `${riskCount} 项需优先` : data.periodLabel}</small></strong><p>{data.error ? '点击右上角刷新，重新获取业务状态' : topAction ? topAction.subtitle : '点击模块聚焦业务，查看相关待办与消息'}</p></div>{topAction && <Link href={topAction.targetRoute} prefetch={false}>查看事项<ArrowUpRight size={14} /></Link>}</>}
            </div>
          </section>

          <HomeNotificationCommandCenter
            enabled={canReadNotifications}
            refreshKey={data.generatedAt}
            focusRequest={focusRequest}
            onFocusClear={detachModule}
            onUnreadCountChange={setNotificationUnreadCount}
            onNotificationsChange={loadNotificationPreview}
          />
        </div>

        <section className="hm-hcc-insight-bar" aria-label="今日洞察">
          <Link className="hm-hcc-insight-title" href={planWorkbenchRoute} prefetch={false}><CalendarDays size={23} aria-hidden="true" /><small>本周计划</small><strong>{data.periodLabel}</strong><span>截至 {updatedTime(data.generatedAt)}<ChevronRight size={14} /></span></Link>
          <button className="hm-hcc-metric metric-plan" type="button" disabled={Boolean(data.error)} onClick={toggleAnalytics} aria-label="查看本周计划完成率明细"><BarChart3 size={23} aria-hidden="true" /><span>本周计划完成率</span><strong>{planCompletionRate === null ? '--' : `${planCompletionRate}%`}</strong><small>{data.planChart.completed} / {data.planChart.total} 已完成</small><i className="hm-hcc-metric-track" aria-hidden="true"><i style={{ width: `${planCompletionRate || 0}%` }} /></i></button>
          <button className="hm-hcc-metric metric-delivery" type="button" disabled={Boolean(data.error)} onClick={toggleAnalytics} aria-label="查看本周未逾期占比明细"><PieChart size={23} aria-hidden="true" /><span>本周未逾期占比</span><strong>{onTimeRate === null ? '--' : `${onTimeRate}%`}</strong><small>{data.planChart.overdue} / {data.planChart.total} 项逾期</small><i className="hm-hcc-metric-track" aria-hidden="true"><i style={{ width: `${onTimeRate || 0}%` }} /></i></button>
          <button className="hm-hcc-metric metric-drawing" type="button" disabled={Boolean(data.error)} onClick={toggleAnalytics} aria-label="查看技术资料完整率明细"><FileCheck2 size={23} aria-hidden="true" /><span>技术资料完整率</span><strong>{technicalCompleteRate === null ? '--' : `${technicalCompleteRate}%`}</strong><small>{technicalComplete} / {technicalTotal} 资料完整</small><i className="hm-hcc-metric-track" aria-hidden="true"><i style={{ width: `${technicalCompleteRate || 0}%` }} /></i></button>
          <button className="hm-hcc-metric metric-tasks" type="button" disabled={Boolean(data.error)} onClick={event => { const stream = [...data.workstreams].sort((a, b) => b.riskCount - a.riskCount || b.count - a.count)[0]; if (stream) openStream(stream, event.currentTarget); else selectModule('production'); }} aria-label="查看当前协同待办"><UsersRound size={23} aria-hidden="true" /><span>当前协同待办</span><strong>{data.error ? '--' : taskCount}</strong><small>{riskCount} 项需优先</small><i className="hm-hcc-metric-track" aria-hidden="true"><i style={{ width: `${taskCount ? Math.min(100, riskCount / taskCount * 100) : 0}%` }} /></i></button>
          <Link className="hm-hcc-primary-action" href={hasOperationalData ? '/production' : planWorkbenchRoute} prefetch={false}>进入工作台<ArrowUpRight /></Link>
        </section>

        <button className={`hm-command-overlay ${activeStream || analyticsOpen ? 'open' : ''}`} type="button" aria-label="关闭展开面板" aria-hidden={!activeStream && !analyticsOpen} tabIndex={activeStream || analyticsOpen ? 0 : -1} onClick={closeOverlays} />

        <aside ref={taskDrawerRef} className={`hm-command-task-drawer ${activeStream ? 'open' : ''}`} role="dialog" aria-modal={activeStream ? true : undefined} aria-hidden={!activeStream} aria-labelledby={activeStream ? 'hm-command-task-title' : undefined}>
          {activeStream && (
            <>
              <header>
                <span className={`tone-${activeStream.tone}`} aria-hidden="true">{(() => {
                  const Icon = workstreamIcons[activeStream.id];
                  return <Icon size={21} />;
                })()}</span>
                <div><small>协同待办 · 截至 {updatedTime(data.generatedAt)}</small><h2 id="hm-command-task-title">{activeStream.label}</h2><p>{activeStream.description}</p></div>
                <button ref={drawerCloseRef} type="button" aria-label={`关闭${activeStream.label}任务`} onClick={closeOverlays}><X size={19} /></button>
              </header>
              <div className="hm-command-drawer-summary">
                <div><span>待处理</span><strong>{activeStream.count}</strong></div>
                <div className={activeStream.riskCount > 0 ? 'has-risk' : ''}><span>需优先</span><strong>{activeStream.riskCount}</strong></div>
              </div>
              <div className="hm-command-drawer-list hm-scroll-region">
                {!activeStream.items.length ? (
                  <div className="hm-command-drawer-empty"><CheckCircle2 size={26} aria-hidden="true" /><strong>当前没有待处理任务</strong><p>可以进入业务模块查看完整记录。</p></div>
                ) : activeStream.items.map(item => (
                  <Link className={`risk-${item.risk}`} href={item.targetRoute} prefetch={false} key={item.id}>
                    <span>{item.status}</span>
                    <div><strong>{item.title}</strong><p>{item.subtitle}</p><small>{item.meta}</small></div>
                    <ChevronRight size={16} aria-hidden="true" />
                  </Link>
                ))}
              </div>
              <footer><Link href={activeStream.route} prefetch={false}>进入{activeStream.label}<ArrowUpRight size={15} aria-hidden="true" /></Link></footer>
            </>
          )}
        </aside>

        <section ref={analyticsPanelRef} className={`hm-command-analytics ${analyticsOpen ? 'open' : ''}`} id="hm-command-analytics" role="dialog" aria-modal={analyticsOpen ? true : undefined} aria-hidden={!analyticsOpen} aria-labelledby="hm-command-analytics-title">
          <header>
            <div><small>业务洞察</small><h2 id="hm-command-analytics-title">生产数据分析</h2></div>
            <button type="button" aria-label="关闭数据分析" tabIndex={analyticsOpen ? 0 : -1} onClick={closeOverlays}><X size={19} /></button>
          </header>
          <div className="hm-command-analytics-grid">
            <article>
              <span>本周计划完成率</span>
              <div className="hm-command-mini-donut" style={{ '--rate': `${progressRate || 0}%` } as CSSProperties}><strong>{progressRate === null ? '--' : `${progressRate}%`}</strong></div>
              <dl><div><dt>已完成</dt><dd>{data.planChart.completed}</dd></div><div><dt>执行中</dt><dd>{data.planChart.inProgress}</dd></div><div><dt>逾期</dt><dd>{data.planChart.overdue}</dd></div></dl>
              <p className="hm-hcc-metric-definition">本周已完成工单 ÷ 本周计划工单。未逾期占比为本周未逾期工单 ÷ 本周计划工单。</p>
              <Link href={planWorkbenchRoute} prefetch={false} tabIndex={analyticsOpen ? 0 : -1}>查看本周计划<ArrowUpRight size={14} /></Link>
            </article>
            <article><span>工单状态分布</span><DistributionBars items={data.stageDistribution} /><Link href="/production" prefetch={false} tabIndex={analyticsOpen ? 0 : -1}>查看生产工单<ArrowUpRight size={14} /></Link></article>
            <article><span>技术资料状态</span><DistributionBars items={data.technicalDistribution} /><p className="hm-hcc-metric-definition">技术资料完整工单 ÷ 当前统计工单。这里统计工单资料状态，不是图纸文件数量。</p><Link href="/drawing-library" prefetch={false} tabIndex={analyticsOpen ? 0 : -1}>进入图纸资料库<ArrowUpRight size={14} /></Link></article>
          </div>
        </section>
      </div>
    </main>
  );
}
