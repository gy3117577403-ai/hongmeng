"use client";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { PdfViewer } from "@/components/PdfViewer";
import { ImageViewer } from "@/components/ImageViewer";
import { ArrowRight, Maximize2, Minimize2, History, PanelLeftClose, PanelLeftOpen, Check, ClipboardCheck, FileCheck2, FileSpreadsheet, Layers3, PackageCheck, Plus, RefreshCw, Search, Settings2, ShieldCheck, Upload, X } from "lucide-react";
import { AppWorkbenchHeader } from "@/components/layout/AppWorkbenchHeader";
import { GlassNotice } from "@/components/GlassNotice";
import { PlanWeekFilter } from "@/components/PlanWeekFilter";
import FixtureRequirementControl from "./FixtureRequirementControl";
import { requestPreviewLeave } from "@/components/DocumentOrientation";
import type { CurrentUserDTO } from "@/types";
import type { QfWorkbench } from "@/lib/quality-fixture-queries";
import { fixtureSubmissionIssues, fixtureDraftReady, fixtureDocumentLabel, type FixtureDocumentPackage } from "@/lib/quality-fixture-documents";
import { QF_STATUS, QF_REVIEW_STATUSES, type QfReviewRole, inferBomMapping, type BomMapping, type BomRow, type BomSheet, type DrawingEvidence } from "@/lib/quality-fixture-domain";
import { pcCents, pcMoney } from "@/lib/purchasing-domain";

const views = [{ id: "review", label: "资料审核" }, { id: "plans", label: "治具准备" }, { id: "fixtures", label: "治具库" }, { id: "stock", label: "库存记录" }];
type Draft = { id?: string; version?: number; libraryItemId: string; revision: string; needFixture: boolean | null; parallelCount: number; spareCount: number; drawingFileIds: string[]; sopFileIds: string[]; bomFileId: string | null; bomMapping: BomMapping | null; bomRows: BomRow[]; bomConfirmed: boolean };
type Modal = { kind: string; reviewRole?: QfReviewRole; packageId?: string; packageVersion?: number; fixtureId?: string; stockId?: string; connector?: { model: string; manufacturer: string }; group?: QfWorkbench["readiness"]["groups"][number] };
const time = (s?: string | null) => s ? new Date(s).toLocaleString("zh-CN", { hour12: false }) : "—";
const eventLabel = (type: string, action: string) => type === "STOCK" ? ({ OPENING: "期初登记", RESERVE: "预留", RELEASE: "释放预留", ISSUE: "领用", RETURN: "归还", HOLD: "转待验证", VERIFY: "验证通过", REPAIR: "送修", REPAIRED: "维修返回", SCRAP: "报废", ADJUST: "盘点调整", RECEIVE: "采购验收入库" } as Record<string,string>)[action] || action : ({ SAVE: "保存资料", SUBMIT: "提交双方审核", SYNC_PLAN_DOCUMENTS: "同步计划资料", SET_FIXTURE_REQUIREMENT: "变更治具要求", APPROVE: "审核通过", RETURN: "退回完善", REVOKE: "撤销批准", CONTINUE_OLD_VERSION: "设置旧版沿用范围", BIND_WORK_ORDERS: "指定计划资料版本", CONFIRM_SPECIFICATION: "确认对插关系", CREATE_PURCHASE: "提交治具申购", SAVE_SETTINGS: "更新审核负责人", UPLOAD_DRAWING: "上传图纸" } as Record<string,string>)[action] || action;
const statusClass = (s: string) => ["APPROVED"].includes(s) ? "good" : ["REVOKED", "RETURNED"].includes(s) ? "bad" : "warn";
const packageLabel = (p?: (FixtureDocumentPackage & { status: string }) | null) => p && fixtureDraftReady(p) ? "可提交审核" : QF_STATUS[p?.status || "UNSET"] || "资料待完善";
function Badge({ status, label }: { status: string; label?: string }) { return <span className={"qf-badge " + statusClass(status)}>{label || QF_STATUS[status] || "资料待完善"}</span>; }
function Empty({ children }: { children: ReactNode }) { return <div className="qf-empty"><Layers3 size={30} /><p>{children}</p></div>; }
async function response<T>(r: Response): Promise<T> { const b = await r.json(); if (!r.ok || !b.ok) throw new Error(b.error || "操作失败，请重试"); return b.data as T; }

