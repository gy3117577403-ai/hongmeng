'use client';
import { useId, useState } from 'react';
import QualityOperatorsPicker from './QualityOperatorsPicker';
import { Plus, Search, X } from 'lucide-react';
import type { QualityOperatorAssignments } from '@/lib/quality-direct-shared';

export type QualityAssignee = { id: string; displayName: string; username: string; department?: string; canReview?: boolean; notificationHint?: string };
export function QualityAssigneeSelect({ value, onChange, users, label = '主负责人' }: { value: string; onChange: (id: string) => void; users: QualityAssignee[]; label?: string }) {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const id = useId();
  const selected = users.find(user => user.id === value);
  const options = users.filter(user => `${user.displayName} ${user.username}`.toLowerCase().includes(search.toLowerCase()));
  return <div className="quality-assignee-picker"><label htmlFor={id}>{label}</label><button id={id} type="button" aria-expanded={open} onClick={() => setOpen(!open)}>{selected ? `${selected.displayName || selected.username} · ${selected.username}` : '搜索并选择真实账号'}</button>
    {open && <div className="quality-assignee-options"><input autoFocus aria-label={`搜索${label}`} placeholder="姓名 / 账号" value={search} onChange={event => setSearch(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') setOpen(false); }} /><div>{options.map(user => <button key={user.id} type="button" aria-pressed={value === user.id} onClick={() => { onChange(user.id); setOpen(false); setSearch(''); }}>{user.displayName || user.username}<small>{user.username}</small></button>)}{!options.length && <p>没有匹配的有效账号</p>}</div><button type="button" onClick={() => setOpen(false)}>收起</button></div>}
  </div>;
}

export function QualityPeopleFields({ ids, reviewer, users, onChange, operators = {} }: {
  ids: string[]; lead?: string; reviewer: string; users: QualityAssignee[]; operators?: QualityOperatorAssignments;
  onChange: (value: { responsibleUserIds: string[]; ownerUserId: string; reviewerUserId: string; operatorAssignments: QualityOperatorAssignments }) => void;
}) {
  const [query, setQuery] = useState(''), [open, setOpen] = useState(false);
  const candidates = users.filter(user => user.id !== reviewer && `${user.displayName} ${user.username} ${user.department}`.toLowerCase().includes(query.toLowerCase()));
  const change = (next: string[], assignments = operators, nextReviewer = reviewer) => onChange({ responsibleUserIds: next, ownerUserId: '', reviewerUserId: next.includes(nextReviewer) ? '' : nextReviewer, operatorAssignments: Object.fromEntries(Object.entries(assignments).filter(([id]) => next.includes(id))) });
  return <section className="qv3-people qd-people"><header><strong>主要责任人 <b>*</b><small>已选 {ids.length} 人</small></strong><button type="button" onClick={() => setOpen(!open)} aria-expanded={open}><Plus size={16} />{open ? '完成选择' : '添加责任人'}</button></header>
    {open && <div className="qd-picker"><label className="qd-search"><Search size={16} /><input autoFocus aria-label="搜索责任人" placeholder="姓名、账号或部门" value={query} onChange={event => setQuery(event.target.value)} /></label><div className="qd-picker-results">{candidates.map(user => <label key={user.id}><input type="checkbox" checked={ids.includes(user.id)} onChange={() => change(ids.includes(user.id) ? ids.filter(id => id !== user.id) : [...ids, user.id])} /><span><strong>{user.displayName || user.username}</strong><small>{user.department || user.username}</small></span></label>)}{!candidates.length && <p>{users.length ? '没有匹配的责任人' : '暂无可用工作台账号，请联系管理员完善账号授权。'}</p>}</div></div>}
    <div className="qd-owner-cards">{ids.map((id, index) => { const person = users.find(user => user.id === id); return <article key={id}><header><span className="qd-person-number">{index + 1}</span><div><strong>{person?.displayName || person?.username || '原责任账号不可用'}</strong><small>{person?.department || '主要责任人'}</small></div><button type="button" aria-label={`移除责任人 ${person?.displayName || person?.username || id}`} onClick={() => change(ids.filter(item => item !== id))}><X size={16} /></button></header><QualityOperatorsPicker value={operators[id] || []} onChange={people => change(ids, { ...operators, [id]: people })} /></article>; })}{!ids.length && !open && <button type="button" className="qd-empty-owner" onClick={() => setOpen(true)}><Plus size={20} />选择需要填写处理内容的责任人</button>}</div>
    <div className="qd-reviewer"><QualityAssigneeSelect label="品质确认人 *" value={reviewer} users={users.filter(user => user.canReview && !ids.includes(user.id))} onChange={id => change(ids, operators, id)} /><small>所有责任人提交后，自动送此人确认。</small></div>
  </section>;
}
