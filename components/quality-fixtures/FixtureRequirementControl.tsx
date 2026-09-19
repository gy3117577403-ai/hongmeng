"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { GlassNotice } from "@/components/GlassNotice";
import styles from "./QualityFixtureStatus.module.css";

export default function FixtureRequirementControl({ productId, initialValue, initialStatus, compact = false, inline = false, disabled = false, week = '', onSaved }: {
  productId: string; initialValue?: boolean | null; initialStatus?: string; compact?: boolean; inline?: boolean; disabled?: boolean; week?: string; onSaved?: (value: boolean) => Promise<void> | void;
}) {
  const [value, setValue] = useState<boolean | null>(initialValue ?? null), [status, setStatus] = useState(initialStatus || ''), [busy, setBusy] = useState(initialValue === undefined);
  const [error, setError] = useState(''), [message, setMessage] = useState(''), [pending, setPending] = useState<boolean | null>(null);
  const identity = useRef(productId), saving = useRef(false), controller = useRef<AbortController | null>(null);
  identity.current = productId;
  const clearMessage = useCallback(() => setMessage(''), []), clearError = useCallback(() => setError(''), []);
  useEffect(() => {
    let alive = true;
    const load = () => {
      controller.current?.abort();
      const abort = new AbortController(); controller.current = abort;
      setBusy(true);
      fetch('/api/quality-fixtures?badges=' + encodeURIComponent(productId), { signal: abort.signal }).then(async r => {
        const j = await r.json(); if (!r.ok || !j.ok) throw new Error(j.error || '读取失败');
        if (alive && !abort.signal.aborted) { setValue(j.data[0]?.needFixture ?? null); setStatus(j.data[0]?.status || ''); }
      }).catch(e => { if (alive && !abort.signal.aborted) setError(e.message); }).finally(() => { if (alive && !abort.signal.aborted) setBusy(false); });
    };
    setPending(null); setError(''); setMessage('');
    if (initialValue !== undefined) { setValue(initialValue); setStatus(initialStatus || ''); setBusy(false); } else load();
    window.addEventListener('quality-fixture-updated', load);
    return () => { alive = false; controller.current?.abort(); window.removeEventListener('quality-fixture-updated', load); };
  }, [productId, initialValue, initialStatus]);

  async function change(needFixture: boolean) {
    if (saving.current || disabled) return;
    const target = productId;
    saving.current = true; setBusy(true); setError(''); controller.current?.abort();
    try {
      const r = await fetch('/api/quality-fixtures', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify({ action: 'SET_REQUIREMENT', productIds: [target], needFixture, expectedNeedFixture: value }) });
      const j = await r.json(); if (!r.ok || !j.ok) throw new Error(j.error || '保存失败');
      window.dispatchEvent(new Event('quality-fixture-updated'));
      if (identity.current !== target) return;
      setValue(needFixture); setPending(null); if (!onSaved) setMessage(needFixture ? '已选择需要治具，可继续准备 BOM' : '已选择无需治具，资料状态已同步');
      await onSaved?.(needFixture);
    } catch (e) { if (identity.current === target) setError(e instanceof Error ? e.message : '保存失败'); }
    finally { saving.current = false; if (identity.current === target) setBusy(false); }
  }
  const suffix = week ? '&week=' + encodeURIComponent(week) : '';
  function choose(need: boolean) {
      if (need === value) return;
      if (['REVIEWING', 'SUPERVISOR', 'QUALITY', 'APPROVED', 'SUPERSEDED'].includes(status)) setPending(need); else void change(need);
  }
  return <section className={inline ? styles.inlineRequirement : styles.requirement} aria-label="产品治具要求">
    {inline ? <label title={disabled ? '历史版本只读' : '产品的全部计划共用此选择'}>治具<select aria-label="是否需要治具" value={value === null ? '' : String(value)} disabled={busy || disabled} onChange={e => choose(e.target.value === 'true')}><option value="" disabled>待选择</option><option value="true">需要治具</option><option value="false">无需治具</option></select></label> : <>
      <div><strong>是否需要治具</strong><small>{disabled ? '历史版本只读，请切回当前版本修改' : '同一产品的计划共用此选择'}</small></div>
      <div role="group" aria-label="选择是否需要治具">{[true, false].map(need => <button key={String(need)} type="button" aria-pressed={value === need} disabled={busy || disabled} onClick={() => choose(need)}>{need ? '需要治具' : '无需治具'}</button>)}</div>
      {value === null && <small>待选择</small>}
      {!compact && <>{value === true && <Link href={'/workspace/quality-fixtures?view=plans&product=' + productId + suffix}>BOM 与治具准备 →</Link>}<Link href={'/workspace/quality-fixtures?view=review&product=' + productId + suffix}>资料审核与履历 →</Link></>}
    </>}
    <GlassNotice message={error || message} error={!!error} close={error ? clearError : clearMessage} />
    <ConfirmDialog open={pending !== null} title="变更当前产品的治具要求？" description={`将改为${pending ? '需要治具' : '无需治具'}，并生成新资料版本重新由主管、品质审核，两项都通过后可打印。现有图纸和 SOP 沿用，历史审核、已发工单引用及采购库存记录保留。`} confirmLabel="确认变更" busy={busy} onCancel={() => { if (!busy) setPending(null); }} onConfirm={() => { if (pending !== null) void change(pending); }} />
  </section>;
}