export default function QualityFixtureWorkbench({ user, initialData, initialView, initialStatus = "", initialWeek = "", initialQuery = {} }: { user: CurrentUserDTO; initialData: QfWorkbench; initialView: string; initialStatus?: string; initialWeek?: string; initialQuery?: Record<string, string> }) {
  const [data, setData] = useState(initialData), [view, setView] = useState(views.some(v => v.id === initialView) ? initialView : "review"), [productId, setProductId] = useState(initialData.product?.id || ""), [packageId, setPackageId] = useState(initialQuery.package || "");
  const [focusReading, setFocusReading] = useState(false), [listCollapsed, setListCollapsed] = useState(false);
  const [mine, setMine] = useState(initialQuery.mine === "1");
  const [week, setWeek] = useState(initialWeek), [prepStatus,setPrepStatus] = useState(initialQuery.prepStatus || "");
  const [status, setStatus] = useState(initialStatus), [previewFile, setPreviewFile] = useState("");
  const [search, setSearch] = useState(initialQuery.q || ""), [page, setPage] = useState(initialData.page || 1), [busy, setBusy] = useState(false), [loading, setLoading] = useState(false);
  const [error, setError] = useState(""), [message, setMessage] = useState(""), [tab, setTab] = useState(initialView === "plans" ? "readiness" : "docs");
  const [draft, setDraft] = useState<Draft | null>(null), [sheets, setSheets] = useState<BomSheet[]>([]), [modal, setModal] = useState<Modal | null>(null), [form, setForm] = useState<Record<string, string>>({});
  const [supervisors, setSupervisors] = useState<string[]>([]), [qualities, setQualities] = useState<string[]>([]), [selectedOrders, setSelectedOrders] = useState<string[]>([]), [checked, setChecked] = useState(false);
  const busyRef = useRef(false), requestRef = useRef<{ body: string; key: string } | null>(null), modalRef = useRef<HTMLElement>(null), priorFocus = useRef<HTMLElement | null>(null);
  const closeMessage = useCallback(() => setMessage(""), []), closeError = useCallback(() => setError(""), []);
  const currentQuery = useRef("");
  const query = useCallback(() => new URLSearchParams({ view, product: productId, package: packageId, q: search, page: String(page), status, week, prepStatus, mine: mine ? "1" : "" }), [view, productId, packageId, search, page, status, week, prepStatus, mine]);
  currentQuery.current = query().toString();
  const refresh = useCallback(async () => {
    const key = query().toString();
    const synced = await fetch("/api/quality-fixtures", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "SYNC_DOCUMENTS" }) });
    if (!synced.ok) throw new Error("资料同步失败，请重试");
    const d = await fetch("/api/quality-fixtures?" + key, { cache: "no-store" }).then(response<QfWorkbench>);
    if (currentQuery.current === key) { setData(d); setChecked(false); }
    return d;
  }, [query]);
  useEffect(() => {
    const abort = new AbortController(), key = query().toString();
    const t = setTimeout(() => {
      setLoading(true);
      fetch("/api/quality-fixtures", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "SYNC_DOCUMENTS" }), signal: abort.signal })
        .then(r => { if (!r.ok) throw new Error("资料同步失败，请重试"); return fetch("/api/quality-fixtures?" + key, { signal: abort.signal }); })
        .then(response<QfWorkbench>).then(d => { if (!abort.signal.aborted && currentQuery.current === key) { setData(d); setChecked(false); } })
        .catch(e => { if (!abort.signal.aborted) setError(e.message); }).finally(() => { if (!abort.signal.aborted) setLoading(false); });
    }, 150);
    return () => { clearTimeout(t); abort.abort(); };
  }, [query]);
  useEffect(() => {
    const url = new URL(window.location.href);
    for (const [key, value] of query()) { if (value) url.searchParams.set(key, value); else url.searchParams.delete(key); }
    window.history.replaceState(null, '', url.pathname + url.search);
  }, [query]);
  const overlayOpen = !!draft || !!modal;
  useEffect(() => {
    if (!overlayOpen) return;
    priorFocus.current = document.activeElement as HTMLElement;
    modalRef.current?.querySelector<HTMLElement>("button,input,select")?.focus();
    const before = document.body.style.overflow; document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = before; priorFocus.current?.focus(); };
  }, [overlayOpen]);
  async function mutate<T = unknown>(body: Record<string, unknown>, notice: string, reload = true): Promise<T> {
    const text = JSON.stringify(body);
    if (requestRef.current?.body !== text) requestRef.current = { body: text, key: crypto.randomUUID() };
    const result = await fetch("/api/quality-fixtures", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": requestRef.current.key }, body: text }).then(response<T>);
    requestRef.current = null; if (notice) setMessage(notice); window.dispatchEvent(new Event("quality-fixture-updated")); if (reload) await refresh(); return result;
  }
  async function act(fn: () => Promise<unknown>) {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError("");
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : "操作失败，请重试"); }
    finally { busyRef.current = false; setBusy(false); }
  }
  function selectProduct(id: string) {
    if (busy || loading) return;
    requestPreviewLeave(() => { setLoading(true); setPreviewFile(""); setChecked(false); setProductId(id); setPackageId(""); setTab(view === "plans" ? "readiness" : "docs"); setSelectedOrders([]); });
  }
  function open(kind: string, extra: Partial<Modal> = {}, initial: Record<string, string> = {}) {
    setError(""); setChecked(false); setForm(initial); setModal({ kind, ...extra });
    if (kind === "settings") { setSupervisors(data.settings?.supervisorIds || []); setQualities(data.settings?.qualityIds || []); }
  }
  function edit() {
    if (!data.product) return;
    const p = data.chosen;
    setSheets((data.bom?.sheets || []) as unknown as BomSheet[]);
    setDraft({ id: p?.id, version: p?.version, libraryItemId: data.product.id, revision: p?.revision || "A",
      needFixture: data.product.fixtureRequired ?? null, parallelCount: p?.parallelCount || 1, spareCount: p?.spareCount || 0,
      drawingFileIds: p ? (p.drawingFiles as unknown as DrawingEvidence[]).map(f => f.id) : data.product.files.filter(f => f.category.code === "drawing").map(f => f.id),
      sopFileIds: p ? (p.sopFiles as unknown as DrawingEvidence[]).map(f => f.id) : data.product.files.filter(f => f.category.code === "sop").map(f => f.id),
      bomFileId: p?.bomFileId || null, bomMapping: (p?.bomMapping || null) as unknown as BomMapping | null,
      bomRows: (p?.bomRows || []) as unknown as BomRow[], bomConfirmed: p?.bomConfirmed || false }); setError("");
  }
  async function saveDraft(d: Draft) {
    const saved = await mutate<{ id: string; version: number }>({ action: "SAVE_PACKAGE", ...d }, "资料草稿已保存", false);
    const next = { ...d, id: saved.id, version: saved.version };
    setDraft(next); await refresh(); return next;
  }
  async function upload(file: File, kind: "drawing" | "sop" | "bom") {
    if (!draft) return;
    await act(async () => {
      let d = draft;
      if (kind === "bom") d = await saveDraft(d);
      const body = new FormData(); body.set("file", file); body.set("kind", kind); body.set("product", d.libraryItemId); body.set("package", d.id || "");
      const r = await fetch("/api/quality-fixtures/files", { method: "POST", body }).then(response<{ id: string; sheets?: BomSheet[]; mapping?: BomMapping }>);
      if (kind === "bom") { setSheets(r.sheets!); setDraft({ ...d, bomFileId: r.id, bomMapping: r.mapping!, bomRows: [], bomConfirmed: false }); }
      else setDraft({ ...d, ...(kind === "sop" ? { sopFileIds: [r.id] } : { drawingFileIds: [r.id] }) });
      await refresh(); setMessage(kind === "bom" ? "BOM 已上传，请核对表头并识别连接器" : (kind === "sop" ? "SOP" : "图纸") + "已上传，请保存受审资料");
    });
  }
  function field(label: string, key: string, type = "text", placeholder = "") {
    return <label className="qf-field">{label}<input type={type} value={form[key] || ""} placeholder={placeholder} onChange={e => setForm({ ...form, [key]: e.target.value })} /></label>;
  }
  const chosen = data.chosen, product = productId && loading && data.product?.id !== productId ? null : data.product, fixture = data.fixtures.find(f => f.id === modal?.fixtureId), stock = fixture?.item.balances.find(b => b.id === modal?.stockId);
  const reviewCounts = data.statusCounts.reduce((n, r) => n + (QF_REVIEW_STATUSES.includes(r.status) ? r._count : 0), 0);
  const docs = (chosen?.drawingFiles || []) as unknown as DrawingEvidence[];
  const sopDocs = (chosen?.sopFiles || []) as unknown as DrawingEvidence[];
  const allDocs = [...docs, ...sopDocs];
  const submissionIssues = chosen ? fixtureSubmissionIssues(chosen) : ["请至少上传一份图纸或 SOP"];
  const documentLabel = fixtureDocumentLabel({ drawingFiles: docs, sopFiles: sopDocs });
  const selectedDoc = ["图纸", "SOP"].includes(previewFile) ? undefined : allDocs.find(f => f.id === previewFile) || allDocs[0];
  const rows = (chosen?.bomRows || []) as unknown as BomRow[];
  const completedReviews = Number(!!chosen?.supervisorAt) + Number(!!chosen?.qualityAt);
  const pendingReview = !!chosen && QF_REVIEW_STATUSES.includes(chosen.status);
  const historical = !!chosen && chosen.id !== product?.fixturePackages[0]?.id;
  function startReview(kind: "APPROVE" | "RETURN", role: QfReviewRole) {
    if (!chosen || busy || loading) return;
    open(kind, { reviewRole: role, packageId: chosen.id, packageVersion: chosen.version });
  }
  function nextProduct() {
    const index = data.products.findIndex(p => p.id === product?.id);
    const ordered = [...data.products.slice(index + 1), ...data.products.slice(0, index)];
    const next = ordered.find(p => p.fixturePackages[0]?.status !== "APPROVED");
    if (next) selectProduct(next.id);
    else if (page * data.pageSize < data.total) { setPage(page + 1); setProductId(""); setPackageId(""); }
    else setMessage("当前筛选中没有更多待处理资料");
  }
  async function submitModal() {
    if (!modal) return;
    await act(async () => {
      if (modal.kind === "settings") await mutate({ action: "SAVE_SETTINGS", version: data.settings?.version, supervisorIds: supervisors, qualityIds: qualities }, "双方审核负责人已保存");
      if (modal.kind === "mapping") await mutate({ action: "SAVE_MAPPING", ...form, initialQuantity: Number(form.initialQuantity || 0), mappingVersion: form.mappingVersion ? Number(form.mappingVersion) : undefined, fixtureId: form.fixtureId || undefined, assemblyRequired: form.assemblyRequired === "1" }, "连接器与对插件关系已确认");
      if (modal.kind === "quantity") await mutate({ action: "SET_QUANTITY", fixtureId: fixture?.id, quantity: Number(form.quantity), expectedOnHand: fixture?.onHand }, "数量已调整，库存记录已保存");
      if (modal.kind === "deleteMapping") await mutate({ action: "DELETE_MAPPING", id: form.id, version: Number(form.version) }, "配对已删除，历史和共享库存保留");
      if (modal.kind === "purchase") await mutate({ action: "CREATE_FIXTURE_PURCHASE", packageId: modal.group ? chosen?.id : undefined, version: modal.group ? chosen?.version : undefined, fixtureId: modal.group?.fixtureId || modal.fixtureId, reason: form.reason,
        quantity: Number(form.quantity), estimateCents: pcCents(form.estimate), needDate: form.needDate, urgency: form.urgency || "NORMAL" }, "治具申购已进入杭连采购审批");
      if (modal.kind === "APPROVE" || modal.kind === "RETURN") {
        if (modal.kind === "APPROVE" && !checked) return;
        const label = modal.reviewRole === "SUPERVISOR" ? "主管" : "品质";
        try {
          const result = await mutate<{id:string; version:number; status:string}>({ action: modal.kind, id: modal.packageId, version: modal.packageVersion, reviewRole: modal.reviewRole, reason: form.reason, confirmed: checked }, "", false);
          setModal(null);
          await refresh();
          window.dispatchEvent(new Event("quality-fixture-updated"));
          setMessage(modal.kind === "RETURN" ? label + "已退回，请完善资料后重新提交双方审核" : result.status === "APPROVED" ? "主管与品质均已通过，可以打印工单" : label + "审核通过，仍待" + (modal.reviewRole === "SUPERVISOR" ? "品质" : "主管") + "审核");
        } catch (e) { await refresh(); setModal(null); throw e; }
      }
      if (["REVOKE", "CONTINUE_OLD_VERSION"].includes(modal.kind)) await mutate({ action: modal.kind, id: chosen?.id, version: chosen?.version, reason: form.reason, workOrderIds: selectedOrders }, "资料版本状态已更新");
      if (modal.kind === "stock") await mutate({ action: "STOCK", ...form, id: stock?.id, version: stock?.version, fixtureId: fixture?.id,
        quantity: Number(form.quantity), fitConfirmed: form.fitConfirmed === "1", continuityConfirmed: form.continuityConfirmed === "1" }, "治具库存与履历已更新");
      if (modal.kind === "template") { await mutate({ action: "SAVE_TEMPLATE", name: form.name, mapping: draft?.bomMapping }, "BOM 表头模板已保存"); }
      setModal(null);
    });
  }
  function closeOverlay() { if (busy) return; if (modal) setModal(null); else if (draft && window.confirm("关闭将丢弃尚未保存的编辑，已保存的资料草稿会保留。确定关闭？")) setDraft(null); }
  const modalTitle = modal?.kind === "history" ? "审核与版本履历" : modal?.kind === "APPROVE" ? (modal.reviewRole === "SUPERVISOR" ? "主管审核确认" : "品质审核确认") : modal?.kind === "settings" ? "主管审核 / 品质审核设置" : modal?.kind === "quantity" ? "调整在库数量" : modal?.kind === "deleteMapping" ? "删除连接器配对" : modal?.kind === "mapping" ? "连接器与对插" : modal?.kind === "purchase" ? "治具专用申购" : modal?.kind === "stock" ? "治具库存操作" : modal?.kind === "template" ? "保存表头模板" : modal?.kind === "RETURN" ? "退回资料" : modal?.kind === "REVOKE" ? "撤销资料批准" : "指定旧版本沿用范围";
  return <div className={"hm-workbench-root pc-shell qf-shell qf-reading-shell" + (focusReading ? " qf-focus-reading" : "") + (listCollapsed ? " qf-list-collapsed" : "")}>
    <AppWorkbenchHeader user={user} activeHref="/workspace/quality-fixtures" subtitle="质量准备 · 导通治具" hideHeader menuItems={[]} />
    <header className="qf-reading-header">
      <h1><ShieldCheck size={21} /><span>资料与治具</span></h1>
      <nav className="qf-tabs" aria-label="质量准备导航">{views.map(v => <button key={v.id} aria-current={view === v.id ? "page" : undefined} disabled={busy} onClick={() => requestPreviewLeave(() => { setView(v.id); setProductId(""); setPackageId(""); setStatus("");setMine(false); setPrepStatus(""); setPreviewFile(""); setTab(v.id === "plans" ? "readiness" : "docs"); setPage(1); setSearch(""); setFocusReading(false); })}>{v.label}{v.id === "review" && reviewCounts > 0 && <b>{reviewCounts}</b>}</button>)}</nav>
      <div className="qf-actions"><button disabled={loading || busy} onClick={() => act(refresh)} aria-label="刷新"><RefreshCw size={16} /></button><button onClick={() => open("settings")} aria-label="审核设置" title="审核设置"><Settings2 size={16} /><span>设置</span></button><Link className="qf-button qf-procurement-link" href="/workspace/purchases?source=FIXTURE">治具采购<ArrowRight size={14} /></Link></div>
    </header>
    <GlassNotice message={error || message} error={!!error} close={error ? closeError : closeMessage} action={error.includes("选择是否需要治具") ? { label: "去选择", run: () => { document.querySelector<HTMLSelectElement>('[aria-label="是否需要治具"]')?.focus(); setError(""); } } : undefined} />
    {["fixtures", "stock"].includes(view) ? <main className="qf-catalog-scroll">
      <div className="qf-toolbar"><label className="qf-search"><Search size={17} /><input aria-label="搜索治具" placeholder="搜索连接器、对插件型号或名称" value={search} onChange={e => setSearch(e.target.value)} /></label><span>{data.fixtures.length} / {data.fixtureTotal} 种对插件</span><button className="qf-primary" onClick={() => open("mapping", {}, { unit: "个" })}><Plus size={16} />新增连接器 / 对插件</button></div>
      {view === "fixtures" ? <div className="qf-table-wrap qf-library-table"><table><thead><tr><th>连接器型号</th><th>对插型号</th><th>在库 / 可用</th><th>操作</th></tr></thead><tbody>{data.fixtures.flatMap(f => (f.mappings.length ? f.mappings : [null]).map(m => <tr key={m?.id || f.id}><td><strong>{m?.connector.model || "待关联连接器"}</strong></td><td>{f.model}<small>{f.number}</small></td><td><strong>{f.onHand} / {f.available}</strong><small>预留 {f.reserved} · 在借 {f.issued}</small></td><td><div className="qf-actions">{m && <><button onClick={() => open("mapping", { fixtureId: f.id }, { mappingId: m.id, mappingVersion: String(m.version), connectorModel: m.connector.model, fixtureId: f.id, model: f.model })}>编辑</button><button onClick={() => open("deleteMapping", {}, { id: m.id, version: String(m.version), connectorModel: m.connector.model, model: f.model })}>删除</button></>}<button onClick={() => open("quantity", { fixtureId: f.id }, { quantity: String(f.onHand) })}>数量调整</button><button onClick={() => open("purchase", { fixtureId: f.id }, { quantity: "1", reason: "治具补充", needDate: new Date().toLocaleDateString("sv-SE"), urgency: "NORMAL" })}>申购</button><button onClick={() => { setView("stock"); setSearch(f.model); }}>领还 / 记录</button></div></td></tr>))}</tbody></table>{!data.fixtures.length && <Empty>登记连接器和对应对插，即可管理数量与申购。</Empty>}</div> : data.fixtures.length ? <div className="qf-fixture-grid">{data.fixtures.map(f => <section className="qf-card qf-fixture" key={f.id}><div className="qf-section-title"><div><small>{f.number}</small><h2>{f.model}</h2><p>{f.number} · {f.unit}</p></div><span className="qf-badge good">可用 {f.available} {f.unit}</span></div><div className="qf-counts"><div><b>{f.onHand}</b><small>实物在库</small></div><div><b>{f.reserved}</b><small>已预留</small></div><div><b>{f.issued}</b><small>在借</small></div><div><b>{f.held}</b><small>待验证</small></div></div>
        <div className="qf-mappings">{f.mappings.map(m => <div key={m.id}><span>{m.connector.model}</span><ArrowRight size={14} /><strong>{f.model}</strong><small>{m.preferred ? "当前对插" : "历史关系"} · {m.confirmedByName}确认</small><p>{m.evidence}</p></div>)}</div>
        {f.item.balances.map(b => <div className="qf-stock-row" key={b.id}><div><strong>{b.warehouse} / {b.location}</strong><small>可用 {b.onHand - b.held - b.repair - b.reserved} · 维修 {b.repair} · 待验证 {b.held}</small>{b.holdings.filter(h => h.issued || h.reserved).map(h => <small key={h.id}>{h.person}：预留 {h.reserved} / 借用 {h.issued}</small>)}</div><button onClick={() => open("stock", { fixtureId: f.id, stockId: b.id }, { kind: "RESERVE", quantity: "1", libraryItemId: product?.id || "", person: user.displayName || user.username, returnCondition: "GOOD" })}>库存操作</button></div>)}
        <div className="qf-actions"><button onClick={() => open("purchase", { fixtureId: f.id }, { quantity: "1", needDate: new Date().toLocaleDateString("sv-SE"), urgency: "NORMAL" })}>申购补充</button><button onClick={() => open("mapping", { fixtureId: f.id }, { fixtureId: f.id })}>补充连接器关系</button><button onClick={() => open("stock", { fixtureId: f.id }, { kind: "OPENING", quantity: "1", warehouse: "治具库", location: "", reason: "" })}>期初库存登记</button></div>
        {view === "stock" && <details><summary>查看库存流水</summary>{f.item.balances.flatMap(b => b.movements).sort((a,b) => b.createdAt.localeCompare(a.createdAt)).map(m => <div className="qf-event" key={m.id}><div><strong>{eventLabel("STOCK", m.kind.replace("FIXTURE_", ""))} · {m.quantity > 0 ? "+" : ""}{m.quantity} · 结余 {m.balance}</strong><p>{m.actorName} / {m.person} · {m.reason}</p></div><time>{time(m.createdAt)}</time></div>)}</details>}
      </section>)}</div> : <Empty>暂无治具。新增完整连接器型号，再由人工确认对应对插件。</Empty>}
      {data.fixtureTotal > 500 && <p className="qf-hint">当前最多展示 500 种，请用型号搜索缩小范围。</p>}
    </main> : <main className="qf-workspace">
      <aside hidden={focusReading || listCollapsed} className="qf-product-list" aria-label="产品型号列表"><div className="qf-list-controls"><PlanWeekFilter value={week} onChange={value => { setWeek(value); setPage(1); setProductId(""); setPackageId(""); }} /><div className="qf-search"><Search size={16} /><input aria-label="搜索产品" placeholder="产品型号 / 客户" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} /></div><select hidden={view === "plans"} className="qf-status-filter" aria-label="审核状态筛选" value={status} onChange={e => { setStatus(e.target.value);setMine(false); setPage(1); setProductId(""); }}><option value="">全部状态</option><option value="PENDING">全部待处理</option><option value="REVIEWING">待双方审核</option><option value="MISSING">待补资料 / 退回</option><option value="DRAFT">未提交草稿</option><option value="SUPERVISOR">待主管审核</option><option value="QUALITY">待品质审核</option><option value="RETURNED">已退回</option><option value="APPROVED">已通过</option></select>{view === "plans" && <select className="qf-status-filter" aria-label="治具准备状态" value={prepStatus} onChange={e => { setPrepStatus(e.target.value); setPage(1); setProductId(""); setPackageId(""); }}><option value="">全部治具状态</option>{[["BOM","缺 BOM"],["MATCH","待匹配"],["SHORT","数量不足"],["INCOMING","采购在途"],["READY","已齐套"]].map(([v,l]) => <option key={v} value={v}>{l} {data.preparationCounts[v] || 0}</option>)}</select>}
        <label className="qf-mine-filter" hidden={view !== "review"}><input type="checkbox" checked={mine} onChange={e => { setMine(e.target.checked); setPage(1); setProductId(""); setPackageId(""); }} />只看我可审核</label><div className="qf-list-label">{view === "review" ? "生效计划资料" : "需要治具的产品"}<span>{loading ? "…" : data.total}</span></div></div><div className="qf-product-scroll" tabIndex={0} aria-label="滚动产品型号">
        {data.products.map(p => <button key={p.id} className={"qf-product " + (product?.id === p.id ? "active" : "")} aria-pressed={product?.id === p.id} disabled={busy} onClick={() => selectProduct(p.id)}><strong title={p.specification}>{p.specification}</strong><small>{p.customerName} · {p.productName || "产品资料"}</small>{view === "plans" ? <span className="qf-badge warn">{data.preparationRows.find(r => r.id === p.id)?.readiness.label || "待准备"}</span> : <Badge status={p.fixturePackages[0]?.status || "UNSET"} label={packageLabel(p.fixturePackages[0])} />}</button>)}
        {!data.products.length && <Empty>当前筛选没有产品。资料审核覆盖生效计划；治具准备仅显示已选择需要治具的产品。</Empty>}</div><div className="qf-pagination"><button disabled={page === 1} onClick={() => { setPage(page - 1); setProductId(""); setPackageId(""); }}>上一页</button><span>{page} / {Math.max(1, Math.ceil(data.total / 30))}</span><button disabled={page * 30 >= data.total} onClick={() => { setPage(page + 1); setProductId(""); setPackageId(""); }}>下一页</button></div>
        <Link className="qf-text-link" href="/weekly-plan-center">进入计划中心 →</Link>
      </aside>
      <section className="qf-main">{!product ? <Empty>选择产品，开始资料准备与治具匹配。</Empty> : <>
        <div className="qf-reading-product">
          <div className="qf-reading-identity"><button className="qf-icon-button" aria-label={listCollapsed ? "展开型号列表" : "收起型号列表"} title={listCollapsed ? "展开型号列表" : "收起型号列表"} onClick={() => setListCollapsed(v => !v)}>{listCollapsed ? <PanelLeftOpen size={17}/> : <PanelLeftClose size={17}/>}</button><h2 title={product.specification}>{product.specification}</h2><span className="qf-customer" title={product.customerName + " · " + (product.productName || "产品资料")}>{product.customerName} · {product.productName || "产品资料"}</span><div className="qf-actions"><Link className="qf-text-link" href={"/drawing-library?itemId=" + product.id + (week ? "&week=" + week : "")}>图纸资料库 ↗</Link><button disabled={busy || loading} onClick={edit}><Upload size={14}/><span>{chosen ? "编辑资料" : "准备资料"}</span></button></div></div>
          <div className="qf-reading-meta"><label>版本 <select aria-label="资料版本" value={chosen?.id || ""} disabled={busy || loading} onChange={e => requestPreviewLeave(() => { setChecked(false); setPreviewFile(""); setPackageId(e.target.value); })}>{product.fixturePackages.map(p => <option key={p.id} value={p.id}>{p.revision} · 第 {p.sequence} 次{p.id !== product.fixturePackages[0]?.id ? " · 历史" : ""}</option>)}{!chosen && <option>待建立</option>}</select></label><Badge status={chosen?.status || "UNSET"} label={packageLabel(chosen)}/>
            <FixtureRequirementControl key={product.id} productId={product.id} initialValue={historical ? chosen?.needFixture : product.fixtureRequired} initialStatus={product.fixturePackages[0]?.status} disabled={historical || busy || loading} inline week={week} onSaved={async need => { setError(""); setMessage(need ? "已选择需要治具，请核对 BOM" : "已选择无需治具，资料状态已同步"); setTab(need && view === "plans" ? "bom" : "docs"); setPackageId(""); if (!packageId) await refresh(); }} />
            {chosen?.needFixture && <button className="qf-readiness-link" onClick={() => setTab("readiness")}>{data.readiness.label} ↗</button>}
            {chosen?.reason && <button className="qf-badge bad" title={chosen.reason} onClick={() => open("history")}>查看退回意见</button>}
            {data.newerReviewed && pendingReview && <button className="qf-badge bad" onClick={() => open("history")}>新版已通过，本版不可批准</button>}
            <div className="qf-meta-links"><button onClick={() => open("history")}><History size={14}/>审核履历</button><button onClick={() => requestPreviewLeave(() => setTab(tab === "orders" ? "docs" : "orders"))}>{tab === "orders" ? "返回图纸" : "关联工单"}</button></div>
          </div>
        </div>
        <div className="qf-reading-docbar"><div className="qf-document-tabs" role="group" aria-label="受审资料切换">{[["图纸", docs], ["SOP", sopDocs]].map(([label, files]) => <button key={String(label)} title={(files as DrawingEvidence[]).length ? String(label) : "未提供，可选上传；图纸或 SOP 至少一种即可"} aria-pressed={tab === "docs" && (files as DrawingEvidence[]).some(f => f.id === selectedDoc?.id)} disabled={busy} onClick={() => requestPreviewLeave(() => { setTab("docs"); setPreviewFile((files as DrawingEvidence[])[0]?.id || String(label)); })}>{String(label)} <small>{(files as DrawingEvidence[]).length}</small></button>)}{chosen?.needFixture && <><button aria-pressed={tab === "bom"} onClick={() => requestPreviewLeave(() => setTab("bom"))}>BOM <small>{rows.filter(r => r.include).length}</small></button><button aria-pressed={tab === "readiness"} onClick={() => requestPreviewLeave(() => setTab("readiness"))}>治具准备</button></>}</div>
          {tab === "docs" && <><select className="qf-file-select" aria-label="当前预览文件" value={selectedDoc?.id || ""} onChange={e => requestPreviewLeave(() => setPreviewFile(e.target.value))}>{allDocs.map(f => <option key={f.id} value={f.id}>{f.name} · {f.version}</option>)}{!selectedDoc && <option value="">资料待上传</option>}</select><button className="qf-focus-toggle" aria-pressed={focusReading} onClick={() => setFocusReading(v => !v)}>{focusReading ? <Minimize2 size={15}/> : <Maximize2 size={15}/>}<span>{focusReading ? "退出专注" : "专注阅读"}</span></button></>}
        </div>
        {tab === "docs" && <div className="qf-detail-body qf-doc-body"><div className="qf-document-canvas">{selectedDoc ? selectedDoc.mimeType.startsWith("image/") ? <ImageViewer dashboardMode paperMode initialFitMode="fit-width" fileId={selectedDoc.id} title={selectedDoc.name} contentUrl={"/api/drawing-library/files/"+selectedDoc.id+"/content"} downloadUrl={"/api/drawing-library/files/"+selectedDoc.id+"/content"}/> : <PdfViewer dashboardMode initialFitMode="fit-width" fileId={selectedDoc.id} title={selectedDoc.name} contentUrl={"/api/drawing-library/files/"+selectedDoc.id+"/content"} viewUrl={"/api/drawing-library/files/"+selectedDoc.id+"/content"} downloadUrl={"/api/drawing-library/files/"+selectedDoc.id+"/content"}/> : <Empty>{allDocs.length ? "此类资料未提供，图纸或 SOP 有一种即可审核。" : "请至少上传一份图纸或 SOP。"}<button onClick={edit}>补充资料</button></Empty>}</div></div>}
        {tab === "bom" && <div className="qf-detail-body"><h3>连接器清单 <small>{rows.filter(r => r.include).length} 行已纳入</small></h3><div className="qf-table-scroll"><table><thead><tr><th>来源行</th><th>连接器型号 / 名称</th><th>单台数量</th><th>位号</th><th>处理依据</th></tr></thead><tbody>{rows.map(r => <tr key={r.sourceRow} className={!r.include ? "muted" : ""}><td>{r.sheet} · {r.sourceRow}</td><td><strong>{r.model || "—"}</strong><small>{r.name}</small></td><td>{r.quantity} {r.unit}</td><td>{r.position || "—"}</td><td>{r.include ? "纳入治具" : "已排除"}<small>{r.reason || (r.autoExcluded ? "非连接器 / 汇总行" : "按原始数据")}</small></td></tr>)}</tbody></table></div>{!rows.length && <Empty>{chosen?.needFixture === false ? "无需治具，无 BOM 要求" : "请上传 BOM 并确认连接器"}</Empty>}</div>}
        {tab === "readiness" && <div className="qf-detail-body"><div className="qf-rule"><ShieldCheck size={18} /><span>治具数量按同时测试产品数计算。当前空闲库存满足后仍可预留；未预留库存可能被其他产品领用。</span></div>{data.readiness.unmatchedRows.map(r => <div className="qf-demand" key={r.key}><div><strong>{r.model}</strong><small>单台 {r.perUnit} {r.unit} · 对插件尚未确认</small></div><span className="qf-badge warn">待匹配</span><button onClick={() => open("mapping", { connector: r }, { connectorModel: r.model, connectorManufacturer: r.manufacturer, unit: r.unit })}>人工匹配对插件</button></div>)}{data.readiness.groups.map(g => <div className="qf-demand" key={g.fixtureId}><div><strong>{g.model}</strong><small>{g.connectorModels.join(" + ")} → 共用一个对插件型号</small></div><div className="qf-demand-numbers"><span>需求 <b>{g.required}</b></span><span>可用 <b>{g.available}</b></span><span>已分配 <b>{g.assigned}</b></span><span>在途 <b>{g.incoming}</b></span><span className={g.shortage ? "qf-orange" : ""}>缺口 <b>{g.shortage}</b></span></div><button disabled={busy || g.shortage <= g.incoming} onClick={() => open("purchase", { group: g }, { quantity: String(Math.max(0, g.shortage - g.incoming)), estimate: "", needDate: new Date().toLocaleDateString("sv-SE"), urgency: "NORMAL" })}>申购缺口</button></div>)}
          {!data.readiness.groups.length && !data.readiness.unmatchedRows.length && <Empty>{data.readiness.label}</Empty>}<div className="qf-actions"><button onClick={() => setView("stock")}>预留 / 领用 / 归还</button><Link className="qf-button" href="/workspace/purchases?source=FIXTURE">查看专用采购进度 →</Link></div></div>}
        {tab === "orders" && <div className="qf-detail-body"><div className="qf-rule">治具要求由产品资料版本统一管理，工单只引用适用版本。缺具允许打印，并持续展示准备状态。</div>{data.workOrders.map(w => <label className="qf-order" key={w.id}><input type="checkbox" checked={selectedOrders.includes(w.id)} onChange={e => setSelectedOrders(e.target.checked ? [...selectedOrders, w.id] : selectedOrders.filter(id => id !== w.id))} /><strong>{w.code}</strong><span>{w.fixtureBinding ? product.fixturePackages.find(p => p.id === w.fixtureBinding?.packageId)?.revision || "指定资料版本" : "跟随当前批准版本"}</span></label>)}{!data.workOrders.length && <Empty>此产品暂无关联工单</Empty>}<div className="qf-actions"><button disabled={!selectedOrders.length || !chosen || busy} onClick={() => act(() => mutate({ action: "BIND_WORK_ORDERS", packageId: chosen?.id, workOrderIds: selectedOrders }, "已为所选计划指定资料版本"))}>指定为当前查看版本</button><Link className="qf-button qf-primary" href="/production">进入生产执行 / 打印工单 →</Link></div></div>}
        {tab === "docs" && <footer className="qf-audit-footer" aria-label="资料审核操作"><div className="qf-audit-signatures">{(["SUPERVISOR", "QUALITY"] as const).map(role => { const done=role === "SUPERVISOR" ? chosen?.supervisorAt : chosen?.qualityAt; const name=role === "SUPERVISOR" ? chosen?.supervisorName : chosen?.qualityName; return <button key={role} className={done ? "signed" : ""} onClick={() => open("history")} title={name ? name + " · " + time(done) : "主管与品质可按任意顺序审核"}><span className="qf-sign-icon">{done ? <Check size={14}/> : <span/>}</span><span><strong>{role === "SUPERVISOR" ? "主管审核" : "品质审核"}</strong><small>{done ? "已通过 · " + name : pendingReview ? "待审核" : "待提交"}</small></span></button>; })}<div className={"qf-print-state " + (chosen?.status === "APPROVED" ? "ready" : "")}><strong>{chosen?.status === "APPROVED" ? "双方已通过 · 可打印" : pendingReview ? completedReviews + "/2 通过 · 暂不可打印" : packageLabel(chosen)}</strong><small>{data.isAdmin && pendingReview ? "管理员可分别审核两项" : "顺序不限，双方都通过"}</small></div></div>
          <div className="qf-audit-buttons">{chosen?.status === "DRAFT" && <button className="qf-primary" disabled={busy || loading} title={submissionIssues.join("；") || "已有资料可提交主管与品质审核"} onClick={() => { if (submissionIssues.length) { setError(submissionIssues.join("；")); return; } void act(() => mutate({ action: "SUBMIT", id: chosen.id, version: chosen.version }, "已提交主管与品质审核，顺序不限")); }}>提交双方审核</button>}
            {!!data.reviewRoles?.length && <><button disabled={busy || loading} onClick={() => startReview("RETURN", data.reviewRoles[0])}>退回完善</button>{data.reviewRoles.map(role => <button key={role} disabled={busy || loading || !!data.newerReviewed} className="qf-primary" onClick={() => startReview("APPROVE", role)}>{role === "SUPERVISOR" ? "主管审核" : "品质审核"}<Check size={14}/></button>)}</>}
            {chosen?.status === "RETURNED" && <button className="qf-primary" disabled={busy || loading} onClick={edit}>修订后重提</button>}
            <button className="qf-next-review" disabled={busy || loading || data.total <= 1} onClick={nextProduct} title="下一项待处理">下一项<ArrowRight size={14}/></button>
          </div></footer>}
        {["readiness", "bom"].includes(tab) && <footer className="qf-detail-footer"><button className="qf-primary" disabled={busy} onClick={edit}><Upload size={15} />{data.bom ? "核对 / 更新 BOM" : "上传 BOM"}</button><div className="qf-actions"><button onClick={() => setView("stock")}>库存与领还</button><Link className="qf-button" href="/workspace/purchases?source=FIXTURE">治具采购进度 →</Link></div></footer>}
      </>}</section>
    </main>}
    {(draft || modal) && <div className={"qf-overlay" + (modal?.kind === "history" ? " qf-drawer-overlay" : "")} onKeyDown={e => {
      if (e.key === "Escape") { e.preventDefault(); closeOverlay(); }
      if (e.key === "Tab") { const nodes = Array.from(modalRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea,a[href]') || []).filter(n => n.offsetParent !== null);
        if (e.shiftKey && document.activeElement === nodes[0]) { e.preventDefault(); nodes.at(-1)?.focus(); } else if (!e.shiftKey && document.activeElement === nodes.at(-1)) { e.preventDefault(); nodes[0]?.focus(); } }
    }}><section className={"qf-dialog " + (draft && !modal ? "wide" : modal?.kind === "history" ? "qf-history-drawer" : "")} role="dialog" aria-modal="true" aria-labelledby="qf-dialog-title" ref={modalRef}><header><div><span className="qf-eyebrow">{["fixtures","stock"].includes(view) ? "治具库" : product?.specification || "导通治具"}</span><h2 id="qf-dialog-title">{modal ? modalTitle : "生产资料准备"}</h2></div><button aria-label="关闭窗口" disabled={busy} onClick={closeOverlay}><X size={20} /></button></header>
      <div className="qf-dialog-body">
        {modal?.kind === "history" && product && <div className="qf-history-content"><p className="qf-hint">2026 年 9 月 21 日起的计划适用。主管、品质顺序不限；双方均通过后可打印，缺治具不阻止打印。</p>{chosen?.reason && <p className="qf-rule">处理意见：{chosen.reason}</p>}{data.newerReviewed && pendingReview && <p className="qf-rule">更新版本 {data.newerReviewed} 已完成双方审核，本旧稿不能再批准。请退回旧稿或新建修订。</p>}<div className="qf-audit-history">{[["资料提交", chosen?.submittedByName, chosen?.submittedAt, false], ["主管审核", chosen?.supervisorName, chosen?.supervisorAt, chosen?.supervisorAsAdmin], ["品质审核", chosen?.qualityName, chosen?.qualityAt, chosen?.qualityAsAdmin]].map(([label,name,at,admin]) => <div key={String(label)}><span className={"qf-step " + (at ? "done" : "")}>{at ? <Check size={15}/> : "·"}</span><div><strong>{label} {admin ? "· 管理员" : ""}</strong><small>{String(name || "待审核")} · {time(typeof at === "string" ? at : null)}</small></div></div>)}</div><VersionChanges chosen={chosen} packages={product.fixturePackages} />{data.packageEvents.map(e => <div className="qf-event" key={e.id}><span className="qf-dot" /><div><strong>{eventLabel(e.entityType, e.action)}{(e.snapshot as unknown as {reviewRole?:string})?.reviewRole ? " · " + ((e.snapshot as unknown as {reviewRole:string}).reviewRole === "SUPERVISOR" ? "主管" : "品质") : ""} · {e.actorName}</strong><p>{e.reason || "操作与当时资料快照已保留"}</p><small>资料版本 {chosen?.revision} · 第 {chosen?.sequence} 次受审记录</small></div><time>{time(e.createdAt)}</time></div>)}{data.canQuality && ["APPROVED", "SUPERSEDED"].includes(chosen?.status || "") && <div className="qf-actions"><button onClick={() => open("REVOKE")}>撤销批准</button><button onClick={() => { setSelectedOrders(chosen?.continuedWorkOrderIds || []); open("CONTINUE_OLD_VERSION"); }}>指定旧版沿用工单</button></div>}</div>}

        {(modal?.kind === "APPROVE" || modal?.kind === "RETURN") && <div className="qf-review-confirm">
          <div className="qf-confirm-version"><ShieldCheck size={24}/><div><strong>{product?.specification}</strong><small>版本 {chosen?.revision} · 第 {chosen?.sequence} 次资料</small></div><Badge status={chosen?.status || "DRAFT"} label={packageLabel(chosen)}/></div>
          {modal.kind === "RETURN" && data.reviewRoles.length > 1 && <label className="qf-field">退回身份<select aria-label="退回身份" value={modal.reviewRole} onChange={e => setModal({...modal,reviewRole:e.target.value as QfReviewRole})}>{data.reviewRoles.map(role => <option key={role} value={role}>{role === "SUPERVISOR" ? "主管审核" : "品质审核"}</option>)}</select></label>}
          {modal.kind === "APPROVE" ? <><p>你将以<strong>{modal.reviewRole === "SUPERVISOR" ? "主管" : "品质"}</strong>身份通过此版本。{data.isAdmin ? "本次将记录管理员签名。" : ""}</p><div className="qf-review-outcome">{completedReviews === 1 ? "通过后：主管与品质均已通过，允许打印工单。" : "通过后：仅完成本项审核，仍需" + (modal.reviewRole === "SUPERVISOR" ? "品质" : "主管") + "通过才可打印。"}</div><p className="qf-hint">本次审核：{[docs.length ? "图纸 " + docs.length + " 份" : "", sopDocs.length ? "SOP " + sopDocs.length + " 份" : ""].filter(Boolean).join("、")} · {chosen?.needFixture ? "需要治具" : "无需治具"}</p><label className="qf-checkbox"><input aria-label="已核对审核资料" type="checkbox" checked={checked} onChange={e => setChecked(e.target.checked)}/>我已核对本版本{documentLabel}{chosen?.needFixture ? "及 BOM 连接器清单" : "，已确认无需治具"}</label></> : <p>退回后，本版本不能打印。完善资料并重新提交后，主管与品质均需重新审核。</p>}
        </div>}

        {draft && !modal && <>
          <div className="qf-form-grid"><label className="qf-field">资料版本<input value={draft.revision} onChange={e => setDraft({ ...draft, revision: e.target.value })} /></label><div className="qf-field">是否需要导通治具<div className="qf-choice">{[true, false].map(v => <button key={String(v)} aria-pressed={draft.needFixture === v} onClick={() => setDraft({ ...draft, needFixture: v, ...(v ? {} : { bomFileId: null, bomRows: [], bomMapping: null, bomConfirmed: false }) })}>{v ? "需要治具" : "无需治具"}</button>)}</div></div></div>
          <h3>01 · 生产资料</h3><p className="qf-hint">图纸或 SOP 至少上传一种即可提交；两类都有时一同审核。</p><h3>图纸文件</h3><div className="qf-file-options">{data.product?.files.filter(f => f.category.code === "drawing").map(f => <label key={f.id}><input type="radio" name="drawingFile" checked={draft.drawingFileIds.includes(f.id)} onChange={() => setDraft({ ...draft, drawingFileIds: [f.id] })} /><span>{f.displayName || f.originalName}<small>{f.version} · {time(f.createdAt)}</small></span><a target="_blank" rel="noreferrer" href={"/api/quality-fixtures/files?kind=drawing&id=" + f.id}>预览</a></label>)}</div><label className="qf-upload"><Upload size={18} /><span>上传新图纸 <small>PDF / JPG / PNG / WebP · 最大 50 MB</small></span><input aria-label="上传图纸" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" disabled={busy} onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void upload(f, "drawing"); }} /></label>
          <h3>SOP 文件</h3><div className="qf-file-picker">{product?.files.filter(f => f.category.code === "sop").map(f => <label className="qf-checkbox" key={f.id}><input type="checkbox" checked={draft.sopFileIds.includes(f.id)} onChange={e => setDraft({ ...draft, sopFileIds: e.target.checked ? [...draft.sopFileIds, f.id] : draft.sopFileIds.filter(id => id !== f.id) })}/>{f.displayName || f.originalName} · {f.version}</label>)}<label className="qf-button">上传 SOP<input type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" hidden disabled={busy} onChange={e => { if (e.target.files?.[0]) void upload(e.target.files[0], "sop"); }}/></label></div>
          {draft.needFixture === true && <>
            <h3>02 · 导入 Excel BOM</h3><label className="qf-upload"><FileSpreadsheet size={22} /><span>{draft.bomFileId ? "替换 BOM 文件" : "上传 BOM 文件"}<small>.xlsx / .xls · 最大 10 MB · 保留源文件与行号</small></span><input aria-label="上传BOM" type="file" accept=".xlsx,.xls" disabled={busy} onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void upload(f, "bom"); }} /></label>
            {product?.fixtureBomFiles.length ? <label className="qf-field">或选择已上传 BOM<select value={draft.bomFileId || ""} onChange={e => { const id = e.target.value; if (id) void act(async () => { const b = await fetch("/api/quality-fixtures/files?id=" + id + "&parse=1").then(response<{ sheets: BomSheet[]; mapping: BomMapping }>); setSheets(b.sheets); setDraft({ ...draft, bomFileId: id, bomMapping: b.mapping, bomRows: [], bomConfirmed: false }); }); }}><option value="">选择文件</option>{product.fixtureBomFiles.map(b => <option key={b.id} value={b.id}>{b.name} · {time(b.createdAt)}</option>)}</select></label> : null}
            {draft.bomMapping && sheets.length > 0 && <>
              <div className="qf-form-grid"><label className="qf-field">工作表<select value={draft.bomMapping.sheet} onChange={e => setDraft({ ...draft, bomMapping: inferBomMapping(sheets.filter(s => s.name === e.target.value)), bomRows: [], bomConfirmed: false })}>{sheets.map(s => <option key={s.name}>{s.name}</option>)}</select></label><label className="qf-field">表头所在行<input type="number" min="1" max="100" value={draft.bomMapping.headerRow + 1} onChange={e => setDraft({ ...draft, bomMapping: { ...draft.bomMapping!, headerRow: Number(e.target.value) - 1 }, bomRows: [], bomConfirmed: false })} /></label><label className="qf-field">表头模板<select value="" onChange={e => { const t = data.templates.find(t => t.id === e.target.value); if (t) setDraft({ ...draft, bomMapping: { ...t.mapping as unknown as BomMapping, sheet: draft.bomMapping!.sheet }, bomRows: [], bomConfirmed: false }); }}><option value="">选择保存的映射</option>{data.templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label></div>
              <div className="qf-form-grid">{[["model", "连接器型号 *"], ["quantity", "数量 *"], ["name", "物料名称"], ["manufacturer", "制造商"], ["position", "位号"], ["unit", "单位"]].map(([key,label]) => <label className="qf-field" key={key}>{label}<select value={Number(draft.bomMapping![key as keyof BomMapping])} onChange={e => setDraft({ ...draft, bomMapping: { ...draft.bomMapping!, [key]: Number(e.target.value) }, bomRows: [], bomConfirmed: false })}><option value={-1}>未选择</option>{sheets.find(s => s.name === draft.bomMapping!.sheet)?.rows[draft.bomMapping!.headerRow]?.map((c,i) => <option key={i} value={i}>{i + 1} 列 · {c.text || "空表头"}</option>)}</select></label>)}</div>
              <div className="qf-form-grid"><label className="qf-field">数量口径<select value={draft.bomMapping.quantityBasis} onChange={e => setDraft({ ...draft, bomMapping: { ...draft.bomMapping!, quantityBasis: e.target.value as BomMapping["quantityBasis"] }, bomRows: [], bomConfirmed: false })}><option value="PER_UNIT">单台产品用量</option><option value="ORDER_TOTAL">整单用量（除以产品数量）</option></select></label>{draft.bomMapping.quantityBasis === "ORDER_TOTAL" && <label className="qf-field">BOM 对应产品数量<input type="number" min="1" value={draft.bomMapping.productQuantity} onChange={e => setDraft({ ...draft, bomMapping: { ...draft.bomMapping!, productQuantity: Number(e.target.value) }, bomRows: [], bomConfirmed: false })} /></label>}<label className="qf-field">无单位列时使用<select value={draft.bomMapping.defaultUnit} onChange={e => setDraft({ ...draft, bomMapping: { ...draft.bomMapping!, defaultUnit: e.target.value }, bomRows: [], bomConfirmed: false })}><option>个</option><option>套</option><option>件</option></select></label></div>
              <label className="qf-checkbox"><input type="checkbox" checked={draft.bomMapping.flattenedConfirmed} onChange={e => setDraft({ ...draft, bomMapping: { ...draft.bomMapping!, flattenedConfirmed: e.target.checked }, bomConfirmed: false })} />若含多层 BOM，已核对数量是展开后的单台实际用量</label>
              <div className="qf-actions"><button disabled={busy} className="qf-primary" onClick={() => act(async () => { const found = await mutate<BomRow[]>({ action: "SCAN_BOM", id: draft.bomFileId, mapping: draft.bomMapping }, "", false); setDraft({ ...draft, bomRows: found, bomConfirmed: false }); })}>按表头识别连接器</button><button onClick={() => open("template")}>保存表头模板</button></div>
            </>}
            {draft.bomRows.length > 0 && <><h3>03 · 核对连接器与数量</h3><p className="qf-hint">识别结果需人工确认。修改型号、数量、位号或排除候选项时填写依据；“待确认”行不能提交审核。</p><div className="qf-table-scroll qf-edit-table"><table><thead><tr><th>来源 / 原始型号</th><th>处理</th><th>确认型号</th><th>数量 / 单位</th><th>位号</th><th>修改或排除依据</th></tr></thead><tbody>{draft.bomRows.map((r,i) => {
              const update = (values: Partial<BomRow>) => setDraft({ ...draft, bomRows: draft.bomRows.map((v,j) => j === i ? { ...v, ...values } : v), bomConfirmed: false });
              return <tr key={r.sourceRow}><td>{r.sourceRow} · {r.name}<small>{r.original.model}</small>{r.flags.map(f => <small className="qf-orange" key={f}>{f}</small>)}</td><td><select aria-label={"第" + r.sourceRow + "行处理"} value={r.include === null ? "" : r.include ? "1" : "0"} onChange={e => update({ include: e.target.value === "" ? null : e.target.value === "1" })}><option value="">待确认</option><option value="1">纳入治具</option><option value="0">排除</option></select></td><td><input aria-label={"第" + r.sourceRow + "行型号"} value={r.model} onChange={e => update({ model: e.target.value })} /></td><td><input aria-label={"第" + r.sourceRow + "行数量"} type="number" min="1" value={r.quantity ?? ""} onChange={e => update({ quantity: e.target.value === "" ? null : Number(e.target.value) })} /><select aria-label={"第" + r.sourceRow + "行单位"} value={r.unit} onChange={e => update({ unit: e.target.value })}>{[...new Set([r.unit, "个", "套", "件"])].map(u => <option key={u}>{u}</option>)}</select></td><td><input aria-label={"第" + r.sourceRow + "行位号"} value={r.position} onChange={e => update({ position: e.target.value })} /></td><td><input aria-label={"第" + r.sourceRow + "行依据"} value={r.reason} onChange={e => update({ reason: e.target.value })} /></td></tr>; })}</tbody></table></div><label className="qf-checkbox"><input type="checkbox" checked={draft.bomConfirmed} onChange={e => setDraft({ ...draft, bomConfirmed: e.target.checked })} />已核对所有连接器型号、单台数量和排除项</label></>}
            <div className="qf-form-grid"><label className="qf-field">同时测试产品数<input type="number" min="1" value={draft.parallelCount} onChange={e => setDraft({ ...draft, parallelCount: Number(e.target.value) })} /></label><label className="qf-field">每种对插件备用数量<input type="number" min="0" value={draft.spareCount} onChange={e => setDraft({ ...draft, spareCount: Number(e.target.value) })} /></label><p className="qf-rule">需求 = 单台连接器用量 × 同时测试产品数 + 每种备用数量。相同对插件共用库存，不按生产批量累计。</p></div>
          </>}
          {draft.needFixture === false && <div className="qf-rule good"><Check size={18} />无需治具，审核已提供的图纸或 SOP，不上传 BOM。</div>}
        </>}
        {modal?.kind === "settings" && <><p className="qf-hint">主管与品质可按任意顺序审核，两项都通过才可打印。管理员默认具备两项审核权限，无需勾选；普通审核人员不能自审，两项由不同账号完成。</p><div className="qf-two-cols">{[["主管审核", supervisors, setSupervisors], ["品质审核", qualities, setQualities]].map(([label, ids, set]) => <fieldset key={String(label)}><legend>{String(label)}</legend>{data.users.map(u => <label className="qf-checkbox" key={u.id}><input type="checkbox" checked={u.laborRole === "ADMIN" || (ids as string[]).includes(u.id)} disabled={u.laborRole === "ADMIN" || !data.canConfigure} onChange={e => (set as (ids: string[]) => void)(e.target.checked ? [...ids as string[], u.id] : (ids as string[]).filter(id => id !== u.id))} />{u.displayName || u.username}{u.laborRole === "ADMIN" && <small>管理员 · 默认可审</small>}</label>)}</fieldset>)}</div>{!data.canConfigure && <p>请由流程维护人更改审核人员。</p>}</>}
        {modal?.kind === "mapping" && <><div className="qf-form-grid">{field("连接器型号 *", "connectorModel")}<label className="qf-field">对插型号 *<select aria-label="选择已有对插" value={form.fixtureId || ""} onChange={e => setForm({ ...form, fixtureId: e.target.value, initialQuantity: "0" })}><option value="">输入新型号</option>{data.fixtures.map(f => <option key={f.id} value={f.id}>{f.model} · 库存 {f.onHand}</option>)}</select></label>{!form.fixtureId && <>{field("新对插型号 *", "model")}{field("初始数量", "initialQuantity", "number")}</>}</div><p className="qf-hint">相同对插型号共用库存；已有型号通过数量调整补充。</p></>}
        {modal?.kind === "quantity" && <><p>{fixture?.model} · 当前在库 {fixture?.onHand}，可用 {fixture?.available}</p>{field("调整后的在库数量", "quantity", "number")}<p className="qf-hint">自动记录调整前后数量；已预留、待验证和维修库存不能直接扣减。</p></>}
        {modal?.kind === "deleteMapping" && <><p>删除 {form.connectorModel} → {form.model} 的配对？</p><p className="qf-hint">共享库存、采购及领还历史保留。</p></>}
        {modal?.kind === "purchase" && <><div className="qf-rule">{modal.group ? modal.group.model + " · 当前缺口 " + modal.group.shortage + "，本需求在途 " + modal.group.incoming + "，本次最多新增 " + Math.max(0, modal.group.shortage - modal.group.incoming) + " " + modal.group.unit : fixture?.model + " · 治具库补充申购 · 当前可用 " + fixture?.available}</div><div className="qf-form-grid">{!modal.group && field("补充申购用途 *", "reason")}{field("申购数量 *", "quantity", "number")}{field("预算合计（元）*", "estimate", "number")}{field("需求日期 *", "needDate", "date")}<label className="qf-field">紧急程度<select value={form.urgency || "NORMAL"} onChange={e => setForm({ ...form, urgency: e.target.value })}><option value="NORMAL">正常</option><option value="URGENT">紧急</option><option value="CRITICAL">特急</option></select></label></div><p className="qf-hint">来源自动标记为“治具申购”，保留图纸版本、连接器与对插依据；采购验收后直接更新治具库存。</p></>}
        {modal?.kind === "stock" && <><h3>{fixture?.model} · {stock ? stock.warehouse + " / " + stock.location : "登记已有实物"}</h3><div className="qf-form-grid"><label className="qf-field">操作<select value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value })}>{(stock ? [["RESERVE","预留"],["RELEASE","释放预留"],["ISSUE","领用"],["RETURN","归还"],["HOLD","转待验证"],["VERIFY","验证通过"],["REPAIR","送修"],["REPAIRED","维修返回"],["SCRAP","报废"],["ADJUST","盘点调整"]] : [["OPENING","期初库存"]]).map(([v,l]) => <option key={v} value={v}>{l}</option>)}</select></label>{field("数量 *", "quantity", "number")}
          {!stock && <>{field("仓库 *", "warehouse")}{field("库位 *", "location")}</>}
          {["RESERVE","RELEASE","ISSUE","RETURN"].includes(form.kind) && <><label className="qf-field">产品 *<select value={form.libraryItemId || ""} onChange={e => setForm({ ...form, libraryItemId: e.target.value })}><option value="">选择产品</option>{[...new Map([...data.products, ...(product ? [product] : [])].map(p => [p.id, p])).values()].map(p => <option key={p.id} value={p.id}>{p.specification}</option>)}</select></label>{field("领用 / 归还人 *", "person")}<label className="qf-field">关联工单（可选）<select value={form.workOrderId || ""} onChange={e => setForm({ ...form, workOrderId: e.target.value })}><option value="">按产品预留 / 领用</option>{form.libraryItemId === product?.id && data.workOrders.map(w => <option key={w.id} value={w.id}>{w.code}</option>)}</select></label></>}
          {form.kind === "RETURN" && <label className="qf-field">归还状态<select value={form.returnCondition || "GOOD"} onChange={e => setForm({ ...form, returnCondition: e.target.value })}><option value="GOOD">完好可用</option><option value="CHECK">待验证 / 异常</option></select></label>}
          {["REPAIR","SCRAP"].includes(form.kind) && <label className="qf-field">来源状态<select value={form.from || "HELD"} onChange={e => setForm({ ...form, from: e.target.value })}><option value="HELD">待验证</option><option value="AVAILABLE">可用</option>{form.kind === "SCRAP" && <option value="REPAIR">维修中</option>}</select></label>}
          {form.kind === "ADJUST" && <label className="qf-field">盘点方向<select value={form.direction || ""} onChange={e => setForm({ ...form, direction: e.target.value })}><option value="">选择</option><option value="IN">盘盈（入待验证）</option><option value="OUT">盘亏（减少可用）</option></select></label>}
        </div>{form.kind === "VERIFY" && <div className="qf-actions">{[["fitConfirmed", "对插适配通过"], ["continuityConfirmed", "导通验证通过"]].map(([k,l]) => <label className="qf-checkbox" key={k}><input type="checkbox" checked={form[k] === "1"} onChange={e => setForm({ ...form, [k]: e.target.checked ? "1" : "0" })} />{l}</label>)}</div>}{field("操作 / 验证说明", "reason")}<p className="qf-rule">期初入库、盘盈与维修返回先进入待验证；实物数量只记录一次。</p></>}
        {modal?.kind === "template" && field("模板名称 *", "name")}
        {modal && ["RETURN","REVOKE","CONTINUE_OLD_VERSION"].includes(modal.kind) && <>{field("处理原因 *", "reason")}{modal.kind === "REVOKE" && <p className="qf-error">撤销后该版本不再允许生成、下载或确认正式打印任务，原有记录保留。</p>}{modal.kind === "CONTINUE_OLD_VERSION" && <><p>仅以下选中的在制工单允许使用旧版本，其余工单需采用当前批准资料。</p>{data.workOrders.map(w => <label className="qf-checkbox" key={w.id}><input type="checkbox" checked={selectedOrders.includes(w.id)} onChange={e => setSelectedOrders(e.target.checked ? [...selectedOrders, w.id] : selectedOrders.filter(id => id !== w.id))} />{w.code}</label>)}</>}</>}
      </div>
      <footer><span className="qf-hint">{busy ? "正在保存，请稍候…" : draft && !modal ? "保存后提交主管、品质审核，顺序不限" : "操作将记录在业务履历中"}</span><div className="qf-actions"><button disabled={busy} onClick={closeOverlay}>{modal?.kind === "history" ? "关闭" : "取消"}</button>{draft && !modal ? <><button disabled={busy} onClick={() => act(() => saveDraft(draft))}>保存草稿</button><button disabled={busy} className="qf-primary" onClick={() => act(async () => { const d = await saveDraft(draft); await mutate({ action: "SUBMIT", id: d.id, version: d.version }, "已提交主管与品质审核"); setDraft(null); })}>保存并提交审核</button></> : modal?.kind !== "history" && <button disabled={busy || (modal?.kind === "settings" && !data.canConfigure) || (modal?.kind === "APPROVE" && !checked) || (modal?.kind === "RETURN" && !form.reason?.trim())} className="qf-primary" onClick={submitModal}>{modal?.kind === "APPROVE" ? "确认" + (modal.reviewRole === "SUPERVISOR" ? "主管" : "品质") + "通过" : modal?.kind === "RETURN" ? "确认退回" : modal?.kind === "purchase" ? "提交治具申购" : "确认保存"}</button>}</div></footer>
    </section></div>}
  </div>;
}

