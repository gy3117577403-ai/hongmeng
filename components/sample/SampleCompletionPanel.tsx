'use client';
import { useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, CheckCircle2, PackageCheck, Printer } from 'lucide-react';
import type { SampleTaskDTO } from '@/types';
import { chinaDateKey } from '@/lib/china-date';
import { SampleDialog, sampleRequest, sampleStamp } from './SampleBranchControls';
export default function SampleCompletionPanel({ task, onSaved, onTab, onCorrect }: { task: SampleTaskDTO; onSaved: (task: SampleTaskDTO) => void; onTab: (tab: 'documents' | 'warehouse') => void; onCorrect:()=>void }) {
  const [open, setOpen] = useState(false), [saving, setSaving] = useState(false), [error, setError] = useState('');
  const remaining = Math.max(0, (task.sampleQuantity || 0) - (task.completedQuantity || 0));
  const [quantity, setQuantity] = useState(String(remaining)), [workDate, setWorkDate] = useState(chinaDateKey(new Date())), [note, setNote] = useState('');
  const mutation = useRef('');
  const [confirmNoData,setConfirmNoData]=useState(false);
  const noData=task.taskType!=='REPEAT' && !task.counts.data && !task.counts.photos;
  const unknown=task.completedQuantityKnown===false;
  const closed = ['COMPLETED','CANCELLED'].includes(task.status);
  const drawingReady = !task.documentReviewRequired || task.drawingReviewStatus === 'APPROVED';
  async function save() {
    setSaving(true); setError('');
    try {
      const body = await sampleRequest(`/api/sample-tasks/${task.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'COMPLETE_PHYSICAL', confirmNoData, expectedVersion: task.version, mutationId: mutation.current, quantity: Number(quantity), workDate, note }) });
      onSaved(body.task); setOpen(false);
    } catch (e) { setError(e instanceof Error ? e.message : '完成登记失败'); } finally { setSaving(false); }
  }
  return <section className="sb-completion">
    <header className="sb-section-heading"><div><small>样品交付</small><h3>{task.taskType === 'REPEAT' ? '老产品制作进度' : '样品完成记录'}</h3></div><Link href={`/sample-print/${task.id}`} target="_blank"><Printer size={16}/>打印制作单</Link></header>
    <div className="sb-quantity"><span><small>计划数量</small><strong>{task.sampleQuantity ?? '—'}<em>件 / 套</em></strong></span><span><small>累计现场完成</small><strong>{unknown?'未记录':task.completedQuantity || 0}<em>件 / 套</em></strong></span><span><small>待完成</small><strong>{unknown?'未记录':closed?0:remaining}<em>件 / 套</em></strong></span></div>
    {!unknown && <div className="sb-progress" role="progressbar" aria-label="样品完成进度" aria-valuenow={task.completedQuantity || 0} aria-valuemin={0} aria-valuemax={task.sampleQuantity || 1}><i style={{ width: `${Math.min(100, (task.completedQuantity || 0) / (task.sampleQuantity || 1) * 100)}%` }}/></div>}
    <div className="sb-preparation-links"><button onClick={() => onTab('documents')}><CheckCircle2 size={22}/><span><strong>图纸资料审核</strong><small>{task.drawingReviewStatus === 'APPROVED' ? '已审核版本可用于制作' : '打开图纸，查看主管与品质审核'}</small></span><ArrowUpRight size={18}/></button><Link prefetch={false} href={`/workspace/warehouse?branch=samples&taskId=${task.id}`}><PackageCheck size={22}/><span><strong>仓库配料</strong><small>{task.materialStatus === 'completed' ? '已完成配料' : task.materialStatus === 'exception' ? '存在物料异常，查看跟进' : '查看配料状态与缺料跟进'}</small></span><ArrowUpRight size={18}/></Link></div>
    {!!task.parameterConflictCount && <Link className="su-parameter-note" href="/connector-parameters?view=conflicts">{task.parameterConflictCount} 项连接器参数差异待处理 · 不影响样品完成与转仓<ArrowUpRight size={15}/></Link>}
    {task.planRemark && <p className="sb-plan-note">{task.planRemark}</p>}
    <div className="sb-finish-action"><span><strong>完成后进入成品仓待入库</strong><small>备注“样品完成”，记录现场完成日期，由成品仓办理收货与发货。</small></span>{task.dataPurpose === 'PRODUCTION' && !closed && <button className="sb-primary" disabled={!drawingReady || remaining < 1} title={drawingReady ? "登记本次实际完成数量" : "请先完成主管与品质图纸审核"} onClick={() => { mutation.current = crypto.randomUUID(); setQuantity(String(remaining)); setWorkDate(chinaDateKey(new Date())); setNote(''); setConfirmNoData(false); setError(''); setOpen(true); }}><PackageCheck size={18}/>登记完成</button>}<Link href={`/workspace/finished-goods?sampleTaskId=${task.id}`}>查看成品仓<ArrowUpRight size={16}/></Link></div>
    <div className="sb-section-heading"><h3>完成与转仓记录</h3><button onClick={onCorrect}>来源与更正记录</button><small>{task.finishedGoodsCount || 0} 次</small></div>
    {task.stockSummary && <div className="spr-stock-line"><span>已转成品仓 <b>{task.stockSummary.transferred}</b></span><span>待入库 <b>{task.stockSummary.pending}</b></span><span>已入库在库 <b>{task.stockSummary.available+task.stockSummary.reserved+task.stockSummary.held+task.stockSummary.blocked}</b></span><span>已出库 <b>{task.stockSummary.shipped}</b></span></div>}
    <div className="sb-completion-records">{task.completions?.map(row => <div key={row.id}><PackageCheck size={18}/><span><strong>{row.quantity} 件 / 套 · 样品完成</strong><small>现场完成 {row.workDate} · {row.actorName} · 转仓 {sampleStamp(row.createdAt)}</small></span><em>已建立转仓记录</em></div>)}{!task.completions?.length && <p className="sb-empty-inline">{closed ? '历史任务保留原记录，没有追溯补建成品仓数量。' : '完成登记后，这里会显示每次转入成品仓的数量和日期。'}</p>}</div>
    {open && <SampleDialog title="登记样品完成" onClose={() => setOpen(false)} busy={saving}><div className="sb-dialog-body"><p>{task.specification} · 剩余 {remaining} 件 / 套</p><label>本次完成数量<input autoFocus type="number" min={1} max={remaining} step={1} value={quantity} onChange={e => setQuantity(e.target.value)} disabled={saving}/></label><label>现场完成日期<input type="date" max={chinaDateKey(new Date())} value={workDate} onChange={e => setWorkDate(e.target.value)} disabled={saving}/></label><label>补充备注（选填）<textarea value={note} maxLength={1000} onChange={e => setNote(e.target.value)} disabled={saving}/></label>{noData&&<label className="spr-check"><input type="checkbox" checked={confirmNoData} disabled={saving} onChange={e=>setConfirmNoData(e.target.checked)}/>确认本次没有需采集的资料，按实物完成登记</label>}<div className="sb-inline-note">本次 {quantity || '0'} 件 / 套将转入成品仓待入库，自动标注“样品完成”。</div>{error && <p className="sb-error" role="alert">{error}</p>}</div><footer><button disabled={saving} onClick={() => setOpen(false)}>取消</button><button className="sb-primary" disabled={saving || (noData&&!confirmNoData) || !workDate || !Number.isInteger(Number(quantity)) || Number(quantity) < 1 || Number(quantity) > remaining || workDate > chinaDateKey(new Date())} onClick={() => void save()}>{saving ? '正在登记…' : '确认完成并转成品仓'}</button></footer></SampleDialog>}
  </section>;
}


