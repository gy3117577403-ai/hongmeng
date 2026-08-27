'use client';
import { useEffect, useState } from 'react';
import type { InternalQualityRiskDTO, InternalQualityRiskAttachmentDTO } from '@/types';
export function QualityEvidencePrintEditor({ report, attachment, onUpdated }: { report: InternalQualityRiskDTO; attachment: InternalQualityRiskAttachmentDTO; onUpdated: (report: InternalQualityRiskDTO) => void }) {
  const [caption, setCaption] = useState(attachment.caption || '');
  const [printGroup, setPrintGroup] = useState(attachment.printGroup || '');
  useEffect(() => { setCaption(attachment.caption || ''); setPrintGroup(attachment.printGroup || ''); }, [attachment.id, attachment.caption, attachment.printGroup]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save(data: Record<string, unknown>) {
    setBusy(true); setError('');
    try { const response = await fetch(`/api/quality/internal-risks/${report.id}/attachments/${attachment.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedVersion: report.version, ...data }) }); const body = await response.json(); if (!response.ok) throw new Error(body.error || '设置失败'); onUpdated(body.report); }
    catch (e) { setError(e instanceof Error ? e.message : '设置失败'); }
    finally { setBusy(false); }
  }
  return <div className="quality-evidence-print-editor"><label><input type="checkbox" checked={attachment.printIncluded !== false} disabled={busy} onChange={event => void save({ printIncluded: event.target.checked })} />随单打印此图</label>
    {attachment.imageWidth && attachment.imageHeight && <small>原图 {attachment.imageWidth} × {attachment.imageHeight} · 等比打印</small>}
    <label>图片说明<input value={caption} maxLength={500} onChange={event => setCaption(event.target.value)} /></label>
    <label>前后对照组（选填）<input value={printGroup} list={`photo-groups-${attachment.id}`} maxLength={24} placeholder="例如：压接前后对照" onChange={event => setPrintGroup(event.target.value)} /></label>
    <datalist id={`photo-groups-${attachment.id}`}>{[...new Set(report.attachments.map(photo => photo.printGroup).filter(Boolean))].map(group => <option key={group} value={group!} />)}</datalist>
    <small>两张图片使用相同组名，打印时保持并排同页；空白按排序自动排版。未勾选的图片仍可扫码查看。</small>
    <div><button type="button" disabled={busy} onClick={() => void save({ caption, printGroup })}>保存图片设置</button><button type="button" disabled={busy} onClick={() => void save({ direction: 'up' })}>前移</button><button type="button" disabled={busy} onClick={() => void save({ direction: 'down' })}>后移</button></div>{error && <small role="alert">{error}</small>}</div>;
}
