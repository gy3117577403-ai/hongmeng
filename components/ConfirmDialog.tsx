'use client';

import { useRef } from 'react';
import { useModalLayer } from '@/components/useModalLayer';

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = '确认',
  cancelLabel = '取消',
  danger = false,
  busy = false,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  useModalLayer({
    open,
    layerRef: dialogRef,
    initialFocusRef: cancelRef,
    onClose: onCancel,
  });

  if (!open) return null;
  return (
    <div className="hm-confirm-backdrop" role="presentation" onMouseDown={event => {
      if (event.target === event.currentTarget && !busy) onCancel();
    }}>
      <section ref={dialogRef} className="hm-confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="hm-confirm-title" aria-describedby="hm-confirm-description" tabIndex={-1}>
        <div>
          <strong id="hm-confirm-title">{title}</strong>
          <p id="hm-confirm-description">{description}</p>
        </div>
        <footer>
          <button ref={cancelRef} className="hm-workbench-button" type="button" disabled={busy} onClick={onCancel}>{cancelLabel}</button>
          <button className={`hm-workbench-button ${danger ? 'danger' : 'primary'}`} type="button" disabled={busy} aria-busy={busy} onClick={onConfirm}>
            {busy ? '处理中...' : confirmLabel}
          </button>
        </footer>
      </section>
    </div>
  );
}
