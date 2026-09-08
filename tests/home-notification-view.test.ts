import assert from 'node:assert/strict';
import test from 'node:test';
import {
  filterHomeNotifications,
  homeNotificationEmptyState,
  homeNotificationFilterCount,
  homeNotificationFocusState,
  type HomeNotificationSummary,
  type HomeNotificationViewState,
} from '../lib/home-notification-view';
import type { SystemNotificationDTO } from '../types';

function notification(id: string, overrides: Partial<SystemNotificationDTO> = {}): SystemNotificationDTO {
  return {
    id, eventType: 'process_updated', category: 'SYSTEM', priority: 'NORMAL',
    title: `消息 ${id}`, body: null, targetRoute: '/workspace/messages', sourceType: 'process_route_change',
    sourceId: null, actorName: null, businessCategory: 'PROCESS', requiresAction: false,
    readAt: null, snoozedUntil: null, completedAt: null, completionKind: null,
    completionReason: null, canRestore: false, createdAt: '2026-09-08T02:00:00.000Z',
    ...overrides,
  };
}

function summary(overrides: Partial<HomeNotificationSummary> = {}): HomeNotificationSummary {
  return {
    unreadCount: 4, pendingCount: 4, actionableCount: 0, urgentCount: 0, completedCount: 184,
    businessCategoryCounts: { PRODUCTION: 0, QUALITY: 0, PROCESS: 4, MATERIAL: 0, SYSTEM: 0 },
    completedBusinessCategoryCounts: { PRODUCTION: 10, QUALITY: 20, PROCESS: 150, MATERIAL: 4, SYSTEM: 0 },
    ...overrides,
  };
}

const defaultState: HomeNotificationViewState = { view: 'pending', filter: 'ACTIONABLE', query: '', unreadOnly: false };

test('pending informational messages do not inflate the number requiring an action', () => {
  const counts = summary();
  const items = Array.from({ length: 4 }, (_, index) => notification(String(index)));
  assert.equal(homeNotificationFilterCount(counts, 'ACTIONABLE', 'pending'), 0);
  assert.equal(homeNotificationFilterCount(counts, 'PROCESS', 'pending'), 4);
  assert.equal(filterHomeNotifications(items, defaultState).length, 0);
  assert.equal(filterHomeNotifications(items, { ...defaultState, filter: 'PROCESS' }).length, 4);

  const empty = homeNotificationEmptyState(counts, defaultState, { hasMore: false, enabled: true });
  assert.deepEqual(empty.categories, [{ category: 'PROCESS', label: '工艺', count: 4 }]);
  assert.match(empty.description, /4 条未完成消息/);
  assert.equal(empty.canClearFilters, false);
});

test('module focus removes stale search, unread, and completed filters', () => {
  const previous = { view: 'completed', filter: 'QUALITY', query: '旧关键词', unreadOnly: true } as const;
  const next = homeNotificationFocusState('MATERIAL');
  assert.deepEqual(next, { view: 'pending', filter: 'MATERIAL', query: '', unreadOnly: false });
  assert.equal(previous.query, '旧关键词');
  const material = notification('material', { businessCategory: 'MATERIAL', readAt: '2026-09-08T03:00:00.000Z' });
  const completed = notification('closed', { businessCategory: 'MATERIAL', completedAt: '2026-09-08T04:00:00.000Z' });
  assert.deepEqual(filterHomeNotifications([material, completed], next).map(item => item.id), ['material']);
});

test('pending ordering follows priority then unread state then newest first without mutating the input', () => {
  const items = [
    notification('normal'),
    notification('high-read', { priority: 'HIGH', readAt: '2026-09-08T03:00:00.000Z' }),
    notification('high-old', { priority: 'HIGH' }),
    notification('high-new', { priority: 'HIGH', createdAt: '2026-09-08T03:00:00.000Z' }),
    notification('urgent', { priority: 'URGENT', readAt: '2026-09-08T03:00:00.000Z' }),
  ];
  const ids = items.map(item => item.id);
  assert.deepEqual(filterHomeNotifications(items, { ...defaultState, filter: 'PROCESS' }).map(item => item.id),
    ['urgent', 'high-new', 'high-old', 'high-read', 'normal']);
  assert.deepEqual(items.map(item => item.id), ids);
});

test('search and unread filtering combine with business category and pending state', () => {
  const items = [
    notification('match', { actorName: 'GAO', requiresAction: true }),
    notification('read', { title: 'GAO', readAt: '2026-09-08T03:00:00.000Z' }),
    notification('other-category', { body: 'GAO', businessCategory: 'QUALITY' }),
    notification('completed', { body: 'GAO', completedAt: '2026-09-08T03:00:00.000Z' }),
  ];
  const state = { ...defaultState, filter: 'PROCESS' as const, query: ' gao ', unreadOnly: true };
  assert.deepEqual(filterHomeNotifications(items, state).map(item => item.id), ['match']);
  const empty = homeNotificationEmptyState(summary(), state, { hasMore: false, enabled: true });
  assert.equal(empty.canClearFilters, true);
  assert.deepEqual(empty.categories, []);
});

test('completed counts and records include informational messages while preserving server history order', () => {
  const items = [
    notification('newer-completed', { completedAt: '2026-09-08T04:00:00.000Z' }),
    notification('older-completed', { priority: 'URGENT', completedAt: '2026-09-08T03:00:00.000Z' }),
    notification('pending', { requiresAction: true }),
  ];
  assert.deepEqual(filterHomeNotifications(items, { ...defaultState, view: 'completed' }).map(item => item.id),
    ['newer-completed', 'older-completed']);
  assert.equal(homeNotificationFilterCount(summary(), 'ACTIONABLE', 'completed'), 184);
  assert.equal(homeNotificationFilterCount(summary(), 'PROCESS', 'completed'), 150);
});

test('empty states distinguish not-yet-loaded history from no actionable work or unavailable access', () => {
  const notLoaded = homeNotificationEmptyState(summary({ actionableCount: 7 }), defaultState, { hasMore: true, enabled: true });
  assert.match(notLoaded.description, /继续加载/);
  assert.equal(notLoaded.canViewCompleted, false);
  const unavailable = homeNotificationEmptyState(summary(), defaultState, { hasMore: false, enabled: false });
  assert.match(unavailable.title, /未开通/);
  assert.deepEqual(unavailable.categories, []);
  const clear = homeNotificationEmptyState(summary({ pendingCount: 0 }), defaultState, { hasMore: false, enabled: true });
  assert.equal(clear.canViewCompleted, true);
});
