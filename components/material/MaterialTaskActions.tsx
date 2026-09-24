'use client';

import { CircleUserRound, Hand, Loader2, UserRoundPlus } from 'lucide-react';
import { useEffect, useState } from 'react';
import MaterialActionDialog from './MaterialActionDialog';
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
  const readOnly = user.access.modulePermissions?.materials === 'READ';
  const canAssign = !readOnly && user.access.capabilities.includes('PROCUREMENT:UPDATE');
  const pending = task.status === 'PENDING';
  const ownerName = task.owner?.displayName || task.owner?.username || '';
  const canClaim = !readOnly && pending && (task.owner ? task.owner.id === user.id : canAssign);
  const closed = ['RESOLVED', 'CANCELLED', 'WAITING_WAREHOUSE'].includes(task.status);
  const candidates = users.filter(item => item.id !== task.owner?.id && (!search.trim() || `${item.displayName || ''} ${item.username}`.toLowerCase().includes(search.trim().toLowerCase()) || item.id === ownerId));

  useEffect(() => { onDirty(open && Boolean(ownerId || note.trim())); }, [open, ownerId, note, onDirty]);
  useEffect(() => () => onDirty(false), [onDirty]);
  async function assign() {
    if (await onAction({ action: 'assign', ownerId, note })) {
      setOpen(false); setOwnerId(''); setSearch(''); setNote('');
    }
  }

  return <section className={`mf-task-actions ${pending ? 'is-pending' : 'is-accepted'}`} aria-label="任务分配与接收" aria-busy={busy}>
    <div className="mf-task-identity"><CircleUserRound size={18}/><span>负责人</span><strong>{ownerName || '待分配'}</strong>
      {pending && task.owner && <span className="mf-task-state">待本人接收</span>}
      {!pending && task.acceptedAt && <span className="mf-task-state" title={time(task.acceptedAt)}>已接收</span>}
    </div>
    <div className="mf-task-buttons">
      {!closed && canAssign && <button type="button" disabled={busy} aria-haspopup="dialog" onClick={() => setOpen(true)}><UserRoundPlus size={16}/>{task.owner ? pending ? '重新分配' : '转交负责人' : '分配负责人'}</button>}
      {!closed && canClaim && <button type="button" className="ms-primary" disabled={busy} onClick={() => void onAction({action:'claim'})}>{busy ? <Loader2 size={16} className="mf-action-spinner"/> : <Hand size={16}/>} {task.owner ? '接收任务' : '我来接收'}</button>}
      {readOnly && <span className="mf-task-readonly">只读</span>}
    </div>
    {error && !open && <p className="mf-action-error" role="alert">{error}</p>}
    {open && <MaterialActionDialog title="分配负责人" busy={busy} onClose={() => setOpen(false)} footer={<button type="button" className="ms-primary" disabled={busy || !ownerId} onClick={() => void assign()}>{busy ? '保存中…' : '确认分配'}</button>}>
      <label>查找员工<input autoFocus aria-label="查找负责人" placeholder="输入姓名或账号" value={search} onChange={event => setSearch(event.target.value)} disabled={busy}/></label>
      <label>负责人<select aria-label="选择负责人" value={ownerId} onChange={event => setOwnerId(event.target.value)} disabled={busy}><option value="">{candidates.length ? '请选择负责人' : '未找到匹配员工'}</option>{candidates.map(item => <option key={item.id} value={item.id}>{item.displayName || item.username} · {item.username}</option>)}</select></label>
      <label>交接说明（选填）<input maxLength={600} placeholder="例如：请跟踪客户补料，原交期保留" value={note} onChange={event => setNote(event.target.value)} disabled={busy}/></label>
      {error && <p className="mc-error" role="alert">{error}</p>}
    </MaterialActionDialog>}
  </section>;
}
