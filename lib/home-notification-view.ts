import type { NotificationBusinessCategoryDTO, SystemNotificationDTO } from '@/types';

export type HomeNotificationFilter = 'ACTIONABLE' | NotificationBusinessCategoryDTO;
export type NotificationView = 'pending' | 'completed';
export type HomeNotificationFocusRequest = {
  id: number;
  category: HomeNotificationFilter;
  label: string;
};

export type HomeNotificationViewState = {
  view: NotificationView;
  filter: HomeNotificationFilter;
  query: string;
  unreadOnly: boolean;
};

export type HomeNotificationSummary = {
  unreadCount: number;
  pendingCount: number;
  actionableCount: number;
  urgentCount: number;
  completedCount: number;
  businessCategoryCounts: Record<NotificationBusinessCategoryDTO, number>;
  completedBusinessCategoryCounts: Record<NotificationBusinessCategoryDTO, number>;
};

export const HOME_NOTIFICATION_LABELS: Record<NotificationBusinessCategoryDTO, string> = {
  PRODUCTION: '生产异常',
  QUALITY: '质量',
  PROCESS: '工艺',
  MATERIAL: '物料',
  SYSTEM: '系统',
};

const CATEGORY_ORDER = ['PRODUCTION', 'QUALITY', 'PROCESS', 'MATERIAL', 'SYSTEM'] as const;
const PRIORITY_ORDER = { URGENT: 0, HIGH: 1, NORMAL: 2 } as const;

export function homeNotificationFocusState(category: HomeNotificationFilter): HomeNotificationViewState {
  return { view: 'pending', filter: category, query: '', unreadOnly: false };
}

export function homeNotificationFilterCount(
  summary: HomeNotificationSummary,
  filter: HomeNotificationFilter,
  view: NotificationView,
): number {
  if (view === 'completed') {
    return filter === 'ACTIONABLE' ? summary.completedCount : summary.completedBusinessCategoryCounts[filter];
  }
  return filter === 'ACTIONABLE' ? summary.actionableCount : summary.businessCategoryCounts[filter];
}

export function filterHomeNotifications<T extends SystemNotificationDTO>(
  notifications: readonly T[],
  state: HomeNotificationViewState,
): T[] {
  const keyword = state.query.trim().toLowerCase();
  const filtered = notifications.filter(item => (
    (state.view === 'completed' ? Boolean(item.completedAt) : !item.completedAt)
    && (state.filter === 'ACTIONABLE'
      ? state.view === 'completed' || item.requiresAction
      : item.businessCategory === state.filter)
    && (!state.unreadOnly || !item.readAt)
    && (!keyword || [item.title, item.body, item.sourceType, item.actorName]
      .some(value => value?.toLowerCase().includes(keyword)))
  ));
  if (state.view === 'completed') return filtered;
  return filtered.sort((first, second) => (
    PRIORITY_ORDER[first.priority] - PRIORITY_ORDER[second.priority]
    || Number(Boolean(first.readAt)) - Number(Boolean(second.readAt))
    || new Date(second.createdAt).getTime() - new Date(first.createdAt).getTime()
  ));
}

export function homeNotificationEmptyState(
  summary: HomeNotificationSummary,
  state: HomeNotificationViewState,
  options: { hasMore: boolean; enabled: boolean },
): {
  title: string;
  description: string;
  categories: Array<{ category: NotificationBusinessCategoryDTO; label: string; count: number }>;
  canClearFilters: boolean;
  canViewCompleted: boolean;
} {
  const empty = { categories: [], canClearFilters: false, canViewCompleted: false };
  if (!options.enabled) {
    return { ...empty, title: '当前账号未开通消息中心', description: '可继续通过左侧业务模块查看已开放的工作内容。' };
  }
  if (state.query.trim() || state.unreadOnly) {
    return {
      ...empty,
      title: '没有符合筛选条件的消息',
      description: options.hasMore ? '当前已加载记录中没有匹配项，可清除筛选或继续加载更多。' : '试试其他关键词，或清除搜索与未读筛选。',
      canClearFilters: true,
    };
  }
  if (options.hasMore && homeNotificationFilterCount(summary, state.filter, state.view) > 0) {
    return { ...empty, title: '当前已加载记录中没有匹配消息', description: '此分类还有历史消息，可在下方继续加载。' };
  }
  if (state.view === 'completed') {
    return { ...empty, title: '当前分类暂无已完成消息', description: '消息完成后会保留在这里，方便回看处理记录。' };
  }
  if (state.filter === 'ACTIONABLE' && summary.actionableCount === 0 && summary.pendingCount > 0) {
    const categories = CATEGORY_ORDER
      .filter(category => summary.businessCategoryCounts[category] > 0)
      .map(category => ({ category, label: HOME_NOTIFICATION_LABELS[category], count: summary.businessCategoryCounts[category] }));
    return {
      ...empty,
      title: '暂时没有需要你处理的消息',
      description: `另有 ${summary.pendingCount} 条未完成消息，可按分类查看协同进展。`,
      categories,
    };
  }
  return {
    ...empty,
    title: state.filter === 'ACTIONABLE' ? '需要你处理的消息已清空' : `当前暂无${HOME_NOTIFICATION_LABELS[state.filter]}未完成消息`,
    description: '可返回业务模块继续工作，或回看已完成的协同记录。',
    canViewCompleted: summary.completedCount > 0,
  };
}
