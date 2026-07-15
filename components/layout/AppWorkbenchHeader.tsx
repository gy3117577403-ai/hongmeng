'use client';

import {
  BookOpen,
  Boxes,
  CalendarDays,
  ChevronDown,
  FileCheck2,
  FolderKanban,
  HelpCircle,
  Home,
  LayoutDashboard,
  Search,
  Settings,
  ShieldCheck,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import { useRef, useState } from 'react';
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
};

type SideNavigationItem = {
  href: string;
  label: string;
  icon: LucideIcon;
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
    label: '协同中心',
    items: [
      { href: '/workspace/issues', label: '问题管理', icon: ShieldCheck },
      { href: '/workspace/workflows', label: '流程中心', icon: Workflow },
      { href: '/workspace/knowledge', label: '知识库', icon: BookOpen },
    ],
  },
];

const topNavigation = [
  { href: '/home', label: '首页' },
  { href: '/weekly-plan-center', label: '计划' },
  { href: '/workspace/reviews', label: '评审' },
  { href: '/workspace/issues', label: '问题' },
  { href: '/workspace/knowledge', label: '知识' },
  { href: '/workspace/reports', label: '报表' },
];

function routePath(href: string): string {
  return href.split('?')[0] || '/';
}

function isActiveRoute(activeHref: string, href: string): boolean {
  return routePath(activeHref) === routePath(href);
}

function activeModuleName(activeHref: string): string {
  for (const group of sideNavigation) {
    const item = group.items.find(entry => isActiveRoute(activeHref, entry.href));
    if (item) return item.label;
  }
  return topNavigation.find(entry => isActiveRoute(activeHref, entry.href))?.label || '工作台';
}

export function AppWorkbenchHeader({ user, activeHref, subtitle, menuItems }: AppWorkbenchHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const userButtonRef = useRef<HTMLButtonElement>(null);
  const displayName = user.displayName || user.username;
  const moduleName = activeModuleName(activeHref);

  return (
    <>
      <aside className="hm-platform-sidebar" aria-label="杭连协同平台业务导航">
        <a className="hm-platform-brand" href="/home" title="返回杭连协同平台首页">
          <span aria-hidden="true">杭</span>
          <div><strong>杭连协同平台</strong><small>生产与技术协同工作台</small></div>
        </a>
        <a className={`hm-platform-home ${isActiveRoute(activeHref, '/home') ? 'active' : ''}`} href="/home" title="首页">
          <Home size={18} aria-hidden="true" /><b>首页</b>
        </a>
        <nav className="hm-platform-side-nav">
          {sideNavigation.map(group => (
            <section key={group.label}>
              <h2>{group.label}</h2>
              {group.items.map(item => {
                const Icon = item.icon;
                return (
                  <a className={isActiveRoute(activeHref, item.href) ? 'active' : ''} href={item.href} key={item.href} title={item.label} aria-current={isActiveRoute(activeHref, item.href) ? 'page' : undefined}>
                    <Icon size={17} aria-hidden="true" /><span>{item.label}</span>
                  </a>
                );
              })}
            </section>
          ))}
        </nav>
        <div className="hm-platform-sidebar-footer">
          <a href="/workspace/help" title="使用帮助"><HelpCircle size={17} aria-hidden="true" /><span>使用帮助</span></a>
          <a href="/dashboard?openSettings=1" title="系统设置"><Settings size={17} aria-hidden="true" /><span>系统设置</span></a>
        </div>
      </aside>

      <header className="hm-workbench-header">
        <div className="hm-workbench-context" title={`${moduleName} · ${subtitle}`}>
          <strong>{moduleName}</strong><span>{subtitle}</span>
        </div>
        <nav className="hm-workbench-nav" aria-label="平台导航">
          {topNavigation.map(item => <a className={isActiveRoute(activeHref, item.href) ? 'active' : ''} href={item.href} key={item.href}>{item.label}</a>)}
        </nav>
        <a className="hm-workbench-search-link" href="/home?focusSearch=1" title="打开全局搜索">
          <Search size={16} aria-hidden="true" /><span>搜索工单、图纸、说明书</span><kbd>Ctrl K</kbd>
        </a>
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
