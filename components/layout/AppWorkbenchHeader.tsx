'use client';

import { ChevronDown, ChevronRight, PanelLeftClose, PanelLeftOpen, Search } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { PortalMenu } from '@/components/PortalMenu';
import { PlatformNavigation } from '@/components/layout/PlatformNavigation';
import { activePlatformNavigationItem } from '@/lib/platform-navigation';
import type { BusinessMode } from '@/components/layout/ModuleModeDrawer';
import { canAccessAppRoute, landingRouteForAccess } from '@/lib/app-route-access';
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
  const [sidebarTriggerTarget, setSidebarTriggerTarget] = useState<HTMLElement | null>(null);
  const userButtonRef = useRef<HTMLButtonElement>(null);
  const sidebarButtonRef = useRef<HTMLButtonElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const displayName = user.displayName || user.username;
  const moduleName = activePlatformNavigationItem(activeHref)?.label || '工作台';
  const isHome = activePlatformNavigationItem(activeHref)?.href === '/home';
  const landingHref = landingRouteForAccess(user.access);
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
    if (controlledSidebarExpanded === undefined) setInternalSidebarExpanded(false);
  }, [activeHref, controlledSidebarExpanded]);

  useEffect(() => {
    const root = sidebarRef.current?.closest<HTMLElement>('.hm-workbench-root');
    if (!root) return undefined;
    root.classList.toggle('hm-sidebar-expanded', sidebarExpanded);
    return () => root.classList.remove('hm-sidebar-expanded');
  }, [sidebarExpanded]);

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
      // The home dashboard owns search focus and closes its active dialogs.
      if (isHome) return;
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'k') return;
      event.preventDefault();
      router.push('/home?focusSearch=1', { scroll: false });
    }
    window.addEventListener('keydown', openGlobalSearch);
    return () => window.removeEventListener('keydown', openGlobalSearch);
  }, [isHome, router]);

  function closeSidebar(restoreFocus = true): void {
    updateSidebarExpanded(false);
    if (restoreFocus) window.requestAnimationFrame(() => sidebarButtonRef.current?.focus());
  }

  const sidebarTrigger = (
    <button ref={sidebarButtonRef} className="hm-workbench-sidebar-button" type="button" aria-label={sidebarExpanded ? '收起平台导航' : '展开平台导航'} aria-controls="hm-platform-sidebar" aria-expanded={sidebarExpanded} onClick={() => updateSidebarExpanded(value => !value)}>
      {sidebarExpanded ? <PanelLeftClose size={19} aria-hidden="true" /> : <PanelLeftOpen size={19} aria-hidden="true" />}
    </button>
  );

  return (
    <>
      <button className={`hm-platform-sidebar-scrim ${sidebarExpanded ? 'open' : ''}`} type="button" aria-label="关闭平台导航" onClick={() => closeSidebar()} />
      <PlatformNavigation user={user} activeHref={activeHref} brandTitle={brandTitle} landingHref={landingHref}
        expanded={sidebarExpanded} navigationRef={sidebarRef} onExpandedChange={updateSidebarExpanded}
        onNavigate={() => closeSidebar(false)} moduleModeSwitcher={moduleModeSwitcher} />

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
