'use client';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRightLeft, Check, FileUp, X } from 'lucide-react';
import type { DrawingLibraryItemDTO, ResourceCategoryDTO, SopStageDTO } from '@/types';
import { PdfViewer } from '@/components/PdfViewer';
import '@/app/drawing-quick-actions.css';

export default function DrawingQuickActions({ item, categories, enabled, onChanged, onMessage }: {
  item: DrawingLibraryItemDTO; categories: ResourceCategoryDTO[]; enabled: boolean;
  onChanged: (fileId?: string, categoryId?: string) => Promise<void>; onMessage: (message: string) => void;
}) {
  const [kind, setKind] = useState<'drawing' | 'sop' | null>(null);
  const [target, setTarget] = useState(''), [file, setFile] = useState<File | null>(null);
  const [reason, setReason] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [savingStatus, setSavingStatus] = useState(false), [preview, setPreview] = useState('');
  const panel = useRef<HTMLElement>(null), picker = useRef<HTMLInputElement>(null);
  const category = categories.find(c => c.code === kind);
  const current = item.files.filter(f => f.categoryId === category?.id);
  const selected = current.find(f => f.id === target);
  const noun = kind === 'sop' ? 'SOP' : '图纸';
  function open(value: 'drawing' | 'sop') {
    const cat = categories.find(c => c.code === value), files = item.files.filter(f => f.categoryId === cat?.id);
    setKind(value); setTarget(files.length === 1 ? files[0].id : ''); setFile(null); setReason(''); setError('');
  }
  useEffect(() => { if (!file) { setPreview(''); return; } const url = URL.createObjectURL(file); setPreview(url); return () => URL.revokeObjectURL(url); }, [file]);
  useEffect(() => {
    if (!kind) return;
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.key === 'Escape' && panel.current?.querySelector('.preview-fullscreen-backdrop')) return;
      if (e.key === 'Escape' && !busy) { e.stopPropagation(); setKind(null); }
      if (e.key !== 'Tab') return;
      const nodes = Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled)') || []);
      const first = nodes[0], last = nodes.at(-1);
      if (e.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); previous?.focus(); };
  }, [kind, busy]);
  async function status(patch: { sopStage?: SopStageDTO; needsConfirmation?: boolean }) {
    if (savingStatus) return;
    setSavingStatus(true);
    try {
      const response = await fetch(`/api/drawing-library/${item.id}/metadata`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error || '状态保存失败');
      await onChanged(); onMessage('资料状态已保存');
    } catch (e) { onMessage(e instanceof Error ? e.message : '保存失败'); } finally { setSavingStatus(false); }
  }
  async function submit() {
    if (!file || !category || busy || current.length && !selected) return;
    setBusy(true); setError('');
    try {
      const form = new FormData(); form.set('categoryId', category.id); form.set('file', file); form.set('remark', reason);
      if (selected) { form.set('replaceFileId', selected.id); form.set('discardPrevious', 'true'); }
      const response = await fetch(`/api/drawing-library/${item.id}/files/upload`, { method: 'POST', body: form });
      const body = await response.json(); if (!response.ok) throw new Error(body.error || '文件未保存，请重试');
      setKind(null); setFile(null);
      await onChanged(body.file.id, category.id);
      onMessage(selected ? `${noun}已更换，新文件已生效；审核状态将自动更新` : `${noun}已上传`);
    } catch (e) { setError(e instanceof Error ? e.message : '上传失败，原文件保持不变'); } finally { setBusy(false); }
  }
  return <>
    <div className="drawing-quick-actions" aria-label="资料快捷操作">
      <label className="dq-stage"><span>阶段</span><select aria-label="产品资料阶段" disabled={!enabled || savingStatus} value={item.sopMetadata?.sopStage || ''} onChange={e => void status({ sopStage: e.target.value as SopStageDTO })}><option value="" disabled>未登记</option><option value="standard">标准</option><option value="new_product">样品 / 新品</option><option value="validating">验证中</option></select></label>
      <button type="button" className={`dq-confirm ${item.needsConfirmation ? 'active' : ''}`} aria-pressed={!!item.needsConfirmation} disabled={!enabled || savingStatus} onClick={() => void status({ needsConfirmation: !item.needsConfirmation })}><Check size={14}/>需确认</button>
      {enabled && <div className="dq-replace-group"><button type="button" onClick={() => open('drawing')}><ArrowRightLeft size={14}/>{item.files.some(f => categories.find(c => c.id === f.categoryId)?.code === 'drawing') ? '更换图纸' : '上传图纸'}</button><button type="button" onClick={() => open('sop')}><ArrowRightLeft size={14}/>{item.files.some(f => categories.find(c => c.id === f.categoryId)?.code === 'sop') ? '更换 SOP' : '上传 SOP'}</button></div>}
    </div>
    {kind && createPortal(<div className="dq-overlay"><section ref={panel} tabIndex={-1} className="dq-dialog" role="dialog" aria-modal="true" aria-labelledby="drawing-replacement-title">
      <header><div><small>{item.specification}</small><h2 id="drawing-replacement-title">{current.length ? '更换' : '上传'}{noun}</h2></div><button aria-label="关闭更换窗口" disabled={busy} onClick={() => setKind(null)}><X size={20}/></button></header>
      <div className="dq-dialog-body"><aside>
        {current.length > 1 ? <label>选择要更换的文件<select aria-label="待更换文件" disabled={busy} value={target} onChange={e => setTarget(e.target.value)}><option value="">请选择一份文件</option>{current.map(f => <option key={f.id} value={f.id}>{f.displayName || f.originalName} · {f.version}</option>)}</select></label> : selected && <div className="dq-current"><small>当前文件</small><strong>{selected.displayName || selected.originalName}</strong><span>{selected.version}</span></div>}
        <input ref={picker} hidden type="file" accept="application/pdf,.pdf,image/*" disabled={busy} onChange={e => { setFile(e.target.files?.[0] || null); setError(''); }}/>
        <button className="dq-upload" disabled={busy || current.length > 1 && !target} onClick={() => picker.current?.click()}><FileUp size={26}/><strong>{file ? '重新选择新文件' : `选择新${noun}`}</strong><span>{file?.name || 'PDF 或照片 · 可先预览核对'}</span></button>
        <label>修改说明 <small>选填</small><textarea disabled={busy} maxLength={500} value={reason} onChange={e => setReason(e.target.value)} placeholder="简要说明本次修改内容"/></label>
        {selected && <p className="dq-replace-note">确认后用新文件替换这一份{noun}，旧文件不进入回收站。其他文件保持原样。</p>}
        {error && <p role="alert" className="dq-error">{error}</p>}
      </aside><div className="dq-local-preview">{preview ? file?.type.startsWith('image/') ? <img src={preview} alt="待上传文件预览"/> : <div className="dq-pdf-preview"><PdfViewer fileId="local-replacement" title={file?.name || '待上传 PDF'} contentUrl={preview} downloadUrl={preview} viewUrl={preview} dashboardMode initialFitMode="fit-window"/></div> : <div><FileUp size={44}/><strong>先核对，再更换</strong><span>这里预览你选择的新文件</span></div>}</div></div>
      <footer><span>{busy ? '正在保存，请稍候…' : '审核中、已通过、已退回均可更换'}</span><button disabled={busy} onClick={() => setKind(null)}>取消</button><button className="primary" disabled={busy || !file || current.length > 0 && !selected} onClick={() => void submit()}>{busy ? '保存中…' : selected ? '确认更换' : '确认上传'}</button></footer>
    </section></div>, document.body)}
  </>;
}
