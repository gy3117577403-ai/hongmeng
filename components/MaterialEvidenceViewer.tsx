'use client';

import {
  ChevronLeft,
  ChevronRight,
  Download,
  Expand,
  Focus,
  Image as ImageIcon,
  Minimize2,
  Minus,
  Plus,
  RotateCcw,
  RotateCw,
} from 'lucide-react';
import Image from 'next/image';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { SyntheticEvent } from 'react';
import { ThreeDIconButton } from '@/components/ui/opensourceui/ThreeDControls';
import { usePreviewGestures } from '@/components/usePreviewGestures';
import type { MaterialLibraryPhotoDTO } from '@/lib/material-library-contract';

type Size = { width: number; height: number };

const EMPTY_SIZE: Size = { width: 0, height: 0 };

export default function MaterialEvidenceViewer({
  photos,
  activePhotoId,
  onActivePhotoChange,
  onRotate,
}: {
  photos: MaterialLibraryPhotoDTO[];
  activePhotoId: string;
  onActivePhotoChange: (id: string) => void;
  onRotate?: (photo: MaterialLibraryPhotoDTO, rotation: number) => void | Promise<void>;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const activeIndex = useMemo(() => Math.max(0, photos.findIndex(photo => photo.id === activePhotoId)), [activePhotoId, photos]);
  const activePhoto = photos[activeIndex] || photos[0] || null;
  const [viewportSize, setViewportSize] = useState<Size>(EMPTY_SIZE);
  const [naturalSize, setNaturalSize] = useState<Size>(EMPTY_SIZE);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const gestures = usePreviewGestures({
    stageRef,
    contentSize: naturalSize,
    viewportSize,
    resetKey: activePhoto ? `${activePhoto.id}|${activePhoto.contentUrl}|${activePhoto.rotation}` : 'empty',
    initialFitMode: 'fit-window',
    initialRotation: activePhoto?.rotation || 0,
  });

  useEffect(() => {
    const node = stageRef.current;
    if (!node) return undefined;
    let frame = 0;
    const measure = (): void => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const next = { width: node.clientWidth, height: node.clientHeight };
        setViewportSize(current => current.width === next.width && current.height === next.height ? current : next);
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    setNaturalSize(EMPTY_SIZE);
    setLoading(Boolean(activePhoto?.id));
    setLoadError(false);
  }, [activePhoto?.contentUrl, activePhoto?.id]);

  useEffect(() => {
    if (!fullscreen) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    rootRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [fullscreen]);

  function choose(index: number) {
    const next = photos[(index + photos.length) % photos.length];
    if (next) onActivePhotoChange(next.id);
  }

  function rotate(delta: number) {
    if (!activePhoto) return;
    const next = (gestures.rotation + delta + 360) % 360;
    gestures.rotateBy(delta);
    void onRotate?.(activePhoto, next);
  }

  function isControlTarget(event: SyntheticEvent<HTMLDivElement>) {
    return event.target instanceof Element && Boolean(event.target.closest('[data-preview-controls]'));
  }

  if (!activePhoto) return <div className="material-evidence-empty"><span><ImageIcon size={34} /></span><strong>尚无来料实拍</strong><p>生成临时或永久二维码后，品质人员可用手机实时拍照留库。</p></div>;

  const renderSize = naturalSize.width > 0 && naturalSize.height > 0
    ? naturalSize
    : { width: activePhoto.width || 1, height: activePhoto.height || 1 };
  const zoomLabel = naturalSize.width > 0 ? `${Math.round(gestures.zoom * 100)}%` : '—';

  return <div
    ref={rootRef}
    className={`material-evidence-viewer${fullscreen ? ' is-fullscreen' : ''}`}
    tabIndex={0}
    data-fit-mode={gestures.fitMode}
    onKeyDown={event => {
      if (event.key === 'ArrowLeft') choose(activeIndex - 1);
      else if (event.key === 'ArrowRight') choose(activeIndex + 1);
      else if (event.key === '+' || event.key === '=') gestures.zoomBy(1.15);
      else if (event.key === '-') gestures.zoomBy(1 / 1.15);
      else if (event.key.toLowerCase() === 'r') rotate(90);
      else if (event.key.toLowerCase() === 'f' || event.key === '0') gestures.setFitMode('fit-window');
      else if (event.key === '1') gestures.setFitMode('actual-size');
      else if (event.key === 'Escape' && fullscreen) setFullscreen(false);
    }}
  >
    <div
      ref={stageRef}
      className={`material-evidence-stage${gestures.isDragging ? ' dragging' : ''}`}
      onPointerDown={event => { if (!isControlTarget(event)) gestures.onPointerDown(event); }}
      onPointerMove={gestures.onPointerMove}
      onPointerUp={gestures.onPointerUp}
      onPointerCancel={gestures.onPointerCancel}
      onDoubleClick={event => { if (!isControlTarget(event)) gestures.onDoubleClick(event); }}
    >
      <div
        className={`material-evidence-positioner${gestures.isGestureActive ? ' active' : ''}`}
        style={{
          width: `${renderSize.width}px`,
          height: `${renderSize.height}px`,
          transform: `translate3d(calc(-50% + ${gestures.panX}px), calc(-50% + ${gestures.panY}px), 0)`,
          opacity: loadError ? 0 : 1,
        }}
      >
        <div
          className="material-evidence-canvas"
          style={{ transform: `rotate(${gestures.rotation}deg) scale(${gestures.zoom})` }}
        >
          {/* The browser-decoded natural size is required for EXIF-aware fitting. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            key={activePhoto.contentUrl}
            src={activePhoto.contentUrl}
            alt={activePhoto.caption || activePhoto.originalName}
            draggable={false}
            decoding="async"
            onLoad={event => {
              const width = event.currentTarget.naturalWidth || activePhoto.width || 1;
              const height = event.currentTarget.naturalHeight || activePhoto.height || 1;
              setNaturalSize({ width, height });
              setLoading(false);
              setLoadError(false);
            }}
            onError={() => {
              setLoading(false);
              setLoadError(true);
            }}
          />
        </div>
      </div>

      {(loading || loadError) && <div className={`material-evidence-status${loadError ? ' error' : ''}`} role="status" aria-live="polite">
        <span><ImageIcon size={25} /></span>
        <strong>{loadError ? '照片读取失败' : '正在适配照片'}</strong>
        <small>{loadError ? '可以下载原图检查，或刷新页面后重试。' : '正在读取真实像素和手机拍摄方向…'}</small>
      </div>}

      {gestures.zoomHint && <div className="material-evidence-hint" aria-live="polite">{gestures.zoomHint}</div>}

      <div className="material-evidence-dock" aria-label="照片预览控制" data-preview-controls>
        <ThreeDIconButton label="上一张" disabled={photos.length < 2} onClick={() => choose(activeIndex - 1)}><ChevronLeft size={17} /></ThreeDIconButton>
        <span className="material-evidence-counter"><b>{activeIndex + 1}</b> / {photos.length}</span>
        <ThreeDIconButton label="下一张" disabled={photos.length < 2} onClick={() => choose(activeIndex + 1)}><ChevronRight size={17} /></ThreeDIconButton>
        <i />
        <ThreeDIconButton label="缩小" disabled={loading || loadError} onClick={() => gestures.zoomBy(1 / 1.15)}><Minus size={16} /></ThreeDIconButton>
        <span className="material-evidence-zoom" aria-live="polite">{zoomLabel}</span>
        <ThreeDIconButton label="放大" disabled={loading || loadError} onClick={() => gestures.zoomBy(1.15)}><Plus size={16} /></ThreeDIconButton>
        <ThreeDIconButton label="自适应" active={gestures.fitMode === 'fit-window'} disabled={loading || loadError} onClick={() => gestures.setFitMode('fit-window')}><Focus size={16} /></ThreeDIconButton>
        <button className={`material-evidence-one${gestures.fitMode === 'actual-size' ? ' active' : ''}`} type="button" disabled={loading || loadError} onClick={() => gestures.setFitMode('actual-size')}>1:1</button>
        <ThreeDIconButton label="向左旋转" disabled={loading || loadError} onClick={() => rotate(-90)}><RotateCcw size={16} /></ThreeDIconButton>
        <ThreeDIconButton label="向右旋转" disabled={loading || loadError} onClick={() => rotate(90)}><RotateCw size={16} /></ThreeDIconButton>
        <i />
        <ThreeDIconButton label={fullscreen ? '退出全屏' : '全屏预览'} onClick={() => setFullscreen(value => !value)}>
          {fullscreen ? <Minimize2 size={16} /> : <Expand size={16} />}
        </ThreeDIconButton>
        <a className="osui-3d-icon" href={activePhoto.contentUrl} download={activePhoto.originalName} aria-label="下载原图" title="下载原图"><Download size={16} /></a>
      </div>
    </div>
    <div className="material-evidence-filmstrip" aria-label="来料照片胶片条">
      {photos.map((photo, index) => <button
        type="button"
        className={photo.id === activePhoto.id ? 'active' : ''}
        key={photo.id}
        onClick={() => onActivePhotoChange(photo.id)}
      >
        <Image unoptimized src={photo.contentUrl} width={photo.width || 220} height={photo.height || 160} alt={photo.caption || photo.originalName} style={{ transform: `rotate(${photo.rotation}deg)` }} />
        <span><b>{index + 1}</b><small>{new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(photo.createdAt))}</small></span>
        {photo.isCover && <em>封面</em>}
      </button>)}
    </div>
  </div>;
}
