"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import styles from "./QualityFixtureStatus.module.css";

export default function FixtureRequirementControl({ productId }: { productId: string }) {
  const [value, setValue] = useState<boolean | null>(null), [busy, setBusy] = useState(true), [error, setError] = useState("");
  useEffect(() => {
    const abort = new AbortController(); setBusy(true); setError("");
    fetch("/api/quality-fixtures?badges=" + encodeURIComponent(productId), { signal: abort.signal }).then(async r => {
      const j = await r.json(); if (!r.ok || !j.ok) throw new Error(j.error || "读取失败"); setValue(j.data[0]?.needFixture ?? null);
    }).catch(e => { if (!abort.signal.aborted) setError(e.message); }).finally(() => { if (!abort.signal.aborted) setBusy(false); });
    return () => abort.abort();
  }, [productId]);
  async function change(needFixture: boolean) {
    setBusy(true); setError("");
    try {
      const r = await fetch("/api/quality-fixtures", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ action: "SET_REQUIREMENT", productIds: [productId], needFixture }) });
      const j = await r.json(); if (!r.ok || !j.ok) throw new Error(j.error || "保存失败");
      setValue(needFixture); window.dispatchEvent(new Event("quality-fixture-updated"));
    } catch (e) { setError(e instanceof Error ? e.message : "保存失败"); } finally { setBusy(false); }
  }
  return <section className={styles.requirement} aria-label="产品治具要求"><div><strong>是否需要治具</strong><small>同一产品的计划共用此选择</small></div>
    <div role="group" aria-label="选择是否需要治具">{[true, false].map(need => <button key={String(need)} type="button" aria-pressed={value === need} disabled={busy} onClick={() => change(need)}>{need ? "需要治具" : "无需治具"}</button>)}</div>
    {value === null && <small>待选择</small>}{value === true && <Link href={"/workspace/quality-fixtures?view=plans&product=" + productId}>BOM 与治具准备 →</Link>}
    <Link href={"/workspace/quality-fixtures?view=review&product=" + productId}>资料审核与履历 →</Link>{error && <span role="alert">{error}</span>}
  </section>;
}
