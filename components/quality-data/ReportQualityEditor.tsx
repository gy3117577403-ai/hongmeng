'use client';
import { useState } from 'react';
import { X } from 'lucide-react';
import ProcessQualityFields from '@/components/ProcessQualityFields';
import { emptyProcessQualityReport, type ProcessQualityType } from '@/lib/process-quality-report';
import type { QualityRecord } from '@/lib/quality-data';
import { qualityRequest, qualityJson } from './client';

export default function ReportQualityEditor({ record, onSaved, onClose }: { record: QualityRecord; onSaved: (r: QualityRecord) => void; onClose: () => void }) {
  const [value, setValue] = useState({ ...emptyProcessQualityReport(), responsibility: record.responsibility || emptyProcessQualityReport().responsibility,
    issue: record.reportSnapshot?.issue || '', note: record.reportSnapshot?.note || record.data.summary });
  const [reason, setReason] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function save() {
    if (!reason.trim()) { setError('请填写变更原因'); return; }
    setBusy(true); setError('');
    try { onSaved(await qualityRequest<QualityRecord>('records/' + record.id, qualityJson('PATCH', { action: 'UPDATE_REPORT_DETAILS', version: record.version, qualityReport: value, reason }))); onClose(); }
    catch (e) { setError(e instanceof Error ? e.message : '保存失败'); } finally { setBusy(false); }
  }
  return <div className="qd-modal" role="dialog" aria-modal="true" aria-label="补充报工质量记录"><section className="report-quality-editor"><header><div><small>{record.title}</small><h2>责任与问题说明</h2></div><button type="button" onClick={onClose} disabled={busy} aria-label="关闭质量补充"><X size={20}/></button></header><p>检验总数 {record.data.context.inspectionQty} · 不良 {record.data.context.defectQty} {record.reportSnapshot?.unit || '件'}。数量由原报工提供。</p>
    <ProcessQualityFields type={record.type as ProcessQualityType} value={value} defectQty={Number(record.data.context.defectQty || 0)} unit={record.reportSnapshot?.unit} onChange={setValue} disabled={busy} upload={false}/>
    <label>变更原因<textarea aria-label="质量补充原因" value={reason} onChange={e => setReason(e.target.value)} maxLength={1000} disabled={busy} rows={2}/></label>{error && <p role="alert" className="qd-alert error">{error}</p>}<footer><button type="button" disabled={busy} onClick={onClose}>取消</button><button type="button" className="qd-primary" disabled={busy} onClick={() => void save()}>{busy ? '正在保存…' : '保存补充'}</button></footer></section></div>;
}
