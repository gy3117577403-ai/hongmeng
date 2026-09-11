'use client';
import { CalendarDays, Clock3, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { chinaDateKey } from '@/lib/china-date';
import { sampleWarning } from '@/lib/sample-plan-view';
import type { SampleTaskDTO } from '@/types';

export default function SampleSchedulePanel({ task, editable, onSaved }: { task: SampleTaskDTO; editable: boolean; onSaved: (task: SampleTaskDTO) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [due, setDue] = useState('');
  const [issued, setIssued] = useState('');
  const [days, setDays] = useState('2');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [expectedVersion, setExpectedVersion] = useState(task.version);
  const warning = sampleWarning(task);
  function open() { setExpectedVersion(task.version); setDue(task.dueDate || ''); setIssued(task.issuedDate || ''); setDays(String(task.warningDays ?? 2)); setReason(''); setError(''); dialog.current?.showModal(); }
  async function save(event: React.FormEvent) {
    event.preventDefault(); setSaving(true); setError('');
    try {
      const response = await fetch(`/api/sample-tasks/${task.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'SCHEDULE', expectedVersion, dueDate: due, issuedDate: issued, warningDays: Number(days), scheduleReason: reason }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || '交期调整失败');
      onSaved(body.task); dialog.current?.close();
    } catch (error) { setError(error instanceof Error ? error.message : '交期调整失败'); } finally { setSaving(false); }
  }
  return <section className="sample-schedule-panel">
    <div className="sample-schedule-facts">
      <div><small><CalendarDays size={14} />计划下达日期</small><strong>{task.issuedDate || '未记录'}</strong><span>{task.issuedDate ? '按计划下达日期' : `历史任务 · 录入 ${chinaDateKey(new Date(task.createdAt))}`}</span></div>
      <div className="ship"><small><CalendarDays size={14} />计划出货日期</small><strong>{task.dueDate || '未设置'}</strong><span>交期变更后同步更新预警</span></div>
      <div><small><Clock3 size={14} />提前预警</small><strong>{task.warningDays ?? 2} 天</strong>{editable && <button type="button" onClick={open}>调整交期与预警</button>}</div>
    </div>
    <div className={`sample-schedule-warning warning-${warning.kind.toLowerCase()}`}><Clock3 size={17} /><strong>{warning.label}</strong><span>{warning.kind === 'SOON' ? '已进入出货预警期' : warning.kind === 'MISSING' ? '设置出货日期后自动计算预警' : warning.kind === 'NONE' ? '已退出交期预警' : '按自然日计算'}</span></div>
    {!!task.scheduleHistory?.length && <details className="sample-schedule-history"><summary>交期调整记录 · {task.scheduleHistory.length} 次</summary>{[...task.scheduleHistory].reverse().map((change, index) => <article key={`${change.at}-${index}`}><strong>{change.fromDue || '未设置'} → {change.toDue || '未设置'} · 提前 {change.toWarning} 天预警</strong><p>{change.reason}</p>{change.fromIssued !== change.toIssued && <p>下达日期：{change.fromIssued || '未记录'} → {change.toIssued || '未记录'}</p>}<small>{change.actor} · {new Date(change.at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</small></article>)}</details>}
    <dialog className="sample-schedule-dialog" ref={dialog} onCancel={event => { if (saving) event.preventDefault(); }}>
      <form onSubmit={save}><header><div><small>{task.specification}</small><h2>调整交期与预警</h2></div><button type="button" aria-label="关闭交期调整" disabled={saving} onClick={() => dialog.current?.close()}><X /></button></header>
        <label>计划下达日期<input type="date" aria-label="计划下达日期" value={issued} onChange={event => setIssued(event.target.value)} /></label>
        <label>计划出货日期<input type="date" aria-label="新的计划出货日期" required min={issued || undefined} value={due} onChange={event => setDue(event.target.value)} /></label>
        <label>提前预警天数<input type="number" aria-label="提前预警天数" required min="0" max="30" step="1" value={days} onChange={event => setDays(event.target.value)} /></label>
        <label>调整原因<textarea aria-label="调整原因" required maxLength={500} value={reason} onChange={event => setReason(event.target.value)} placeholder="例如：客户调整出货时间" /></label>
        {error && <p role="alert" className="sample-team-error">{error}</p>}
        <footer><button type="button" disabled={saving} onClick={() => dialog.current?.close()}>取消</button><button type="submit" className="primary" disabled={saving}>{saving ? '保存中…' : '保存调整'}</button></footer>
      </form>
    </dialog>
  </section>;
}
