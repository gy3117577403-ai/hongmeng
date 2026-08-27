'use client';
import { useId, useState } from 'react';

export type QualityAssignee = { id: string; displayName: string; username: string };
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
