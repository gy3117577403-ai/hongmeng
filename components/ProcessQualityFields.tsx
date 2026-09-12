'use client';
/* eslint-disable @next/next/no-img-element */
import { useEffect, useId, useState } from 'react';
import { Camera, Check, ChevronDown, Plus, Search, ShieldCheck, Upload, X } from 'lucide-react';
import { emptyProcessQualityReport, PROCESS_QUALITY_ISSUES, PROCESS_QUALITY_LABELS, qualityResponsibilityLabel,
  type ProcessQualityReport, type ProcessQualityType } from '@/lib/process-quality-report';
import './process-quality.css';

type Person = { id: string; name: string; employeeNo: string };
export default function ProcessQualityFields({ type, value, onChange, defectQty, unit = '件', routeId, stepId, disabled, onBusy,
  upload = true }: { type: ProcessQualityType; value?: ProcessQualityReport; onChange: (value: ProcessQualityReport) => void;
    defectQty: number; unit?: string; routeId?: string; stepId?: string; disabled?: boolean; onBusy?: (busy: boolean) => void; upload?: boolean }) {
  const report = value || emptyProcessQualityReport(), labelId = useId();
  const [picker, setPicker] = useState(false), [people, setPeople] = useState<Person[]>([]), [query, setQuery] = useState('');
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!picker) return;
    const controller = new AbortController();
    fetch('/api/process-report-quality?employees=1&q=' + encodeURIComponent(query), { signal: controller.signal }).then(async r => {
      const body = await r.json(); if (!r.ok) throw new Error(body.error || '人员加载失败'); return body.data;
    }).then(setPeople).catch(e => { if (e.name !== 'AbortError') setError(e.message); });
    return () => controller.abort();
  }, [picker, query]);
  const allocations = report.responsibility.allocations;
  const assigned = allocations.reduce((n, row) => n + row.quantity, 0);
  const mismatch = report.responsibility.status === 'ASSIGNED' && assigned !== defectQty;
  function change(next: Partial<ProcessQualityReport>) { onChange({ ...report, ...next }); }
  async function files(selected: FileList | null) {
    if (!selected?.length || !routeId || !stepId) return;
    if (report.evidenceIds.length + selected.length > 6) { setError('每道工序最多 6 张照片'); return; }
    setBusy(true); onBusy?.(true); setError('');
    const ids = [...report.evidenceIds];
    try {
      for (const file of Array.from(selected)) {
        const form = new FormData(); form.set('file', file); form.set('routeId', routeId); form.set('stepId', stepId); form.set('idempotencyKey', crypto.randomUUID());
        const response = await fetch('/api/process-report-quality', { method: 'POST', body: form });
        const body = await response.json(); if (!response.ok) throw new Error(body.error || '照片上传失败');
        ids.push(body.data.id); change({ evidenceIds: [...ids] });
      }
    } catch (e) { setError(e instanceof Error ? e.message : '上传失败，已成功的照片保留，可重新选择失败照片'); }
    finally { setBusy(false); onBusy?.(false); }
  }
  return <section className="pquality" aria-labelledby={labelId}>
    <header><span><ShieldCheck size={17}/><b id={labelId}>{PROCESS_QUALITY_LABELS[type]}</b></span><small>{defectQty > 0 ? `发现不良 ${defectQty} ${unit}` : '未发现不良'}</small></header>
    {defectQty > 0 && <div className="pquality-responsibility">
      <label>不良责任人</label><div className="pquality-choice"><button type="button" disabled={disabled || busy} className={report.responsibility.status === 'PENDING' ? 'active' : ''} onClick={() => { change({ responsibility: { status: 'PENDING', allocations: [] } }); setPicker(false); }}>责任待确认</button>
      <button type="button" disabled={disabled || busy} className={report.responsibility.status === 'ASSIGNED' ? 'active' : ''} aria-expanded={picker} onClick={() => setPicker(!picker)}>{report.responsibility.status === 'ASSIGNED' ? qualityResponsibilityLabel(report.responsibility, defectQty) : '选择责任人'}<ChevronDown size={15}/></button></div>
      {picker && <div className="pquality-person-picker"><label><Search size={16}/><input autoFocus aria-label="搜索责任人" value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索姓名、工号"/></label><div className="pquality-people">{people.map(person => {
        const selected = allocations.some(row => row.employeeId === person.id);
        return <button type="button" disabled={disabled || busy} key={person.id} className={selected ? 'active' : ''} onClick={() => {
          const next = selected ? allocations.filter(row => row.employeeId !== person.id) : [...allocations, { employeeId: person.id, name: person.name, employeeNo: person.employeeNo, quantity: Math.max(1, defectQty - assigned) }];
          change({ responsibility: { status: next.length ? 'ASSIGNED' : 'PENDING', allocations: next } });
        }}><span><b>{person.name}</b><small>{person.employeeNo}</small></span>{selected ? <Check size={17}/> : <Plus size={16}/>}</button>;
      })}</div><button type="button" onClick={() => setPicker(false)}>完成选择</button></div>}
      {report.responsibility.status === 'ASSIGNED' && <div className="pquality-allocations">{allocations.map(row => <label key={row.employeeId}><span>{row.name || row.employeeNo || '所选员工'}</span><input aria-label={`${row.name || row.employeeNo || '员工'}责任数量`} type="number" inputMode="numeric" min="1" max={defectQty} value={row.quantity} disabled={disabled || busy} onChange={e => change({ responsibility: { ...report.responsibility, allocations: allocations.map(a => a.employeeId === row.employeeId ? { ...a, quantity: Number(e.target.value) } : a) } })}/><small>{unit}</small></label>)}<small className={mismatch ? 'error' : ''}>已分配 {assigned} / {defectQty} {unit}{mismatch ? '，请核对分配数量' : ''}</small></div>}
    </div>}
    <details className="pquality-more"><summary>补充问题与照片 <span>选填</span></summary><div className="pquality-detail-body"><div className="pquality-issues">{PROCESS_QUALITY_ISSUES[type].map(issue => <button type="button" className={report.issue === issue ? 'active' : ''} disabled={disabled || busy} key={issue} onClick={() => change({ issue: report.issue === issue ? '' : issue })}>{issue}</button>)}</div><textarea aria-label="质量问题说明" value={report.note} maxLength={2000} rows={2} disabled={disabled || busy} placeholder="补充问题、位置或处理情况" onChange={e => change({ note: e.target.value })}/>
      {upload && <><div className="pquality-upload"><label><Camera size={17}/>拍照<input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" disabled={disabled || busy} onChange={e => { void files(e.target.files); e.target.value = ''; }}/></label><label><Upload size={17}/>相册多选<input type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={disabled || busy} onChange={e => { void files(e.target.files); e.target.value = ''; }}/></label><small>{busy ? '正在上传…' : `${report.evidenceIds.length}/6 张`}</small></div><div className="pquality-photos">{report.evidenceIds.map((id, i) => <div key={id}><a href={'/api/process-report-quality?id=' + id} target="_blank" rel="noreferrer"><img src={'/api/process-report-quality?id=' + id} alt={`质量照片 ${i + 1}`}/></a><button type="button" aria-label={`移除质量照片 ${i + 1}`} disabled={disabled || busy} onClick={async () => {
        try { const r = await fetch('/api/process-report-quality?id=' + id, { method: 'DELETE' }); if (!r.ok) throw new Error((await r.json()).error); change({ evidenceIds: report.evidenceIds.filter(v => v !== id) }); } catch (e) { setError(e instanceof Error ? e.message : '移除失败'); }
      }}><X size={13}/></button></div>)}</div></>}
    </div></details>
    {error && <p className="pquality-error" role="alert">{error}<button type="button" onClick={() => setError('')}>关闭</button></p>}
  </section>;
}
