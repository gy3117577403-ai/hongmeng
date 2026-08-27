'use client';
import { useState, useRef, type FormEvent } from 'react';
import { X, Send, Save, UploadCloud, Loader2, ShieldAlert } from 'lucide-react';
import { QualityPeopleFields } from '@/components/QualityAssigneeSelect';
import { QUALITY_PROBLEM_CATEGORIES } from '@/lib/quality-workflow-shared';
import { useModalLayer } from '@/components/useModalLayer';
import type { InternalQualityRiskDTO, InternalQualityRiskOptionsDTO } from '@/types';

async function request(url: string, body: unknown, method = 'POST') {
  const response = await fetch(url, { method, headers: body instanceof FormData ? undefined : { 'Content-Type': 'application/json' }, body: body instanceof FormData ? body : JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '操作失败');
  return result.report as InternalQualityRiskDTO;
}

export default function QualityRiskInitiateDialog({ options, onClose, onSaved, initialProductId = '', initialReport }: { options: InternalQualityRiskOptionsDTO; onClose: () => void; onSaved: (report: InternalQualityRiskDTO) => void; initialProductId?: string; initialReport?: InternalQualityRiskDTO | null }) {
  const [form, setForm] = useState({ title: initialReport?.title || '工艺问题', problemCategory: initialReport?.problemCategory || 'PROCESS', workflowVersion: 3, responsibleUserIds: initialReport?.responsibleUserIds || [] as string[], reviewerUserId: initialReport?.reviewerUserId || '', defectPhenomenon: initialReport?.defectPhenomenon || '', ownerUserId: initialReport?.ownerUserId || '', severity: initialReport?.severity || 'HIGH', workshopArea: initialReport?.workshopArea || '', processName: initialReport?.processName || '', responsibleDepartment: initialReport?.responsibleDepartment || '工艺部', occurrenceDate: initialReport?.occurrenceDate?.slice(0, 10) || new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date()), productIds: initialReport?.products.map(item => item.id) || (initialProductId ? [initialProductId] : [] as string[]) });
  const [search, setSearch] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const draft = useRef<InternalQualityRiskDTO | null>(initialReport || null);
  const uploadInput = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLFormElement>(null);
  const titleRef = useRef<HTMLSelectElement>(null);
  useModalLayer({ open: true, layerRef: dialogRef, initialFocusRef: titleRef, onClose: () => { if (!busy) onClose(); } });
  const products = options.products.filter(item => `${item.specification} ${item.productName} ${item.customerName}`.toLowerCase().includes(search.toLowerCase()));
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submit = (event.nativeEvent as SubmitEvent).submitter?.getAttribute('data-submit') === 'true';
    if (submit && (!form.defectPhenomenon.trim() || !form.productIds.length || !form.ownerUserId || !form.responsibleUserIds.length || !form.reviewerUserId)) { setError('请填写实际问题、关联产品，选择责任人、牵头人及品质确认人。原因与方案在后续阶段填写。'); return; }
    setBusy(true); setError('');
    try {
      draft.current = await request(draft.current ? `/api/quality/internal-risks/${draft.current.id}` : '/api/quality/internal-risks', { ...(draft.current || {}), ...form, ...(draft.current ? { issueIds: draft.current.issues.map(item => item.id), workOrderIds: draft.current.workOrders.map(item => item.id), eightDReportIds: draft.current.eightDReports.map(item => item.id), reportNo: draft.current.reportNo, expectedVersion: draft.current.version } : {}) }, draft.current ? 'PATCH' : 'POST');
      const failed: File[] = [];
      for (const file of files) {
        const data = new FormData(); data.set('file', file); data.set('category', 'DEFECT');
        try { draft.current = await request(`/api/quality/internal-risks/${draft.current.id}/attachments`, data); }
        catch { failed.push(file); }
      }
      setFiles(failed);
      if (failed.length) { onSaved(draft.current); setError(`草稿已保存；${failed.length} 个附件上传失败，请重试。尚未分派任务。`); return; }
      if (submit) {
        draft.current = await request(`/api/quality/internal-risks/${draft.current.id}/stage`, { action: 'CONFIGURE', expectedVersion: draft.current.version, payload: form });
        draft.current = await request(`/api/quality/internal-risks/${draft.current.id}/stage`, { action: 'SUBMIT', expectedVersion: draft.current.version });
      }
      onSaved(draft.current); onClose();
    } catch (reason) { setError(reason instanceof Error ? reason.message : '保存失败，内容已保留'); }
    finally { setBusy(false); }
  }
  return <div className="risk-modal-backdrop"><form ref={dialogRef} className="quality-initiate-dialog" role="dialog" aria-modal="true" aria-labelledby="quality-initiate-title" onSubmit={event => void save(event)}>
    <header><ShieldAlert /><div><small>质量发起 · 只记录当前事实</small><h2 id="quality-initiate-title">发现了什么问题？交给谁处理？</h2><p>提交即生成主责任务；原因、措施和验证由对应人员分阶段补充。</p></div><button type="button" aria-label="关闭发起窗口" disabled={busy} onClick={onClose}><X /></button></header>
    <div className="quality-initiate-body">
      <label>问题归属 <b>*</b><select ref={titleRef} value={form.problemCategory} onChange={event => { const category = QUALITY_PROBLEM_CATEGORIES.find(item => item.id === event.target.value)!; setForm({ ...form, problemCategory: category.id, title: category.label, responsibleDepartment: category.department }); }}>{QUALITY_PROBLEM_CATEGORIES.map(item => <option value={item.id} key={item.id}>{item.label} · {item.department}</option>)}</select><small>用于问题分流，不代表最终责任认定。</small></label>
      <label>实际问题 <b>提交时必填</b><textarea rows={3} value={form.defectPhenomenon} placeholder="发现的不良现象、位置、批次或影响；此时不必知道原因" onChange={event => setForm({ ...form, defectPhenomenon: event.target.value })} /></label>
      <section><header><strong>关联产品 <b>提交时必选</b></strong><small>已选 {form.productIds.length} 个 · 警示发布后覆盖对应产品工单</small></header><input aria-label="搜索关联产品" placeholder="搜索规格、品名、客户" value={search} onChange={event => setSearch(event.target.value)} /><div className="quality-product-choices">{products.map(item => <label key={item.id}><input type="checkbox" checked={form.productIds.includes(item.id)} onChange={() => setForm({ ...form, productIds: form.productIds.includes(item.id) ? form.productIds.filter(id => id !== item.id) : [...form.productIds, item.id] })} /><span><strong>{item.specification || item.productName}</strong><small>{item.customerName} · {item.productName}</small></span></label>)}{!products.length && <p>没有匹配的产品</p>}</div></section>
      <QualityPeopleFields ids={form.responsibleUserIds} lead={form.ownerUserId} reviewer={form.reviewerUserId} users={options.assignees || []} onChange={value => setForm({ ...form, ...value })} />
      <div className="quality-initiate-inline"><label>风险等级<select value={form.severity} onChange={event => setForm({ ...form, severity: event.target.value as InternalQualityRiskDTO['severity'] })}><option value="LOW">低</option><option value="MEDIUM">中</option><option value="HIGH">高</option><option value="CRITICAL">重大</option></select></label><label>发现日期<input type="date" value={form.occurrenceDate} onChange={event => setForm({ ...form, occurrenceDate: event.target.value })} /></label></div>
      <details><summary>补充位置与部门（选填）</summary><div className="quality-initiate-inline">{([['workshopArea', '发现车间'], ['processName', '涉及工序'], ['responsibleDepartment', '责任部门']] as const).map(([key, label]) => <label key={key}>{label}<input value={form[key]} onChange={event => setForm({ ...form, [key]: event.target.value })} /></label>)}</div></details>
      <section className="quality-initiate-upload"><input ref={uploadInput} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" multiple hidden onChange={event => { setFiles([...files, ...Array.from(event.target.files || [])]); event.target.value = ''; }} /><button type="button" onClick={() => uploadInput.current?.click()}><UploadCloud size={17} />添加现场照片 / PDF（选填）</button>{files.map((file, index) => <div key={`${file.name}-${index}`}><span>{file.name}</span><button type="button" disabled={busy} onClick={() => setFiles(files.filter((_, n) => n !== index))}>移除</button></div>)}</section>
      {error && <p role="alert" className="risk-form-error">{error}</p>}
    </div><footer><small>{draft.current ? `已保存 ${draft.current.reportNo}` : '编号、发起人自动记录；不在发起时要求原因与结论。'}</small><button type="submit" disabled={busy}><Save size={16} />保存草稿</button><button type="submit" className="primary" data-submit="true" disabled={busy}>{busy ? <Loader2 className="spin" size={16} /> : <Send size={16} />}提交并分派</button></footer>
  </form></div>;
}
