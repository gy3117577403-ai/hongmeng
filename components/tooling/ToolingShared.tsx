'use client';
import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import type { TerminalToolingBladeDTO, TerminalToolingSetupDTO, TerminalToolingTerminalDTO } from '@/types';
import type { StockUnit, ToolingJobDTO } from '@/lib/tooling-worklog-domain';
export type InventoryBlade = TerminalToolingBladeDTO & { countedAt: string | null; units: Array<StockUnit & { inUseJob?: { actorName: string; employeeId: string; status: string; contextSnapshot: { equipment?: string } } | null }>; stock: { registered: boolean; total: number; available: number; inUse: number; maintenance: number; completeKits: number; incompleteKits: number; loose: number; boxes: number[] } };
export type WorkData = { serverNow: string; jobs: Array<ToolingJobDTO & { period: { workMs: number; waitMs: number } }>; active: ToolingJobDTO | null; summary: { count: number; tuningMs: number; assistMs: number; waitMs: number; ongoing: number }; daily: Array<{ date: string; workMs: number; waitMs: number; tuningMs: number; assistMs: number }>; employees: Array<{ employeeId: string; name: string; employeeNo: string; count: number; tuningMs: number; assistMs: number; waitMs: number }> };
export type Catalog = { blades: InventoryBlade[]; terminals: TerminalToolingTerminalDTO[]; setups: TerminalToolingSetupDTO[] };
export type Submit = (endpoint: 'worklog' | 'inventory', data: Record<string, unknown>) => Promise<Record<string, unknown> | null>;
export const ToolingFeedback = createContext('');
export function ToolingDialog({ title, subtitle, children, footer, onClose, busy = false, wide = false }: { title: string; subtitle?: string; children: ReactNode; footer?: ReactNode; onClose: () => void; busy?: boolean; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const feedback = useContext(ToolingFeedback);
  useEffect(() => { const el = ref.current; el?.showModal(); return () => el?.close(); }, []);
  return <dialog ref={ref} className={'tooling-sheet' + (wide ? ' wide' : '')} onCancel={e => { e.preventDefault(); if (!busy) onClose(); }} aria-label={title}>
    <header><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button type="button" className="tl-icon" aria-label="关闭弹窗" disabled={busy} onClick={onClose}><X size={21}/></button></header>
    <div className="tooling-sheet-body">{feedback && <div className="tl-error" role="alert">{feedback}</div>}{children}</div>{footer && <footer>{footer}</footer>}
  </dialog>;
}
export const stamp = (date: string) => new Date(date).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
export const hours = (ms: number) => (ms / 3600000).toLocaleString('zh-CN', { maximumFractionDigits: 2 });
export const asLocal = (date: string | Date) => new Date(+new Date(date) + 8 * 3600000).toISOString().slice(0, 16);
export const asShanghai = (value: string) => new Date(value + ':00+08:00').toISOString();
export const jobTitle = (job: ToolingJobDTO) => job.kind === 'TUNING' ? job.terminalSnapshot.specification || '端子调模' : job.category;
