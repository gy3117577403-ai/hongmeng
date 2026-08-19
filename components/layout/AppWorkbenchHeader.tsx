'use client';

import {
  BarChart3,
  Bell,
  BookOpen,
  Boxes,
  CalendarClock,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  Clock3,
  ClipboardCheck,
  FolderKanban,
  GitPullRequestArrow,
  HelpCircle,
  Home,
  LayoutDashboard,
  ListTree,
  PanelLeftClose,
  PanelLeftOpen,
  PackageSearch,
  Search,
  Settings,
  Settings2,
  PanelsTopLeft,
  ShieldCheck,
  TimerOff,
  UsersRound,
  Workflow,
  Warehouse,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { PortalMenu } from '@/components/PortalMenu';
import type { BusinessMode } from '@/components/layout/ModuleModeDrawer';
import { canAccessAppRoute, landingRouteForAccess } from '@/lib/app-route-access';
import type { CurrentUserDTO } from '@/types';

const SIDEBAR_PREFERENCE_KEY = 'hm-platform-sidebar-expanded';

type HeaderMenuItem = {
  label: string;
  href?: string;
  onSelect?: () => void;
};

type AppWorkbenchHeaderProps = {
  user: CurrentUserDTO;
  activeHref: string;
  subtitle: string;
  menuItems: HeaderMenuItem[];
  brandTitle?: string;
  searchSlot?: ReactNode;
  utilityActions?: ReactNode;
  hideHeader?: boolean;
  sidebarTriggerTargetId?: string;
  sidebarExpanded?: boolean;
  onSidebarExpandedChange?: (expanded: boolean) => void;
  moduleModeSwitcher?: {
    mode: BusinessMode;
    drawerId: string;
    drawerOpen: boolean;
    onToggle: () => void;
    openFromSidebar?: boolean;
  };
};

type SideNavigationItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  planned?: boolean;
  modeSwitchable?: boolean;
  openModeOnEnter?: boolean;
};

const sideNavigation: Array<{ label: string; items: SideNavigationItem[] }> = [
  {
    label: '业务中心',
    items: [
      { href: '/production', label: '生产执行', icon: LayoutDashboard, modeSwitchable: true, openModeOnEnter: false },
      { href: '/weekly-plan-center', label: '计划中心', icon: CalendarDays, modeSwitchable: true },
      { href: '/workspace/daily-plans', label: '日出货计划', icon: CalendarClock },
      { href: '/workspace/weekly-processes', label: '周工序总览', icon: ListTree },
      { href: '/drawing-library', label: '图纸资料库', icon: FolderKanban },
      { href: '/connector-assembly-manuals', label: '组装说明书', icon: BookOpen },
      { href: '/connector-parameters', label: '连接器参数', icon: Boxes },
      { href: '/workspace/terminal-tooling', label: '端子调模', icon: Settings2 },
      { href: '/workspace/capability-showcase', label: '能力展厅', icon: PanelsTopLeft },
    ],
  },
  {
    label: '协同规划',
    items: [
      { href: '/workspace/issues', label: '问题管理', icon: ShieldCheck },
      { href: '/workspace/approvals', label: '重大审批', icon: ClipboardCheck },
      { href: '/workspace/changes', label: '变更管理', icon: GitPullRequestArrow },
      { href: '/workspace/workflows', label: '流程中心', icon: Workflow },
      { href: '/workspace/warehouse', label: '仓库管理', icon: Warehouse, modeSwitchable: true },
      { href: '/workspace/procurement', label: '物料跟进', icon: PackageSearch },
      { href: '/workspace/product-times', label: '产品工序与工时', icon: Clock3 },
      { href: '/workspace/employees', label: '人事管理', icon: UsersRound },
      { href: '/workspace/attendance', label: '考勤与异常', icon: CalendarClock },
      { href: '/workspace/abnormal-times', label: '异常工时', icon: TimerOff },
      { href: '/workspace/knowledge', label: '知识库', icon: BookOpen },
      { href: '/workspace/reports', label: '报表中心', icon: BarChart3 },
      { href: '/workspace/permissions', label: '权限与数据联通', icon: ShieldCheck },
      { href: '/workspace/messages', label: '消息中心', icon: Bell },
    ],
  },
];

