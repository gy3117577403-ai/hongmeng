'use client';

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

const navigationItems = [
  { href: '/home', label: '首页' },
  { href: '/production', label: '生产执行' },
  { href: '/dashboard', label: '生产工单' },
  { href: '/weekly-plan-center', label: '周计划' },
  { href: '/drawing-library', label: '图纸资料库' },
  { href: '/connector-parameters', label: '连接器参数' },
  { href: '/connector-assembly-manuals', label: '组装说明书' },
  { href: '/dashboard?openSettings=1', label: '系统设置' },
];

export function AppWorkbenchHeader({ user, activeHref, subtitle, menuItems }: AppWorkbenchHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const userButtonRef = useRef<HTMLButtonElement>(null);
  const displayName = user.displayName || user.username;

  return (
    <header className="hm-workbench-header">
      <div className="hm-workbench-brand">
        <span className="hm-workbench-brand-mark" aria-hidden="true">制</span>
        <span className="hm-workbench-brand-copy"><strong>工单资料库</strong><small>{subtitle}</small></span>
      </div>
      <nav className="hm-workbench-nav" aria-label="主要导航">
        {navigationItems.map(item => <a className={item.href === activeHref ? 'active' : ''} href={item.href} key={item.href}>{item.label}</a>)}
      </nav>
      <div className="hm-workbench-user-wrap">
        <button ref={userButtonRef} className="hm-workbench-user-button" type="button" aria-label={`${displayName}，打开用户菜单`} title={displayName} aria-expanded={menuOpen} onClick={() => setMenuOpen(value => !value)}>
          <span aria-hidden="true">{displayName.slice(0, 1)}</span><b>{displayName}</b><em>⌄</em>
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
  );
}
