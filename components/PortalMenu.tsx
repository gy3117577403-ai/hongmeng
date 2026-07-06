'use client';

import { type CSSProperties, type ReactNode, useEffect, useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';

type MenuAlign = 'left' | 'right';

type PortalMenuProps = {
  open: boolean;
  anchorRef: { current: HTMLElement | null };
  className: string;
  children: ReactNode;
  align?: MenuAlign;
  width?: number;
  offset?: number;
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
}: PortalMenuProps) {
  const [mounted, setMounted] = useState(false);
  const [position, setPosition] = useState<LayerPosition>({ top: 0, left: 0, width: width || 180 });

  useEffect(() => {
    setMounted(true);
  }, []);

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

  return createPortal(
    <div className={`app-dropdown-layer ${className}`} style={style}>
      {children}
    </div>,
    document.body,
  );
}
