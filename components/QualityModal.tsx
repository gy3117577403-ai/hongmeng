'use client';
import { useRef, type ReactNode } from 'react';
import { useModalLayer } from './useModalLayer';
export function QualityModal({ children, onClose, busy = false, className = '' }: { children: ReactNode; onClose: () => void; busy?: boolean; className?: string }) {
  const layer = useRef<HTMLDivElement>(null);
  useModalLayer({ open: true, layerRef: layer, onClose: () => { if (!busy) onClose(); } });
  return <div ref={layer} className={'risk-modal-backdrop ' + className} tabIndex={-1}>{children}</div>;
}
