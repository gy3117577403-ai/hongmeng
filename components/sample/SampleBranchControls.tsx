'use client';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays, ChevronLeft, ChevronRight, FlaskConical, Layers3, X } from 'lucide-react';
import { sampleCurrentWeek, sampleShiftDay, sampleWeek } from '@/lib/sample-plan-domain';

export async function sampleRequest(url: string, init?: RequestInit) {
  const response = await fetch(url, { cache: 'no-store', ...init });
  const body = await response.json();
  if (!response.ok || body.ok === false) throw new Error(body.error || '操作失败，请重试');
  return body;
}
export const sampleStamp = (value?: string | null) => value ? new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
export function SampleDialog({ title, children, onClose, busy = false, wide = false, headerActions }: { title: string; children: ReactNode; onClose: () => void; busy?: boolean; wide?: boolean; headerActions?: ReactNode }) {
  const ref = useRef<HTMLElement>(null), label = useId();
  const closeRef = useRef(onClose); closeRef.current = onClose;
  useEffect(() => {
    const prior = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    function key(event: KeyboardEvent) {
      const dialogs = document.querySelectorAll('[role="dialog"][aria-modal="true"]');
      if (dialogs[dialogs.length - 1] !== ref.current) return;
      if (event.key === 'Escape' && !busy) { event.stopPropagation(); closeRef.current(); }
      if (event.key !== 'Tab') return;
      const nodes = Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href]') || []);
      if (!nodes.length) { event.preventDefault(); return; }
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); prior?.focus(); };
  }, [busy]);
  return createPortal(<div className="sb-overlay"><section ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={label} className={`sb-dialog${wide ? ' sp-detail-dialog' : ''}`}><header><h2 id={label}>{title}</h2>{headerActions}<button aria-label="关闭弹窗" disabled={busy} onClick={onClose}><X size={18}/></button></header>{children}</section></div>, document.body);
}
type Week = { week: string; total: number; unfinished: number };
export function SampleBranchControls({ type, week, carry, refresh, onChange, warehouse = false, hideType = false }: { hideType?: boolean; warehouse?: boolean; type: 'NEW' | 'REPEAT' | ''; week: string; carry: boolean; refresh: number; onChange: (type: 'NEW' | 'REPEAT' | '', week: string, carry: boolean) => void }) {
  const [weeks, setWeeks] = useState<Week[]>([]), [current, setCurrent] = useState(sampleCurrentWeek);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const ctrl = new AbortController();
    sampleRequest(`/api/sample-tasks/weeks?taskType=${type}${warehouse ? '&warehouse=true' : ''}`, { signal: ctrl.signal }).then(body => { setWeeks(body.weeks); setCurrent(body.currentWeek); setFailed(false); }).catch(e => { if (e.name !== 'AbortError') setFailed(true); });
    return () => ctrl.abort();
  }, [type, refresh, warehouse]);
  const count = (key: string) => { const value=weeks.find(w => w.week === key); return (key === 'unplanned' ? value?.unfinished : value?.total) || 0; };
  const next = sampleShiftDay(current, 7), nextNext = sampleShiftDay(current, 14), history = !!week && week !== 'unplanned' && week !== current && week !== next && week !== nextNext;
  return <section className="sb-plan-nav" aria-label="样品类型与计划周">
    {warehouse ? <select aria-label="样品类型" value={type} onChange={e=>onChange(e.target.value as 'NEW'|'REPEAT'|'',week,carry)}><option value="">全部样品</option><option value="NEW">新品试制</option><option value="REPEAT">老产品制作</option></select> : !hideType && <div className="sb-branch-switch" role="group" aria-label="样品类型">{(['NEW','REPEAT'] as const).map(kind => <button key={kind} className={type === kind ? 'active' : ''} aria-pressed={type === kind} onClick={() => onChange(kind, week, carry)}>{kind === 'NEW' ? <FlaskConical size={19}/> : <Layers3 size={19}/>}<span>{kind === 'NEW' ? '新品试制' : '老产品制作'}</span></button>)}</div>}
    <nav className="sb-week-switch" aria-label="计划周">{[[current,'本周'],[next,'下周'],[nextNext,'下下周'],['unplanned','待排期']].map(([key, title]) => <button key={key} className={week === key ? 'active' : ''} aria-pressed={week === key} onClick={() => onChange(type, key, carry)}><CalendarDays size={17}/><span><strong>{title}</strong><small>{key === 'unplanned' ? '尚未安排计划周' : `${key.slice(5)} — ${sampleShiftDay(key, 6).slice(5)}`}</small></span><b>{count(key)}</b></button>)}<select aria-label="历史计划周" className={history ? 'active' : ''} value={history ? week : ''} onChange={e => e.target.value && onChange(type, e.target.value, false)}><option value="">历史周</option>{weeks.filter(w => w.week !== 'unplanned' && w.week < current).map(w => <option key={w.week} value={w.week}>{w.week} · {w.total} 项</option>)}{history && !weeks.some(w => w.week === week && w.week < current) && <option value={week}>{week}</option>}</select></nav>
    <div className="sb-week-tools"><button title="上一周" aria-label="上一周" onClick={() => onChange(type, sampleShiftDay(week && week !== 'unplanned' ? week : current, -7), carry)}><ChevronLeft size={16}/></button><input type="date" aria-label="选择任意计划周" value={week === 'unplanned' ? '' : week} onChange={e => e.target.value && onChange(type, sampleWeek(e.target.value)!, carry)}/><button title="下一周" aria-label="下一周" onClick={() => onChange(type, sampleShiftDay(week && week !== 'unplanned' ? week : current, 7), carry)}><ChevronRight size={16}/></button></div>
    {week !== 'unplanned' && <label className="sb-carry"><input type="checkbox" checked={carry} onChange={e => onChange(type, week, e.target.checked)}/>含以前未完成</label>}{failed && <small role="status">周数量暂不可用</small>}
  </section>;
}

