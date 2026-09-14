'use client';
import { useEffect, useState, useRef, type FormEvent } from 'react';
import { X, Send, Save, UploadCloud, Loader2, ShieldAlert } from 'lucide-react';
import { QualityPeopleFields } from '@/components/QualityAssigneeSelect';
import { QUALITY_PROBLEM_CATEGORIES } from '@/lib/quality-workflow-shared';
import { useQualityDraft } from './useQualityDraft';
import { QualityDraftNotice } from './QualityDraftNotice';
import { qualityEventTitle } from '@/lib/quality-workbench';
import { useModalLayer } from '@/components/useModalLayer';
import type { InternalQualityRiskDTO, InternalQualityRiskOptionsDTO } from '@/types';

async function request(url: string, body: unknown, method = 'POST') {
  const response = await fetch(url, { method, headers: body instanceof FormData ? undefined : { 'Content-Type': 'application/json' }, body: body instanceof FormData ? body : JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '操作失败');
  return result.report as InternalQualityRiskDTO;
}

export default function QualityRiskInitiateDialog({ options, onClose, onSaved, initialProductId = '', initialWorkOrderId = '', userId, sourceRecordId = '', initialReport }: { options: InternalQualityRiskOptionsDTO; onClose: () => void; onSaved: (report: InternalQualityRiskDTO) => void; initialProductId?: string; initialWorkOrderId?: string; userId: string; sourceRecordId?: string; initialReport?: InternalQualityRiskDTO | null }) {
  const [source, setSource] = useState({ title: initialReport ? qualityEventTitle(initialReport) : '', problemCategory: initialReport?.problemCategory || 'PROCESS', workflowVersion: 4, operatorAssignments: initialReport?.operatorAssignments || {} as import('@/lib/quality-direct-shared').QualityOperatorAssignments, responsibleUserIds: initialReport?.responsibleUserIds || [] as string[], reviewerUserId: initialReport?.reviewerUserId || '', defectPhenomenon: initialReport?.defectPhenomenon || '', ownerUserId: initialReport?.ownerUserId || '', severity: initialReport?.severity || 'HIGH', workshopArea: initialReport?.workshopArea || '', processName: initialReport?.processName || '', responsibleDepartment: initialReport?.responsibleDepartment || '工艺部', occurrenceDate: initialReport?.occurrenceDate?.slice(0, 10) || new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date()), sourceQualityRecordId: sourceRecordId, draftId: initialReport?.id || '', taskDueAt: '', workOrderIds: initialReport?.workOrders.filter(item => item.source === 'DIRECT').map(item => item.id) || (initialWorkOrderId ? [initialWorkOrderId] : [] as string[]), issueIds: initialReport?.issues.map(item => item.id) || [] as string[], eightDReportIds: initialReport?.eightDReports.map(item => item.id) || [] as string[], productIds: initialReport?.products.map(item => item.id) || (initialProductId ? [initialProductId] : [] as string[]) });
  const textDraft = useQualityDraft(userId + ':intake:' + (initialReport?.id || sourceRecordId || 'new'), source);
  const form = textDraft.value, setForm = textDraft.setValue;
  const [orderSearch, setOrderSearch] = useState('');
  const [uploadProgress, setUploadProgress] = useState('');
  const [closePrompt, setClosePrompt] = useState(false);
  const [search, setSearch] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const draft = useRef<InternalQualityRiskDTO | null>(initialReport || null);
  const uploadInput = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLFormElement>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  useModalLayer({ open: true, layerRef: dialogRef, initialFocusRef: titleRef, onClose: () => { if (!busy) { if (textDraft.dirty || files.length) setClosePrompt(true); else onClose(); } } });
  const products = options.products.filter(item => `${item.specification} ${item.productName} ${item.customerName}`.toLowerCase().includes(search.toLowerCase()));
  const [sourceLoading, setSourceLoading] = useState(Boolean(sourceRecordId));
  const loadedSource = useRef(false);
  useEffect(() => {
    if (!sourceRecordId || !textDraft.ready || loadedSource.current) return;
    loadedSource.current = true;
    fetch('/api/quality-data/records/' + encodeURIComponent(sourceRecordId), { cache: 'no-store' }).then(async response => {
      const body = await response.json(); if (!response.ok) throw Error(body.error || '读取来源失败');
      const record = body.record || body.data || body;
      if (record.deletedAt || record.status !== 'SUBMITTED') throw Error('来源记录已作废或尚未提交');
      const workOrder = options.workOrders.find(item => item.id === record.workOrderId);
      setForm(current => current.defectPhenomenon || current.draftId ? current : ({ ...current, title: record.title + '异常协同', defectPhenomenon: record.data?.summary || record.title, workOrderIds: [record.workOrderId], productIds: workOrder?.drawingLibraryItemId ? [workOrder.drawingLibraryItemId] : current.productIds }));
    }).catch(error => setError(error.message || '读取来源失败')).finally(() => setSourceLoading(false));
  }, [sourceRecordId, textDraft.ready, options.workOrders, setForm]);
  const sourceProductLinked = useRef(false);
  useEffect(() => {
    if (!sourceRecordId || sourceLoading || sourceProductLinked.current) return;
    const order = options.workOrders.find(item => form.workOrderIds.includes(item.id));
    if (order?.drawingLibraryItemId) { sourceProductLinked.current = true; setForm(current => ({ ...current, productIds: [...new Set([...current.productIds, order.drawingLibraryItemId!])] })); }
  }, [sourceRecordId, sourceLoading, options.workOrders, form.workOrderIds, setForm]);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || textDraft.conflict) return;
    const submit = (event.nativeEvent as SubmitEvent).submitter?.getAttribute('data-submit') === 'true';
    if (submit && (!form.defectPhenomenon.trim() || !form.productIds.length || !form.responsibleUserIds.length || !form.reviewerUserId)) { setError('请填写实际问题、关联产品，选择主要责任人及品质确认人。原因与方案在后续阶段填写。'); return; }
    setBusy(true); setError('');
    try {
      if (!draft.current && form.draftId) draft.current = await request('/api/quality/internal-risks/' + encodeURIComponent(form.draftId), undefined, 'GET');
      const submitted = { ...form, workflowVersion: 4, ownerUserId: '', title: form.title.trim() || qualityEventTitle({ defectPhenomenon: form.defectPhenomenon }) };
      draft.current = await request(draft.current ? `/api/quality/internal-risks/${draft.current.id}` : '/api/quality/internal-risks', { ...(draft.current || {}), ...submitted, ...(draft.current ? { reportNo: draft.current.reportNo, expectedVersion: draft.current.version } : {}) }, draft.current ? 'PATCH' : 'POST');
      const saved = { ...submitted, draftId: draft.current.id }; setForm(saved); setSource(saved); textDraft.saved(saved);
      const failed: File[] = [];
      for (const [index, file] of files.entries()) {
        setUploadProgress('上传 ' + (index + 1) + '/' + files.length + ' · ' + file.name);
        const data = new FormData(); data.set('file', file); data.set('category', 'DEFECT');
        try { draft.current = await request(`/api/quality/internal-risks/${draft.current.id}/attachments`, data); }
        catch { failed.push(file); }
      }
      setFiles(failed);
      if (failed.length) { onSaved(draft.current); setError(`草稿已保存；${failed.length} 个附件上传失败，请重试。尚未分派任务。`); return; }
      if (submit) {
        draft.current = await request(`/api/quality/internal-risks/${draft.current.id}/stage`, { action: 'CONFIGURE', expectedVersion: draft.current.version, payload: submitted });
        draft.current = await request(`/api/quality/internal-risks/${draft.current.id}/stage`, { action: 'SUBMIT', expectedVersion: draft.current.version, payload: { taskDueAt: form.taskDueAt } });
      }
      try { sessionStorage.removeItem('hm-quality-draft:' + userId + ':intake:' + (initialReport?.id || sourceRecordId || 'new')); } catch {}
      onSaved(draft.current); onClose();
    } catch (reason) { setError(reason instanceof Error ? reason.message : '保存失败，内容已保留'); }
    finally { setBusy(false); setUploadProgress(''); }
  }
  return <div className="risk-modal-backdrop"><form ref={dialogRef} className="quality-initiate-dialog qd-intake" role="dialog" aria-modal="true" aria-labelledby="quality-initiate-title" onKeyDown={event => { if (event.key === 'Enter' && event.target instanceof HTMLInputElement && event.target.type !== 'file') event.preventDefault(); }} onSubmit={event => void save(event)}>
    <header><span className="qd-heading-icon"><ShieldAlert /></span><div><small>质量管理 · 内部重大异常</small><h2 id="quality-initiate-title">{initialReport ? '编辑异常工单' : '建立异常工单'}</h2></div><button type="button" aria-label="关闭发起窗口" disabled={busy} onClick={() => { if (textDraft.dirty || files.length) setClosePrompt(true); else onClose(); }}><X /></button></header>
    <div className="qd-flow-hint"><span>记录问题</span><i>›</i><span>责任人处理</span><i>›</i><span>品质确认</span></div>
    <div className="quality-initiate-body"><fieldset disabled={busy || !textDraft.ready || sourceLoading} className="qd-intake-fields">
      <section className="qd-facts"><h3><span>01</span>问题与产品</h3>
        {sourceRecordId && <p className="qd-source-note">已关联来源检验记录{sourceLoading ? '，正在读取…' : ''}</p>}
        <label className="qd-field">发现了什么问题 <b>*</b><textarea ref={titleRef} rows={4} value={form.defectPhenomenon} placeholder="说明不良现象、发生位置或影响。原因在处理时填写。" onChange={event => setForm({ ...form, defectPhenomenon: event.target.value })} /></label>
        <div className="qd-inline"><label className="qd-field">问题归属<select value={form.problemCategory} onChange={event => { const category = QUALITY_PROBLEM_CATEGORIES.find(item => item.id === event.target.value)!; setForm({ ...form, problemCategory: category.id, responsibleDepartment: category.department }); }}>{QUALITY_PROBLEM_CATEGORIES.map(item => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label><label className="qd-field">发现日期<input type="date" value={form.occurrenceDate} onChange={event => setForm({ ...form, occurrenceDate: event.target.value })} /></label></div>
        <section className="qd-product-section"><header><strong>关联产品 <b>*</b></strong><small>{form.productIds.length} 个产品</small></header>
          <div className="qd-product-tags">{form.productIds.map(id => { const item = options.products.find(item => item.id === id); return <span key={id}>{item?.specification || item?.productName || '原关联产品'}<button type="button" aria-label={`移除产品 ${item?.specification || id}`} onClick={() => setForm({ ...form, productIds: form.productIds.filter(value => value !== id) })}><X size={13} /></button></span>; })}</div>
          <details open={!form.productIds.length} className="qd-product-picker"><summary>{form.productIds.length ? '添加或调整关联产品' : '搜索并选择产品'}</summary><input aria-label="搜索关联产品" placeholder="规格、品名或客户" value={search} onChange={event => setSearch(event.target.value)} /><div className="qd-picker-results">{products.slice(0, 60).map(item => <label key={item.id}><input type="checkbox" checked={form.productIds.includes(item.id)} onChange={() => setForm({ ...form, productIds: form.productIds.includes(item.id) ? form.productIds.filter(id => id !== item.id) : [...form.productIds, item.id] })} /><span><strong>{item.specification || item.productName}</strong><small>{item.customerName} · {item.productName}</small></span></label>)}{!products.length && <p>没有匹配的产品</p>}</div>{products.length > 60 && <small>请输入关键词缩小范围，当前显示前 60 项。</small>}</details>
        </section>
        <section className="qd-upload"><input ref={uploadInput} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" multiple hidden onChange={event => { setFiles([...files, ...Array.from(event.target.files || [])]); event.target.value = ''; }} /><button type="button" onClick={() => uploadInput.current?.click()}><UploadCloud size={17} />添加现场照片 / PDF<small>选填</small></button>{files.map((file, index) => <div key={`${file.name}-${index}`}><span>{file.name}</span><button type="button" aria-label={`移除附件 ${file.name}`} disabled={busy} onClick={() => setFiles(files.filter((_, n) => n !== index))}><X size={14} /></button></div>)}</section>
      </section>
      <section className="qd-assignment"><h3><span>02</span>责任分工</h3><QualityPeopleFields ids={form.responsibleUserIds} reviewer={form.reviewerUserId} operators={form.operatorAssignments} users={options.assignees || []} onChange={value => setForm({ ...form, ...value })} /></section>
      <details className="qd-more"><summary>更多信息 <small>标题、风险等级、期限与关联工单</small></summary><div className="qd-more-grid">
        <label className="qd-field">异常标题<input value={form.title} maxLength={180} placeholder="留空则从问题描述生成" onChange={event => setForm({ ...form, title: event.target.value })} /></label>
        <label className="qd-field">风险等级<select value={form.severity} onChange={event => setForm({ ...form, severity: event.target.value as InternalQualityRiskDTO['severity'] })}><option value="LOW">低</option><option value="MEDIUM">中</option><option value="HIGH">高</option><option value="CRITICAL">重大</option></select></label>
        <label className="qd-field">任务截止日期<input type="date" value={form.taskDueAt} onChange={event => setForm({ ...form, taskDueAt: event.target.value })} /></label>
        {([['workshopArea', '发现车间'], ['processName', '涉及工序'], ['responsibleDepartment', '责任部门']] as const).map(([key, label]) => <label className="qd-field" key={key}>{label}<input value={form[key]} onChange={event => setForm({ ...form, [key]: event.target.value })} /></label>)}
      </div><details className="qd-order-picker"><summary>关联订单 / 工单 · {form.workOrderIds.length} 项</summary><input aria-label="搜索关联工单" value={orderSearch} onChange={event => setOrderSearch(event.target.value)} placeholder="工单号、产品或客户" /><div className="qd-picker-results">{options.workOrders.filter(item => !item.deletedAt && (item.displayCode + item.specification + item.customerName).toLowerCase().includes(orderSearch.toLowerCase())).slice(0, 60).map(item => <label key={item.id}><input type="checkbox" checked={form.workOrderIds.includes(item.id)} onChange={() => setForm({ ...form, workOrderIds: form.workOrderIds.includes(item.id) ? form.workOrderIds.filter(id => id !== item.id) : [...form.workOrderIds, item.id], productIds: !form.workOrderIds.includes(item.id) && item.drawingLibraryItemId ? [...new Set([...form.productIds, item.drawingLibraryItemId])] : form.productIds })} /><span><strong>{item.displayCode}</strong><small>{item.specification} · {item.customerName}</small></span></label>)}</div></details></details>
    </fieldset>{uploadProgress && <p role="status" className="qv4-upload-progress">{uploadProgress}</p>}<QualityDraftNotice draft={textDraft} busy={busy} />{closePrompt && <section className="qv4-close-prompt" role="alert"><strong>保留文字草稿后关闭？</strong><p>未上传附件需要重新选择。</p><button type="button" onClick={() => setClosePrompt(false)}>继续填写</button><button type="button" onClick={onClose}>保留草稿并关闭</button></section>}{error && <p role="alert" className="risk-form-error">{error}</p>}</div>
    <footer><small>{draft.current ? `已保存 ${draft.current.reportNo}` : '原因、措施和结果由责任人在处理时填写'}</small><button type="submit" disabled={busy || textDraft.conflict || !textDraft.ready || sourceLoading}><Save size={16} />保存草稿</button><button type="submit" className="primary" data-submit="true" disabled={busy || textDraft.conflict || !textDraft.ready || sourceLoading}>{busy ? <Loader2 className="spin" size={16} /> : <Send size={16} />}提交并分派</button></footer>
  </form></div>;
}
