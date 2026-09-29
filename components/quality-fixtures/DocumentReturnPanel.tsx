"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { GlassNotice } from "@/components/GlassNotice";
import type { ReturnData } from "@/lib/quality-document-returns";
import ReviewAttachments, { ReviewAttachmentLinks, type ReviewAttachment } from "./ReviewAttachments";
import styles from "./DocumentReturns.module.css";

const time = (s?: string | null) => s ? new Date(s).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false }) : "—";
const labels: Record<string, string> = { OPEN: "待技术处理", READY: "已回复 · 待重新提交", REVIEWING: "已提交复核", RESOLVED: "已复核通过" };
const kind = (s: string) => s === "drawing" ? "图纸" : s === "sop" ? "SOP" : "历史整包";
const events: Record<string, string> = { TECHNICAL_RESPONSE: "技术回复", RESUBMIT_RETURNS: "重新提交双方审核", REPLACE_DOCUMENT: "更换文件", RETURNS_RESOLVED: "双方通过，问题关闭", RECONCILE_REVIEW: "核对当前资料与复核关联" };

export default function DocumentReturnPanel({ productId, title, canManage, onClose, onChanged, onNext, onViewReview }: {
  productId: string; title: string; canManage: boolean; onClose: () => void; onChanged: () => Promise<unknown> | void; onNext?: () => void; onViewReview?: (packageId: string) => void;
}) {
  const [data, setData] = useState<ReturnData | null>(null), [selected, setSelected] = useState("");
  const [history, setHistory] = useState(false), [mode, setMode] = useState("EXPLAIN"), [reason, setReason] = useState(""), [fileId, setFileId] = useState("");
  const [attachments, setAttachments] = useState<ReviewAttachment[]>([]), [busy, setBusy] = useState(false), [uploading, setUploading] = useState(false), [error, setError] = useState("");
  const modal = useRef<HTMLElement>(null), pending = useRef(false), request = useRef<{ body: string; key: string } | null>(null);
  const dirty = useRef(false), draftIssue = useRef("");
  const closeError = useCallback(() => setError(""), []);
  const reload = useCallback(async () => {
    const response = await fetch("/api/quality-fixtures?returns=" + productId, { cache: "no-store" });
    const result = await response.json(); if (!response.ok) throw new Error(result.error || "退回事项加载失败");
    setData(result.data); return result.data as ReturnData;
  }, [productId]);
  useEffect(() => { void reload().catch(e => setError(e.message)); }, [reload]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement, overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden"; modal.current?.querySelector<HTMLElement>("button")?.focus();
    return () => { document.body.style.overflow = overflow; previous?.focus(); };
  }, []);
  const visible = data?.issues.filter(i => history || i.status !== "RESOLVED") || [];
  const issue = visible.find(i => i.id === selected) || visible[0];
  useEffect(() => {
    if (!issue) return;
    if (draftIssue.current === issue.id && dirty.current) return;
    draftIssue.current = issue.id; dirty.current = false;
    setMode(issue.responseMode || "EXPLAIN"); setReason(issue.responseText); setFileId(issue.responseFileId || "");
    setAttachments(issue.responseAttachmentIds.map(id => ({ id, name: data?.attachments.find(f => f.id === id)?.name || "说明附件" })));
    // Uploaded replacements refresh the list without discarding an unsaved explanation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issue?.id, issue?.version]);
  const active = data?.issues.filter(i => i.status !== "RESOLVED") || [];
  const readyToSubmit = data?.review.state === 'RETURN_READY';
  const editable = !!issue && canManage && ["OPEN", "READY"].includes(issue.status);
  const currentFiles = data?.files.filter(f => f.isCurrent && (issue?.kind === "package" || f.category.code === issue?.kind)) || [];
  const replacementTarget = currentFiles.find(f => f.id === fileId) || currentFiles.find(f => {
    let cursor: typeof f | undefined = f; const seen = new Set<string>();
    while (cursor && !seen.has(cursor.id)) {
      if (cursor.id === issue?.fileId || cursor.supersedesFileId === issue?.fileId) return true;
      seen.add(cursor.id); cursor = data?.files.find(v => v.id === cursor?.supersedesFileId);
    }
    return issue?.kind === "package" && f.id === (fileId || currentFiles[0]?.id);
  }) || (currentFiles.length === 1 ? currentFiles[0] : undefined);
  async function command(body: Record<string, unknown>) {
    const text = JSON.stringify(body);
    if (request.current?.body !== text) request.current = { body: text, key: crypto.randomUUID() };
    const r = await fetch("/api/quality-fixtures", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": request.current.key }, body: text });
    const value = await r.json(); if (!r.ok) throw new Error(value.error || "处理失败"); request.current = null; return value.data;
  }
  async function act(fn: () => Promise<void>) {
    if (pending.current || uploading) return; pending.current = true; setBusy(true); setError("");
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : "操作失败"); }
    finally { pending.current = false; setBusy(false); }
  }
  async function submitAll(snapshot: ReturnData) {
    const remaining = snapshot.issues.filter(i => i.status !== "RESOLVED");
    await command({ action: "RESUBMIT_RETURNS", libraryItemId: productId, versions: Object.fromEntries(remaining.map(i => [i.id, i.version])) });
    await reload(); await onChanged(); window.dispatchEvent(new Event("quality-fixture-updated"));
  }
  async function save(andSubmit: boolean) {
    if (!issue) return;
    await command({ action: "RESPOND_RETURN", id: issue.id, version: issue.version, mode, reason, fileId: fileId || undefined, attachmentIds: attachments.map(f => f.id) });
    dirty.current = false;
    const next = await reload();
    if (andSubmit) await submitAll(next); else await onChanged();
  }
  async function upload(file: File) {
    await act(async () => {
      if (!replacementTarget) throw new Error("找不到可替换的当前文件，请刷新后选择");
      const body = new FormData(); body.set("categoryId", replacementTarget.categoryId); body.set("replaceFileId", replacementTarget.id); body.set("file", file);
      body.set("discardPrevious", "true");
      if (reason.trim()) body.set("remark", reason);
      const r = await fetch(`/api/drawing-library/${productId}/files/upload`, { method: "POST", body });
      const result = await r.json(); if (!r.ok) throw new Error(result.error || "更换文件失败");
      dirty.current = true; setFileId(result.file.id); await onChanged(); await reload();
    });
  }
  const close = () => { if (!busy && !uploading) onClose(); };
  return createPortal(<>
    <div className={styles.overlay} onKeyDown={e => {
      if (e.key === "Escape") { e.preventDefault(); close(); }
      if (e.key === "Tab") { const nodes = Array.from(modal.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href]') || []).filter(n => n.offsetParent !== null);
        if (e.shiftKey && document.activeElement === nodes[0]) { e.preventDefault(); nodes.at(-1)?.focus(); } else if (!e.shiftKey && document.activeElement === nodes.at(-1)) { e.preventDefault(); nodes[0]?.focus(); } }
    }}>
      <section ref={modal} className={styles.drawer} role="dialog" aria-modal="true" aria-labelledby="return-panel-title">
        <header className={styles.header}><div><small>{title}</small><h2 id="return-panel-title">退回处理与复核</h2></div><button type="button" aria-label="关闭退回处理" disabled={busy || uploading} onClick={close}><X size={18}/></button></header>
        <div className={styles.body}>
          {data && <div className={styles.currentReview} role="status"><div><small>当前流程</small><strong>{data.review.label}</strong><span>{data.currentPackage ? data.currentPackage.revision + ' · 资料 #' + data.currentPackage.sequence : '当前资料待建立'}</span></div>{data.review.action === 'RECONCILE' && canManage && <button disabled={busy || uploading} onClick={() => void act(async () => { await command({ action: 'RECONCILE_REVIEW', libraryItemId: productId, id: data.currentPackage?.id, version: data.currentPackage?.version }); await reload(); await onChanged(); })}>核对审核关联</button>}{data.review.action === 'RECONCILE' && !canManage && <small>需技术人员核对</small>}</div>}
          <div className={styles.tabs}><button disabled={busy || uploading} aria-pressed={!history} onClick={() => { setHistory(false); setSelected(""); }}>未关闭事项 {active.length}</button><button disabled={busy || uploading} aria-pressed={history} onClick={() => { setHistory(true); setSelected(""); }}>全部履历</button></div>
          <div className={styles.issueList}>{visible.map(i => <button key={i.id} disabled={busy || uploading} aria-pressed={issue?.id === i.id} onClick={() => setSelected(i.id)}>{kind(i.kind)} · {i.fileSnapshot.name}<small>{labels[i.status]}</small></button>)}</div>
          {!data ? <p className={styles.empty}>正在加载退回记录…</p> : !issue ? <p className={styles.empty}>暂无未关闭退回事项，可在全部履历中查看过去记录。</p> : <>
            <div className={styles.meta}><strong>{kind(issue.kind)} · {labels[issue.status]}</strong><span className={styles.muted}>原退回资料 #{issue.sourcePackage.sequence} · {issue.fileSnapshot.version}</span>{issue.fileId && data.files.some(f => f.id === issue.fileId) && <a href={`/api/drawing-library/files/${issue.fileId}/content`} target="_blank" rel="noreferrer">查看原退回文件 ↗</a>}</div>
            <div className={styles.reason}><strong>{issue.reviewRole === "SUPERVISOR" ? "主管" : issue.reviewRole === "QUALITY" ? "品质" : "历史审核"}退回意见</strong><p>{issue.reason}</p>{issue.location && <p>位置：{issue.location}</p>}<small className={styles.muted}>{issue.returnedByName} · {time(issue.createdAt)}</small><ReviewAttachmentLinks ids={issue.attachmentIds} files={data.attachments}/></div>
            {editable ? <>
              <div className={styles.mode}><button disabled={busy || uploading} aria-pressed={mode === "EXPLAIN"} onClick={() => setMode("EXPLAIN")}>说明原因，保留原文件</button><button disabled={busy || uploading} aria-pressed={mode === "REPLACE"} onClick={() => setMode("REPLACE")}>更换文件</button></div>
              {mode === "REPLACE" && <><label className={styles.field}>更换后的版本<select aria-label="更换后的版本" value={fileId} disabled={busy || uploading} onChange={e => { dirty.current = true; setFileId(e.target.value); }}><option value="">上传新版本或选择已经替换的版本</option>{currentFiles.filter(f => f.id !== issue.fileId).map(f => <option key={f.id} value={f.id}>{f.displayName || f.originalName} · {f.version}</option>)}</select></label><label className={styles.upload}>上传并替换问题文件<small>{replacementTarget ? `将替换 ${replacementTarget.displayName || replacementTarget.originalName} · ${replacementTarget.version}，旧文件移除，处理记录保留` : "请选择对应的当前文件"}</small><input aria-label="上传替换文件" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" disabled={busy || uploading || !replacementTarget} onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void upload(f); }}/></label></>}
              <label className={styles.field}>{mode === "EXPLAIN" ? "技术解释（必填）" : "修改说明（必填）"}<textarea aria-label={mode === "EXPLAIN" ? "技术解释" : "修改说明"} maxLength={2000} disabled={busy || uploading} value={reason} placeholder={mode === "EXPLAIN" ? "说明为什么保留原文件，可注明客户要求、页码或确认依据" : "说明更改了哪里，如何解决退回问题"} onChange={e => { dirty.current = true; setReason(e.target.value); }}/></label>
              <ReviewAttachments productId={productId} files={attachments} onChange={v => { dirty.current = true; setAttachments(v); }} onError={setError} disabled={busy} onBusy={setUploading}/>
              <p className={styles.muted}>解释不等于通过。重新提交后，主管与品质均需重新确认，BOM 和治具准备不影响送审。</p>
            </> : issue.responseText && <div className={styles.reply}><strong>{issue.responseMode === "REPLACE" ? "已更换文件" : "原文件重新提交 · 已补充技术说明"}</strong><p>{issue.responseText}</p>{issue.responseFile && <a href={`/api/drawing-library/files/${issue.responseFile.id}/content`} target="_blank" rel="noreferrer">{issue.responseFile.displayName || issue.responseFile.originalName} · {issue.responseFile.version}</a>}<small className={styles.stamp}>{issue.respondedByName} · {time(issue.respondedAt)}</small><ReviewAttachmentLinks ids={issue.responseAttachmentIds} files={data.attachments}/>{issue.resolvedAt && <small className={styles.stamp}>双方复核通过：{time(issue.resolvedAt)}</small>}</div>}
          </>}
          {data && <details className={styles.history}><summary>关联工单与打印记录 · {data.orders.length} 项</summary><p className={styles.muted}>已发出的纸质资料需由技术与现场核查，历史打印记录继续保留。</p>{data.orders.map(o => <div className={styles.order} key={o.id}><strong>{o.code}</strong><span>{o.status} · {o.printCount} 次打印</span></div>)}</details>}
          {!!data?.events.length && <details className={styles.history}><summary>技术处理时间线</summary>{data.events.map(e => <div className={styles.event} key={e.id}><strong>{events[e.action] || e.action} · {e.actorName}</strong><p>{e.reason || (e.action === "RESUBMIT_RETURNS" ? "开启新一轮主管、品质审核；历史签名保留" : "操作时的资料和处理快照已保留")}</p><small className={styles.muted}>{time(e.createdAt)}</small></div>)}</details>}
        </div>
        <footer className={styles.footer}><small>{active.filter(i => i.status === "OPEN").length} 项待回复 · {active.filter(i => i.status === "REVIEWING").length} 项待复核</small>
          {editable && <button disabled={busy || uploading || !reason.trim() || mode === "REPLACE" && !fileId} onClick={() => void act(() => save(false))}>保存本项处理</button>}
          {editable && data?.review.action !== 'RECONCILE' && active.every(i => i.id === issue?.id || i.status === "READY" && (!i.responseFileId || data?.files.some(f => f.id === i.responseFileId && f.isCurrent))) ? <button className={styles.primary} disabled={busy || uploading || !reason.trim() || mode === "REPLACE" && !fileId} onClick={() => void act(() => save(true))}>保存并重新提交审核</button> : canManage && readyToSubmit ? <button className={styles.primary} disabled={busy || uploading} onClick={() => void act(() => submitAll(data!))}>重新提交双方审核</button> : null}
          {data?.review.action === 'REVIEW' && data.review.packageId && (onViewReview ? <button className={styles.primary} disabled={busy || uploading} onClick={() => onViewReview(data.review.packageId!)}>进入当前审核</button> : <a className={styles.reviewLink} href={'/workspace/quality-fixtures?product=' + productId + '&package=' + data.review.packageId}>查看本次审核 →</a>)}
          {onNext && <button disabled={busy || uploading} onClick={onNext}>下一项待处理 →</button>}
          {!editable && <button disabled={busy || uploading} onClick={close}>关闭</button>}
        </footer>
      </section>
    </div>
    <GlassNotice message={error} error close={closeError}/>
  </>, document.body);
}
