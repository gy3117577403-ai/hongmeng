'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown, Search, X, LocateFixed, Layers } from 'lucide-react';
import './process-step-picker.css';

export type PickerStep = { id: string; processName: string; position: number; sequenceGroup?: number; status?: string;
  reportableQty: number; reportableUnitQty?: number; reportQuantityBasis?: string; executionMode?: string; reportedQty?: number; unitLabel?: string | null };
export default function ProcessStepPicker({ steps, currentId, onSelect, desktop = false, disabled = false, strictSequence = false, batch = false, selected = [], onToggle, onAbnormal }:
  { steps: PickerStep[]; currentId?: string; onSelect: (id: string) => void; desktop?: boolean; disabled?: boolean; strictSequence?: boolean; batch?: boolean;
    selected?: string[]; onToggle?: (id: string) => void; onAbnormal?: (id: string) => void }) {
  const [open, setOpen] = useState(false), [query, setQuery] = useState(''), [filter, setFilter] = useState('all'), [group, setGroup] = useState('all');
  const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null), search = useRef<HTMLInputElement>(null), title = useId();
  const current = steps.find(step => step.id === currentId) || steps.find(step => step.reportableQty > 0) || steps[0];
  const remaining = (step: PickerStep) => step.reportableQty > 0 || step.reportQuantityBasis === 'action' && (step.reportableUnitQty || 0) > 0;
  const groups = [...new Set(steps.map(step => step.sequenceGroup || 1))];
  const visible = steps.filter(step => (!query || `${step.position} ${step.processName}`.toLowerCase().includes(query.toLowerCase())) &&
    (group === 'all' || String(step.sequenceGroup || 1) === group) && (filter === 'all' || filter === 'selected' ? filter !== 'selected' || selected.includes(step.id) : filter === 'unfinished' ? remaining(step) || step.status === 'pending' : !remaining(step) && step.status !== 'pending'));
  useEffect(() => {
    if (!open || desktop) return;
    const overflow = document.body.style.overflow, opener = trigger.current; document.body.style.overflow = 'hidden'; search.current?.focus();
    function key(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); setOpen(false); }
      if (e.key !== 'Tab') return;
      const list = Array.from(root.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input,select,a[href]') || []).filter(el => el.getClientRects().length);
      if (e.shiftKey && document.activeElement === list[0]) { e.preventDefault(); list.at(-1)?.focus(); }
      else if (!e.shiftKey && document.activeElement === list.at(-1)) { e.preventDefault(); list[0]?.focus(); }
    }
    document.addEventListener('keydown', key);
    return () => { document.body.style.overflow = overflow; document.removeEventListener('keydown', key); opener?.focus(); };
  }, [open, desktop]);
  function locate() { setQuery(''); setGroup('all'); setFilter('all'); window.setTimeout(() => root.current?.querySelector<HTMLElement>(`[data-step-id="${current?.id}"]`)?.scrollIntoView({ block: 'center', behavior: 'auto' }), 0); }
  const list = <div ref={root} className={'process-picker ' + (desktop ? 'desktop' : 'mobile')} role={desktop ? undefined : 'dialog'} aria-modal={desktop ? undefined : true} aria-labelledby={title}>
    <header><span><Layers size={18}/><b id={title}>{batch ? '选择本次报工工序' : '选择工序'}</b><small>共 {steps.length} 道</small></span>{!desktop && <button type="button" aria-label="关闭工序选择" onClick={() => setOpen(false)}><X size={20}/></button>}</header>
    <div className="process-picker-tools"><label><Search size={17}/><input ref={search} value={query} placeholder="搜索名称或序号" aria-label="搜索工序" onChange={e => setQuery(e.target.value)}/>{query && <button type="button" aria-label="清除工序搜索" onClick={() => setQuery('')}><X size={15}/></button>}</label><nav aria-label="工序状态筛选">{[['all', '全部'], ['unfinished', '未完成'], ['done', '已报满'], ...(batch ? [['selected', `已选 ${selected.length}`]] : [])].map(([key, label]) => <button type="button" key={key} className={filter === key ? 'active' : ''} onClick={() => setFilter(key)}>{label}</button>)}</nav><div><select aria-label="工序顺序组" value={group} onChange={e => setGroup(e.target.value)}><option value="all">全部顺序组</option>{groups.map(g => <option key={g} value={g}>顺序组 {g}</option>)}</select><button type="button" onClick={locate}><LocateFixed size={15}/>定位当前</button></div></div>
    <div className="process-picker-list">{visible.map(step => {
      const chosen = batch ? selected.includes(step.id) : step.id === current?.id;
      const sequenceBlocked = strictSequence && step.status === 'pending';
      const batchBlocked = batch && (!remaining(step) || step.reportQuantityBasis === 'action' || step.executionMode === 'SUPPLEMENTAL_OBLIGATION');
      return <button type="button" data-step-id={step.id} key={step.id} className={'process-picker-row ' + (chosen ? 'active' : '')} disabled={disabled || batchBlocked || sequenceBlocked} onClick={() => {
        if (batch) onToggle?.(step.id); else { onSelect(step.id); setOpen(false); }
      }}><b className="process-picker-seq">{String(step.position).padStart(2, '0')}</b><span><strong>{step.processName}</strong><small>顺序组 {step.sequenceGroup || 1} · {step.reportQuantityBasis === 'action' ? `剩余动作 ${step.reportableUnitQty || 0}` : `已报 ${step.reportedQty || 0} · 可报 ${step.reportableQty}`}</small></span><em>{sequenceBlocked ? '待前序' : chosen ? <Check size={17}/> : batchBlocked && remaining(step) ? '单独报工' : remaining(step) ? '未完成' : '已报满'}</em></button>;
    })}{!visible.length && <p className="process-picker-empty">没有符合条件的工序<button type="button" onClick={() => { setQuery(''); setGroup('all'); setFilter('all'); }}>清除筛选</button></p>}</div>
    <footer><small>{batch ? `已选 ${selected.length} 道 · 每次最多 20 道` : `${visible.length} / ${steps.length} 道 · 按工艺顺序排列`}</small>{batch && !desktop && <button type="button" className="primary" onClick={() => setOpen(false)}>完成选择</button>}</footer>
  </div>;
  if (desktop) return list;
  return <><div className="process-current-card"><button ref={trigger} type="button" disabled={disabled} aria-haspopup="dialog" onClick={() => setOpen(true)}><span className="process-current-seq">{batch ? selected.length : String(current?.position || 1).padStart(2, '0')}</span><span><small>{batch ? '本次批量工序' : '当前工序'} · 共 {steps.length} 道</small><b>{batch ? `已选择 ${selected.length} 道` : current?.processName || '选择工序'}</b></span><em>{batch ? '选择' : '切换'}<ChevronDown size={16}/></em></button>{!batch && current && <div><button type="button" className="primary" disabled={disabled} onClick={() => onSelect(current.id)}>{remaining(current) ? '填写本次报工' : '查看报工记录'}</button>{onAbnormal && <button type="button" disabled={disabled} onClick={() => onAbnormal(current.id)}>异常工时</button>}</div>}</div>{open && <div className="process-picker-overlay">{list}</div>}</>;
}
