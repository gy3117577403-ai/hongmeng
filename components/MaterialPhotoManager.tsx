'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckSquare, ChevronLeft, ChevronRight, Trash2, Undo2, Upload, X } from 'lucide-react';
import Image from 'next/image';
import MaterialEvidenceViewer from './MaterialEvidenceViewer';
import type { MaterialLibraryPhotoDTO } from '@/lib/material-library-contract';

export default function MaterialPhotoManager({ itemId, photos, activeId, onActiveChange, onRotate, onRefresh, onUpload, canDelete, readOnly = false }: {
  itemId: string; photos: MaterialLibraryPhotoDTO[]; activeId: string; onActiveChange: (id: string) => void;
  onRotate: (photo: MaterialLibraryPhotoDTO, rotation: number) => void | Promise<void>;
  onRefresh: () => Promise<void>; onUpload: () => void; canDelete: boolean; readOnly?: boolean;
}) {
  const [manage, setManage] = useState(false), [selected, setSelected] = useState<string[]>([]);
  const [trash, setTrash] = useState(false), [trashPhotos, setTrashPhotos] = useState<MaterialLibraryPhotoDTO[]>([]), [trashTotal, setTrashTotal] = useState(0), [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const [deleting, setDeleting] = useState<MaterialLibraryPhotoDTO[]>([]), [reason, setReason] = useState('上传错误');
  const trashDialog = useRef<HTMLDialogElement>(null), deleteDialog = useRef<HTMLDialogElement>(null);
  const loadTrash = useCallback(async () => {
    const response = await fetch(`/api/material-library/items/${itemId}/photos?page=${page}`, { cache: 'no-store' });
    const body = await response.json(); if (!response.ok) throw new Error(body.error || '回收站读取失败');
    setTrashPhotos(body.photos); setTrashTotal(body.total); setSelected([]);
    if (!body.photos.length && page > 1) setPage(value => value - 1);
  }, [itemId, page]);
  useEffect(() => { if (trash) { trashDialog.current?.showModal(); void loadTrash().catch(reason => setError(reason.message)); } }, [loadTrash, trash]);
  useEffect(() => { if (deleting.length) deleteDialog.current?.showModal(); }, [deleting]);
  useEffect(() => { setSelected(current => current.filter(id => (trash ? trashPhotos : photos).some(photo => photo.id === id))); }, [photos, trash, trashPhotos]);
  useEffect(() => { if (!message) return; const timer = window.setTimeout(() => setMessage(''), 3500); return () => window.clearTimeout(timer); }, [message]);
  function toggle(id: string) { setSelected(values => values.includes(id) ? values.filter(value => value !== id) : values.length < 100 ? [...values, id] : values); }
  async function mutate(action: 'DELETE' | 'RESTORE', targets: MaterialLibraryPhotoDTO[]) {
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/material-library/items/${itemId}/photos`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ids: targets.map(photo => photo.id), reason, expectedUpdatedAt: Object.fromEntries(targets.map(photo => [photo.id, photo.updatedAt])) }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error || '照片操作失败');
      if (action === 'DELETE') { setDeleting([]); deleteDialog.current?.close(); }
      await onRefresh(); if (trash) await loadTrash(); setSelected([]);
      setMessage(action === 'DELETE' ? `已移入照片回收站 ${body.changed} 张` : `已恢复 ${body.changed} 张照片`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '操作失败'); } finally { setBusy(false); }
  }
  function askDelete(targets: MaterialLibraryPhotoDTO[]) { setError(''); setReason('上传错误'); setDeleting(targets); }
  return <section className="material-photo-manager">
    <div className="material-photo-actions"><strong>照片 <b>{photos.length}</b> 张</strong><div>
      {!readOnly && <button type="button" onClick={onUpload}><Upload size={15} />上传照片</button>}
      {canDelete && !readOnly && <><button type="button" className={manage ? 'active' : ''} onClick={() => { setManage(value => !value); setSelected([]); }}><CheckSquare size={15} />{manage ? '退出管理' : '管理照片'}</button>
      <button type="button" onClick={() => { setError(''); setSelected([]); setTrash(true); }}><Trash2 size={15} />照片回收站</button></>}
    </div></div>
    {error && !trash && !deleting.length && <p role="alert" className="material-upload-notice">{error}</p>}
    {manage ? <div className="material-photo-manage-content"><div className="material-photo-selection"><label><input type="checkbox" aria-label="全选物料照片" checked={photos.length > 0 && selected.length === Math.min(100, photos.length)} onChange={event => setSelected(event.target.checked ? photos.slice(0, 100).map(photo => photo.id) : [])} />全选（最多 100 张）</label><span>已选 {selected.length} 张</span><button type="button" className="danger" disabled={!selected.length || busy} onClick={() => askDelete(photos.filter(photo => selected.includes(photo.id)))}><Trash2 size={15} />删除所选</button></div>
      <div className="material-photo-manage-grid">{photos.map(photo => <label key={photo.id} className={selected.includes(photo.id) ? 'selected' : ''}><input type="checkbox" aria-label={`选择照片 ${photo.originalName}`} checked={selected.includes(photo.id)} onChange={() => toggle(photo.id)} />
        {/* eslint-disable-next-line @next/next/no-img-element */}<Image unoptimized width={384} height={384} src={photo.thumbnailUrl || photo.contentUrl} alt={photo.originalName} loading="lazy" style={{ transform: `rotate(${photo.rotation}deg)` }} />
        <strong>{photo.isCover ? '封面 · ' : ''}{photo.originalName}</strong><small>{photo.uploadedBy || '未记录上传人'}</small></label>)}</div></div>
      : <MaterialEvidenceViewer photos={photos} activePhotoId={activeId} onActivePhotoChange={onActiveChange} onRotate={readOnly ? undefined : onRotate} onDelete={canDelete && !readOnly ? photo => askDelete([photo]) : undefined} />}
    {message && <div className="material-photo-feedback" role="status">{message}</div>}
    {trash && <dialog ref={trashDialog} className="material-photo-dialog" aria-labelledby="material-trash-title" onCancel={event => { event.preventDefault(); if (!busy) { setTrash(false); setSelected([]); } }}>
      <header><div><small>当前物料 · 可恢复</small><h2 id="material-trash-title">照片回收站 <small>{trashTotal} 张</small></h2></div><button type="button" aria-label="关闭照片回收站" disabled={busy} onClick={() => { setTrash(false); setSelected([]); }}><X /></button></header>
      <div className="material-photo-dialog-body">
        <div className="material-photo-selection"><label><input type="checkbox" aria-label="全选本页回收站照片" checked={trashPhotos.length > 0 && selected.length === trashPhotos.length} onChange={event => setSelected(event.target.checked ? trashPhotos.map(photo => photo.id) : [])} />全选本页</label><button type="button" disabled={busy || !selected.length} onClick={() => void mutate('RESTORE', trashPhotos.filter(photo => selected.includes(photo.id)))}><Undo2 size={15} />恢复所选 {selected.length || ''}</button></div>
        {error && <p role="alert" className="material-upload-notice">{error}</p>}
        <div className="material-photo-manage-grid">{trashPhotos.map(photo => <article key={photo.id}>
          <label><input type="checkbox" aria-label={`选择恢复 ${photo.originalName}`} checked={selected.includes(photo.id)} onChange={() => toggle(photo.id)} />
          {/* eslint-disable-next-line @next/next/no-img-element */}<Image unoptimized width={384} height={384} src={`${photo.thumbnailUrl || photo.contentUrl}&trash=1`} alt={photo.originalName} loading="lazy" /><strong>{photo.originalName}</strong></label>
          <small>{photo.sessionNo} · {photo.batchNumber || '未填写批次'}</small><small>{photo.deletedByName || '未记录删除人'} · {photo.deletedAt ? new Date(photo.deletedAt).toLocaleString('zh-CN') : ''}</small><small>{photo.deletedReason || '历史删除记录'}</small>
          <button type="button" disabled={busy} onClick={() => void mutate('RESTORE', [photo])}><Undo2 size={14} />恢复照片</button></article>)}</div>
        {!trashPhotos.length && <p className="material-photo-empty">照片回收站为空</p>}
      </div><footer><span>恢复到原来的物料和来料记录</span><button type="button" disabled={page <= 1 || busy} onClick={() => setPage(value => value - 1)} aria-label="回收站上一页"><ChevronLeft /></button><span>{page} / {Math.max(1, Math.ceil(trashTotal / 40))}</span><button type="button" disabled={page * 40 >= trashTotal || busy} onClick={() => setPage(value => value + 1)} aria-label="回收站下一页"><ChevronRight /></button></footer>
    </dialog>}
    {!!deleting.length && <dialog ref={deleteDialog} className="material-photo-dialog small" aria-labelledby="material-photo-delete-title" onCancel={event => { event.preventDefault(); if (!busy) setDeleting([]); }}><header><h2 id="material-photo-delete-title">删除 {deleting.length} 张照片</h2><button type="button" aria-label="取消删除" disabled={busy} onClick={() => setDeleting([])}><X /></button></header><div className="material-photo-dialog-body"><p>移入当前物料的照片回收站，之后可恢复。</p><div className="material-delete-preview">{deleting.slice(0, 8).map(photo => <span key={photo.id}>{/* eslint-disable-next-line @next/next/no-img-element */}<Image unoptimized width={384} height={384} src={photo.thumbnailUrl || photo.contentUrl} alt={photo.originalName} /><small>{photo.originalName}</small></span>)}</div><label>删除原因<select value={reason} onChange={event => setReason(event.target.value)}><option>上传错误</option><option>重复照片</option><option>照片不清晰</option><option>资料更正</option></select></label>{error && <p className="material-upload-notice" role="alert">{error}</p>}</div><footer><button type="button" disabled={busy} onClick={() => setDeleting([])}>取消</button><button type="button" className="danger" disabled={busy} onClick={() => void mutate('DELETE', deleting)}>{busy ? '正在处理…' : '确认移入回收站'}</button></footer></dialog>}
  </section>;
}
