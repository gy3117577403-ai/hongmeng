"use client";
import Link from "next/link";
import { ShieldCheck, ArrowUpRight } from "lucide-react";
import { useEffect, useState } from "react";
export default function HomeQualityFixtureShortcut() {
  const [data, setData] = useState<{ supervisor: number; quality: number; draft: number; purchasing: number } | null>(null);
  useEffect(() => {
    let live = true;
    const refresh = () => fetch("/api/quality-fixtures?summary=1", { cache: "no-store" }).then(async r => { const j = await r.json(); if (!r.ok || !j.ok) throw new Error(); if (live) setData(j.data); }).catch(() => { if (live) setData(null); });
    void refresh(); window.addEventListener("focus", refresh);
    return () => { live = false; window.removeEventListener("focus", refresh); };
  }, []);
  return <div className="hm-purchase-shortcut"><Link className="hm-purchase-title" href="/workspace/quality-fixtures"><ShieldCheck size={19} /><strong>资料与治具</strong><ArrowUpRight size={15} /></Link>
    <div className="hm-purchase-counts">{([["supervisor","待我初审","/workspace/quality-fixtures?view=review"],["quality","待我复审","/workspace/quality-fixtures?view=review"],["draft","资料待完善","/workspace/quality-fixtures?view=plans"],["purchasing","治具采购待处理","/workspace/purchases?source=FIXTURE"]] as const).map(([k,label,href]) => <Link key={k} href={href}><span>{label}</span><b>{data ? data[k] : "—"}</b><small>{data ? "项" : "待更新"}</small></Link>)}</div>
    <Link className="hm-purchase-create" href="/workspace/quality-fixtures?view=plans">准备生产资料</Link></div>;
}
