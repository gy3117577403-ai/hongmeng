"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowRight, Check, CheckCircle2, ChevronRight, Clock3, FileText, History, RotateCcw, ShieldCheck, Upload, X } from "lucide-react";
import { PdfViewer } from "@/components/PdfViewer";
import { ImageViewer } from "@/components/ImageViewer";
import { requestPreviewLeave } from "@/components/DocumentOrientation";
import type { ReturnData } from "@/lib/quality-document-returns";
import type { QfReviewRole } from "@/lib/quality-fixture-domain";
import { orderedReturns, replacementCandidates, returnCounts, returnStatusLabel } from "@/lib/quality-return-workbench";
import ReviewAttachments, { ReviewAttachmentLinks, type ReviewAttachment } from "./ReviewAttachments";
import styles from "./DocumentReturns.module.css";

const time = (s?: string | null) => s ? new Date(s).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : "—";
const kind = (s: string) => s === "drawing" ? "图纸" : s === "sop" ? "SOP" : "整包资料";
const roleName = (s: string) => s === 'SUPERVISOR' ? '主管' : s === 'QUALITY' ? '品质' : '历史审核';
const eventNames: Record<string, string> = { TECHNICAL_RESPONSE: "保存技术处理", RESUBMIT_RETURNS: "提交双方复核", REPLACE_DOCUMENT: "更换文件", RETURNS_RESOLVED: "双方复核通过", RECONCILE_REVIEW: "核对审核关联" };
type Issue = ReturnData['issues'][number];
type Draft = { version: number; mode: string; reason: string; fileId: string; attachments: ReviewAttachment[] };

