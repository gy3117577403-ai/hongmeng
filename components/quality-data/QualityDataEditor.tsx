'use client';
import { useEffect, useRef, useState } from 'react';
import { Camera, Check, Loader2, Plus, Save, Trash2, X } from 'lucide-react';
import {
  CONTEXT_FIELDS, QUALITY_LABELS, RESULT_LABELS, beijingInput, emptyQualityForm, qualityForm, qualityResult,
  type QualityDataType, type QualityFormData, type QualityMeasurement, type QualityOrder, type QualityRecord,
} from '@/lib/quality-data';
import type { CurrentUserDTO } from '@/types';
import { qualityJson, qualityRequest } from './client';
type Props = { user: CurrentUserDTO; order: QualityOrder; type: QualityDataType; record?: QualityRecord; sourceQrCode?: string; supersedesId?: string; onSaved: (record: QualityRecord, submitted: boolean) => void; onClose: () => void };
export default function QualityDataEditor({ user, order, type, record, sourceQrCode, supersedesId, onSaved, onClose }: Props) {
  const [current, setCurrent] = useState(record);
  const [form, setForm] = useState<QualityFormData>(record?.data || emptyQualityForm(type, user.displayName || user.username));
  const [title, setTitle] = useState(record?.title || QUALITY_LABELS[type] + '记录');
  const [inspectedAt, setInspectedAt] = useState(beijingInput(record?.inspectedAt));
  const [reason, setReason] = useState(''), [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [dirty, setDirty] = useState(false);
  const key = useRef('');
  const input = useRef<HTMLInputElement>(null);
  const isSubmitted = current?.status === 'SUBMITTED';
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => { if (dirty || busy || files.length) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [dirty, busy, files.length]);
  function change(next: QualityFormData) { setForm(next); setDirty(true); setNotice(''); }
  function rowChange(index: number, field: keyof QualityMeasurement, value: string) {
    change({ ...form, rows: form.rows.map((row, i) => i === index ? { ...row, [field]: value } : row) });
  }
  function switchMode(mode: QualityFormData['mode']) {
    if (mode === form.mode) return;
    if (mode === 'FILE' && form.rows.some(row => row.value || row.standard || row.lower || row.upper || row.note)
      && !window.confirm('切换为文件归档会清空当前检查明细，是否继续？')) return;
    change({ ...form, mode, rows: mode === 'FILE' ? [] : emptyQualityForm(type).rows });
  }
  function close() {
    if (busy) return;
    if ((dirty || files.length) && !window.confirm('还有未保存内容，确认离开此表单？')) return;
    onClose();
  }
  async function save(submit: boolean) {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    let latest = current;
    try {
      const normalized = qualityForm(form);
      if (isSubmitted && !reason.trim()) throw new Error('修改已提交记录，请填写修订原因');
      if (!key.current) key.current = crypto.randomUUID();
      const metadata = { title, inspectedAt, data: normalized, reason };
      latest = latest
        ? await qualityRequest<QualityRecord>('records/' + latest.id, qualityJson('PATCH', { ...metadata, version: latest.version, action: 'SAVE' }))
        : await qualityRequest<QualityRecord>('records', qualityJson('POST', { ...metadata, workOrderId: order.id, type, sourceQrCode, supersedesId, idempotencyKey: key.current }));
      setCurrent(latest); setDirty(false);
      for (const file of files) {
        const upload = new FormData();
        upload.set('file', file); upload.set('version', String(latest.version)); upload.set('reason', reason);
        latest = await qualityRequest<QualityRecord>('records/' + latest.id + '/attachments', { method: 'POST', body: upload });
        setCurrent(latest); setFiles(pending => pending.filter(item => item !== file));
      }
      if (submit && latest.status !== 'SUBMITTED') {
        latest = await qualityRequest<QualityRecord>('records/' + latest.id, qualityJson('PATCH', { ...metadata, version: latest.version, action: 'SUBMIT' }));
        setCurrent(latest);
      }
      setNotice(latest.status === 'SUBMITTED' ? '已提交并同步到质量数据' : '草稿已保存，稍后可继续填写');
      setForm(latest.data);
      onSaved(latest, submit || latest.status === 'SUBMITTED');
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败');
    } finally { setBusy(false); }
  }
  async function removeFile(id: string) {
    if (!current || busy) return;
    const note = window.prompt('请输入移除附件的原因：');
    if (!note?.trim()) return;
    setBusy(true); setError('');
    try {
      const updated = await qualityRequest<QualityRecord>('attachments/' + id, qualityJson('DELETE', { version: current.version, reason: note }));
      setCurrent(updated); onSaved(updated, false);
    } catch (e) { setError(e instanceof Error ? e.message : '移除失败'); }
    finally { setBusy(false); }
  }
  let preview = 'PENDING';
  try { preview = qualityResult(qualityForm(form)); } catch { /* Validation is shown when saved. */ }
  return <section className="qd-editor" aria-label={QUALITY_LABELS[type] + '填报'}>
    <header className="qd-editor-head"><div><small>{current?.code || '新增检验记录'}{supersedesId ? ' · 复检' : ''}</small><h2>{QUALITY_LABELS[type]}</h2></div><button type="button" className="qd-icon" onClick={close} disabled={busy} aria-label="关闭填报"><X size={22}/></button></header>
    <div className="qd-order-strip"><strong>{order.specification || order.productName}</strong><span>{order.businessCode || order.code} · {order.sourceOrderNo || '历史工单'}{order.batchNo ? ' · 第 ' + order.batchNo + ' 批' : ''}</span><small>{order.customerName || '客户未填写'} · 计划数量 {order.quantity ?? '—'}</small></div>
    <div className="qd-editor-body">
      {error && <div role="alert" className="qd-alert error">{error}{current && <button type="button" onClick={async () => {
        if (!window.confirm('重新载入会替换表单中的未保存修改，继续？')) return;
        try { const fresh = await qualityRequest<QualityRecord>('records/' + current.id); setCurrent(fresh); setForm(fresh.data); setTitle(fresh.title); setInspectedAt(beijingInput(fresh.inspectedAt)); setDirty(false); setError(''); } catch (e) { setError(e instanceof Error ? e.message : '读取失败'); }
      }}>重新载入最新版本</button>}</div>}
      {notice && <div role="status" className="qd-alert success"><Check size={16}/>{notice}</div>}
      <div className="qd-grid-two">
        <label>记录标题<input aria-label="记录标题" value={title} maxLength={160} onChange={e => { setTitle(e.target.value); setDirty(true); }}/></label>
        <label>检验时间（北京时间）<input aria-label="检验时间" type="datetime-local" value={inspectedAt} onChange={e => { setInspectedAt(e.target.value); setDirty(true); }}/></label>
      </div>
      <div className="qd-mode" role="group" aria-label="填报方式">{(['FORM','FILE'] as const).map(mode => <button type="button" key={mode} className={form.mode === mode ? 'active' : ''} onClick={() => switchMode(mode)}>{mode === 'FORM' ? '在线填写' : '已有文件归档'}</button>)}</div>
      <div className="qd-section-title"><b>检验信息</b><span>随本次记录保存</span></div>
      <div className="qd-context-grid">
        {CONTEXT_FIELDS.filter(([name]) => ['processName','team','inspectedBy','inspectionQty','sampleQty','defectQty','standardRef'].includes(name)).map(([name,label]) => <label key={name}>{label}{['processName','inspectedBy'].includes(name) && <em> *</em>}<input aria-label={label} list={name === 'processName' ? 'qd-process-options' : undefined} value={form.context[name]} maxLength={240} onChange={e => change({ ...form, context: { ...form.context, [name]: e.target.value } })}/></label>)}
      </div>
      <datalist id="qd-process-options">{order.steps.map(step => <option key={step.id} value={step.name}/>)}</datalist>
      <details className="qd-more-fields" open={type === 'CRIMP' || type === 'PULL'}><summary>端子、线材、设备与追溯信息</summary><div className="qd-context-grid">{CONTEXT_FIELDS.filter(([name]) => !['processName','team','inspectedBy','inspectionQty','sampleQty','defectQty','standardRef'].includes(name)).map(([name,label]) => <label key={name}>{label}<input aria-label={label} value={form.context[name]} maxLength={240} onChange={e => change({ ...form, context: { ...form.context, [name]: e.target.value } })}/></label>)}</div></details>
      {form.mode === 'FORM' && <>
        <div className="qd-section-title"><b>检查与测量明细</b><span className={'qd-badge ' + preview.toLowerCase()}>{RESULT_LABELS[preview as keyof typeof RESULT_LABELS]}</span></div>
        <p className="qd-help">填写有效标准后判定。数值上下限包含边界；外观项目填写检查结果与依据，再选择结论。</p>
        <div className="qd-measurements">{form.rows.map((row,index) => <article className="qd-measure-row" key={index}>
          <header><b>检查项 {index + 1}</b><button type="button" className="qd-icon" aria-label={'删除检查项 ' + (index + 1)} onClick={() => change({ ...form, rows: form.rows.filter((_,i) => i !== index) })}><Trash2 size={16}/></button></header>
          <div className="qd-measure-grid">
            {([['sample','样本编号'],['position','位置 / 线号'],['item','检验项目'],['standard','标准 / 依据'],['lower','标准下限'],['upper','标准上限'],['value','实测 / 检查结果'],['unit','单位']] as const).map(([field,label]) => <label key={field}>{label}<input aria-label={label + ' ' + (index + 1)} inputMode={['lower','upper'].includes(field) ? 'decimal' : undefined} value={row[field]} onChange={e => rowChange(index,field,e.target.value)}/></label>)}
            <label>人工判定<select aria-label={'人工判定 ' + (index + 1)} value={row.result} disabled={Boolean(row.lower || row.upper)} onChange={e => rowChange(index,'result',e.target.value)}><option value="PENDING">待判定</option><option value="PASS">合格</option><option value="FAIL">不合格</option></select></label>
            <label className="qd-row-note">项目备注<input aria-label={'项目备注 ' + (index + 1)} value={row.note} onChange={e => rowChange(index,'note',e.target.value)}/></label>
          </div>
        </article>)}</div>
        <button type="button" className="qd-add-row" disabled={form.rows.length >= 120} onClick={() => {
          const previous = form.rows[form.rows.length-1] || emptyQualityForm(type).rows[0];
          change({ ...form, rows: [...form.rows, { ...previous, sample: String(form.rows.length + 1), value: '', note: '', result: 'PENDING' }] });
        }}><Plus size={17}/>添加检查项 / 下一样本</button>
      </>}
      <label className="qd-summary-label">内容摘要 / 异常说明{form.mode === 'FILE' && <em> *</em>}<textarea aria-label="内容摘要" rows={3} maxLength={4000} value={form.summary} placeholder={form.mode === 'FILE' ? '填写纸表主要内容与关键词，便于日后查询' : '记录异常现象、处理情况及需要说明的内容'} onChange={e => change({ ...form, summary: e.target.value })}/></label>
      <div className="qd-section-title"><b>照片与原始文件</b><span>每份最多 30 个，每个 20 MB</span></div>
      <input ref={input} type="file" aria-label="添加质量附件" accept=".pdf,.jpg,.jpeg,.png,.webp,.xlsx,.xls" multiple hidden onChange={e => { setFiles(previous => [...previous, ...Array.from(e.target.files || [])]); e.target.value = ''; setDirty(true); }}/>
      <button className="qd-upload" type="button" onClick={() => input.current?.click()} disabled={busy}><Camera size={22}/><b>拍照或选择文件</b><span>PDF / 照片 / Excel</span></button>
      <div className="qd-file-list">
        {current?.attachments.filter(file => !file.deletedAt).map(file => <div key={file.id}><a href={'/api/quality-data/attachments/' + file.id + '/content?download=1'}>{file.originalName}</a><small>已同步</small><button type="button" aria-label={'移除 ' + file.originalName} disabled={busy} onClick={() => void removeFile(file.id)}><X size={16}/></button></div>)}
        {files.map((file,index) => <div key={index}><span>{file.name}</span><small>待上传</small><button type="button" aria-label={'取消上传 ' + file.name} disabled={busy} onClick={() => setFiles(items => items.filter((_,i) => i !== index))}><X size={16}/></button></div>)}
      </div>
      {isSubmitted && <label className="qd-summary-label">修订原因 <em>*</em><textarea aria-label="修订原因" value={reason} onChange={e => setReason(e.target.value)} placeholder="说明修改了哪些内容、为什么修改；保存后需重新复核" rows={2}/></label>}
    </div>
    <footer className="qd-editor-footer"><button type="button" onClick={close} disabled={busy}>取消</button>{!isSubmitted && <button type="button" onClick={() => void save(false)} disabled={busy}><Save size={16}/>保存草稿</button>}<button type="button" className="qd-primary" onClick={() => void save(true)} disabled={busy}>{busy ? <Loader2 size={17} className="qd-spin"/> : <Check size={17}/>} {busy ? '保存与同步中…' : isSubmitted ? '保存修订' : '提交记录'}</button></footer>
  </section>;
}
