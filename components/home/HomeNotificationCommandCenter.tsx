'use client';

import {
  AlertTriangle,
  BellRing,
  Box,
  Check,
  CheckCircle2,
  CheckCheck,
  ChevronRight,
  CircleUserRound,
  Clock3,
  Factory,
  Filter,
  LoaderCircle,
  MoreHorizontal,
  Search,
  Settings2,
  ShieldCheck,
  Undo2,
  UserRoundCheck,
  Workflow,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  filterHomeNotifications,
  HOME_NOTIFICATION_LABELS as BUSINESS_LABELS,
  homeNotificationEmptyState,
  homeNotificationFilterCount,
  homeNotificationFocusState,
  type HomeNotificationFilter,
  type HomeNotificationFocusRequest,
  type HomeNotificationSummary as NotificationSummary,
  type NotificationView,
} from '@/lib/home-notification-view';
import type {
  NotificationBusinessCategoryDTO,
  SystemNotificationDTO,
} from '@/types';

type HomeNotification = SystemNotificationDTO & {
  completionKind?: 'MANUAL' | 'SOURCE_RESOLVED' | 'SYSTEM_RECONCILED' | null;
  completionReason?: string | null;
  canRestore?: boolean;
};

type NotificationInboxResponse = {
  ok?: boolean;
  notifications?: HomeNotification[];
  unreadCount?: number;
  pendingCount?: number;
  actionableCount?: number;
  urgentCount?: number;
  completedCount?: number;
  businessCategoryCounts?: Partial<Record<NotificationBusinessCategoryDTO, number>>;
  completedBusinessCategoryCounts?: Partial<Record<NotificationBusinessCategoryDTO, number>>;
  nextCursor?: string | null;
  error?: string;
  message?: string;
};

const EMPTY_SUMMARY: NotificationSummary = {
  unreadCount: 0,
  pendingCount: 0,
  actionableCount: 0,
  urgentCount: 0,
  completedCount: 0,
  businessCategoryCounts: {
    PRODUCTION: 0,
    QUALITY: 0,
    PROCESS: 0,
    MATERIAL: 0,
    SYSTEM: 0,
  },
  completedBusinessCategoryCounts: {
    PRODUCTION: 0,
    QUALITY: 0,
    PROCESS: 0,
    MATERIAL: 0,
    SYSTEM: 0,
  },
};

const FILTERS: Array<{
  value: HomeNotificationFilter;
  label: string;
  Icon: typeof BellRing;
}> = [
  { value: 'ACTIONABLE', label: '需我处理', Icon: UserRoundCheck },
  { value: 'PRODUCTION', label: '生产异常', Icon: Factory },
  { value: 'QUALITY', label: '质量', Icon: ShieldCheck },
  { value: 'PROCESS', label: '工艺', Icon: Workflow },
  { value: 'MATERIAL', label: '物料', Icon: Box },
  { value: 'SYSTEM', label: '系统', Icon: Settings2 },
];

function safeInternalRoute(value: string | null): string | null {
  const route = value?.trim();
  if (!route || !route.startsWith('/') || route.startsWith('//') || route.includes('\\')) return null;
  return /[\u0000-\u001f\u007f]/.test(route) ? null : route;
}

