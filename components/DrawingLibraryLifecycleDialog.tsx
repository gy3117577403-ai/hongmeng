'use client';
import { useEffect, useRef, useState } from 'react';
import { useModalLayer } from './useModalLayer';

export type DrawingLifecycleTarget = {
  action: 'delete' | 'restore';
  item: { id: string; specification: string; customerName: string };
};

export function DrawingLibraryLifecycleDialog({ target, onClose, onComplete }: {
  target: DrawingLifecycleTarget; onClose: () => void; onComplete: (target: DrawingLifecycleTarget) => Promise<void>;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [blockers, setBlockers] = useState<string[]>([]);
  const [checking, setChecking] = useState(target.action === 'delete');
  const [busy, setBusy] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  useModalLayer({ open: true, layerRef: panel, initialFocusRef: input, onClose: () => { if (!busy) onClose(); } });
  const deleting = target.action === 'delete';
  useEffect(() => {
    if (!deleting) return;
    const controller = new AbortController();
    fetch(`/api/drawing-library/${target.item.id}/impact`, { cache: 'no-store', signal: controller.signal })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || '引用检查失败');
        setBlockers(data.impact.blockers);
        setChecking(false);
      })
      .catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : '引用检查失败，请关闭后重试'); });
    return () => controller.abort();
  }, [deleting, target.item.id]);
  async function submit() {
    if (!reason.trim() || checking || blockers.length) return;
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/drawing-library/${target.item.id}${deleting ? '' : '/restore'}`, {
        method: deleting ? 'DELETE' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: reason.trim() }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '操作失败');
      await onComplete(target);
    } catch (e) { setError(e instanceof Error ? e.message : '操作失败，请重试'); }
    finally { setBusy(false); }
  }
  return <div className="modal-backdrop" role="presentation">
    <div ref={panel} className="drawing-dialog" role="dialog" aria-modal="true" aria-labelledby="drawing-lifecycle-title" style={{ width: 'min(560px, calc(100vw - 32px))' }}>
      <div className="dialog-title"><h3 id="drawing-lifecycle-title">{deleting ? '删除图纸档案' : '恢复图纸档案'}</h3><button type="button" disabled={busy} onClick={onClose} aria-label="关闭档案操作">×</button></div>
      <div style={{ padding: '0 20px 16px', display: 'grid', gap: 12 }}>
        <strong>{target.item.specification}</strong><span>{target.item.customerName}</span>
        <p>{deleting ? '档案将移入回收站。必须没有未删除资料（含历史版本）、活动计划和生产引用。历史编号与操作记录会保留。' : '恢复原档案编号及原有关联。已删除的资料文件仍在文件回收站，需要单独恢复；系统会检查是否存在重复档案。'}</p>
        {checking && !error && <p role="status">正在检查文件和业务引用…</p>}
        {!!blockers.length && <div role="alert"><strong>当前不能删除</strong><ul>{blockers.map(blocker => <li key={blocker}>{blocker}</li>)}</ul></div>}
        <label style={{ display: 'grid', gap: 8 }}>操作原因<textarea ref={input} className="hm-workbench-input" rows={3} maxLength={500} value={reason} onChange={event => setReason(event.target.value)} placeholder="填写本次操作原因" disabled={busy} /></label>
        {error && <p role="alert" style={{ color: '#b42318' }}>{error}</p>}
      </div>
      <div className="dialog-actions"><button type="button" disabled={busy} onClick={onClose}>取消</button><button className="primary" type="button" disabled={busy || checking || !!blockers.length || !reason.trim()} onClick={() => void submit()}>{busy ? '处理中…' : deleting ? '确认移入回收站' : '确认恢复档案'}</button></div>
    </div>
  </div>;
}
