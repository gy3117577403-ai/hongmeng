"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

export default function HomeQuickAction({ label, count, icon, children }: { label: string; count: number | null; icon: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false), [position, setPosition] = useState({ top: 0, right: 12 });
  const trigger = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const place = () => { const r = trigger.current!.getBoundingClientRect(); setPosition({ top: r.bottom + 8, right: Math.max(12, window.innerWidth - r.right) }); };
    const outside = (e: PointerEvent) => { if (!panel.current?.contains(e.target as Node) && !trigger.current?.contains(e.target as Node)) setOpen(false); };
    const escape = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); trigger.current?.focus(); } };
    place(); window.addEventListener("resize", place); window.addEventListener("scroll", place, true);
    document.addEventListener("pointerdown", outside); document.addEventListener("keydown", escape);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [open]);
  return <><button ref={trigger} className="hm-quick-trigger" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen(!open)}>{icon}<span>{label}</span>{count === null ? <small>—</small> : count > 0 && <b>{count}</b>}</button>
    {open && createPortal(<div ref={panel} className="hm-quick-glass" role="dialog" aria-label={label + "快捷办理"} style={position}>
      <header><strong>{label}</strong><button aria-label="关闭快捷办理" onClick={() => { setOpen(false); trigger.current?.focus(); }}><X size={16} /></button></header>{children}
    </div>, document.body)}</>;
}
