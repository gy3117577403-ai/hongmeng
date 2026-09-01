'use client';
import '@/app/production-control.css';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { PRODUCTION_REASON_LABELS, type ProductionControlView } from '@/lib/production-control';
import type { ProcessCompletionContext } from '@/lib/process-completion-service';

export type ProductionControlMode = 'note' | 'pause' | 'resume' | 'adjust_date' | 'history' | 'backfill';
type Control = ProductionControlView & {
  workOrderId: string; code: string; permissions: { manage: boolean; adjustDates: boolean }; planVersion: number | null;
  affectedOrders: Array<{ id: string; code: string; stage: string }>;
  customerDateImpact: { orderNo: string; batchCount: number } | null;
  routes: Array<{ id: string; version: number; workOrder: { code: string }; steps: Array<{ id: string; processName: string; status: string }> }>;
  events: Array<{ id: string; action: string; reason: string | null; actor: string; at: string; before: Record<string, unknown>; after: Record<string, unknown> }>;
};
const labels: Record<ProductionControlMode, string> = { note: '问题备注', pause: '暂停生产', resume: '恢复生产', adjust_date: '调整交期', history: '变更历史', backfill: '补录暂停前工作' };
function datetime(value?: string | null): string { return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '未设置'; }
function localInput(value?: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function ProductionNoteSummary({ control }: { control?: ProductionControlView | null }) {
  const note = control?.note;
  const pause = control?.pause;
  if (!note && !pause) return <span className="production-note-empty">添加 / 查看备注</span>;
  return <span className="production-note-summary">
    {pause && <><b className="production-pause-badge">已暂停 · {PRODUCTION_REASON_LABELS[pause.category]}</b><strong>{pause.reason}</strong>
      <small>{pause.owner ? `跟进：${pause.owner} · ` : ''}暂停 {Math.max(0, Math.floor((Date.now() - new Date(control!.pausedAt!).getTime()) / 3_600_000))} 小时</small>
      <small>{pause.expectedResumeAt ? `预计恢复 ${datetime(pause.expectedResumeAt)}` : `下次跟进 ${datetime(pause.followUpAt)}`}</small></>}
    {note && <><strong>{pause ? '备注：' : `${PRODUCTION_REASON_LABELS[note.category]}：`}{note.text}</strong><small>{note.owner ? `跟进：${note.owner} · ` : ''}{note.updatedBy}</small>{note.followUpAt && <small>跟进 {datetime(note.followUpAt)}</small>}</>}
  </span>;
}

export function ProductionControlButton({ workOrderId, mode = 'note', children, className, onSaved, wipAllocationId, restrictExecutionActions = false }: {
  workOrderId: string; mode?: ProductionControlMode; children?: ReactNode; className?: string; onSaved?: () => void;
  wipAllocationId?: string | null; restrictExecutionActions?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return <><button ref={trigger} type="button" className={className || 'production-control-link'} onClick={() => setOpen(true)}>{children || labels[mode]}</button>
    {open && <ProductionControlDialog workOrderId={workOrderId} initialMode={mode} wipAllocationId={wipAllocationId} restrictExecutionActions={restrictExecutionActions} close={() => { setOpen(false); trigger.current?.focus(); }} saved={() => {
      onSaved?.(); window.dispatchEvent(new Event('production-control-updated'));
    }} />}</>;
}

function ProductionControlDialog({ workOrderId, initialMode, wipAllocationId, restrictExecutionActions, close, saved }: { workOrderId: string; initialMode: ProductionControlMode; wipAllocationId?: string | null; restrictExecutionActions: boolean; close: () => void; saved: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [control, setControl] = useState<Control | null>(null);
  const [mode, setMode] = useState(initialMode);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [body, setBody] = useState({ text: '', reason: '', category: 'other', owner: '', followUpAt: '', expectedResumeAt: '', dateKind: 'estimated', date: '', confirmation: '', confirmImpact: false });
  const [routeId, setRouteId] = useState('');
  const [stepId, setStepId] = useState('');
  const [context, setContext] = useState<ProcessCompletionContext | null>(null);
  const [backfill, setBackfill] = useState({ workStartedAt: '', workEndedAt: '', processedQty: '', reportedUnitQty: '', defectQty: '', reportedDefectUnitQty: '', defectDisposition: 'quality_pending', employeeIds: [] as string[] });
  const [contextLoading, setContextLoading] = useState(false);
  const requestId = useRef<string | null>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => { requestId.current = null; }, [body, backfill, routeId, stepId]);
  useEffect(() => {
    const abort = new AbortController();
    fetch(`/api/work-orders/${encodeURIComponent(workOrderId)}/production-control`, { cache: 'no-store', signal: abort.signal })
      .then(response => response.json()).then(data => {
        if (!data.ok) throw new Error(data.error || '加载失败');
        const next = data.control as Control; setControl(next);
        setBody(current => ({ ...current, text: next.note?.text || '', category: next.note?.category || 'other', owner: next.note?.owner || '', followUpAt: localInput(next.note?.followUpAt), date: next.estimatedCompletionDate || '' }));
        setRouteId(next.routes[0]?.id || '');
        setStepId(next.routes[0]?.steps.find(step => step.status === 'current')?.id || next.routes[0]?.steps[0]?.id || '');
      }).catch(cause => { if (!abort.signal.aborted) setError(String(cause.message || cause)); });
    return () => abort.abort();
  }, [workOrderId]);
  useEffect(() => {
    if (mode !== 'backfill' || !routeId || !stepId) return;
    const abort = new AbortController(); setContext(null); setContextLoading(true); setError('');
    fetch(`/api/process-management/routes/${encodeURIComponent(routeId)}/completions?stepId=${encodeURIComponent(stepId)}`, { cache: 'no-store', signal: abort.signal })
      .then(response => response.json()).then(data => { if (!data.ok) throw new Error(data.error); setContext(data.data); })
      .catch(cause => { if (!abort.signal.aborted) setError(String(cause.message || cause)); })
      .finally(() => { if (!abort.signal.aborted) setContextLoading(false); });
    return () => abort.abort();
  }, [mode, routeId, stepId]);
  function changeMode(next: ProductionControlMode) {
    if (saving || (restrictExecutionActions && ['pause', 'resume', 'backfill'].includes(next))) return;
    setMode(next); setError(''); requestId.current = null; setBody(current => ({ ...current, reason: '', confirmImpact: false }));
  }
  async function save() {
    if (!control) return;
    setSaving(true); setError('');
    requestId.current ||= crypto.randomUUID();
    try {
      let payload: Record<string, unknown> = { ...body, action: mode, expectedVersion: control.version, expectedPlanVersion: control.planVersion, requestId: requestId.current,
        wipAllocationId: wipAllocationId || undefined,
        followUpAt: body.followUpAt ? new Date(body.followUpAt).toISOString() : null, expectedResumeAt: body.expectedResumeAt ? new Date(body.expectedResumeAt).toISOString() : null };
      if (mode === 'backfill') {
        if (!context || !backfill.workStartedAt || !backfill.workEndedAt) throw new Error('请先选择工序并填写实际作业起止时间');
        payload = { ...backfill, workStartedAt: new Date(backfill.workStartedAt).toISOString(), workEndedAt: new Date(backfill.workEndedAt).toISOString(),
          routeId, stepId, expectedRouteVersion: context.routeVersion, processedQty: Number(backfill.processedQty),
          reportedUnitQty: Number(backfill.reportedUnitQty || backfill.processedQty), defectQty: Number(backfill.defectQty || 0),
          reportedDefectUnitQty: Number(backfill.reportedDefectUnitQty || backfill.defectQty || 0), defectDisposition: backfill.defectDisposition,
          obligationId: context.step.supplementObligation?.id, expectedObligationVersion: context.step.supplementObligation?.version,
          reason: body.reason, expectedPauseAt: control.pausedAt, confirmHistoricalWork: body.confirmImpact, idempotencyKey: requestId.current };
      }
      const response = await fetch(`/api/work-orders/${encodeURIComponent(workOrderId)}/production-control${mode === 'backfill' ? '/backfill' : ''}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) { requestId.current = null; throw new Error(data.error || '保存失败'); }
      saved(); close();
    } catch (cause) { setError(cause instanceof Error ? cause.message : '保存失败，请重试'); }
    finally { setSaving(false); }
  }
  const canEdit = control
    && (mode === 'adjust_date' ? control.permissions.adjustDates : control.permissions.manage)
    && mode !== 'history'
    && !(restrictExecutionActions && ['pause', 'resume', 'backfill'].includes(mode));
  return <dialog ref={dialog} className="production-control-dialog" onCancel={event => { event.preventDefault(); if (!saving) close(); }} aria-label={labels[mode]}>
    <header><div><small>生产跟进 / {control?.code || '加载中'}</small><h2>{labels[mode]}</h2></div><button type="button" disabled={saving} onClick={close} aria-label="关闭生产控制">×</button></header>
    {control && <><nav aria-label="生产控制操作">
      <button type="button" className={mode === 'note' ? 'active' : ''} onClick={() => changeMode('note')}>问题备注</button>
      {control.permissions.manage && !restrictExecutionActions && <button type="button" onClick={() => changeMode(control.pausedAt ? 'resume' : 'pause')}>{control.pausedAt ? '恢复生产' : '暂停生产'}</button>}
      {control.permissions.adjustDates && <button type="button" onClick={() => changeMode('adjust_date')}>调整交期</button>}
      {control.pausedAt && control.permissions.manage && !restrictExecutionActions && <button type="button" onClick={() => changeMode('backfill')}>补录暂停前工作</button>}
      <button type="button" onClick={() => changeMode('history')}>历史记录</button>
    </nav><fieldset disabled={saving} className="production-control-body">
      {control.pausedAt && <p className="production-control-warning">已暂停：{control.pause?.reason} · {datetime(control.pausedAt)}。预计恢复日期不会自动复工。</p>}
      {mode === 'note' && <><label>当前问题说明<textarea value={body.text} maxLength={500} rows={3} disabled={!canEdit} onChange={event => setBody({ ...body, text: event.target.value })} placeholder="说明当前问题；清空保存可移入历史" /></label><p>不会被报工或工序推进覆盖；填写备注不会自动暂停生产。</p></>}
      {(mode === 'note' || mode === 'pause') && <div className="production-control-fields"><label>原因分类<select value={body.category} disabled={!canEdit} onChange={event => setBody({ ...body, category: event.target.value })}>{Object.entries(PRODUCTION_REASON_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>跟进人<input value={body.owner} maxLength={120} disabled={!canEdit} onChange={event => setBody({ ...body, owner: event.target.value })} /></label><label>下次跟进时间<input type="datetime-local" value={body.followUpAt} onInput={event => { const value = event.currentTarget.value; setBody(current => ({ ...current, followUpAt: value })); }} disabled={!canEdit} onChange={event => setBody({ ...body, followUpAt: event.target.value })} /></label></div>}
      {mode === 'pause' && <><label>预计恢复时间（未知可留空）<input type="datetime-local" value={body.expectedResumeAt} onInput={event => { const value = event.currentTarget.value; setBody(current => ({ ...current, expectedResumeAt: value })); }} onChange={event => setBody({ ...body, expectedResumeAt: event.target.value })} /></label><p>保留数量、工时和当前工序。暂停本批次及关联未完成分支，停止新报工、开工和排人；未来安排需在恢复后重新确认。</p><p>影响工单：{control.affectedOrders.map(order => order.code).join('、')}</p></>}
      {mode === 'resume' && <p className="production-control-warning">将继续原工单和原工序，不自动恢复过期安排。恢复后请重新确认日期与人员；质量待判等独立限制仍有效。交期需另行调整。</p>}
      {mode === 'adjust_date' && <><div className="production-control-fields"><label>调整项目<select value={body.dateKind} onChange={event => setBody({ ...body, dateKind: event.target.value, date: (event.target.value === 'customer' ? control.customerDueDate : control.estimatedCompletionDate) || '', confirmImpact: false })}><option value="estimated">内部预计完成日</option><option value="customer">客户交期</option></select></label><label>新日期<input type="date" value={body.date} onInput={event => { const value = event.currentTarget.value; setBody(current => ({ ...current, date: value })); }} onChange={event => setBody({ ...body, date: event.target.value })} /></label></div><p>当前客户交期：{control.customerDueDate || '待确认'}；内部预计完成：{control.estimatedCompletionDate || '未设置'}</p><p>{control.dateBaselineSource === 'upgrade' ? '升级时基准' : '原始基准'}：客户 {control.deliveryBaselineDate || '未设置'} / 计划 {control.planBaselineDate || '未设置'}。已调整 {control.adjustmentCount} 次。</p>
        {body.dateKind === 'customer' ? <><label>客户确认说明<textarea value={body.confirmation} maxLength={500} onChange={event => setBody({ ...body, confirmation: event.target.value })} /></label><p>影响订单：{control.customerDateImpact?.orderNo || control.code}，关联 {control.customerDateImpact?.batchCount || 1} 个批次；已完成记录不改写。</p></> : <p>只调整当前批次的预计日期，原计划周和历史达成基准不变。</p>}</>}
      {mode === 'backfill' && <><p>仅补录暂停前已实际完成的工作，并记录操作者及原因；不会恢复工单。不良数量按原有返工、报废补产或品质待判规则处理；新分支同样受本次暂停限制。</p><div className="production-control-fields"><label>工单路线<select value={routeId} onChange={event => { setRouteId(event.target.value); setStepId(control.routes.find(route => route.id === event.target.value)?.steps[0]?.id || ''); }}>{control.routes.map(route => <option key={route.id} value={route.id}>{route.workOrder.code}</option>)}</select></label><label>工序<select value={stepId} onChange={event => setStepId(event.target.value)}>{control.routes.find(route => route.id === routeId)?.steps.map(step => <option key={step.id} value={step.id}>{step.processName}</option>)}</select></label><label>实际开始<input type="datetime-local" value={backfill.workStartedAt} onInput={event => { const value = event.currentTarget.value; setBackfill(current => ({ ...current, workStartedAt: value })); }} onChange={event => setBackfill({ ...backfill, workStartedAt: event.target.value })} /></label><label>实际结束<input type="datetime-local" value={backfill.workEndedAt} onInput={event => { const value = event.currentTarget.value; setBackfill(current => ({ ...current, workEndedAt: value })); }} onChange={event => setBackfill({ ...backfill, workEndedAt: event.target.value })} /></label><label>完成整套数量<input type="number" min="0" value={backfill.processedQty} onChange={event => setBackfill({ ...backfill, processedQty: event.target.value })} /></label><label>实际动作数量（适用时）<input type="number" min="0" value={backfill.reportedUnitQty} onChange={event => setBackfill({ ...backfill, reportedUnitQty: event.target.value })} /></label>
      <label>不良整套数量<input type="number" min="0" value={backfill.defectQty} onChange={event => setBackfill({ ...backfill, defectQty: event.target.value })} /></label>
      <label>不良动作数量（适用时）<input type="number" min="0" value={backfill.reportedDefectUnitQty} onChange={event => setBackfill({ ...backfill, reportedDefectUnitQty: event.target.value })} /></label>
      <label>不良处理<select value={backfill.defectDisposition} onChange={event => setBackfill({ ...backfill, defectDisposition: event.target.value })}><option value="quality_pending">品质待判</option><option value="rework">返工</option><option value="scrap_replenish">报废补产</option></select></label>
      </div><fieldset><legend>实际作业人员</legend>{contextLoading ? <p>正在加载工序与人员…</p> : context?.employees.map(employee => <label className="production-control-check" key={employee.id}><input type="checkbox" checked={backfill.employeeIds.includes(employee.id)} onChange={event => setBackfill({ ...backfill, employeeIds: event.target.checked ? [...backfill.employeeIds, employee.id] : backfill.employeeIds.filter(id => id !== employee.id) })} />{employee.employeeNo} · {employee.name}</label>)}</fieldset></>}
      {!['note', 'history'].includes(mode) && <label>{mode === 'pause' ? '暂停原因' : mode === 'resume' ? '恢复原因 / 处理结果' : '变更 / 补录原因'}<textarea value={body.reason} maxLength={500} rows={3} onChange={event => setBody({ ...body, reason: event.target.value })} /></label>}
      {(mode === 'pause' || mode === 'resume' || mode === 'backfill' || (mode === 'adjust_date' && body.dateKind === 'customer')) && <label className="production-control-check"><input type="checkbox" checked={body.confirmImpact} onChange={event => setBody({ ...body, confirmImpact: event.target.checked })} />{mode === 'backfill' ? '我确认以上工作在本次暂停前已实际完成，起止时间和人员真实' : mode === 'resume' ? '我已确认问题处理结果，恢复后重新确认日期人员，不绕过质量限制' : '我已核对本次操作及受影响工单 / 批次'}</label>}
      {mode === 'history' && <div className="production-control-history">{control.events.map(event => <article key={event.id}><strong>{labels[event.action as ProductionControlMode] || (event.action === 'backfill_before_pause' ? '暂停前工作补录' : event.action)}</strong><small>{event.actor} · {datetime(event.at)}</small><p>{event.reason || (event.action === 'note' ? '更新 / 清除当前问题备注' : '')}</p><dl><dt>客户交期</dt><dd>{String(event.before.customerDueDate || '—')} → {String(event.after.customerDueDate || '—')}</dd><dt>内部预计完成</dt><dd>{String(event.before.estimatedCompletionDate || '—')} → {String(event.after.estimatedCompletionDate || '—')}</dd></dl>{event.action === 'note' && <p>{String((event.after.note as { text?: string } | null)?.text || '已清除当前说明，历史保留')}</p>}</article>)}{!control.events.length && <p>暂无变更记录</p>}</div>}
    </fieldset></>}
    {error && <p role="alert" className="production-control-error">{error}</p>}
    <footer><button type="button" disabled={saving} onClick={close}>关闭</button>{canEdit && <button className="primary-button" type="button" disabled={saving || contextLoading} onClick={() => void save()}>{saving ? '保存中…' : mode === 'note' ? '保存备注' : `确认${labels[mode]}`}</button>}</footer>
  </dialog>;
}
