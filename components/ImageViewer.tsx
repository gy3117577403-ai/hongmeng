'use client';

import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { PreviewModal } from '@/components/PdfViewer';
import { usePreviewGestures } from '@/components/usePreviewGestures';

type ImageViewerProps = {
  fileId: string;
  title: string;
  dashboardMode?: boolean;
  contentUrl?: string;
  downloadUrl?: string;
  readingMode?: boolean;
  page?: number;
  pageCount?: number;
  onPageChange?: (page: number) => void;
  onAddToToc?: (title: string, page: number) => Promise<boolean>;
  onCopyPageLink?: (page: number) => Promise<void> | void;
  gestureResetKey?: string;
};

export function ImageViewer({
  fileId,
  title,
  dashboardMode = false,
  contentUrl,
  downloadUrl,
  readingMode = false,
  page = 1,
  pageCount = 1,
  onPageChange,
  onAddToToc,
  onCopyPageLink,
  gestureResetKey,
}: ImageViewerProps) {
  const [fullscreen, setFullscreen] = useState(false);
  const source = contentUrl || `/api/resource-files/${fileId}/content`;
  const fallbackDownloadUrl = downloadUrl || `/api/resource-files/${fileId}/download`;
  const common = { source, title, dashboardMode, downloadUrl: fallbackDownloadUrl, readingMode, page, pageCount, onPageChange, onAddToToc, onCopyPageLink, gestureResetKey };

  return (
    <>
      <ImageCanvas {...common} onFullscreen={() => setFullscreen(true)} />
      {fullscreen && (
        <PreviewModal title={title} onClose={() => setFullscreen(false)}>
          <ImageCanvas {...common} fullscreen onClose={() => setFullscreen(false)} />
        </PreviewModal>
      )}
    </>
  );
}

