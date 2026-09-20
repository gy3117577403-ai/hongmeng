"use client";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { DrawingLibraryFileDTO } from "@/types";
import styles from "./DocumentReturns.module.css";
const time = (s?: string | null) => s ? new Date(s).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false }) : "历史未记录";
export function fileTimeLabel(kind?: string) { return kind === "UPLOAD" ? "本版上传" : kind === "PUBLISH" ? "本版发布" : "历史入库"; }
export default function DrawingFileHistory({ file, onClose }: { file: DrawingLibraryFileDTO; onClose: () => void }) {
  const modal = useRef<HTMLElement>(null);
  useEffect(() => { const old = document.activeElement as HTMLElement; modal.current?.querySelector("button")?.focus(); return () => old?.focus(); }, []);
  return createPortal(<div className={styles.overlay} onKeyDown={e => {
    if (e.key === "Escape") onClose();
    if (e.key === "Tab") { const nodes = Array.from(modal.current?.querySelectorAll<HTMLElement>('button,a[href]') || []);
      if (e.shiftKey && document.activeElement === nodes[0]) { e.preventDefault(); nodes.at(-1)?.focus(); } else if (!e.shiftKey && document.activeElement === nodes.at(-1)) { e.preventDefault(); nodes[0]?.focus(); } }
  }}><section ref={modal} role="dialog" aria-modal="true" aria-label="文件时间与版本履历" className={styles.drawer}>
    <header className={styles.header}><div><small>{file.displayName || file.originalName}</small><h2>文件时间与版本履历</h2></div><button aria-label="关闭文件履历" onClick={onClose}>×</button></header>
    <div className={styles.body}><p>首次上传：{time(file.timing?.firstUploadedAt)}</p><p>{fileTimeLabel(file.timing?.timeKind)}：{time(file.timing?.recordedAt || file.createdAt)} · {file.uploadedBy || "历史未记录"}</p><p>最近内容变更：{file.timing?.contentChangedAt ? time(file.timing.contentChangedAt) : file.timing?.firstUploadedAt ? "尚未变更" : "历史未记录"}</p><p className={styles.muted}>技术解释、审核和备注编辑不计入文件内容变更。历史同步资料仅显示可以确认的入库时间。</p>
      {(file.timing?.history || []).map((h, i) => <article key={h.id} className={styles.event}><strong>{h.version} {i === 0 ? "· 当前版本" : "· 历史版本"}</strong><p>{h.name}</p><small className={styles.stamp}>{fileTimeLabel(h.kind)}：{time(h.at)} · {h.actor}</small><a href={h.downloadUrl} target="_blank" rel="noreferrer">下载此版本</a></article>)}
    </div><footer className={styles.footer}><button onClick={onClose}>关闭</button></footer>
  </section></div>, document.body);
}
