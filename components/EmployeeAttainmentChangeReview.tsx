'use client';

import { useEffect, useRef, useState } from 'react';
import type { previewEmployeeAttainmentChange } from '@/lib/employee-attainment-policy-service';
import './employee-attainment-policy.css';

type Preview = Awaited<ReturnType<typeof previewEmployeeAttainmentChange>>;
export type AttainmentChangeConfirmation = { payload: Record<string, unknown>; token: string; requestId: string };
const label = (stream: string) => stream === 'batch' ? '批量生产 · 参与达成' : stream === 'sample' ? '样品组 · 仅工时' : '不参与达成';

export default function EmployeeAttainmentChangeReview({ employeeId, payload, busy, error, onClose, onConfirm }: {
  employeeId: string; payload: Record<string, unknown>; busy: boolean; error?: string;
  onClose: () => void; onConfirm: (confirmation: AttainmentChangeConfirmation) => Promise<void>;
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loadError, setLoadError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [history, setHistory] = useState<Array<{ id: string; effectiveDate: string; reason: string }>>([]);
  const dialog = useRef<HTMLDivElement>(null);
  const requestId = useRef('');
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    return () => previous?.focus();
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setPreview(null); setLoadError(''); requestId.current = crypto.randomUUID();
    void Promise.all([
      fetch(`/api/employees/${employeeId}/attainment-policy`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: controller.signal })
        .then(async response => { const body = await response.json(); if (!response.ok) throw new Error(body.error || '预览失败'); setPreview(body.preview); }),
      fetch(`/api/employees/${employeeId}/attainment-policy`, { cache: 'no-store', signal: controller.signal }).then(async response => {
        if (response.ok) setHistory((await response.json()).changes || []);
      }),
    ]).catch(reason => { if (!controller.signal.aborted) setLoadError(reason instanceof Error ? reason.message : '预览失败'); });
    return () => controller.abort();
  }, [employeeId, payload, refresh]);
  return <div className="employee-policy-backdrop"><div className="employee-policy-dialog" role="dialog" aria-modal="true" aria-labelledby="employee-policy-title" tabIndex={-1} ref={dialog}
    onKeyDown={event => {
      if (event.key === 'Escape' && !busy) onClose();
      if (event.key === 'Tab') {
        const controls = dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input, select, textarea, a[href]');
        if (!controls?.length) return;
        const first = controls[0], last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    }}>
    <header><div><small>员工调岗与历史口径</small><h2 id="employee-policy-title">确认生效范围</h2></div><button type="button" onClick={onClose} disabled={busy} aria-label="关闭口径预览">×</button></header>
    {(loadError || error) && <p className="employee-policy-error" role="alert">{loadError || error}</p>}
    {!preview && !loadError && <p role="status">正在核对档案、考勤和其他工时…</p>}
    {preview && <>
      <div className="employee-policy-summary"><strong>{preview.employeeName} · {preview.employeeNo}</strong><p>从 <b>{preview.effectiveDate}</b> 起，{preview.after.department || '未设置部门'} / {preview.after.team || '未设置班组'}，<b>{label(preview.after.attainmentStream)}</b></p><p>{preview.reason}</p></div>
      <div className="employee-policy-counts"><span>更新考勤 <b>{preview.attendanceCount} 天</b></span><span>其中已确认 <b>{preview.confirmedCount} 天</b></span><span>保留单日口径 <b>{preview.preservedOverrideCount} 天</b></span><span>同步其他工时 <b>{preview.otherWorkCount} 条</b></span></div>
      <p>生效日前的历史记录保留原口径。出勤、加班、报工、损耗和批准时长保持原值，日、周、月按生效后的口径重新统计。</p>
      {preview.priorPolicySource && <p>生效前缺失日期的补录口径：{label(preview.priorPolicy.attainmentStream)}，取自 {preview.priorPolicySource} 已确认考勤。</p>}
      {preview.after.attainmentStream !== 'batch' && <p className="employee-policy-warning">目标口径仍不参与量产达成。调入量产人员请返回，将“统计分账”选择为“批量生产”。</p>}
      <div className="employee-policy-table"><table><thead><tr><th>工作日期</th><th>出勤</th><th>状态</th><th>原口径</th><th>本次结果</th></tr></thead><tbody>{preview.dates.map(day => <tr key={day.date}><td>{day.date}</td><td>{Number(day.attendanceHours.toFixed(2))}h</td><td>{day.status === 'confirmed' ? '已确认' : '草稿'}</td><td>{label(day.previousStream)}</td><td>{day.preserved ? '保留单日口径' : label(day.nextStream)}{day.preserved && day.reason ? <small>{day.reason}</small> : null}</td></tr>)}</tbody></table></div>
      {!preview.dates.length && <p>当前没有已生成考勤，之后补录将按对应工作日期使用生效口径。</p>}
      {!!history.length && <details><summary>已有口径变更 · {history.length} 条</summary>{history.map(change => <p key={change.id}>{change.effectiveDate.slice(0, 10)} · {change.reason}</p>)}</details>}
    </>}
    <footer><button type="button" disabled={busy} onClick={onClose}>返回修改</button><button type="button" disabled={busy} onClick={() => setRefresh(value => value + 1)}>重新核对</button><button type="button" className="employee-policy-primary" disabled={!preview || busy || Boolean(loadError)} onClick={() => preview && void onConfirm({ payload, token: preview.token, requestId: requestId.current })}>{busy ? '正在保存…' : '确认生效并保存档案'}</button></footer>
  </div></div>;
}
