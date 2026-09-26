'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, CheckCheck, ChevronRight, Download, FileClock, FileImage, FileText, Loader2, Printer, RefreshCw, Save, ShieldCheck, X } from 'lucide-react';
import { chinaDateKey } from '@/lib/china-date';
import { SHIPPING_REPORT_TEMPLATES, recommendShippingTemplate, type ShippingReportContext, type ShippingReportFields, type ShippingReportRecord, type ShippingReportSource } from '@/lib/shipping-report-domain';
import { ShippingReportPreview } from './ShippingReportPreview';
import './shipping-report.css';

const fileUrl = (id: string) => `/api/finished-goods/reports/${encodeURIComponent(id)}/file`;
const stamp = (value: string) => new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
export default function ShippingReportDialog({ source, readOnly, onClose }: { source: ShippingReportSource; readOnly: boolean; onClose: () => void }) {
  const [context, setContext] = useState<ShippingReportContext | null>(null), [fields, setFields] = useState<ShippingReportFields | null>(null);
  const [error, setError] = useState(''), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [previewBusy, setPreviewBusy] = useState(false);
  const [bytes, setBytes] = useState<ArrayBuffer | null>(null), [pages, setPages] = useState(1), [retry, setRetry] = useState(0), [loadRetry, setLoadRetry] = useState(0);
  const [tab, setTab] = useState<'edit' | 'history'>('edit'), [selected, setSelected] = useState<ShippingReportRecord | null>(null);
  const [discard, setDiscard] = useState(false), [notice, setNotice] = useState('');
  const [historyPending, setHistoryPending] = useState<ShippingReportRecord | null>(null);
  const root = useRef<HTMLDivElement>(null), initial = useRef(''), request = useRef<{ body: string; key: string } | null>(null), previewToken = useRef(0), busyRef = useRef(false);
  const sourceKey = JSON.stringify(source);
  const setDefaults = useCallback((c: ShippingReportContext) => {
    const next: ShippingReportFields = { template: c.recommendedTemplate || '', customerName: c.customerName, quantity: String(c.quantity), orderNo: c.sourceOrderNo, lotNo: '', reportDate: chinaDateKey(new Date()), drawingId: c.drawings[0]?.id || '', drawingPage: 1 };
    setFields(next); initial.current = JSON.stringify(next); setSelected(null); setTab('edit'); setNotice(''); setDiscard(false);
  }, []);
  useEffect(() => {
    const abort = new AbortController(); setLoading(true); setError('');
    void fetch(`/api/finished-goods/reports?${new URLSearchParams(JSON.parse(sourceKey))}`, { signal: abort.signal, cache: 'no-store' }).then(async r => {
      const result = await r.json(); if (!r.ok) throw new Error(result.error || '报告资料加载失败');
      setContext(result.data); setDefaults(result.data);
    }).catch(e => { if (e.name !== 'AbortError') setError(e.message); }).finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [sourceKey, loadRetry, setDefaults]);
  const dirty = Boolean(fields && !selected && JSON.stringify(fields) !== initial.current);
  const closeRef = useRef(() => {}); closeRef.current = () => { if (busyRef.current) return; setHistoryPending(null); if (dirty) setDiscard(true); else onClose(); };
  useEffect(() => {
    const focused = document.activeElement as HTMLElement | null, overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusable = () => Array.from(root.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href]') || []).filter(n => n.getClientRects().length);
    const frame = requestAnimationFrame(() => focusable()[0]?.focus());
    const keys = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeRef.current(); }
      if (e.key === 'Tab') { const nodes = focusable(), first = nodes[0], last = nodes[nodes.length - 1]; if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); } }
    };
    document.addEventListener('keydown', keys, true);
    return () => { cancelAnimationFrame(frame); document.body.style.overflow = overflow; document.removeEventListener('keydown', keys, true); focused?.focus({ preventScroll: true }); };
  }, []);
  const payload = useMemo(() => fields && context ? { ...context.source, ...fields, version: context.version, shipmentVersion: context.shipmentVersion, drawingUpdatedAt: context.drawings.find(d => d.id === fields.drawingId)?.updatedAt || '' } : null, [context, fields]);
  const body = payload ? JSON.stringify(payload) : '';
  const canPreview = Boolean(context?.eligible && fields?.template && Number(fields.quantity) > 0 && fields.customerName.trim());
  useEffect(() => {
    if (!selected && !canPreview) { setBytes(null); setPreviewBusy(false); return; }
    const abort = new AbortController(), token = ++previewToken.current; setPreviewBusy(true); setError('');
    const timer = setTimeout(() => {
      void fetch(selected ? fileUrl(selected.id) : '/api/finished-goods/reports/preview', selected ? { signal: abort.signal, cache: 'no-store' } : { method: 'POST', headers: { 'content-type': 'application/json' }, body, signal: abort.signal }).then(async r => {
        if (!r.ok) { const result = await r.json(); throw new Error(result.error || '报告预览失败'); }
        const data = await r.arrayBuffer(); if (previewToken.current !== token || abort.signal.aborted) return;
        setBytes(data); setPages(Number(r.headers.get('X-Drawing-Pages')) || 1);
      }).catch(e => { if (e.name !== 'AbortError' && previewToken.current === token) { setError(e.message); setBytes(null); } }).finally(() => { if (!abort.signal.aborted && previewToken.current === token) setPreviewBusy(false); });
    }, selected ? 0 : 380);
    return () => { clearTimeout(timer); abort.abort(); };
  }, [body, selected, retry, canPreview]);
  const update = <K extends keyof ShippingReportFields>(key: K, value: ShippingReportFields[K]) => { setFields(f => f ? { ...f, [key]: value, ...(key === 'drawingId' ? { drawingPage: 1 } : {}) } : f); setNotice(''); };
  const recommended = fields ? recommendShippingTemplate(fields.customerName) : null;
  const chosen = SHIPPING_REPORT_TEMPLATES.find(t => t.id === (selected?.template || fields?.template));
  async function save(): Promise<ShippingReportRecord | null> {
    if (selected) return selected;
    if (readOnly || !context || !body || busyRef.current) return null;
    busyRef.current = true; setBusy(true); setError('');
    if (!request.current || request.current.body !== body) request.current = { body, key: crypto.randomUUID() };
    try {
      const response = await fetch('/api/finished-goods/reports', { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': request.current.key }, body });
      const result = await response.json(); if (!response.ok) { if (response.status < 500) request.current = null; throw new Error(result.error || '保存失败'); }
      const report = result.data as ShippingReportRecord; setContext(c => c ? { ...c, reports: [report, ...c.reports.filter(r => r.id !== report.id)] } : c); setSelected(report); initial.current = JSON.stringify(fields); setNotice('报告已保存'); setDiscard(false); return report;
    } catch (e) { setError(e instanceof Error ? e.message : '保存失败，请重试'); return null; }
    finally { busyRef.current = false; setBusy(false); }
  }
  function downloadDraft() {
    if (!bytes) return;
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' })); const a = document.createElement('a'); a.href = url; a.download = `出货报告-${context?.specification || '预览'}.pdf`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  async function download() { if (readOnly && !selected) { downloadDraft(); return; } const saved = await save(); if (saved) { const a = document.createElement('a'); a.href = `${fileUrl(saved.id)}?download=1`; a.download = `${saved.number}.pdf`; a.click(); } }
  async function print() {
    const report = selected || (readOnly ? null : await save()); if (!report && !readOnly) return;
    if (!report && !bytes) return;
    const blobUrl = !report ? URL.createObjectURL(new Blob([bytes!], { type: 'application/pdf' })) : null;
    const frame = document.createElement('iframe'); frame.className = 'sr-print-frame'; frame.title = '出货报告打印'; frame.src = report ? fileUrl(report.id) : blobUrl!;
    frame.onload = () => { setTimeout(() => { try { frame.contentWindow?.focus(); frame.contentWindow?.print(); setNotice('已打开打印窗口'); } catch { setError('浏览器未能打开打印窗口，可下载 PDF 后打印。'); } }, 250); };
    document.body.appendChild(frame); setTimeout(() => { frame.remove(); if (blobUrl) URL.revokeObjectURL(blobUrl); }, 120000);
  }
  function openHistory(report: ShippingReportRecord) { if (dirty) { setHistoryPending(report); setDiscard(true); return; } setSelected(report); setNotice(''); setDiscard(false); }
  function finishDiscard() { if (historyPending) { setSelected(historyPending); setHistoryPending(null); setDiscard(false); setNotice(''); } else onClose(); }
  function copyHistory() {
    if (!context || !selected) return;
    const s = selected.snapshot;
    const next: ShippingReportFields = { template: s.template, customerName: context.customerName || s.customerName, orderNo: s.orderNo, lotNo: s.lotNo, reportDate: chinaDateKey(new Date()), quantity: String(context.quantityLocked ? context.quantity : Math.min(s.quantity, context.maxQuantity)), drawingId: context.drawings.some(d => d.id === s.drawing?.id) ? s.drawing!.id : context.drawings[0]?.id || '', drawingPage: context.drawings.some(d => d.id === s.drawing?.id) ? s.drawing!.page : 1 };
    setFields(next); initial.current = ''; setSelected(null); setTab('edit'); setNotice('');
  }
  const pending = loading || busy || previewBusy, valid = Boolean(bytes && !error && (selected || canPreview));
  return createPortal(<div className="sr-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) closeRef.current(); }}><div ref={root} className="sr-dialog" role="dialog" aria-modal="true" aria-labelledby="sr-title">
    <header className="sr-header"><div className="sr-heading-icon"><FileText size={23}/></div><div className="sr-heading"><h2 id="sr-title">出货报告{readOnly && <small>只读</small>}</h2><p>{context?.customerName || '成品仓'}<span> / </span>{context?.specification || '正在读取产品资料'}</p></div><button type="button" className="sr-icon-close" aria-label="关闭出货报告" disabled={busy} onClick={() => closeRef.current()}><X size={21}/></button></header>
    <div className="sr-body"><aside className="sr-sidebar"><div className="sr-tabs" role="tablist" aria-label="报告工作区"><button role="tab" aria-selected={tab === 'edit'} onClick={() => setTab('edit')}>本次报告</button><button role="tab" aria-selected={tab === 'history'} onClick={() => setTab('history')}>历史报告<span>{context?.reports.length || 0}</span></button></div>
      <div className="sr-sidebar-scroll">{loading ? <div className="sr-loading"><Loader2 className="sr-spin"/>读取入库资料</div> : !context ? <div className="sr-loading"><button onClick={() => setLoadRetry(n => n + 1)}><RefreshCw size={15}/>重新加载</button></div> : tab === 'history' ? <div className="sr-history">{context.reports.length ? context.reports.map(r => <button key={r.id} className={`sr-history-row ${selected?.id === r.id ? 'is-selected' : ''}`} onClick={() => openHistory(r)}><span className="sr-history-icon"><FileClock size={19}/></span><span><strong>{SHIPPING_REPORT_TEMPLATES.find(t => t.id === r.template)?.name} · {r.quantity} {r.unit}</strong><small>{r.number}</small><small>{stamp(r.createdAt)} · {r.actorName}</small></span><ChevronRight size={15}/></button>) : <div className="sr-empty"><FileClock size={30}/><strong>还没有保存的报告</strong></div>}</div> : selected ? <div className="sr-saved-card"><span className="sr-saved-icon"><CheckCheck size={25}/></span><h3>{selected.number}</h3><p>{stamp(selected.createdAt)}</p><dl><div><dt>客户</dt><dd>{selected.snapshot.customerName}</dd></div><div><dt>规格</dt><dd>{selected.snapshot.specification}</dd></div><div><dt>模板</dt><dd>{chosen?.name}</dd></div><div><dt>数量</dt><dd>{selected.quantity} {selected.unit}</dd></div><div><dt>订单号</dt><dd>{selected.snapshot.orderNo || '—'}</dd></div><div><dt>生成者</dt><dd>{selected.actorName}</dd></div><div><dt>原图</dt><dd>{selected.snapshot.drawing ? `${selected.snapshot.drawing.name} · 第 ${selected.snapshot.drawing.page} 页` : '未附图'}</dd></div></dl>{!readOnly && <button className="sr-secondary sr-wide" onClick={copyHistory}>沿用填写，另存报告<ChevronRight size={15}/></button>}<button className="sr-text-button sr-wide" onClick={() => setDefaults(context)}>新建报告</button></div> : fields && <>
        {!context.eligible && <div className="sr-callout">{context.ineligibleReason}</div>}
        <fieldset disabled={busy || !context.eligible} className="sr-fields"><div className="sr-field-heading"><span>报告模板</span>{fields.template && fields.template !== recommended ? <small>手动选择</small> : recommended && <small><Check size={12}/>客户默认</small>}</div><div className="sr-template-options">{SHIPPING_REPORT_TEMPLATES.map(t => <button type="button" key={t.id} aria-pressed={fields.template === t.id} className={fields.template === t.id ? 'is-selected' : ''} onClick={() => update('template', t.id)}><FileText size={17}/><span>{t.name}</span>{fields.template === t.id && <Check size={13}/>}</button>)}</div>
        {!fields.template && <p className="sr-field-hint">请选择本次使用的模板</p>}
        {chosen?.id === 'xinxinghui' && <div className="sr-issuer"><ShieldCheck size={14}/><span>抬头 · 杭州迈斯嘉电子科技有限公司</span></div>}
        <label className="sr-field">客户<input aria-label="报告客户" value={fields.customerName} readOnly={Boolean(context.customerName)} onChange={e => update('customerName', e.target.value)} placeholder="填写本次报告客户" maxLength={200}/></label>
        <label className="sr-field">品番 / 规格<input aria-label="报告规格" value={context.specification} readOnly/></label>
        <label className="sr-field">订单号<input aria-label="报告订单号" value={fields.orderNo} onChange={e => update('orderNo', e.target.value)} maxLength={160} placeholder="未提供，可补填"/></label>
        <div className="sr-two-fields"><label className="sr-field">报告数量<span className="sr-number-unit"><input aria-label="报告数量" type="number" min="1" max={context.maxQuantity} step="1" readOnly={context.quantityLocked} value={fields.quantity} onChange={e => update('quantity', e.target.value)}/><span>{context.unit}</span></span></label>{chosen?.id !== 'xinxinghui' && <label className="sr-field">报告日期<input aria-label="报告日期" type="date" value={fields.reportDate} onChange={e => update('reportDate', e.target.value)}/></label>}</div>
        <p className="sr-source-hint">{context.sourceLabel} · {context.maxQuantity} {context.unit}</p>
        {chosen?.id !== 'xinxinghui' && <label className="sr-field">社内 LOT No.<span className="sr-lot-input">{fields.template === 'general' && <span>HZHLDZ</span>}<input aria-label="内部批号" value={fields.lotNo} onChange={e => update('lotNo', e.target.value)} maxLength={120} placeholder="选填"/></span></label>}
        {chosen?.hasDrawing && <div className="sr-drawing"><div className="sr-field-heading"><span><FileImage size={15}/>略图面</span><small>{context.drawings.length} 份原图</small></div><label className="sr-field"><select aria-label="报告原图" value={fields.drawingId} onChange={e => update('drawingId', e.target.value)}><option value="">不附原图</option>{context.drawings.map(d => <option key={d.id} value={d.id}>{d.name} · {d.version}</option>)}</select></label>{fields.drawingId && context.drawings.find(d => d.id === fields.drawingId)?.mimeType === 'application/pdf' && <label className="sr-page-select">使用图页<input type="number" aria-label="原图页码" min={1} value={fields.drawingPage} onChange={e => update('drawingPage', Math.max(1, Number(e.target.value) || 1))}/><span>/ {pages}</span></label>}</div>}
        </fieldset>
      </>}</div></aside>
      <div className="sr-preview-column">{error && <div className="sr-error" role="alert"><span>{error}</span><button disabled={pending} onClick={() => context ? setRetry(n => n + 1) : setLoadRetry(n => n + 1)}><RefreshCw size={14}/>重试</button></div>}<ShippingReportPreview bytes={bytes} loading={previewBusy || loading} onError={setError}/></div>
    </div>
    <footer className="sr-footer">{discard ? <><span className="sr-discard-label">有尚未保存的填写</span><button className="sr-secondary" onClick={() => setDiscard(false)}>继续填写</button><button className="sr-secondary" onClick={finishDiscard}>{historyPending ? '放弃并查看' : '放弃并关闭'}</button>{!readOnly && <button className="sr-primary" disabled={pending || !valid} onClick={async () => { if (await save()) finishDiscard(); }}>{historyPending ? '保存并查看' : '保存并关闭'}</button>}</> : <><span className="sr-footer-status" role="status">{busy ? <><Loader2 className="sr-spin" size={15}/>正在保存报告</> : notice ? <><CheckCheck size={15}/>{notice}</> : selected ? <><ShieldCheck size={15}/>已保存 · {selected.actorName}</> : <>{chosen?.name || '请选择模板'}{chosen && <span> · 检查数据留空</span>}</>}</span><div className="sr-footer-actions"><button className="sr-secondary sr-icon-action" aria-label="下载报告 PDF" title="保存并下载 PDF" disabled={pending || !valid} onClick={() => void download()}><Download size={18}/></button>{!readOnly && !selected && <button className="sr-secondary" disabled={pending || !valid} onClick={() => void save()}><Save size={16}/>保存报告</button>}<button className="sr-primary" disabled={pending || !valid} onClick={() => void print()}><Printer size={17}/>{busy ? '正在保存' : '打印报告'}</button></div></>}</footer>
  </div></div>, document.body);
}
