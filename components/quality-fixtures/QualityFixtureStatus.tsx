"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { QF_STATUS } from "@/lib/quality-fixture-domain";
import styles from "./QualityFixtureStatus.module.css";
type Badge = { submissionIssues?: string[]; id: string; productId?: string; status: string; revision?: string; fixtureLabel: string; printAllowed: boolean; pendingRevision?: string; legacy?: boolean;packageId?:string; needFixture?:boolean|null; supervisor?:string; quality?:string;supervisorAt?:string;qualityAt?:string;groups?:{model:string;required:number;available:number;incoming:number;shortage:number}[]; drawingFiles?: {id:string;name:string;version:string}[]; sopFiles?:{id:string;name:string;version:string}[] };
type Entry = { data?: Badge; error?: boolean; at: number; listeners: Set<() => void> };
const cache = new Map<string, Entry>(), queue = new Set<string>();
let timer: ReturnType<typeof setTimeout> | null = null;
function enqueue(key: string) {
  queue.add(key); if (timer) return;
  timer = setTimeout(async () => {
    timer = null; const keys = [...queue]; queue.clear();
    for (const kind of ["products", "orders", "batches"]) {
      const ids = keys.filter(k => k.startsWith(kind + ":")).map(k => k.slice(kind.length + 1));
      for (let start = 0; start < ids.length; start += 100) {
        const batch = ids.slice(start, start + 100);
        try {
          const r = await fetch("/api/quality-fixtures?kind=" + kind + "&badges=" + encodeURIComponent(batch.join(",")), { cache: "no-store" });
          const j = await r.json(); if (!r.ok || !j.ok) throw new Error();
          for (const b of j.data as Badge[]) { const e = cache.get(kind + ":" + b.id); if (e) { e.data = b; e.error = false; e.at = Date.now(); e.listeners.forEach(fn => fn()); } }
        } catch { for (const id of batch) { const e = cache.get(kind + ":" + id); if (e) { e.error = true; e.listeners.forEach(fn => fn()); } } }
      }
    }
  }, 35);
}
export function QualityFixtureStatus({ id, kind = "products", compact = false }: { id?: string | null; kind?: "products" | "orders" | "batches"; compact?: boolean }) {
  const [, render] = useState(0), key = kind + ":" + (id || "");
  useEffect(() => {
    if (!id) return;
    const entry = cache.get(key) || { at: 0, listeners: new Set<() => void>() };
    cache.set(key, entry);
    const update = () => render(n => n + 1), refresh = () => { if (document.visibilityState !== "hidden") enqueue(key); };
    entry.listeners.add(update);
    if (Date.now() - entry.at > 20000) enqueue(key);
    window.addEventListener("focus", refresh); window.addEventListener("quality-fixture-updated", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => { entry.listeners.delete(update); window.removeEventListener("focus", refresh); window.removeEventListener("quality-fixture-updated", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [id, key]);
  const e = cache.get(key), badge = e?.data;
  const product = badge?.productId || (kind === "products" ? id : "");
  const href = "/workspace/quality-fixtures?view=review" + (product ? "&product=" + product : "");
  return <div className={styles.status + (compact ? " " + styles.compact : "")} onClick={event => event.stopPropagation()}>
    <Link href={badge?.legacy && product ? "/drawing-library?itemId=" + product : href} className={styles.mainLink}><ShieldCheck size={13}/><b className={badge?.printAllowed ? styles.ready : styles.wait}>{!id ? "先关联产品资料" : e?.error ? "资料状态待刷新" : badge ? badge.legacy ? "沿用原规则" : badge.status === "DRAFT" && badge.submissionIssues?.length === 0 ? "可提交审核" : QF_STATUS[badge.status] || "资料待完善" : "读取资料状态…"}</b></Link>
    {badge && !badge.legacy && <small>{badge.needFixture ? <Link href={"/workspace/quality-fixtures?view=plans&product=" + product}>{badge.fixtureLabel} ↗</Link> : badge.fixtureLabel}{badge.printAllowed ? " · 可打印" : ""}{badge.pendingRevision ? " · 新版待审" : ""}</small>}
    {!compact && badge && !badge.legacy && <details className={styles.detail}><summary>查看工单资料与审核</summary><div><strong>适用版本 {badge.revision || "待完善"}</strong><small>主管：{badge.supervisor || "待审核"} · 品质：{badge.quality || "待审核"}</small><small>{badge.supervisorAt ? "主管 " + new Date(badge.supervisorAt).toLocaleString("zh-CN") : ""}{badge.qualityAt ? " / 品质 " + new Date(badge.qualityAt).toLocaleString("zh-CN") : ""}</small>{badge.groups?.map(g=><small key={g.model}>{g.model} · 需求 {g.required} / 可用 {g.available} / 在途 {g.incoming} / 缺口 {g.shortage}</small>)}{[["图纸",badge.drawingFiles || []],["SOP",badge.sopFiles || []]].map(([label,files]) => <div key={String(label)}><strong>{String(label)}</strong>{(files as {id:string;name:string;version:string}[]).map(f => <a key={f.id} target="_blank" rel="noreferrer" href={"/api/drawing-library/files/"+f.id+"/content"}>{f.name} · {f.version} ↗</a>)}</div>)}<Link href={href + (badge.pendingRevision ? "" : badge.status === "APPROVED" ? "&package=" + badge.packageId : "")}>查看审核记录 →</Link></div></details>}
  </div>;
}
