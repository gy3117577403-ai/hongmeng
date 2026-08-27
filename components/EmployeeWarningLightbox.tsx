'use client';
/* eslint-disable @next/next/no-img-element */
import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Focus, RotateCw, X, ZoomIn, ZoomOut } from 'lucide-react';
import { usePreviewGestures } from '@/components/usePreviewGestures';

type Photo = { id: string; contentUrl: string; caption: string; displayName: string };
export function EmployeeWarningLightbox({ photos, active, choose, close }: { photos: Photo[]; active: number; choose: (index: number) => void; close: () => void }) {
  const stageRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [failed, setFailed] = useState(false);
  const photo = photos[active];
  const gestures = usePreviewGestures({ stageRef, contentSize: size, viewportSize: viewport, resetKey: photo.id, initialFitMode: 'fit-window' });
  useEffect(() => {
    const node = stageRef.current;
    if (!node) return;
    const resize = () => setViewport({ width: node.clientWidth, height: node.clientHeight });
    resize(); const observer = new ResizeObserver(resize); observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useEffect(() => { setSize({ width: 0, height: 0 }); setFailed(false); }, [photo.id]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden'; dialogRef.current?.focus();
    return () => { document.body.style.overflow = overflow; previous?.focus(); };
  }, []);
  return <div className="employee-lightbox" ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="异常图片全屏预览" onKeyDown={event => {
    if (event.key === 'Escape') close();
    if (event.key === 'ArrowLeft') choose(active - 1);
    if (event.key === 'ArrowRight') choose(active + 1);
    if (event.key === 'Tab') {
      const buttons = Array.from(dialogRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || []);
      const first = buttons[0]; const last = buttons[buttons.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  }}>
    <header><span>{active + 1} / {photos.length} · {size.width ? `${Math.round(gestures.zoom * 100)}%` : '加载中'}</span><button aria-label="关闭图片" onClick={close}><X /></button></header>
    <div className={`employee-lightbox-canvas${gestures.isDragging ? ' dragging' : ''}`} ref={stageRef} onPointerDown={gestures.onPointerDown} onPointerMove={gestures.onPointerMove} onPointerUp={gestures.onPointerUp} onPointerCancel={gestures.onPointerCancel} onDoubleClick={gestures.onDoubleClick}>
      <div className="employee-image-position" style={{ width: size.width || 1, height: size.height || 1, transform: `translate3d(calc(-50% + ${gestures.panX}px),calc(-50% + ${gestures.panY}px),0)` }}>
        <img key={photo.id} src={photo.contentUrl} alt={photo.caption || photo.displayName} draggable={false} onLoad={event => setSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} onError={() => setFailed(true)} style={{ transform: `rotate(${gestures.rotation}deg) scale(${gestures.zoom})`, opacity: size.width ? 1 : 0 }} />
      </div>
      {failed && <p className="employee-image-state">图片暂时无法读取，请关闭后重新打开。</p>}
    </div>
    <p>{photo.caption || photo.displayName}</p><small>双指缩放 / 放大后拖动查看细节</small>
    <nav><button aria-label="上一张" disabled={photos.length < 2} onClick={() => choose(active - 1)}><ChevronLeft /></button><button aria-label="缩小" onClick={() => gestures.zoomBy(1 / 1.3)}><ZoomOut /></button><button aria-label="自适应" onClick={() => gestures.setFitMode('fit-window')}><Focus /></button><button aria-label="放大" onClick={() => gestures.zoomBy(1.3)}><ZoomIn /></button><button aria-label="旋转" onClick={() => gestures.rotateBy(90)}><RotateCw /></button><button aria-label="下一张" disabled={photos.length < 2} onClick={() => choose(active + 1)}><ChevronRight /></button></nav>
  </div>;
}
