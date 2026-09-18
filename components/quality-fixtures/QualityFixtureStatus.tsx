"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { QF_STATUS } from "@/lib/quality-fixture-domain";
import styles from "./QualityFixtureStatus.module.css";
type Badge = { id: string; productId?: string; status: string; revision?: string; fixtureLabel: string; printAllowed: boolean; pendingRevision?: string };
type Entry = { data?: Badge; error?: boolean; at: number; listeners: Set<() => void> };
const cache = new Map<string, Entry>(), queue = new Set<string>();
let timer: ReturnType<typeof setTimeout> | null = null;
function enqueue(key: string) {
  queue.add(key); if (timer) return;
  timer = setTimeout(async () => {
    timer = null; const keys = [...queue]; queue.clear();
    for (const kind of ["products", "orders"]) {
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
export function QualityFixtureStatus({ id, kind = "products", compact = false }: { id?: string | null; kind?: "products" | "orders"; compact?: boolean }) {
  const [, render] = useState(0), key = kind + ":" + (id || "");
  useEffect(() => {
    if (!id) return;
    const entry = cache.get(key) || { at: 0, listeners: new Set<() => void>() };
    cache.set(key, entry);
    const update = () => render(n => n + 1), refresh = () => { if (document.visibilityState !== "hidden") enqueue(key); };
    entry.listeners.add(update);
    if (Date.now() - entry.at > 20000) enqueue(key);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => { entry.listeners.delete(update); window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [id, key]);
  const e = cache.get(key), badge = e?.data;
  return <Link className={styles.status + (compact ? " " + styles.compact : "")} href={"/workspace/quality-fixtures?view=plans" + ((badge?.productId || (kind === "products" && id)) ? "&product=" + (badge?.productId || id) : "")} title="打开资料审核与导通治具准备" onClick={event => event.stopPropagation()}>
    <ShieldCheck size={13} /><span><b className={badge?.printAllowed ? styles.ready : styles.wait}>{!id ? "先关联产品资料" : e?.error ? "资料状态待刷新" : badge ? QF_STATUS[badge.status] || "待准备资料" : "读取资料状态…"}</b>
      {badge && <small>{badge.fixtureLabel}{badge.printAllowed ? " · 可打印" : " · 待审核打印"}{badge.pendingRevision ? " · 新版待审" : ""}</small>}</span>
  </Link>;
}
