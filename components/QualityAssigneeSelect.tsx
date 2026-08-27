'use client';
import { useId, useState } from 'react';

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

export function QualityPeopleFields({ ids, lead, reviewer, users, onChange }: {
  ids: string[]; lead: string; reviewer: string; users: QualityAssignee[];
  onChange: (value: { responsibleUserIds: string[]; ownerUserId: string; reviewerUserId: string }) => void;
}) {
  const [query, setQuery] = useState('');
  const updateIds = (next: string[]) => onChange({ responsibleUserIds: next, ownerUserId: next.includes(lead) ? lead : next[0] || '', reviewerUserId: next.includes(reviewer) ? '' : reviewer });
  return <section className="qv3-people"><header><strong>主要责任人（可多选）</strong><small>每人独立任务 · 已选 {ids.length} 人</small></header>
    <input aria-label="搜索责任人" placeholder="搜索姓名、账号、部门" value={query} onChange={event => setQuery(event.target.value)} />
    <div className="qv3-people-list">{users.filter(user => `${user.displayName} ${user.username} ${user.department}`.toLowerCase().includes(query.toLowerCase())).map(user => <label key={user.id}><input type="checkbox" checked={ids.includes(user.id)} onChange={() => updateIds(ids.includes(user.id) ? ids.filter(id => id !== user.id) : [...ids, user.id])} /><span><strong>{user.displayName || user.username}</strong><small>{user.department || user.username} · {user.notificationHint || '通知状态待核对'}</small></span></label>)}</div>
    <div className="qv3-form-pair"><QualityAssigneeSelect label="牵头人（汇总并提交）" value={lead} users={users.filter(user => ids.includes(user.id))} onChange={ownerUserId => onChange({ responsibleUserIds: ids, ownerUserId, reviewerUserId: reviewer })} />
    <QualityAssigneeSelect label="品质确认人（独立审核）" value={reviewer} users={users.filter(user => user.canReview && !ids.includes(user.id))} onChange={reviewerUserId => onChange({ responsibleUserIds: ids, ownerUserId: lead, reviewerUserId })} /></div>
    <small>品质确认人不能同时处理本事件。未绑定人事不影响任务建立，但企业微信 @ 提醒需补齐人事手机号。</small>
  </section>;
}
