'use client';
import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useModalLayer } from '@/components/useModalLayer';
import type { CurrentUserDTO } from '@/types';
import MaterialOrderWorkbench from './MaterialOrderWorkbench';

export function MaterialOrderDrawer({ user, workOrderId, orderId, onClose, onChanged }: { user: CurrentUserDTO; workOrderId?: string; orderId?: string; onClose: () => void; onChanged?: () => void }) {
  const layer = useRef<HTMLElement>(null);
  const [editing, setEditing] = useState(false);
  useModalLayer({ open: true, layerRef: layer, onClose, interactionEnabled: !editing });
  return createPortal(<div className="mo-drawer-overlay" onMouseDown={e => { if (e.target === e.currentTarget && !editing) onClose(); }}><section ref={layer} className="mo-drawer" role="dialog" aria-modal="true" aria-label="订单物料明细"><MaterialOrderWorkbench user={user} mode="planning" workOrderId={workOrderId} orderId={orderId} onClose={onClose} onChanged={onChanged} onEditorChange={setEditing}/></section></div>, document.body);
}
