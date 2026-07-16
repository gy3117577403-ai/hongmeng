'use client';

import {
  BarChart3,
  BookOpen,
  Boxes,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  FileCheck2,
  FolderKanban,
  GitPullRequestArrow,
  HelpCircle,
  Home,
  LayoutDashboard,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Settings,
  ShieldCheck,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import { PortalMenu } from '@/components/PortalMenu';
import type { CurrentUserDTO } from '@/types';

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
  searchSlot?: ReactNode;
  utilityActions?: ReactNode;
};

type SideNavigationItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  planned?: boolean;
};

const sideNavigation: Array<{ label: string; items: SideNavigationItem[] }> = [
  {
    label: '业务中心',
    items: [
      { href: '/production', label: '生产执行', icon: LayoutDashboard },
      { href: '/dashboard', label: '生产工单', icon: FileCheck2 },
      { href: '/weekly-plan-center', label: '周计划', icon: CalendarDays },
      { href: '/drawing-library', label: '图纸资料库', icon: FolderKanban },
      { href: '/connector-assembly-manuals', label: '组装说明书', icon: BookOpen },
      { href: '/connector-parameters', label: '连接器参数', icon: Boxes },
    ],
  },
  {
    label: '协同规划',
    items: [
      { href: '/workspace/issues', label: '问题管理', icon: ShieldCheck },
      { href: '/workspace/changes', label: '变更管理', icon: GitPullRequestArrow, planned: true },
      { href: '/workspace/workflows', label: '流程中心', icon: Workflow, planned: true },
      { href: '/workspace/knowledge', label: '知识库', icon: BookOpen, planned: true },
      { href: '/workspace/reports', label: '报表中心', icon: BarChart3, planned: true },
    ],
  },
];

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

export function AppWorkbenchHeader({ user, activeHref, subtitle, menuItems, searchSlot, utilityActions }: AppWorkbenchHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [sidebarExpanded, setSidebarExpanded] = useState(false);
  const userButtonRef = useRef<HTMLButtonElement>(null);
  const sidebarButtonRef = useRef<HTMLButtonElement>(null);
  const displayName = user.displayName || user.username;
  const moduleName = activeModuleName(activeHref);

  useEffect(() => {
    if (!sidebarExpanded) return;
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'Escape') return;
      setSidebarExpanded(false);
      window.requestAnimationFrame(() => sidebarButtonRef.current?.focus());
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [sidebarExpanded]);

  function closeSidebar(): void {
    setSidebarExpanded(false);
    window.requestAnimationFrame(() => sidebarButtonRef.current?.focus());
  }

  return (
    <>
      <button className={`hm-platform-sidebar-scrim ${sidebarExpanded ? 'open' : ''}`} type="button" aria-label="关闭平台导航" onClick={closeSidebar} />
      <aside className={`hm-platform-sidebar ${sidebarExpanded ? 'expanded' : ''}`} id="hm-platform-sidebar" aria-label="杭连协同平台业务导航">
        <button className="hm-platform-sidebar-close" type="button" aria-label="收起平台导航" title="收起平台导航" onClick={closeSidebar}><PanelLeftClose size={18} aria-hidden="true" /></button>
        <a className="hm-platform-brand" href="/home" title="返回杭连协同平台首页">
          <span aria-hidden="true">杭</span>
          <div><strong>杭连协同平台</strong><small>生产与技术协同工作台</small></div>
        </a>
        <a className={`hm-platform-home ${isActiveRoute(activeHref, '/home') ? 'active' : ''}`} href="/home" title="首页" aria-current={isActiveRoute(activeHref, '/home') ? 'page' : undefined}>
          <Home size={18} aria-hidden="true" /><b>首页</b>
        </a>
        <nav className="hm-platform-side-nav">
          {sideNavigation.map(group => (
            <section key={group.label}>
              <h2>{group.label}</h2>
              {group.items.map(item => {
                const Icon = item.icon;
                const active = isActiveRoute(activeHref, item.href);
                return (
                  <a className={`${active ? 'active' : ''} ${item.planned ? 'planned' : ''}`.trim()} href={item.href} key={item.href} title={`${item.label}${item.planned ? '（规划中）' : ''}`} aria-current={active ? 'page' : undefined}>
                    <Icon size={18} aria-hidden="true" /><span>{item.label}</span>{item.planned && <em>规划</em>}
                  </a>
                );
              })}
            </section>
          ))}
        </nav>
        <div className="hm-platform-sidebar-footer">
          <a href="/workspace/help" title="使用帮助（规划中）" className="planned"><HelpCircle size={18} aria-hidden="true" /><span>使用帮助</span><em>规划</em></a>
          <a href="/dashboard?openSettings=1" title="系统设置"><Settings size={18} aria-hidden="true" /><span>系统设置</span></a>
        </div>
      </aside>

      <header className="hm-workbench-header">
        <button ref={sidebarButtonRef} className="hm-workbench-sidebar-button" type="button" aria-label={sidebarExpanded ? '收起平台导航' : '展开平台导航'} aria-controls="hm-platform-sidebar" aria-expanded={sidebarExpanded} onClick={() => setSidebarExpanded(value => !value)}>
          {sidebarExpanded ? <PanelLeftClose size={19} aria-hidden="true" /> : <PanelLeftOpen size={19} aria-hidden="true" />}
        </button>
        <div className="hm-workbench-context" title={`杭连协同平台 / ${moduleName} · ${subtitle}`}>
          <span>杭连协同平台</span><ChevronRight size={13} aria-hidden="true" /><strong>{moduleName}</strong><small>{subtitle}</small>
        </div>
        <div className="hm-workbench-search-slot">
          {searchSlot || (
            <a className="hm-workbench-search-link" href="/home?focusSearch=1" title="打开全局搜索">
              <Search size={16} aria-hidden="true" /><span>搜索工单、图纸、说明书</span><kbd>Ctrl K</kbd>
            </a>
          )}
        </div>
        {utilityActions && <div className="hm-workbench-utility-actions">{utilityActions}</div>}
        <div className="hm-workbench-user-wrap">
          <button ref={userButtonRef} className="hm-workbench-user-button" type="button" aria-label={`${displayName}，打开用户菜单`} title={displayName} aria-expanded={menuOpen} onClick={() => setMenuOpen(value => !value)}>
            <span aria-hidden="true">{displayName.slice(0, 1)}</span><b>{displayName}</b><ChevronDown size={14} aria-hidden="true" />
          </button>
          <PortalMenu open={menuOpen} anchorRef={userButtonRef} className="user-menu app-user-menu hm-workbench-user-menu" width={176} onClose={() => setMenuOpen(false)}>
            {menuItems.map(item => (
              <button type="button" key={item.label} onClick={() => {
                setMenuOpen(false);
                if (item.href) location.href = item.href;
                else item.onSelect?.();
              }}>{item.label}</button>
            ))}
          </PortalMenu>
        </div>
      </header>
    </>
  );
}
