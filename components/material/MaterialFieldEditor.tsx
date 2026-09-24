'use client';

import { useState } from 'react';
import type { MaterialFollowUpTaskDTO } from '@/types';
import MaterialActionDialog from './MaterialActionDialog';

export type MaterialEditMode = 'eta' | 'arrival' | 'source';
export default function MaterialFieldEditor({ mode, task, busy, error, onSave, onClose, onRefresh }: {
  mode: MaterialEditMode; task: MaterialFollowUpTaskDTO; busy: boolean; error: string;
  onSave: (body: Record<string, unknown>) => Promise<boolean>; onClose: () => void; onRefresh: () => void;
}) {
  const [date, setDate] = useState(task.expectedAt?.slice(0, 10) || '');
  const [source, setSource] = useState(task.exceptionCase.supplySource || 'UNKNOWN');
  const [quantity, setQuantity] = useState(String(task.exceptionCase.receivedQuantity || 0));
  const [status, setStatus] = useState(task.status === 'WAITING_ARRIVAL' ? 'WAITING_ARRIVAL' : 'IN_PROGRESS');
  const [complete, setComplete] = useState(false);
  const [note, setNote] = useState('');
  const required = task.exceptionCase.shortageQuantity;
  const amount = quantity.trim() ? Number(quantity) : NaN;
  const validQuantity = Number.isFinite(amount) && amount >= 0 && (required == null || amount <= required);
  const title = mode === 'eta' ? '调整到料交期' : mode === 'arrival' ? '登记到料' : '修改物料来源';
  const invalid = mode === 'source' ? source === 'UNKNOWN' || source === task.exceptionCase.supplySource
    : mode === 'arrival' ? !validQuantity || (complete && required != null && amount < required)
    : status === 'WAITING_ARRIVAL' && !date;

  async function save() {
    const state = mode === 'eta' ? status : complete ? 'WAITING_WAREHOUSE' : task.expectedAt ? 'WAITING_ARRIVAL' : 'IN_PROGRESS';
    const description = mode === 'eta' ? `调整预计到料：${date || '待确认'}` : `登记累计到料 ${quantity} ${task.exceptionCase.unit || '个'}${complete ? '，提交仓库核实' : ''}`;
    const body = mode === 'source' ? { action: 'classify', supplySource: source }
      : { action: 'update', ownerId: task.owner?.id, status: state,
        expectedAt: mode === 'eta' ? date : task.expectedAt?.slice(0, 10) || '',
        ...(mode === 'arrival' ? { receivedQuantity: quantity } : {}),
        note: note.trim() ? `${description}；${note.trim()}` : description };
    if (await onSave(body)) onClose();
  }

  return <MaterialActionDialog title={title} busy={busy} onClose={onClose} footer={<button className="ms-primary" disabled={busy || invalid} onClick={() => void save()}>{busy ? '保存中…' : '确认保存'}</button>}>
    <p className="mc-dialog-context">{task.exceptionCase.materialModel || task.exceptionCase.exceptionNote}</p>
    {mode === 'source' ? <label>物料来源<select aria-label="修改物料来源" value={source} disabled={busy} onChange={event => setSource(event.target.value as typeof source)}><option value="UNKNOWN">来源待确认</option><option value="PURCHASED">采购物料</option><option value="CUSTOMER">客供物料</option></select></label> : <>
      {mode === 'eta' ? <><label>预计到料日期<input aria-label="预计到料日期" type="date" value={date} disabled={busy} onChange={event => setDate(event.target.value)}/></label><label>跟进状态<select aria-label="跟进状态" value={status} disabled={busy} onChange={event => setStatus(event.target.value)}><option value="IN_PROGRESS">跟进中</option><option value="WAITING_ARRIVAL">等待到料</option></select></label></> : <>
        <div className="mc-arrival-summary"><span>缺料数量 <b>{required ?? '待确认'}</b></span><span>原已到 <b>{task.exceptionCase.receivedQuantity || 0}</b></span><span>本次登记后待到 <b>{required == null || !validQuantity ? '待确认' : Number((required - amount).toFixed(3))}</b></span></div>
        <label>累计已到数量（{task.exceptionCase.unit || '个'}）<input autoFocus aria-label="累计已到数量" type="number" min="0" step="0.001" value={quantity} disabled={busy} onChange={event => { setQuantity(event.target.value); setComplete(false); }}/></label>
        <label className="mc-check"><input type="checkbox" checked={complete} disabled={busy || !validQuantity || (required != null && amount < required)} onChange={event => setComplete(event.target.checked)}/>全部到齐，提交仓库核实</label>
      </>}
      <label>补充说明（选填）<textarea aria-label="处理说明" maxLength={400} rows={3} value={note} disabled={busy} onChange={event => setNote(event.target.value)}/></label>
    </>}
    {error && <div className="mc-error" role="alert">{error}<button disabled={busy} onClick={onRefresh}>刷新数据</button></div>}
  </MaterialActionDialog>;
}
