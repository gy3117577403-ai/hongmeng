'use client';

import {
  AlertTriangle,
  ArrowLeft,
  Bell,
  BellRing,
  Box,
  Check,
  CheckCheck,
  CheckCircle2,
  ChevronRight,
  CircleUserRound,
  Clock3,
  Factory,
  Filter,
  Inbox,
  ListChecks,
  LoaderCircle,
  LockKeyhole,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Undo2,
  Workflow,
} from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppWorkbenchHeader } from '@/components/layout/AppWorkbenchHeader';
import { landingRouteForAccess } from '@/lib/app-route-access';
import type {
  CurrentUserDTO,
  NotificationBusinessCategoryDTO,
  NotificationCompletionKindDTO,
  NotificationInboxStateDTO,
  SystemNotificationCategoryDTO,
  SystemNotificationDTO,
} from '@/types';

type BusinessCategoryFilter = 'ALL' | NotificationBusinessCategoryDTO;
type ReadFilter = 'ALL' | 'UNREAD';

type NotificationListResponse = {
  ok?: boolean;
  notifications?: SystemNotificationDTO[];
  unreadCount?: number;
  actionableCount?: number;
  urgentCount?: number;
  pendingCount?: number;
  completedCount?: number;
  businessCategoryCounts?: Partial<Record<NotificationBusinessCategoryDTO, number>>;
  completedBusinessCategoryCounts?: Partial<Record<NotificationBusinessCategoryDTO, number>>;
  nextCursor?: string | null;
  error?: string;
  message?: string;
};

type NotificationSummary = {
  unreadCount: number;
  actionableCount: number;
  urgentCount: number;
  pendingCount: number;
  completedCount: number;
  businessCategoryCounts: Record<NotificationBusinessCategoryDTO, number>;
  completedBusinessCategoryCounts: Record<NotificationBusinessCategoryDTO, number>;
};

