'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Clock3, History, PackageCheck, Plus, RefreshCw, Search, Warehouse, X } from 'lucide-react';
import { AppWorkbenchHeader } from '@/components/layout/AppWorkbenchHeader';
import { ModuleModeDrawer, ModuleModeTrigger, useModuleModeDrawer } from '@/components/layout/ModuleModeDrawer';
import { useModalLayer } from '@/components/useModalLayer';
import { useToastBridge } from '@/components/ToastProvider';
import { materialExceptionLabel, materialSourceText, type MaterialSource } from '@/lib/material-source';
import { warehouseWorkbenchPath, warehouseWorkbenchStateFromSearch } from '@/lib/warehouse-navigation';
import type { CurrentUserDTO, IssueUserDTO, WarehouseMaterialTaskDTO, WarehouseMaterialExceptionCaseDTO, WarehouseExceptionType, WarehouseWeekOptionDTO } from '@/types';
import './material/MaterialWorkbench.css';
import './material/WarehouseMaterial.css';

type Payload = { tasks: WarehouseMaterialTaskDTO[]; summary: { total: number; pending: number; completed: number; exception: number; expectedOverdue: number }; weeks: WarehouseWeekOptionDTO[]; pagination: { total: number; totalPages: number }; error?: string };
type Edit = { kind: 'edit' | 'resolve' | 'reopen'; event?: WarehouseMaterialExceptionCaseDTO };
type Form = { exceptionType: WarehouseExceptionType; supplySource: MaterialSource; exceptionNote: string; materialModel: string; shortageQuantity: string; unit: string; ownerId: string; note: string; resolution: string };
const blank = (event?: WarehouseMaterialExceptionCaseDTO): Form => ({ exceptionType: event?.exceptionType || 'shortage', supplySource: event?.supplySource || 'UNKNOWN', exceptionNote: event?.exceptionNote || '', materialModel: event?.materialModel || '', shortageQuantity: event?.shortageQuantity == null ? '' : String(event.shortageQuantity), unit: event?.unit || '个', ownerId: event?.owner?.id || '', note: '', resolution: 'pending' });
const time = (value?: string | null) => value ? new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : '待确认';
const types: WarehouseExceptionType[] = ['wrong_material', 'insufficient_quantity', 'quality_issue', 'other'];
const followUpPhase = (status?: WarehouseMaterialExceptionCaseDTO['followUpStatus']) => ({ PENDING: '待接收', IN_PROGRESS: '跟进中', WAITING_ARRIVAL: '等待到料', WAITING_WAREHOUSE: '待仓库确认', RESOLVED: '已解决', CANCELLED: '已取消' } as Record<NonNullable<WarehouseMaterialExceptionCaseDTO['followUpStatus']>, string>)[status || 'PENDING'];
const exceptionTitle = (event: WarehouseMaterialExceptionCaseDTO) => event.exceptionType === 'shortage' && event.supplySource && event.supplySource !== 'UNKNOWN' ? `${materialSourceText[event.supplySource]}缺料` : event.exceptionTypeText;
const needsMaterialIdentity = (exceptionType: WarehouseExceptionType) => exceptionType === 'shortage' || exceptionType === 'insufficient_quantity';

