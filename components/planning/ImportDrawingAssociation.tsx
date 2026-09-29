'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, FileText, Link2, Search, X, RefreshCw, FolderOpen, LockKeyhole } from 'lucide-react';
import { PdfViewer } from '@/components/PdfViewer';
import { ImageViewer } from '@/components/ImageViewer';
import { requestPreviewLeave } from '@/components/DocumentOrientation';
import { sameDrawingProduct } from '@/lib/drawing-product-identity';
import type { ImportDrawingArchive } from '@/lib/import-drawing-association';
import styles from './ImportReview.module.css';

export function DrawingAssociationCell({ customerName, specification, archive, locked = false, pending = false, onPick, onOpenChange }: {
  customerName: string; specification: string; archive?: ImportDrawingArchive | null; locked?: boolean; pending?: boolean;
  onPick: (item: ImportDrawingArchive) => void; onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [readOnly, setReadOnly] = useState(false);
  const changeOpen = (next: boolean) => { setOpen(next); onOpenChange?.(next); };
  return <><div className={`${styles.archiveCell} ${!archive ? styles.unlinked : ''}`}>
    <div className={styles.archiveIdentity}><FileText size={19}/><div><strong>{archive?.specification || (pending ? '选择图纸资料档案' : '本次新建资料档案')}</strong><small>{archive?.customerName || customerName}</small></div></div>
    {archive ? <div className={styles.fileCounts}><span className={!archive.drawingFileCount ? styles.warn : ''}>图纸 {archive.drawingFileCount ?? '—'}</span><span className={!archive.sopFileCount ? styles.warn : ''}>SOP {archive.sopFileCount ?? '—'}</span></div> : <small className={styles.warn}>{pending ? '存在多个同规格档案' : '图纸待上传'}</small>}
    <div className={styles.cellLinks}>{archive && <button type="button" onClick={() => { setReadOnly(true); changeOpen(true); }}>预览</button>}{!locked && <button type="button" onClick={() => { setReadOnly(false); changeOpen(true); }}>{archive ? '更换' : '选择已有资料'}</button>}{locked && <small><LockKeyhole size={12}/>沿用原订单资料</small>}</div>
  </div>{open && <DrawingArchivePicker customerName={customerName} specification={specification} selected={archive || null} readOnly={readOnly || locked} onClose={() => changeOpen(false)} onPick={item => { onPick(item); changeOpen(false); }}/>}</>;
}

function DrawingArchivePicker({ customerName, specification, selected, readOnly, onClose, onPick }: {
  customerName: string; specification: string; selected: ImportDrawingArchive | null; readOnly: boolean;
  onClose: () => void; onPick: (item: ImportDrawingArchive) => void;
}) {
  const [keyword, setKeyword] = useState(specification), [items, setItems] = useState<ImportDrawingArchive[]>(selected ? [selected] : []);
  const [activeId, setActiveId] = useState(selected?.id || ''), [category, setCategory] = useState('drawing'), [fileId, setFileId] = useState('');
  const [busy, setBusy] = useState(true), [error, setError] = useState(''), [refresh, setRefresh] = useState(0), [hasMore, setHasMore] = useState(false);
  const ref = useRef<HTMLElement>(null), closeRef = useRef(onClose); closeRef.current = onClose;
  useEffect(() => {
    const prior = document.activeElement as HTMLElement | null, overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden'; ref.current?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); requestPreviewLeave(() => closeRef.current()); }
      if (event.key !== 'Tab') return;
      const nodes = Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href]') || []).filter(node => node.getClientRects().length);
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', key, true);
    return () => { document.removeEventListener('keydown', key, true); document.body.style.overflow = overflow; prior?.focus(); };
  }, []);
  useEffect(() => {
    const ctrl = new AbortController(); setBusy(true); setError('');
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ customer: customerName, q: keyword, selected: selected?.id || '' });
        const response = await fetch(`/api/planning/import/drawings?${params}`, { signal: ctrl.signal, cache: 'no-store' });
        const body = await response.json(); if (!response.ok || !body.ok) throw Error(body.error || '资料读取失败');
        setItems(body.items); setHasMore(body.hasMore); setActiveId(current => body.items.some((item: ImportDrawingArchive) => item.id === current) ? current : body.items.find((item: ImportDrawingArchive) => sameDrawingProduct(item, { customerName, specification }))?.id || body.items[0]?.id || '');
      } catch (reason) { if (!ctrl.signal.aborted) setError(reason instanceof Error ? reason.message : '资料读取失败'); }
      finally { if (!ctrl.signal.aborted) setBusy(false); }
    }, 180);
    return () => { clearTimeout(timer); ctrl.abort(); };
  }, [customerName, keyword, selected?.id, specification, refresh]);
  const active = items.find(item => item.id === activeId), exact = !!active && sameDrawingProduct(active, { customerName, specification });
  const files = active?.files?.filter(file => file.category === category) || [], file = files.find(file => file.id === fileId) || files[0];
  const leave = (action: () => void) => requestPreviewLeave(action);
  return createPortal(<div className={styles.overlay}><section ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={readOnly ? '预览图纸资料' : '关联图纸资料库'} className={styles.picker}>
    <header><div><h2><Link2 size={23}/>{readOnly ? '预览图纸资料' : '关联图纸资料库'}</h2><p>本次产品 <strong>{specification}</strong><span>{customerName}</span></p></div><button aria-label="关闭资料选择" onClick={() => leave(onClose)}><X size={21}/></button></header>
    <div className={styles.pickerTools}><span>客户：<strong>{customerName}</strong></span><label><Search size={17}/><input aria-label="搜索图纸资料规格" value={keyword} onChange={event => setKeyword(event.target.value)} placeholder="搜索产品规格"/></label><small>{busy ? '正在读取…' : `${items.length} 个资料档案`}</small><button aria-label="刷新资料候选" onClick={() => setRefresh(value => value + 1)}><RefreshCw size={16}/></button></div>
    {error && <div className={styles.error} role="alert">{error}<button onClick={() => setRefresh(value => value + 1)}>重试</button></div>}
    <div className={styles.pickerBody}><div className={styles.archiveList} aria-label="图纸档案候选">{items.map(item => {
      const match = sameDrawingProduct(item, { customerName, specification });
      return <button key={item.id} aria-pressed={item.id === activeId} className={item.id === activeId ? styles.selectedArchive : ''} onClick={() => leave(() => { setActiveId(item.id); setFileId(''); })}>
        <div><FileText size={22}/><strong>{item.specification}</strong>{item.id === activeId && <Check size={17}/>}</div><small>{item.customerName} · {item.productName || '未填写品名'}</small><em className={match ? styles.match : styles.warn}>{match ? '客户、规格一致' : '相似规格 · 仅供查看'}</em><span className={styles.fileCounts}><span>图纸 {item.drawingFileCount ?? 0}</span><span>SOP {item.sopFileCount ?? 0}</span></span>
      </button>;
    })}{!busy && !items.length && <div className={styles.empty}><FolderOpen/><strong>未找到资料档案</strong><span>可修改搜索词，或返回导入页新建档案。</span></div>}{hasMore && <small>还有更多结果，请缩小搜索范围。</small>}</div>
    <div className={styles.documentPane}>{active ? <><div className={styles.documentHeading}><h3>{active.specification}</h3><small>{active.customerName} · {active.productName}</small></div><nav>{['drawing', 'sop'].map(code => <button key={code} aria-pressed={category === code} onClick={() => leave(() => { setCategory(code); setFileId(''); })}>{code === 'drawing' ? '图纸' : 'SOP'} {code === 'drawing' ? active.drawingFileCount : active.sopFileCount}</button>)}</nav>{file ? <><div className={styles.fileBar}><FileText size={16}/><select aria-label="预览资料文件" value={file.id} onChange={event => leave(() => setFileId(event.target.value))}>{files.map(item => <option key={item.id} value={item.id}>{item.name} · {item.version}</option>)}</select></div><div className={styles.documentCanvas}>{file.mimeType.startsWith('image/') ? <ImageViewer key={file.id} dashboardMode paperMode initialFitMode="fit-window" fileId={file.id} title={file.name} contentUrl={`/api/planning/import/drawings/files/${file.id}/content`} downloadUrl={`/api/planning/import/drawings/files/${file.id}/download`}/> : <PdfViewer key={file.id} dashboardMode initialFitMode="fit-window" fileId={file.id} title={file.name} contentUrl={`/api/planning/import/drawings/files/${file.id}/content`} viewUrl={`/api/planning/import/drawings/files/${file.id}/content`} downloadUrl={`/api/planning/import/drawings/files/${file.id}/download`}/>}</div></> : <div className={styles.empty}><FileText/><strong>{busy ? '正在读取文件…' : `该档案暂无${category === 'drawing' ? '图纸' : 'SOP'}`}</strong><span>关联档案后可继续补充资料</span></div>}</> : <div className={styles.empty}><FolderOpen/><strong>选择资料后在这里预览</strong></div>}</div></div>
    <footer><div><strong>{active ? `已选 ${active.specification}` : '尚未选择资料'}</strong><small>{exact ? active?.customerName : active ? '客户或规格不一致，仅可查看' : customerName}</small></div><div><button onClick={() => leave(onClose)}>{readOnly ? '返回导入' : '取消'}</button>{!readOnly && <button className={styles.primary} disabled={!exact || busy || !!error} onClick={() => active && leave(() => onPick(active))}>确认关联此档案</button>}</div></footer>
  </section></div>, document.body);
}
