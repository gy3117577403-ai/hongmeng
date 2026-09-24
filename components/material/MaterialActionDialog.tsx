'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

/** Native modal keeps keyboard focus and restores it to the triggering field. */
export default function MaterialActionDialog({ title, busy, onClose, children, footer }: {
  title: string; busy?: boolean; onClose: () => void; children: ReactNode; footer: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const node = ref.current; node?.showModal(); return () => node?.close(); }, []);
  return <dialog ref={ref} className="mc-dialog" aria-label={title} onCancel={event => { event.preventDefault(); event.stopPropagation(); if (!busy) onClose(); }}>
    <header><h2>{title}</h2><button type="button" aria-label={`关闭${title}`} disabled={busy} onClick={onClose}><X size={19}/></button></header>
    <div className="mc-dialog-body">{children}</div>
    <footer><button type="button" disabled={busy} onClick={onClose}>取消</button>{footer}</footer>
  </dialog>;
}
