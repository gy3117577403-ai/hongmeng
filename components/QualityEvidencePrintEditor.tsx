'use client';
import { useState } from 'react';
import type { InternalQualityRiskDTO, InternalQualityRiskAttachmentDTO } from '@/types';
export function QualityEvidencePrintEditor({ report, attachment, onUpdated }: { report: InternalQualityRiskDTO; attachment: InternalQualityRiskAttachmentDTO; onUpdated: (report: InternalQualityRiskDTO) => void }) {
  const [caption, setCaption] = useState(attachment.caption || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save(data: Record<string, unknown>) {
    setBusy(true); setError('');
    try { const response = await fetch(`/api/quality/internal-risks/${report.id}/attachments/${attachment.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedVersion: report.version, ...data }) }); const body = await response.json(); if (!response.ok) throw new Error(body.error || '设置失败'); onUpdated(body.report); }
    catch (e) { setError(e instanceof Error ? e.message : '设置失败'); }
    finally { setBusy(false); }
  }
  return <div className="quality-evidence-print-editor"><label><input type="checkbox" checked={attachment.printIncluded !== false} disabled={busy} onChange={event => void save({ printIncluded: event.target.checked })} />随单打印此图</label><label>图片说明<input value={caption} maxLength={500} onChange={event => setCaption(event.target.value)} /></label><div><button type="button" disabled={busy} onClick={() => void save({ caption })}>保存说明</button><button type="button" disabled={busy} onClick={() => void save({ direction: 'up' })}>前移</button><button type="button" disabled={busy} onClick={() => void save({ direction: 'down' })}>后移</button></div>{error && <small role="alert">{error}</small>}</div>;
}
