'use client';

import { Camera, CheckCircle2, ImagePlus, RotateCcw, Upload, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

type Entry = { id: string; file: File; url: string; source: string; variant: string; batch: string; status: 'QUEUED' | 'UPLOADING' | 'SUCCESS' | 'ERROR'; progress: number; error?: string };
export default function MaterialPhotoUploadQueue({ sessionId, supplierVariantId = '', batchNumber = '', camera = false, disabled = false, onComplete, onBusyChange }: {
  sessionId: string; supplierVariantId?: string | null; batchNumber?: string | null; camera?: boolean; disabled?: boolean; onComplete: () => void | Promise<void>; onBusyChange?: (busy: boolean) => void;
}) {
  const [entries, setEntries] = useState<Entry[]>([]), [running, setRunning] = useState(false), [notice, setNotice] = useState('');
  const entriesRef = useRef<Entry[]>([]), runningRef = useRef(false), mounted = useRef(true);
  const input = useRef<HTMLInputElement>(null), cameraInput = useRef<HTMLInputElement>(null);
  const requests = useRef(new Set<XMLHttpRequest>()), urls = useRef(new Set<string>());
  const callback = useRef(onComplete), busyCallback = useRef(onBusyChange);
  callback.current = onComplete; busyCallback.current = onBusyChange;
  function publish(next: Entry[]) { entriesRef.current = next; if (mounted.current) setEntries(next); }
  function patch(id: string, values: Partial<Entry>) { publish(entriesRef.current.map(entry => entry.id === id ? { ...entry, ...values } : entry)); }
  const pending = entries.some(entry => entry.status !== 'SUCCESS');
  useEffect(() => { busyCallback.current?.(pending); }, [pending]);
  useEffect(() => {
    mounted.current = true;
    const currentRequests = requests.current, currentUrls = urls.current;
    return () => { mounted.current = false; currentRequests.forEach(xhr => xhr.abort()); currentUrls.forEach(url => URL.revokeObjectURL(url)); busyCallback.current?.(false); };
  }, []);
  useEffect(() => {
    if (!pending) return;
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', guard); return () => window.removeEventListener('beforeunload', guard);
  }, [pending]);
  function add(files: FileList | File[], source: string) {
    if (disabled) return;
    setNotice('');
    const picked = Array.from(files), room = Math.max(0, 20 - entriesRef.current.filter(entry => entry.status !== 'SUCCESS').length);
    const accepted: Entry[] = [];
    for (const file of picked.slice(0, room)) {
      if (!/^image\/(jpeg|png|webp)$/.test(file.type) || !file.size || file.size > 50 * 1024 * 1024) { setNotice('部分文件不受支持：请选择 50 MB 以内的 JPG、PNG 或 WEBP 图片。'); continue; }
      const url = URL.createObjectURL(file); urls.current.add(url);
      accepted.push({ id: crypto.randomUUID(), file, url, source, variant: supplierVariantId || '', batch: batchNumber || '', status: 'QUEUED', progress: 0 });
    }
    if (picked.length > room) setNotice('每批最多 20 张，完成后可继续添加。');
    const old = entriesRef.current.filter(entry => entry.status !== 'SUCCESS');
    entriesRef.current.filter(entry => entry.status === 'SUCCESS').forEach(entry => { URL.revokeObjectURL(entry.url); urls.current.delete(entry.url); });
    publish([...old, ...accepted]);
  }
  function send(entry: Entry): Promise<void> {
    return new Promise(resolve => {
      const xhr = new XMLHttpRequest(); requests.current.add(xhr);
      xhr.open('POST', `/api/material-library/sessions/${sessionId}/photos`); xhr.timeout = 120_000;
      xhr.upload.onprogress = event => { if (event.lengthComputable) patch(entry.id, { progress: Math.min(95, Math.round(event.loaded / event.total * 95)) }); };
      const finish = (error?: string) => {
        requests.current.delete(xhr);
        patch(entry.id, error ? { status: 'ERROR', error } : { status: 'SUCCESS', progress: 100, error: undefined }); resolve();
      };
      xhr.onload = () => {
        let body: { ok?: boolean; error?: string } = {};
        try { body = JSON.parse(xhr.responseText); } catch { /* Invalid response remains a retryable failure. */ }
        finish(xhr.status >= 200 && xhr.status < 300 && body.ok ? undefined : body.error || '上传失败，请重试');
      };
      xhr.onerror = () => finish('网络中断，请重试'); xhr.ontimeout = () => finish('上传超时，请重试'); xhr.onabort = () => finish('上传已取消');
      const form = new FormData(); form.set('file', entry.file); form.set('clientMutationId', entry.id); form.set('captureSource', entry.source); form.set('compact', '1'); form.set('targetSupplierVariantId', entry.variant); form.set('targetBatchNumber', entry.batch); xhr.send(form);
    });
  }
  async function start(retry = false) {
    if (runningRef.current || disabled) return;
    if (retry) publish(entriesRef.current.map(entry => entry.status === 'ERROR' ? { ...entry, status: 'QUEUED', error: undefined, progress: 0 } : entry));
    runningRef.current = true; setRunning(true);
    async function worker() {
      while (mounted.current) {
        const entry = entriesRef.current.find(value => value.status === 'QUEUED');
        if (!entry) break;
        patch(entry.id, { status: 'UPLOADING' }); await send(entry);
      }
    }
    try { await Promise.all([worker(), worker()]); await callback.current(); }
    catch { if (mounted.current) setNotice('照片已上传，列表同步失败，请刷新查看。'); }
    finally { runningRef.current = false; if (mounted.current) setRunning(false); }
  }
  function remove(entry: Entry) {
    if (entry.status === 'UPLOADING') return;
    URL.revokeObjectURL(entry.url); urls.current.delete(entry.url); publish(entriesRef.current.filter(value => value.id !== entry.id));
  }
  return <section className="material-upload-queue" aria-label="批量照片上传"
    onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); add(event.dataTransfer.files, 'DESKTOP_ALBUM'); }}>
    <div className="material-upload-choose">
      {camera && <button type="button" disabled={disabled} onClick={() => cameraInput.current?.click()}><Camera size={18} />手机拍照</button>}
      <button type="button" className="primary" disabled={disabled} onClick={() => input.current?.click()}><ImagePlus size={18} />{camera ? '相册多选' : '选择照片（可多选）'}</button>
      <span>每批最多 20 张{!camera && '，也可拖入照片'}</span>
      <input hidden ref={input} type="file" multiple accept="image/jpeg,image/png,image/webp" onChange={event => { if (event.target.files) add(event.target.files, camera ? 'MOBILE_ALBUM' : 'DESKTOP_ALBUM'); event.target.value = ''; }} />
      <input hidden ref={cameraInput} type="file" accept="image/*" capture="environment" onChange={event => { if (event.target.files) add(event.target.files, 'MOBILE_CAMERA'); event.target.value = ''; }} />
    </div>
    {disabled && <p className="material-upload-notice">请先保存供应商型号或批次的修改，再选择照片上传。</p>}
    {notice && <p className="material-upload-notice" role="status">{notice}</p>}
    {!!entries.length && <>
      <div className="material-upload-grid">{entries.map(entry => <article key={entry.id} className={entry.status.toLowerCase()}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={entry.url} alt={entry.file.name} />
        {entry.status !== 'UPLOADING' && entry.status !== 'SUCCESS' && <button type="button" aria-label={`移除待上传照片 ${entry.file.name}`} onClick={() => remove(entry)}><X size={15} /></button>}
        <strong title={entry.file.name}>{entry.file.name}</strong>
        <span>{entry.status === 'SUCCESS' ? <><CheckCircle2 size={14} />已上传</> : entry.status === 'ERROR' ? entry.error : entry.status === 'UPLOADING' ? `上传中 ${entry.progress}%` : '等待上传'}</span>
        <progress max={100} value={entry.progress} aria-label={`${entry.file.name} 上传进度`} />
      </article>)}</div>
      <footer><span>成功 {entries.filter(entry => entry.status === 'SUCCESS').length} / {entries.length} 张{entries.some(entry => entry.status === 'ERROR') && ` · 失败 ${entries.filter(entry => entry.status === 'ERROR').length} 张`}</span>
        {entries.some(entry => entry.status === 'ERROR') && <button type="button" disabled={running} onClick={() => void start(true)}><RotateCcw size={16} />重试失败项</button>}
        {entries.some(entry => entry.status === 'QUEUED') && <button type="button" className="primary" disabled={running} onClick={() => void start()}><Upload size={16} />开始上传</button>}
        {running && <span role="status">正在上传，请保持页面打开</span>}
      </footer>
    </>}
  </section>;
}
