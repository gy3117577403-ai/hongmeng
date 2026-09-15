import { canAccessAppRoute } from '@/lib/app-route-access';
import { otherWorkScope } from '@/lib/other-work-time-access';
import type { CurrentUserDTO } from '@/types';

export type PlatformNavigationItem = {
  href: string;
  label: string;
  modeSwitchable?: boolean;
  openModeOnEnter?: boolean;
};

export type PlatformNavigationGroup = {
  id: string;
  label: string;
  items: PlatformNavigationItem[];
};

/** One inventory for the sidebar, compact flyouts, active route and permission filtering. */
export const PLATFORM_NAVIGATION_GROUPS: PlatformNavigationGroup[] = [
  { id: 'production', label: '生产与计划', items: [
    { href: '/production', label: '生产执行', modeSwitchable: true, openModeOnEnter: false },
    { href: '/weekly-plan-center', label: '计划中心', modeSwitchable: true, openModeOnEnter: false },
    { href: '/workspace/daily-plans', label: '日出货计划' },
    { href: '/workspace/weekly-processes', label: '周工序总览' },
  ] },
  { id: 'quality', label: '质量中心', items: [
    { href: '/workspace/quality', label: '质量管理' },
    { href: '/workspace/quality/data', label: '质量数据' },
    { href: '/workspace/quality-tasks', label: '我的质量任务' },
    { href: '/workspace/quality-confirmation', label: '品质确认' },
  ] },
  { id: 'materials', label: '物料与仓储', items: [
    { href: '/workspace/finished-goods', label: '成品仓' },
    { href: '/workspace/procurement', label: '物料跟进' },
    { href: '/workspace/warehouse', label: '仓库管理', modeSwitchable: true },
    { href: '/workspace/wip', label: '半成品仓' },
    { href: '/workspace/material-library', label: '物料库' },
  ] },
  { id: 'technology', label: '技术与资料', items: [
    { href: '/drawing-library', label: '图纸资料库' },
    { href: '/connector-assembly-manuals', label: '组装说明书' },
    { href: '/connector-parameters', label: '连接器参数' },
    { href: '/workspace/terminal-tooling', label: '端子调模' },
    { href: '/workspace/product-times', label: '产品工序与工时' },
    { href: '/workspace/knowledge', label: '知识库' },
    { href: '/workspace/capability-showcase', label: '能力展厅' },
  ] },
  { id: 'people', label: '人事与工时', items: [
    { href: '/workspace/employees', label: '人事管理' },
    { href: '/workspace/attendance', label: '考勤与异常' },
    { href: '/workspace/abnormal-times', label: '异常工时' },
    { href: '/workspace/other-hours', label: '其他工时' },
  ] },
  { id: 'collaboration', label: '协同与审批', items: [
    { href: '/workspace/issues', label: '问题管理' },
    { href: '/workspace/approvals', label: '重大审批' },
    { href: '/workspace/other-hours/approvals', label: '其他工时审批' },
    { href: '/workspace/changes', label: '变更管理' },
    { href: '/workspace/workflows', label: '流程中心' },
    { href: '/workspace/messages', label: '消息中心' },
  ] },
];

export const PLATFORM_SYSTEM_GROUP: PlatformNavigationGroup = { id: 'system', label: '系统管理', items: [
  { href: '/dashboard?openSettings=1', label: '系统设置' },
  { href: '/workspace/permissions', label: '权限与数据联通' },
] };
export const PLATFORM_DIRECT_ITEMS: PlatformNavigationItem[] = [
  { href: '/home', label: '首页' },
  { href: '/workspace/reports', label: '报表中心' },
];

type NavigationUser = Pick<CurrentUserDTO, 'access' | 'canAccessDailyPlans' | 'canAccessWeeklyProcesses'> & { laborRole?: CurrentUserDTO['laborRole'] };

export function platformNavigationForUser(user: NavigationUser): PlatformNavigationGroup[] {
  return [...PLATFORM_NAVIGATION_GROUPS, PLATFORM_SYSTEM_GROUP]
    .map(group => ({ ...group, items: group.items.filter(item => {
      if (item.href === '/workspace/daily-plans' && !user.canAccessDailyPlans) return false;
      if (item.href === '/workspace/weekly-processes' && !user.canAccessWeeklyProcesses) return false;
      if (item.href === '/workspace/other-hours/approvals' && !otherWorkScope({ access: user.access, laborRole: user.laborRole || 'EMPLOYEE' }).manage) return false;
      return canAccessAppRoute(user.access, item.href);
    }) }))
    .filter(group => group.items.length > 0);
}

function navigationUrl(href: string): URL {
  return new URL(href, 'https://navigation.invalid');
}

export function platformRouteKey(href: string): string {
  const url = navigationUrl(href);
  return url.pathname.replace(/\/+$/, '') || '/';
}

function matchesRoute(activeHref: string, targetHref: string): boolean {
  const active = navigationUrl(activeHref);
  const target = navigationUrl(targetHref);
  const path = platformRouteKey(activeHref);
  const targetPath = platformRouteKey(targetHref);
  if (path !== targetPath && !path.startsWith(`${targetPath}/`)) return false;
  return Array.from(target.searchParams).every(([key, value]) => active.searchParams.get(key) === value);
}

export function activePlatformNavigationItem(href: string): PlatformNavigationItem | undefined {
  return [...PLATFORM_DIRECT_ITEMS, ...PLATFORM_NAVIGATION_GROUPS.flatMap(group => group.items), ...PLATFORM_SYSTEM_GROUP.items]
    .filter(item => matchesRoute(href, item.href))
    .sort((left, right) => right.href.length - left.href.length)[0];
}

export function activePlatformNavigationGroup(href: string, groups: PlatformNavigationGroup[]): string | null {
  const active = activePlatformNavigationItem(href);
  return groups.find(group => group.items.some(item => item.href === active?.href))?.id || null;
}

export function platformNavigationHref(item: PlatformNavigationItem, activeHref: string, mode: 'mass' | 'sample'): string {
  if (!item.modeSwitchable) return item.href;
  if (activePlatformNavigationItem(activeHref)?.href === item.href) return activeHref;
  const query = new URLSearchParams();
  if (item.openModeOnEnter !== false) query.set('chooseMode', '1');
  if (mode === 'sample') query.set('branch', 'samples');
  return query.size ? `${item.href}?${query}` : item.href;
}

export type PlatformNavigationPreference = { version: 1; route: string; expandedGroup: string | null };

/** Invalid, stale or newly unauthorized preferences never hide the current route. */
export function restorePlatformNavigationGroup(href: string, saved: string | null, groups: PlatformNavigationGroup[]): string | null {
  const activeGroup = activePlatformNavigationGroup(href, groups);
  if (!saved) return activeGroup;
  try {
    const preference = JSON.parse(saved) as Partial<PlatformNavigationPreference>;
    if (preference.version !== 1 || preference.route !== platformRouteKey(href)) return activeGroup;
    if (preference.expandedGroup === null) return null;
    return groups.some(group => group.id === preference.expandedGroup) ? preference.expandedGroup! : activeGroup;
  } catch { return activeGroup; }
}
