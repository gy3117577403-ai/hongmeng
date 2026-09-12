'use client';
import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import MaterialPhotoUploadQueue from './MaterialPhotoUploadQueue';
import type { MaterialLibraryCaptureSessionDTO, MaterialLibraryItemDTO } from '@/lib/material-library-contract';

export default function MaterialPhotoUploadDialog({ item, onClose, onRefresh }: { item: MaterialLibraryItemDTO; onClose: () => void; onRefresh: () => Promise<void> }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [variant, setVariant] = useState(item.primarySupplierVariant?.id || ''), [batch, setBatch] = useState('');
  const [session, setSession] = useState<MaterialLibraryCaptureSessionDTO | null>(null), [existing, setExisting] = useState(false);
  const [loading, setLoading] = useState(true), [saving, setSaving] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => {
    dialog.current?.showModal(); let cancelled = false;
    void fetch(`/api/material-library/items/${item.id}/capture`).then(async response => {
      const body = await response.json(); if (!response.ok) throw new Error(body.error || '来料记录读取失败');
      if (!cancelled && body.session) { setVariant(body.session.supplierVariantId || ''); setBatch(body.session.draftBatchNumber || ''); setExisting(true); }
    }).catch(reason => { if (!cancelled) setError(reason.message); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [item.id]);
  async function prepare() {
    setSaving(true); setError('');
    try {
      const response = await fetch(`/api/material-library/items/${item.id}/capture`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ supplierVariantId: variant || null, batchNumber: batch || null }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error || '无法开始上传'); setSession(body.session);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '无法开始上传'); } finally { setSaving(false); }
  }
  function close() { if (busy && !window.confirm('还有照片未上传完成，离开后需要重新选择未完成照片。确定离开？')) return; onClose(); }
  return <dialog className="material-photo-dialog" ref={dialog} onCancel={event => { event.preventDefault(); close(); }} aria-labelledby="material-upload-title">
    <header><div><small>照片归属</small><h2 id="material-upload-title">上传物料照片</h2></div><button type="button" aria-label="关闭上传" onClick={close}><X /></button></header>
    <div className="material-photo-dialog-body">
      <div className="material-upload-target"><strong>{item.code} · {item.name}</strong><span>{session ? `${session.sessionNo} · ${session.draftBatchNumber || '未填写批次'}` : existing ? '继续本次未归档来料记录' : '建立本次来料记录'}</span></div>
      {!session ? <><label>供应商型号<select aria-label="上传供应商型号" disabled={loading || existing} value={variant} onChange={event => setVariant(event.target.value)}><option value="">未设置供应商型号</option>{item.supplierVariants.map(value => <option value={value.id} key={value.id}>{value.supplierName || '未设置供应商'} · {value.manufacturerModel || value.supplierPartNumber}</option>)}</select></label>
        <label>本次来料批次<input aria-label="上传来料批次" disabled={loading || existing} value={batch} maxLength={120} placeholder="填写本次批次，不沿用上次记录" onChange={event => setBatch(event.target.value)} /></label>
        <button type="button" className="primary" disabled={loading || saving || Boolean(error)} onClick={() => void prepare()}>{saving ? '正在准备…' : '确认归属，选择照片'}</button></>
        : <MaterialPhotoUploadQueue sessionId={session.id} supplierVariantId={session.supplierVariantId} batchNumber={session.draftBatchNumber} onComplete={onRefresh} onBusyChange={setBusy} />}
      {error && <p role="alert" className="material-upload-notice">{error}<button type="button" onClick={() => setError('')}>重试</button></p>}
    </div>
    <footer><span>照片会立即显示在当前物料，检验结论可继续在本批记录中填写。</span><button type="button" onClick={close}>{session ? '完成上传' : '取消'}</button></footer>
  </dialog>;
}
