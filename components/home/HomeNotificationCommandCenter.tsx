'use client';

import {
  AlertTriangle,
  BellRing,
  Box,
  Check,
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
  UserRoundCheck,
  Workflow,
} from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  NotificationBusinessCategoryDTO,
  SystemNotificationDTO,
} from '@/types';

type HomeNotificationFilter = 'ACTIONABLE' | NotificationBusinessCategoryDTO;

type NotificationInboxResponse = {
  ok?: boolean;
  notifications?: SystemNotificationDTO[];
  unreadCount?: number;
  actionableCount?: number;
  urgentCount?: number;
  businessCategoryCounts?: Partial<Record<NotificationBusinessCategoryDTO, number>>;
  error?: string;
  message?: string;
};

type NotificationSummary = {
  unreadCount: number;
  actionableCount: number;
  urgentCount: number;
  businessCategoryCounts: Record<NotificationBusinessCategoryDTO, number>;
};

const EMPTY_SUMMARY: NotificationSummary = {
  unreadCount: 0,
  actionableCount: 0,
  urgentCount: 0,
  businessCategoryCounts: {
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
  { value: 'ACTIONABLE', label: '待我处理', Icon: UserRoundCheck },
  { value: 'PRODUCTION', label: '生产异常', Icon: Factory },
  { value: 'QUALITY', label: '质量', Icon: ShieldCheck },
  { value: 'PROCESS', label: '工艺', Icon: Workflow },
  { value: 'MATERIAL', label: '物料', Icon: Box },
  { value: 'SYSTEM', label: '系统', Icon: Settings2 },
];

const BUSINESS_LABELS: Record<NotificationBusinessCategoryDTO, string> = {
  PRODUCTION: '生产异常',
  QUALITY: '质量',
  PROCESS: '工艺',
  MATERIAL: '物料',
  SYSTEM: '系统',
};

const PRIORITY_ORDER = { URGENT: 0, HIGH: 1, NORMAL: 2 } as const;

function countForFilter(summary: NotificationSummary, filter: HomeNotificationFilter): number {
  return filter === 'ACTIONABLE'
    ? summary.actionableCount
    : summary.businessCategoryCounts[filter];
}

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

function priorityLabel(item: SystemNotificationDTO): string {
  if (item.priority === 'URGENT') return '紧急';
  if (item.priority === 'HIGH') return '高优先';
  return '一般';
}

function responseError(result: NotificationInboxResponse, fallback: string): string {
  return result.error || result.message || fallback;
}

export default function HomeNotificationCommandCenter({
  enabled,
  onUnreadCountChange,
}: {
  enabled: boolean;
  onUnreadCountChange?: (count: number) => void;
}) {
  const [notifications, setNotifications] = useState<SystemNotificationDTO[]>([]);
  const [summary, setSummary] = useState<NotificationSummary>(EMPTY_SUMMARY);
  const [activeFilter, setActiveFilter] = useState<HomeNotificationFilter>('ACTIONABLE');
  const [query, setQuery] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [loading, setLoading] = useState(enabled);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [markingAll, setMarkingAll] = useState(false);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);

  const loadNotifications = useCallback(async (signal?: AbortSignal): Promise<void> => {
    if (!enabled) {
      setNotifications([]);
      setSummary(EMPTY_SUMMARY);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/notifications?limit=100&category=ALL&unreadOnly=false', {
        cache: 'no-store',
        signal,
      });
      const result = await response.json().catch(() => ({})) as NotificationInboxResponse;
      if (!response.ok || result.ok !== true || !Array.isArray(result.notifications)) {
        throw new Error(responseError(result, '消息加载失败，请稍后重试'));
      }
      const nextSummary: NotificationSummary = {
        unreadCount: Math.max(0, Number(result.unreadCount) || 0),
        actionableCount: Math.max(0, Number(result.actionableCount) || 0),
        urgentCount: Math.max(0, Number(result.urgentCount) || 0),
        businessCategoryCounts: {
          PRODUCTION: Math.max(0, Number(result.businessCategoryCounts?.PRODUCTION) || 0),
          QUALITY: Math.max(0, Number(result.businessCategoryCounts?.QUALITY) || 0),
          PROCESS: Math.max(0, Number(result.businessCategoryCounts?.PROCESS) || 0),
          MATERIAL: Math.max(0, Number(result.businessCategoryCounts?.MATERIAL) || 0),
          SYSTEM: Math.max(0, Number(result.businessCategoryCounts?.SYSTEM) || 0),
        },
      };
      setNotifications(result.notifications);
      setSummary(nextSummary);
      onUnreadCountChange?.(nextSummary.unreadCount);
    } catch (reason) {
      if ((reason as { name?: string }).name !== 'AbortError') {
        setError(reason instanceof Error ? reason.message : '消息加载失败，请稍后重试');
      }
    } finally {
      setLoading(false);
    }
  }, [enabled, onUnreadCountChange]);

  useEffect(() => {
    const controller = new AbortController();
    void loadNotifications(controller.signal);
    return () => controller.abort();
  }, [loadNotifications]);

  useEffect(() => {
    function closeMenu(event: PointerEvent): void {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuId(null);
    }
    document.addEventListener('pointerdown', closeMenu);
    return () => document.removeEventListener('pointerdown', closeMenu);
  }, []);

  const filteredNotifications = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return notifications
      .filter(item => activeFilter === 'ACTIONABLE'
        ? item.requiresAction
        : item.businessCategory === activeFilter)
      .filter(item => !unreadOnly || !item.readAt)
      .filter(item => !keyword || [item.title, item.body, item.sourceType, item.actorName]
        .filter(Boolean)
        .some(value => String(value).toLowerCase().includes(keyword)))
      .sort((first, second) => {
        const priorityDelta = PRIORITY_ORDER[first.priority] - PRIORITY_ORDER[second.priority];
        if (priorityDelta) return priorityDelta;
        if (Boolean(first.readAt) !== Boolean(second.readAt)) return first.readAt ? 1 : -1;
        return new Date(second.createdAt).getTime() - new Date(first.createdAt).getTime();
      });
  }, [activeFilter, notifications, query, unreadOnly]);

  async function updateReadState(item: SystemNotificationDTO): Promise<void> {
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
      await loadNotifications();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '消息状态更新失败');
    } finally {
      setSavingId(null);
    }
  }

  async function snooze(item: SystemNotificationDTO): Promise<void> {
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
      await loadNotifications();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '稍后提醒设置失败');
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
      await loadNotifications();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '全部已读操作失败');
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
        <div><span>待处理</span><strong>{summary.actionableCount}</strong></div>
        <div className="urgent"><span>紧急</span><strong>{summary.urgentCount}</strong></div>
      </div>

      <div className="hm-hcc-inbox-workspace">
        <nav className="hm-hcc-category-rail" aria-label="消息业务分类">
          {FILTERS.map(filter => {
            const Icon = filter.Icon;
            const count = countForFilter(summary, filter.value);
            return (
              <button
                type="button"
                className={activeFilter === filter.value ? 'active' : ''}
                aria-pressed={activeFilter === filter.value}
                onClick={() => setActiveFilter(filter.value)}
                key={filter.value}
              >
                <Icon aria-hidden="true" /><span>{filter.label}</span><b>{count}</b>
              </button>
            );
          })}
        </nav>

        <div className="hm-hcc-message-pane">
          <div className="hm-hcc-message-toolbar">
            <label><Search aria-hidden="true" /><input aria-label="搜索消息" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索消息" /></label>
            <button type="button" className={unreadOnly ? 'active' : ''} aria-pressed={unreadOnly} onClick={() => setUnreadOnly(value => !value)}><Filter aria-hidden="true" />仅看未读</button>
            <button type="button" disabled={markingAll || !summary.unreadCount} onClick={() => void markAllRead()}>{markingAll ? <LoaderCircle className="hm-hcc-spin" /> : <CheckCheck />}<span>全部已读</span></button>
          </div>

          {error && <div className="hm-hcc-message-error" role="alert"><AlertTriangle /><span>{error}</span><button type="button" onClick={() => void loadNotifications()}>重试</button></div>}

          <div className="hm-hcc-message-list hm-scroll-region" aria-busy={loading} aria-live="polite">
            {loading && !notifications.length && Array.from({ length: 5 }, (_, index) => <div className="hm-hcc-message-skeleton" aria-hidden="true" key={index}><i /><span /><b /></div>)}
            {!loading && !filteredNotifications.length && !error && (
              <div className="hm-hcc-message-empty"><CheckCheck /><strong>当前分类没有待处理消息</strong><span>新的协同提醒会自动进入这里。</span></div>
            )}
            {filteredNotifications.map(item => {
              const targetRoute = safeInternalRoute(item.targetRoute);
              const isUnread = !item.readAt;
              const isSaving = savingId === item.id;
              return (
                <article className={`hm-hcc-message-row priority-${item.priority.toLowerCase()} ${isUnread ? 'unread' : 'read'}`} key={item.id}>
                  <i className="hm-hcc-unread-dot" aria-hidden="true" />
                  <div className="hm-hcc-message-copy">
                    <div><span className={`hm-hcc-priority ${item.priority.toLowerCase()}`}>{priorityLabel(item)}</span><small>{BUSINESS_LABELS[item.businessCategory]}</small><time dateTime={item.createdAt}><Clock3 />{elapsedTime(item.createdAt)}</time></div>
                    <h3>{item.title}</h3>
                    <p>{item.body || `来源：${item.sourceType || '系统协同'}`}</p>
                  </div>
                  <div className="hm-hcc-message-actions">
                    {targetRoute && <Link href={targetRoute} prefetch={false}>去处理</Link>}
                    <div className="hm-hcc-message-more" ref={menuId === item.id ? menuRef : undefined}>
                      <button type="button" aria-label={`更多操作：${item.title}`} aria-expanded={menuId === item.id} disabled={isSaving} onClick={() => setMenuId(current => current === item.id ? null : item.id)}>{isSaving ? <LoaderCircle className="hm-hcc-spin" /> : <MoreHorizontal />}</button>
                      {menuId === item.id && <div role="menu"><button type="button" role="menuitem" onClick={() => void snooze(item)}><BellRing />1小时后提醒</button><button type="button" role="menuitem" onClick={() => void updateReadState(item)}>{isUnread ? <Check /> : <CircleUserRound />}{isUnread ? '标为已读' : '恢复未读'}</button></div>}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