export default function DocumentReturnPanel({ productId, title, canManage, onClose, onChanged, onViewReview, onNext }: {
  productId: string; title: string; canManage: boolean; onClose: () => void; onChanged: () => Promise<unknown> | void; onViewReview?: (packageId: string) => void; onNext?: () => void;
}) {
  const [data, setData] = useState<ReturnData | null>(null), [selected, setSelected] = useState('');
  const [history, setHistory] = useState(false), [editing, setEditing] = useState<string | null>(null), [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [busy, setBusy] = useState(false), [uploading, setUploading] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [closePrompt, setClosePrompt] = useState(false), [previewId, setPreviewId] = useState(''), [checked, setChecked] = useState(false);
  const [returning, setReturning] = useState(false), [returnReason, setReturnReason] = useState(''), [returnLocation, setReturnLocation] = useState('');
  const [returnFiles, setReturnFiles] = useState<string[]>([]), [returnRole, setReturnRole] = useState<QfReviewRole>('QUALITY'), [returnAttachments, setReturnAttachments] = useState<ReviewAttachment[]>([]);
  const modal = useRef<HTMLElement>(null), detail = useRef<HTMLDivElement>(null), pending = useRef(false), alive = useRef(true);
  const request = useRef<{ body: string; key: string } | null>(null);
  const reload = useCallback(async () => {
    const r = await fetch('/api/quality-fixtures?returns=' + productId, { cache: 'no-store' });
    const result = await r.json(); if (!r.ok) throw new Error(result.error || '退回事项加载失败');
    if (alive.current) setData(result.data); return result.data as ReturnData;
  }, [productId]);
  useEffect(() => { alive.current = true; void reload().catch(e => setError(e.message)); return () => { alive.current = false; }; }, [reload]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement, overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden'; modal.current?.querySelector<HTMLElement>('button')?.focus();
    return () => { document.body.style.overflow = overflow; previous?.focus(); };
  }, []);
  const counts = returnCounts(data?.issues || []), active = data?.issues.filter(i => i.status !== 'RESOLVED') || [];
  const visible = orderedReturns(data?.issues.filter(i => history || i.status !== 'RESOLVED') || []), issue = visible.find(i => i.id === selected) || visible[0];
  const current = data?.currentPackage, pendingReview = data?.review.action === 'REVIEW';
  const currentReviewIssue = active.find(i => i.status === 'REVIEWING' && i.submittedPackageId === current?.id);
  const review = pendingReview && issue?.status === 'REVIEWING' && issue.submittedPackageId === current?.id;
  const editable = !!issue && canManage && (issue.status === 'OPEN' || issue.status === 'READY' && (editing === issue.id || !!drafts[issue.id]));
  const candidates = issue ? replacementCandidates(data?.files || [], issue) : [];
  const baseDraft = (i: Issue): Draft => {
    const currentFiles = replacementCandidates(data?.files || [], i);
    const replaced = !!i.fileId && !currentFiles.some(f => f.id === i.fileId);
    return { version: i.version, mode: replaced ? 'REPLACE' : i.responseMode || 'EXPLAIN', reason: i.responseText,
      fileId: currentFiles.some(f => f.id === i.responseFileId) ? i.responseFileId! : replaced && currentFiles.length === 1 ? currentFiles[0].id : '',
      attachments: i.responseAttachmentIds.map(id => ({ id, name: data?.attachments.find(f => f.id === id)?.name || '说明附件' })) };
  };
  const originalReplaced = !!issue?.fileId && !candidates.some(f => f.id === issue.fileId);
  const draft = issue ? drafts[issue.id] || baseDraft(issue) : null;
  const replacement = candidates.find(f => f.id === draft?.fileId) || (candidates.length === 1 ? candidates[0] : undefined);
  const fileChanged = replacement && replacement.id !== issue?.fileId;
  const valid = !!draft?.reason.trim() && draft.version === issue?.version && (draft.mode !== 'REPLACE' || candidates.some(f => f.id === draft.fileId && f.id !== issue?.fileId));
  const lastOpen = !!issue && active.every(i => i.id === issue.id || i.status === 'READY') && !Object.keys(drafts).some(id => id !== issue.id);
  const reviewFiles = [...(current?.drawingFiles || []), ...(current?.sopFiles || [])];
  const preview = review ? reviewFiles.find(f => f.id === previewId) || reviewFiles.find(f => f.id === issue?.responseFileId) || reviewFiles.find(f => f.id === issue?.fileId) || reviewFiles[0] : data?.files.filter(f => !f.deletedAt).map(f => ({ ...f, name: f.displayName || f.originalName })).find(f => f.id === previewId);
  const selectedRound = data?.rounds.find(r => r.id === issue?.submittedPackageId);
  useEffect(() => { setChecked(false); setReturning(false); setPreviewId(''); detail.current?.scrollTo(0, 0); }, [issue?.id, current?.id, current?.version]);
  function change(patch: Partial<Draft>) { if (issue) setDrafts(before => ({ ...before, [issue.id]: { ...(before[issue.id] || baseDraft(issue)), ...patch } })); }
  function choose(id: string) { requestPreviewLeave(() => { setSelected(id); setError(''); setNotice(''); }); }
  async function command(body: Record<string, unknown>) {
    const text = JSON.stringify(body); if (request.current?.body !== text) request.current = { body: text, key: crypto.randomUUID() };
    const r = await fetch('/api/quality-fixtures', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': request.current.key }, body: text });
    const result = await r.json(); if (!r.ok) { if (r.status === 409) await reload(); throw new Error(result.error || '操作失败'); } request.current = null; return result.data;
  }
  async function act(fn: () => Promise<void>) {
    if (pending.current || uploading) return; pending.current = true; setBusy(true); setError(''); setNotice('');
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : '操作失败，内容已保留'); } finally { pending.current = false; setBusy(false); }
  }
  async function changed() { await onChanged(); window.dispatchEvent(new Event('quality-fixture-updated')); }
  async function submitAll(snapshot: ReturnData) {
    await command({ action: 'RESUBMIT_RETURNS', libraryItemId: productId, versions: Object.fromEntries(snapshot.issues.filter(i => i.status !== 'RESOLVED').map(i => [i.id, i.version])) });
    await reload(); await changed(); setEditing(null); setNotice('已提交双方复核');
  }
  async function save(next: boolean) {
    if (!issue || !draft) return;
    await command({ action: 'RESPOND_RETURN', id: issue.id, version: draft.version, mode: draft.mode, reason: draft.reason, fileId: draft.fileId || undefined, attachmentIds: draft.attachments.map(f => f.id) });
    setDrafts(before => { const copy = { ...before }; delete copy[issue.id]; return copy; }); setSelected(issue.id); setEditing(null); setNotice('本项处理已保存');
    const snapshot = await reload(); await changed(); if (!next) return;
    const remaining = orderedReturns(snapshot.issues).find(i => i.status === 'OPEN') || snapshot.issues.find(i => i.id !== issue.id && drafts[i.id]);
    if (remaining) { choose(remaining.id); if (remaining.status === 'READY') setEditing(remaining.id); setNotice('上一项已保存'); }
    else if (snapshot.review.state === 'RETURN_READY') { try { await submitAll(snapshot); } catch (e) { throw new Error('处理已保存，提交复核未成功：' + (e instanceof Error ? e.message : '请重试')); } }
  }
  async function upload(file: File) {
    await act(async () => {
      if (!replacement || !issue) throw new Error('请先选择要替换的文件');
      const body = new FormData(); body.set('categoryId', replacement.categoryId); body.set('replaceFileId', replacement.id); body.set('file', file); body.set('discardPrevious', 'true'); if (draft?.reason.trim()) body.set('remark', draft.reason);
      const r = await fetch(`/api/drawing-library/${productId}/files/upload`, { method: 'POST', body });
      const result = await r.json(); if (!r.ok) throw new Error(result.error || '更换文件失败');
      change({ fileId: result.file.id, mode: 'REPLACE' }); await changed(); const snapshot = await reload();
      // Upload may invalidate a review round. Keep the entered explanation with the response's new version.
      const updated = snapshot.issues.find(i => i.id === issue.id);
      if (updated) setDrafts(before => ({ ...before, [issue.id]: { ...(before[issue.id] || baseDraft(issue)), version: updated.version, fileId: result.file.id, mode: 'REPLACE' } }));
      setNotice('新文件已上传，保存处理后提交复核');
    });
  }
  function startReturn() {
    const role = data?.reviewRoles[0]; if (!role) return;
    setReturning(true); setReturnRole(role); setReturnReason(''); setReturnLocation(''); setReturnAttachments([]); setReturnFiles(preview ? [preview.id] : []);
    requestAnimationFrame(() => detail.current?.scrollTo({ top: detail.current.scrollHeight, behavior: 'smooth' }));
  }
  async function sign(action: 'APPROVE' | 'RETURN', role: QfReviewRole) {
    if (!current) return;
    await command({ action, id: current.id, version: current.version, reviewRole: role, confirmed: checked, ...(action === 'RETURN' ? { reason: returnReason, fileIds: returnFiles, location: returnLocation, attachmentIds: returnAttachments.map(f => f.id) } : {}) });
    setChecked(false); setReturning(false); await changed(); const snapshot = await reload();
    if (snapshot.issues.every(i => i.status === 'RESOLVED')) setHistory(true);
    setNotice(action === 'RETURN' ? roleName(role) + '已退回技术处理' : snapshot.currentPackage?.status === 'APPROVED' ? '双方复核通过，退回事项已关闭' : roleName(role) + '已通过，等待另一方复核');
  }
  function close() { if (!busy && !uploading) requestPreviewLeave(() => Object.keys(drafts).length || returning && returnReason.trim() ? setClosePrompt(true) : onClose()); }

  return createPortal(<div className={styles.overlay} onKeyDown={e => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    if (e.key === 'Tab') { const nodes = Array.from(modal.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href]') || []).filter(n => n.offsetParent !== null); if (e.shiftKey && document.activeElement === nodes[0]) { e.preventDefault(); nodes.at(-1)?.focus(); } else if (!e.shiftKey && document.activeElement === nodes.at(-1)) { e.preventDefault(); nodes[0]?.focus(); } }
  }}><section ref={modal} className={styles.drawer} role="dialog" aria-modal="true" aria-labelledby="return-panel-title" aria-busy={busy}>
    <header className={styles.header}><span className={styles.headerIcon}><RotateCcw size={22}/></span><div><h2 id="return-panel-title">退回处理与复核</h2><p>{title}{current && <span>资料 #{current.sequence} · {current.revision}</span>}</p></div><button className={styles.iconButton} aria-label="关闭退回处理" disabled={busy || uploading} onClick={close}><X size={20}/></button></header>
    <div className={styles.flow} aria-label="当前处理进度">{pendingReview || current?.status === 'APPROVED' ? <><span className={styles.flowDone}><CheckCircle2 size={16}/>技术已提交 <small>{current?.submittedByName} · {time(current?.submittedAt)}</small></span><ChevronRight size={15}/>{(['SUPERVISOR', 'QUALITY'] as const).map(role => { const done = role === 'SUPERVISOR' ? current?.supervisorAt : current?.qualityAt; const name = role === 'SUPERVISOR' ? current?.supervisorName : current?.qualityName; return <span key={role} className={done ? styles.flowDone : styles.flowPending}>{done ? <CheckCircle2 size={16}/> : <Clock3 size={16}/>} {roleName(role)}{done ? '已通过' : '待复核'}{done && <small>{name} · {time(done)}</small>}</span>; })}</> : <><strong>共 {counts.active} 项</strong><span className={counts.open ? styles.flowOpen : ''}>待处理 <b>{counts.open}</b></span><ChevronRight size={15}/><span>待提交 <b>{counts.ready}</b></span><ChevronRight size={15}/><span>待复核 <b>{counts.reviewing}</b></span></>}{data?.review.action === 'RECONCILE' && <button disabled={busy || !canManage} onClick={() => void act(async () => { await command({ action: 'RECONCILE_REVIEW', libraryItemId: productId, id: current?.id, version: current?.version }); await reload(); await changed(); })}>核对审核关联</button>}</div>
    <div className={styles.body + (preview ? ' ' + styles.withPreview : '')}>
      <aside className={styles.sidebar} aria-label="退回事项列表"><div className={styles.listHeader}><strong>退回事项</strong><button aria-pressed={history} onClick={() => { setHistory(!history); setSelected(''); }} disabled={busy || uploading}><History size={14}/>{history ? '收起历史' : '历史 ' + counts.resolved}</button></div><div className={styles.issueList}>{visible.map((i, index) => <button key={i.id} className={styles.issue} aria-pressed={issue?.id === i.id} disabled={busy || uploading} onClick={() => choose(i.id)}><div className={styles.issueTop}><span>{String(index + 1).padStart(2, '0')} · {kind(i.kind)}</span><span className={styles.status} data-status={i.status}>{returnStatusLabel[i.status]}</span></div><strong>{i.reason}</strong><small>{i.returnedByName} · {roleName(i.reviewRole)} · {time(i.createdAt)}</small><span className={styles.issueFile}>{i.fileSnapshot.name} · {i.fileSnapshot.version}</span>{drafts[i.id] && <em>未保存</em>}</button>)}</div>{!!counts.resolved && !history && <button className={styles.historyToggle} onClick={() => setHistory(true)}>查看已关闭 {counts.resolved} 项 <ChevronRight size={14}/></button>}</aside>
      <div ref={detail} className={styles.detail}>
        {!data ? <div className={styles.empty} role="status">正在加载退回事项…</div> : !issue ? <div className={styles.empty}><CheckCircle2 size={30}/><h3>当前没有待处理事项</h3>{counts.resolved > 0 && <button onClick={() => setHistory(true)}>查看处理记录</button>}</div> : <>
          <div className={styles.detailTitle}><h3>{kind(issue.kind)}处理</h3><span className={styles.status} data-status={issue.status}>{returnStatusLabel[issue.status]}</span></div>
          <section className={styles.reason} aria-label="原退回意见"><div className={styles.sectionTitle}><strong>{roleName(issue.reviewRole)}退回</strong><small>{issue.returnedByName} · {time(issue.createdAt)}</small></div><p>{issue.reason}</p>{issue.location && <span className={styles.location}>问题位置 · {issue.location}</span>}<div className={styles.fileMeta}><FileText size={14}/><span>{issue.fileSnapshot.name} · {issue.fileSnapshot.version}</span><small>原资料 #{issue.sourcePackage.sequence}</small></div><ReviewAttachmentLinks ids={issue.attachmentIds} files={data.attachments}/></section>
          {editable && draft ? <section className={styles.editor} aria-label="技术处理"><div className={styles.sectionTitle}><h3>本次处理</h3>{issue.status === 'READY' && <button className={styles.textButton} disabled={busy || uploading} onClick={() => setEditing(null)}>查看已保存结果</button>}</div><div className={styles.mode}><button aria-pressed={draft.mode === 'EXPLAIN'} disabled={busy || uploading || originalReplaced} title={originalReplaced ? '原文件已更换，请保存新版本处理' : undefined} onClick={() => change({ mode: 'EXPLAIN' })}><FileText size={16}/>说明原因，保留原文件</button><button aria-pressed={draft.mode === 'REPLACE'} disabled={busy || uploading} onClick={() => change({ mode: 'REPLACE', fileId: fileChanged ? replacement.id : '' })}><Upload size={16}/>更换文件</button></div>
            {draft.mode === 'REPLACE' && <div className={styles.replacement}>{(candidates.length > 1 || candidates.some(f => f.id !== issue.fileId && f.id !== draft.fileId)) && <label className={styles.field}>{issue.kind === 'package' ? '选择对应文件' : '可用的新版本'}<select aria-label="更换后的版本" value={draft.fileId} onChange={e => change({ fileId: e.target.value })} disabled={busy || uploading}><option value="">选择对应的当前文件</option>{candidates.filter(f => f.id !== issue.fileId).map(f => <option key={f.id} value={f.id}>{f.displayName || f.originalName} · {f.version}</option>)}</select></label>}{replacement && <div className={styles.replacedFile}><span className={styles.fileIcon}><FileText size={22}/></span><div><strong>{replacement.displayName || replacement.originalName}</strong><span>{fileChanged ? <>{issue.fileSnapshot.version}<ArrowRight size={13}/><b>{replacement.version}</b></> : replacement.version}</span>{fileChanged && <small>{replacement.uploadedBy?.displayName || replacement.uploadedBy?.username || '历史上传'} · {time(replacement.createdAt)}</small>}</div>{fileChanged && <CheckCircle2 size={19} className={styles.green}/>}</div>}<div className={styles.fileActions}>{replacement && <button disabled={busy || uploading} onClick={() => requestPreviewLeave(() => setPreviewId(replacement.id))}>预览文件</button>}<label className={styles.upload}><Upload size={15}/>{fileChanged ? '重新更换' : '上传新版本'}<input aria-label="上传替换文件" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" disabled={busy || uploading || !replacement} onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void upload(f); }}/></label></div>{!candidates.length && <p className={styles.inlineWarning}>原文件已移除或关联发生变化，请到图纸资料库核对对应文件。</p>}</div>}
            <label className={styles.field}>{draft.mode === 'REPLACE' ? '修改说明' : '技术解释'} <span className={styles.required}>*</span><textarea aria-label={draft.mode === 'REPLACE' ? '修改说明' : '技术解释'} maxLength={2000} disabled={busy || uploading} value={draft.reason} placeholder={draft.mode === 'REPLACE' ? '填写修改位置和处理结果' : '填写保留原文件的依据'} onChange={e => change({ reason: e.target.value })}/></label><ReviewAttachments productId={productId} files={draft.attachments} onChange={v => change({ attachments: v })} onError={setError} disabled={busy} onBusy={setUploading}/>{draft.version !== issue.version && <div className={styles.inlineWarning}>此事项已由其他操作更新。<button onClick={() => setDrafts(before => { const copy = { ...before }; delete copy[issue.id]; return copy; })}>载入最新处理</button></div>}
          </section> : issue.responseText ? <section className={styles.receipt} aria-label="技术处理结果"><div className={styles.sectionTitle}><h3><CheckCircle2 size={17}/>{issue.responseMode === 'REPLACE' ? '已更换文件' : '已补充技术说明'}</h3>{canManage && issue.status === 'READY' && <button className={styles.textButton} onClick={() => setEditing(issue.id)}>修改处理</button>}</div><p>{issue.responseText}</p>{issue.responseFile && <div className={styles.receiptFile}><FileText size={20}/><div><strong>{issue.responseFile.displayName || issue.responseFile.originalName}</strong><span>{issue.responseMode === 'REPLACE' ? issue.fileSnapshot.version + ' → ' : ''}{issue.responseFile.version}</span></div>{data.files.some(f => f.id === issue.responseFileId && !f.deletedAt) && <button onClick={() => requestPreviewLeave(() => setPreviewId(issue.responseFileId!))}>查看文件</button>}</div>}<div className={styles.stamp}>{issue.respondedByName} · {time(issue.respondedAt)}</div><ReviewAttachmentLinks ids={issue.responseAttachmentIds} files={data.attachments}/></section> : !canManage && <p className={styles.waiting}><Clock3 size={16}/>等待技术处理</p>}
          {selectedRound && ['REVIEWING', 'RESOLVED'].includes(issue.status) && <section className={styles.signatures} aria-label="本次复核结果"><div className={styles.sectionTitle}><h3>双方复核</h3><small>资料 #{selectedRound.sequence}</small></div>{(['SUPERVISOR', 'QUALITY'] as const).map(role => { const at = role === 'SUPERVISOR' ? selectedRound.supervisorAt : selectedRound.qualityAt; const name = role === 'SUPERVISOR' ? selectedRound.supervisorName : selectedRound.qualityName; return <div className={styles.signature} key={role}><span className={at ? styles.signedIcon : styles.pendingIcon}>{at ? <Check size={17}/> : <Clock3 size={17}/>}</span><strong>{roleName(role)}复核</strong><span>{at ? name : '待确认'}</span><small>{at ? time(at) : ''}</small></div>; })}{issue.resolvedAt && <div className={styles.closed}><ShieldCheck size={15}/>已关闭 · {time(issue.resolvedAt)}</div>}</section>}
          {returning && <section className={styles.returnForm} aria-label="退回技术"><div className={styles.sectionTitle}><h3>退回技术</h3><button onClick={() => setReturning(false)} disabled={busy}>取消退回</button></div>{data.reviewRoles.length > 1 && <label className={styles.field}>退回身份<select aria-label="退回身份" value={returnRole} onChange={e => setReturnRole(e.target.value as QfReviewRole)}>{data.reviewRoles.map(role => <option key={role} value={role}>{roleName(role)}</option>)}</select></label>}<fieldset><legend>问题文件</legend>{reviewFiles.map(f => <label key={f.id}><input type="checkbox" checked={returnFiles.includes(f.id)} onChange={e => setReturnFiles(e.target.checked ? [...returnFiles, f.id] : returnFiles.filter(id => id !== f.id))}/>{f.name} · {f.version}</label>)}</fieldset><label className={styles.field}>退回原因 <span className={styles.required}>*</span><textarea aria-label="退回原因" value={returnReason} maxLength={2000} onChange={e => setReturnReason(e.target.value)} disabled={busy}/></label><label className={styles.field}>问题位置（选填）<input aria-label="问题位置" value={returnLocation} maxLength={500} onChange={e => setReturnLocation(e.target.value)}/></label><ReviewAttachments productId={productId} files={returnAttachments} onChange={setReturnAttachments} onError={setError} onBusy={setUploading} disabled={busy}/></section>}
          <details className={styles.history}><summary><History size={15}/>完整处理记录<ChevronRight size={14}/></summary><div className={styles.timeline}>{[{ id: 'return-' + issue.id, name: roleName(issue.reviewRole) + '退回 · ' + issue.returnedByName, text: issue.reason, at: issue.createdAt }, ...data.events.filter(e => { const snap = e.snapshot as { issue?: { id?: string }; after?: { id?: string }; issueIds?: string[]; issues?: { id?: string }[]; packageId?: string } | null; return snap?.issue?.id === issue.id || snap?.after?.id === issue.id || snap?.issueIds?.includes(issue.id) || snap?.issues?.some(i => i.id === issue.id) || !!issue.submittedPackageId && snap?.packageId === issue.submittedPackageId; }).map(e => ({ id: e.id, name: (eventNames[e.action] || e.action) + ' · ' + e.actorName, text: e.reason || '', at: e.createdAt }))].sort((a, b) => +new Date(b.at) - +new Date(a.at)).map(e => <div key={e.id}><strong>{e.name}</strong><time>{time(e.at)}</time>{e.text && <p>{e.text}</p>}</div>)}</div>{data.rounds.map(round => <div key={round.id} className={styles.round}><strong>资料 #{round.sequence} · {round.revision}</strong><span>{round.status === 'APPROVED' ? '双方通过' : ['RETURNED', 'STALE', 'REVOKED'].includes(round.status) ? '本轮已结束' : round.status === 'SUPERSEDED' ? '历史批准' : '审核中'}</span><small>{round.submittedByName} 提交 · {time(round.submittedAt)}</small>{round.supervisorAt && <small>主管 {round.supervisorName} · {time(round.supervisorAt)}</small>}{round.qualityAt && <small>品质 {round.qualityName} · {time(round.qualityAt)}</small>}{round.reason && <p>{round.reason}</p>}</div>)}</details>
          {!!data.orders.length && <details className={styles.history}><summary>关联工单与打印 {data.orders.length}<ChevronRight size={14}/></summary>{data.orders.map(o => <div className={styles.order} key={o.id}><strong>{o.code}</strong><span>{o.printCount} 次打印</span></div>)}</details>}
        </>}
      </div>
      {preview && <aside className={styles.preview} aria-label="复核文件预览"><div className={styles.previewHeader}><strong>文件预览</strong>{!review && <button aria-label="关闭文件预览" onClick={() => requestPreviewLeave(() => setPreviewId(''))}><X size={16}/></button>}</div>{review && <select aria-label="复核预览文件" value={preview.id} onChange={e => requestPreviewLeave(() => { setPreviewId(e.target.value); setChecked(false); })}>{reviewFiles.map(f => <option key={f.id} value={f.id}>{f.name} · {f.version}</option>)}</select>}<div className={styles.previewCanvas}>{preview.mimeType.startsWith('image/') ? <ImageViewer dashboardMode paperMode initialFitMode="fit-window" fileId={preview.id} title={preview.name} contentUrl={'/api/drawing-library/files/' + preview.id + '/content'} downloadUrl={'/api/drawing-library/files/' + preview.id + '/content'}/> : <PdfViewer dashboardMode initialFitMode="fit-window" fileId={preview.id} title={preview.name} contentUrl={'/api/drawing-library/files/' + preview.id + '/content'} viewUrl={'/api/drawing-library/files/' + preview.id + '/content'} downloadUrl={'/api/drawing-library/files/' + preview.id + '/content'}/>}</div></aside>}
    </div>
    {(error || notice) && <div className={error ? styles.error : styles.notice} role={error ? 'alert' : 'status'}>{error || notice}<button aria-label="关闭提示" onClick={() => { setError(''); setNotice(''); }}><X size={14}/></button></div>}
    <footer className={styles.footer}>{closePrompt ? <><span>有未保存的处理内容</span><button onClick={() => setClosePrompt(false)}>继续处理</button><button onClick={onClose}>放弃未保存内容并关闭</button></> : <><div className={styles.footerStatus}>{review && !!data?.reviewRoles.length && !returning ? <label className={styles.confirm}><input aria-label="已核对本次复核资料" type="checkbox" checked={checked} disabled={busy} onChange={e => setChecked(e.target.checked)}/>已核对本轮全部图纸、SOP 及处理结果</label> : <><span>待处理 <b>{counts.open}</b></span><span>待提交 <b>{counts.ready}</b></span><span>待复核 <b>{counts.reviewing}</b></span></>}</div><div className={styles.footerActions}>
      {returning ? <button className={styles.danger} disabled={busy || uploading || !returnReason.trim() || !returnFiles.length} onClick={() => void act(() => sign('RETURN', returnRole))}>确认退回技术</button> : editable ? <><button disabled={busy || uploading || !valid} onClick={() => void act(() => save(false))}>保存本项处理</button>{data?.review.action !== 'RECONCILE' && <button className={styles.primary} disabled={busy || uploading || !valid} onClick={() => void act(() => save(true))}>{busy ? '正在保存…' : lastOpen ? '保存并提交复核' : '保存并处理下一项'}<ArrowRight size={16}/></button>}</> : review && !!data?.reviewRoles.length ? <><button onClick={startReturn} disabled={busy || uploading}>退回技术</button>{data.reviewRoles.map(role => <button key={role} className={styles.primary} disabled={busy || uploading || !checked} onClick={() => void act(() => sign('APPROVE', role))}><Check size={16}/>确认{roleName(role)}通过</button>)}</> : <>{canManage && counts.open > 0 && <button className={styles.primary} disabled={busy || uploading} onClick={() => { setHistory(false); choose(orderedReturns(active).find(i => i.status === 'OPEN')!.id); }}>处理剩余 {counts.open} 项<ArrowRight size={16}/></button>}{canManage && data?.review.state === 'RETURN_READY' && <button className={styles.primary} disabled={busy || uploading || Object.keys(drafts).length > 0} title={Object.keys(drafts).length ? '先保存修改中的处理内容' : ''} onClick={() => void act(() => submitAll(data))}>提交双方复核<ArrowRight size={16}/></button>}{pendingReview && onViewReview && <button disabled={busy || uploading} onClick={() => requestPreviewLeave(() => onViewReview(current!.id))}>进入当前审核</button>}{pendingReview && !review && currentReviewIssue && <button className={styles.primary} onClick={() => { setHistory(false); choose(currentReviewIssue.id); }}>查看本轮待复核事项</button>}{!counts.open && data?.review.state !== 'RETURN_READY' && !review && !currentReviewIssue && <><button onClick={close}>完成并返回</button>{onNext && <button onClick={onNext}>下一项待处理</button>}</>}</>}
    </div></>}</footer>
  </section></div>, document.body);
}
