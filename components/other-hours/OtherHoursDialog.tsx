'use client';
import { useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { useModalLayer } from '@/components/useModalLayer';

export function OtherHoursDialog({ title, children, onClose, busy = false, wide = false, interactionEnabled = true }: {
  title: string; children: ReactNode; onClose: () => void; busy?: boolean; wide?: boolean; interactionEnabled?: boolean;
}) {
  const ref = useRef<HTMLElement>(null);
  const id = useId();
  useModalLayer({ open: true, layerRef: ref, onClose: () => { if (!busy) onClose(); }, interactionEnabled });
  return <div className="oh-modal" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
    <section ref={ref} className={'oh-dialog' + (wide ? ' oh-dialog-wide' : '')} role="dialog" aria-modal="true" aria-labelledby={id} tabIndex={-1}>
      <header className="oh-dialog-header"><h2 id={id}>{title}</h2><button type="button" disabled={busy} className="oh-icon-button" aria-label="关闭弹窗" onClick={onClose}><X size={19} /></button></header>
      {children}
    </section>
  </div>;
}
