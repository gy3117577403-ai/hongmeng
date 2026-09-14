'use client';
import { useState } from 'react';
import { Plus, Search, X } from 'lucide-react';
import type { QualityOperator } from '@/lib/quality-direct-shared';
import './quality-direct.css';

export function QualityOperatorTags({ people }: { people: QualityOperator[] }) {
  return <div className="qd-operator-tags">{people.length ? people.map(person => <span key={person.id} title={`${person.employeeNo} · ${person.department} · ${person.team}`}>{person.name}<small>{person.employeeNo}</small></span>) : <small>尚未关联作业人员</small>}</div>;
}
export default function QualityOperatorsPicker({ value, onChange, disabled = false }: { value: QualityOperator[]; onChange: (value: QualityOperator[]) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false), [query, setQuery] = useState('');
  const [people, setPeople] = useState<QualityOperator[]>([]), [loaded, setLoaded] = useState(false), [error, setError] = useState('');
  async function show() {
    setOpen(true); if (loaded) return; setError('');
    try { const response = await fetch('/api/quality/internal-risks/options?peopleOnly=1', { cache: 'no-store' }); const body = await response.json(); if (!response.ok) throw Error(body.error || '人员加载失败'); setPeople(body.employees || []); setLoaded(true); }
    catch (error) { setError(error instanceof Error ? error.message : '人员加载失败'); }
  }
  const matches = people.filter(person => `${person.name} ${person.employeeNo} ${person.department} ${person.team}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <section className="qd-operators"><header><span>作业人员 <small>{value.length ? `${value.length} 人` : '选填'}</small></span><button type="button" disabled={disabled} onClick={() => open ? setOpen(false) : void show()} aria-expanded={open}><Plus size={14} />{open ? '收起' : '添加人员'}</button></header>
    <div className="qd-operator-tags">{value.map(person => <span key={person.id}>{person.name}<small>{person.employeeNo}</small><button type="button" disabled={disabled} aria-label={`移除作业人员 ${person.name}`} onClick={() => onChange(value.filter(item => item.id !== person.id))}><X size={12} /></button></span>)}</div>
    {open && <div className="qd-picker"><label className="qd-search"><Search size={16} /><input autoFocus value={query} aria-label="搜索作业人员" placeholder="姓名、工号或班组" onChange={event => setQuery(event.target.value)} /></label><div className="qd-picker-results">{matches.map(person => <label key={person.id}><input type="checkbox" disabled={disabled} checked={value.some(item => item.id === person.id)} onChange={() => onChange(value.some(item => item.id === person.id) ? value.filter(item => item.id !== person.id) : [...value, person])} /><span><strong>{person.name}</strong><small>{person.employeeNo} · {person.team || person.department}</small></span></label>)}{loaded && !matches.length && <p>没有匹配的员工</p>}{!loaded && !error && <p>正在加载员工…</p>}{error && <p role="alert">{error}<button type="button" onClick={() => void show()}>重试</button></p>}</div><footer>仅记录实际作业人员，无需本人填写或确认。</footer></div>}
  </section>;
}
