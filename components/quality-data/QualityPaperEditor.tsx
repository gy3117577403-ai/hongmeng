'use client';
/* eslint-disable @next/next/no-img-element */
import { useEffect, useRef, useState } from 'react';
import { Camera, Check, ChevronLeft, ChevronRight, ImagePlus, Loader2, Save, X } from 'lucide-react';
import { beijingInput, emptyQualityForm, QUALITY_LABELS, type QualityFormData, type QualityInspectionStep, type QualityOrder, type QualityRecord } from '@/lib/quality-data';
import { GlassNotice } from '@/components/GlassNotice';
import { paperName } from '@/lib/quality-paper-archive';
import type { CurrentUserDTO } from '@/types';
import { qualityJson, qualityRequest } from './client';

export type PaperType = 'FIRST' | 'PATROL';
type QueuedPhoto = { key: string; file: File; url: string };
type Props = {
  type: PaperType; user: CurrentUserDTO; order?: QualityOrder | null; step?: QualityInspectionStep | null;
  record?: QualityRecord; initialDate?: string; sourceQrCode?: string; onDirtyChange?: (dirty: boolean) => void; onBusyChange?: (busy: boolean) => void; inline?: boolean; onClose: () => void;
  onSaved: (record: QualityRecord, complete: boolean) => void;
};