function VersionChanges({chosen, packages}: {chosen: QfWorkbench["chosen"]; packages: NonNullable<QfWorkbench["product"]>["fixturePackages"]}) {
  if (!chosen) return null;
  const previous = packages.find(p => p.sequence < chosen.sequence);
  if (!previous) return <p className="qf-hint">首次提交资料。已提供的图纸 / SOP、BOM 和审核签名均保留在本版本。</p>;
  const fields: [string, unknown, unknown][] = [
    ["资料版本号",previous.revision,chosen.revision], ["治具需求", previous.needFixture === null ? "未确认" : previous.needFixture ? "需要治具" : "无需治具",chosen.needFixture === null ? "未确认" : chosen.needFixture ? "需要治具" : "无需治具"],
    ["受审 SOP",(previous.sopFiles as unknown as DrawingEvidence[]).map(f=>f.name+" "+f.version).join("、"),(chosen.sopFiles as unknown as DrawingEvidence[]).map(f=>f.name+" "+f.version).join("、")],
    ["受审图纸",(previous.drawingFiles as unknown as DrawingEvidence[]).map(f=>f.name+" "+f.version).join("、"),(chosen.drawingFiles as unknown as DrawingEvidence[]).map(f=>f.name+" "+f.version).join("、")],
    ["BOM 原件",previous.bomFileId === chosen.bomFileId ? "未更换" : previous.bomFileId ? "上一版原件" : "无",previous.bomFileId === chosen.bomFileId ? "未更换" : chosen.bomFileId ? "已更换原件" : "无"],
    ["同时测试台数",previous.parallelCount,chosen.parallelCount], ["每种备用",previous.spareCount,chosen.spareCount]
  ];
  const changes = fields.filter(([,a,b])=>a!==b);
  const bomChanged = JSON.stringify(previous.bomRows)!==JSON.stringify(chosen.bomRows);
  return <section className="qf-card"><h3>与上一版 {previous.revision} 对比</h3>{changes.length ? <div className="qf-table-wrap"><table><thead><tr><th>变更项</th><th>上一版</th><th>当前版</th></tr></thead><tbody>{changes.map(([name,a,b])=><tr key={name}><td>{name}</td><td>{String(a)||"—"}</td><td>{String(b)||"—"}</td></tr>)}</tbody></table></div> : <p>基础资料未变化</p>}<p className="qf-hint">{bomChanged ? "连接器清单已变化，请在 BOM 连接器页核对明细；上方版本选择可回看原记录。" : "连接器清单未变化。"}</p></section>;
}
