'use client';

import { Fragment, useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import Link from 'next/link';
import { AlertCircle, ArrowDownToLine, ArrowRight, Boxes, Check, ChevronLeft, ChevronRight, ClipboardList, Copy, Download, FileText, History, Layers3, MoreHorizontal, Pause, Plus, RefreshCw, Search, Truck, X } from 'lucide-react';
import { AppWorkbenchHeader } from '@/components/layout/AppWorkbenchHeader';
import { FG_KINDS, fgCompactTime, fgShortWorkOrder, type FgInput, type FgRow, type FgWorkbench } from '@/lib/finished-goods-domain';
import { canAccessAppRoute } from '@/lib/app-route-access';
import type { CurrentUserDTO } from '@/types';

type Draft = { quantity: string; method: string; batchId: string; note: string; externalReference: string };
type Dialog = { kind: string; row?: FgRow; rows?: FgRow[] };
type RetryOperation = { input: FgInput; success: string; affected: FgRow[]; keepDialog: boolean };
type Detail = { lot: { holds: { id: string; quantity: number; released: number; reason: string; dueDate: string | null }[]; reworks: { id: string; quantity: number; returned: number; scrapped: number; destination: string; reason: string }[]; ledger: { id: string; kind: string; quantity: number; reason: string; actorName: string; createdAt: string }[]; lines: { id: string; quantity: number; returned: number; shipment: { id: string; number: string; status: string; shippedAt: string | null; attachments: Attachment[] } }[] }; shipment?: { lines: { id: string; quantity: number; lot: { workOrderCode: string; productName: string } }[]; attachments: Attachment[] } | null };
type Attachment = { id: string; originalName: string; size: number };
const STATUS: Record<string, string> = { pending: '待入库', ready: '待发货', shipped: '已出库', held: '留库', opening: '待核对', legacy: '历史已出', received: '已入库', reserved: '已占用', blocked: '隔离', restricted: '生产受限' };
const VIEWS = [{ id: 'queue', label: '收发' }, { id: 'stock', label: '库存' }, { id: 'history', label: '记录' }, { id: 'batches', label: '批次' }];
const QUEUE_FILTERS = [{ id: 'processing', label: '待处理' }, { id: 'pending', label: '待入库' }, { id: 'ready', label: '待发货' }, { id: 'shipped', label: '已出库' }, { id: 'all', label: '全部' }];
const STOCK_FILTERS = [{ id: 'all', label: '全部库存' }, { id: 'pending', label: '待入库' }, { id: 'ready', label: '可用' }, { id: 'held', label: '留库' }, { id: 'reserved', label: '占用' }, { id: 'blocked', label: '隔离 / 受限' }];
const METHODS: Record<string,string> = { COURIER: '快递 / 物流', PICKUP: '自提', DELIVERY: '送货' };
const titleFor: Record<string, string> = { ship: '确认本次发货', batchShip: '批量发货', batchReceive: '批量入库', receive: '确认入库', receiveHold: '入库并留库', hold: '留库', release: '释放留库', detail: '成品明细', opening: '期初实物核对', stockAdd: '登记实物库存', batch: '新建出货批次', return: '退货实物接收', block: '隔离库存', unblock: '解除隔离', scrap: '报废出库', adjust: '盘亏登记', unreceive: '撤销入库', move: '移库', allocate: '分配公共备货', rework: '返工转出', reworkReturn: '返工回库', reworkScrap: '返工报废', merge: '合并待发记录' };
const timeText = (time: string | null) => time ? new Date(time).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : '—';
const num = (n: number) => n.toLocaleString('zh-CN');
function defaultDraft(row: FgRow): Draft { return { quantity: String(row.quantity || row.available || row.pending || 1), method: row.method, batchId: row.batchId, note: row.shipmentNote, externalReference: row.externalReference || '' }; }
function parseResponse(response: Response): Promise<{ ok: boolean; error?: string; code?: string; data?: unknown }> { return response.json(); }

export default function FinishedGoodsWorkbench({ user, initialData, initialQuery, initialSampleTaskId = '' }: { user: CurrentUserDTO; initialData: FgWorkbench; initialQuery: string; initialSampleTaskId?: string }) {
  const [data, setData] = useState(initialData); const [view, setView] = useState('queue'); const [filter, setFilter] = useState(initialSampleTaskId ? 'all' : 'processing');
  const [query, setQuery] = useState(initialQuery); const [search, setSearch] = useState(initialQuery); const [date, setDate] = useState(initialData.date);
  const [batchId, setBatchId] = useState(''); const [workingBatchId, setWorkingBatchId] = useState(''); const [scope, setScope] = useState(initialSampleTaskId ? 'all' : 'day'); const [dateTo, setDateTo] = useState('');
  const [dateBasis,setDateBasis] = useState('event'); const [sort,setSort] = useState('default');
  const [savedRowId, setSavedRowId] = useState(''); const [page, setPage] = useState(1); const [size, setSize] = useState(24);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({}); const [selected, setSelected] = useState<string[]>([]); const [activeId, setActiveId] = useState('');
  const [continuous, setContinuous] = useState(false); const [checked, setChecked] = useState(false); const [busy, setBusy] = useState(false); const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(''); const [error, setError] = useState(''); const [dialog, setDialog] = useState<Dialog | null>(null);
  const [form, setForm] = useState<Record<string, string>>({}); const [detail, setDetail] = useState<Detail | null>(null); const [refresh, setRefresh] = useState(0);
  const [more, setMore] = useState(false); const requestToken = useRef(0); const busyRef = useRef(false); const mutation = useRef<{ body: string; key: string } | null>(null); const draftsLoaded = useRef(false);
  const [workingMethod, setWorkingMethod] = useState('COURIER'); const [detailMore, setDetailMore] = useState(false);
  const [retryOperation, setRetryOperation] = useState<RetryOperation | null>(null); const roundLoaded = useRef(false); const detailToken = useRef(0);
  const [poll, setPoll] = useState(0);
  const queryKey = useRef('');
  const storageKey = `hm-finished-goods:quantities-v188:${user.id}`;
  const draftFor = (row: FgRow): Draft => drafts[row.id] ? { ...defaultDraft(row), ...drafts[row.id] } : { ...defaultDraft(row), method: row.shipmentId ? row.method : workingMethod, batchId: row.shipmentId ? row.batchId : workingBatchId };
  const isActionable = (r: FgRow) => ['ready','pending'].includes(r.status) && !r.otherDrafts;
  const canReceive = (r: FgRow) => r.pending > 0 && !r.openingReview && !r.legacyClosedAt && !r.blockedReason && r.status !== 'shipped' && r.status !== 'received';
  const canShip = (r: FgRow) => isActionable(r) && r.ownerType === 'CUSTOMER' && r.shipmentLineCount === 1;
  const canSelect = (r: FgRow) => !isRecords && (canShip(r) || canReceive(r));
  const isRecords = ['history','receipts','legacy'].includes(view);
  const selectableRows = data.rows.filter(canSelect);
  const filters = view === 'stock' ? STOCK_FILTERS : QUEUE_FILTERS;
  const activeBatches = data.dispatchBatches.filter(b => !b.closedAt);
  const active = data.rows.find(r => r.id === activeId); const current = active ? draftFor(active) : null;
  const selectedRows = data.rows.filter(r => selected.includes(r.id));
  const selectedShipRows = selectedRows.filter(canShip); const selectedReceiveRows = selectedRows.filter(canReceive);
  const showStock = view === 'stock' || view === 'holds';
  const params = useCallback(() => new URLSearchParams({ date, dateTo, dateBasis, sort, scope, view, filter, q: query, sampleTaskId: initialSampleTaskId, batchId, page: String(page), pageSize: String(size) }), [date, dateTo, dateBasis, sort, scope, view, filter, query, initialSampleTaskId, batchId, page, size]);

  useEffect(() => { const timer = setTimeout(() => { setQuery(search); setPage(1); }, 250); return () => clearTimeout(timer); }, [search]);
  useEffect(() => { if (!message) return; const timer = setTimeout(() => setMessage(''), 5000); return () => clearTimeout(timer); }, [message]);
  useEffect(() => {
    roundLoaded.current = false;
    try { const saved = JSON.parse(sessionStorage.getItem(`hm-fg-round:${user.id}`) || 'null'); if (saved?.date === data.workDate) { setWorkingBatchId(saved.batchId || ''); setWorkingMethod(METHODS[saved.method] ? saved.method : 'COURIER'); } else setWorkingBatchId(''); } catch { /* Defaults remain usable. */ }
    roundLoaded.current = true;
  }, [data.workDate, user.id]);
  useEffect(() => { if (roundLoaded.current) try { sessionStorage.setItem(`hm-fg-round:${user.id}`, JSON.stringify({ date:data.workDate, batchId:workingBatchId, method:workingMethod })); } catch { /* Defaults remain usable. */ } }, [workingBatchId, workingMethod, data.workDate, user.id]);
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

  function updateDraft(row: FgRow, field: keyof Draft, value: string) { setRetryOperation(null); setSavedRowId(''); setDrafts(previous => ({ ...previous, [row.id]: { ...draftFor(row), [field]: value } })); }
  function resetField(row: FgRow, field: keyof Draft) { updateDraft(row, field, defaultDraft(row)[field]); }
  function nextCell(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Tab') return;
    const cells = Array.from(document.querySelectorAll<HTMLInputElement>('.fg-table tbody input:not([type="checkbox"]):not([readonly]):not([disabled])'));
    const next = cells[cells.indexOf(event.currentTarget) + (event.shiftKey ? -1 : 1)];
    if (next) { event.preventDefault(); next.focus(); next.select(); }
  }
  function activate(row: FgRow) { if (activeId !== row.id) { setActiveId(row.id); setChecked(false); } }
  function switchView(next: string) { setView(next); setFilter(next === 'queue' ? 'processing' : 'all'); setPage(1); setBatchId(''); setDateTo(''); setScope(next === 'legacy' || next === 'stock' ? 'all' : 'day'); setContinuous(false); setMore(false); setRetryOperation(null); }
  async function copyText(value: string) { try { await navigator.clipboard.writeText(value); setMessage('已复制'); } catch { setError('当前浏览器未允许复制，请在明细中选中完整内容复制'); } }
  function applyWorkingBatch() { selectedRows.filter(canSelect).forEach(row => updateDraft(row,'batchId',workingBatchId)); setMessage('所选记录已设置本轮批次，保存或发货时生效'); }
  function clearDrafts(rows: FgRow[]) { setDrafts(prev => { const next = Object.fromEntries(Object.entries(prev).filter(([key]) => !rows.some(row => row.id === key))); try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* Editing still works. */ } return next; }); }
  async function execute(input: FgInput, success: string, affected: FgRow[] = [], keepDialog = false): Promise<boolean> {
    if (busyRef.current) return false;
    busyRef.current = true; setBusy(true); setError(''); setMessage(''); setRetryOperation(null);
    const body = JSON.stringify(input);
    if (!mutation.current || mutation.current.body !== body) mutation.current = { body, key: crypto.randomUUID() };
    try {
      const response = await fetch('/api/finished-goods', { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': mutation.current.key }, body });
      const result = await parseResponse(response);
      if (!response.ok) { if (response.status < 500) mutation.current = null; if (result.code === 'FG_WAYBILL_CUSTOMER') setRetryOperation({input,success,affected,keepDialog}); throw new Error(result.error || '操作失败'); }
      mutation.current = null;
      clearDrafts(['RECEIVE','RECEIVE_HOLD','BATCH_RECEIVE'].includes(String(input.action)) ? affected.filter(row => { const draft = drafts[row.id]; return !draft || !(draft.note.trim() || draft.externalReference?.trim() || draft.method !== workingMethod || draft.batchId !== workingBatchId); }) : affected);
      setSelected(previous => previous.filter(id => !affected.some(row => row.id === id))); setMessage(success); setChecked(false);
      if (['SHIP','QUICK_SHIP'].includes(String(input.action)) && affected.length === 1) {
        const index = data.rows.findIndex(r => r.id === affected[0].id);
        const next = [...data.rows.slice(index + 1), ...data.rows.slice(0,index)].find(canShip);
        setActiveId(next?.id || '');
      }
      if (['SAVE_DRAFT','SAVE_LOGISTICS'].includes(String(input.action)) && affected.length === 1) { setSavedRowId(affected[0].id); }
      if (!keepDialog) setDialog(null); setRefresh(r => r + 1); return true;
    } catch (e) { setError(e instanceof Error ? e.message : '连接中断，请重试'); return false; }
    finally { busyRef.current = false; setBusy(false); }
  }
  function shippingInput(row: FgRow): FgInput { const d = draftFor(row); return { quantity:Number(d.quantity),method:d.method,batchId:d.batchId,note:d.note,externalReference:d.externalReference,customerName:row.customerName,lotId:row.lotId,version:row.version,shipmentId:row.shipmentId,shipmentVersion:row.shipmentVersion,plannedDate:data.workDate,checked:true,receive:true }; }
  async function save(row: FgRow): Promise<void> {
    if (row.ownerType==='PUBLIC') { setSavedRowId(row.id); setMessage('本次数量已保存在此设备，入库需单独确认。'); return; }
    const input = shippingInput(row);
    if (await execute({ ...input, action: row.status === 'shipped' || row.status === 'reserved' || row.shipmentLineCount > 1 ? 'SAVE_LOGISTICS' : 'SAVE_DRAFT' }, '出货信息已保存', [row])) { setSavedRowId(row.id); }
  }
  function open(kind: string, row?: FgRow, rows?: FgRow[]) {
    const token = ++detailToken.current;
    setMore(false); setError(''); setChecked(false); setDetail(null); setDetailMore(false); setRetryOperation(null);
    if (row) setActiveId(row.id);
    const q = kind === 'release' ? row?.held : ['unblock'].includes(kind) ? row?.blocked : ['opening','receive','receiveHold'].includes(kind) ? row && Math.min(Number(draftFor(row).quantity) || row.pending,row.pending) : kind === 'return' ? Math.max(0, (row?.quantity || 0) - (row?.returned || 0)) : row?.available || row?.blocked || 1;
    setForm({ quantity: String(q || (kind === 'opening' ? 0 : 1)), reason: ['hold','receiveHold'].includes(kind) ? '备货' : kind==='release' ? '解除留库，恢复可发' : '', location: row?.location || '', customerName: row?.customerName || '', ownerType: 'PUBLIC', bucket: row?.available ? 'available' : 'blocked', date: data.workDate, reworkId: '' });
    setDialog({ kind, row, rows });
    if (row && ['detail','ship','reworkReturn','reworkScrap'].includes(kind)) void fetch(`/api/finished-goods?lotId=${encodeURIComponent(row.lotId)}${row.shipmentId ? `&shipmentId=${encodeURIComponent(row.shipmentId)}` : ''}`).then(async r => { const result = await parseResponse(r); if (!r.ok) throw new Error(result.error); if (detailToken.current === token) setDetail(result.data as Detail); }).catch(e => { if (detailToken.current === token) setError(e.message); });
  }
  async function dispatch(row: FgRow) {
    await execute({ ...shippingInput(row), action: row.status === 'reserved' || row.shipmentLineCount > 1 ? 'SHIP' : 'QUICK_SHIP' }, row.shipmentLineCount > 1 ? '整张合单已确认发货' : `已确认发货 ${draftFor(row).quantity} ${row.unit}`, [row]);
  }
  async function submitDialog() {
    if (!dialog) return; const row = dialog.row;
    if (dialog.kind === 'ship' && row) { await dispatch(row); return; }
    if (dialog.kind === 'batchShip') {
      await execute({ action: 'BATCH_SHIP', checked:true, entries: (dialog.rows || []).map(r => shippingInput(r)) }, `已完成 ${dialog.rows?.length || 0} 条出库`, dialog.rows); return;
    }
    if (dialog.kind === 'batchReceive') {
      await execute({action:'BATCH_RECEIVE',checked:true,entries:(dialog.rows || []).map(r=>({lotId:r.lotId,version:r.version,quantity:Number(draftFor(r).quantity)}))},`已入库 ${dialog.rows?.length || 0} 条`,dialog.rows); return;
    }
    if (dialog.kind === 'merge') {
      const rows = dialog.rows || []; if (!rows.length) return;
      const first = shippingInput(rows[0]); delete first.shipmentId; delete first.shipmentVersion;
      await execute({ ...first, action: 'SAVE_DRAFT', lines: rows.map(r => ({ lotId: r.lotId, version: r.version, quantity: Number(draftFor(r).quantity) })) }, '合并发货草稿已建立', rows); return;
    }
    const actions: Record<string,string> = { receive: 'RECEIVE', receiveHold:'RECEIVE_HOLD', hold: 'HOLD', release: 'RELEASE_HOLD', opening: 'OPENING_RECONCILE', stockAdd: 'OPENING_ADD', batch: 'CREATE_BATCH', return: 'RETURN', block: 'BLOCK', unblock: 'UNBLOCK', scrap: 'SCRAP', adjust: 'ADJUST_DOWN', unreceive: 'UNRECEIVE', move: 'MOVE', allocate: 'ALLOCATE', rework: 'REWORK_OUT', reworkReturn: 'REWORK_RETURN', reworkScrap: 'REWORK_SCRAP' };
    await execute({ ...form, action: actions[dialog.kind], lotId: row?.lotId, version: row?.version, lineId: row?.lineId, quantity: Number(form.quantity), checked: ['receive','receiveHold'].includes(dialog.kind) || checked }, `${titleFor[dialog.kind]}已完成`, row ? [row] : []);
  }
  async function upload(row: FgRow, file?: File) {
    if (!file || !row.shipmentId || busyRef.current) return; busyRef.current = true; setBusy(true);
    const formData = new FormData(); formData.set('shipmentId', row.shipmentId); formData.set('file', file);
    try { const response = await fetch('/api/finished-goods/attachments', { method: 'POST', body: formData }); const result = await parseResponse(response); if (!response.ok) throw new Error(result.error); open('detail', row); setMessage('凭证已保存'); } catch (e) { setError(e instanceof Error ? e.message : '上传失败'); } finally { busyRef.current = false; setBusy(false); }
  }
  async function removeAttachment(id: string, row: FgRow) { const response = await fetch('/api/finished-goods/attachments', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id }) }); const result = await parseResponse(response); if (!response.ok) setError(result.error || '移除失败'); else open('detail', row); }
  function formField(label: string, key: string, type = 'text', placeholder = '') { return <label>{label}<input type={type} value={form[key] || ''} placeholder={placeholder} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} /></label>; }
  function shipmentFields(row: FgRow) { const d = draftFor(row); return <>
    <label className="fg-span-2">备注（可选）<input value={d.note} onChange={e=>updateDraft(row,'note',e.target.value)}/></label>
    <details className="fg-extra-fields fg-span-2"><summary>关联外部单据（可选）</summary><label>外部出货 / 销货单号<input placeholder="另一软件的单据编号" value={d.externalReference} onChange={e=>updateDraft(row,'externalReference',e.target.value)}/></label></details>
  </>; }
  function shippingForm(row: FgRow) { const d = draftFor(row); return <div className="fg-form-grid fg-shipping-form">
    <label>本次发货数量<input type="number" min="1" value={d.quantity} disabled={row.shipmentLineCount > 1 || row.status === 'reserved'} onChange={e=>updateDraft(row,'quantity',e.target.value)}/></label>
    <label>出货方式<select value={d.method} onChange={e=>updateDraft(row,'method',e.target.value)}>{Object.entries(METHODS).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
    {shipmentFields(row)}
    <label className="fg-span-2">本次批次<select value={d.batchId} onChange={e=>updateDraft(row,'batchId',e.target.value)}><option value="">暂不分批</option>{d.batchId && !activeBatches.some(b=>b.id===d.batchId) && <option value={d.batchId}>{row.batchNumber || '原批次'}（请重新选择今日批次）</option>}{activeBatches.map(b=><option key={b.id} value={b.id}>{b.sequence} 批 {b.name}</option>)}</select></label>
  </div>; }
  function quantitySummary(rows: FgRow[]) { const sums: Record<string,number> = {}; for (const row of rows) sums[row.unit] = (sums[row.unit] || 0) + (Number(draftFor(row).quantity) || 0); return Object.entries(sums).map(([unit,qty])=>`${num(qty)} ${unit}`).join(' / '); }
  function entryProblem(row: FgRow, receiving = false): string {
    if (receiving ? !canReceive(row) : !canShip(row)) return receiving ? '当前记录不能入库' : '当前记录不能批量发货';
    const quantity = Number(draftFor(row).quantity); const max = receiving ? row.pending : row.pending + row.available;
    if (!Number.isSafeInteger(quantity) || quantity <= 0) return '请填写正整数数量';
    if (quantity > max) return `本次数量超过${receiving ? '待入' : '可处理'} ${max}`;
    return '';
  }
  function feedback() { return <div role={error ? 'alert' : 'status'} className={`fg-notice ${error ? 'error' : ''}`}><span>{error || message}{retryOperation && <small>本次：{retryOperation.affected.map(r=>fgShortWorkOrder(r.workOrderCode)).join('、')}</small>}</span>{retryOperation && <button disabled={busy} onClick={()=>void execute({...retryOperation.input,waybillChecked:true},retryOperation.success,retryOperation.affected,retryOperation.keepDialog)}>已核对，继续本次操作</button>}<button aria-label="关闭提示" onClick={()=>{setError('');setMessage('');setRetryOperation(null);}}><X size={15}/></button></div>; }
  const dialogNeedsCheck = dialog && ['opening','stockAdd','return','scrap','adjust','unreceive','rework','reworkReturn','reworkScrap'].includes(dialog.kind);
  const bulkInvalid = dialog && ['batchShip','batchReceive'].includes(dialog.kind) && (!dialog.rows?.length || dialog.rows.some(r=>Boolean(entryProblem(r,dialog.kind==='batchReceive'))));

  return <main className={`fg-shell hm-workbench-root hm-workbench-navigation-overlay ${size === 16 ? 'fg-comfortable' : 'fg-compact'} ${continuous ? 'fg-continuous' : ''}`}>
    <AppWorkbenchHeader user={user} activeHref="/workspace/finished-goods" subtitle="接收、留库与统一出货" hideHeader sidebarTriggerTargetId="fg-nav-trigger" menuItems={[]} />
    <header className="fg-header">
      <h1>成品仓</h1>
      <nav aria-label="成品仓模块">{VIEWS.map(v => <button type="button" key={v.id} className={(v.id === 'history' ? isRecords : view === v.id) ? 'active' : ''} onClick={() => switchView(v.id)}>{v.label}</button>)}</nav>
      <span className="fg-user">{user.displayName || user.username}</span>
    </header>
    <div className="fg-status-bar">
      <section className="fg-tabs" aria-label="成品仓筛选">
        {isRecords ? [{ id: 'history', label: '出库记录' }, { id: 'receipts', label: '入库记录' }, { id: 'legacy', label: '历史默认已出' }].map(v => <button type="button" key={v.id} className={view === v.id ? 'active' : ''} onClick={() => switchView(v.id)}>{v.label}</button>) : <>
          {filters.map(f => <button type="button" key={f.id} title={f.id==='shipped' ? '查看每次实际出库记录' : undefined} className={filter === f.id ? 'active' : ''} onClick={() => { if(f.id==='shipped') { switchView('history'); return; } setFilter(f.id); setPage(1); }}>{f.label}<b>{data.counts[f.id] || 0}</b></button>)}
          {view !== 'stock' && data.counts.blocked > 0 && <button type="button" className={filter === 'blocked' ? 'active' : ''} onClick={() => { setFilter('blocked'); setPage(1); }}>异常<b>{data.counts.blocked}</b></button>}
        </>}
      </section>
      {!isRecords && Boolean(data.cutover?.closedCount) && <button className="fg-legacy-entry" title={`新仓自 ${timeText(data.cutover!.startedAt)} 启用，之前默认历史已出`} onClick={() => switchView('legacy')}><History size={14}/>历史已出 {data.cutover!.closedCount} 条<ChevronRight size={13}/></button>}
    </div>
    <section className="fg-toolbar">
      {initialSampleTaskId && <Link className="fg-link" href="/workspace/finished-goods">正在查看本次样品 · 查看全部 ↗</Link>}<label className="fg-search"><Search size={17}/><input aria-label="搜索工单、客户、规格" placeholder="工单 / 客户 / 规格" value={search} onChange={e => setSearch(e.target.value)}/>{search && <button onClick={() => setSearch('')} type="button" aria-label="清空搜索"><X size={14}/></button>}</label>
      {view !== 'legacy' && <select aria-label="日期筛选方式" value={dateBasis} onChange={e=>{setDateBasis(e.target.value);setScope('all');setDateTo('');setPage(1);}}><option value="event">收发日期</option><option value="production">现场完成日期</option></select>}
      {view !== 'legacy' && (dateBasis==='production' || view !== 'queue' || ['shipped','all'].includes(filter)) && <label className="fg-date-filter">{dateBasis==='production' ? '现场完成' : view === 'stock' || view === 'receipts' ? '入库日期' : '出库日期'}<input aria-label={dateBasis==='production' ? '现场完成开始日期' : view === 'stock' || view === 'receipts' ? '入库日期' : '出库日期'} title="待处理包含往日未完成记录" type="date" value={date} onChange={e => { setDate(e.target.value); if(dateTo && e.target.value > dateTo) setDateTo(''); setScope(dateBasis==='production' || view === 'stock' ? 'range' : 'day'); setPage(1); setBatchId(''); }}/></label>}
      {scope === 'all' && view !== 'legacy' && <button className="fg-scope" onClick={() => { setScope('day'); setPage(1); }}>全部日期<X size={12}/></button>}
      {!isRecords && view !== 'stock' && <label className="fg-work-batch">本轮批次<select aria-label="本轮出货批次" value={workingBatchId} onChange={e => { if (e.target.value === '__new') open('batch'); else setWorkingBatchId(e.target.value); }}><option value="">{activeBatches.length ? '未分批' : '暂无批次'}</option>{activeBatches.map(b => <option key={b.id} value={b.id}>{b.name || `${b.number.slice(-2)} 批`}</option>)}<option value="__new">＋ 新建本日批次</option></select></label>}
      {!isRecords && view !== 'stock' && <><button type="button" className={continuous ? 'fg-toggle active' : 'fg-toggle'} onClick={() => { setContinuous(c => !c); if (!activeId) setActiveId(data.rows.find(canShip)?.id || ''); }}><ClipboardList size={15}/>连续处理</button></>}
      {!isRecords && selectedRows.length > 0 && <><button disabled={!selectedReceiveRows.length || busy || loading} onClick={()=>open('batchReceive',undefined,selectedRows)}><ArrowDownToLine size={14}/>批量入库</button><button disabled={!selectedShipRows.length || busy || loading} onClick={()=>open('batchShip',undefined,selectedRows)} className="fg-primary"><Truck size={14}/>批量发货</button></>}
      <div className="fg-more-wrap"><button aria-label="更多仓库操作" type="button" onClick={() => setMore(v => !v)}><MoreHorizontal size={19}/></button>{more && <div className="fg-menu">
        <button onClick={() => open('batch')}><Plus size={14}/>新建出货批次</button>
        {!isRecords && <><button disabled={!selectedShipRows.length} onClick={applyWorkingBatch}>为所选设置本轮批次</button><button disabled={selectedShipRows.length < 2} onClick={() => open('merge', undefined, selectedShipRows)}><Layers3 size={14}/>合并待发记录</button><button onClick={() => open('stockAdd')}><Boxes size={14}/>登记实物库存</button></>}
        <button onClick={() => { setScope('all'); if(view==='queue') setFilter('all'); setPage(1); setMore(false); }}>查全部日期</button>
        {view !== 'legacy' && <label>日期范围至<input aria-label="结束日期" type="date" min={date} value={dateTo} onChange={e => { setDateTo(e.target.value); setScope('range'); setPage(1); }}/></label>}
        <label>完成日期排序<select aria-label="完成日期排序" value={sort} onChange={e=>{setSort(e.target.value);setPage(1);}}><option value="default">默认排序</option><option value="completed_asc">先完成的在前</option><option value="completed_desc">最近完成的在前</option></select></label>
        <label>出货方式<select aria-label="本轮出货方式" value={workingMethod} onChange={e=>setWorkingMethod(e.target.value)}>{Object.entries(METHODS).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><label>列表密度<select aria-label="列表密度" value={size} onChange={e => { setSize(Number(e.target.value)); setPage(1); }}><option value={24}>紧凑 · 24 条</option><option value={16}>舒适 · 16 条</option><option value={48}>紧凑 · 48 条</option></select></label>
        <label>筛选批次<select aria-label="筛选出货批次" value={batchId} onChange={e => { setBatchId(e.target.value); setPage(1); }}><option value="">全部批次</option>{data.batches.map(b => <option key={b.id} value={b.id}>{b.number.slice(-2)} 批 {b.name}</option>)}</select></label>
        <a href={`/api/finished-goods/export?${params()}`}><Download size={14}/>导出当前筛选 Excel</a>
        {canAccessAppRoute(user.access,'/workspace/daily-plans') && <Link href="/workspace/daily-plans">日出货计划<ArrowRight size={13}/></Link>}
        <button onClick={() => { setRefresh(r => r + 1); setMore(false); }}><RefreshCw size={14}/>刷新数据</button>
      </div>}</div>
    </section>
    {view === 'stock' && <div className="fg-metrics"><span>待入库不计入在库 · 在库包含留库、占用和隔离 · 已出按来源货批累计</span>{data.stats.holdDue > 0 && <button onClick={() => setFilter('held')}>留库到期 {data.stats.holdDue} 条</button>}</div>}
    {view === 'legacy' && <p className="fg-history-note">{timeText(data.cutover?.startedAt || null)} 启用前的结余，按约定默认历史已出。实际出货时间未知；不计入当日实发，不重复扣减库存。</p>}
    {(error || message) && !dialog && feedback()}
    {view === 'batches' && <div className="fg-batch-strip">{data.batches.map(b => <div key={b.id} className={batchId === b.id ? 'active' : ''}><button onClick={() => { setBatchId(batchId === b.id ? '' : b.id); setPage(1); }}><strong>{b.sequence.toString().padStart(2,'0')} 批 {b.name}</strong><span>{b.shipped} 条已出 · {Object.entries(b.quantities).map(([unit,quantity])=>`${num(quantity)} ${unit}`).join(' / ')}</span>{b.draft>0 && <small>{b.draft} 条待发，不计入实发</small>}</button>{b.closedAt ? <small>已封批</small> : <button className="fg-link" disabled={busy} onClick={() => void execute({ action:'CLOSE_BATCH', batchId:b.id },'该批次已封批')}>封批</button>}</div>)}<button className="fg-batch-new" onClick={() => open('batch')}><Plus size={16}/>新批次</button></div>}
    <section className="fg-table-scroll" aria-label="成品与出货明细" aria-busy={loading}>
      <table className="fg-table"><colgroup>{['select','order','customer','spec','pending','stock','shipped','process','completed','received','dispatched','status','actions'].map(name=><col key={name} className={`fg-col-${name}`}/>)}</colgroup>
        <thead><tr><th><input aria-label="全选本页可处理记录" type="checkbox" disabled={!selectableRows.length || busy || loading} checked={Boolean(selectableRows.length) && selectableRows.every(r => selected.includes(r.id))} onChange={e => setSelected(e.target.checked ? selectableRows.map(r => r.id) : [])}/></th><th>工单</th><th>客户</th><th>规格</th><th>待入库</th><th>在库数量</th><th title="本来源货批累计有效出库，不限查询日期；退货另行记录">已出数量</th><th>{view==='receipts' ? '本次入库' : view==='legacy' ? '历史结清' : view==='history' || filter==='shipped' ? '本次出库' : '本次处理'}</th><th title="生产登记的实际完成日期；点击查看登记及转入时间">现场完成日期</th><th>入库时间</th><th>出库时间</th><th>状态</th><th>操作</th></tr></thead>
        <tbody>{data.rows.map((row,index) => {
          const d = draftFor(row); const sent = row.status === 'shipped'; const actionable = isActionable(row); const legacy = row.status === 'legacy'; const readOnly = legacy || row.status === 'received';
          const groupStart = view === 'batches' && (index === 0 || data.rows[index-1].batchId !== row.batchId);
          const incomingTime = row.status==='received' ? row.receivedAt : row.lastReceivedAt;
          const outgoingTime = sent ? row.shippedAt : row.lastShippedAt;
          const partial = !readOnly && !sent && row.shippedQuantity>0;
          const statusText = partial && row.status==='ready' ? '部分出库' : STATUS[row.status];
          const receiveFirst = Number(d.quantity)>row.available && row.status!=='reserved';
          return <Fragment key={row.id}>
            {groupStart && <tr className="fg-group"><td colSpan={13}><Layers3 size={13}/>{row.batchNumber ? `${row.batchNumber.slice(-2)} 批` : '未分批'}<span>{data.batches.find(b => b.id === row.batchId)?.name}</span></td></tr>}
            <tr data-fg-row={row.id} className={`${activeId === row.id ? 'active' : ''} ${selected.includes(row.id) ? 'selected' : ''}`} onClick={e => { if (!(e.target as HTMLElement).closest('input,button,select,a')) activate(row); }}>
              <td>{canSelect(row) && <input type="checkbox" aria-label={`选择 ${row.workOrderCode}`} disabled={loading || busy} checked={selected.includes(row.id)} onChange={e => setSelected(prev => e.target.checked ? [...new Set([...prev,row.id])] : prev.filter(id => id !== row.id))}/>}</td>
              <td><button type="button" className="fg-identity" title={row.workOrderCode} onClick={() => open('detail',row)}>{fgShortWorkOrder(row.workOrderCode)}</button></td>
              <td title={row.customerName || '公共备货'}>{row.customerName || <span className="fg-public">公共备货</span>}</td>
              <td className="fg-spec-cell"><button className="fg-specification" onClick={() => open('detail',row)}>{row.specification || '未填写规格'}</button>{row.sampleTaskId && <small className="fg-sample-note">样品完成 · {row.sourceKind === 'SAMPLE_REPEAT' ? '老产品' : row.sourceKind === 'SAMPLE_NEW' ? '新品' : '样品流转'}</small>}</td>
              <td className="fg-quantity"><button onClick={()=>open('detail',row)} title={`待入库 ${row.pending} ${row.unit}，尚未计入在库`}>{legacy ? '—' : num(row.pending)}</button></td>
              <td className="fg-quantity"><button onClick={()=>open('detail',row)} title={`在库 ${row.onHand} ${row.unit}；可发 ${row.blockedReason || row.openingReview ? 0 : row.available} · 留库 ${row.held} · 占用 ${row.reserved} · 隔离 ${row.blocked}`}>{legacy ? '—' : num(row.onHand)}{!legacy && row.onHand>0 && (row.available!==row.onHand || row.blockedReason) && <small>可发 {num(row.blockedReason ? 0 : row.available)}</small>}</button></td>
              <td className="fg-quantity"><button onClick={()=>open('detail',row)} title={`本货批累计有效出库 ${row.shippedQuantity} ${row.unit}，退货另记`}>{legacy ? '—' : num(row.shippedQuantity)}</button></td>
              <td>{sent || readOnly ? <span className="fg-num" title={sent ? '本条出库记录数量' : ''}>{isRecords || view==='batches' || filter==='shipped' ? num(row.quantity) : '—'}{row.returned > 0 && <small> / 退{row.returned}</small>}</span> : !actionable && row.status !== 'reserved' ? '—' : <div className="fg-process-quantity"><input type="number" aria-label={`${row.workOrderCode} 本次处理数量`} title="Enter 保存数量，发货需单独确认" min="1" step="1" className="fg-inline-number" value={d.quantity} readOnly={row.status === 'reserved' || row.shipmentLineCount > 1 || busy} onFocus={() => activate(row)} onChange={e => updateDraft(row,'quantity',e.target.value)} onKeyDown={e => { nextCell(e); if (e.key === 'Enter') { e.preventDefault(); void save(row); } if (e.key === 'Escape') resetField(row,'quantity'); }}/>{savedRowId===row.id && <Check size={12} className="fg-saved" aria-label="数量已保存"/>}</div>}<small className="fg-unit">{row.unit}</small></td>
              <td className="fg-time"><button className="fg-completed-date" onClick={()=>open('detail',row)} title={row.productionWorkDate ? `现场完成 ${row.productionWorkDate}；登记 ${timeText(row.productionCompletedAt || null)}；转入待入库 ${timeText(row.transferredAt || null)}` : '原记录没有可核实的生产完成日期'}>{row.productionWorkDate || <span className="fg-muted">未记录</span>}</button></td>
              <td className="fg-time" title={incomingTime ? `${row.status==='received' ? '本次' : '最近'}入库 ${timeText(incomingTime)}${row.receiptCount>1 ? `；共 ${row.receiptCount} 次，点击数量查看流水` : ''}` : legacy ? '历史入库时间未知' : '实物尚未入库'}>{legacy ? '未知' : incomingTime ? fgCompactTime(incomingTime) : '未入库'}</td>
              <td className="fg-time" title={outgoingTime ? `${sent ? '本次' : '最近'}出库 ${timeText(outgoingTime)}` : legacy ? '历史实际出库时间未知' : '尚未实际发货'}>{legacy ? '未知' : fgCompactTime(outgoingTime)}</td>
              <td><button className={`fg-status ${row.status} ${partial ? 'partial' : ''}`} title={row.blockedReason || row.holdReason || statusText} onClick={() => open('detail',row)}><i/>{statusText}</button>{row.holdDueDate && row.holdDueDate <= data.workDate && row.held > 0 && <span className="fg-due" title="留库到期，需手动释放">到期</span>}</td>
              <td><div className="fg-actions">{sent || readOnly ? <button onClick={()=>open('detail',row)}>查看</button> : <>
                {row.ownerType==='CUSTOMER' && (actionable || row.status==='reserved') ? <button disabled={busy || loading} onClick={()=>open('ship',row)}>{receiveFirst ? '入库并发货' : '发货'}</button> : row.ownerType==='PUBLIC' && row.available>0 ? <button disabled={busy || loading} onClick={()=>open('allocate',row)}>分配客户</button> : row.status==='held' ? <button disabled={busy || loading} onClick={()=>open('release',row)}>解除留库</button> : !canReceive(row) && <button onClick={()=>open('detail',row)}>查看原因</button>}
                {canReceive(row) ? <button className="fg-secondary" disabled={busy || loading} onClick={()=>open('receive',row)}>仅入库</button> : actionable && row.available>0 && !row.shipmentId ? <button className="fg-secondary" disabled={busy || loading} onClick={()=>open('hold',row)}>留库</button> : null}
                <button aria-label={`${row.workOrderCode} 更多操作`} className="fg-row-more" onClick={()=>open('detail',row)}><MoreHorizontal size={14}/></button>
              </>}</div></td>
            </tr>
          </Fragment>;
        })}</tbody>
      </table>
      {!data.rows.length && <div className="fg-empty"><Boxes size={38}/><h2>{search || filter !== 'all' || batchId ? '当前筛选没有记录' : view === 'legacy' ? '没有历史结清记录' : '等待生产执行转入成品'}</h2><p>{view === 'legacy' ? '启用前的已有结余按约定默认历史已出。' : '新完工记录自动进入待入库，可入库或入库并发货。'}</p>{search && <button onClick={()=>{setScope('all');setFilter('all');setPage(1);}}>查全部日期</button>}</div>}
    </section>
    {continuous && <section className="fg-dock" aria-label="连续处理">{active && current && ['ready','pending','reserved'].includes(active.status) ? <>
      <div className="fg-dock-identity"><small>当前 · {active.customerName || '公共备货'}</small><strong title={active.workOrderCode}>{fgShortWorkOrder(active.workOrderCode)}</strong><span>{active.specification}</span></div>
      <label>本次数量<input type="number" min="1" value={current.quantity} disabled={active.status === 'reserved' || active.shipmentLineCount > 1} onChange={e=>updateDraft(active,'quantity',e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();void save(active);}}}/></label>
      <label>出货方式<select value={current.method} onChange={e=>updateDraft(active,'method',e.target.value)}>{Object.entries(METHODS).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
      <span className="fg-dock-hint">确认即记录实物交接</span>
      <button className="fg-primary" disabled={busy || loading || active.ownerType==='PUBLIC'} onClick={()=>open('ship',active)}>{busy ? '正在处理…' : active.status==='pending' ? '确认入库并发货 · 下一条' : '确认发货 · 下一条'}<ArrowRight size={16}/></button>
    </> : <div className="fg-dock-empty"><ClipboardList size={19}/><span>点击一条待入库或待发货记录，连续处理。</span></div>}</section>}
    <footer className="fg-footer"><span>已选 <b>{selectedRows.length}</b> 条{selectedRows.length > 0 && <> · <b>{quantitySummary(selectedRows)}</b></>}</span><span className="fg-footer-tip">Tab 下一格 · Enter 保存数量，发货需确认</span>{Object.keys(drafts).length > 0 && <span className="fg-unsaved">{Object.keys(drafts).length} 条待保存</span>}<span className="fg-pagination">{data.total ? (data.page-1)*data.pageSize+1 : 0}–{Math.min(data.page*data.pageSize,data.total)} / {data.total} 条</span><button aria-label="上一页" disabled={data.page <= 1 || loading} onClick={() => setPage(n => n-1)}><ChevronLeft size={16}/></button><button className="fg-primary" aria-label={`当前第 ${data.page} 页`}>{data.page}</button><button aria-label="下一页" disabled={data.page*data.pageSize >= data.total || loading} onClick={() => setPage(n => n+1)}><ChevronRight size={16}/></button></footer>
    {dialog && <div className={`fg-dialog-overlay ${dialog.kind==='detail' ? 'fg-detail-overlay' : ''}`}><section className={`fg-dialog ${dialog.kind==='detail' ? 'fg-detail' : ''}`} role="dialog" aria-modal="true" aria-label={titleFor[dialog.kind]}>
      <header><div><small>{dialog.row ? fgShortWorkOrder(dialog.row.workOrderCode) : '成品仓'}</small><h2>{dialog.kind==='ship' && dialog.row?.status==='pending' ? '入库并发货' : titleFor[dialog.kind]}</h2></div><button type="button" disabled={busy} aria-label="关闭窗口" onClick={()=>setDialog(null)}><X size={21}/></button></header>
      <div className="fg-dialog-body">{error && feedback()}
      {dialog.row && <div className="fg-dialog-identity"><strong>{dialog.row.specification || '未填写规格'}</strong><span>{dialog.row.customerName || '公共备货'} · {dialog.row.status==='ready' && dialog.row.shippedQuantity>0 ? '部分出库' : STATUS[dialog.row.status]}</span><small>{dialog.row.productName}</small><div className="fg-stock-summary">{dialog.row.legacyClosedAt ? <span>历史结清 <b>{num(dialog.row.legacyQuantity)}</b> {dialog.row.unit}</span> : <><span>待入 <b>{num(dialog.row.pending)}</b></span><span>在库 <b>{num(dialog.row.onHand)}</b></span><span>已出 <b>{num(dialog.row.shippedQuantity)}</b></span><span>可发 <b>{num(dialog.row.blockedReason ? 0 : dialog.row.available)}</b></span>{dialog.row.held>0 && <span>留库 <b>{num(dialog.row.held)}</b></span>}{dialog.row.reserved>0 && <span>占用 <b>{num(dialog.row.reserved)}</b></span>}{dialog.row.blocked>0 && <span>隔离 <b>{num(dialog.row.blocked)}</b></span>}</>}</div></div>}
      {dialog.kind==='ship' && dialog.row && <>
        <p className="fg-ship-explanation">{Number(draftFor(dialog.row).quantity)>dialog.row.available && dialog.row.status!=='reserved' ? `本次将入库并发出差额 ${Math.max(0,Number(draftFor(dialog.row).quantity)-dialog.row.available)} ${dialog.row.unit}；其余待入数量保持待入库。` : '确认后记录实际出库时间，未发出的库存继续保留。'}</p>
        {shippingForm(dialog.row)}
        {dialog.row.shipmentLineCount>1 && <div className="fg-callout">本次发出整组记录：{detail?.shipment?.lines.map(l=>`${l.lot.workOrderCode} × ${l.quantity}`).join('，') || '正在加载明细…'}</div>}
      </>}
      {['batchShip','batchReceive'].includes(dialog.kind) && <>
        <p>本次 {dialog.rows?.length || 0} 条，共 {quantitySummary(dialog.rows || [])}。{dialog.kind==='batchShip' ? '各条按自己的数量发货。' : '只登记实物入库，不发货。'}</p>
        {dialog.rows?.map(r=>{const problem=entryProblem(r,dialog.kind==='batchReceive');return <div className={`fg-bulk-entry ${problem ? 'invalid' : ''}`} key={r.id}><div><strong>{fgShortWorkOrder(r.workOrderCode)} · {r.customerName || '公共备货'}</strong><small>{r.specification}{problem ? ` · ${problem}` : ''}</small></div><label>数量<input aria-label={`${r.workOrderCode} 批量数量`} type="number" min="1" value={draftFor(r).quantity} onChange={e=>updateDraft(r,'quantity',e.target.value)}/></label><button aria-label={`移出 ${r.workOrderCode}`} onClick={()=>setDialog(prev=>prev ? {...prev,rows:prev.rows?.filter(item=>item.id!==r.id)} : null)}><X size={14}/></button></div>;})}
        {bulkInvalid && <p className="fg-field-error">请修正数量或移出不符合条件的记录后再提交。</p>}
      </>}
      {dialog.kind==='merge' && <><p>仅同客户可合并；使用第一条的出货方式和批次。已有待发记录需先取消，库存占用会同步释放。</p>{dialog.rows?.map(r=><div className="fg-bulk-entry" key={r.id}><strong>{fgShortWorkOrder(r.workOrderCode)} · {r.customerName}</strong><span>{draftFor(r).quantity} {r.unit}</span></div>)}</>}
      {!['ship','batchShip','batchReceive','detail','merge'].includes(dialog.kind) && <div className="fg-form-grid">
        {dialog.kind==='batch' ? <>{formField('批次日期','date','date')}{formField('批次名称','name','text','例如：上午第一批')}{formField('备注（可选）','note')}</> : <>
          {dialog.kind==='stockAdd' && <><label>库存归属<select value={form.ownerType} onChange={e=>setForm(f=>({...f,ownerType:e.target.value}))}><option value="PUBLIC">公共备货</option><option value="CUSTOMER">客户专属</option></select></label>{formField('客户（专属库存必填）','customerName')}{formField('产品名称','productName')}{formField('规格 / 图号','specification')}{formField('来源单号','workOrderCode')}{formField('库位','location')}</>}
          {dialog.kind!=='move' && formField(dialog.kind==='opening' ? '实际数量（允许为 0）' : '本次数量','quantity','number')}
          {['hold','receiveHold'].includes(dialog.kind) && <>{formField('预计释放日期（可选）','dueDate','date')}<div className="fg-reason-options fg-span-2">{['备货','客户暂缓','等待凑批'].map(reason=><button key={reason} className={form.reason===reason ? 'active' : ''} onClick={()=>setForm(f=>({...f,reason}))}>{reason}</button>)}</div></>}
          {['move','return','reworkReturn'].includes(dialog.kind) && formField('库位','location')}
          {dialog.kind==='allocate' && formField('分配客户','customerName')}
          {['scrap','adjust','rework'].includes(dialog.kind) && <label>扣减库存<select value={form.bucket} onChange={e=>setForm(f=>({...f,bucket:e.target.value}))}><option value="available">可用库存</option><option value="blocked">隔离库存</option></select></label>}
          {dialog.kind==='rework' && formField('返工去向 / 关联返工单号','destination')}
          {['reworkReturn','reworkScrap'].includes(dialog.kind) && <label>原返工转出<select value={form.reworkId} onChange={e=>setForm(f=>({...f,reworkId:e.target.value}))}><option value="">选择返工记录</option>{detail?.lot.reworks.filter(r=>r.quantity-r.returned-r.scrapped>0).map(r=><option key={r.id} value={r.id}>{r.destination} · 在外 {r.quantity-r.returned-r.scrapped} 件</option>)}</select></label>}
          {dialog.kind==='receive' ? <details className="fg-extra-fields fg-span-2"><summary>入库备注（可选）</summary><label>备注<textarea rows={2} value={form.reason || ''} onChange={e=>setForm(f=>({...f,reason:e.target.value}))}/></label></details> : <label className="fg-span-2">{['hold','receiveHold'].includes(dialog.kind) ? '留库原因' : '原因 / 来源说明'}<textarea rows={2} value={form.reason || ''} onChange={e=>setForm(f=>({...f,reason:e.target.value}))}/></label>}
          {dialog.kind==='opening' && <p className="fg-span-2 fg-muted">以点收实物为准，差异保留在库存流水中。</p>}
          {['return','reworkReturn'].includes(dialog.kind) && <p className="fg-span-2 fg-muted">实物先进入隔离库存，核实后再解除隔离。</p>}
          {dialog.kind==='receive' && <p className="fg-span-2 fg-muted">确认后只增加实物库存，不会发货。</p>}
        </>}
      </div>}
      {dialog.kind==='detail' && dialog.row && <>
        <p className="fg-muted">{dialog.row.legacyClosedAt ? `历史结清 ${num(dialog.row.legacyQuantity)} ${dialog.row.unit}；实际入库、出库数量未记录，不补造历史流水。` : `数量单位：${dialog.row.unit} · 本来源货批累计入库 ${num(dialog.row.receivedQuantity)}（已扣撤销入库）；累计出库 ${num(dialog.row.shippedQuantity)}，退货另行记录。待入库不计入在库，留库、占用和隔离仍计入在库。`}</p>
        <div className="fg-detail-tools fg-main-actions">
          {canReceive(dialog.row) && <button className="fg-primary" onClick={()=>open('receive',dialog.row)}><ArrowDownToLine size={15}/>入库</button>}
          {((isActionable(dialog.row) && dialog.row.ownerType==='CUSTOMER') || dialog.row.status==='reserved') && <button className={canReceive(dialog.row) ? '' : 'fg-primary'} onClick={()=>open('ship',dialog.row)}><Truck size={15}/>{dialog.row.status==='pending' ? '入库并发货' : '发货'}</button>}
          {dialog.row.status==='held' && <button className="fg-primary" onClick={()=>open('release',dialog.row)}>释放留库</button>}
          {dialog.row.ownerType==='PUBLIC' && dialog.row.available>0 && !dialog.row.legacyClosedAt && <button className="fg-primary" onClick={()=>open('allocate',dialog.row)}>分配客户</button>}
          {!['legacy','received'].includes(dialog.row.status) && <button aria-expanded={detailMore} onClick={()=>setDetailMore(value=>!value)}><MoreHorizontal size={15}/>更多操作</button>}
        </div>
        {detailMore && <div className="fg-secondary-actions">
          {!dialog.row.legacyClosedAt && dialog.row.status!=='shipped' && <>
            {canReceive(dialog.row) && <button onClick={()=>open('receiveHold',dialog.row)}>入库并留库</button>}
            {dialog.row.openingReview && <button onClick={()=>open('opening',dialog.row)}>期初核对</button>}
            {dialog.row.available>0 && <button onClick={()=>open('hold',dialog.row)}><Pause size={14}/>留库</button>}
            {dialog.row.held>0 && <button onClick={()=>open('release',dialog.row)}>释放留库</button>}
            {dialog.row.available+dialog.row.held+dialog.row.reserved+dialog.row.blocked>0 && <button onClick={()=>open('move',dialog.row)}>移库</button>}
            {dialog.row.available>0 && <button onClick={()=>open('block',dialog.row)}>隔离</button>}
            {dialog.row.blocked>0 && <button onClick={()=>open('unblock',dialog.row)}>解除隔离</button>}
            {dialog.row.available+dialog.row.blocked>0 && <><button onClick={()=>open('rework',dialog.row)}>返工转出</button><button onClick={()=>open('scrap',dialog.row)}>报废出库</button><button onClick={()=>open('adjust',dialog.row)}>盘亏登记</button></>}
            {detail?.lot.reworks.some(r=>r.quantity-r.returned-r.scrapped>0) && <><button onClick={()=>open('reworkReturn',dialog.row)}>返工回库</button><button onClick={()=>open('reworkScrap',dialog.row)}>返工报废</button></>}
            {dialog.row.sourceKind==='PRODUCTION' && dialog.row.available>0 && <button onClick={()=>open('unreceive',dialog.row)}>撤销入库</button>}
            {dialog.row.shipmentId && <>
              {dialog.row.status==='reserved' ? <button disabled={busy} onClick={()=>void execute({action:'UNRESERVE',shipmentId:dialog.row!.shipmentId,shipmentVersion:dialog.row!.shipmentVersion},'库存占用已释放',[dialog.row!])}>释放占用</button> : <button disabled={busy} onClick={()=>void execute({action:'RESERVE',shipmentId:dialog.row!.shipmentId,shipmentVersion:dialog.row!.shipmentVersion},'库存已占用',[dialog.row!])}>占用库存</button>}
              <button disabled={busy} onClick={()=>void execute({action:'CANCEL_DRAFT',shipmentId:dialog.row!.shipmentId,shipmentVersion:dialog.row!.shipmentVersion},'待发记录已取消',[dialog.row!])}>取消待发记录</button>
            </>}
          </>}
          {dialog.row.status==='shipped' && <button onClick={()=>open('return',dialog.row)}>登记退货</button>}
        </div>}
        <div className="fg-detail-times"><span>现场完成日期 <b>{dialog.row.productionWorkDate || '未记录'}</b></span><span>完成登记时间 <b>{timeText(dialog.row.productionCompletedAt || null)}</b></span><span>转入待入库 <b>{timeText(dialog.row.transferredAt || null)}</b></span><span>{dialog.row.sampleTaskId ? '样品任务' : '完整工单'} <b>{dialog.row.workOrderCode}</b><button className="fg-link" onClick={()=>void copyText(dialog.row!.workOrderCode)}><Copy size={13}/>复制</button></span><span>{dialog.row.status==='received' ? '本次入库' : '首次入库'} <b>{timeText(dialog.row.receivedAt)}</b></span>{dialog.row.receiptCount>1 && <span>最近入库 <b>{timeText(dialog.row.lastReceivedAt)}</b> · {dialog.row.receiptCount} 次</span>}{dialog.row.lastShippedAt && <span>{dialog.row.status==='shipped' ? '本次出库' : '最近出库'} <b>{timeText(dialog.row.status==='shipped' ? dialog.row.shippedAt : dialog.row.lastShippedAt)}</b></span>}<span>来源备注 <b>{dialog.row.note || '—'}</b>{dialog.row.sampleTaskId && <Link className="fg-link" href={`/weekly-plan-center?branch=samples&taskId=${dialog.row.sampleTaskId}`}>查看样品任务 ↗</Link>}</span><span>库位 <b>{dialog.row.location || '未设置'}</b></span></div>
        {dialog.row.status==='legacy' && <p className="fg-callout">启用前已默认结清，结清于 {timeText(dialog.row.legacyClosedAt)}；实际出库时间未知。</p>}
        {dialog.row.blockedReason && <p className="fg-callout"><AlertCircle size={15}/>{dialog.row.blockedReason}，处理来源后才能发货。</p>}
        {(!dialog.row.legacyClosedAt || dialog.row.status==='shipped') && dialog.row.ownerType==='CUSTOMER' && (dialog.row.shipmentId || isActionable(dialog.row)) && <section className="fg-detail-section"><h3>{dialog.row.status==='shipped' ? '本次出库' : '待发信息'}</h3>{dialog.row.shipmentId && <p className="fg-record-summary">{dialog.row.shipmentNumber} · {dialog.row.quantity} {dialog.row.unit} · {METHODS[draftFor(dialog.row).method]}</p>}<div className="fg-form-grid">{shipmentFields(dialog.row)}</div><p className="fg-muted">{dialog.row.status==='shipped' ? '更新备注不改变出库时间和库存。' : '保存信息不扣库存，发货需单独确认。'}</p></section>}
        {dialog.row.shipmentId && <details className="fg-extra-fields fg-detail-section"><summary>出货凭证（可选）</summary><label className="fg-upload"><Plus size={15}/>添加照片或 PDF<input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" disabled={busy} onChange={e=>void upload(dialog.row!,e.target.files?.[0])}/></label><div className="fg-attachment-list">{detail?.shipment?.attachments.map(a=><div key={a.id}><a target="_blank" rel="noreferrer" href={`/api/finished-goods/attachments?id=${a.id}`}><FileText size={15}/>{a.originalName}</a><a href={`/api/finished-goods/attachments?id=${a.id}&download=1`} title="下载"><Download size={14}/></a><button aria-label={`移除 ${a.originalName}`} onClick={()=>void removeAttachment(a.id,dialog.row!)}><X size={14}/></button></div>)}</div></details>}
        <section className="fg-detail-section"><h3><History size={15}/>收发流水</h3>{!detail ? <p className="fg-muted">正在加载…</p> : detail.lot.ledger.length ? <ol className="fg-ledger">{detail.lot.ledger.map(l=><li key={l.id}><span className="fg-ledger-dot"/><div><strong>{FG_KINDS[l.kind] || (l.kind==='LOGISTICS' ? '出库信息更新' : l.kind)} <b>{l.quantity ? `${['ADJUST','SOURCE_CORRECTION'].includes(l.kind) ? l.quantity : Math.abs(l.quantity)} ${dialog.row!.unit}` : ''}</b></strong>{l.reason && <p>{l.reason}</p>}<small>{timeText(l.createdAt)} · {l.actorName}</small></div></li>)}</ol> : <p className="fg-muted">尚无实物收发记录。</p>}</section>
        {Boolean(detail?.lot.lines.length) && <details className="fg-extra-fields fg-detail-section"><summary>关联出库记录</summary>{detail?.lot.lines.map(l=><div className="fg-related-record" key={l.id}><strong>{l.shipment.number}</strong><span>{l.quantity} {dialog.row!.unit} · {l.shipment.status==='SHIPPED' ? '已出库' : l.shipment.status==='CANCELLED' ? '已取消' : '待发货'}{l.returned>0 && ` · 退回 ${l.returned}`}</span><small>{timeText(l.shipment.shippedAt)}</small></div>)}<button className="fg-link" onClick={()=>{switchView('history');setScope('all');setSearch(dialog.row!.workOrderCode);setDialog(null);}}>查询该工单全部出库记录<ArrowRight size={13}/></button></details>}
        {dialog.row.workOrderId && <Link className="fg-source-link" href={`/production?workOrderId=${encodeURIComponent(dialog.row.workOrderId)}`}>查看生产来源<ArrowRight size={13}/></Link>}
      </>}
      </div>
      <footer>{dialog.kind==='detail' ? <><button disabled={busy} onClick={()=>setDialog(null)}>关闭</button>{dialog.row && (!dialog.row.legacyClosedAt || dialog.row.status==='shipped') && dialog.row.ownerType==='CUSTOMER' && (dialog.row.shipmentId || isActionable(dialog.row)) && <button className="fg-primary" disabled={busy} onClick={()=>void save(dialog.row!)}>保存备注与关联单据</button>}</> : <>
        {dialogNeedsCheck && <label className="fg-check"><input type="checkbox" checked={checked} onChange={e=>setChecked(e.target.checked)}/>实物数量已核对</label>}
        <button onClick={()=>setDialog(null)} disabled={busy}>取消</button>
        <button className="fg-primary" disabled={busy || Boolean(dialogNeedsCheck && !checked) || Boolean(bulkInvalid) || (dialog.kind==='ship' && (dialog.row?.shipmentLineCount || 0)>1 && !detail?.shipment) || (dialog.kind==='merge' && dialog.rows?.some(r=>Boolean(r.shipmentId)))} onClick={()=>void submitDialog()}>{busy ? '正在处理…' : dialog.kind==='ship' ? dialog.row?.status==='pending' ? '确认入库并发货' : '确认发货' : dialog.kind==='batchShip' ? '确认批量发货' : dialog.kind==='receive' || dialog.kind==='batchReceive' ? '确认入库' : dialog.kind==='receiveHold' ? '确认入库并留库' : '确认保存'}</button>
      </>}</footer>
    </section></div>}
  </main>;
}