export default function QualityPaperEditor({ type, user, record, initialDate, inline, onClose, onSaved, onDirtyChange, onBusyChange }: Props) {
  const [current, setCurrent] = useState(record);
  const [date, setDate] = useState(record ? beijingInput(record.inspectedAt).slice(0, 10) : initialDate || beijingInput().slice(0, 10));
  const [dateEnd, setDateEnd] = useState(record?.data.paper?.dateEnd || '');
  const [title, setTitle] = useState(record?.title || '');
  const [inspector, setInspector] = useState(record?.data.context.inspectedBy || '');
  const [area, setArea] = useState(record?.data.paper?.area || record?.data.context.workstation || '');
  const [note, setNote] = useState(record?.data.summary || '');
  const [reason, setReason] = useState('');
  const [queue, setQueue] = useState<QueuedPhoto[]>([]), [error, setError] = useState(''), [busy, setBusy] = useState(false), [progress, setProgress] = useState('');
  const [dirty, setDirty] = useState(false), [leaving, setLeaving] = useState(false);
  const [removing, setRemoving] = useState(''), [removeReason, setRemoveReason] = useState('');
  const lock = useRef(false), createRequest = useRef<Record<string, unknown> | null>(null);
  const urls = useRef(new Set<string>()), camera = useRef<HTMLInputElement>(null), album = useRef<HTMLInputElement>(null), root = useRef<HTMLElement>(null);
  const onBusy = useRef(onBusyChange); onBusy.current = onBusyChange;
  useEffect(() => { onBusy.current?.(busy); }, [busy]);
  const onDirty = useRef(onDirtyChange); onDirty.current = onDirtyChange;
  useEffect(() => { onDirty.current?.(dirty || busy || queue.length > 0); }, [dirty, busy, queue.length]);
  useEffect(() => () => { onDirty.current?.(false); }, []);
  const active = current?.attachments.filter(file => !file.deletedAt) || [];
  const historicalStructured = Boolean(record && !record.data.paper && record.data.mode === 'FORM');
  useEffect(() => () => { urls.current.forEach(url => URL.revokeObjectURL(url)); }, []);
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => { if (dirty || busy || queue.length) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', guard); return () => window.removeEventListener('beforeunload', guard);
  }, [dirty, busy, queue.length]);
  useEffect(() => {
    if (inline) return;
    const before = document.activeElement as HTMLElement | null;
    root.current?.querySelector<HTMLElement>('button')?.focus();
    return () => before?.focus();
  }, [inline]);
  function close() { if(lock.current)return; if(dirty || queue.length)setLeaving(true);else onClose(); }
  function queueFiles(files: File[]) {
    if (files.some(file => !/\.(jpe?g|png|webp|pdf)$/i.test(file.name) || !file.size || file.size > 20 * 1024 * 1024)) { setError('支持 JPG、PNG、WEBP、PDF，单个文件不超过 20 MB'); return; }
    if (files.length + queue.length + active.length > 30) { setError('每份记录最多 30 份照片或文件'); return; }
    setQueue(previous => [...previous, ...files.map(file => { const url = URL.createObjectURL(file); urls.current.add(url); return { key: crypto.randomUUID(), file, url }; })]);
    setDirty(true); setError('');
  }
  function removeQueued(key: string) {
    setQueue(items => items.filter(item => { if (item.key !== key) return true; URL.revokeObjectURL(item.url); urls.current.delete(item.url); return false; }));
  }
  function move(index: number, delta: number) { setQueue(items => { const copy = [...items]; [copy[index], copy[index + delta]] = [copy[index + delta], copy[index]]; return copy; }); }
  async function removeUploaded(id: string) {
    if (!current || lock.current) return;
    const reason = removeReason.trim(); if (!reason) { setError('请填写移除原因'); return; }
    lock.current = true; setBusy(true); setError('');
    try { const updated = await qualityRequest<QualityRecord>('attachments/' + id, qualityJson('DELETE', { version: current.version, reason })); setCurrent(updated); setRemoving(''); setRemoveReason(''); onSaved(updated, false); }
    catch (e) { setError(e instanceof Error ? e.message : '移除失败'); }
    finally { lock.current = false; setBusy(false); }
  }
  async function save(submit: boolean) {
    if (lock.current) return;
    setError('');
    if (!date || (dateEnd && dateEnd < date)) { setError('请选择正确的报表日期，结束日期不能早于开始日期'); return; }
    if (submit && !active.length && !queue.length && !historicalStructured) { setError('请拍照或选择至少一份检验凭证'); return; }
    if (current?.status === 'SUBMITTED' && !reason.trim()) { setError('请填写本次修订原因'); return; }
    lock.current = true; setBusy(true);
    let latest = current;
    try {
      const data: QualityFormData = historicalStructured ? { ...record!.data, context: { ...record!.data.context, inspectedBy: inspector }, summary: note } : {
        ...emptyQualityForm(type, inspector), mode: 'FILE', rows: [], summary: note,
        paper: { result: record?.workOrderId ? record.data.paper?.result || record.result : 'PENDING', area, dateEnd: dateEnd || undefined },
      };
      const metadata = { title: title.trim() || date + ' ' + paperName(type), inspectedAt: record?.workOrderId && date === beijingInput(record.inspectedAt).slice(0, 10) ? record.inspectedAt : date + 'T00:00', data, reason };
      setProgress('保存检验信息…');
      if (!latest) {
        if (!createRequest.current) createRequest.current = { ...metadata, type, idempotencyKey: crypto.randomUUID() };
        latest = await qualityRequest<QualityRecord>('records', qualityJson('POST', createRequest.current)); setCurrent(latest);
      }
      // The first create request remains immutable for safe retries. Apply current edits separately.
      latest = await qualityRequest<QualityRecord>('records/' + latest.id, qualityJson('PATCH', { ...metadata, action: 'SAVE', version: latest.version })); setCurrent(latest);
      for (const [index, photo] of queue.entries()) {
        setProgress('上传 ' + (index + 1) + ' / ' + queue.length + '…');
        const form = new FormData(); form.set('file', photo.file); form.set('version', String(latest.version)); form.set('reason', reason);
        latest = await qualityRequest<QualityRecord>('records/' + latest.id + '/attachments', { method: 'POST', body: form }); setCurrent(latest); removeQueued(photo.key);
      }
      if (submit && latest.status !== 'SUBMITTED') {
        latest = await qualityRequest<QualityRecord>('records/' + latest.id, qualityJson('PATCH', { ...metadata, action: 'SUBMIT', version: latest.version })); setCurrent(latest);
      }
      setDirty(false); setProgress(submit ? '记录已保存' : '草稿已保存'); onSaved(latest, submit);
    } catch (e) { setError((e instanceof Error ? e.message : '保存失败') + (latest ? '；已上传内容保留在草稿／记录中，可继续重试。' : '')); }
    finally { lock.current = false; setBusy(false); }
  }
  return <section ref={root} className={'qp-editor ' + (inline ? 'qp-inline' : '')} aria-label={QUALITY_LABELS[type] + '登记'} onKeyDown={event => {
    if (inline) return;
    if (event.key === 'Escape') { event.stopPropagation(); close(); }
    if (event.key === 'Tab') { const nodes = Array.from(root.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not([hidden]):not(:disabled),textarea:not(:disabled),select:not(:disabled)') || []).filter(node => node.offsetParent !== null); const a = nodes[0], b = nodes[nodes.length - 1]; if (event.shiftKey && document.activeElement === a) { event.preventDefault(); b?.focus(); } else if (!event.shiftKey && document.activeElement === b) { event.preventDefault(); a?.focus(); } }
  }}>
    {!inline && <header><div><small>日期归档 · 上传人：{user.displayName || user.username}</small><h2>{record ? '补充 / 编辑' : '上传'}{paperName(type)}</h2></div><button aria-label="关闭登记" disabled={busy} onClick={close}><X size={22}/></button></header>}
    <div className="qp-editor-body">
      {record?.workOrderId && <p className="qp-muted">历史工单来源和原检验结果保留，本次可补充照片及说明。</p>}
      <fieldset disabled={busy} className="qp-fields">
        <div className="qp-two"><label>报表日期 <em>*</em><input type="date" value={date} max={beijingInput().slice(0, 10)} onInput={e => { setDate(e.currentTarget.value); setDirty(true); }} onChange={e => { setDate(e.target.value); setDirty(true); }}/></label><label className="qa-multiday"><span><input type="checkbox" aria-label="一张报表包含多天" checked={Boolean(dateEnd)} onChange={e => { setDateEnd(e.target.checked ? date : ''); setDirty(true); }}/>一张报表包含多天</span>{dateEnd && <input type="date" aria-label="报表结束日期" min={date} max={beijingInput().slice(0, 10)} value={dateEnd} onInput={e => { setDateEnd(e.currentTarget.value); setDirty(true); }} onChange={e => { setDateEnd(e.target.value); setDirty(true); }}/>}</label></div>
        {historicalStructured && <p className="qp-muted">原检验明细保留，可补充照片和说明。</p>}
        <div className="qp-photo-heading"><label>报表照片 / PDF <em>*</em></label><small>{active.length + queue.length ? '已添加 ' + (active.length + queue.length) + ' 份' : '支持多选和拖入'}</small></div>
        <input ref={camera} type="file" hidden accept="image/*" capture="environment" aria-label="拍摄检验照片" onChange={e => { queueFiles(Array.from(e.target.files || [])); e.target.value = ''; }}/>
        <input ref={album} type="file" hidden accept=".jpg,.jpeg,.png,.webp,.pdf" multiple aria-label="选择检验照片" onChange={e => { queueFiles(Array.from(e.target.files || [])); e.target.value = ''; }}/>
        <div className={'qp-upload ' + (!active.length && !queue.length ? 'empty' : '')} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); if (!busy) queueFiles(Array.from(e.dataTransfer.files)); }}>
          {!active.length && !queue.length && <><ImagePlus size={30}/><b>拍照或拖入整份报表</b><small>可以包含多个产品 · 每份最大 20 MB，最多 30 份</small></>}
          <div><button type="button" className="qd-primary" onClick={() => camera.current?.click()}><Camera size={18}/>拍照</button><button type="button" onClick={() => album.current?.click()}><ImagePlus size={18}/>{active.length || queue.length ? '继续添加' : '选择照片'}</button></div>
        </div>
        <div className="qp-upload-queue">{active.map((file, index) => <article key={file.id}><div>{file.mimeType.startsWith('image/') ? <img src={'/api/quality-data/attachments/' + file.id + '/content'} alt={file.originalName} loading="lazy"/> : <b>PDF / 文件</b>}<button type="button" aria-label={'移除 ' + file.originalName} onClick={() => { setRemoving(file.id); setRemoveReason(''); }}><X size={15}/></button></div><footer>第 {index + 1} 份 · 已上传</footer></article>)}{queue.map((photo, index) => <article key={photo.key}><div>{photo.file.type.startsWith('image/') ? <img src={photo.url} alt={photo.file.name}/> : <b>PDF</b>}<button type="button" aria-label={'取消上传 ' + photo.file.name} onClick={() => removeQueued(photo.key)}><X size={15}/></button></div><footer><span>第 {active.length + index + 1} 份</span><button type="button" disabled={!index} aria-label="照片前移" onClick={() => move(index, -1)}><ChevronLeft size={13}/></button><button type="button" disabled={index === queue.length - 1} aria-label="照片后移" onClick={() => move(index, 1)}><ChevronRight size={13}/></button></footer></article>)}</div>
        <details className="qa-optional"><summary>补充信息 <small>选填：名称、检验人、区域、备注</small></summary><label>报表名称<input value={title} maxLength={160} placeholder={date + ' ' + paperName(type)} onChange={e => { setTitle(e.target.value); setDirty(true); }}/></label><div className="qp-two"><label>实际检验人<input value={inspector} maxLength={240} placeholder="按纸上记录填写" onChange={e => { setInspector(e.target.value); setDirty(true); }}/></label><label>区域<input value={area} maxLength={160} placeholder="例如：装配区" onChange={e => { setArea(e.target.value); setDirty(true); }}/></label></div><label>备注<textarea rows={2} value={note} maxLength={4000} placeholder="需要补充时填写" onChange={e => { setNote(e.target.value); setDirty(true); }}/></label></details>
        {current?.status === 'SUBMITTED' && <label>修订原因<textarea rows={2} value={reason} onChange={e => { setReason(e.target.value); setDirty(true); }} placeholder="说明补充或更正的内容"/></label>}
      </fieldset>
    </div>
    {leaving && <div className="qp-leave-confirm" role="alert"><span>还有未保存内容</span><button onClick={()=>setLeaving(false)}>继续填写</button><button onClick={onClose}>放弃本次修改</button></div>}
    <footer className="qp-editor-footer"><small role="status">{busy ? progress : '按报表日期保存，支持之后继续补传'}</small>{!inline && <button onClick={close} disabled={busy}>取消</button>}{current?.status !== 'SUBMITTED' && <button onClick={() => void save(false)} disabled={busy}><Save size={16}/><span>保存草稿</span></button>}<button className="qd-primary" disabled={busy} onClick={() => void save(true)}>{busy ? <Loader2 className="qd-spin" size={18}/> : <Check size={18}/>} {busy ? '保存中…' : '保存归档'}</button></footer>
    {removing && <div className="qa-remove" role="dialog" aria-modal="true" aria-label="移除照片"><b>移除照片</b><input aria-label="移除原因" placeholder="填写移除原因" value={removeReason} onChange={e => setRemoveReason(e.target.value)}/><button disabled={busy} onClick={() => setRemoving('')}>取消</button><button disabled={busy || !removeReason.trim()} onClick={() => void removeUploaded(removing)}>确认移除</button></div>}
    <GlassNotice message={error} error close={() => setError('')}/>
  </section>;
}
