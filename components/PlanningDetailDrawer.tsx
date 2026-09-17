'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import styles from './PlanningDetailDrawer.module.css';

/** Native modal layering also supports the existing production-control dialogs. */
export function PlanningDetailDrawer({ title, subtitle, onClose, children }: {
  title: string; subtitle?: string; onClose: () => void; children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.current?.showModal();
    return () => { if (trigger?.isConnected) trigger.focus({ preventScroll: true }); };
  }, []);
  return createPortal(<dialog ref={dialog} className={styles.drawer} aria-label={title}
    onCancel={event => { event.preventDefault(); onClose(); }}
    onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className={styles.panel}>
      <header><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button type="button" aria-label={`关闭${title}`} onClick={onClose}><X size={20} /></button></header>
      <div className={styles.body}>{children}</div>
    </section>
  </dialog>, document.body);
}
