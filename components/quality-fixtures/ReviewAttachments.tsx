"use client";
import { useState } from "react";

export type ReviewAttachment = { id: string; name: string };
export function ReviewAttachmentLinks({ ids, files }: { ids: string[]; files?: ReviewAttachment[] }) {
  return <span className="qf-review-attachments">{ids.map((id, i) => <a key={id} href={"/api/quality-fixtures/review-files?id=" + encodeURIComponent(id)} target="_blank" rel="noreferrer">{files?.find(f => f.id === id)?.name || `说明附件 ${i + 1}`}</a>)}</span>;
}

export default function ReviewAttachments({ productId, files, onChange, onError, disabled, onBusy }: {
  productId: string; files: ReviewAttachment[]; onChange: (files: ReviewAttachment[]) => void; onError: (message: string) => void;
  disabled?: boolean; onBusy?: (busy: boolean) => void;
}) {
  const [uploading, setUploading] = useState(false);
  async function upload(selected: FileList | null) {
    if (!selected?.length) return;
    if (files.length + selected.length > 6) { onError("最多附 6 份说明附件"); return; }
    setUploading(true); onBusy?.(true);
    const next = [...files];
    try {
      for (const file of Array.from(selected)) {
        const body = new FormData(); body.set("product", productId); body.set("file", file);
        const r = await fetch("/api/quality-fixtures/review-files", { method: "POST", body });
        const data = await r.json(); if (!r.ok) throw new Error(data.error || "附件上传失败");
        next.push(data.data); onChange([...next]);
      }
    } catch (e) { onError(e instanceof Error ? e.message : "附件上传失败"); }
    finally { setUploading(false); onBusy?.(false); }
  }
  return <div className="qf-review-attachments">
    {files.map(f => <span key={f.id}><a href={"/api/quality-fixtures/review-files?id=" + f.id} target="_blank" rel="noreferrer">{f.name}</a><button type="button" aria-label={"移除附件 " + f.name} disabled={disabled || uploading} onClick={() => onChange(files.filter(v => v.id !== f.id))}>×</button></span>)}
    <label>{uploading ? "附件上传中…" : "＋ 添加截图 / PDF（选填）"}<input aria-label="上传说明附件" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" multiple disabled={disabled || uploading || files.length >= 6} onChange={e => { void upload(e.target.files); e.target.value = ""; }} /></label>
  </div>;
}
