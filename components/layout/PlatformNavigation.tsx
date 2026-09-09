'use client';

import { BarChart3, Boxes, Check, ChevronRight, Factory, FolderKanban, HelpCircle, Home, PanelLeftClose, PanelLeftOpen, Settings, ShieldCheck, UsersRound, Workflow, X, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { canAccessAppRoute } from '@/lib/app-route-access';
import { activePlatformNavigationGroup, activePlatformNavigationItem, platformNavigationForUser, platformNavigationHref, platformRouteKey, restorePlatformNavigationGroup, type PlatformNavigationGroup, type PlatformNavigationItem, type PlatformNavigationPreference } from '@/lib/platform-navigation';
import type { CurrentUserDTO } from '@/types';
import type { BusinessMode } from './ModuleModeDrawer';

const groupIcons: Record<string, LucideIcon> = { production: Factory, quality: ShieldCheck, materials: Boxes, technology: FolderKanban, people: UsersRound, collaboration: Workflow, system: Settings };

type Props = {
  user: CurrentUserDTO;
  activeHref: string;
  brandTitle: string;
  landingHref: string;
  expanded: boolean;
  navigationRef: RefObject<HTMLElement>;
  onExpandedChange: (expanded: boolean) => void;
  onNavigate: (event: MouseEvent<HTMLAnchorElement>) => void;
  moduleModeSwitcher?: { mode: BusinessMode; drawerId: string; drawerOpen: boolean; onToggle: () => void; openFromSidebar?: boolean };
};

export function PlatformNavigation({ user, activeHref, brandTitle, landingHref, expanded, navigationRef, onExpandedChange, onNavigate, moduleModeSwitcher }: Props) {
  const groups = useMemo(() => platformNavigationForUser(user), [user]);
  const activeItem = activePlatformNavigationItem(activeHref);
  const activeGroup = activePlatformNavigationGroup(activeHref, groups);
  const [expandedGroup, setExpandedGroup] = useState<string | null>(activeGroup);
  const [flyoutId, setFlyoutId] = useState<string | null>(null);
  const [position, setPosition] = useState({ left: 80, top: 88, width: 264 });
  const groupButtons = useRef(new Map<string, HTMLButtonElement>());
  const flyoutRef = useRef<HTMLDivElement>(null);
  const collapseRef = useRef<HTMLButtonElement>(null);
  const scrollRef = useRef<HTMLElement>(null);
  const preferenceKey = `hm-platform-navigation:v1:${user.id}`;
  const flyout = groups.find(group => group.id === flyoutId);
  const systemGroup = groups.find(group => group.id === 'system');
  const businessGroups = groups.filter(group => group.id !== 'system');

  useEffect(() => {
    let saved: string | null = null;
    try { saved = window.localStorage.getItem(preferenceKey); } catch { /* Navigation also works when storage is unavailable. */ }
    setExpandedGroup(restorePlatformNavigationGroup(activeHref, saved, groups));
    setFlyoutId(null);
  }, [activeHref, groups, preferenceKey]);

  const rememberGroup = useCallback((group: string | null): void => {
    setExpandedGroup(group);
    const preference: PlatformNavigationPreference = { version: 1, route: platformRouteKey(activeHref), expandedGroup: group };
    try { window.localStorage.setItem(preferenceKey, JSON.stringify(preference)); } catch { /* Session interaction remains available. */ }
  }, [activeHref, preferenceKey]);

  const closeFlyout = useCallback((restoreFocus = false): void => {
    const trigger = flyoutId ? groupButtons.current.get(flyoutId) : null;
    setFlyoutId(null);
    if (restoreFocus) window.requestAnimationFrame(() => trigger?.focus());
  }, [flyoutId]);

  useEffect(() => { setFlyoutId(null); }, [expanded, moduleModeSwitcher?.drawerOpen]);

  useEffect(() => {
    if (!expanded) return;
    const scroll = scrollRef.current;
    const active = scroll?.querySelector<HTMLElement>('[aria-current="page"]') || (activeGroup ? groupButtons.current.get(activeGroup) : null);
    if (scroll && active && scroll.contains(active)) {
      const bounds = scroll.getBoundingClientRect();
      const item = active.getBoundingClientRect();
      if (item.bottom > bounds.bottom) scroll.scrollTop += item.bottom - bounds.bottom + 12;
      if (item.top < bounds.top) scroll.scrollTop -= bounds.top - item.top + 12;
    }
  }, [activeGroup, expanded, expandedGroup]);

  useLayoutEffect(() => {
    if (!flyoutId || expanded) return;
    const updatePosition = (): void => {
      const trigger = groupButtons.current.get(flyoutId);
      const panel = flyoutRef.current;
      if (!trigger || !panel) return;
      const rect = trigger.getBoundingClientRect();
      const width = Math.min(264, Math.max(200, window.innerWidth - rect.right - 20));
      const left = Math.max(12, Math.min(rect.right + 8, window.innerWidth - width - 12));
      const top = Math.max(12, Math.min(rect.top, window.innerHeight - panel.offsetHeight - 12));
      setPosition(previous => previous.left === left && previous.top === top && previous.width === width ? previous : { left, top, width });
    };
    updatePosition();
    const observer = new ResizeObserver(updatePosition);
    if (flyoutRef.current) observer.observe(flyoutRef.current);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    const frame = window.requestAnimationFrame(() => flyoutRef.current?.querySelector<HTMLAnchorElement>('a[aria-current="page"], a')?.focus());
    return () => { observer.disconnect(); window.cancelAnimationFrame(frame); window.removeEventListener('resize', updatePosition); window.removeEventListener('scroll', updatePosition, true); };
  }, [expanded, flyoutId]);

  useEffect(() => {
    if (!flyoutId) return;
    const inside = (target: EventTarget | null): boolean => target instanceof Node && Boolean(flyoutRef.current?.contains(target) || groupButtons.current.get(flyoutId)?.contains(target));
    const onPointerDown = (event: PointerEvent): void => { if (!inside(event.target)) closeFlyout(); };
    const onFocus = (event: FocusEvent): void => { if (!inside(event.target)) closeFlyout(); };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeFlyout(true); }
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('focusin', onFocus);
    document.addEventListener('keydown', onKeyDown, true);
    return () => { document.removeEventListener('pointerdown', onPointerDown, true); document.removeEventListener('focusin', onFocus); document.removeEventListener('keydown', onKeyDown, true); };
  }, [closeFlyout, flyoutId]);

  useEffect(() => {
    if (!expanded) return;
    // On narrower workbenches the expanded sidebar is an overlay. Keep keyboard focus inside it.
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Tab' || !window.matchMedia('(max-width: 1199px)').matches) return;
      const controls = Array.from(navigationRef.current?.querySelectorAll<HTMLElement>('a[href],button:not(:disabled)') || []).filter(element => element.getClientRects().length > 0);
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && (document.activeElement === first || !navigationRef.current?.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !navigationRef.current?.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    if (window.matchMedia('(max-width: 1199px)').matches) collapseRef.current?.focus();
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [expanded, navigationRef]);

  function renderItem(item: PlatformNavigationItem) {
    const active = activeItem?.href === item.href;
    return <Link className={`hm-nav-item${active ? ' is-current' : ''}`} key={item.href}
      href={platformNavigationHref(item, activeHref, moduleModeSwitcher?.mode || 'mass')} prefetch={false}
      aria-current={active ? 'page' : undefined}
      onClick={event => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        closeFlyout();
        onNavigate(event);
      }}><span>{item.label}</span>{active && <Check size={16} aria-hidden="true" />}</Link>;
  }

  function renderGroup(group: PlatformNavigationGroup) {
    const Icon = groupIcons[group.id];
    const open = expanded ? expandedGroup === group.id : flyoutId === group.id;
    const selected = activeGroup === group.id;
    return <section className="hm-nav-group" key={group.id}>
      <button type="button" ref={element => { if (element) groupButtons.current.set(group.id, element); else groupButtons.current.delete(group.id); }}
        className={`hm-nav-row hm-nav-group-button${selected ? ' is-current-group' : ''}${open ? ' is-open' : ''}`}
        aria-label={group.label} aria-expanded={open} aria-controls={open ? expanded ? `hm-nav-group-${group.id}` : 'hm-nav-flyout' : undefined}
        aria-haspopup={!expanded ? 'dialog' : undefined} data-hm-nav-group={group.id}
        onClick={() => { if (expanded) rememberGroup(open ? null : group.id); else setFlyoutId(open ? null : group.id); }}>
        <Icon size={20} aria-hidden="true" /><span className="hm-nav-label">{group.label}</span>
        {selected && <span className="hm-nav-current-dot" aria-hidden="true" />}
        <ChevronRight className="hm-nav-chevron" size={16} aria-hidden="true" />
        {!expanded && !open && <span className="hm-nav-tooltip" aria-hidden="true">{group.label}</span>}
      </button>
      {expanded && open && <div className="hm-nav-children" id={`hm-nav-group-${group.id}`}><div>{group.items.map(renderItem)}</div></div>}
    </section>;
  }

  function directLink(href: string, label: string, Icon: LucideIcon) {
    if (!canAccessAppRoute(user.access, href)) return null;
    return <Link className={`hm-nav-row hm-nav-direct${activeItem?.href === href ? ' is-current' : ''}`} href={href} prefetch={false}
      aria-label={label} aria-current={activeItem?.href === href ? 'page' : undefined}
      onClick={event => { if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) onNavigate(event); }}>
      <Icon size={20} aria-hidden="true" /><span className="hm-nav-label">{label}</span>{!expanded && <span className="hm-nav-tooltip" aria-hidden="true">{label}</span>}
    </Link>;
  }

  return <>
    <aside ref={navigationRef} className={`hm-global-navigation${expanded ? ' is-expanded' : ''}`} id="hm-platform-sidebar" aria-label={`${brandTitle}业务导航`}>
      <header className="hm-nav-brand">
        <Link href={landingHref} prefetch={false} className="hm-nav-brand-link" aria-label={`返回${brandTitle}`} onClick={onNavigate}>
          <span className="hm-nav-logo" aria-hidden="true">杭</span><span className="hm-nav-brand-copy"><strong>{brandTitle}</strong><small>生产与技术协同工作台</small></span>
        </Link>
        <button ref={collapseRef} className="hm-nav-toggle" type="button" aria-label={expanded ? '收起平台导航' : '展开平台导航'} aria-expanded={expanded} aria-controls="hm-platform-sidebar" onClick={() => onExpandedChange(!expanded)}>
          {expanded ? <PanelLeftClose size={19} aria-hidden="true" /> : <PanelLeftOpen size={19} aria-hidden="true" />}
        </button>
      </header>
      <nav ref={scrollRef} className="hm-nav-scroll" aria-label="业务菜单">
        {directLink('/home', '首页', Home)}
        {businessGroups.map(renderGroup)}
        {directLink('/workspace/reports', '报表中心', BarChart3)}
      </nav>
      {(systemGroup || canAccessAppRoute(user.access, '/workspace/help')) && <footer className="hm-nav-footer">
        {systemGroup && renderGroup(systemGroup)}
        {canAccessAppRoute(user.access, '/workspace/help') && <button type="button" className="hm-nav-row hm-nav-help" disabled aria-label="使用帮助，规划中"><HelpCircle size={20} aria-hidden="true" /><span className="hm-nav-label">使用帮助</span><span className="hm-nav-planned">规划</span></button>}
      </footer>}
    </aside>
    {flyout && !expanded && createPortal(<div ref={flyoutRef} id="hm-nav-flyout" className="hm-nav-flyout" role="dialog" aria-label={`${flyout.label}子菜单`} style={position}>
      <header><strong>{flyout.label}</strong><button type="button" aria-label="关闭子菜单" onClick={() => closeFlyout(true)}><X size={18} aria-hidden="true" /></button></header>
      <nav aria-label={`${flyout.label}子菜单入口`}>{flyout.items.map(renderItem)}</nav>
    </div>, document.body)}
  </>;
}