export default function WarehouseManagementShell({ user, modeDrawerInitiallyOpen = false }: { user: CurrentUserDTO; modeDrawerInitiallyOpen?: boolean }) {
  const modeDrawer = useModuleModeDrawer(modeDrawerInitiallyOpen);
  const [scope, setScope] = useState('current'); const [week, setWeek] = useState('');
  const [status, setStatus] = useState('pending'); const [source, setSource] = useState('ALL'); const [overdue, setOverdue] = useState(false);
  const [search, setSearch] = useState(''); const [query, setQuery] = useState(''); const [page, setPage] = useState(1);
  const [data, setData] = useState<Payload | null>(null); const [selectedId, setSelectedId] = useState('');
  const [task, setTask] = useState<WarehouseMaterialTaskDTO | null>(null); const [loading, setLoading] = useState(false); const [detailLoading, setDetailLoading] = useState(false);
  const [refresh, setRefresh] = useState(0); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [toast, setToast] = useState('');
  const [edit, setEdit] = useState<Edit | null>(null); const [form, setForm] = useState<Form>(() => blank()); const [users, setUsers] = useState<IssueUserDTO[]>([]);
  const [history, setHistory] = useState(false); const [urlReady, setUrlReady] = useState(false); const deepLink = useRef(''); const mainRef = useRef<HTMLElement>(null); const dialogRef = useRef<HTMLElement>(null); const triggerRef = useRef<HTMLElement | null>(null);
  const canConfirm = user.access.capabilities.includes('WAREHOUSE:UPDATE'); const canReport = canConfirm || user.access.capabilities.includes('PROCUREMENT:UPDATE');
  useToastBridge(toast, setToast); useToastBridge(error, setError);
  useModalLayer({ open: !!edit, layerRef: dialogRef, backgroundRef: mainRef, triggerRef, onClose: () => { if (!busy) setEdit(null); } });
  useEffect(() => {
    const initial = warehouseWorkbenchStateFromSearch(location.search);
    if (initial.taskId) { deepLink.current = initial.taskId; setSelectedId(initial.taskId); }
    setScope(initial.scope); setWeek(initial.week); setStatus(initial.status); setSource(initial.source);
    setOverdue(initial.overdue); setSearch(initial.query); setQuery(initial.query); setPage(initial.page);
    setUrlReady(true);
  }, []);
  useEffect(() => {
    if (!urlReady) return;
    const path = warehouseWorkbenchPath({ taskId: selectedId, scope: scope as 'current' | 'preparation' | 'history', week, status: status as 'all' | 'pending' | 'exception' | 'completed', source: source as 'ALL' | 'PURCHASED' | 'CUSTOMER' | 'UNKNOWN', overdue, query, page });
    const current = `${location.pathname}${location.search}`;
    if (current !== path) window.history.replaceState(window.history.state, '', path);
  }, [urlReady, selectedId, scope, week, status, source, overdue, query, page]);
  useEffect(() => { const timer = setTimeout(() => { setQuery(search.trim()); setPage(1); }, 220); return () => clearTimeout(timer); }, [search]);
  useEffect(() => {
    if (!urlReady) return;
    const abort = new AbortController(); setLoading(true);
    const p = new URLSearchParams({ scope, status, source, page: String(page), pageSize: '40', keyword: query }); if (week) p.set('weekStart', week); if (overdue) p.set('expected', 'overdue');
    fetch(`/api/warehouse/material-tasks?${p}`, { signal: abort.signal }).then(async r => { const b = await r.json(); if (!r.ok) throw Error(b.error || '加载失败'); return b as Payload; }).then(b => {
      if (abort.signal.aborted) return; setData(b); setSelectedId(id => { if (deepLink.current) { const selected = deepLink.current; deepLink.current = ''; return selected; } return b.tasks.some(t => t.id === id) ? id : b.tasks[0]?.id || ''; });
    }).catch(e => { if (e.name !== 'AbortError') setError(e.message); }).finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [urlReady, scope, week, status, source, query, page, overdue, refresh]);
  useEffect(() => {
    if (!selectedId) { setTask(null); return; }
    const abort = new AbortController(); setDetailLoading(true);
    fetch(`/api/warehouse/material-tasks/${selectedId}`, { signal: abort.signal }).then(async r => { const b = await r.json(); if (!r.ok) throw Error(b.error); return b.task; }).then(t => { if (!abort.signal.aborted) setTask(t); }).catch(e => { if (e.name !== 'AbortError') setError(e.message); }).finally(() => { if (!abort.signal.aborted) setDetailLoading(false); }); return () => abort.abort();
  }, [selectedId, refresh]);
  useEffect(() => {
    if (!canReport || !user.access.capabilities.includes('PROCUREMENT:READ')) return;
    const abort = new AbortController(); fetch('/api/material-follow-ups?pageSize=1', { signal: abort.signal }).then(r => r.json()).then(b => { if (!abort.signal.aborted) setUsers(b.users || []); }).catch(() => {}); return () => abort.abort();
  }, [canReport, user.access.capabilities]);
  const selectedEvents = task?.activeExceptions || [];
  const awaitingWarehouseCount = selectedEvents.filter(event => event.followUpStatus === 'WAITING_WAREHOUSE').length;
  const summary = data?.summary;
  const selectedOutsideFilter = Boolean(task && !data?.tasks.some(item => item.id === task.id));
  const warehouseReturnPath = task ? warehouseWorkbenchPath({ taskId: task.id, scope: scope as 'current' | 'preparation' | 'history', week, status: status as 'all' | 'pending' | 'exception' | 'completed', source: source as 'ALL' | 'PURCHASED' | 'CUSTOMER' | 'UNKNOWN', overdue, query, page }) : '/workspace/warehouse';
  const followUpEntryPath = `/workspace/procurement?${new URLSearchParams({ ...(selectedEvents[0]?.followUpId ? { taskId: selectedEvents[0].followUpId } : {}), returnTo: warehouseReturnPath })}`;
  const eventQuantity = (e: WarehouseMaterialExceptionCaseDTO) => e.shortageQuantity == null ? '数量待确认' : `缺 ${e.shortageQuantity} ${e.unit || '个'} · 已到 ${e.receivedQuantity || 0}`;
  function open(kind: Edit['kind'], event?: WarehouseMaterialExceptionCaseDTO) {
    triggerRef.current = document.activeElement as HTMLElement;
    const defaultOwnerMatches = users.filter(person => (person.displayName || person.username).trim() === '贾改真');
    setForm({ ...blank(event), supplySource: event?.supplySource || (source === 'ALL' ? 'UNKNOWN' : source as MaterialSource), ownerId: event?.owner?.id || (defaultOwnerMatches.length === 1 ? defaultOwnerMatches[0].id : '') });
    setEdit({ kind, event });
  }
  async function mutate(body: Record<string, unknown>) {
    if (!task || busy) return; setBusy(true);
    try {
      const r = await fetch(`/api/warehouse/material-tasks/${task.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, version: task.version }) });
      const b = await r.json(); if (!r.ok) throw Error(b.error || '保存失败');
      const next = b.task as WarehouseMaterialTaskDTO;
      setTask(next); setEdit(null); setHistory(false);
      // Keep the same work order in view when a mutation moves it out of the current status tab.
      if (status !== 'all' && status !== next.status) setStatus(next.status);
      if (source !== 'ALL') setSource('ALL');
      if (overdue) setOverdue(false);
      if (query) { setSearch(''); setQuery(''); }
      setPage(1); setSelectedId(task.id); deepLink.current = task.id;
      setRefresh(n => n + 1);
      setToast(body.action === 'report_exception'
        ? '异常已登记，已留在当前工单并同步物料跟进'
        : body.action === 'resolve' ? '仓库已核验，本项异常已解决' : '已保存并同步物料跟进');
    }
    catch (e) { setError(e instanceof Error ? e.message : '保存失败'); } finally { setBusy(false); }
  }
  function save() { if (!edit) return; void mutate(edit.kind === 'edit' ? { action: edit.event ? 'update_exception' : 'report_exception', exceptionId: edit.event?.id, ...form } : edit.kind === 'resolve' ? { action: 'resolve', exceptionId: edit.event?.id, note: form.note, resolution: form.resolution } : { action: 'reopen', note: form.note }); }
  function renderQueueTask(t: WarehouseMaterialTaskDTO) {
    const needsVerify = t.activeExceptions?.some(event => event.followUpStatus === 'WAITING_WAREHOUSE') || false;
    return <button key={t.id} className={`ms-order mw-ui-order mw-ui-order-${t.status} ${needsVerify ? 'mw-ui-order-verify' : ''} ${selectedId === t.id ? 'active' : ''}`} aria-current={selectedId === t.id ? 'true' : undefined} onClick={() => { if (!busy) { setSelectedId(t.id); setHistory(false); } }}>
      <span className="mw-ui-order-top"><span className="ms-eyebrow">{t.workOrder.customerName || '客户待补充'}{t.carryover && ` · ${t.carryover.label}`}</span><em className={needsVerify ? 'ms-verify' : t.status === 'exception' ? 'ms-warning' : t.status === 'completed' ? 'ms-success' : ''}>{needsVerify ? '待仓库确认' : t.statusText}</em></span>
      <strong>{t.workOrder.specification || t.workOrder.code}</strong><span className="ms-clamp">{t.workOrder.productName}</span>
      <span className="mw-ui-order-bottom"><span>{t.status === 'exception' ? `${t.activeExceptions?.length || 1} 项异常` : `更新 ${time(t.updatedAt)}`}</span><span>{t.status === 'exception' ? `到料 ${time(t.expectedAt)}` : t.workOrder.code}</span></span>
    </button>;
  }
  return <>
    <main ref={mainRef} className="ms-workbench hm-workbench-root">
      <AppWorkbenchHeader subtitle="物料协同" menuItems={[]} user={user} activeHref="/workspace/warehouse" hideHeader sidebarTriggerTargetId="mw-sidebar" moduleModeSwitcher={{ mode: 'mass', drawerId: 'mw-modes', drawerOpen: modeDrawer.open, onToggle: modeDrawer.toggle }} />
      <div className="ms-frame">
        <header className="ms-top mw-ui-top"><div id="mw-sidebar" /><span className="mw-ui-top-icon"><Warehouse size={21}/></span><div className="mw-ui-heading"><div><h1>仓库配料</h1><ModuleModeTrigger buttonRef={modeDrawer.triggerRef} open={modeDrawer.open} mode="mass" onClick={modeDrawer.toggle} controls="mw-modes" compact/></div><small>按工单确认配料，异常同步物料跟进</small></div><div className="ms-spacer"/><span className="mw-ui-organization">杭连采购 · 物料协同</span><a href={followUpEntryPath}>物料跟进 <ChevronRight size={15}/></a><button aria-label="刷新仓库配料" onClick={() => setRefresh(n => n + 1)} disabled={loading}><RefreshCw size={16}/></button></header>
        <ModuleModeDrawer id="mw-modes" open={modeDrawer.open} moduleLabel="仓库管理" mode="mass" mass={{ href: '/workspace/warehouse', title: '量产配料', description: '采购与客供物料协同', count: summary?.total || 0, countLabel: '单' }} sample={{ href: '/workspace/warehouse?branch=samples', title: '样品物料准备', description: '样品辅料及照片' }} onClose={modeDrawer.close}/>
        <section className="ms-filterbar mw-ui-status-strip"><nav className="ms-tabs" aria-label="配料状态">{[['pending','待配料',summary?.pending],['exception','仓库异常',summary?.exception],['completed','已配料',summary?.completed],['all','全部',summary?.total]].map(([id,label,count]) => <button key={id} className={`${status === id ? 'active' : ''} mw-ui-status-${id}`} aria-pressed={status === id} onClick={() => { setStatus(String(id)); if (id !== 'exception') setOverdue(false); setPage(1); }}>{label} <b>{count || 0}</b></button>)}</nav><span className="mw-ui-strip-note">{status === 'pending' ? '优先处理待配料工单' : status === 'exception' ? '逐项确认异常，跟进和仓库共用同一事项' : status === 'completed' ? '查看已确认的配料记录' : '量产配料全量工单'}</span></section>
        <section className="ms-filterbar mw-ui-search-strip"><label className="ms-search"><Search size={16}/><input aria-label="搜索仓库任务" placeholder="搜索工单、客户、产品型号或缺料内容" value={search} onChange={e => setSearch(e.target.value)}/></label><select aria-label="计划周范围" value={scope} onChange={e => { setScope(e.target.value); setWeek(''); setPage(1); }}><option value="current">本周计划</option><option value="preparation">下周预备</option><option value="history">历史计划</option></select>{scope !== 'current' && <select aria-label="选择计划周" value={week} onChange={e => { setWeek(e.target.value); setPage(1); }}><option value="">{scope === 'history' ? '全部历史周' : '默认下周'}</option>{data?.weeks.map(w => <option key={w.weekStartDate} value={w.weekStartDate}>{w.weekStartDate}</option>)}</select>}<select aria-label="物料来源筛选" value={source} onChange={e => { setSource(e.target.value); setPage(1); }}><option value="ALL">全部物料来源</option><option value="PURCHASED">采购物料异常</option><option value="CUSTOMER">客供物料异常</option><option value="UNKNOWN">来源待确认</option></select><label className="ms-check"><input type="checkbox" checked={overdue} onChange={e => { setOverdue(e.target.checked); if (e.target.checked) setStatus('exception'); setPage(1); }}/>到料逾期</label><button onClick={() => { setStatus('pending'); setSource('ALL'); setOverdue(false); setSearch(''); setPage(1); }}>清除筛选</button></section>
        <div className="ms-workspace">
          <aside className="ms-panel ms-queue mw-ui-queue"><header><div><strong>配料工单</strong><small>按状态查看 · 选择处理</small></div><span>{data?.pagination.total || 0} 单</span></header><div className="ms-scroll ms-list" aria-busy={loading}>{selectedOutsideFilter && task && <div className="mw-ui-pinned"><span>当前工单不在此计划周或筛选中</span><strong>{task.workOrder.specification || task.workOrder.code}</strong><small>仍可在右侧查看和处理当前工单</small></div>}{data?.tasks.map(renderQueueTask)}{!loading && !data?.tasks.length && !selectedOutsideFilter && <div className="ms-empty"><PackageCheck/><strong>当前筛选没有工单</strong><span>调整计划周或清除筛选后查看。</span></div>}</div><footer className="ms-pagination"><button aria-label="上一页" disabled={page === 1 || loading} onClick={() => setPage(p => p - 1)}><ChevronLeft size={16}/></button><span>{page} / {data?.pagination.totalPages || 1}</span><button aria-label="下一页" disabled={page >= (data?.pagination.totalPages || 1) || loading} onClick={() => setPage(p => p + 1)}><ChevronRight size={16}/></button></footer></aside>
          <section className="ms-panel ms-detail" aria-busy={detailLoading}>
            {task && !detailLoading ? <><header className="ms-detail-head mw-ui-detail-head"><div><span className="ms-eyebrow">{task.workOrder.customerName || '客户待补充'} · {task.workOrder.code}</span><h2>{task.workOrder.specification || task.workOrder.code}</h2><small>{task.workOrder.productName} · 更新 {time(task.updatedAt)}</small></div><span className={`ms-status ${task.status === 'exception' ? 'ms-warning' : task.status === 'completed' ? 'ms-success' : ''}`}>{task.statusText}</span></header>
              <div className="mw-ui-metrics"><span>计划数量 <strong>{task.workOrder.productionTargetQty ?? task.workOrder.uncompletedQty ?? '待补充'}</strong>{typeof task.workOrder.productionTargetQty === 'number' ? ' 件' : ''}</span><span>待处理异常 <strong>{selectedEvents.length}</strong> 项</span>{awaitingWarehouseCount > 0 && <span className="mw-ui-metric-verify">待仓库确认 <strong>{awaitingWarehouseCount}</strong> 项</span>}<span>配料状态 <strong>{task.status === 'completed' ? '已配齐' : task.status === 'exception' ? '跟进中' : '待核对'}</strong></span></div>
              <div className="ms-detail-actions"><strong>物料异常 <b>{selectedEvents.length}</b></strong><div className="ms-spacer"/><button onClick={() => setHistory(!history)}><History size={15}/>{history ? '返回异常' : '处理记录'}</button>{canReport && <button className="ms-primary" onClick={() => open('edit')} disabled={busy}><Plus size={16}/>登记缺料 / 异常</button>}</div>
              <div className="ms-scroll ms-detail-body mw-ui-detail-body">{history ? <div className="ms-timeline">{task.activities?.map(a => <article key={a.id}><i/><div><strong>{a.content}</strong><small>{a.actor?.displayName || a.actor?.username || '系统'} · {time(a.createdAt)}</small></div></article>)}{!task.activities?.length && <div className="ms-empty">暂无处理记录</div>}</div> : selectedEvents.length ? <><div className="mw-ui-section-intro"><strong>缺料与异常事项</strong><small>按事项逐一跟进，到料后由仓库核对实物</small></div>{selectedEvents.map(e => <article className={`mw-event mw-ui-event ${e.followUpStatus === 'WAITING_WAREHOUSE' ? 'mw-ui-event-ready' : ''}`} key={e.id}><div className="mw-event-heading"><span className={`ms-source-${e.supplySource || 'UNKNOWN'}`}>{exceptionTitle(e)}</span><small>事项 #{e.sequence} · 登记 {time(e.reportedAt)}</small><em className={`mw-ui-phase mw-ui-phase-${e.followUpStatus || 'PENDING'}`}>{followUpPhase(e.followUpStatus)}</em></div><h3>{e.materialModel || e.exceptionNote}</h3>{e.materialModel && <p className="mw-ui-event-note">{e.exceptionNote}</p>}<div className="mw-event-facts"><span>缺料数量 <b>{eventQuantity(e)}</b></span><span>预计到料 <b>{time(e.expectedArrivalAt)}</b></span><span>跟进人 <b>{e.owner?.displayName || e.owner?.username || '待认领'}</b></span></div><footer><span className="mw-ui-event-footnote"><Clock3 size={13}/>跟进结果同步此工单</span><div className="ms-spacer"/>{canReport && <button onClick={() => open('edit',e)} disabled={busy}>编辑异常</button>}{e.followUpId && <a href={`/workspace/procurement?taskId=${encodeURIComponent(e.followUpId)}&returnTo=${encodeURIComponent(warehouseReturnPath)}`}>查看跟进 <ChevronRight size={14}/></a>}{canConfirm && <button className={e.followUpStatus === 'WAITING_WAREHOUSE' ? 'mw-ui-ready-action' : ''} onClick={() => open('resolve',e)} disabled={busy}>{e.followUpStatus === 'WAITING_WAREHOUSE' ? '核对到料' : '确认本项解决'}</button>}</footer></article>)}</> : <div className="ms-empty"><PackageCheck size={36}/><strong>{task.status === 'completed' ? '该工单已完成配料' : '当前没有物料异常'}</strong><span>{task.status === 'completed' ? `确认人 ${task.completedBy?.displayName || task.completedBy?.username || '仓库'} · ${time(task.completedAt)}` : '发现采购或客供缺料时，可直接登记并交给物料跟进。'}</span></div>}</div>
              <footer className="ms-bottom"><span>{selectedEvents.length ? '按事项分别确认，全部解决后清除工单异常。' : '仓库核对实物后确认配料状态。'}</span>{canConfirm && task.status === 'pending' && <button className="ms-primary" disabled={busy} onClick={() => void mutate({ action: 'complete' })}><CheckCircle2 size={16}/>完成配料</button>}{canConfirm && task.status === 'completed' && <button onClick={() => open('reopen')} disabled={busy}>取消配料完成</button>}</footer>
            </> : <div className="ms-empty"><Warehouse size={36}/><strong>{detailLoading ? '正在加载工单…' : '请选择配料工单'}</strong></div>}
          </section>
        </div>
      </div>
    </main>
    {edit && task && <div className="ms-overlay" onMouseDown={e => { if (e.target === e.currentTarget && !busy) setEdit(null); }}><section ref={dialogRef} className="ms-dialog" role="dialog" aria-modal="true" aria-labelledby="mw-edit-title"><header><div><small>{task.workOrder.specification || task.workOrder.code}</small><h2 id="mw-edit-title">{edit.kind === 'edit' ? edit.event ? '更新本项异常' : '登记物料异常' : edit.kind === 'resolve' ? '确认本项异常解决' : '取消配料完成'}</h2></div><button aria-label="关闭弹窗" onClick={() => setEdit(null)} disabled={busy}><X size={19}/></button></header><div className="ms-dialog-body">{edit.kind === 'edit' ? <>
      <div className="ms-field"><span>异常类型</span><div className="ms-type-picker">{(['PURCHASED','CUSTOMER'] as MaterialSource[]).map(s => <button key={s} className={form.exceptionType === 'shortage' && form.supplySource === s ? 'active' : ''} onClick={() => setForm(f => ({ ...f, exceptionType: 'shortage', supplySource: s }))}>{materialSourceText[s]}缺料</button>)}{types.map(t => <button key={t} className={form.exceptionType === t ? 'active' : ''} onClick={() => setForm(f => ({ ...f, exceptionType: t }))}>{materialExceptionLabel(t)}</button>)}</div></div>
      {form.exceptionType !== 'shortage' && <label className="ms-field">物料来源{needsMaterialIdentity(form.exceptionType) ? ' *' : ''}<select value={form.supplySource} onChange={e => setForm(f => ({ ...f, supplySource: e.target.value as MaterialSource }))}>{Object.entries(materialSourceText).map(([v,l]) => <option key={v} value={v}>{l}</option>)}</select></label>}
      <label className="ms-field">缺料 / 异常说明 *<textarea autoFocus rows={3} maxLength={400} value={form.exceptionNote} onChange={e => setForm(f => ({ ...f, exceptionNote: e.target.value }))} placeholder="填写缺少的物料、数量或异常情况"/></label>
      <div className="ms-form-grid"><label>物料型号{needsMaterialIdentity(form.exceptionType) ? ' *' : '（选填）'}<input value={form.materialModel} maxLength={160} onChange={e => setForm(f => ({ ...f, materialModel: e.target.value }))} placeholder={needsMaterialIdentity(form.exceptionType) ? '请输入缺料物料的型号' : '可填写涉及的物料型号'}/></label><label>本次缺料数量（选填）<input type="number" min="0" step="0.001" value={form.shortageQuantity} onChange={e => setForm(f => ({ ...f, shortageQuantity: e.target.value }))} placeholder="数量待确认"/></label><label>单位<input value={form.unit} maxLength={12} onChange={e => setForm(f => ({ ...f, unit: e.target.value }))}/></label>{!edit.event && users.length > 0 && <label>负责人<select value={form.ownerId} onChange={e => setForm(f => ({ ...f, ownerId: e.target.value }))}><option value="">待认领</option>{users.map(u => <option key={u.id} value={u.id}>{u.displayName || u.username}</option>)}</select></label>}</div>{edit.event && <p className="ms-muted">到料时间由跟进人员维护，当前预计：{time(edit.event.expectedArrivalAt)}</p>}
    </> : <><p>{edit.event?.exceptionNote}</p><label className="ms-field">{edit.kind === 'resolve' ? '实物核验与解决说明 *' : '取消原因 *'}<textarea autoFocus rows={3} value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))}/></label>{edit.kind === 'resolve' && <label className="ms-field">本项解决后<select value={form.resolution} onChange={e => setForm(f => ({ ...f, resolution: e.target.value }))}><option value="pending">继续仓库配料</option><option value="completed">所有异常解决后完成配料</option></select></label>}</> }</div><footer><button onClick={() => setEdit(null)} disabled={busy}>取消</button><button className="ms-primary" onClick={save} disabled={busy || (edit.kind === 'edit' ? !form.exceptionNote.trim() || (needsMaterialIdentity(form.exceptionType) && (form.supplySource === 'UNKNOWN' || !form.materialModel.trim())) : !form.note.trim())}>{busy ? '保存中…' : edit.kind === 'resolve' ? '核对完成，确认解决' : '保存'}</button></footer></section></div>}
  </>;
}
