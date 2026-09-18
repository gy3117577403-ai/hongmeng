"use client";
import Link from "next/link";
import HomeQuickAction from "./HomeQuickAction";
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
  return <HomeQuickAction label="资料与治具" count={data ? data.supervisor + data.quality + data.draft : null} icon={<ShieldCheck size={16} />}>
    <div className="hm-quick-items">{([["supervisor","待我初审","review&status=SUPERVISOR&mine=1"],["quality","待我复审","review&status=QUALITY&mine=1"],["draft","待补资料","review&status=MISSING"],["purchasing","治具采购待处理","purchases"]] as const).map(([k,label,view]) => <Link key={k} href={view === "purchases" ? "/workspace/purchases?source=FIXTURE" : "/workspace/quality-fixtures?view=" + view}><span>{label}</span><b>{data ? data[k] : "—"}</b></Link>)}</div>
    <Link className="hm-quick-primary" href="/workspace/quality-fixtures?view=plans">进入治具准备<ArrowUpRight size={15}/></Link>
  </HomeQuickAction>;
}