function navigationForUser(
  user: CurrentUserDTO,
): Array<{ label: string; items: SideNavigationItem[] }> {
  return sideNavigation
    .map(group => ({
      ...group,
      items: group.items.filter(item => {
        if (item.href === '/workspace/daily-plans' && !user.canAccessDailyPlans) return false;
        if (item.href === '/workspace/weekly-processes' && !user.canAccessWeeklyProcesses) return false;
        return canAccessAppRoute(user.access, item.href);
      }),
    }))
    .filter(group => group.items.length > 0);
}

function routePath(href: string): string {
  return href.split('?')[0] || '/';
}

function isActiveRoute(activeHref: string, href: string): boolean {
  return routePath(activeHref) === routePath(href);
}

function activeModuleName(activeHref: string): string {
  if (isActiveRoute(activeHref, '/home')) return '首页';
  for (const group of sideNavigation) {
    const item = group.items.find(entry => isActiveRoute(activeHref, entry.href));
    if (item) return item.label;
  }
  return '工作台';
}

function modeSwitchHref(href: string, mode: BusinessMode, openModeOnEnter = true): string {
  const params = new URLSearchParams();
  if (openModeOnEnter) params.set('chooseMode', '1');
  if (mode === 'sample') params.set('branch', 'samples');
  const query = params.toString();
  return query ? `${href}?${query}` : href;
}