function elapsedTime(value: string): string {
  const createdAt = new Date(value);
  const elapsedMs = Date.now() - createdAt.getTime();
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return '刚刚';
  const minutes = Math.floor(elapsedMs / 60_000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes}分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}小时前`;
  return `${Math.floor(hours / 24)}天前`;
}

function completedTime(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value));
}

function completionLabel(item: HomeNotification): string {
  if (item.completionKind === 'SOURCE_RESOLVED') return '业务已结束';
  if (item.completionKind === 'SYSTEM_RECONCILED') return '系统归档';
  return '已完成';
}

function canRestoreNotification(item: HomeNotification): boolean {
  return Boolean(item.completedAt)
    && item.completionKind === 'MANUAL'
    && item.canRestore === true;
}

function priorityLabel(item: SystemNotificationDTO): string {
  if (item.priority === 'URGENT') return '紧急';
  if (item.priority === 'HIGH') return '高优先';
  return '一般';
}

function responseError(result: NotificationInboxResponse, fallback: string): string {
  return result.error || result.message || fallback;
}

function readableRequestError(reason: unknown, fallback: string): string {
  if (!(reason instanceof Error)) return fallback;
  if (reason.message === 'Failed to fetch' || reason.name === 'TypeError') {
    return '消息服务暂时不可用，请重试';
  }
  return reason.message || fallback;
}

export default function HomeNotificationCommandCenter({
  enabled,
  onUnreadCountChange,
  onNotificationsChange,
  focusRequest,
  onFocusClear,
  refreshKey,
}: {
  enabled: boolean;
  onUnreadCountChange?: (count: number) => void;
  onNotificationsChange?: () => void | Promise<void>;
  focusRequest?: HomeNotificationFocusRequest;
  onFocusClear?: () => void;
  refreshKey?: string;
}) {
  const [notifications, setNotifications] = useState<HomeNotification[]>([]);
  const [summary, setSummary] = useState<NotificationSummary>(EMPTY_SUMMARY);
  const [activeFilter, setActiveFilter] = useState<HomeNotificationFilter>('ACTIONABLE');
  const [view, setView] = useState<NotificationView>('pending');
  const [query, setQuery] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [loading, setLoading] = useState(enabled);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadMoreError, setLoadMoreError] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);
  const [markingAll, setMarkingAll] = useState(false);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);
  const requestController = useRef<AbortController | null>(null);
  const requestGeneration = useRef(0);
  const viewRef = useRef<NotificationView>(view);
  const enabledRef = useRef(enabled);
  const appliedFocusId = useRef<number | null>(null);
  enabledRef.current = enabled;

  const loadNotifications = useCallback(async ({
    cursor = null,
    append = false,
    requestView = viewRef.current,
    generation = requestGeneration.current,
  }: {
    cursor?: string | null;
    append?: boolean;
    requestView?: NotificationView;
    generation?: number;
  } = {}): Promise<void> => {
    if (generation !== requestGeneration.current || requestView !== viewRef.current) return;
    requestController.current?.abort();
    const controller = new AbortController();
    requestController.current = controller;
    const requestIsCurrent = (): boolean => (
      requestController.current === controller
      && requestGeneration.current === generation
      && viewRef.current === requestView
    );

    if (!enabledRef.current) {
      setNotifications([]);
      setSummary(EMPTY_SUMMARY);
      setNextCursor(null);
      setLoading(false);
      setLoadingMore(false);
      requestController.current = null;
      return;
    }
    if (append) {
      setLoadingMore(true);
    } else {
      setLoading(true);
      setLoadingMore(false);
    }
    if (!append) setError('');
    setLoadMoreError('');
    try {
      const params = new URLSearchParams({
        limit: '100',
        category: 'ALL',
        unreadOnly: 'false',
        state: requestView,
      });
      if (cursor) params.set('cursor', cursor);
      const response = await fetch(`/api/notifications?${params.toString()}`, {
        cache: 'no-store',
        signal: controller.signal,
      });
      const result = await response.json().catch(() => ({})) as NotificationInboxResponse;
      if (!response.ok || result.ok !== true || !Array.isArray(result.notifications)) {
        throw new Error(responseError(result, append ? '更多消息加载失败，请重试' : '消息加载失败，请稍后重试'));
      }
      if (!requestIsCurrent()) return;
      const nextSummary: NotificationSummary = {
        unreadCount: Math.max(0, Number(result.unreadCount) || 0),
        pendingCount: Math.max(0, Number(result.pendingCount ?? result.actionableCount) || 0),
        actionableCount: Math.max(0, Number(result.actionableCount) || 0),
        urgentCount: Math.max(0, Number(result.urgentCount) || 0),
        completedCount: Math.max(0, Number(result.completedCount) || 0),
        businessCategoryCounts: {
          PRODUCTION: Math.max(0, Number(result.businessCategoryCounts?.PRODUCTION) || 0),
          QUALITY: Math.max(0, Number(result.businessCategoryCounts?.QUALITY) || 0),
          PROCESS: Math.max(0, Number(result.businessCategoryCounts?.PROCESS) || 0),
          MATERIAL: Math.max(0, Number(result.businessCategoryCounts?.MATERIAL) || 0),
          SYSTEM: Math.max(0, Number(result.businessCategoryCounts?.SYSTEM) || 0),
        },
        completedBusinessCategoryCounts: {
          PRODUCTION: Math.max(0, Number(result.completedBusinessCategoryCounts?.PRODUCTION) || 0),
          QUALITY: Math.max(0, Number(result.completedBusinessCategoryCounts?.QUALITY) || 0),
          PROCESS: Math.max(0, Number(result.completedBusinessCategoryCounts?.PROCESS) || 0),
          MATERIAL: Math.max(0, Number(result.completedBusinessCategoryCounts?.MATERIAL) || 0),
          SYSTEM: Math.max(0, Number(result.completedBusinessCategoryCounts?.SYSTEM) || 0),
        },
      };
      setNotifications(current => {
        if (!append) return result.notifications || [];
        const knownIds = new Set(current.map(item => item.id));
        const additions = (result.notifications || []).filter(item => !knownIds.has(item.id));
        return [...current, ...additions];
      });
      setNextCursor(typeof result.nextCursor === 'string' && result.nextCursor ? result.nextCursor : null);
      setSummary(nextSummary);
      onUnreadCountChange?.(nextSummary.unreadCount);
    } catch (reason) {
      if ((reason as { name?: string }).name !== 'AbortError' && requestIsCurrent()) {
        const message = readableRequestError(reason, append ? '更多消息加载失败，请重试' : '消息加载失败，请稍后重试');
        if (append) setLoadMoreError(message);
        else setError(message);
      }
    } finally {
      if (requestIsCurrent()) {
        requestController.current = null;
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [onUnreadCountChange]);

  useEffect(() => {
    if (!focusRequest || appliedFocusId.current === focusRequest.id) return;
    appliedFocusId.current = focusRequest.id;
    const focusedState = homeNotificationFocusState(focusRequest.category);
    setActiveFilter(focusedState.filter);
    setQuery(focusedState.query);
    setUnreadOnly(focusedState.unreadOnly);
    setMenuId(null);
    if (viewRef.current !== focusedState.view) {
      setError('');
      viewRef.current = focusedState.view;
      requestGeneration.current += 1;
      requestController.current?.abort();
      requestController.current = null;
      setNotifications([]);
      setNextCursor(null);
      setLoadMoreError('');
      setLoading(enabledRef.current);
      setLoadingMore(false);
      setView(focusedState.view);
    }
  }, [focusRequest]);

  useEffect(() => {
    viewRef.current = view;
    const generation = requestGeneration.current + 1;
    requestGeneration.current = generation;
    requestController.current?.abort();
    requestController.current = null;
    setNotifications([]);
    setNextCursor(null);
    setLoadMoreError('');
    void loadNotifications({ requestView: view, generation });
    return () => {
      if (requestGeneration.current === generation) requestGeneration.current += 1;
      requestController.current?.abort();
      requestController.current = null;
    };
  }, [enabled, loadNotifications, refreshKey, view]);

  useEffect(() => {
    function closeMenu(event: PointerEvent): void {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuId(null);
    }
    document.addEventListener('pointerdown', closeMenu);
    return () => document.removeEventListener('pointerdown', closeMenu);
  }, []);

  useEffect(() => {
    if (!menuId) return;
    const menu = menuRef.current;
    const trigger = menu?.querySelector<HTMLButtonElement>('button[aria-expanded]');
    const actions = menu ? [...menu.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]')] : [];
    const frame = window.requestAnimationFrame(() => actions[0]?.focus());
    function onMenuKeyDown(event: KeyboardEvent): void {
      if (!menu?.contains(event.target as Node)) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setMenuId(null);
        trigger?.focus();
        return;
      }
      const current = actions.indexOf(document.activeElement as HTMLButtonElement);
      let next = current;
      if (event.key === 'ArrowDown') next = (current + 1) % actions.length;
      else if (event.key === 'ArrowUp') next = (current - 1 + actions.length) % actions.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = actions.length - 1;
      else return;
      event.preventDefault();
      actions[next]?.focus();
    }
    function onMenuFocusOut(event: FocusEvent): void {
      if (menu && !menu.contains(event.target as Node)) setMenuId(null);
    }
    document.addEventListener('keydown', onMenuKeyDown, true);
    document.addEventListener('focusin', onMenuFocusOut);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('keydown', onMenuKeyDown, true);
      document.removeEventListener('focusin', onMenuFocusOut);
    };
  }, [menuId]);

  const filteredNotifications = useMemo(() => filterHomeNotifications(notifications, {
    view, filter: activeFilter, query, unreadOnly,
  }), [activeFilter, notifications, query, unreadOnly, view]);
  const emptyState = homeNotificationEmptyState(summary, {
    view, filter: activeFilter, query, unreadOnly,
  }, { hasMore: Boolean(nextCursor), enabled });

  function changeFilter(filter: HomeNotificationFilter): void {
    setActiveFilter(filter);
    setQuery('');
    setUnreadOnly(false);
    setMenuId(null);
    onFocusClear?.();
  }

  function clearModuleFocus(): void {
    changeFilter('ACTIONABLE');
  }

  function changeView(nextView: NotificationView): void {
    if (nextView === view) return;
    setMenuId(null);
    viewRef.current = nextView;
    requestGeneration.current += 1;
    requestController.current?.abort();
    requestController.current = null;
    setNotifications([]);
    setNextCursor(null);
    setLoadMoreError('');
    setError('');
    setLoading(true);
    setLoadingMore(false);
    setUnreadOnly(false);
    setQuery('');
    setActiveFilter('ACTIONABLE');
    setView(nextView);
    onFocusClear?.();
  }

  async function refreshAfterMutation(): Promise<void> {
    const requestView = viewRef.current;
    const generation = requestGeneration.current;
    await loadNotifications({ requestView, generation });
    try {
      await onNotificationsChange?.();
    } catch {
      // The inbox has already refreshed; the compact header preview may retry independently.
    }
  }

  async function loadMore(): Promise<void> {
    if (!nextCursor || loadingMore || loading) return;
    const requestView = viewRef.current;
    const generation = requestGeneration.current;
    await loadNotifications({ cursor: nextCursor, append: true, requestView, generation });
  }

  async function updateReadState(item: HomeNotification): Promise<void> {
    if (savingId) return;
    setSavingId(item.id);
    setMenuId(null);
    setError('');
    try {
      const response = await fetch(`/api/notifications/${encodeURIComponent(item.id)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ read: !item.readAt }),
      });
      const result = await response.json().catch(() => ({})) as NotificationInboxResponse;
      if (!response.ok || result.ok !== true) throw new Error(responseError(result, '消息状态更新失败'));
      await refreshAfterMutation();
    } catch (reason) {
      setError(readableRequestError(reason, '消息状态更新失败'));
    } finally {
      setSavingId(null);
    }
  }

  async function snooze(item: HomeNotification): Promise<void> {
    if (savingId) return;
    setSavingId(item.id);
    setMenuId(null);
    setError('');
    try {
      const response = await fetch(`/api/notifications/${encodeURIComponent(item.id)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ snoozeMinutes: 60 }),
      });
      const result = await response.json().catch(() => ({})) as NotificationInboxResponse;
      if (!response.ok || result.ok !== true) throw new Error(responseError(result, '稍后提醒设置失败'));
      await refreshAfterMutation();
    } catch (reason) {
      setError(readableRequestError(reason, '稍后提醒设置失败'));
    } finally {
      setSavingId(null);
    }
  }

  async function updateCompletedState(item: HomeNotification): Promise<void> {
    if (savingId) return;
    if (item.completedAt && !canRestoreNotification(item)) return;
    setSavingId(item.id);
    setMenuId(null);
    setError('');
    try {
      const response = await fetch(`/api/notifications/${encodeURIComponent(item.id)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ completed: !item.completedAt }),
      });
      const result = await response.json().catch(() => ({})) as NotificationInboxResponse;
      if (!response.ok || result.ok !== true) {
        throw new Error(responseError(result, item.completedAt ? '恢复待处理失败' : '完成消息失败'));
      }
      await refreshAfterMutation();
    } catch (reason) {
      setError(readableRequestError(reason, item.completedAt ? '恢复待处理失败' : '完成消息失败'));
    } finally {
      setSavingId(null);
    }
  }

  async function markAllRead(): Promise<void> {
    if (markingAll || !summary.unreadCount) return;
    setMarkingAll(true);
    setError('');
    try {
      const response = await fetch('/api/notifications/read-all', { method: 'PATCH' });
      const result = await response.json().catch(() => ({})) as NotificationInboxResponse;
      if (!response.ok || result.ok !== true) throw new Error(responseError(result, '全部已读操作失败'));
      await refreshAfterMutation();
    } catch (reason) {
      setError(readableRequestError(reason, '全部已读操作失败'));
    } finally {
      setMarkingAll(false);
    }
  }

  return (
    <section className="hm-hcc-inbox" id="hm-hcc-inbox" aria-labelledby="hm-hcc-inbox-title" tabIndex={-1}>
      <header className="hm-hcc-inbox-heading">
        <div><small>协同消息</small><h2 id="hm-hcc-inbox-title">消息提醒</h2></div>
        <Link href="/workspace/messages" prefetch={false}>全部消息<ChevronRight aria-hidden="true" /></Link>
      </header>

      <div className="hm-hcc-message-summary" aria-live="polite">
        <div className="hm-hcc-status-tabs" role="tablist" aria-label="消息处理状态">
          <button type="button" role="tab" aria-selected={view === 'pending'} className={view === 'pending' ? 'active' : ''} onClick={() => changeView('pending')}>
            <UserRoundCheck aria-hidden="true" /><span>未完成消息</span><strong>{summary.pendingCount}</strong>
          </button>
          <button type="button" role="tab" aria-selected={view === 'completed'} className={view === 'completed' ? 'active completed' : ''} onClick={() => changeView('completed')}>
            <CheckCircle2 aria-hidden="true" /><span>已完成</span><strong>{summary.completedCount}</strong>
          </button>
        </div>
        <div className="hm-hcc-urgent-summary"><span>紧急</span><strong>{summary.urgentCount}</strong></div>
      </div>

      <div className="hm-hcc-inbox-workspace">
        <nav className="hm-hcc-category-rail" aria-label="消息业务分类">
          {FILTERS.map(filter => {
            const Icon = filter.Icon;
            const count = homeNotificationFilterCount(summary, filter.value, view);
            const label = filter.value === 'ACTIONABLE' && view === 'completed' ? '全部完成' : filter.label;
            return (
              <button
                type="button"
                className={activeFilter === filter.value ? 'active' : ''}
                aria-pressed={activeFilter === filter.value}
                onClick={() => changeFilter(filter.value)}
                key={filter.value}
              >
                <Icon aria-hidden="true" /><span>{label}</span><b>{count}</b>
              </button>
            );
          })}
        </nav>

        <div className="hm-hcc-message-pane">
          <div className="hm-hcc-message-toolbar">
            <label><Search aria-hidden="true" /><input aria-label="搜索消息" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索消息" /></label>
            {view === 'pending' && <button type="button" className={unreadOnly ? 'active' : ''} aria-pressed={unreadOnly} onClick={() => setUnreadOnly(value => !value)}><Filter aria-hidden="true" />仅看未读</button>}
            {view === 'pending' && <button type="button" disabled={markingAll || !summary.unreadCount} onClick={() => void markAllRead()}>{markingAll ? <LoaderCircle className="hm-hcc-spin" /> : <CheckCheck />}<span>全部已读</span></button>}
          </div>

          {focusRequest?.label && (
            <div className="hm-inbox-focus" role="status">
              <span>正在查看 <strong>{focusRequest.label}</strong> 相关消息</span>
              <button type="button" onClick={clearModuleFocus} aria-label="清除模块筛选"><X aria-hidden="true" />清除</button>
            </div>
          )}

          {error && <div className="hm-hcc-message-error" role="alert"><AlertTriangle /><span>{error}</span><button type="button" onClick={() => void loadNotifications()}>重试</button></div>}

          <div className="hm-hcc-message-list hm-scroll-region" aria-busy={loading || loadingMore} aria-live="polite">
            {loading && !notifications.length && Array.from({ length: 5 }, (_, index) => <div className="hm-hcc-message-skeleton" aria-hidden="true" key={index}><i /><span /><b /></div>)}
            {!loading && !filteredNotifications.length && !error && (
              <div className="hm-hcc-message-empty">
                <div className="hm-inbox-empty-scene" aria-hidden="true">{emptyState.categories.length ? <BellRing /> : <CheckCheck />}</div>
                <strong>{emptyState.title}</strong>
                <span>{emptyState.description}</span>
                {(emptyState.categories.length > 0 || emptyState.canClearFilters || emptyState.canViewCompleted) && (
                  <div className="hm-inbox-empty-actions">
                    {emptyState.categories.map(item => (
                      <button type="button" onClick={() => changeFilter(item.category)} key={item.category}>
                        {item.label}<b>{item.count}</b><ChevronRight aria-hidden="true" />
                      </button>
                    ))}
                    {emptyState.canClearFilters && <button type="button" onClick={() => { setQuery(''); setUnreadOnly(false); }}>清除搜索与筛选<ChevronRight aria-hidden="true" /></button>}
                    {emptyState.canViewCompleted && <button type="button" onClick={() => changeView('completed')}>回看已完成消息<ChevronRight aria-hidden="true" /></button>}
                  </div>
                )}
              </div>
            )}
            {filteredNotifications.map(item => {
              const targetRoute = safeInternalRoute(item.targetRoute);
              const isUnread = !item.readAt;
              const isSaving = savingId === item.id;
              return (
                <article className={`hm-hcc-message-row priority-${item.priority.toLowerCase()} ${isUnread ? 'unread' : 'read'} ${item.completedAt ? 'completed' : ''}`} key={item.id}>
                  <i className="hm-hcc-unread-dot" aria-hidden="true" />
                  <div className="hm-hcc-message-copy">
                    <div><span className={`hm-hcc-priority ${item.priority.toLowerCase()}`}>{item.completedAt ? completionLabel(item) : priorityLabel(item)}</span><small>{BUSINESS_LABELS[item.businessCategory]}</small><time dateTime={item.completedAt || item.createdAt}><Clock3 />{elapsedTime(item.completedAt || item.createdAt)}</time></div>
                    <h3>{item.title}</h3>
                    <p>{item.body || `来源：${item.sourceType || '系统协同'}`}</p>
                    {!item.completedAt && <p className="hm-inbox-message-origin">{item.requiresAction ? '需要你处理' : '协同进展 · 供你查看'}{item.actorName ? ` · ${item.actorName}` : ''}</p>}
                    {item.completedAt && <p className="hm-hcc-completion-note"><CheckCircle2 aria-hidden="true" />{completedTime(item.completedAt)} 完成 · {item.completionReason || completionLabel(item)}</p>}
                  </div>
                  <div className="hm-hcc-message-actions">
                    {targetRoute && <Link href={targetRoute} prefetch={false}>{item.completedAt || !item.requiresAction ? '查看详情' : '去处理'}</Link>}
                    {(!item.completedAt || canRestoreNotification(item)) ? <button className="hm-hcc-complete-action" type="button" disabled={isSaving} onClick={() => void updateCompletedState(item)}>
                      {isSaving ? <LoaderCircle className="hm-hcc-spin" /> : item.completedAt ? <Undo2 /> : <CheckCircle2 />}
                      <span>{item.completedAt ? '恢复' : '完成'}</span>
                    </button> : <span className="hm-hcc-locked-completion"><CheckCircle2 aria-hidden="true" />{completionLabel(item)}</span>}
                    <div className="hm-hcc-message-more" ref={menuId === item.id ? menuRef : undefined}>
                      <button type="button" aria-label={`更多操作：${item.title}`} aria-expanded={menuId === item.id} disabled={isSaving} onClick={() => setMenuId(current => current === item.id ? null : item.id)}>{isSaving ? <LoaderCircle className="hm-hcc-spin" /> : <MoreHorizontal />}</button>
                      {menuId === item.id && <div role="menu">{!item.completedAt && <button type="button" role="menuitem" onClick={() => void snooze(item)}><BellRing />1小时后提醒</button>}{(!item.completedAt || canRestoreNotification(item)) && <button type="button" role="menuitem" onClick={() => void updateCompletedState(item)}>{item.completedAt ? <Undo2 /> : <CheckCircle2 />}{item.completedAt ? '恢复到待处理' : '设为已完成'}</button>}<button type="button" role="menuitem" onClick={() => void updateReadState(item)}>{isUnread ? <Check /> : <CircleUserRound />}{isUnread ? '标为已读' : '恢复未读'}</button></div>}
                    </div>
                  </div>
                </article>
              );
            })}
            {nextCursor && (
              <div className={`hm-hcc-load-more ${loadMoreError ? 'has-error' : ''}`}>
                <button type="button" disabled={loadingMore || loading} onClick={() => void loadMore()}>
                  {loadingMore && <LoaderCircle className="hm-hcc-spin" aria-hidden="true" />}
                  {loadingMore ? '正在加载…' : loadMoreError ? '重试加载更多' : '加载更多'}
                </button>
                <span>{loadMoreError || `已加载 ${notifications.length} 条，可继续查看更早记录`}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