function ImageCanvas({
  source,
  title,
  dashboardMode = false,
  downloadUrl,
  fullscreen = false,
  onFullscreen,
  onClose,
  readingMode = false,
  page,
  pageCount,
  onPageChange,
  onAddToToc,
  onCopyPageLink,
  gestureResetKey,
}: {
  source: string;
  title: string;
  dashboardMode?: boolean;
  downloadUrl: string;
  fullscreen?: boolean;
  onFullscreen?: () => void;
  onClose?: () => void;
  readingMode?: boolean;
  page: number;
  pageCount: number;
  onPageChange?: (page: number) => void;
  onAddToToc?: (title: string, page: number) => Promise<boolean>;
  onCopyPageLink?: (page: number) => Promise<void> | void;
  gestureResetKey?: string;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [tocOpen, setTocOpen] = useState(false);
  const [tocTitle, setTocTitle] = useState('');
  const [tocSaving, setTocSaving] = useState(false);
  const displaySource = reloadKey > 0 ? `${source}${source.includes('?') ? '&' : '?'}reload=${reloadKey}` : source;
  const gestures = usePreviewGestures({
    stageRef,
    contentSize: naturalSize,
    viewportSize: box,
    resetKey: `${gestureResetKey || source}|${fullscreen ? 'fullscreen' : 'inline'}|${reloadKey}`,
    initialFitMode: dashboardMode ? 'fit-height' : 'fit-window',
    scrollWheel: dashboardMode,
  });

  useEffect(() => {
    const node = stageRef.current;
    if (!node) return undefined;
    let frame = 0;
    const resize = (): void => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const width = node.clientWidth;
        const height = node.clientHeight;
        setBox(current => current.width === width && current.height === height ? current : { width, height });
      });
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(node);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    setLoading(true);
    setError(false);
    setNaturalSize({ width: 0, height: 0 });
    setTocOpen(false);
  }, [source, reloadKey]);

  function changePage(nextPage: number): void {
    const next = Math.max(1, Math.min(pageCount, nextPage));
    gestures.recenter();
    onPageChange?.(next);
  }

  function openQuickToc(): void {
    setTocTitle(title.replace(/\.(?:jpe?g|png|webp)$/i, '').trim());
    setTocOpen(true);
  }

  async function submitQuickToc(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!onAddToToc || !tocTitle.trim()) return;
    setTocSaving(true);
    try {
      const saved = await onAddToToc(tocTitle.trim(), page);
      if (saved) setTocOpen(false);
    } finally {
      setTocSaving(false);
    }
  }

  const displayScale = gestures.zoom / Math.max(0.001, gestures.committedZoom);
  const scrollSurfaceStyle = dashboardMode ? {
    width: `${Math.max(box.width, gestures.rotatedSize.width * gestures.zoom + 40)}px`,
    height: `${Math.max(box.height, gestures.rotatedSize.height * gestures.zoom + 40)}px`,
  } : undefined;

  return (
    <div className={`${fullscreen ? 'image-viewer fullscreen-viewer' : 'image-viewer'}${readingMode ? ' reading-viewer' : ''}${dashboardMode ? ' dashboard-preview-viewer' : ''}`}>
      <div className="viewer-toolbar image-toolbar">
        <div className="viewer-title" title={title}><span>IMG</span><strong>{title}</strong></div>
        <div className="viewer-controls">
          {dashboardMode ? <>
            {pageCount > 1 && <button type="button" aria-label="上一张" title="上一张" disabled={page <= 1} onClick={() => changePage(page - 1)}>‹</button>}
            {pageCount > 1 && <span className="image-page-count">{page} / {pageCount}</span>}
            {pageCount > 1 && <button type="button" aria-label="下一张" title="下一张" disabled={page >= pageCount} onClick={() => changePage(page + 1)}>›</button>}
            <button type="button" aria-label="缩小" title="缩小" disabled={loading} onClick={() => gestures.zoomBy(1 / 1.15)}>−</button>
            <span className="viewer-zoom-value" aria-live="polite">{Math.round(gestures.zoom * 100)}%</span>
            <button type="button" aria-label="放大" title="放大" disabled={loading} onClick={() => gestures.zoomBy(1.15)}>＋</button>
            <button className={gestures.fitMode === 'fit-height' ? 'active' : ''} type="button" disabled={loading} onClick={() => gestures.setFitMode('fit-height')}>适高</button>
            <button type="button" aria-label="向左旋转" title="向左旋转" disabled={loading} onClick={() => gestures.rotateBy(-90)}>↺</button>
            {fullscreen ? <button className="viewer-close-button" type="button" onClick={onClose}>关闭</button> : <button type="button" disabled={loading} onClick={onFullscreen}>全屏</button>}
            <details className="viewer-more"><summary aria-label="更多预览操作" title="更多预览操作">更多</summary><div><button type="button" onClick={() => gestures.setFitMode('fit-width')}>适应宽度</button><button type="button" onClick={() => gestures.setFitMode('fit-window')}>适应整页</button><button type="button" onClick={() => gestures.setFitMode('actual-size')}>原始大小</button><button type="button" onClick={gestures.reset}>重置视图</button><button type="button" onClick={() => gestures.rotateBy(90)}>向右旋转</button><a href={downloadUrl} target="_blank" rel="noreferrer">下载</a><button type="button" onClick={() => window.location.assign(source)}>系统打开</button></div></details>
          </> : <>
          {pageCount > 1 && <button type="button" disabled={page <= 1} onClick={() => changePage(page - 1)}>上一页</button>}
          {pageCount > 1 && <span className="image-page-count">{page} / {pageCount}</span>}
          {pageCount > 1 && <button type="button" disabled={page >= pageCount} onClick={() => changePage(page + 1)}>下一页</button>}
          <button type="button" disabled={loading} onClick={() => gestures.setFitMode('fit-window')}>适应窗口</button>
          <button type="button" disabled={loading} onClick={() => gestures.rotateBy(-90)}>左旋</button>
          <button type="button" disabled={loading} onClick={() => gestures.rotateBy(90)}>右旋</button>
          {fullscreen ? <button className="viewer-close-button" type="button" onClick={onClose}>关闭</button> : <button type="button" disabled={loading} onClick={onFullscreen}>全屏</button>}
          {onAddToToc && <button className="viewer-toc-action" type="button" disabled={loading} aria-expanded={tocOpen} onClick={openQuickToc}>添加至目录</button>}
          {readingMode ? (
            <details className="viewer-more"><summary>更多</summary><div><button type="button" onClick={() => gestures.zoomBy(1 / 1.15)}>缩小</button><button type="button" onClick={() => gestures.zoomBy(1.15)}>放大</button><button type="button" onClick={() => gestures.setFitMode('fit-width')}>适宽</button><button type="button" onClick={() => gestures.setFitMode('fit-window')}>整页</button><button type="button" onClick={() => gestures.setFitMode('actual-size')}>原始大小</button><button type="button" disabled={gestures.rotation === 0} onClick={() => gestures.rotateBy(-gestures.rotation)}>重置旋转</button><button type="button" onClick={gestures.reset}>重置视图</button><a href={downloadUrl} target="_blank" rel="noreferrer">下载</a><button type="button" onClick={() => window.location.assign(source)}>系统打开</button>{onCopyPageLink && <button type="button" onClick={() => void onCopyPageLink(page)}>复制当前页链接</button>}</div></details>
          ) : <><button type="button" onClick={() => gestures.zoomBy(1 / 1.15)} title="缩小">−</button><button type="button" onClick={() => gestures.zoomBy(1.15)} title="放大">＋</button><button type="button" onClick={gestures.reset}>重置</button><button type="button" onClick={() => gestures.setFitMode('actual-size')}>原始大小</button></>}
          </>}
        </div>
        {tocOpen && <form className="viewer-toc-popover" onSubmit={submitQuickToc} role="dialog" aria-label="添加当前页至目录"><label><span>目录标题</span><input autoFocus value={tocTitle} onChange={event => setTocTitle(event.target.value)} maxLength={160} placeholder="输入当前页章节标题" /></label><p>当前页：第 {page} 页</p><div><button type="button" onClick={() => setTocOpen(false)}>取消</button><button className="primary-button" type="submit" disabled={tocSaving || !tocTitle.trim()}>{tocSaving ? '添加中...' : '添加'}</button></div></form>}
      </div>
      <div
        className={`viewer-stage image-stage gesture-stage${gestures.isDragging ? ' dragging' : ''}`}
        ref={stageRef}
        onPointerDown={gestures.onPointerDown}
        onPointerMove={gestures.onPointerMove}
        onPointerUp={gestures.onPointerUp}
        onPointerCancel={gestures.onPointerCancel}
        onDoubleClick={gestures.onDoubleClick}
      >
        {loading && <ViewerState title="图片加载中" detail="正在读取同源文件流" />}
        {error && <ViewerState title="图片加载失败" detail="图片加载失败，可重新加载或下载原图" error onReload={() => setReloadKey(value => value + 1)} downloadUrl={downloadUrl} />}
        {dashboardMode ? (
          <div className="viewer-scroll-surface" style={scrollSurfaceStyle}>
            <div className={`viewer-gesture-content image-gesture-content${gestures.isGestureActive ? ' active' : ''}`} style={{ width: naturalSize.width ? naturalSize.width * gestures.committedZoom : undefined, height: naturalSize.height ? naturalSize.height * gestures.committedZoom : undefined, transform: `translate3d(${gestures.panX}px, ${gestures.panY}px, 0) rotate(${gestures.rotation}deg) scale(${displayScale})` }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img key={`${source}-${reloadKey}`} className="preview-image gesture-image" src={displaySource} alt={title} draggable={false} decoding="async" onLoad={event => { setNaturalSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight }); setLoading(false); setError(false); }} onError={() => { setLoading(false); setError(true); }} />
            </div>
          </div>
        ) : (
          <div className={`viewer-gesture-content image-gesture-content${gestures.isGestureActive ? ' active' : ''}`} style={{ width: naturalSize.width || undefined, height: naturalSize.height || undefined, transform: `translate3d(${gestures.panX}px, ${gestures.panY}px, 0) rotate(${gestures.rotation}deg) scale(${gestures.zoom})` }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img key={`${source}-${reloadKey}`} className="preview-image gesture-image" src={displaySource} alt={title} draggable={false} decoding="async" onLoad={event => { setNaturalSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight }); setLoading(false); setError(false); }} onError={() => { setLoading(false); setError(true); }} />
          </div>
        )}
        {gestures.zoomHint && <div className="viewer-zoom-hint" aria-live="polite">{gestures.zoomHint}</div>}
      </div>
    </div>
  );
}

function ViewerState({ title, detail, error = false, onReload, downloadUrl }: { title: string; detail: string; error?: boolean; onReload?: () => void; downloadUrl?: string }) {
  return (
    <div className={error ? 'viewer-state error' : 'viewer-state'}>
      <span />
      <strong>{title}</strong>
      <p>{detail}</p>
      {error && <div className="viewer-state-actions">{onReload && <button type="button" onClick={onReload}>重新加载</button>}{downloadUrl && <a href={downloadUrl} target="_blank" rel="noreferrer">下载原图</a>}</div>}
    </div>
  );
}
