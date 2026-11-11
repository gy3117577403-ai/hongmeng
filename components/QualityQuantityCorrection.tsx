'use client';

import { useEffect, useState } from 'react';
import type { QualityCorrectionPreview } from '@/lib/process-quality-correction-service';

export function QualityQuantityCorrection({ routeId, completionId, onClose, onSaved }: {
  routeId: string; completionId: string; onClose: () => void; onSaved: () => void;
}) {
  const [preview, setPreview] = useState<QualityCorrectionPreview | null>(null);
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [key] = useState(() => crypto.randomUUID());
  const url = `/api/process-management/routes/${encodeURIComponent(routeId)}/completions/${encodeURIComponent(completionId)}/correct-quality`;
  useEffect(() => {
    let active = true;
    fetch(url, { cache: 'no-store' }).then(async response => {
      const value = await response.json();
      if (!response.ok || !value.ok) throw new Error(value.error || '更正预览失败');
      if (active) setPreview(value.data);
    }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [url]);
  async function submit() {
    if (!preview?.canExecute || !confirmed || busy || reason.trim().length < 4) return;
    setBusy(true); setError('');
    try {
      const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ previewToken: preview.previewToken, reason, confirmActualWork: confirmed, idempotencyKey: key }) });
      const value = await response.json();
      if (!response.ok || !value.ok) throw new Error(value.error || '更正失败');
      onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : '更正失败'); }
    finally { setBusy(false); }
  }
  return <div className="workflow-correction-backdrop"><section className="workflow-correction-dialog" role="dialog" aria-modal="true" aria-label="质量数量更正预览" style={{ maxWidth: 780, maxHeight: '90vh', overflowY: 'auto', background: 'white', padding: 24, borderRadius: 18 }}>
    <header><h2>质量数量更正预览</h2><button type="button" aria-label="关闭质量更正预览" disabled={busy} onClick={onClose}>×</button></header>
    <p>预览不会修改记录。此操作将本笔误填不良全部更正为良品，并作废未发生业务的关联返工单。</p>
    {error && <p role="alert" style={{ color: '#b42318' }}>{error}</p>}
    {!preview && !error && <p>正在核对报工、返工及工时台账…</p>}
    {preview && <>
      <p><strong>{preview.workOrderCode} · {preview.processName}</strong><br />工作日期：{preview.workDate}</p>
      <table style={{ width: '100%', textAlign: 'left', margin: '16px 0' }}><thead><tr><th>项目</th><th>更正前</th><th>更正后</th></tr></thead><tbody>
        <tr><td>整套处理数量</td><td>{preview.before.processedQty}</td><td>{preview.after.processedQty}</td></tr>
        <tr><td>整套良品</td><td>{preview.before.goodQty}</td><td>{preview.after.goodQty}</td></tr>
        <tr><td>整套不良</td><td>{preview.before.defectQty}</td><td>{preview.after.defectQty}</td></tr>
        <tr><td>报工动作数量</td><td>{preview.before.reportedUnitQty}</td><td>{preview.after.reportedUnitQty}（保留）</td></tr>
        <tr><td>不良动作数量</td><td>{preview.before.reportedDefectUnitQty}</td><td>0</td></tr>
      </tbody></table>
      <p>关联返工：{preview.branch?.code || '无'} → 误建作废（保留历史）</p>
      <p><strong>工时差额：0</strong> · {preview.labor.policy}</p>
      <table style={{ width: '100%', textAlign: 'left' }}><thead><tr><th>员工／日期</th><th>原工时</th><th>更正后</th><th>差额</th></tr></thead><tbody>
        {preview.labor.claims.map(c => <tr key={c.id}><td>{c.employee} · {c.workDate}</td><td>{Number(c.beforeMilliseconds) / 1000} 秒</td><td>{Number(c.afterMilliseconds) / 1000} 秒</td><td>0 秒</td></tr>)}
      </tbody></table>
      {!preview.labor.claims.length && <p>该笔暂无有效领取工时；本操作不会新增工时。</p>}
      {preview.warnings.map(w => <p key={w}>{w}</p>)}
      {preview.blockers.length > 0 && <div role="alert" style={{ color: '#b42318' }}><strong>当前不能执行：</strong><ul>{preview.blockers.map(b => <li key={b}>{b}</li>)}</ul></div>}
      <label style={{ display: 'block', margin: '16px 0' }}>更正原因<textarea aria-label="质量更正原因" maxLength={500} value={reason} onChange={e => setReason(e.target.value)} disabled={busy} style={{ display: 'block', width: '100%', minHeight: 70 }} /></label>
      <label><input type="checkbox" checked={confirmed} disabled={busy} onChange={e => setConfirmed(e.target.checked)} /> 已核实本次劳动真实发生，仅良品／不良品分类误填，非重复报工</label>
      <footer style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 20 }}><button disabled={busy} onClick={onClose}>关闭预览</button><button type="button" disabled={busy || !preview.canExecute || !confirmed || reason.trim().length < 4} onClick={() => { void submit(); }}>{busy ? '正在更正…' : '确认更正并作废误建返工单'}</button></footer>
    </>}
  </section></div>;
}
