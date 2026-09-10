'use client';
/* eslint-disable @next/next/no-img-element */
import { Check, ChevronDown, PencilLine } from 'lucide-react';
import { actions, dateTime, duration, hours, states, type Context, type Photo, type Row } from './model';

export function OtherHoursDetail({ row, context, busy, approvedMinutes, setApprovedMinutes, onAction, onEdit, onCopy, onPreview, allowCopy }: {
  row: Row; context: Context | null; busy: boolean; approvedMinutes: number; setApprovedMinutes: (minutes: number) => void;
  onAction: (action: string) => void; onEdit: () => void; onCopy: () => void; onPreview: (photo: Photo) => void; allowCopy: boolean;
}) {
  return <>
    <header className="oh-detail-header"><div className="oh-detail-meta"><span>{row.workDate}</span><span className={'oh-status status-' + row.status}>{states[row.status]}</span></div>
      <h2>{row.categoryNameSnapshot}</h2><div className="oh-person"><span className="oh-avatar">{row.employeeNameSnapshot.slice(-1)}</span><strong>{row.employeeNameSnapshot}</strong><span>{row.employeeNoSnapshot} · {row.teamSnapshot || '未分组'}</span></div></header>
    <div className="oh-readonly"><dl className="oh-facts"><div><dt>申报时长</dt><dd>{duration(row.requestedMinutes)}</dd></div><div><dt>{row.status === 'APPROVED' ? '批准时长' : '工作日期'}</dt>
      <dd>{row.status === 'APPROVED' ? duration(row.approvedMinutes || 0) : row.workDate}</dd></div></dl>
      <span className="oh-section-label">工作说明</span><p className="oh-description">{row.description || '尚未填写，继续编辑后提交。'}</p>
      {!!row.attachments.length && <div className="oh-photos">{row.attachments.map(photo => <div key={photo.id}><button type="button" onClick={() => onPreview(photo)} aria-label={'预览照片 ' + photo.originalName}>
        <img src={photo.url} alt={photo.originalName} /></button></div>)}</div>}
      {row.startedAt && <p className="oh-secondary">时段：{dateTime(row.startedAt)} 至 {row.endedAt ? dateTime(row.endedAt) : '未填写'}</p>}
      {row.backfillReason && <p className="oh-secondary">补报原因：{row.backfillReason}</p>}
      {(row.arranger || row.sampleReference) && <details className="oh-historical"><summary>历史补充信息</summary>{row.arranger && <p>安排人：{row.arranger}</p>}{row.sampleReference && <p>样品追溯：{row.sampleReference}</p>}</details>}
      {row.status === 'REJECTED' && <div className="oh-rejection"><strong>退回原因</strong><p>{[...row.reviews].reverse().find(r => r.action === 'REJECT')?.reason || '请查看处理轨迹。'}</p></div>}
      {context && row.permissions.review && <div className="oh-review-context"><div><span>当日出勤<b>{hours(context.attendanceMilliseconds / 60000)}</b></span><span>确认损耗<b>{hours(context.confirmedLossMilliseconds / 60000)}</b></span></div>
        {context.attendanceStatus !== 'confirmed' && <p>当日考勤待完善</p>}
        <details><summary>展开审批核对<ChevronDown size={14} /></summary><p>{context.reviewHint}</p>
          {context.other.map(o => <p key={o.id}>同日：{o.categoryNameSnapshot} · {states[o.status]} · {hours(o.approvedMinutes ?? o.requestedMinutes)}</p>)}
          {context.executions.map((e, i) => <p key={i}>生产时段：{dateTime(e.startedAt)} 至 {dateTime(e.endedAt)}</p>)}
          {context.completions?.map(c => <p key={c.id}>扫码时段：{dateTime(c.workStartedAt)} 至 {dateTime(c.workEndedAt)}</p>)}</details></div>}
      {context?.reviewerAvailable === false && row.status === 'PENDING' && <p className="oh-field-error" role="status">当前没有可审批此申报的有效账号，请联系管理员配置组长或主管。</p>}
      <div className="oh-receipt">{row.reviewedAt ? <><span className="oh-receipt-dot" />{row.reviewedByName} · {dateTime(row.reviewedAt)}</> : row.status === 'PENDING' ? '已提交，等待审批' : '保留填写内容，继续编辑即可提交。'}</div>
      {row.correctionRequestedAt && <p className="oh-secondary">已申请更正：{row.correctionReason}</p>}
    </div>
    {row.permissions.review ? <footer className="oh-decision"><label>批准时长<span><input type="number" aria-label="批准时长，分钟" min="1" max={row.requestedMinutes} step="1" value={approvedMinutes || ''}
      disabled={busy} onChange={e => setApprovedMinutes(Number(e.target.value))} />分钟</span></label><div className="oh-actions"><button type="button" disabled={busy} onClick={() => onAction('REJECT')}>退回</button>
      <button type="button" disabled={busy} className="primary" onClick={() => onAction('APPROVE')}><Check size={17} />通过 · {duration(approvedMinutes)}</button></div></footer> :
      <footer className="oh-record-actions">
        {row.status === 'APPROVED' && <span className="oh-secondary">已计入 {row.workDate} 的其他工时</span>}
        {row.permissions.edit && <button type="button" className="primary" disabled={busy} onClick={onEdit}><PencilLine size={16} />{row.status === 'DRAFT' ? '继续填写' : '修改后重新提交'}</button>}
        {row.permissions.withdraw && <button type="button" disabled={busy} onClick={() => onAction('WITHDRAW')}>撤回并修改</button>}
        {row.status === 'VOIDED' && allowCopy && <button type="button" disabled={busy} onClick={onCopy}>复制为更正申报</button>}
        {(row.permissions.void || row.permissions.requestCorrection) && <details className="oh-more-actions"><summary>更多操作<ChevronDown size={14} /></summary><div>
          {row.permissions.requestCorrection && <button type="button" disabled={busy} onClick={() => onAction('CORRECTION_REQUEST')}>申请更正</button>}
          {row.permissions.void && <button type="button" className="danger" disabled={busy} onClick={() => onAction('VOID')}>作废申报</button>}</div></details>}
      </footer>}
    <details className="oh-audit"><summary>处理轨迹 · {row.reviews.length} 条</summary>{row.reviews.map(r => <article key={r.id}><b>{actions[r.action] || r.action}</b><span>{r.actor.displayName || r.actor.username} · {dateTime(r.createdAt)}</span>{r.reason && <p>{r.reason}</p>}</article>)}</details>
  </>;
}
