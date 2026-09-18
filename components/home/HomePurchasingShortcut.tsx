"use client";
import Link from "next/link";
import { ShoppingBag, Plus, ArrowUpRight } from "lucide-react";
import { useEffect, useState } from "react";
type Summary = {
  approval: number;
  execution: number;
  finance: number;
  requests: number;
};
export default function HomePurchasingShortcut() {
  const [data, setData] = useState<Summary | null>(null);
  useEffect(() => {
    let live = true;
    const refresh = () => {
      if (document.visibilityState === "hidden") return;
      fetch("/api/purchases/summary", { cache: "no-store" })
        .then((r) => {
          if (!r.ok) throw new Error();
          return r.json();
        })
        .then((j) => {
          if (live) setData(j.data);
        })
        .catch(() => {
          if (live) setData(null);
        });
    };
    refresh();
    const timer = setInterval(refresh, 30000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      live = false;
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);
  return (
    <div className="hm-purchase-shortcut">
      <Link className="hm-purchase-title" href="/workspace/purchases">
        <ShoppingBag size={19} />
        <strong>物品采购</strong>
        <ArrowUpRight size={15} />
      </Link>
      <div className="hm-purchase-counts">
        {(
          [
            ["approval", "待我审批", "approval", "条"],
            ["execution", "待我采购", "execution", "条"],
            ["finance", "待我付款", "finance", "单"],
            ["requests", "我的申请", "all", "条"],
          ] as const
        ).map(([key, label, view, unit]) => (
          <Link
            key={key}
            href={`/workspace/purchases?view=${view}&task=${key}`}
          >
            <span>{label}</span>
            <b>{data ? data[key] : "—"}</b>
            <small>{data ? unit : "待更新"}</small>
          </Link>
        ))}
      </div>
      <Link className="hm-purchase-create" href="/workspace/purchases?create=1">
        <Plus size={16} />
        发起请购
      </Link>
    </div>
  );
}
