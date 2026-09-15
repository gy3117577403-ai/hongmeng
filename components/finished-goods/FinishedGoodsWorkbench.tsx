'use client';

import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, ArrowDownToLine, ArrowRight, Boxes, Check, ChevronLeft, ChevronRight, ClipboardList, Copy, Download, FileText, History, Layers3, MoreHorizontal, PackageCheck, Pause, Plus, Printer, RefreshCw, Search, Truck, X } from 'lucide-react';
import { AppWorkbenchHeader } from '@/components/layout/AppWorkbenchHeader';
import { FG_KINDS, fgCompactTime, fgShortWorkOrder, type FgInput, type FgRow, type FgWorkbench } from '@/lib/finished-goods-domain';
import { canAccessAppRoute } from '@/lib/app-route-access';
import type { CurrentUserDTO } from '@/types';

type Draft = { quantity: string; carrier: string; waybills: string; method: string; customerName: string; recipient: string; phone: string; address: string; boxes: string; handoverName: string; batchId: string; note: string };
type Dialog = { kind: string; row?: FgRow; rows?: FgRow[] };
type Detail = { lot: { holds: { id: string; quantity: number; released: number; reason: string; dueDate: string | null }[]; reworks: { id: string; quantity: number; returned: number; scrapped: number; destination: string; reason: string }[]; ledger: { id: string; kind: string; quantity: number; reason: string; actorName: string; createdAt: string }[]; lines: { id: string; quantity: number; returned: number; shipment: { id: string; number: string; status: string; shippedAt: string | null; attachments: Attachment[] } }[] }; shipment?: { lines: { id: string; quantity: number; lot: { workOrderCode: string; productName: string } }[]; attachments: Attachment[] } | null };
type Attachment = { id: string; originalName: string; size: number };
const STATUS: Record<string, string> = { pending: '待接收', ready: '待发', shipped: '已发', held: '留库', opening: '待核对', legacy: '历史已出', received: '已入库', reserved: '已占用', blocked: '隔离', restricted: '生产受限' };
const VIEWS = [{ id: 'queue', label: '出货' }, { id: 'stock', label: '库存' }, { id: 'history', label: '记录' }, { id: 'batches', label: '批次' }];
const QUEUE_FILTERS = [{ id: 'all', label: '全部作业' }, { id: 'processing', label: '待处理' }, { id: 'shipped', label: '已出' }, { id: 'missing', label: '待补单号' }];
const STOCK_FILTERS = [{ id: 'all', label: '全部库存' }, { id: 'pending', label: '待接收' }, { id: 'ready', label: '可用' }, { id: 'held', label: '留库' }, { id: 'reserved', label: '占用' }, { id: 'blocked', label: '隔离 / 受限' }];
const titleFor: Record<string, string> = { ship: '核对本次发货', batchShip: '批量核对发货', receive: '接收成品', hold: '留库', release: '释放留库', detail: '成品明细', opening: '期初实物核对', stockAdd: '登记实物库存', batch: '新建出货批次', return: '退货实物接收', block: '隔离库存', unblock: '解除隔离', scrap: '报废出库', adjust: '盘亏登记', unreceive: '撤销接收', move: '移库', allocate: '分配公共备货', rework: '返工转出', reworkReturn: '返工回库', reworkScrap: '返工报废', merge: '合并发货草稿' };
const timeText = (time: string | null) => time ? new Date(time).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : '—';
const num = (n: number) => n.toLocaleString('zh-CN');
function defaultDraft(row: FgRow): Draft { return { quantity: String(row.quantity || row.available || row.pending || 1), carrier: row.carrier, waybills: row.waybills.join('\n'), method: row.method, customerName: row.customerName, recipient: row.recipient, phone: row.phone, address: row.address, boxes: String(row.boxes), handoverName: row.handoverName, batchId: row.batchId, note: row.shipmentNote }; }
function parseResponse(response: Response): Promise<{ ok: boolean; error?: string; data?: unknown }> { return response.json(); }

