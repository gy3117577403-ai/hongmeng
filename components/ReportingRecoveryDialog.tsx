'use client';

import { useEffect, useRef } from 'react';
import ReportingRecoveryShell from '@/components/ReportingRecoveryShell';
import type { CurrentUserDTO } from '@/types';

export default function ReportingRecoveryDialog({ user, submissionId = '', keyword = '', onClose }: { user?: CurrentUserDTO; submissionId?: string; keyword?: string; onClose: () => void }) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const prior = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    container.current?.focus();
    return () => { document.body.style.overflow = prior; active?.focus(); };
  }, []);
  return <div className="reporting-recovery-dialog" role="dialog" aria-modal="true" aria-label="报工资料核对" ref={container} tabIndex={-1} onKeyDown={event => {
    if (event.key !== 'Tab') return;
    const elements = Array.from(container.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),[tabindex="0"]') || []).filter(element => element.offsetParent !== null);
    const first = elements[0], last = elements[elements.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === container.current)) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }}><ReportingRecoveryShell user={user} embedded initialSubmissionId={submissionId} initialKeyword={keyword} onClose={onClose} /></div>;
}
