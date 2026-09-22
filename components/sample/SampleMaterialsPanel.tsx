'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, CheckCircle2, Loader2, PackageCheck, Plus, Save, Trash2 } from 'lucide-react';
import type { CurrentUserDTO, SampleTaskDTO, WarehouseMaterialTaskDTO, WarehouseMaterialExceptionCaseDTO } from '@/types';
import type { SampleMaterialLine } from '@/lib/sample-plan-domain';
import { SampleDialog, sampleRequest, sampleStamp } from './SampleBranchControls';
const sourceName = { PURCHASED: '采购物料', CUSTOMER: '客供物料', UNKNOWN: '待确认来源' };
export default function SampleMaterialsPanel({ task, user, onChanged }: { task: SampleTaskDTO; user: CurrentUserDTO; onChanged: () => void }) {
  const [record, setRecord] = useState<WarehouseMaterialTaskDTO | null>(null), [rows, setRows] = useState<SampleMaterialLine[]>([]);
  const [loading, setLoading] = useState(true), [saving, setSaving] = useState(false), [error, setError] = useState(''), [toast, setToast] = useState('');
  const [dirty, setDirty] = useState(false), [dialog, setDialog] = useState<'shortage' | 'confirm' | 'resolve' | null>(null);
  const [target, setTarget] = useState<WarehouseMaterialExceptionCaseDTO | null>(null), [reason, setReason] = useState('');
  const [shortage, setShortage] = useState({ materialModel: '', supplySource: 'PURCHASED', shortageQuantity: '1', unit: '个' });
  const canConfirm = user.access.capabilities.includes('WAREHOUSE:UPDATE'), closed = ['COMPLETED','CANCELLED'].includes(task.status);
  const canReport = canConfirm || user.access.capabilities.includes('PROCUREMENT:UPDATE');
  function apply(value: WarehouseMaterialTaskDTO) { setRecord(value); setRows(value.requirements || []); setDirty(false); }
  useEffect(() => {
    const controller = new AbortController(); setLoading(true);
    sampleRequest(`/api/sample-tasks/${task.id}/materials`, { signal: controller.signal }).then(body => { if (body.task) apply(body.task); else setRecord(null); }).catch(e => { if (e.name !== 'AbortError') setError(e.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [task.id]);
  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(''), 3500); return () => clearTimeout(id); }, [toast]);
  function edit(id: string, value: Partial<SampleMaterialLine>) { setRows(list => list.map(row => row.id === id ? { ...row, ...value } : row)); setDirty(true); }
  async function save(confirm = false) {
    if (!record) return; setSaving(true); setError('');
    try {
      const body = await sampleRequest(`/api/sample-tasks/${task.id}/materials`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version: record.version, requirements: rows, confirm, noMaterials: confirm && rows.length === 0 }) });
      apply(body.task); setDialog(null); setToast(confirm ? '样品配料已确认' : '配料清单已保存'); onChanged();
    } catch (e) { setError(e instanceof Error ? e.message : '保存失败'); } finally { setSaving(false); }
  }
  async function exception() {
    if (!record) return; setSaving(true); setError('');
    try {
      const input = dialog === 'resolve' ? { action: 'resolve', exceptionId: target?.id, resolution: 'pending', note: reason } : { action: 'report_exception', exceptionType: 'shortage', ...shortage, shortageQuantity: Number(shortage.shortageQuantity), exceptionNote: reason };
      const body = await sampleRequest(`/api/warehouse/material-tasks/${record.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...input, version: record.version }) });
      apply(body.task); setDialog(null); setToast(dialog === 'resolve' ? '异常已关闭，请复核配料数量' : '缺料已进入对应物料跟进'); onChanged();
    } catch (e) { setError(e instanceof Error ? e.message : '保存失败'); } finally { setSaving(false); }
  }
  if (loading) return <div className="sb-empty"><Loader2 className="spin"/>正在读取样品配料</div>;
  if (!record) return <div className="sb-empty"><PackageCheck/><strong>此任务没有当前配料任务</strong><p>历史已完成、测试或培训任务保留原有资料。</p>{error && <p role="alert">{error}</p>}</div>;
  return <section className="sb-materials"><header className="sb-section-heading"><div><small>仓库配料</small><h3>{record.status === 'completed' ? '已配齐' : record.status === 'exception' ? '缺料跟进中' : '准备本次样品物料'}</h3></div><span className="sb-status">{rows.length} 种物料 · {rows.filter(row => row.prepared >= row.quantity).length} 种已配齐</span></header>
    <div className="sb-material-tools"><p>按本次样品总需求填写；采购与客供缺料分别跟进。</p>{!closed && <button onClick={() => { setRows(old => [...old, { id: crypto.randomUUID(), model: '', quantity: 1, prepared: 0, unit: '个', supplySource: 'PURCHASED' }]); setDirty(true); }}><Plus size={16}/>添加物料</button>}</div>
    <div className="sb-material-table"><table><thead><tr><th>物料型号 / 名称</th><th>来源</th><th>需求数量</th><th>已配数量</th><th>单位</th><th>缺口</th><th aria-label="操作"/></tr></thead><tbody>{rows.map(row => <tr key={row.id}><td><input aria-label="物料型号" value={row.model} disabled={closed || saving} onChange={e => edit(row.id, { model: e.target.value })}/></td><td><select aria-label="物料来源" value={row.supplySource} disabled={closed || saving} onChange={e => edit(row.id, { supplySource: e.target.value as SampleMaterialLine['supplySource'] })}>{Object.entries(sourceName).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></td><td><input aria-label="需求数量" type="number" min="0.001" step="0.001" value={row.quantity} disabled={closed || saving} onChange={e => edit(row.id, { quantity: Number(e.target.value) })}/></td><td><input aria-label="已配数量" type="number" min={0} step="0.001" max={row.quantity} value={row.prepared} disabled={!canConfirm || closed || saving} onChange={e => edit(row.id, { prepared: Number(e.target.value) })}/></td><td><input aria-label="物料单位" value={row.unit} disabled={closed || saving} onChange={e => edit(row.id, { unit: e.target.value })}/></td><td><b className={row.quantity > row.prepared ? 'sb-warning-text' : 'sb-good-text'}>{Math.max(0, Math.round((row.quantity - row.prepared) * 1000) / 1000)}</b></td><td>{!closed && <button aria-label={`删除物料 ${row.model || '空行'}`} disabled={saving || !canConfirm && row.prepared > 0} onClick={() => { setRows(list => list.filter(item => item.id !== row.id)); setDirty(true); }}><Trash2 size={15}/></button>}</td></tr>)}</tbody></table>{!rows.length && <p className="sb-empty-inline">填写本次物料需求；确实无需另行配料时，可由仓库确认。</p>}</div>
    <div className="sb-material-actions"><span>{dirty ? '有未保存的修改' : `更新于 ${sampleStamp(record.updatedAt)}`}</span><div>{!closed && <><button disabled={saving || !dirty} onClick={() => void save()}><Save size={16}/>保存清单</button>{canReport && <button disabled={dirty || saving} onClick={() => { setReason(''); setError(''); setDialog('shortage'); }}><AlertTriangle size={16}/>登记缺料</button>}{canConfirm && <button className="sb-primary" disabled={saving || !!record.activeExceptions?.length || rows.some(row => row.prepared < row.quantity)} onClick={() => { setError(''); setDialog('confirm'); }}><CheckCircle2 size={16}/>{rows.length ? '确认配料完成' : '确认无需另行配料'}</button>}</>}</div></div>
    <div className="sb-section-heading"><h3>物料异常与跟进</h3><Link href="/workspace/procurement">打开物料跟进 ↗</Link></div>
    <div className="sb-exceptions">{record.activeExceptions?.map(item => <article key={item.id}><span className="sb-status">{sourceName[item.supplySource || 'UNKNOWN']}</span><div><strong>{item.materialModel || item.exceptionTypeText}</strong><p>{item.exceptionNote}</p><small>缺 {item.shortageQuantity ?? '待确认'} {item.unit} · 预计到料 {item.expectedArrivalAt ? sampleStamp(item.expectedArrivalAt) : '待跟进'} · {item.owner?.displayName || '待接收'}</small></div><div>{item.followUpId && <Link href={`/workspace/procurement?taskId=${item.followUpId}`}>查看跟进 ↗</Link>}{canConfirm && !closed && <button disabled={dirty || saving} onClick={() => { setTarget(item); setReason(''); setError(''); setDialog('resolve'); }}>仓库确认解决</button>}</div></article>)}{!record.activeExceptions?.length && <p className="sb-empty-inline">当前没有未解决的物料异常。</p>}</div>
    <details className="sb-history"><summary>配料操作记录</summary>{record.activities?.map(a => <p key={a.id}><time>{sampleStamp(a.createdAt)}</time><span>{a.content}</span><small>{a.actor?.displayName}</small></p>)}</details>
    {error && !dialog && <p className="sb-error" role="alert">{error}</p>}{toast && <div className="sb-toast" role="status">{toast}</div>}
    {dialog && <SampleDialog title={dialog === 'confirm' ? '确认样品配料' : dialog === 'resolve' ? '仓库确认异常解决' : '登记样品缺料'} busy={saving} onClose={() => setDialog(null)}><div className="sb-dialog-body">{dialog === 'confirm' ? <p>{rows.length ? '已核对需求和实物数量，确认本次物料全部配齐。' : '确认本次样品无需另行配料。'}此次确认会记录操作者和时间。</p> : <>{dialog === 'shortage' && <><label>缺料来源<select value={shortage.supplySource} disabled={saving} onChange={e => setShortage(v => ({ ...v, supplySource: e.target.value }))}><option value="PURCHASED">采购物料缺料</option><option value="CUSTOMER">客供物料缺料</option></select></label><label>物料型号<input value={shortage.materialModel} disabled={saving} onChange={e => setShortage(v => ({ ...v, materialModel: e.target.value }))}/></label><div className="sb-two-fields"><label>缺料数量<input type="number" min="0.001" step="0.001" value={shortage.shortageQuantity} disabled={saving} onChange={e => setShortage(v => ({ ...v, shortageQuantity: e.target.value }))}/></label><label>单位<input value={shortage.unit} disabled={saving} onChange={e => setShortage(v => ({ ...v, unit: e.target.value }))}/></label></div></>}<label>{dialog === 'resolve' ? '解决说明' : '缺料说明'}<textarea maxLength={300} value={reason} disabled={saving} onChange={e => setReason(e.target.value)}/></label></>}{error && <p className="sb-error" role="alert">{error}</p>}</div><footer><button disabled={saving} onClick={() => setDialog(null)}>取消</button><button className="sb-primary" disabled={saving || dialog !== 'confirm' && !reason.trim()} onClick={() => void (dialog === 'confirm' ? save(true) : exception())}>{saving ? '正在保存…' : '确认'}</button></footer></SampleDialog>}
  </section>;
}