export default function FinishedGoodsWorkbench({ user, initialData, initialQuery }: { user: CurrentUserDTO; initialData: FgWorkbench; initialQuery: string }) {
  const [data, setData] = useState(initialData); const [view, setView] = useState('queue'); const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState(initialQuery); const [search, setSearch] = useState(initialQuery); const [date, setDate] = useState(initialData.date);
  const [batchId, setBatchId] = useState(''); const [workingBatchId, setWorkingBatchId] = useState(''); const [scope, setScope] = useState('day'); const [dateTo, setDateTo] = useState('');
  const [editingWaybill, setEditingWaybill] = useState(''); const [savedRowId, setSavedRowId] = useState(''); const [page, setPage] = useState(1); const [size, setSize] = useState(24);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({}); const [selected, setSelected] = useState<string[]>([]); const [activeId, setActiveId] = useState('');
  const [continuous, setContinuous] = useState(false); const [checked, setChecked] = useState(false); const [busy, setBusy] = useState(false); const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(''); const [error, setError] = useState(''); const [dialog, setDialog] = useState<Dialog | null>(null);
  const [form, setForm] = useState<Record<string, string>>({}); const [detail, setDetail] = useState<Detail | null>(null); const [refresh, setRefresh] = useState(0);
  const [more, setMore] = useState(false); const requestToken = useRef(0); const busyRef = useRef(false); const mutation = useRef<{ body: string; key: string } | null>(null); const draftsLoaded = useRef(false);
  const [poll, setPoll] = useState(0);
  const queryKey = useRef('');
  const storageKey = `hm-finished-goods:drafts:${user.id}`;
  const draftFor = (row: FgRow): Draft => drafts[row.id] || { ...defaultDraft(row), batchId: row.shipmentId ? row.batchId : workingBatchId };
  const isActionable = (r: FgRow) => ['ready','pending'].includes(r.status) && !r.otherDrafts;
  const canSelect = (r: FgRow) => isActionable(r) && r.ownerType === 'CUSTOMER' && r.shipmentLineCount === 1;
  const selectableRows = data.rows.filter(canSelect);
  const isRecords = ['history','receipts','legacy'].includes(view);
  const filters = view === 'stock' ? STOCK_FILTERS : QUEUE_FILTERS;
  const activeBatches = data.dispatchBatches.filter(b => !b.closedAt);
  const active = data.rows.find(r => r.id === activeId); const current = active ? draftFor(active) : null;
  const selectedRows = data.rows.filter(r => selected.includes(r.id));
  const showStock = view === 'stock' || view === 'holds';
  const params = useCallback(() => new URLSearchParams({ date, dateTo, scope, view, filter, q: query, batchId, page: String(page), pageSize: String(size) }), [date, dateTo, scope, view, filter, query, batchId, page, size]);

  useEffect(() => { const timer = setTimeout(() => { setQuery(search); setPage(1); }, 250); return () => clearTimeout(timer); }, [search]);
  useEffect(() => { if (!message) return; const timer = setTimeout(() => setMessage(''), 5000); return () => clearTimeout(timer); }, [message]);
  useEffect(() => {
    try { const saved = localStorage.getItem(storageKey); if (saved) setDrafts(JSON.parse(saved)); } catch { /* Drafts still work in memory. */ }
    draftsLoaded.current = true;
  }, [storageKey]);
  useEffect(() => { if (!draftsLoaded.current) return; try { if (Object.keys(drafts).length) localStorage.setItem(storageKey, JSON.stringify(drafts)); } catch { /* Server save remains available. */ } }, [drafts, storageKey]);
  useEffect(() => {
    const changedQuery = queryKey.current !== params().toString(); queryKey.current = params().toString();
    const token = ++requestToken.current; const abort = new AbortController(); setLoading(true);
    fetch(`/api/finished-goods?${params()}`, { cache: 'no-store', signal: abort.signal }).then(async response => {
      const result = await parseResponse(response); if (!response.ok) throw new Error(result.error || '加载失败');
      if (requestToken.current === token) { const next = result.data as FgWorkbench; setData(next); setSelected(previous => changedQuery ? [] : previous.filter(id => next.rows.some(row => row.id === id))); }
    }).catch(e => { if (e.name !== 'AbortError') setError(e.message); }).finally(() => { if (requestToken.current === token) setLoading(false); });
    return () => abort.abort();
  }, [params, refresh, poll]);
  useEffect(() => { const timer = window.setInterval(() => { if (!busyRef.current && !dialog && document.visibilityState === 'visible' && !document.activeElement?.matches('input,select,textarea')) setPoll(n => n + 1); }, 30000); return () => window.clearInterval(timer); }, [dialog]);
  useEffect(() => {
    if (!Object.keys(drafts).length) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [drafts]);
  useEffect(() => {
    if (!dialog) return;
    const previous = document.activeElement as HTMLElement | null;
    const focusable = () => Array.from(document.querySelectorAll<HTMLElement>('.fg-dialog button:not(:disabled), .fg-dialog input:not(:disabled), .fg-dialog select:not(:disabled), .fg-dialog textarea:not(:disabled), .fg-dialog a[href]')).filter(el => el.offsetParent !== null);
    const frame = requestAnimationFrame(() => focusable()[0]?.focus());
    const close = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busyRef.current) setDialog(null);
      if (e.key === 'Tab') { const nodes = focusable(); const first = nodes[0], last = nodes[nodes.length-1]; if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); } }
    };
    window.addEventListener('keydown', close); return () => { cancelAnimationFrame(frame); window.removeEventListener('keydown', close); previous?.focus(); };
  }, [dialog]);

  function updateDraft(row: FgRow, field: keyof Draft, value: string) { setSavedRowId(''); setDrafts(previous => ({ ...previous, [row.id]: { ...(previous[row.id] || draftFor(row)), [field]: value } })); }
  function resetField(row: FgRow, field: keyof Draft) { updateDraft(row, field, defaultDraft(row)[field]); }
  function activate(row: FgRow) { if (activeId !== row.id) { setActiveId(row.id); setChecked(false); } }
  function switchView(next: string) { setView(next); setFilter('all'); setPage(1); setBatchId(''); setDateTo(''); setScope(next === 'legacy' || next === 'stock' ? 'all' : 'day'); setContinuous(false); setMore(false); }
  async function copyText(value: string) { try { await navigator.clipboard.writeText(value); setMessage('已复制'); } catch { setError('当前浏览器未允许复制，请在明细中选中完整内容复制'); } }
  function applyWorkingBatch() { selectedRows.filter(canSelect).forEach(row => updateDraft(row,'batchId',workingBatchId)); setMessage('所选记录已设置本轮批次，保存或发货时生效'); }
  function clearDrafts(rows: FgRow[]) { setDrafts(prev => { const next = Object.fromEntries(Object.entries(prev).filter(([key]) => !rows.some(row => row.id === key))); try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* Editing still works. */ } return next; }); }
  async function execute(input: FgInput, success: string, affected: FgRow[] = [], keepDialog = false): Promise<boolean> {
    if (busyRef.current) return false;
    busyRef.current = true; setBusy(true); setError(''); setMessage('');
    const body = JSON.stringify(input);
    if (!mutation.current || mutation.current.body !== body) mutation.current = { body, key: crypto.randomUUID() };
    try {
      const response = await fetch('/api/finished-goods', { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': mutation.current.key }, body });
      const result = await parseResponse(response);
      if (!response.ok) { if (response.status < 500) mutation.current = null; throw new Error(result.error || '操作失败'); }
      mutation.current = null; clearDrafts(affected); setSelected(previous => previous.filter(id => !affected.some(row => row.id === id))); setMessage(success); setChecked(false); if (!keepDialog) setDialog(null); setRefresh(r => r + 1); return true;
    } catch (e) { setError(e instanceof Error ? e.message : '连接中断，请重试'); return false; }
    finally { busyRef.current = false; setBusy(false); }
  }
  function shippingInput(row: FgRow): FgInput { const d = draftFor(row); return { ...d, lotId: row.lotId, version: row.version, shipmentId: row.shipmentId, shipmentVersion: row.shipmentVersion, quantity: Number(d.quantity), boxes: Number(d.boxes), plannedDate: data.workDate, checked, receive: true }; }
  async function save(row: FgRow): Promise<void> {
    const input = shippingInput(row);
    if (await execute({ ...input, action: row.status === 'shipped' || row.status === 'reserved' || row.shipmentLineCount > 1 ? 'SAVE_LOGISTICS' : 'SAVE_DRAFT' }, '出货信息已保存', [row])) { setSavedRowId(row.id); setEditingWaybill(''); }
  }
  function open(kind: string, row?: FgRow, rows?: FgRow[]) {
    setMore(false); setError(''); setChecked(false); setDetail(null);
    const q = kind === 'release' ? row?.held : ['unblock'].includes(kind) ? row?.blocked : kind === 'opening' || kind === 'receive' ? row?.pending : kind === 'return' ? Math.max(0, (row?.quantity || 0) - (row?.returned || 0)) : row?.available || row?.blocked || 1;
    setForm({ quantity: String(q || (kind === 'opening' ? 0 : 1)), reason: '', location: row?.location || '', customerName: row?.customerName || '', ownerType: 'PUBLIC', bucket: row?.available ? 'available' : 'blocked', date: data.workDate, reworkId: '' });
    setDialog({ kind, row, rows });
    if (row && ['detail','ship','reworkReturn','reworkScrap'].includes(kind)) void fetch(`/api/finished-goods?lotId=${encodeURIComponent(row.lotId)}${row.shipmentId ? `&shipmentId=${encodeURIComponent(row.shipmentId)}` : ''}`).then(async r => { const result = await parseResponse(r); if (!r.ok) throw new Error(result.error); setDetail(result.data as Detail); }).catch(e => setError(e.message));
  }
  async function dispatch(row: FgRow) {
    const index = data.rows.findIndex(r => r.id === row.id);
    const next = [...data.rows.slice(index + 1), ...data.rows.slice(0,index)].find(r => ['ready','pending'].includes(r.status) && r.ownerType === 'CUSTOMER' && !r.otherDrafts);
    if (await execute({ ...shippingInput(row), action: row.status === 'reserved' || row.shipmentLineCount > 1 ? 'SHIP' : 'QUICK_SHIP' }, row.shipmentLineCount > 1 ? '整张合单已确认发货' : `已确认发货 ${draftFor(row).quantity} ${row.unit}`, [row])) setActiveId(next?.id || '');
  }
  async function submitDialog() {
    if (!dialog) return; const row = dialog.row;
    if (dialog.kind === 'ship' && row) { await dispatch(row); return; }
    if (dialog.kind === 'batchShip') {
      await execute({ action: 'BATCH_SHIP', checked, entries: (dialog.rows || []).map(r => ({ ...shippingInput(r), checked: true })) }, `已完成 ${dialog.rows?.length || 0} 份出货`, dialog.rows); return;
    }
    if (dialog.kind === 'merge') {
      const rows = dialog.rows || []; if (!rows.length) return;
      const first = shippingInput(rows[0]); delete first.shipmentId; delete first.shipmentVersion;
      await execute({ ...first, action: 'SAVE_DRAFT', lines: rows.map(r => ({ lotId: r.lotId, version: r.version, quantity: Number(draftFor(r).quantity) })) }, '合并发货草稿已建立', rows); return;
    }
    const actions: Record<string,string> = { receive: 'RECEIVE', hold: 'HOLD', release: 'RELEASE_HOLD', opening: 'OPENING_RECONCILE', stockAdd: 'OPENING_ADD', batch: 'CREATE_BATCH', return: 'RETURN', block: 'BLOCK', unblock: 'UNBLOCK', scrap: 'SCRAP', adjust: 'ADJUST_DOWN', unreceive: 'UNRECEIVE', move: 'MOVE', allocate: 'ALLOCATE', rework: 'REWORK_OUT', reworkReturn: 'REWORK_RETURN', reworkScrap: 'REWORK_SCRAP' };
    await execute({ ...form, action: actions[dialog.kind], lotId: row?.lotId, version: row?.version, lineId: row?.lineId, quantity: Number(form.quantity), checked }, `${titleFor[dialog.kind]}已完成`, row ? [row] : []);
  }
  async function upload(row: FgRow, file?: File) {
    if (!file || !row.shipmentId || busyRef.current) return; busyRef.current = true; setBusy(true);
    const formData = new FormData(); formData.set('shipmentId', row.shipmentId); formData.set('file', file);
    try { const response = await fetch('/api/finished-goods/attachments', { method: 'POST', body: formData }); const result = await parseResponse(response); if (!response.ok) throw new Error(result.error); open('detail', row); setMessage('凭证已保存'); } catch (e) { setError(e instanceof Error ? e.message : '上传失败'); } finally { busyRef.current = false; setBusy(false); }
  }
  async function removeAttachment(id: string, row: FgRow) { const response = await fetch('/api/finished-goods/attachments', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id }) }); const result = await parseResponse(response); if (!response.ok) setError(result.error || '移除失败'); else open('detail', row); }
  function formField(label: string, key: string, type = 'text', placeholder = '') { return <label>{label}<input type={type} value={form[key] || ''} placeholder={placeholder} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} /></label>; }
  function shippingForm(row: FgRow) { const d = draftFor(row); return <div className="fg-form-grid">
    <label>本次发货数量<input type="number" min="1" value={d.quantity} disabled={row.shipmentLineCount > 1 || row.status === 'reserved' || row.status === 'shipped'} onChange={e => updateDraft(row, 'quantity', e.target.value)} /></label>
    <label>出货方式<select value={d.method} disabled={row.status === 'shipped'} onChange={e => updateDraft(row, 'method', e.target.value)}><option value="COURIER">快递 / 物流</option><option value="PICKUP">客户自提</option><option value="DELIVERY">专车送货</option></select></label>
    {d.method !== 'PICKUP' ? <><label>收货人<input value={d.recipient} disabled={row.status === 'shipped'} onChange={e => updateDraft(row,'recipient',e.target.value)} /></label><label>联系电话<input value={d.phone} disabled={row.status === 'shipped'} onChange={e => updateDraft(row,'phone',e.target.value)} /></label><label className="fg-span-2">收货地址<input value={d.address} disabled={row.status === 'shipped'} onChange={e => updateDraft(row,'address',e.target.value)} /></label></> : <label className="fg-span-2">自提交接人<input value={d.handoverName} disabled={row.status === 'shipped'} onChange={e => updateDraft(row,'handoverName',e.target.value)} /></label>}
    <label>承运商<input list="fg-carriers" value={d.carrier} onChange={e => updateDraft(row,'carrier',e.target.value)} /></label><label>箱数<input type="number" min="1" value={d.boxes} disabled={row.status === 'shipped'} onChange={e => updateDraft(row,'boxes',e.target.value)} /></label>
    <label className="fg-span-2">快递单号 / 运单号<textarea rows={2} placeholder="输入或粘贴；多个单号换行。可先发货后补录。" value={d.waybills} onChange={e => updateDraft(row,'waybills',e.target.value)} /></label>
    <label>日出货批次<select value={d.batchId} disabled={row.status === 'shipped'} onChange={e => updateDraft(row,'batchId',e.target.value)}><option value="">{activeBatches.length ? '暂不分批' : '暂无批次，可暂不分批'}</option>{d.batchId && !activeBatches.some(b => b.id === d.batchId) && <option value={d.batchId}>{row.batchNumber || '原批次'}（需核实日期 / 封批）</option>}{activeBatches.map(b => <option key={b.id} value={b.id}>{b.number.slice(-2)} 批 {b.name}</option>)}</select></label><label>备注<input value={d.note} onChange={e => updateDraft(row,'note',e.target.value)} /></label>
  </div>; }
  const dialogNeedsCheck = dialog && ['ship','batchShip','receive','opening','stockAdd','return','scrap','adjust','unreceive','rework','reworkReturn','reworkScrap'].includes(dialog.kind);

  return <main className={`fg-shell hm-workbench-root hm-workbench-navigation-overlay ${size === 16 ? 'fg-comfortable' : 'fg-compact'} ${continuous ? 'fg-continuous' : ''}`}>
    <AppWorkbenchHeader user={user} activeHref="/workspace/finished-goods" subtitle="接收、留库与统一出货" hideHeader sidebarTriggerTargetId="fg-nav-trigger" menuItems={[]} />
    <datalist id="fg-carriers"><option value="顺丰" /><option value="京东" /><option value="德邦" /><option value="中通" /><option value="圆通" /><option value="申通" /><option value="韵达" /><option value="专车" /></datalist>
    <header className="fg-header">
      <h1>成品仓</h1>
      <nav aria-label="成品仓模块">{VIEWS.map(v => <button type="button" key={v.id} className={(v.id === 'history' ? isRecords : view === v.id) ? 'active' : ''} onClick={() => switchView(v.id)}>{v.label}</button>)}</nav>
      <span className="fg-user">{user.displayName || user.username}</span>
    </header>
    <div className="fg-status-bar">
      <section className="fg-tabs" aria-label="成品仓筛选">
        {isRecords ? [{ id: 'history', label: '出货记录' }, { id: 'receipts', label: '入库记录' }, { id: 'legacy', label: '历史默认已出' }].map(v => <button type="button" key={v.id} className={view === v.id ? 'active' : ''} onClick={() => switchView(v.id)}>{v.label}</button>) : <>
          {filters.map(f => <button type="button" key={f.id} className={filter === f.id ? 'active' : ''} onClick={() => { setFilter(f.id); setPage(1); }}>{f.label}<b>{data.counts[f.id] || 0}</b></button>)}
          {view !== 'stock' && data.counts.blocked > 0 && <button type="button" className={filter === 'blocked' ? 'active' : ''} onClick={() => { setFilter('blocked'); setPage(1); }}>异常<b>{data.counts.blocked}</b></button>}
        </>}
      </section>
      {!isRecords && Boolean(data.cutover?.closedCount) && <button className="fg-legacy-entry" title={`新仓自 ${timeText(data.cutover!.startedAt)} 启用，之前默认历史已出`} onClick={() => switchView('legacy')}><History size={14}/>历史已出 {data.cutover!.closedCount} 条<ChevronRight size={13}/></button>}
    </div>
    <section className="fg-toolbar">
      <label className="fg-search"><Search size={17}/><input aria-label="搜索工单、客户、规格或运单" placeholder="工单 / 客户 / 规格 / 运单号" value={search} onChange={e => setSearch(e.target.value)}/>{search && <button onClick={() => setSearch('')} type="button" aria-label="清空搜索"><X size={14}/></button>}</label>
      {view !== 'legacy' && <label className="fg-date-filter">{view === 'stock' || view === 'receipts' ? '入库日期' : '已出日期'}<input aria-label={view === 'stock' || view === 'receipts' ? '入库日期' : '已出日期'} title="待处理包含往日未完成记录" type="date" value={date} onChange={e => { setDate(e.target.value); setScope(view === 'stock' ? 'range' : 'day'); setPage(1); setBatchId(''); }}/></label>}
      {scope === 'all' && view !== 'legacy' && <button className="fg-scope" onClick={() => { setScope('day'); setPage(1); }}>全部日期<X size={12}/></button>}
      {!isRecords && view !== 'stock' && <label className="fg-work-batch">本轮批次<select aria-label="本轮出货批次" value={workingBatchId} onChange={e => { if (e.target.value === '__new') open('batch'); else setWorkingBatchId(e.target.value); }}><option value="">{activeBatches.length ? '未分批' : '暂无批次'}</option>{activeBatches.map(b => <option key={b.id} value={b.id}>{b.name || `${b.number.slice(-2)} 批`}</option>)}<option value="__new">＋ 新建本日批次</option></select></label>}
      {!isRecords && view !== 'stock' && <><button type="button" className={continuous ? 'fg-toggle active' : 'fg-toggle'} onClick={() => { setContinuous(c => !c); if (!activeId) setActiveId(data.rows.find(canSelect)?.id || ''); }}><ClipboardList size={15}/>连续处理</button><button type="button" disabled={!selectedRows.length || busy || loading} onClick={() => open('batchShip', undefined, selectedRows)} className="fg-primary"><Truck size={16}/>批量发货</button></>}
      <div className="fg-more-wrap"><button aria-label="更多仓库操作" type="button" onClick={() => setMore(v => !v)}><MoreHorizontal size={19}/></button>{more && <div className="fg-menu">
        <button onClick={() => open('batch')}><Plus size={14}/>新建出货批次</button>
        {!isRecords && <><button disabled={!selectedRows.length} onClick={applyWorkingBatch}>为所选设置本轮批次</button><button disabled={selectedRows.length < 2} onClick={() => open('merge', undefined, selectedRows)}><Layers3 size={14}/>合并发货草稿</button><button onClick={() => open('stockAdd')}><Boxes size={14}/>登记实物库存</button></>}
        <button onClick={() => { setScope('all'); setPage(1); setMore(false); }}>查全部日期</button>
        {view !== 'legacy' && <label>日期范围至<input aria-label="结束日期" type="date" min={date} value={dateTo} onChange={e => { setDateTo(e.target.value); setScope('range'); setPage(1); }}/></label>}
        <label>列表密度<select aria-label="列表密度" value={size} onChange={e => { setSize(Number(e.target.value)); setPage(1); }}><option value={24}>紧凑 · 24 条</option><option value={16}>舒适 · 16 条</option><option value={48}>紧凑 · 48 条</option></select></label>
        <label>筛选批次<select aria-label="筛选出货批次" value={batchId} onChange={e => { setBatchId(e.target.value); setPage(1); }}><option value="">全部批次</option>{data.batches.map(b => <option key={b.id} value={b.id}>{b.number.slice(-2)} 批 {b.name}</option>)}</select></label>
        <a href={`/api/finished-goods/export?${params()}`}><Download size={14}/>导出当前筛选 Excel</a>
        {canAccessAppRoute(user.access,'/workspace/daily-plans') && <Link href="/workspace/daily-plans">日出货计划<ArrowRight size={13}/></Link>}
        <button onClick={() => { setRefresh(r => r + 1); setMore(false); }}><RefreshCw size={14}/>刷新数据</button>
      </div>}</div>
    </section>
    {view === 'stock' && <div className="fg-metrics">实物库存 <b>{num(data.stats.physical)}</b><span>可用 {num(data.stats.available)} · 占用 {num(data.stats.reserved)} · 留库 {num(data.stats.held)} · 隔离 {num(data.stats.blocked)}</span><span>待接收 {num(data.stats.pending)}（未计入实物）</span>{data.stats.holdDue > 0 && <button onClick={() => setFilter('held')}>留库到期 {data.stats.holdDue} 条</button>}</div>}
    {view === 'legacy' && <p className="fg-history-note">{timeText(data.cutover?.startedAt || null)} 启用前的结余，按约定默认历史已出。实际出货时间和运单未知；不计入当日实发，不重复扣减库存。</p>}
    {(error || message) && !dialog && <div role={error ? 'alert' : 'status'} className={`fg-notice ${error ? 'error' : ''}`}><span>{error || message}</span><button type="button" aria-label="关闭提示" onClick={() => { setError(''); setMessage(''); }}><X size={15}/></button></div>}
    {view === 'batches' && <div className="fg-batch-strip">{data.batches.map(b => <div key={b.id} className={batchId === b.id ? 'active' : ''}><button onClick={() => { setBatchId(batchId === b.id ? '' : b.id); setPage(1); }}><strong>{b.sequence.toString().padStart(2,'0')} 批 {b.name}</strong><span>{b.shipped} 单已发 · {num(b.quantity)} 件 · {b.draft} 单待发</span></button>{b.closedAt ? <small>已封批</small> : <button className="fg-link" disabled={busy} onClick={() => void execute({ action:'CLOSE_BATCH', batchId:b.id },'该批次已封批')}>封批</button>}</div>)}<button className="fg-batch-new" onClick={() => open('batch')}><Plus size={16}/>新批次</button></div>}
    <section className="fg-table-scroll" aria-label="成品与出货明细" aria-busy={loading}>
      <table className="fg-table"><colgroup>{[30,112,100,112,60,70,118,118,156,96,94].map((width,i) => <col key={i} style={{width}}/>)}</colgroup>
        <thead><tr><th><input aria-label="全选本页可发货记录" type="checkbox" disabled={!selectableRows.length || busy || loading} checked={Boolean(selectableRows.length) && selectableRows.every(r => selected.includes(r.id))} onChange={e => setSelected(e.target.checked ? selectableRows.map(r => r.id) : [])}/></th><th>工单</th><th>客户</th><th>规格</th><th>{showStock ? '可用' : '可发'}</th><th>{showStock ? '留库' : view === 'receipts' ? '本次入库' : view === 'legacy' ? '结清数量' : '本次数量'}</th><th>入库时间</th><th>出货时间</th><th>{showStock ? '库位' : '运单号'}</th><th>状态</th><th>操作</th></tr></thead>
        <tbody>{data.rows.map((row,index) => {
          const d = draftFor(row); const sent = row.status === 'shipped'; const actionable = isActionable(row); const legacy = row.status === 'legacy'; const readOnly = legacy || row.status === 'received';
          const canEdit = !showStock && !readOnly && (sent || actionable || row.status === 'reserved');
          const groupStart = view === 'batches' && (index === 0 || data.rows[index-1].batchId !== row.batchId);
          return <Fragment key={row.id}>
            {groupStart && <tr className="fg-group"><td colSpan={11}><Layers3 size={13}/>{row.batchNumber ? `${row.batchNumber.slice(-2)} 批` : '未分批'}<span>{data.batches.find(b => b.id === row.batchId)?.name}</span></td></tr>}
            <tr data-fg-row={row.id} className={`${activeId === row.id ? 'active' : ''} ${selected.includes(row.id) ? 'selected' : ''}`} onClick={e => { if (!(e.target as HTMLElement).closest('input,button,select,a')) activate(row); }}>
              <td>{canSelect(row) && <input type="checkbox" aria-label={`选择 ${row.workOrderCode}`} disabled={loading || busy} checked={selected.includes(row.id)} onChange={e => setSelected(prev => e.target.checked ? [...new Set([...prev,row.id])] : prev.filter(id => id !== row.id))}/>}</td>
              <td><button type="button" className="fg-identity" title={row.workOrderCode} onClick={() => open('detail',row)}>{fgShortWorkOrder(row.workOrderCode)}</button></td>
              <td title={row.customerName || '公共备货'}>{row.customerName || <span className="fg-public">公共备货</span>}</td>
              <td><button className="fg-specification" title={row.specification || '未填写规格'} onClick={() => open('detail',row)}>{row.specification || '—'}</button></td>
              <td className="fg-stock-cell" title={`可用 ${row.available} · 待接收 ${row.pending} · 占用 ${row.reserved} · 留库 ${row.held} · 隔离 ${row.blocked}`}>{readOnly ? '—' : row.blockedReason ? '受限' : row.available}</td>
              <td>{showStock ? <span>{row.held || '—'}</span> : sent || readOnly ? <span className="fg-num">{row.quantity}{row.returned > 0 && <small title="已退回"> / 退{row.returned}</small>}</span> : !actionable && row.status !== 'reserved' ? '—' : <input type="number" aria-label={`${row.workOrderCode} 本次数量`} title={row.status === 'reserved' || row.shipmentLineCount > 1 ? '该单已占用或包含多条明细，请从发货单整体处理' : 'Enter 保存，发货需单独确认'} min="1" className="fg-inline-number" value={d.quantity} readOnly={row.status === 'reserved' || row.shipmentLineCount > 1 || busy} onFocus={() => activate(row)} onChange={e => updateDraft(row,'quantity',e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void save(row); } if (e.key === 'Escape') resetField(row,'quantity'); }}/>}</td>
              <td className="fg-time" title={row.receivedAt ? timeText(row.receivedAt) : legacy ? '历史入库时间未知' : '实物尚未接收'}>{row.receivedAt ? fgCompactTime(row.receivedAt) : legacy ? '未知' : '未入库'}</td>
              <td className="fg-time" title={row.shippedAt ? timeText(row.shippedAt) : legacy ? '历史默认已出，实际出货时间未知' : '尚未实际发货'}>{legacy ? '未知' : fgCompactTime(row.shippedAt)}</td>
              <td>{showStock ? <button className="fg-cell-text" title={row.location} onClick={() => open('move',row)}>{row.location || '设置库位'}</button> : <div className="fg-waybill">
                {canEdit && (editingWaybill === row.id || Boolean(drafts[row.id])) ? <><input autoFocus={editingWaybill === row.id} aria-label={`${row.workOrderCode} 运单号`} placeholder="输入或粘贴单号" readOnly={busy} value={d.waybills.replace(/\n/g,'；')} onFocus={() => activate(row)} onChange={e => updateDraft(row,'waybills',e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void save(row); } if (e.key === 'Escape') { resetField(row,'waybills'); setEditingWaybill(''); } }}/><button title="保存信息，不会发货" aria-label={`保存 ${row.workOrderCode} 信息`} onClick={() => void save(row)} disabled={busy || loading}><Check size={13}/></button></> : <>
                  <button className={`fg-cell-text ${sent && !row.waybills.length && row.method === 'COURIER' ? 'fg-missing' : ''}`} title={row.waybills.join('；') || (canEdit ? '点击填写运单号' : row.blockedReason || row.holdReason)} disabled={!canEdit} onClick={() => { activate(row); setEditingWaybill(row.id); }}>{row.waybills.length ? `${row.waybills[0]}${row.waybills.length > 1 ? ` +${row.waybills.length-1} 单` : ''}` : legacy ? '未知' : row.method === 'PICKUP' ? '客户自提' : row.method === 'DELIVERY' ? '专车交接' : sent ? '待补单号' : canEdit ? '单号待填' : '—'}</button>
                  {row.waybills.length > 0 && <button aria-label={`复制 ${row.workOrderCode} 运单`} title="复制全部运单" onClick={() => void copyText(row.waybills.join('；'))}><Copy size={13}/></button>}
                  {savedRowId === row.id && <Check className="fg-saved" size={13} aria-label="已保存"/>}
                </>}
              </div>}</td>
              <td><button className={`fg-status ${row.status}`} title={row.blockedReason || row.holdReason || STATUS[row.status]} onClick={() => open('detail',row)}><i/>{STATUS[row.status]}{row.status === 'pending' && <small>({row.pending})</small>}</button>{row.holdDueDate && row.holdDueDate <= data.workDate && row.held > 0 && <span className="fg-due" title="留库到期，需手动释放">到期</span>}</td>
              <td><div className="fg-actions">{sent || readOnly ? <button onClick={() => sent && row.method === 'COURIER' && !row.waybills.length ? setEditingWaybill(row.id) : open('detail',row)}>{sent && row.method === 'COURIER' && !row.waybills.length ? '补单号' : '查看'}</button> : row.ownerType === 'PUBLIC' && ['ready','pending'].includes(row.status) ? <button disabled={busy || loading} onClick={() => open(row.available > 0 ? 'allocate' : 'receive',row)}>{row.available > 0 ? '分配' : '接收'}</button> : row.status === 'held' ? <button onClick={() => open('release',row)}>释放</button> : row.status === 'reserved' || actionable ? <button disabled={busy || loading} onClick={() => open('ship',row)}>{row.status === 'pending' ? '接收发货' : '发货'}</button> : <button onClick={() => open('detail',row)}>查看原因</button>}{!readOnly && <button aria-label={`${row.workOrderCode} 更多操作`} className="fg-row-more" onClick={() => open('detail',row)}><MoreHorizontal size={14}/></button>}</div></td>
            </tr>
          </Fragment>;
        })}</tbody>
      </table>
      {!data.rows.length && <div className="fg-empty"><Boxes size={38}/><h2>{search || filter !== 'all' || batchId ? '当前筛选没有记录' : view === 'legacy' ? '没有历史结清记录' : '等待生产执行转入成品'}</h2><p>{view === 'legacy' ? '启用前的已有结余按约定默认历史已出。' : '新完工记录自动进入待接收，可接收入库或直接接收发货。'}</p>{search && <button onClick={() => { setScope('all'); setPage(1); }}>查全部日期</button>}</div>}
    </section>
    {continuous && <section className="fg-dock" aria-label="连续处理">{active && current && ['ready','pending','reserved'].includes(active.status) ? <>
      <div className="fg-dock-identity"><small>当前处理</small><strong title={active.workOrderCode}>{fgShortWorkOrder(active.workOrderCode)}</strong><span>{active.specification}</span></div>
      <label>本次数量<input type="number" min="1" value={current.quantity} disabled={active.status === 'reserved' || active.shipmentLineCount > 1} onChange={e => updateDraft(active,'quantity',e.target.value)}/></label>
      <label className="fg-dock-waybill">运单号<input placeholder="输入或粘贴单号" value={current.waybills} onChange={e => updateDraft(active,'waybills',e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void save(active); } }}/></label>
      <button className="fg-link" onClick={() => open('ship',active)}>{current.method === 'PICKUP' ? current.handoverName || '补交接人' : current.recipient && current.address ? '收货信息 ✓' : '补收货信息'}</button>
      <label className="fg-check"><input type="checkbox" checked={checked} onChange={e => setChecked(e.target.checked)}/>实物已核对</label>
      <button className="fg-primary" disabled={busy || loading || !checked || active.ownerType === 'PUBLIC'} onClick={() => active.shipmentLineCount > 1 ? open('ship',active) : void dispatch(active)}>{busy ? '正在处理…' : '发货并下一条'}<ArrowRight size={16}/></button>
    </> : <div className="fg-dock-empty"><ClipboardList size={19}/><span>点击一条正常待接收或待发记录，连续处理。</span></div>}</section>}
    <footer className="fg-footer"><span>已选 <b>{selectedRows.length}</b> 条{selectedRows.length > 0 && <> · 共 <b>{num(selectedRows.reduce((sum,r) => sum + Number(draftFor(r).quantity || 0),0))}</b> 件</>}</span><span className="fg-footer-tip">Tab 下一格 · Enter 保存信息</span>{Object.keys(drafts).length > 0 && <span className="fg-unsaved">{Object.keys(drafts).length} 条待保存</span>}<span className="fg-pagination">{data.total ? (data.page-1)*data.pageSize+1 : 0}–{Math.min(data.page*data.pageSize,data.total)} / {data.total} 条</span><button aria-label="上一页" disabled={data.page <= 1 || loading} onClick={() => setPage(n => n-1)}><ChevronLeft size={16}/></button><button className="fg-primary" aria-label={`当前第 ${data.page} 页`}>{data.page}</button><button aria-label="下一页" disabled={data.page*data.pageSize >= data.total || loading} onClick={() => setPage(n => n+1)}><ChevronRight size={16}/></button></footer>
    {dialog && <div className="fg-dialog-overlay"><section className={`fg-dialog ${dialog.kind === 'detail' ? 'fg-detail' : ''}`} role="dialog" aria-modal="true" aria-label={titleFor[dialog.kind]}><header><div><small>{dialog.row?.workOrderCode || '成品仓'}</small><h2>{titleFor[dialog.kind]}</h2></div><button type="button" disabled={busy} aria-label="关闭窗口" onClick={() => setDialog(null)}><X size={21}/></button></header>
      <div className="fg-dialog-body">{error && <div role="alert" className="fg-notice error"><AlertCircle size={16}/>{error}</div>}
      {dialog.row && <div className="fg-dialog-identity"><strong>{dialog.row.productName}</strong><span>{dialog.row.specification} · {dialog.row.customerName || '公共备货'}</span><small>待收 {dialog.row.pending} · 可用 {dialog.row.available} · 占用 {dialog.row.reserved} · 留库 {dialog.row.held} · 隔离 {dialog.row.blocked}</small></div>}
      {dialog.kind === 'ship' && dialog.row && <><div className="fg-callout"><PackageCheck size={18}/><span>核对后记录本次实物交接。可用库存不足时，差额从待接收数量中接收；剩余库存保留。</span></div>{shippingForm(dialog.row)}{dialog.row.shipmentLineCount > 1 && <div className="fg-callout">本次发出整张合单：{detail?.shipment?.lines.map(l => `${l.lot.workOrderCode} × ${l.quantity}`).join('，') || '正在加载明细…'}</div>}</>}
      {dialog.kind === 'batchShip' && <><p>一次确认 {dialog.rows?.length || 0} 份出货，各单保留自己的数量、运单和收货信息。任意一条不符合条件时，本次全部保持原状。</p>{dialog.rows?.map(r => <div className="fg-bulk-entry" key={r.id}><strong>{r.workOrderCode} · {r.customerName}</strong><span>{draftFor(r).quantity} {r.unit} · {draftFor(r).carrier || '未选承运商'}</span><button className="fg-link" onClick={() => { setDialog({ kind:'ship', row:r }); setChecked(false); }}>核对信息</button></div>)}</>}
      {dialog.kind === 'merge' && <><p>所选成品将使用第一条的收货人、地址、承运商和批次。仅同客户可合单；已有草稿请先取消，避免遗漏。</p>{dialog.rows?.map(r => <div className="fg-bulk-entry" key={r.id}><strong>{r.workOrderCode} · {r.customerName}</strong><span>{draftFor(r).quantity} {r.unit}</span></div>)}</>}
      {!['ship','batchShip','detail','merge'].includes(dialog.kind) && <div className="fg-form-grid">
        {dialog.kind === 'batch' ? <>{formField('批次日期','date','date')}{formField('批次名称','name','text','例如：上午顺丰 / 下午专车')}{formField('承运商','carrier')}{formField('备注','note')}</> : <>
        {dialog.kind === 'stockAdd' && <><label>库存归属<select value={form.ownerType} onChange={e => setForm(f => ({...f,ownerType:e.target.value}))}><option value="PUBLIC">公共备货</option><option value="CUSTOMER">客户专属</option></select></label>{formField('客户（客户专属必填）','customerName')}{formField('产品名称','productName')}{formField('规格 / 图号','specification')}{formField('来源单号','workOrderCode')}{formField('库位','location')}</>}
        {!['move'].includes(dialog.kind) && formField(dialog.kind === 'opening' ? '核对后的实际数量（允许为 0）' : '本次数量','quantity','number')}
        {dialog.kind === 'hold' && formField('预计释放日期（到期仅提醒）','dueDate','date')}
        {['move','return','reworkReturn'].includes(dialog.kind) && formField('库位','location')}
        {dialog.kind === 'allocate' && formField('分配客户','customerName')}
        {['scrap','adjust','rework'].includes(dialog.kind) && <label>扣减库存<select value={form.bucket} onChange={e => setForm(f => ({ ...f,bucket:e.target.value }))}><option value="available">可用库存</option><option value="blocked">隔离库存</option></select></label>}
        {dialog.kind === 'rework' && formField('返工去向 / 关联返工单号','destination')}
        {['reworkReturn','reworkScrap'].includes(dialog.kind) && <label>原返工转出<select value={form.reworkId} onChange={e => setForm(f => ({...f,reworkId:e.target.value}))}><option value="">选择返工记录</option>{detail?.lot.reworks.filter(r => r.quantity-r.returned-r.scrapped > 0).map(r => <option key={r.id} value={r.id}>{r.destination} · 在外 {r.quantity-r.returned-r.scrapped} 件</option>)}</select></label>}
        <label className="fg-span-2">{dialog.kind === 'receive' ? '备注' : '原因 / 来源说明'}<textarea rows={3} value={form.reason || ''} onChange={e => setForm(f => ({...f,reason:e.target.value}))}/></label>
        {dialog.kind === 'opening' && <p className="fg-span-2 fg-muted">候选数已扣除历史净发货。以点收实物为准，差异记录在盘点流水中。</p>}
        {['return','reworkReturn'].includes(dialog.kind) && <p className="fg-span-2 fg-muted">实物先进入隔离库存；确认可发后再解除隔离，不直接增加可用数量。</p>}</>}
      </div>}
      {dialog.kind === 'detail' && dialog.row && <>
        {!dialog.row.legacyClosedAt && <div className="fg-detail-tools">{dialog.row.pending > 0 && <button onClick={() => open(dialog.row!.openingReview ? 'opening' : 'receive',dialog.row)}><ArrowDownToLine size={15}/>{dialog.row.openingReview ? '期初核对' : '接收'}</button>}{dialog.row.available > 0 && <button onClick={() => open('hold',dialog.row)}><Pause size={15}/>留库</button>}{dialog.row.held > 0 && <button onClick={() => open('release',dialog.row)}>释放留库</button>}{dialog.row.ownerType === 'PUBLIC' && <button onClick={() => open('allocate',dialog.row)}>分配客户</button>}{dialog.row.status === 'shipped' && <button onClick={() => open('return',dialog.row)}>退货接收</button>}<button onClick={() => open('move',dialog.row)}>移库</button><button onClick={() => open('block',dialog.row)}>隔离</button>{dialog.row.blocked > 0 && <button onClick={() => open('unblock',dialog.row)}>解除隔离</button>}<button onClick={() => open('rework',dialog.row)}>返工转出</button><button onClick={() => open('reworkReturn',dialog.row)}>返工回库</button><button onClick={() => open('reworkScrap',dialog.row)}>返工报废</button><button onClick={() => open('scrap',dialog.row)}>库存报废</button><button onClick={() => open('adjust',dialog.row)}>盘亏</button>{dialog.row.sourceKind === 'PRODUCTION' && <button onClick={() => open('unreceive',dialog.row)}>撤销接收</button>}</div>}
        {dialog.row.legacyClosedAt && dialog.row.status === 'shipped' && <div className="fg-detail-tools"><button onClick={() => open('return',dialog.row)}>退货接收</button></div>}<div className="fg-detail-times"><span>完整工单：{dialog.row.workOrderCode}<button className="fg-link" onClick={() => void copyText(dialog.row!.workOrderCode)}><Copy size={13}/>复制</button></span><span>{dialog.row.status === 'received' ? '本次入库' : '首次入库'}：{timeText(dialog.row.receivedAt)}</span><span>本次出货：{timeText(dialog.row.shippedAt)}</span></div>
        {dialog.row.legacyClosedAt && <p className="fg-callout">该记录已按启用约定默认历史已出，结清于 {timeText(dialog.row.legacyClosedAt)}；此时间不是实际出货时间。</p>}
        {dialog.row.blockedReason && <p className="fg-callout">{dialog.row.blockedReason}，发货前需完成来源处理。</p>}
        {dialog.row.workOrderId && <Link className="fg-source-link" href={`/production?workOrderId=${encodeURIComponent(dialog.row.workOrderId)}`}>查看生产来源 <ArrowRight size={13}/></Link>}
        {dialog.row.shipmentId && <section className="fg-detail-section"><h3>发货单 {dialog.row.shipmentNumber}</h3>{shippingForm(dialog.row)}<div className="fg-detail-tools"><button className="fg-primary" disabled={busy} onClick={() => void save(dialog.row!)}>保存物流信息</button>{dialog.row.status === 'shipped' && <Link href={`/workspace/finished-goods/print/${dialog.row.shipmentId}`} target="_blank"><Printer size={15}/>打印装箱 / 发货单</Link>}{!['shipped','reserved'].includes(dialog.row.status) && <button disabled={busy} onClick={() => void execute({ action:'RESERVE',shipmentId:dialog.row!.shipmentId,shipmentVersion:dialog.row!.shipmentVersion },'库存已为该单占用',[dialog.row!])}>占用库存</button>}{dialog.row.status === 'reserved' && <button disabled={busy} onClick={() => void execute({ action:'UNRESERVE',shipmentId:dialog.row!.shipmentId,shipmentVersion:dialog.row!.shipmentVersion },'库存占用已释放',[dialog.row!])}>释放占用</button>}{dialog.row.status !== 'shipped' && <button disabled={busy} onClick={() => void execute({ action:'CANCEL_DRAFT',shipmentId:dialog.row!.shipmentId,shipmentVersion:dialog.row!.shipmentVersion },'发货草稿已取消',[dialog.row!])}>取消草稿</button>}</div>
        {detail?.shipment?.lines.length && detail.shipment.lines.length > 1 && <div className="fg-callout">合单共 {detail.shipment.lines.length} 条：{detail.shipment.lines.map(l => `${l.lot.workOrderCode} × ${l.quantity}`).join('，')}</div>}
        <h3>装箱照片 / 出货凭证</h3><label className="fg-upload"><Plus size={15}/>添加照片或 PDF<input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" disabled={busy} onChange={e => void upload(dialog.row!,e.target.files?.[0])}/></label><div className="fg-attachment-list">{detail?.shipment?.attachments.map(a => <div key={a.id}><a target="_blank" rel="noreferrer" href={`/api/finished-goods/attachments?id=${a.id}`}><FileText size={15}/>{a.originalName}</a><a href={`/api/finished-goods/attachments?id=${a.id}&download=1`} title="下载"><Download size={14}/></a><button aria-label={`移除 ${a.originalName}`} onClick={() => void removeAttachment(a.id,dialog.row!)}><X size={14}/></button></div>)}</div></section>}
        <section className="fg-detail-section"><h3><History size={15}/>收发与库存流水</h3>{!detail ? <p className="fg-muted">正在加载…</p> : detail.lot.ledger.length ? <ol className="fg-ledger">{detail.lot.ledger.map(l => <li key={l.id}><span className="fg-ledger-dot"/><div><strong>{FG_KINDS[l.kind] || (l.kind === 'LOGISTICS' ? '物流补录' : l.kind)} <b>{l.quantity ? `${['ADJUST','SOURCE_CORRECTION'].includes(l.kind) && l.quantity > 0 ? '+' : ''}${['ADJUST','SOURCE_CORRECTION'].includes(l.kind) ? l.quantity : Math.abs(l.quantity)} 件` : ''}</b></strong><p>{l.reason || '—'}</p><small>{timeText(l.createdAt)} · {l.actorName}</small></div></li>)}</ol> : <p className="fg-muted">尚无实物收发记录。</p>}</section>
        {detail && <section className="fg-detail-section"><h3>关联出货记录</h3>{detail.lot.lines.map(l => <div className="fg-bulk-entry" key={l.id}><strong>{l.shipment.number}</strong><span>{l.quantity} 件 · {l.shipment.shippedAt ? timeText(l.shipment.shippedAt) + ' · ' : ''}{l.shipment.status === 'SHIPPED' ? '已发出' : l.shipment.status === 'CANCELLED' ? '已取消' : '待发货'}{l.returned > 0 && ` · 退回 ${l.returned}`}</span>{l.shipment.status === 'SHIPPED' && <Link target="_blank" href={`/workspace/finished-goods/print/${l.shipment.id}`}>查看单据</Link>}</div>)}</section>}
      </>}
      </div>{dialog.kind !== 'detail' && <footer>{dialogNeedsCheck && <label className="fg-check"><input type="checkbox" checked={checked} onChange={e => setChecked(e.target.checked)}/>实物数量与交接信息已核对</label>}<button onClick={() => setDialog(null)} disabled={busy}>取消</button><button className="fg-primary" disabled={busy || Boolean(dialogNeedsCheck && !checked) || (dialog.kind === 'ship' && (dialog.row?.shipmentLineCount || 0) > 1 && !detail?.shipment) || (dialog.kind === 'merge' && dialog.rows?.some(r => Boolean(r.shipmentId)))} onClick={() => void submitDialog()}>{busy ? '正在处理…' : dialog.kind === 'ship' || dialog.kind === 'batchShip' ? '确认实物发货' : '确认保存'}</button></footer>}</section></div>}
  </main>;
}
