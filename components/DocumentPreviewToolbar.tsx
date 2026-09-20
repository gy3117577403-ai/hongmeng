'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Maximize, MoreHorizontal, RotateCcw, RotateCw, X } from 'lucide-react';
import type { DocumentOrientationController } from './DocumentOrientation';
import type { PreviewGestureController } from './usePreviewGestures';
import styles from './DocumentPreviewToolbar.module.css';

type Props = {
  orientation: DocumentOrientationController;
  gestures: PreviewGestureController;
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  loading: boolean;
  fullscreen: boolean;
  showFullscreen?: boolean;
  onFullscreen?: () => void;
  onClose?: () => void;
  downloadUrl: string;
  onOpenSystem: () => void;
};

/** Shared by drawing and SOP previews; deliberately isolated from form/control CSS. */
export function DocumentPreviewToolbar({ orientation: o, gestures: g, page, pageCount, onPageChange, loading, fullscreen, showFullscreen = true, onFullscreen, onClose, downloadUrl, onOpenSystem }: Props) {
  const [menu, setMenu] = useState<'direction' | 'more' | null>(null);
  const [allPages, setAllPages] = useState(false);
  const [pageText, setPageText] = useState(String(page));
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const blocked = loading || !o.ready || o.saving;
  useEffect(() => setPageText(String(page)), [page]);
  useEffect(() => {
    if (!menu) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setMenu(null); };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.stopPropagation(); setMenu(null); trigger.current?.focus(); }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape, true);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape, true); };
  }, [menu]);
  function commitPage() {
    const next = Number(pageText);
    if (Number.isInteger(next) && next >= 1 && next <= pageCount) onPageChange(next);
    else setPageText(String(page));
  }
  return <div ref={root} className={styles.toolbar} aria-label="图纸预览工具栏">
    <div className={styles.group} role="group" aria-label="翻页">
      <button type="button" aria-label="上一页" disabled={loading || page <= 1} onClick={() => onPageChange(page - 1)}><ChevronLeft /></button>
      <label className={styles.pageField}><input aria-label="预览页码" inputMode="numeric" value={pageText} disabled={loading || !pageCount} onChange={e => setPageText(e.target.value)} onBlur={commitPage} onKeyDown={e => { if (e.key === 'Enter') { commitPage(); e.currentTarget.blur(); } }} /><span>/ {pageCount || '—'}</span></label>
      <button type="button" aria-label="下一页" disabled={loading || !pageCount || page >= pageCount} onClick={() => onPageChange(page + 1)}><ChevronRight /></button>
    </div>
    <div className={styles.group} role="group" aria-label="缩放与适配">
      <button type="button" aria-label="缩小" disabled={loading} onClick={() => g.zoomBy(1 / 1.15)}>−</button>
      <output className={styles.zoom} aria-label="缩放比例">{Math.round(g.zoom * 100)}%</output>
      <button type="button" aria-label="放大" disabled={loading} onClick={() => g.zoomBy(1.15)}>＋</button>
      <button type="button" aria-pressed={g.fitMode === 'fit-window'} disabled={loading} onClick={() => g.setFitMode('fit-window')}>适屏</button>
      <button type="button" aria-pressed={g.fitMode === 'fit-width'} disabled={loading} onClick={() => g.setFitMode('fit-width')}>适宽</button>
    </div>
    <div className={styles.group}>
      <div className={styles.menuAnchor}>
        <button type="button" aria-expanded={menu === 'direction'} aria-controls={`direction-${o.key}`} onClick={e => { trigger.current = e.currentTarget; setMenu(menu === 'direction' ? null : 'direction'); }}><RotateCw />方向{o.dirty && <i title="方向未保存" />}</button>
        {menu === 'direction' && <div className={styles.popover} id={`direction-${o.key}`} role="group" aria-label="阅读方向设置">
          <div className={styles.rotationActions}><button type="button" disabled={blocked} onClick={() => o.rotate(-90, pageCount, allPages)}><RotateCcw />左转 90°</button><button type="button" disabled={blocked} onClick={() => o.rotate(90, pageCount, allPages)}><RotateCw />右转 90°</button></div>
          {pageCount > 1 && <label className={styles.check}><input type="checkbox" checked={allPages} disabled={blocked} onChange={e => setAllPages(e.target.checked)} />应用到全部 {pageCount} 页</label>}
          <button type="button" disabled={blocked} onClick={o.restoreOriginal}>恢复当前页原始方向</button>
          {o.url && <button type="button" disabled={o.saving} onClick={() => void o.reload()}>恢复已保存方向</button>}
          {o.url && o.canSave && o.dirty && <button type="button" className={styles.save} disabled={blocked} onClick={() => void o.save()}>{o.saving ? '保存中…' : '保存方向'}</button>}
          {o.url && <a href={`${o.url}?download=1`} target="_blank" rel="noreferrer">按已保存方向导出</a>}
          <small>{o.canSave ? '保存后作为此文件的默认阅读方向' : '旋转仅影响本次浏览'}</small>
        </div>}
      </div>
      {showFullscreen && <button type="button" aria-label={fullscreen ? '关闭全屏' : '全屏预览'} onClick={fullscreen ? onClose : onFullscreen}>{fullscreen ? <X /> : <Maximize />}<span>{fullscreen ? '关闭' : '全屏'}</span></button>}
      <div className={styles.menuAnchor}>
        <button type="button" aria-label="更多预览操作" aria-expanded={menu === 'more'} onClick={e => { trigger.current = e.currentTarget; setMenu(menu === 'more' ? null : 'more'); }}><MoreHorizontal /></button>
        {menu === 'more' && <div className={styles.popover} role="group" aria-label="更多预览操作">
          <button type="button" disabled={loading} onClick={() => { g.setFitMode('actual-size'); setMenu(null); }}>原始大小</button>
          <button type="button" disabled={loading} onClick={() => { g.recenter(); setMenu(null); }}>居中显示</button>
          <button type="button" disabled={loading} onClick={() => { g.reset(); setMenu(null); }}>重置视图</button>
          <a href={downloadUrl} target="_blank" rel="noreferrer">下载原件</a><button type="button" onClick={onOpenSystem}>系统打开</button>
          <small>图纸内滚轮缩放 · 按住拖动查看</small>
        </div>}
      </div>
    </div>
  </div>;
}
