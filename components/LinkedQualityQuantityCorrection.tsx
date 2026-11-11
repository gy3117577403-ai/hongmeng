'use client';
import { useEffect, useState } from 'react';
import type { LinkedQualityCorrectionPreview } from '@/lib/linked-quality-correction-service';

export function LinkedQualityQuantityCorrection({ routeId, completionId, onClose, onSaved }: {
  routeId: string; completionId: string; onClose: () => void; onSaved: () => void;
}) {
  const [preview, setPreview] = useState<LinkedQualityCorrectionPreview | null>(null);
  const [reason, setReason] = useState(''); const [confirmed, setConfirmed] = useState(false);
  const [later, setLater] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [key] = useState(() => crypto.randomUUID());
  const url = `/api/process-management/routes/${encodeURIComponent(routeId)}/completions/${encodeURIComponent(completionId)}/correct-quality-linked`;
  useEffect(() => {
    let active = true;
    fetch(url, { cache: 'no-store' }).then(async r => { const v = await r.json(); if (!r.ok || !v.ok) throw Error(v.error || '关联预览失败'); if (active) setPreview(v.data); })
      .catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [url]);
  async function submit() {
    if (!preview?.canExecute || !confirmed || busy || reason.trim().length < 4 || (preview.requiresLaterActionConfirmation && !later)) return;
    setBusy(true); setError('');
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        previewToken: preview.previewToken, reason, confirmActualWork: confirmed, confirmLaterActions: later, idempotencyKey: key,
      }) });
      const v = await r.json(); if (!r.ok || !v.ok) throw Error(v.error || '关联更正失败'); onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : '关联更正失败'); } finally { setBusy(false); }
  }
  return <div className="workflow-correction-backdrop"><section className="workflow-correction-dialog" role="dialog" aria-modal="true" aria-label="关联质量更正预览" style={{ maxWidth: 980, maxHeight: '90vh', overflowY: 'auto', padding: 24, background: 'white', borderRadius: 18 }}>
    <header><h2>关联质量更正预览</h2><button aria-label="关闭关联预览" disabled={busy} onClick={onClose}>×</button></header>
    <p>预览不修改记录。本路线下列不良报工将一起更正，已有空返工单一并作废；后续使用已有报工核销，不补报、不重新计工。</p>
    {error && <p role="alert" style={{ color: '#b42318' }}>{error}</p>}
    {!preview && !error && <p>正在核对关联数量、动作来源和全部工时…</p>}
    {preview && <>
      <h3>{preview.workOrderCode} · 共 {preview.corrections.length} 笔</h3>
      <table style={{ width: '100%', textAlign: 'left' }}><thead><tr><th>工序／日期</th><th>良品</th><th>不良</th><th>处理／动作数量</th><th>关联返工</th></tr></thead><tbody>
        {preview.corrections.map(c => <tr key={c.completionId}><td>{c.processName}<br />{c.workDate}</td><td>{c.before.goodQty} → {c.after.goodQty}</td><td>{c.before.defectQty} → 0</td><td>{c.before.processedQty}／{c.before.reportedUnitQty}（保留）</td><td>{c.branch ? `${c.branch.code} → 误建作废` : '尚未生成，无需作废'}</td></tr>)}
      </tbody></table>
      <p><strong>成品：{preview.closure.beforeCompleted} → {preview.closure.afterCompleted} / {preview.closure.target}</strong> · {preview.closure.expectedCompleted ? '按当前数据预计生产完成，提交时再次校验' : '更正后仍有未完成事项，不强制结单'}</p>
      <table style={{ width: '100%', textAlign: 'left' }}><thead><tr><th>工序</th><th>已核销 → 预计核销</th><th>预计待核销</th></tr></thead><tbody>{preview.steps.map(s => <tr key={s.id}><td>{s.name}{s.mode !== 'NORMAL' ? '（补充工序）' : ''}</td><td>{s.mode !== 'NORMAL' ? `已报 ${s.supplementReported}，保留原履行记录` : `${s.beforeCovered} → ${s.afterCovered}`}</td><td>{s.pending}</td></tr>)}</tbody></table>
      <details><summary>工时逐笔对照：{preview.claims.length} 笔，差额 0</summary><table style={{ width: '100%', textAlign: 'left' }}><thead><tr><th>员工／工作日期</th><th>状态</th><th>原工时</th><th>更正后</th></tr></thead><tbody>{preview.claims.map(c => <tr key={c.id}><td>{c.employee}／{c.workDate}</td><td>{c.status}</td><td>{Number(c.beforeMilliseconds) / 1000} 秒</td><td>{Number(c.afterMilliseconds) / 1000} 秒</td></tr>)}</tbody></table></details>
      {preview.requiresLaterActionConfirmation && <div><h3>同日后录入动作来源</h3>{preview.actionAllocations.filter(a => a.laterAction).map(a => <p key={`${a.sourceCompletionId}:${a.consumerCompletionId}`}>使用 {new Date(a.sourceCompletedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })} 的有效动作 {a.quantity} 个，支持同日先录入的整套报工；原时间不变。</p>)}</div>}
      {preview.warnings.map(w => <p key={w}>{w}</p>)}
      {preview.blockers.length > 0 && <div role="alert" style={{ color: '#b42318' }}><strong>当前不能执行：</strong><ul>{preview.blockers.map(b => <li key={b}>{b}</li>)}</ul></div>}
      <label style={{ display: 'block', marginTop: 16 }}>关联更正原因<textarea aria-label="关联更正原因" maxLength={500} value={reason} disabled={busy} onChange={e => setReason(e.target.value)} style={{ width: '100%', minHeight: 70, display: 'block' }} /></label>
      <label style={{ display: 'block', margin: '12px 0' }}><input type="checkbox" checked={confirmed} disabled={busy} onChange={e => setConfirmed(e.target.checked)} /> 已核实以上全部记录为真实劳动，仅质量分类误填，非重复报工</label>
      {preview.requiresLaterActionConfirmation && <label style={{ display: 'block' }}><input type="checkbox" checked={later} disabled={busy} onChange={e => setLater(e.target.checked)} /> 已核实并同意使用预览列出的同日后录入动作，保留原时间与工时</label>}
      <footer style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 16 }}><button disabled={busy} onClick={onClose}>关闭关联预览</button><button disabled={busy || !preview.canExecute || !confirmed || reason.trim().length < 4 || (preview.requiresLaterActionConfirmation && !later)} onClick={() => void submit()}>{busy ? '正在更正并核销…' : '确认关联更正并核销'}</button></footer>
    </>}
  </section></div>;
}
