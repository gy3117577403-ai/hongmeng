'use client';

import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { ImageViewer } from '@/components/ImageViewer';
import type { SamplePhotoDTO } from '@/types';

export function SamplePhotoViewerDialog({
  photos,
  index,
  onIndexChange,
  onClose,
}: {
  photos: SamplePhotoDTO[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const photo = photos[index];

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === 'PageUp' && index > 0) {
        event.preventDefault();
        onIndexChange(index - 1);
        return;
      }
      if (event.key === 'PageDown' && index < photos.length - 1) {
        event.preventDefault();
        onIndexChange(index + 1);
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], summary, [tabindex]:not([tabindex="-1"])')]
        .filter(node => !node.hasAttribute('hidden'));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      previous?.focus();
    };
  }, [index, onClose, onIndexChange, photos.length]);

  if (!photo) return null;
  return (
    <div className="sample-media-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={dialogRef} className="sample-media-dialog" role="dialog" aria-modal="true" aria-labelledby="sample-media-title">
        <header className="sample-media-dialog-head">
          <div><small>过程与成品照片 · {index + 1}/{photos.length}</small><strong id="sample-media-title">{photo.caption || photo.originalName}</strong></div>
          <button ref={closeRef} type="button" aria-label="关闭照片查看器" title="关闭" onClick={onClose}><X size={20} /></button>
        </header>
        <ImageViewer
          dashboardMode
          showFullscreen={false}
          initialFitMode="fit-window"
          fileId={photo.id}
          title={photo.caption || photo.originalName}
          contentUrl={photo.contentUrl}
          downloadUrl={photo.contentUrl}
          page={index + 1}
          pageCount={photos.length}
          onPageChange={page => onIndexChange(page - 1)}
          gestureResetKey={photo.id}
        />
        <footer><span>滚轮或双指缩放 · 拖拽平移 · R 旋转 · 0 重置 · PageUp/PageDown 切换</span></footer>
      </section>
    </div>
  );
}