const EMPTY_SUMMARY: NotificationSummary = {
  unreadCount: 0,
  actionableCount: 0,
  urgentCount: 0,
  pendingCount: 0,
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

const CATEGORY_OPTIONS: Array<{
  value: BusinessCategoryFilter;
  label: string;
  description: string;
  icon: typeof Bell;
}> = [
  { value: 'ALL', label: '全部分类', description: '所有业务与系统提醒', icon: Inbox },
  { value: 'PRODUCTION', label: '生产异常', description: '生产执行与现场异常', icon: Factory },
  { value: 'QUALITY', label: '质量', description: '质量闭环与验证事项', icon: ShieldCheck },
  { value: 'PROCESS', label: '工艺', description: '工艺变更与路线协同', icon: Workflow },
  { value: 'MATERIAL', label: '物料', description: '齐套、缺料与补料提醒', icon: Box },
  { value: 'SYSTEM', label: '系统', description: '账号、平台与规则提醒', icon: Settings2 },
];

const CATEGORY_LABELS: Record<SystemNotificationCategoryDTO, string> = {
  SYSTEM: '系统消息',
  ACCOUNT: '账号与权限',
  TODO: '待办提醒',
  APPROVAL: '审批协同',
};

const CATEGORY_ICONS: Record<SystemNotificationCategoryDTO, typeof Bell> = {
  SYSTEM: Sparkles,
  ACCOUNT: LockKeyhole,
  TODO: ListChecks,
  APPROVAL: ShieldCheck,
};

const BUSINESS_LABELS: Record<NotificationBusinessCategoryDTO, string> = {
  PRODUCTION: '生产异常',
  QUALITY: '质量',
  PROCESS: '工艺',
  MATERIAL: '物料',
  SYSTEM: '系统',
};

function notificationTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '时间待确认';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

function completionLabel(kind: NotificationCompletionKindDTO | null): string {
  if (kind === 'SOURCE_RESOLVED') return '业务已结束';
  if (kind === 'SYSTEM_RECONCILED') return '系统已归档';
  return '手动完成';
}

function completionReason(item: SystemNotificationDTO): string {
  const reason = item.completionReason?.trim();
  if (reason) return reason;
  if (item.completionKind === 'SOURCE_RESOLVED') return '对应业务状态已经结束';
  if (item.completionKind === 'SYSTEM_RECONCILED') return '系统依据消息生命周期完成归档';
  return '用户手动标记为已完成';
}

function readableRequestError(reason: unknown, fallback: string): string {
  if (!(reason instanceof Error)) return fallback;
  const message = reason.message.trim();
  if (
    reason.name === 'TypeError'
    || /failed to fetch|networkerror|network request failed|load failed/i.test(message)
  ) {
    return '消息服务暂时不可用，请检查网络后重试';
  }
  return message || fallback;
}

function safeInternalRoute(value: string | null): string | null {
  const route = value?.trim();
  if (
    !route
    || !route.startsWith('/')
    || route.startsWith('//')
    || route.includes('\\')
    || /[\u0000-\u001f\u007f]/.test(route)
  ) return null;

  try {
    const base = 'https://hanglian.internal';
    const parsed = new URL(route, base);
    if (parsed.origin !== base) return null;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}

function responseError(result: NotificationListResponse, fallback: string): string {
  return result.error || result.message || fallback;
}

function mergeNotifications(
  current: SystemNotificationDTO[],
  incoming: SystemNotificationDTO[],
): SystemNotificationDTO[] {
  const seen = new Set(current.map(item => item.id));
  return [...current, ...incoming.filter(item => !seen.has(item.id))];
}

function summaryFromResponse(result: NotificationListResponse): NotificationSummary {
  return {
    unreadCount: Math.max(0, Number(result.unreadCount) || 0),
    actionableCount: Math.max(0, Number(result.actionableCount) || 0),
    urgentCount: Math.max(0, Number(result.urgentCount) || 0),
    pendingCount: Math.max(0, Number(result.pendingCount) || 0),
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
}

function categoryCount(
  summary: NotificationSummary,
  category: BusinessCategoryFilter,
  view: NotificationInboxStateDTO,
): number {
  if (category === 'ALL') return view === 'completed' ? summary.completedCount : summary.pendingCount;
  return view === 'completed'
    ? summary.completedBusinessCategoryCounts[category]
    : summary.businessCategoryCounts[category];
}

export default function NotificationCenterShell({ user }: { user: CurrentUserDTO }) {
  const [view, setView] = useState<NotificationInboxStateDTO>('pending');
  const [category, setCategory] = useState<BusinessCategoryFilter>('ALL');
  const [readFilter, setReadFilter] = useState<ReadFilter>('ALL');
  const [query, setQuery] = useState('');
  const [notifications, setNotifications] = useState<SystemNotificationDTO[]>([]);
  const [summary, setSummary] = useState<NotificationSummary>(EMPTY_SUMMARY);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');
  const [reloadToken, setReloadToken] = useState(0);
  const requestController = useRef<AbortController | null>(null);
  const landingHref = landingRouteForAccess(user.access);
  const selectedCategory = useMemo(
    () => CATEGORY_OPTIONS.find(item => item.value === category) || CATEGORY_OPTIONS[0],
    [category],
  );

  const loadNotifications = useCallback(async (
    cursor: string | null = null,
    append = false,
  ): Promise<void> => {
    requestController.current?.abort();
    const controller = new AbortController();
    requestController.current = controller;
    if (append) setLoadingMore(true);
    else setLoading(true);
    setError('');

    try {
      const params = new URLSearchParams({
        limit: '30',
        unreadOnly: String(view === 'pending' && readFilter === 'UNREAD'),
        category: 'ALL',
        state: view,
      });
      if (cursor) params.set('cursor', cursor);
      const response = await fetch(`/api/notifications?${params.toString()}`, {
        cache: 'no-store',
        signal: controller.signal,
      });
      const result = await response.json().catch(() => ({})) as NotificationListResponse;
      if (!response.ok || result.ok !== true || !Array.isArray(result.notifications)) {
        throw new Error(responseError(result, '消息加载失败，请稍后重试'));
      }
      setNotifications(current => (
        append ? mergeNotifications(current, result.notifications || []) : result.notifications || []
      ));
      setSummary(summaryFromResponse(result));
      setNextCursor(typeof result.nextCursor === 'string' ? result.nextCursor : null);
    } catch (reason) {
      if ((reason as { name?: string }).name !== 'AbortError') {
        setError(readableRequestError(reason, '消息加载失败，请稍后重试'));
        if (!append) {
          setNotifications([]);
          setNextCursor(null);
        }
      }
    } finally {
      if (requestController.current === controller) {
        requestController.current = null;
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [readFilter, view]);

  useEffect(() => {
    void loadNotifications();
    return () => requestController.current?.abort();
  }, [loadNotifications, reloadToken]);

  const filteredNotifications = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return notifications
      .filter(item => view === 'completed' ? Boolean(item.completedAt) : !item.completedAt)
      .filter(item => category === 'ALL' || item.businessCategory === category)
      .filter(item => !keyword || [
        item.title,
        item.body,
        item.actorName,
        item.sourceType,
        item.completionReason,
        BUSINESS_LABELS[item.businessCategory],
      ].filter(Boolean).some(value => String(value).toLowerCase().includes(keyword)));
  }, [category, notifications, query, view]);

  function changeView(nextView: NotificationInboxStateDTO): void {
    if (nextView === view) return;
    requestController.current?.abort();
    setNotifications([]);
    setNextCursor(null);
    setReadFilter('ALL');
    setView(nextView);
  }

  async function toggleRead(item: SystemNotificationDTO): Promise<void> {
    if (savingIds.has(item.id)) return;
    const shouldRead = !item.readAt;
    setSavingIds(current => new Set(current).add(item.id));
    setError('');
    try {
      const response = await fetch(`/api/notifications/${encodeURIComponent(item.id)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ read: shouldRead }),
      });
      const result = await response.json().catch(() => ({})) as NotificationListResponse;
      if (!response.ok || result.ok !== true) {
        throw new Error(responseError(result, shouldRead ? '标记已读失败' : '恢复未读失败'));
      }
      await loadNotifications();
    } catch (reason) {
      setError(readableRequestError(reason, '消息状态更新失败'));
    } finally {
      setSavingIds(current => {
        const next = new Set(current);
        next.delete(item.id);
        return next;
      });
    }
  }

  async function updateCompletedState(item: SystemNotificationDTO): Promise<void> {
    if (savingIds.has(item.id)) return;
    const restoring = Boolean(item.completedAt);
    if (restoring && (item.completionKind !== 'MANUAL' || item.canRestore !== true)) return;
    setSavingIds(current => new Set(current).add(item.id));
    setError('');
    try {
      const response = await fetch(`/api/notifications/${encodeURIComponent(item.id)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ completed: !restoring }),
      });
      const result = await response.json().catch(() => ({})) as NotificationListResponse;
      if (!response.ok || result.ok !== true) {
        throw new Error(responseError(result, restoring ? '恢复待处理失败' : '设为已完成失败'));
      }
      await loadNotifications();
    } catch (reason) {
      setError(readableRequestError(reason, restoring ? '恢复待处理失败' : '设为已完成失败'));
    } finally {
      setSavingIds(current => {
        const next = new Set(current);
        next.delete(item.id);
        return next;
      });
    }
  }

  async function markAllRead(): Promise<void> {
    if (!summary.unreadCount || markingAll || view !== 'pending') return;
    setMarkingAll(true);
    setError('');
    try {
      const response = await fetch('/api/notifications/read-all', { method: 'PATCH' });
      const result = await response.json().catch(() => ({})) as NotificationListResponse;
      if (!response.ok || result.ok !== true) {
        throw new Error(responseError(result, '全部标记已读失败'));
      }
      await loadNotifications();
    } catch (reason) {
      setError(readableRequestError(reason, '全部标记已读失败'));
    } finally {
      setMarkingAll(false);
    }
  }

  async function logout(): Promise<void> {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    window.location.href = '/login';
  }

  const listTitle = `${category === 'ALL'
    ? view === 'completed' ? '全部已完成' : '全部待处理'
    : selectedCategory.label}${view === 'pending' && readFilter === 'UNREAD' ? ' · 未读' : ''}`;

  return (
    <main className="notification-center-shell hm-workbench-root">
      <AppWorkbenchHeader
        user={user}
        activeHref="/workspace/messages"
        subtitle="个人通知与业务协同"
        hideHeader
        sidebarTriggerTargetId="notification-center-sidebar-trigger"
        menuItems={[
          { label: '个人账号', href: '/account' },
          { label: '系统设置', href: '/dashboard?openSettings=1' },
          { label: '退出登录', onSelect: () => void logout() },
        ]}
      />

      <div className="nc-page-frame">
        <header className="nc-command-bar">
          <div className="nc-command-copy">
            <div id="notification-center-sidebar-trigger" className="nc-sidebar-trigger" />
            <span className="nc-command-mark" aria-hidden="true"><BellRing /></span>
            <div>
              <small>协同消息</small>
              <div className="nc-command-title"><h1>消息中心</h1><b aria-live="polite" aria-label={`当前 ${summary.pendingCount} 条待处理消息`}>{summary.pendingCount} 待处理</b></div>
              <p>待处理与已完成分开管理；业务结束后自动收口，手动完成的消息可以恢复。</p>
            </div>
          </div>
          <div className="nc-command-actions">
            <button type="button" disabled={loading} onClick={() => setReloadToken(value => value + 1)}>
              <RefreshCw className={loading ? 'nc-spin' : ''} />刷新
            </button>
            <Link href={landingHref} prefetch={false}><ArrowLeft />返回工作台</Link>
            <Link className="nc-user-link" href="/account" prefetch={false} title="个人账号中心">
              <span>{(user.employee?.name || user.displayName || user.username).slice(0, 1)}</span>
              <b>{user.employee?.name || user.displayName || user.username}</b>
            </Link>
          </div>
        </header>

        <div className="nc-workspace">
          <aside className="nc-filter-panel" aria-label="消息筛选">
            <section className="nc-inbox-switch">
              <header><span>处理状态</span><small>{summary.unreadCount ? `${summary.unreadCount} 条未读` : '当前均已查看'}</small></header>
              <div role="tablist" aria-label="消息处理状态">
                <button type="button" role="tab" aria-selected={view === 'pending'} className={view === 'pending' ? 'active' : ''} onClick={() => changeView('pending')}>
                  <Inbox /><span><b>待处理</b><small>仍需关注或继续处理</small></span><em>{summary.pendingCount}</em>
                </button>
                <button type="button" role="tab" aria-selected={view === 'completed'} className={view === 'completed' ? 'active' : ''} onClick={() => changeView('completed')}>
                  <CheckCircle2 /><span><b>已完成</b><small>手动完成或业务自动收口</small></span><em>{summary.completedCount}</em>
                </button>
              </div>
            </section>

            <section className="nc-category-filter">
              <header><span>消息分类</span></header>
              <div>
                {CATEGORY_OPTIONS.map(option => {
                  const Icon = option.icon;
                  const count = categoryCount(summary, option.value, view);
                  return (
                    <button
                      type="button"
                      className={category === option.value ? 'active' : ''}
                      aria-pressed={category === option.value}
                      onClick={() => setCategory(option.value)}
                      key={option.value}
                    >
                      <Icon /><span><b>{option.label}</b><small>{option.description}</small></span><em>{count}</em>
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="nc-safety-note">
              <ShieldCheck />
              <div><b>权限随账号实时校验</b><span>通知不会扩大业务权限；无权访问的事项不会提供跳转。</span></div>
            </section>
          </aside>

          <section className="nc-list-panel" aria-labelledby="notification-list-title" aria-busy={loading || loadingMore}>
            <header className="nc-list-toolbar">
              <div><small>个人收件箱</small><h2 id="notification-list-title">{listTitle}</h2><p>{selectedCategory.description}</p></div>
              <div>
                <label className="nc-search-box">
                  <Search aria-hidden="true" />
                  <input aria-label="搜索消息" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索标题、内容、来源" />
                </label>
                <span>{loading ? '正在同步' : `${filteredNotifications.length} 条显示 · ${notifications.length} 条已加载`}</span>
                {view === 'pending' && <button type="button" className={readFilter === 'UNREAD' ? 'active' : ''} aria-pressed={readFilter === 'UNREAD'} onClick={() => setReadFilter(value => value === 'UNREAD' ? 'ALL' : 'UNREAD')}>
                  <Filter />{readFilter === 'UNREAD' ? '显示全部' : '仅看未读'}
                </button>}
                {view === 'pending' && <button type="button" disabled={!summary.unreadCount || markingAll} onClick={() => void markAllRead()}>
                  {markingAll ? <LoaderCircle className="nc-spin" /> : <CheckCheck />}{markingAll ? '处理中' : '全部已读'}
                </button>}
              </div>
            </header>

            {error && <div className="nc-error" role="alert"><AlertTriangle /><span>{error}</span><button type="button" onClick={() => setReloadToken(value => value + 1)}>重新加载</button></div>}

            <div className="nc-notification-list hm-scroll-region" tabIndex={0} aria-live="polite">
              {loading && !notifications.length && Array.from({ length: 5 }, (_, index) => (
                <div className="nc-skeleton" aria-hidden="true" key={index}><i /><div><span /><b /><em /></div></div>
              ))}

              {!loading && !filteredNotifications.length && !error && (
                <div className="nc-empty-state">
                  <span><CheckCheck /></span>
                  <h3>{view === 'completed' ? '当前筛选下没有已完成消息' : readFilter === 'UNREAD' ? '当前筛选下没有未读待处理消息' : '当前筛选下没有待处理消息'}</h3>
                  <p>{view === 'completed' ? '手动完成及业务自动收口的内容会保留在这里。' : '新的生产、质量、工艺与物料提醒会自动进入待处理。'}</p>
                  {(readFilter !== 'ALL' || category !== 'ALL' || query) && <button type="button" onClick={() => { setReadFilter('ALL'); setCategory('ALL'); setQuery(''); }}>清除筛选条件</button>}
                </div>
              )}

              {filteredNotifications.map(item => {
                const Icon = CATEGORY_ICONS[item.category] || Bell;
                const targetRoute = safeInternalRoute(item.targetRoute);
                const isUnread = !item.readAt;
                const saving = savingIds.has(item.id);
                const completed = Boolean(item.completedAt);
                const canRestore = completed && item.completionKind === 'MANUAL' && item.canRestore === true;
                return (
                  <article className={`nc-notification-card ${isUnread ? 'is-unread' : 'is-read'} ${completed ? 'is-completed' : ''} priority-${item.priority.toLowerCase()}`} key={item.id}>
                    <span className="nc-notification-icon"><Icon /></span>
                    <div className="nc-notification-content">
                      <header>
                        <div><span className="nc-category-label">{BUSINESS_LABELS[item.businessCategory]}</span><span className="nc-category-label">{CATEGORY_LABELS[item.category]}</span>{completed ? <span className="nc-priority-label completed">{completionLabel(item.completionKind)}</span> : item.priority !== 'NORMAL' && <span className={`nc-priority-label ${item.priority.toLowerCase()}`}>{item.priority === 'URGENT' ? '紧急' : '重要'}</span>}{isUnread && <i>未读</i>}</div>
                        <time dateTime={item.completedAt || item.createdAt}><Clock3 />{notificationTime(item.completedAt || item.createdAt)}</time>
                      </header>
                      <h3>{item.title}</h3>
                      {item.body && <p>{item.body}</p>}
                      {item.completedAt && <p className="nc-completion-note"><CheckCircle2 /><span><b>{completionLabel(item.completionKind)}</b> · {notificationTime(item.completedAt)} · 原因：{completionReason(item)}</span></p>}
                      <footer>
                        <div>
                          {item.actorName && <span><CircleUserRound />{item.actorName}</span>}
                          {item.sourceType && <span>来源：{item.sourceType}</span>}
                        </div>
                        <div>
                          {!completed && <button type="button" disabled={saving} onClick={() => void updateCompletedState(item)}>
                            {saving ? <LoaderCircle className="nc-spin" /> : <CheckCircle2 />}{saving ? '保存中' : '设为已完成'}
                          </button>}
                          {canRestore && <button type="button" disabled={saving} onClick={() => void updateCompletedState(item)}>
                            {saving ? <LoaderCircle className="nc-spin" /> : <Undo2 />}{saving ? '保存中' : '恢复待处理'}
                          </button>}
                          {completed && !canRestore && <button type="button" disabled title="该消息由业务状态自动收口，不能手动恢复"><LockKeyhole />自动收口</button>}
                          <button type="button" disabled={saving} onClick={() => void toggleRead(item)}>
                            {saving ? <LoaderCircle className="nc-spin" /> : isUnread ? <Check /> : <Bell />}{saving ? '保存中' : isUnread ? '标记已读' : '恢复未读'}
                          </button>
                          {targetRoute && <Link href={targetRoute} prefetch={false}>{completed ? '查看详情' : item.requiresAction ? '前往处理' : '查看详情'}<ChevronRight /></Link>}
                        </div>
                      </footer>
                    </div>
                  </article>
                );
              })}

              {!loading && nextCursor && (
                <button className="nc-load-more" type="button" disabled={loadingMore} onClick={() => void loadNotifications(nextCursor, true)}>
                  {loadingMore ? <LoaderCircle className="nc-spin" /> : <ChevronRight />}{loadingMore ? '正在加载' : '加载更多消息'}
                </button>
              )}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
