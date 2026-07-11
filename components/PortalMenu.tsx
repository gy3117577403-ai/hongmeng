'use client';

import { type CSSProperties, type MouseEvent, type ReactNode, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

type ActiveMenu = {
  id: string;
  close: () => void;
};

let activeMenu: ActiveMenu | null = null;

type MenuAlign = 'left' | 'right';

type PortalMenuProps = {
  open: boolean;
  anchorRef: { current: HTMLElement | null };
  className: string;
  children: ReactNode;
  align?: MenuAlign;
  width?: number;
  offset?: number;
  onClose?: () => void;
  closeOnSelect?: boolean;
};

type LayerPosition = {
  top: number;
  left: number;
  width: number;
};

export function PortalMenu({
  open,
  anchorRef,
  className,
  children,
  align = 'right',
  width,
  offset = 8,
  onClose,
  closeOnSelect = true,
}: PortalMenuProps) {
  const reactId = useId();
  const menuId = `portal-menu-${reactId.replace(/:/g, '')}`;
  const layerRef = useRef<HTMLDivElement | null>(null);
  const [mounted, setMounted] = useState(false);
  const [position, setPosition] = useState<LayerPosition>({ top: 0, left: 0, width: width || 180 });

  const close = useCallback((returnFocus = false): void => {
    onClose?.();
    if (returnFocus) window.requestAnimationFrame(() => {
      const focused = document.activeElement;
      if (focused === document.body || focused === layerRef.current || layerRef.current?.contains(focused)) anchorRef.current?.focus();
    });
  }, [anchorRef, onClose]);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor) return undefined;
    anchor.setAttribute('aria-haspopup', 'menu');
    anchor.setAttribute('aria-controls', menuId);
    anchor.setAttribute('aria-expanded', open ? 'true' : 'false');
    return () => {
      anchor.setAttribute('aria-expanded', 'false');
    };
  }, [anchorRef, menuId, open]);

  useEffect(() => {
    if (!open || !mounted) return undefined;
    const current: ActiveMenu = { id: menuId, close: () => close(false) };
    if (activeMenu && activeMenu.id !== menuId) activeMenu.close();
    activeMenu = current;

    const isInside = (target: EventTarget | null): boolean => {
      if (!(target instanceof Node)) return false;
      return !!layerRef.current?.contains(target) || !!anchorRef.current?.contains(target);
    };
    const handlePointerDown = (event: PointerEvent): void => {
      if (!isInside(event.target)) close(true);
    };
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close(true);
      }
    };
    const handleFocusIn = (event: FocusEvent): void => {
      if (!isInside(event.target)) close(false);
    };
    const handleVisibility = (): void => {
      if (document.visibilityState !== 'visible') close(false);
    };
    const handleWindowBlur = (): void => close(false);
    const handleNavigation = (): void => close(false);

    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('keydown', handleKeyDown, true);
    document.addEventListener('focusin', handleFocusIn, true);
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('blur', handleWindowBlur);
    window.addEventListener('popstate', handleNavigation);
    window.addEventListener('hashchange', handleNavigation);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('keydown', handleKeyDown, true);
      document.removeEventListener('focusin', handleFocusIn, true);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('blur', handleWindowBlur);
      window.removeEventListener('popstate', handleNavigation);
      window.removeEventListener('hashchange', handleNavigation);
      if (activeMenu?.id === menuId) activeMenu = null;
    };
  }, [anchorRef, close, menuId, mounted, open]);

  useLayoutEffect(() => {
    if (!open || !mounted) return undefined;

    const updatePosition = (): void => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const layerWidth = width || Math.max(180, Math.ceil(rect.width));
      const minEdge = 12;
      const maxLeft = Math.max(minEdge, viewportWidth - layerWidth - minEdge);
      const preferredLeft = align === 'right' ? rect.right - layerWidth : rect.left;
      const left = Math.min(Math.max(minEdge, preferredLeft), maxLeft);
      const preferredTop = rect.bottom + offset;
      const top = Math.min(Math.max(minEdge, preferredTop), Math.max(minEdge, viewportHeight - minEdge));
      setPosition({ top, left, width: layerWidth });
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [align, anchorRef, mounted, offset, open, width]);

  if (!open || !mounted) return null;

  const style: CSSProperties = {
    top: position.top,
    left: position.left,
    width: position.width,
  };

  const handleMenuClick = (event: MouseEvent<HTMLDivElement>): void => {
    if (!closeOnSelect) return;
    const target = event.target as HTMLElement;
    const action = target.closest('button, a, [role="menuitem"]');
    if (action && !action.hasAttribute('disabled') && action.getAttribute('aria-disabled') !== 'true') close(false);
  };

  return createPortal(
    <div ref={layerRef} id={menuId} role="menu" className={`app-dropdown-layer ${className}`} style={style} onClickCapture={handleMenuClick}>
      {children}
    </div>,
    document.body,
  );
}
