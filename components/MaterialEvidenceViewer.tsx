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
import { PointerEvent, useEffect, useMemo, useRef, useState, WheelEvent } from 'react';
import { ThreeDIconButton } from '@/components/ui/opensourceui/ThreeDControls';
import type { MaterialLibraryPhotoDTO } from '@/lib/material-library-contract';

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

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
  const dragRef = useRef<{ x: number; y: number; originX: number; originY: number } | null>(null);
  const activeIndex = useMemo(() => Math.max(0, photos.findIndex(photo => photo.id === activePhotoId)), [activePhotoId, photos]);
  const activePhoto = photos[activeIndex] || photos[0] || null;
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [localRotation, setLocalRotation] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    if (!fullscreen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [fullscreen]);

  useEffect(() => {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
    setLocalRotation(activePhoto?.rotation || 0);
  }, [activePhoto?.id, activePhoto?.rotation]);

  function choose(index: number) {
    const next = photos[(index + photos.length) % photos.length];
    if (next) onActivePhotoChange(next.id);
  }

  function changeZoom(next: number) {
    const value = clamp(next, .35, 4);
    setZoom(value);
    if (value <= 1) setOffset({ x: 0, y: 0 });
  }

  function fit() {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  }

  function oneToOne() {
    if (!activePhoto || !stageRef.current || !activePhoto.width || !activePhoto.height) return changeZoom(1.5);
    const rect = stageRef.current.getBoundingClientRect();
    const containWidth = Math.min(rect.width - 36, (rect.height - 36) * activePhoto.width / activePhoto.height);
    changeZoom(clamp(activePhoto.width / Math.max(containWidth, 1), 1, 4));
  }

  function rotate(delta: number) {
    if (!activePhoto) return;
    const next = (localRotation + delta + 360) % 360;
    setLocalRotation(next);
    void onRotate?.(activePhoto, next);
  }

  function pointerDown(event: PointerEvent<HTMLDivElement>) {
    if (zoom <= 1) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { x: event.clientX, y: event.clientY, originX: offset.x, originY: offset.y };
    setDragging(true);
  }

  function pointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!dragRef.current) return;
    setOffset({
      x: dragRef.current.originX + event.clientX - dragRef.current.x,
      y: dragRef.current.originY + event.clientY - dragRef.current.y,
    });
  }

  function pointerEnd() {
    dragRef.current = null;
    setDragging(false);
  }

  function wheel(event: WheelEvent<HTMLDivElement>) {
    event.preventDefault();
    changeZoom(zoom + (event.deltaY < 0 ? .12 : -.12));
  }

  if (!activePhoto) return <div className="material-evidence-empty"><span><ImageIcon size={34} /></span><strong>尚无来料实拍</strong><p>生成临时或永久二维码后，品质人员可用手机实时拍照留库。</p></div>;

  return <div
    ref={rootRef}
    className={`material-evidence-viewer${fullscreen ? ' is-fullscreen' : ''}`}
    tabIndex={0}
    onKeyDown={event => {
      if (event.key === 'ArrowLeft') choose(activeIndex - 1);
      else if (event.key === 'ArrowRight') choose(activeIndex + 1);
      else if (event.key === '+' || event.key === '=') changeZoom(zoom + .15);
      else if (event.key === '-') changeZoom(zoom - .15);
      else if (event.key.toLowerCase() === 'r') rotate(90);
      else if (event.key.toLowerCase() === 'f') fit();
      else if (event.key === 'Escape' && fullscreen) setFullscreen(false);
    }}
  >
    <div
      ref={stageRef}
      className={`material-evidence-stage${dragging ? ' dragging' : ''}`}
      onPointerDown={pointerDown}
      onPointerMove={pointerMove}
      onPointerUp={pointerEnd}
      onPointerCancel={pointerEnd}
      onWheel={wheel}
    >
      <Image
        unoptimized
        priority
        draggable={false}
        src={activePhoto.contentUrl}
        width={activePhoto.width || 1440}
        height={activePhoto.height || 1080}
        alt={activePhoto.caption || activePhoto.originalName}
        style={{ transform: `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${zoom}) rotate(${localRotation}deg)` }}
      />
      <div className="material-evidence-dock" aria-label="照片预览控制">
        <ThreeDIconButton label="上一张" disabled={photos.length < 2} onClick={() => choose(activeIndex - 1)}><ChevronLeft size={17} /></ThreeDIconButton>
        <span className="material-evidence-counter"><b>{activeIndex + 1}</b> / {photos.length}</span>
        <ThreeDIconButton label="下一张" disabled={photos.length < 2} onClick={() => choose(activeIndex + 1)}><ChevronRight size={17} /></ThreeDIconButton>
        <i />
        <ThreeDIconButton label="缩小" onClick={() => changeZoom(zoom - .15)}><Minus size={16} /></ThreeDIconButton>
        <span className="material-evidence-zoom">{Math.round(zoom * 100)}%</span>
        <ThreeDIconButton label="放大" onClick={() => changeZoom(zoom + .15)}><Plus size={16} /></ThreeDIconButton>
        <ThreeDIconButton label="自适应" onClick={fit}><Focus size={16} /></ThreeDIconButton>
        <button className="material-evidence-one" type="button" onClick={oneToOne}>1:1</button>
        <ThreeDIconButton label="向左旋转" onClick={() => rotate(-90)}><RotateCcw size={16} /></ThreeDIconButton>
        <ThreeDIconButton label="向右旋转" onClick={() => rotate(90)}><RotateCw size={16} /></ThreeDIconButton>
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
