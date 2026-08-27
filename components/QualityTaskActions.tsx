'use client';
import { useState } from 'react';
import { QualityAssigneeSelect, type QualityAssignee } from '@/components/QualityAssigneeSelect';
import type { InternalQualityRiskDTO, InternalQualityRiskTaskDTO } from '@/types';

export function QualityTaskActions({ reportId, task, canManage, canVerify, canHandle, users, onUpdated }: { reportId: string; task: InternalQualityRiskTaskDTO; canManage: boolean; canVerify: boolean; canHandle: boolean; users: QualityAssignee[]; onUpdated: (report: InternalQualityRiskDTO) => void }) {
  const [mode, setMode] = useState<'result' | 'review' | 'assign' | 'cancel' | 'reopen' | null>(null);
  const [text, setText] = useState(task.result || '');
  const [reason, setReason] = useState('');
  const [owner, setOwner] = useState(task.ownerUserId || '');
  const [due, setDue] = useState(task.dueAt?.slice(0, 10) || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function update(status?: string) {
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/quality/internal-risks/${reportId}/tasks/${task.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedVersion: task.version, ...(status ? { status } : {}), ...(mode === 'result' ? { result: text } : {}), ...(mode === 'assign' ? { ownerUserId: owner, dueAt: due } : {}), reason }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '更新失败');
      onUpdated(result.report); setMode(null); setReason('');
    } catch (e) { setError(e instanceof Error ? e.message : '操作失败'); }
    finally { setBusy(false); }
  }
  return <div className="quality-task-actions">
    <nav>{canHandle && task.status === 'TODO' && <button type="button" disabled={busy} onClick={() => void update('IN_PROGRESS')}>接单并开始处理</button>}{canHandle && task.status === 'IN_PROGRESS' && <button type="button" className="primary" onClick={() => { setText(task.result || ''); setMode('result'); }}>填写处理结果</button>}{canVerify && task.status === 'COMPLETED' && <button type="button" onClick={() => setMode('review')}>质量验证 / 退回</button>}{canManage && !task.isPrimary && task.status !== 'CANCELLED' && <button type="button" onClick={() => setMode('assign')}>改派 / 调整期限</button>}{canManage && !task.isPrimary && ['TODO', 'IN_PROGRESS', 'COMPLETED'].includes(task.status) && <button type="button" onClick={() => setMode('cancel')}>取消子任务</button>}{(canVerify && task.status === 'VERIFIED' || canManage && task.status === 'CANCELLED') && <button type="button" onClick={() => setMode('reopen')}>重新开启</button>}</nav>
    {task.reviewNote && <p><b>质量意见：</b>{task.reviewNote}</p>}
    {mode && <section><strong>{mode === 'result' ? '提交实际处理结果' : mode === 'review' ? '质量验证结论（不覆盖处理人结果）' : mode === 'cancel' ? '取消子任务（保留处理记录）' : mode === 'reopen' ? '重新开启任务（将重新验证）' : '任务交接'}</strong>{mode === 'result' ? <textarea aria-label="任务处理结果" rows={4} value={text} onChange={event => setText(event.target.value)} /> : <><label>原因 / 验证意见<textarea rows={3} value={reason} onChange={event => setReason(event.target.value)} /></label>{mode === 'assign' && <><QualityAssigneeSelect label="新处理人" value={owner} users={users} onChange={setOwner} /><label>截止日期<input type="date" value={due} onChange={event => setDue(event.target.value)} /></label></>}</>}
      <footer><button type="button" disabled={busy} onClick={() => setMode(null)}>取消</button>{mode === 'result' && <button type="button" className="primary" disabled={busy || !text.trim()} onClick={() => void update('COMPLETED')}>提交质量验证</button>}{mode === 'review' && <><button type="button" disabled={busy || !reason.trim()} onClick={() => void update('IN_PROGRESS')}>退回补充</button><button type="button" className="primary" disabled={busy || !reason.trim()} onClick={() => void update('VERIFIED')}>验证通过</button></>}{mode === 'assign' && <button type="button" className="primary" disabled={busy || !reason.trim()} onClick={() => void update()}>确认交接</button>}{mode === 'cancel' && <button type="button" disabled={busy || !reason.trim()} onClick={() => void update('CANCELLED')}>确认取消任务</button>}{mode === 'reopen' && <button type="button" disabled={busy || !reason.trim()} onClick={() => void update(task.status === 'CANCELLED' ? 'TODO' : 'IN_PROGRESS')}>确认重新开启</button>}</footer></section>}
    {error && <p className="risk-form-error" role="alert">{error}</p>}
  </div>;
}
