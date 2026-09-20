'use client';
import type { DrawingLibraryItemDTO } from '@/types';
import styles from './DrawingReturnNotice.module.css';

export default function DrawingReturnNotice({ returns, onHandle }: { returns: NonNullable<DrawingLibraryItemDTO['returnSummary']>; onHandle: () => void }) {
  if (!returns.length) return null;
  const pending = returns.some(r => r.status === 'OPEN' || r.status === 'READY');
  return <section className={styles.notice} aria-label="资料退回原因">
    <div className={styles.reasons} tabIndex={0}>
      {returns.map(r => <p key={r.id}><strong>{r.kind === 'sop' ? 'SOP' : r.kind === 'drawing' ? '图纸' : '资料'}退回：</strong>{r.reason}</p>)}
    </div>
    <button type="button" onClick={onHandle}>{pending ? '处理退回' : '查看处理进度'}{returns.length > 1 ? `（${returns.length}）` : ''}</button>
  </section>;
}
