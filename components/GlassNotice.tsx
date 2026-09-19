'use client';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, CheckCircle2, X } from 'lucide-react';
import styles from './GlassNotice.module.css';

export function GlassNotice({ message, close, error = false, action }: { message: string; close: () => void; error?: boolean; action?: { label: string; run: () => void } }) {
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (!message || paused || error) return;
    const timer = setTimeout(close, 3200);
    return () => clearTimeout(timer);
  }, [message, close, paused, error]);
  if (!message || typeof document === 'undefined') return null;
  return createPortal(<div className={`${styles.notice} ${error ? styles.error : ''}`} role={error ? 'alert' : 'status'} aria-atomic="true" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocus={() => setPaused(true)} onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) setPaused(false); }}>
    {error ? <AlertCircle size={20} /> : <CheckCircle2 size={20} />}<span>{message}</span>
    {action && <button onClick={action.run}>{action.label}</button>}<button aria-label="关闭提示" onClick={close}><X size={16} /></button>
  </div>, document.body);
}
