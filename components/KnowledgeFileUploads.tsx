'use client';
import { useEffect, useRef, useState } from 'react';
import { KNOWLEDGE_FILE_ACCEPT, KNOWLEDGE_FILE_HELP, knowledgeFileLabel } from '@/lib/knowledge-files';

type Upload = { key: string; file: File; state: 'pending' | 'uploading' | 'done' | 'error'; progress: number; id?: string; error?: string };
type Receipt = { ok: boolean; attachment?: { id: string }; error?: string };

export function useKnowledgeUploads() {
  const [files, setFiles] = useState<Upload[]>([]);
  const [maxSize, setMaxSize] = useState<number | null>(null);
  const [selectionError, setSelectionError] = useState('');
  const active = useRef(false);
  useEffect(() => {
    void fetch('/api/knowledge/attachments/upload').then(r => r.json()).then(data => { if (data.ok) setMaxSize(data.maxBytes); }).catch(() => {});
  }, []);
  const update = (key: string, value: Partial<Upload>) => setFiles(current => current.map(file => file.key === key ? { ...file, ...value } : file));
  async function upload(item: Upload) {
    if (maxSize && item.file.size > maxSize) { update(item.key, { state: 'error', error: `单文件不能超过 ${maxSize / 1024 / 1024} MB` }); return; }
    update(item.key, { state: 'uploading', error: undefined, progress: 0 });
    try {
      const result = await new Promise<Receipt>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/api/knowledge/attachments/upload');
        xhr.responseType = 'json';
        xhr.timeout = 180000;
        xhr.upload.onprogress = event => { if (event.lengthComputable) update(item.key, { progress: Math.min(99, Math.round(event.loaded / event.total * 100)) }); };
        xhr.onload = () => xhr.status >= 200 && xhr.status < 300 && xhr.response?.ok ? resolve(xhr.response) : reject(new Error(xhr.response?.error || '上传失败，请重试'));
        xhr.onerror = () => reject(new Error('网络异常，文件和已填内容已保留，可重试'));
        xhr.ontimeout = () => reject(new Error('上传超时，文件和已填内容已保留，可重试'));
        const body = new FormData(); body.append('file', item.file); xhr.send(body);
      });
      if (!result.attachment) throw new Error('未收到附件上传结果，请重试');
      update(item.key, { state: 'done', progress: 100, id: result.attachment.id });
    } catch (error) { update(item.key, { state: 'error', error: error instanceof Error ? error.message : '上传失败，请重试' }); }
  }
  async function add(selected: FileList | null) {
    if (!selected?.length || active.current) return;
    if (files.length + selected.length > 30) { setSelectionError('每次最多上传 30 个附件，请减少选择数量后重试'); return; }
    setSelectionError('');
    active.current = true;
    const items: Upload[] = Array.from(selected).map(file => ({ key: crypto.randomUUID(), file, state: 'pending', progress: 0 }));
    setFiles(current => [...current, ...items]);
    try { for (const item of items) await upload(item); } finally { active.current = false; }
  }
  async function retry(file: Upload) {
    if (active.current) return;
    active.current = true;
    try { await upload(file); } finally { active.current = false; }
  }
  function remove(file: Upload) {
    if (active.current) return;
    if (file.id) void fetch(`/api/knowledge/attachments/${file.id}`, { method: 'DELETE' }).catch(() => {});
    setFiles(current => current.filter(item => item.key !== file.key));
  }
  function clear(discard = false) {
    if (discard) files.forEach(file => { if (file.id) void fetch(`/api/knowledge/attachments/${file.id}`, { method: 'DELETE' }).catch(() => {}); });
    setFiles([]);
    setSelectionError('');
  }
  return { files, maxSize, selectionError, add, retry, remove, clear, uploading: files.some(file => file.state === 'pending' || file.state === 'uploading') };
}

export function KnowledgeFileUploads({ uploads, disabled, onFirstFile }: {
  uploads: ReturnType<typeof useKnowledgeUploads>; disabled: boolean; onFirstFile: (name: string) => void;
}) {
  return <section className="hm-knowledge-upload-queue wide" aria-label="上传知识附件">
    <strong>知识附件（正文或附件至少填写一项）</strong>
    <p>{KNOWLEDGE_FILE_HELP}{uploads.maxSize ? ` 单文件上限 ${uploads.maxSize / 1024 / 1024} MB。` : ''}可多选，上传完成后点击“保存知识”。</p>
    {uploads.selectionError && <p role="alert">{uploads.selectionError}</p>}
    <input type="file" aria-label="选择知识附件" accept={KNOWLEDGE_FILE_ACCEPT} multiple disabled={disabled || uploads.uploading || uploads.files.length >= 30} onChange={event => {
      if (event.target.files?.[0]) onFirstFile(event.target.files[0].name);
      void uploads.add(event.target.files); event.target.value = '';
    }} />
    {uploads.files.map(file => <div className="hm-knowledge-upload-row" key={file.key}>
      <span><strong>{file.file.name}</strong><small>{knowledgeFileLabel(file.file.name.split('.').pop()?.toLowerCase() || '')} · {(file.file.size / 1024).toFixed(1)} KB · {file.state === 'done' ? '已上传，待保存' : file.state === 'error' ? file.error : `上传中 ${file.progress}%`}</small></span>
      {file.state === 'error' && <button type="button" disabled={disabled || uploads.uploading} onClick={() => void uploads.retry(file)}>重试</button>}
      <button type="button" aria-label={`移除本次附件 ${file.file.name}`} disabled={disabled || uploads.uploading} onClick={() => uploads.remove(file)}>移除</button>
    </div>)}
  </section>;
}
