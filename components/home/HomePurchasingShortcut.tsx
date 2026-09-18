"use client";
import Link from "next/link";
import { ShoppingBag, Plus, ArrowUpRight } from "lucide-react";
import { useEffect, useState } from "react";
import HomeQuickAction from "./HomeQuickAction";
type Summary = { approval: number; execution: number; finance: number; requests: number };
export default function HomePurchasingShortcut() {
  const [data, setData] = useState<Summary | null>(null);
  useEffect(() => {
    let live = true;
    const refresh = () => {
      if (document.visibilityState === "hidden") return;
      fetch("/api/purchases/summary", { cache: "no-store" }).then(async r => { const j = await r.json(); if (!r.ok || !j.ok) throw new Error(); if (live) setData(j.data); }).catch(() => { if (live) setData(null); });
    };
    refresh(); const timer = setInterval(refresh, 30000); window.addEventListener("focus", refresh);
    return () => { live = false; clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, []);
  return <HomeQuickAction label="采购" count={data ? data.approval + data.execution + data.finance : null} icon={<ShoppingBag size={16} />}>
    <div className="hm-quick-items">{([["approval","待我审批","approval"],["execution","待我采购","execution"],["finance","待我付款","finance"],["requests","我的申请","all"]] as const).map(([key,label,view]) => <Link key={key} href={`/workspace/purchases?view=${view}&task=${key}`}><span>{label}</span><b>{data ? data[key] : "—"}</b></Link>)}</div>
    <Link className="hm-quick-primary" href="/workspace/purchases?create=1"><Plus size={16} />发起请购<ArrowUpRight size={15} /></Link>
  </HomeQuickAction>;
}
