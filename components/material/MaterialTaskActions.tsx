'use client';

import { Check, CircleUserRound, Hand, Loader2, UserRoundPlus, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CurrentUserDTO, IssueUserDTO, MaterialFollowUpTaskDTO } from '@/types';

function time(value?: string | null) {
  return value ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value)) : '';
}

export default function MaterialTaskActions({ task, user, users, busy, error, onAction, onDirty }: {
  task: MaterialFollowUpTaskDTO; user: CurrentUserDTO; users: IssueUserDTO[];
  busy: boolean; error: string; onAction: (body: Record<string, unknown>) => Promise<boolean>;
  onDirty: (dirty: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [ownerId, setOwnerId] = useState('');
  const [search, setSearch] = useState('');
  const [note, setNote] = useState('');
  const anchor = useRef<HTMLElement>(null);
  const [editorHeight, setEditorHeight] = useState(360);
  const readOnly = user.access.modulePermissions?.materials === 'READ';
  const canAssign = !readOnly && user.access.capabilities.includes('PROCUREMENT:UPDATE');
  const pending = task.status === 'PENDING';
  const ownerName = task.owner?.displayName || task.owner?.username || '';
  const canClaim = !readOnly && pending && (task.owner ? task.owner.id === user.id : canAssign);
  const closed = ['RESOLVED', 'CANCELLED', 'WAITING_WAREHOUSE'].includes(task.status);
  const candidates = users.filter(item => item.id !== task.owner?.id && (!search.trim() || `${item.displayName || ''} ${item.username}`.toLowerCase().includes(search.trim().toLowerCase()) || item.id === ownerId));

  useEffect(() => { onDirty(open && Boolean(ownerId || note.trim())); }, [open, ownerId, note, onDirty]);
  useEffect(() => () => onDirty(false), [onDirty]);
  useLayoutEffect(() => {
    if (!open) return;
    const measure = () => {
      const bounds = anchor.current?.getBoundingClientRect();
      const panel = anchor.current?.closest('.mf-detail')?.getBoundingClientRect();
      if (bounds) setEditorHeight(Math.max(120, Math.min(390, (panel?.bottom || innerHeight) - bounds.bottom - 16)));
    };
    measure(); window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) { event.stopPropagation(); setOpen(false); }
    };
    window.addEventListener('keydown', close, true);
    return () => window.removeEventListener('keydown', close, true);
  }, [open, busy]);

  async function assign() {
    if (await onAction({ action: 'assign', ownerId, note })) {
      setOpen(false); setOwnerId(''); setSearch(''); setNote('');
    }
  }

  if (closed) return null;
  return <section ref={anchor} className={`mf-task-actions ${pending ? 'is-pending' : 'is-accepted'}`} aria-label="任务分配与接收" aria-busy={busy}>
    <div className="mf-task-identity">
      <span className="mf-task-avatar">{pending ? <CircleUserRound size={23} /> : <Check size={23} />}</span>
      <div><small>{task.owner ? '本项负责人' : '需要安排负责人'}</small>
        <strong>{ownerName || '尚未分配'}<span className="mf-task-state">{pending ? ownerName ? '等待本人接收' : '待分配' : '正在跟进'}</span></strong>
        <p>{pending ? task.owner ? `${task.assignedAt ? `${time(task.assignedAt)} 已分配 · ` : ''}${canClaim ? '请点击接收任务，开始跟进' : `等待 ${ownerName} 本人接收`}` : '直接分配给同事，或由你接收跟进' : task.acceptedAt ? `${time(task.acceptedAt)} 本人已接收` : '历史任务 · 未记录接收时间'}</p>
      </div>
    </div>
    <div className="mf-task-buttons">
      {canAssign && <button type="button" className={!task.owner ? 'ms-primary' : ''} disabled={busy} aria-expanded={open} aria-controls="material-assignment-form" onClick={() => setOpen(value => !value)}><UserRoundPlus size={16} />{task.owner ? pending ? '重新分配' : '转交负责人' : '分配负责人'}</button>}
      {canClaim && <button type="button" className={task.owner ? 'ms-primary' : 'mf-claim-button'} disabled={busy} onClick={() => void onAction({ action: 'claim' })}>{busy ? <Loader2 size={16} className="mf-action-spinner" /> : <Hand size={16} />}{task.owner ? '接收任务' : '我来接收'}</button>}
      {readOnly && <span className="mf-task-readonly">只读查看</span>}
    </div>
    {error && <p className="mf-action-error" role="alert">{error}</p>}
    {open && <div className="mf-assignment-editor" style={{ maxHeight: editorHeight }} id="material-assignment-form" role="region" aria-label="分配负责人">
      <div className="mf-assignment-title"><strong>{task.owner ? '转交给新的负责人' : '选择跟进负责人'}</strong><button type="button" aria-label="收起负责人选择" disabled={busy} onClick={() => setOpen(false)}><X size={17} /></button></div>
      <p>保存后等待本人接收，系统记录分配人和时间。</p>
      <div className="mf-assignment-fields">
        <label>查找员工<input autoFocus aria-label="查找负责人" placeholder="输入姓名或账号" value={search} onChange={event => setSearch(event.target.value)} disabled={busy} /></label>
        <label>负责人<select aria-label="选择负责人" value={ownerId} onChange={event => setOwnerId(event.target.value)} disabled={busy}><option value="">{candidates.length ? '请选择负责人' : '未找到匹配员工'}</option>{candidates.map(item => <option key={item.id} value={item.id}>{item.displayName || item.username} · {item.username}</option>)}</select></label>
        <label className="mf-handover-note">交接说明（选填）<input maxLength={600} placeholder="例如：请跟踪客户补料，原交期保留" value={note} onChange={event => setNote(event.target.value)} disabled={busy} /></label>
      </div>
      <div className="mf-assignment-footer"><button type="button" disabled={busy} onClick={() => setOpen(false)}>取消</button><button type="button" className="ms-primary" disabled={busy || !ownerId} onClick={() => void assign()}>{busy ? '保存中…' : '确认分配'}</button></div>
    </div>}
  </section>;
}
