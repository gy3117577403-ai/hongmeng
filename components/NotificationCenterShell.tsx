'use client';

import {
  AlertTriangle,
  ArrowLeft,
  Bell,
  BellRing,
  Check,
  CheckCheck,
  ChevronRight,
  CircleUserRound,
  Clock3,
  Inbox,
  ListChecks,
  LoaderCircle,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppWorkbenchHeader } from '@/components/layout/AppWorkbenchHeader';
import { landingRouteForAccess } from '@/lib/app-route-access';
import type {
  CurrentUserDTO,
  SystemNotificationCategoryDTO,
  SystemNotificationDTO,
} from '@/types';

type CategoryFilter = 'ALL' | SystemNotificationCategoryDTO;
type ReadFilter = 'ALL' | 'UNREAD';

type NotificationListResponse = {
  ok?: boolean;
  notifications?: SystemNotificationDTO[];
  unreadCount?: number;
  nextCursor?: string | null;
  error?: string;
  message?: string;
};

const CATEGORY_OPTIONS: Array<{
  value: CategoryFilter;
  label: string;
  description: string;
  icon: typeof Bell;
}> = [
  { value: 'ALL', label: '全部消息', description: '所有业务与系统提醒', icon: Inbox },
  { value: 'TODO', label: '待办提醒', description: '需要继续处理的事项', icon: ListChecks },
  { value: 'APPROVAL', label: '审批协同', description: '申请、复核与审批结果', icon: ShieldCheck },
  { value: 'ACCOUNT', label: '账号与权限', description: '账号安全及授权变更', icon: LockKeyhole },
  { value: 'SYSTEM', label: '系统消息', description: '平台运行与规则提醒', icon: Sparkles },
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

export default function NotificationCenterShell({ user }: { user: CurrentUserDTO }) {
  const [category, setCategory] = useState<CategoryFilter>('ALL');
  const [readFilter, setReadFilter] = useState<ReadFilter>('ALL');
  const [notifications, setNotifications] = useState<SystemNotificationDTO[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
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
        unreadOnly: String(readFilter === 'UNREAD'),
        category,
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
      setUnreadCount(Math.max(0, Number(result.unreadCount) || 0));
      setNextCursor(typeof result.nextCursor === 'string' ? result.nextCursor : null);
    } catch (reason) {
      if ((reason as { name?: string }).name !== 'AbortError') {
        setError(reason instanceof Error ? reason.message : '消息加载失败，请稍后重试');
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
  }, [category, readFilter]);

  useEffect(() => {
    void loadNotifications();
    return () => requestController.current?.abort();
  }, [loadNotifications, reloadToken]);

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
      const changedAt = shouldRead ? new Date().toISOString() : null;
      setNotifications(current => (
        readFilter === 'UNREAD' && shouldRead
          ? current.filter(notification => notification.id !== item.id)
          : current.map(notification => (
            notification.id === item.id ? { ...notification, readAt: changedAt } : notification
          ))
      ));
      setUnreadCount(current => Math.max(0, current + (shouldRead ? -1 : 1)));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '消息状态更新失败');
    } finally {
      setSavingIds(current => {
        const next = new Set(current);
        next.delete(item.id);
        return next;
      });
    }
  }

  async function markAllRead(): Promise<void> {
    if (!unreadCount || markingAll) return;
    setMarkingAll(true);
    setError('');
    try {
      const response = await fetch('/api/notifications/read-all', { method: 'PATCH' });
      const result = await response.json().catch(() => ({})) as NotificationListResponse;
      if (!response.ok || result.ok !== true) {
        throw new Error(responseError(result, '全部标记已读失败'));
      }
      const changedAt = new Date().toISOString();
      setNotifications(current => (
        readFilter === 'UNREAD'
          ? []
          : current.map(notification => (
            notification.readAt ? notification : { ...notification, readAt: changedAt }
          ))
      ));
      setUnreadCount(0);
      setNextCursor(readFilter === 'UNREAD' ? null : nextCursor);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '全部标记已读失败');
    } finally {
      setMarkingAll(false);
    }
  }

  async function logout(): Promise<void> {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    window.location.href = '/login';
  }

  const listTitle = readFilter === 'UNREAD'
    ? `${selectedCategory.label} · 未读`
    : selectedCategory.label;

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
              <div className="nc-command-title"><h1>消息中心</h1><b aria-live="polite" aria-label={`当前 ${unreadCount} 条未读消息`}>{unreadCount} 未读</b></div>
              <p>集中查看分派、审批、账号与系统提醒，处理结果以对应业务页面为准。</p>
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
              <header><span>收件箱</span><small>{unreadCount ? `${unreadCount} 条待查看` : '已全部查看'}</small></header>
              <div role="tablist" aria-label="消息已读状态">
                <button type="button" role="tab" aria-selected={readFilter === 'ALL'} className={readFilter === 'ALL' ? 'active' : ''} onClick={() => setReadFilter('ALL')}>
                  <Inbox /><span><b>全部消息</b><small>保留已读记录</small></span>
                </button>
                <button type="button" role="tab" aria-selected={readFilter === 'UNREAD'} className={readFilter === 'UNREAD' ? 'active' : ''} onClick={() => setReadFilter('UNREAD')}>
                  <Bell /><span><b>仅看未读</b><small>{unreadCount} 条待查看</small></span><em>{unreadCount}</em>
                </button>
              </div>
            </section>

            <section className="nc-category-filter">
              <header><span>消息分类</span></header>
              <div>
                {CATEGORY_OPTIONS.map(option => {
                  const Icon = option.icon;
                  return (
                    <button
                      type="button"
                      className={category === option.value ? 'active' : ''}
                      aria-pressed={category === option.value}
                      onClick={() => setCategory(option.value)}
                      key={option.value}
                    >
                      <Icon /><span><b>{option.label}</b><small>{option.description}</small></span><ChevronRight />
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
                <span>{loading ? '正在同步' : `${notifications.length} 条当前记录`}</span>
                <button type="button" disabled={!unreadCount || markingAll} onClick={() => void markAllRead()}>
                  {markingAll ? <LoaderCircle className="nc-spin" /> : <CheckCheck />}{markingAll ? '处理中' : '全部已读'}
                </button>
              </div>
            </header>

            {error && <div className="nc-error" role="alert"><AlertTriangle /><span>{error}</span><button type="button" onClick={() => setReloadToken(value => value + 1)}>重新加载</button></div>}

            <div className="nc-notification-list hm-scroll-region" tabIndex={0} aria-live="polite">
              {loading && !notifications.length && Array.from({ length: 5 }, (_, index) => (
                <div className="nc-skeleton" aria-hidden="true" key={index}><i /><div><span /><b /><em /></div></div>
              ))}

              {!loading && !notifications.length && !error && (
                <div className="nc-empty-state">
                  <span><CheckCheck /></span>
                  <h3>{readFilter === 'UNREAD' ? '当前没有未读消息' : '当前没有消息'}</h3>
                  <p>{readFilter === 'UNREAD' ? '新的待办、审批与账号提醒会在这里显示。' : '业务流程产生提醒后，将自动进入个人收件箱。'}</p>
                  {(readFilter !== 'ALL' || category !== 'ALL') && <button type="button" onClick={() => { setReadFilter('ALL'); setCategory('ALL'); }}>查看全部消息</button>}
                </div>
              )}

              {notifications.map(item => {
                const Icon = CATEGORY_ICONS[item.category] || Bell;
                const targetRoute = safeInternalRoute(item.targetRoute);
                const isUnread = !item.readAt;
                const saving = savingIds.has(item.id);
                return (
                  <article className={`nc-notification-card ${isUnread ? 'is-unread' : 'is-read'} priority-${item.priority.toLowerCase()}`} key={item.id}>
                    <span className="nc-notification-icon"><Icon /></span>
                    <div className="nc-notification-content">
                      <header>
                        <div><span className="nc-category-label">{CATEGORY_LABELS[item.category]}</span>{item.priority !== 'NORMAL' && <span className={`nc-priority-label ${item.priority.toLowerCase()}`}>{item.priority === 'URGENT' ? '紧急' : '重要'}</span>}{isUnread && <i>未读</i>}</div>
                        <time dateTime={item.createdAt}><Clock3 />{notificationTime(item.createdAt)}</time>
                      </header>
                      <h3>{item.title}</h3>
                      {item.body && <p>{item.body}</p>}
                      <footer>
                        <div>
                          {item.actorName && <span><CircleUserRound />{item.actorName}</span>}
                          {item.sourceType && <span>来源：{item.sourceType}</span>}
                        </div>
                        <div>
                          <button type="button" disabled={saving} onClick={() => void toggleRead(item)}>
                            {saving ? <LoaderCircle className="nc-spin" /> : isUnread ? <Check /> : <Bell />}{saving ? '保存中' : isUnread ? '标记已读' : '恢复未读'}
                          </button>
                          {targetRoute && <Link href={targetRoute} prefetch={false}>{item.category === 'APPROVAL' || item.category === 'TODO' ? '前往处理' : '查看详情'}<ChevronRight /></Link>}
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