export function AppWorkbenchHeader({
  user,
  activeHref,
  subtitle,
  menuItems,
  brandTitle = '杭连电子协同平台',
  searchSlot,
  utilityActions,
  hideHeader = false,
  sidebarTriggerTargetId,
  sidebarExpanded: controlledSidebarExpanded,
  onSidebarExpandedChange,
  moduleModeSwitcher,
}: AppWorkbenchHeaderProps) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [internalSidebarExpanded, setInternalSidebarExpanded] = useState(false);
  const [sidebarPreferenceLoaded, setSidebarPreferenceLoaded] = useState(false);
  const [sidebarTriggerTarget, setSidebarTriggerTarget] = useState<HTMLElement | null>(null);
  const userButtonRef = useRef<HTMLButtonElement>(null);
  const sidebarButtonRef = useRef<HTMLButtonElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const displayName = user.displayName || user.username;
  const moduleName = activeModuleName(activeHref);
  const isHome = isActiveRoute(activeHref, '/home');
  const visibleNavigation = navigationForUser(user);
  const landingHref = landingRouteForAccess(user.access);
  const canOpenHome = canAccessAppRoute(user.access, '/home');
  const canOpenSystemSettings = canAccessAppRoute(user.access, '/dashboard?openSettings=1');
  const sidebarExpanded = controlledSidebarExpanded ?? internalSidebarExpanded;
  const visibleMenuItems = canOpenSystemSettings
    ? menuItems
    : menuItems.filter(item => !item.href?.startsWith('/dashboard?openSettings=1'));

  const updateSidebarExpanded = useCallback((next: boolean | ((current: boolean) => boolean)): void => {
    const nextValue = typeof next === 'function' ? next(sidebarExpanded) : next;
    if (controlledSidebarExpanded === undefined) setInternalSidebarExpanded(nextValue);
    onSidebarExpandedChange?.(nextValue);
  }, [controlledSidebarExpanded, onSidebarExpandedChange, sidebarExpanded]);

  useEffect(() => {
    if (!sidebarTriggerTargetId) {
      setSidebarTriggerTarget(null);
      return;
    }
    setSidebarTriggerTarget(document.getElementById(sidebarTriggerTargetId));
  }, [sidebarTriggerTargetId]);

  useEffect(() => {
    if (controlledSidebarExpanded !== undefined) {
      setSidebarPreferenceLoaded(true);
      return;
    }
    try {
      setInternalSidebarExpanded(window.localStorage.getItem(SIDEBAR_PREFERENCE_KEY) === 'true');
    } catch {
      setInternalSidebarExpanded(false);
    } finally {
      setSidebarPreferenceLoaded(true);
    }
  }, [controlledSidebarExpanded]);

  useEffect(() => {
    const root = sidebarRef.current?.closest<HTMLElement>('.hm-workbench-root');
    if (!root) return undefined;
    root.classList.toggle('hm-sidebar-expanded', sidebarExpanded);
    return () => root.classList.remove('hm-sidebar-expanded');
  }, [sidebarExpanded]);

  useEffect(() => {
    if (!sidebarPreferenceLoaded || controlledSidebarExpanded !== undefined) return;
    try {
      window.localStorage.setItem(SIDEBAR_PREFERENCE_KEY, String(sidebarExpanded));
    } catch {
      // Storage can be unavailable in hardened browser profiles; the in-page toggle still works.
    }
  }, [controlledSidebarExpanded, sidebarExpanded, sidebarPreferenceLoaded]);

  useEffect(() => {
    if (!sidebarExpanded) return;
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'Escape') return;
      updateSidebarExpanded(false);
      window.requestAnimationFrame(() => sidebarButtonRef.current?.focus());
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [sidebarExpanded, updateSidebarExpanded]);

  useEffect(() => {
    function openGlobalSearch(event: KeyboardEvent): void {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'k') return;
      event.preventDefault();
      router.push('/home?focusSearch=1', { scroll: false });
    }
    window.addEventListener('keydown', openGlobalSearch);
    return () => window.removeEventListener('keydown', openGlobalSearch);
  }, [router]);

  function closeSidebar(): void {
    updateSidebarExpanded(false);
    window.requestAnimationFrame(() => sidebarButtonRef.current?.focus());
  }

  const sidebarTrigger = (
    <button ref={sidebarButtonRef} className="hm-workbench-sidebar-button" type="button" aria-label={sidebarExpanded ? '收起平台导航' : '展开平台导航'} aria-controls="hm-platform-sidebar" aria-expanded={sidebarExpanded} onClick={() => updateSidebarExpanded(value => !value)}>
      {sidebarExpanded ? <PanelLeftClose size={19} aria-hidden="true" /> : <PanelLeftOpen size={19} aria-hidden="true" />}
    </button>
  );

  return (
    <>
      <button className={`hm-platform-sidebar-scrim ${sidebarExpanded ? 'open' : ''}`} type="button" aria-label="关闭平台导航" onClick={closeSidebar} />
      <aside ref={sidebarRef} className={`hm-platform-sidebar ${sidebarExpanded ? 'expanded' : ''}`} id="hm-platform-sidebar" aria-label={`${brandTitle}业务导航`}>
        <button className="hm-platform-sidebar-close" type="button" aria-label="收起平台导航" title="收起平台导航" onClick={closeSidebar}><PanelLeftClose size={18} aria-hidden="true" /></button>
        <Link className="hm-platform-brand" href={landingHref} prefetch={false} title={`返回${brandTitle}`}>
          <span aria-hidden="true">杭</span>
          <div><strong>{brandTitle}</strong><small>生产与技术协同工作台</small></div>
        </Link>
        {canOpenHome && <Link className={`hm-platform-home ${isActiveRoute(activeHref, '/home') ? 'active' : ''}`} href="/home" prefetch={false} title="首页" aria-current={isActiveRoute(activeHref, '/home') ? 'page' : undefined}>
          <Home size={18} aria-hidden="true" /><b>首页</b>
        </Link>}
        <nav className="hm-platform-side-nav">
          {visibleNavigation.map(group => (
            <section key={group.label}>
              <h2>{group.label}</h2>
              {group.items.map(item => {
                const Icon = item.icon;
                const active = isActiveRoute(activeHref, item.href);
                const activeModeSwitch = Boolean(active && item.modeSwitchable && moduleModeSwitcher);
                const canOpenModeFromSidebar = Boolean(activeModeSwitch
                  && item.openModeOnEnter !== false
                  && moduleModeSwitcher?.openFromSidebar !== false);
                const href = item.modeSwitchable
                  ? activeModeSwitch
                    ? activeHref
                    : modeSwitchHref(item.href, moduleModeSwitcher?.mode || 'mass', item.openModeOnEnter !== false)
                  : item.href;
                return (
                  <Link
                    className={`${active ? 'active' : ''} ${item.planned ? 'planned' : ''} ${canOpenModeFromSidebar ? 'mode-switch' : ''}`.trim()}
                    href={href}
                    prefetch={false}
                    key={item.href}
                    title={`${item.label}${activeModeSwitch ? `（当前${moduleModeSwitcher?.mode === 'sample' ? '样品' : '量产'}）` : item.planned ? '（规划中）' : ''}`}
                    aria-current={active ? 'page' : undefined}
                    aria-controls={canOpenModeFromSidebar ? moduleModeSwitcher?.drawerId : undefined}
                    aria-expanded={canOpenModeFromSidebar ? moduleModeSwitcher?.drawerOpen : undefined}
                    onClick={activeModeSwitch ? event => {
                      event.preventDefault();
                      closeSidebar();
                      if (canOpenModeFromSidebar) moduleModeSwitcher?.onToggle();
                    } : undefined}
                  >
                    <Icon size={18} aria-hidden="true" />
                    <span>{item.label}</span>
                    {item.planned && <em>规划</em>}
                    {activeModeSwitch && <><em className="mode-label">{moduleModeSwitcher?.mode === 'sample' ? '样品' : '量产'}</em>{canOpenModeFromSidebar && <ChevronDown className={moduleModeSwitcher?.drawerOpen ? 'mode-chevron open' : 'mode-chevron'} size={13} aria-hidden="true" />}</>}
                  </Link>
                );
              })}
            </section>
          ))}
        </nav>
        <div className="hm-platform-sidebar-footer">
          <Link href="/workspace/help" prefetch={false} title="使用帮助（规划中）" className="planned"><HelpCircle size={18} aria-hidden="true" /><span>使用帮助</span><em>规划</em></Link>
          {canOpenSystemSettings && <Link href="/dashboard?openSettings=1" prefetch={false} title="系统设置"><Settings size={18} aria-hidden="true" /><span>系统设置</span></Link>}
        </div>
      </aside>

      {sidebarTriggerTarget && createPortal(sidebarTrigger, sidebarTriggerTarget)}

      {!hideHeader && <header className={`hm-workbench-header ${isHome ? 'is-home' : 'is-module'}`}>
        {!sidebarTriggerTargetId && sidebarTrigger}
        <div className="hm-workbench-context" title={`${brandTitle} / ${moduleName} · ${subtitle}`}>
          <span>{brandTitle}</span><ChevronRight size={13} aria-hidden="true" /><strong>{moduleName}</strong><small>{subtitle}</small>
        </div>
        {isHome && <div className="hm-workbench-search-slot">
          {searchSlot || (
            <Link className="hm-workbench-search-link" href="/home?focusSearch=1" prefetch={false} title="打开全局搜索">
              <Search size={16} aria-hidden="true" /><span>搜索工单、图纸、说明书</span><kbd>Ctrl K</kbd>
            </Link>
          )}
        </div>}
        {utilityActions && <div className="hm-workbench-utility-actions">{utilityActions}</div>}
        {isHome && <div className="hm-workbench-user-wrap">
          <button ref={userButtonRef} className="hm-workbench-user-button" type="button" aria-label={`${displayName}，打开用户菜单`} title={displayName} aria-expanded={menuOpen} onClick={() => setMenuOpen(value => !value)}>
            <span aria-hidden="true">{displayName.slice(0, 1)}</span><b>{displayName}</b><ChevronDown size={14} aria-hidden="true" />
          </button>
          <PortalMenu open={menuOpen} anchorRef={userButtonRef} className="user-menu app-user-menu hm-workbench-user-menu" width={176} onClose={() => setMenuOpen(false)}>
            {visibleMenuItems.map(item => (
              <button type="button" key={item.label} onClick={() => {
                setMenuOpen(false);
                if (item.href) router.push(item.href);
                else item.onSelect?.();
              }}>{item.label}</button>
            ))}
          </PortalMenu>
        </div>}
      </header>}
    </>
  );
}
