'use client';
import { useEffect, useCallback, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Clock3, History, PackageCheck, Package, UsersRound, Plus, RefreshCw, Search, Warehouse, X } from 'lucide-react';
import { AppWorkbenchHeader } from '@/components/layout/AppWorkbenchHeader';
import MaterialFollowUpShell from '@/components/MaterialFollowUpShell';
import { MaterialOwner, nextMaterialAction } from './material/MaterialSignal';
import { useModalLayer } from '@/components/useModalLayer';
import { useToastBridge } from '@/components/ToastProvider';
import { materialExceptionLabel, materialSourceText, type MaterialSource } from '@/lib/material-source';
import { warehouseWorkbenchPath, warehouseWorkbenchStateFromSearch } from '@/lib/warehouse-navigation';
import type { CurrentUserDTO, IssueUserDTO, WarehouseMaterialTaskDTO, WarehouseMaterialExceptionCaseDTO, WarehouseExceptionType, WarehouseWeekOptionDTO } from '@/types';
import './material/MaterialWorkbench.css';
import './material/WarehouseMaterial.css';
import './material/MaterialGlass.css';
import type { WarehouseWorkbenchNavigation } from '@/lib/warehouse-navigation';

type Payload = { tasks: WarehouseMaterialTaskDTO[]; summary: { total: number; pending: number; completed: number; exception: number; expectedOverdue: number; waiting: number; unassigned: number }; weeks: WarehouseWeekOptionDTO[]; pagination: { total: number; totalPages: number }; error?: string };
type Edit = { kind: 'edit' | 'resolve' | 'reopen' | 'complete'; event?: WarehouseMaterialExceptionCaseDTO };
type Form = { exceptionType: WarehouseExceptionType; supplySource: MaterialSource; exceptionNote: string; materialModel: string; shortageQuantity: string; unit: string; ownerId: string; note: string; resolution: string };
const blank = (event?: WarehouseMaterialExceptionCaseDTO): Form => ({ exceptionType: event?.exceptionType || 'shortage', supplySource: event?.supplySource || 'UNKNOWN', exceptionNote: event?.exceptionNote || '', materialModel: event?.materialModel || '', shortageQuantity: event?.shortageQuantity == null ? '' : String(event.shortageQuantity), unit: event?.unit || '个', ownerId: event?.owner?.id || '', note: '', resolution: 'pending' });
const time = (value?: string | null) => value ? new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : '待确认';
const types: WarehouseExceptionType[] = ['wrong_material', 'insufficient_quantity', 'quality_issue', 'other'];
const followUpPhase = (status?: WarehouseMaterialExceptionCaseDTO['followUpStatus']) => ({ PENDING: '待接收', IN_PROGRESS: '跟进中', WAITING_ARRIVAL: '等待到料', WAITING_WAREHOUSE: '待仓库确认', RESOLVED: '已解决', CANCELLED: '已取消' } as Record<NonNullable<WarehouseMaterialExceptionCaseDTO['followUpStatus']>, string>)[status || 'PENDING'];
const exceptionTitle = (event: WarehouseMaterialExceptionCaseDTO) => event.exceptionType === 'shortage' && event.supplySource && event.supplySource !== 'UNKNOWN' ? `${materialSourceText[event.supplySource]}缺料` : event.exceptionTypeText;
const needsMaterialIdentity = (exceptionType: WarehouseExceptionType) => exceptionType === 'shortage' || exceptionType === 'insufficient_quantity';

export default function WarehouseManagementShell({ user, modeDrawerInitiallyOpen = false }: { user: CurrentUserDTO; modeDrawerInitiallyOpen?: boolean }) {
  const [followUpId, setFollowUpId] = useState('');
  const [verified, setVerified] = useState(false);
  const [caseDirty, setCaseDirty] = useState(false);
  const [caseBusy, setCaseBusy] = useState(false);
  const onCaseDraft = useCallback((dirty: boolean, saving: boolean) => { setCaseDirty(dirty); setCaseBusy(saving); }, []);
  function closeCase() { if (!caseBusy && (!caseDirty || window.confirm('本次进展尚未保存，确定关闭？'))) { setFollowUpId(''); setCaseDirty(false); } }
  const sheetRef = useRef<HTMLElement>(null);
  const [queueOpen, setQueueOpen] = useState(false);
  const [scope, setScope] = useState<WarehouseWorkbenchNavigation['scope']>('open'); const [week, setWeek] = useState('');
  const [status, setStatus] = useState<WarehouseWorkbenchNavigation['status']>('active'); const [source, setSource] = useState('ALL'); const [overdue, setOverdue] = useState(false);
  const [search, setSearch] = useState(''); const [query, setQuery] = useState(''); const [page, setPage] = useState(1);
  const [data, setData] = useState<Payload | null>(null); const [selectedId, setSelectedId] = useState('');
  const [task, setTask] = useState<WarehouseMaterialTaskDTO | null>(null); const [loading, setLoading] = useState(false); const [detailLoading, setDetailLoading] = useState(false);
  const [refresh, setRefresh] = useState(0); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [toast, setToast] = useState('');
  const [edit, setEdit] = useState<Edit | null>(null); const [form, setForm] = useState<Form>(() => blank()); const [users, setUsers] = useState<IssueUserDTO[]>([]);
  const [history, setHistory] = useState(false); const [urlReady, setUrlReady] = useState(false); const deepLink = useRef(''); const loadedTaskId = useRef(''); const mainRef = useRef<HTMLElement>(null); const dialogRef = useRef<HTMLElement>(null); const triggerRef = useRef<HTMLElement | null>(null);
  const canConfirm = user.access.capabilities.includes('WAREHOUSE:UPDATE'); const canReport = canConfirm || user.access.capabilities.includes('PROCUREMENT:UPDATE');
  useModalLayer({ open: !!followUpId, layerRef: sheetRef, backgroundRef: mainRef, onClose: closeCase });
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
    const path = warehouseWorkbenchPath({ taskId: selectedId, scope: scope, week, status: status, source: source as 'ALL' | 'PURCHASED' | 'CUSTOMER' | 'UNKNOWN', overdue, query, page });
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
    const abort = new AbortController(); setDetailLoading(loadedTaskId.current !== selectedId);
    fetch(`/api/warehouse/material-tasks/${selectedId}`, { signal: abort.signal }).then(async r => { const b = await r.json(); if (!r.ok) throw Error(b.error); return b.task; }).then(t => { if (!abort.signal.aborted) { loadedTaskId.current=t.id; setTask(t); } }).catch(e => { if (e.name !== 'AbortError') setError(e.message); }).finally(() => { if (!abort.signal.aborted) setDetailLoading(false); }); return () => abort.abort();
  }, [selectedId, refresh]);
  useEffect(() => {
    if (!canReport || !user.access.capabilities.includes('PROCUREMENT:READ')) return;
    const abort = new AbortController(); fetch('/api/material-follow-ups?pageSize=1', { signal: abort.signal }).then(r => r.json()).then(b => { if (!abort.signal.aborted) setUsers(b.users || []); }).catch(() => {}); return () => abort.abort();
  }, [canReport, user.access.capabilities]);
  const selectedEvents = task?.activeExceptions || [];
  const awaitingWarehouseCount = selectedEvents.filter(event => event.followUpStatus === 'WAITING_WAREHOUSE').length;
  const summary = data?.summary;
  const selectedOutsideFilter = Boolean(task && !data?.tasks.some(item => item.id === task.id));
  const warehouseReturnPath = task ? warehouseWorkbenchPath({ taskId: task.id, scope: scope, week, status: status, source: source as 'ALL' | 'PURCHASED' | 'CUSTOMER' | 'UNKNOWN', overdue, query, page }) : '/workspace/warehouse';
  const followUpEntryPath = `/workspace/procurement?${new URLSearchParams({ ...(selectedEvents[0]?.followUpId ? { taskId: selectedEvents[0].followUpId } : {}), returnTo: warehouseReturnPath })}`;
  const eventQuantity = (e: WarehouseMaterialExceptionCaseDTO) => e.shortageQuantity == null ? '缺料数量待确认' : `登记缺 ${e.shortageQuantity} ${e.unit || '个'} · 已报到 ${e.receivedQuantity || 0} · 待到 ${Math.max(0, Math.round((e.shortageQuantity - (e.receivedQuantity || 0)) * 1000) / 1000)}`;
  function open(kind: Edit['kind'], event?: WarehouseMaterialExceptionCaseDTO) {
    setVerified(false);
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
      // Pin the changed task without discarding the operator's queue or search.
      setSelectedId(task.id); deepLink.current = task.id;
      setRefresh(n => n + 1);
      setToast(body.action === 'report_exception'
        ? '异常已登记，已留在当前工单并同步物料跟进'
        : body.action === 'resolve' ? '仓库已核验，本项异常已解决' : '已保存并同步物料跟进');
    }
    catch (e) { setError(e instanceof Error ? e.message : '保存失败'); } finally { setBusy(false); }
  }
  function save() { if (!edit) return; void mutate(edit.kind === 'complete' ? { action: 'complete' } : edit.kind === 'edit' ? { action: edit.event ? 'update_exception' : 'report_exception', exceptionId: edit.event?.id, ...form } : edit.kind === 'resolve' ? { action: 'resolve', exceptionId: edit.event?.id, note: form.note, resolution: form.resolution } : { action: 'reopen', note: form.note }); }
  function renderQueueTask(t: WarehouseMaterialTaskDTO) {
    const events = t.activeExceptions || [];
    const needsVerify = events.some(e => e.followUpStatus === 'WAITING_WAREHOUSE');
    const tone = t.status === 'completed' ? 'green' : needsVerify ? 'blue' : events.length ? 'red' : 'gray';
    const owners = [...new Set(events.map(e => e.owner?.displayName || e.owner?.username || '待分配'))];
    return <button key={t.id} className={`ms-order mw-ui-order mg-order ${selectedId === t.id ? 'active' : ''}`} data-tone={tone} aria-current={selectedId === t.id ? 'true' : undefined} onClick={() => { if (!busy) { setSelectedId(t.id); setHistory(false); setQueueOpen(false); } }}>
      <span className="mg-card-top"><span>{t.workOrder.customerName || '客户待补充'}</span><em className={`mg-badge ${tone}`}>{needsVerify ? '待核实到料' : t.status === 'exception' ? `缺料 / 异常 ${events.length} 项` : t.statusText}</em></span>
      <strong>{t.workOrder.specification || t.workOrder.code}</strong>
      <span className="mg-short-preview">{events.length ? <><small>缺料</small><b>{events.map(e => e.materialModel || e.exceptionNote).join('、')}</b></> : t.status === 'completed' ? '实物已确认配齐' : '尚未核对实物，请先确认是否齐料'}</span>
      <span className="mg-card-meta"><span>{events.length ? `负责人 · ${owners.join('、')}` : `计划 ${t.workOrder.productionTargetQty ?? t.workOrder.uncompletedQty ?? '—'} 件`}</span><b className={t.isExpectedOverdue ? 'mg-red-text' : ''}>{t.isExpectedOverdue ? '到料逾期' : events.length ? `预计 ${time(t.expectedAt)}` : ''}</b></span>
      <span className="mg-card-foot"><b>{t.carryover?.label || (t.workOrder.weekStartDate ? `${time(t.workOrder.weekStartDate).slice(0,5)} 计划周` : '计划周待确认')}</b><span>{events[0] ? followUpPhase(events[0].followUpStatus) : `更新 ${time(t.updatedAt)}`}</span></span>
    </button>;
  }
  return <>
    <main ref={mainRef} className="ms-workbench mg-workbench hm-workbench-root">
      <AppWorkbenchHeader subtitle="物料协同" menuItems={[]} user={user} activeHref="/workspace/warehouse" hideHeader sidebarTriggerTargetId="mw-sidebar" />
      <div className="ms-frame mg-frame">
        <header className="ms-top mg-top"><div id="mw-sidebar"/><span className="mg-module-icon"><Warehouse size={22}/></span><div className="mg-title"><small>物料与仓储</small><h1>仓库配料</h1></div><select className="mg-mode" aria-label="仓库业务模式" value="mass" onChange={e => { if(e.target.value === 'sample') location.href='/workspace/warehouse?branch=samples'; }}><option value="mass">量产</option><option value="sample">样品</option></select><nav className="mg-view-switch" aria-label="物料协同视图"><span aria-current="page"><Warehouse size={16}/>仓库配料</span><a href={followUpEntryPath}>物料跟进 <ChevronRight size={15}/></a></nav><div className="ms-spacer"/><span className="mg-account">{user.displayName || user.username}</span><button aria-label="刷新仓库配料" onClick={() => {deepLink.current=selectedId;setRefresh(n=>n+1);}} disabled={loading}><RefreshCw size={16}/></button></header>
        <section className="ms-filterbar mg-command"><nav className="ms-tabs" aria-label="配料状态">{([['active','未配齐',(summary?.pending||0)+(summary?.exception||0)],['completed','已配齐',summary?.completed],['all','全部',summary?.total]] as const).map(([id,label,count])=><button key={id} className={status===id?'active':''} aria-pressed={status===id} onClick={()=>{setStatus(id);setOverdue(false);setPage(1);}}>{label}<b>{count||0}</b></button>)}</nav><i className="mg-divider"/><nav className="mg-quick" aria-label="配料重点筛选">{([['exception','缺料 / 异常',summary?.exception],['waiting','待核实',summary?.waiting],['unassigned','待分配',summary?.unassigned],['pending','未核对',summary?.pending]] as const).map(([id,label,count])=><button className={status===id?'active':''} key={id} onClick={()=>{setStatus(status===id?'active':id);setPage(1);}}>{label}<b>{count||0}</b></button>)}<button className={overdue?'active mg-red-text':''} onClick={()=>{setOverdue(!overdue);setStatus('active');setPage(1);}}><AlertTriangle size={14}/>逾期<b>{summary?.expectedOverdue||0}</b></button></nav></section>
        <section className="ms-filterbar mg-searchbar"><label className="ms-search"><Search size={16}/><input aria-label="搜索仓库任务" placeholder="搜索工单、客户、产品或缺料型号" value={search} onChange={e=>setSearch(e.target.value)}/></label><select aria-label="计划周范围" value={scope} onChange={e=>{setScope(e.target.value as WarehouseWorkbenchNavigation['scope']);setWeek('');setPage(1);}}><option value="open">本周与历史未结</option><option value="current">本周计划</option><option value="preparation">下周预备</option><option value="history">历史计划</option></select>{['history','preparation'].includes(scope)&&<select aria-label="选择计划周" value={week} onChange={e=>{setWeek(e.target.value);setPage(1);}}><option value="">{scope==='history'?'全部历史周':'默认下周'}</option>{data?.weeks.map(w=><option key={w.weekStartDate} value={w.weekStartDate}>{w.weekStartDate}</option>)}</select>}<select aria-label="物料来源筛选" value={source} onChange={e=>{setSource(e.target.value);setPage(1);}}><option value="ALL">全部物料来源</option><option value="PURCHASED">采购物料</option><option value="CUSTOMER">客供物料</option><option value="UNKNOWN">来源待确认</option></select><button onClick={()=>{setStatus('active');setSource('ALL');setOverdue(false);setSearch('');setPage(1);}}>清除筛选</button></section>
        <div className={`ms-workspace mg-workspace ${queueOpen?'mg-queue-open':''}`}>
          <aside className="ms-panel ms-queue mg-queue"><header><div><strong>配料工单 <b>{data?.pagination.total||0}</b></strong><small>先看缺什么，再看谁处理</small></div><button className="mg-mobile" aria-label="关闭工单列表" onClick={()=>setQueueOpen(false)}><X size={16}/></button></header><div className="ms-scroll ms-list" aria-busy={loading}>{selectedOutsideFilter&&task&&<div className="mw-ui-pinned"><strong>当前工单已不符合筛选</strong><small>已保留右侧详情，可继续处理或选择下一单。</small></div>}{data?.tasks.map(renderQueueTask)}{!loading&&!data?.tasks.length&&!selectedOutsideFilter&&<div className="ms-empty"><PackageCheck/><strong>当前筛选没有工单</strong><span>调整计划周或清除筛选后查看。</span></div>}</div><footer className="ms-pagination"><button aria-label="上一页" disabled={page===1||loading} onClick={()=>setPage(p=>p-1)}><ChevronLeft size={16}/></button><span>{page} / {data?.pagination.totalPages||1}</span><button aria-label="下一页" disabled={page>=(data?.pagination.totalPages||1)||loading} onClick={()=>setPage(p=>p+1)}><ChevronRight size={16}/></button></footer></aside>
          <section className="ms-panel ms-detail mg-detail" aria-busy={detailLoading}>
            {task&&!detailLoading?<><header className="ms-detail-head"><div><span className="ms-eyebrow">{task.workOrder.customerName||'客户待补充'} · {task.workOrder.code}</span><h2>{task.workOrder.specification||task.workOrder.code}</h2><small>{task.workOrder.productName}</small></div><div className="mg-detail-tools"><button className="mg-mobile" onClick={()=>setQueueOpen(true)}>工单列表</button><span className={`mg-badge ${task.status==='completed'?'green':selectedEvents.length?'red':'gray'}`}>{task.status==='completed'?'已配齐':selectedEvents.length?'物料未齐':'待核对实物'}</span></div></header>
              <div className="mg-order-context"><div><small>计划数量</small><strong>{task.workOrder.productionTargetQty??task.workOrder.uncompletedQty??'待补充'} <em>件</em></strong></div><div><small>未解决事项</small><strong className={selectedEvents.length?'mg-red-text':''}>{selectedEvents.length} <em>项</em></strong></div><div><small>等待仓库核实</small><strong className={awaitingWarehouseCount?'mg-blue-text':''}>{awaitingWarehouseCount} <em>项</em></strong></div><div><small>最近更新</small><strong className="mg-small-value">{time(task.updatedAt)}</strong></div></div>
              <div className="ms-detail-actions"><strong>{history?'处理记录':'缺料与异常'} <b>{selectedEvents.length||''}</b></strong><div className="ms-spacer"/><button onClick={()=>setHistory(!history)}><History size={15}/>{history?'返回异常':'处理记录'}</button>{canReport&&<button className="ms-primary" onClick={()=>open('edit')} disabled={busy}><Plus size={16}/>登记缺料 / 异常</button>}</div>
              <div className="ms-scroll ms-detail-body mg-warehouse-scroll">{history?<div className="ms-timeline">{task.activities?.map(a=><article key={a.id}><i/><div><strong>{a.content}</strong><small>{a.actor?.displayName||a.actor?.username||'系统'} · {time(a.createdAt)}</small></div></article>)}{!task.activities?.length&&<div className="ms-empty">暂无处理记录</div>}</div>:selectedEvents.length?<><div className={`mg-focus ${awaitingWarehouseCount?'blue':'red'}`}><AlertTriangle size={18}/><div><strong>{awaitingWarehouseCount?`${awaitingWarehouseCount} 项已报到料，等待仓库核实`:`当前 ${selectedEvents.length} 项缺料 / 异常未解决`}</strong><p>{awaitingWarehouseCount?'核对型号、数量与实物后确认；其他未结事项继续跟踪。':'各项负责人、预计到料与最近进展如下，点开可直接处理。'}</p></div></div>{selectedEvents.map(e=>{const next=nextMaterialAction(e);return <article className={`mg-material-row ${next.tone}`} key={e.id}><span className={`mg-source-mark ${e.supplySource==='CUSTOMER'?'customer':''}`}>{e.supplySource==='CUSTOMER'?<UsersRound size={20}/>:<Package size={20}/>}</span><div className="mg-material-main"><div className="mg-material-top"><span>{exceptionTitle(e)}</span><em className={`mg-badge ${next.tone}`}>{followUpPhase(e.followUpStatus)}</em></div><h3>{e.materialModel||e.exceptionNote}</h3><div className="mg-material-meta"><span>{eventQuantity(e)}</span><span>预计 <b>{time(e.expectedArrivalAt)}</b></span></div><p className="mg-latest-inline">{e.latestProgress||e.exceptionNote}</p><small className="mg-progress-by">{e.latestActor?.displayName||e.latestActor?.username||e.reportedBy?.displayName||e.reportedBy?.username||'系统'} · {time(e.lastFollowedAt||e.reportedAt)}</small><div className="mg-row-links">{canReport&&<button onClick={()=>open('edit',e)} disabled={busy}>编辑异常</button>}{canConfirm&&e.followUpStatus!=='WAITING_WAREHOUSE'&&<button onClick={()=>open('resolve',e)} disabled={busy}>确认本项解决</button>}</div></div><div className="mg-material-next"><small>{next.who}</small><strong>{next.action}</strong><MaterialOwner event={e}/>{e.followUpId&&user.access.capabilities.includes('PROCUREMENT:READ')&&<button className={next.tone==='blue'?'mg-blue-action':'mg-row-action'} onClick={()=>setFollowUpId(e.followUpId!)}>查看 / 跟进 <ChevronRight size={14}/></button>}{canConfirm&&e.followUpStatus==='WAITING_WAREHOUSE'&&<button className="mg-blue-action" onClick={()=>open('resolve',e)}>核对到料</button>}</div></article>})}</>:<div className="ms-empty"><PackageCheck size={40}/><strong>{task.status==='completed'?'该工单已确认配齐':'尚未发现缺料，等待实物核对'}</strong><span>{task.status==='completed'?`确认人 ${task.completedBy?.displayName||task.completedBy?.username||'仓库'} · ${time(task.completedAt)}`:'核对齐料后完成配料；如有缺料，登记型号与采购 / 客供来源。'}</span></div>}</div>
              <footer className="ms-bottom mg-dock"><div><strong>{task.status==='completed'?'仓库配料已完成':selectedEvents.length?'逐项跟进 · 仓库核实后闭环':'下一步 · 仓库确认齐料'}</strong><small>{selectedEvents.length?'已报到料不等于已配齐，请核对实物。':'无须上传 BOM，按实际配料结果确认。'}</small></div><div className="ms-spacer"/>{canConfirm&&task.status==='pending'&&<button className="ms-primary" disabled={busy} onClick={()=>open('complete')}><CheckCircle2 size={16}/>完成配料</button>}{canConfirm&&task.status==='completed'&&<button onClick={()=>open('reopen')} disabled={busy}>取消配料完成</button>}</footer>
            </>:<div className="ms-empty"><button className="mg-mobile" onClick={()=>setQueueOpen(true)}>选择工单</button><Warehouse size={36}/><strong>{detailLoading?'正在加载工单…':'请选择配料工单'}</strong></div>}
          </section>
        </div>
      </div>
    </main>
    {!!followUpId&&<div className="mg-sheet-overlay" onMouseDown={e=>{if(e.currentTarget===e.target)closeCase();}}><section ref={sheetRef} className="mg-case-sheet" role="dialog" aria-modal="true" aria-label="物料协同处理"><MaterialFollowUpShell user={user} embeddedTaskId={followUpId} onClose={closeCase} onDraftState={onCaseDraft} onVerify={canConfirm ? ()=>{ if(caseBusy || (caseDirty && !window.confirm('本次进展尚未保存，确定进入仓库核实？'))) return; const event=selectedEvents.find(e=>e.followUpId===followUpId); if(event){setFollowUpId('');open('resolve',event);} } : undefined} onChanged={()=>{deepLink.current=selectedId;setRefresh(n=>n+1);}}/></section></div>}
    {edit && task && <div className="ms-overlay mg-sheet-overlay" onMouseDown={e => { if (e.target === e.currentTarget && !busy) setEdit(null); }}><section ref={dialogRef} className="ms-dialog mg-edit-sheet" role="dialog" aria-modal="true" aria-labelledby="mw-edit-title"><header><div><small>{task.workOrder.specification || task.workOrder.code}</small><h2 id="mw-edit-title">{edit.kind === 'edit' ? edit.event ? '更新本项异常' : '登记物料异常' : edit.kind === 'resolve' ? '确认本项异常解决' : edit.kind === 'complete' ? '确认工单物料已配齐' : '取消配料完成'}</h2></div><button aria-label="关闭弹窗" onClick={() => setEdit(null)} disabled={busy}><X size={19}/></button></header><div className="ms-dialog-body">{edit.kind === 'edit' ? <>
      <div className="ms-field"><span>异常类型</span><div className="ms-type-picker">{(['PURCHASED','CUSTOMER'] as MaterialSource[]).map(s => <button key={s} className={form.exceptionType === 'shortage' && form.supplySource === s ? 'active' : ''} onClick={() => setForm(f => ({ ...f, exceptionType: 'shortage', supplySource: s }))}>{materialSourceText[s]}缺料</button>)}{types.map(t => <button key={t} className={form.exceptionType === t ? 'active' : ''} onClick={() => setForm(f => ({ ...f, exceptionType: t }))}>{materialExceptionLabel(t)}</button>)}</div></div>
      {form.exceptionType !== 'shortage' && <label className="ms-field">物料来源{needsMaterialIdentity(form.exceptionType) ? ' *' : ''}<select value={form.supplySource} onChange={e => setForm(f => ({ ...f, supplySource: e.target.value as MaterialSource }))}>{Object.entries(materialSourceText).map(([v,l]) => <option key={v} value={v}>{l}</option>)}</select></label>}
      <label className="ms-field">缺料 / 异常说明 *<textarea autoFocus rows={3} maxLength={400} value={form.exceptionNote} onChange={e => setForm(f => ({ ...f, exceptionNote: e.target.value }))} placeholder="填写缺少的物料、数量或异常情况"/></label>
      <div className="ms-form-grid"><label>物料型号{needsMaterialIdentity(form.exceptionType) ? ' *' : '（选填）'}<input value={form.materialModel} maxLength={160} onChange={e => setForm(f => ({ ...f, materialModel: e.target.value }))} placeholder={needsMaterialIdentity(form.exceptionType) ? '请输入缺料物料的型号' : '可填写涉及的物料型号'}/></label><label>本次缺料数量（选填）<input type="number" min="0" step="0.001" value={form.shortageQuantity} onChange={e => setForm(f => ({ ...f, shortageQuantity: e.target.value }))} placeholder="数量待确认"/></label><label>单位<input value={form.unit} maxLength={12} onChange={e => setForm(f => ({ ...f, unit: e.target.value }))}/></label>{!edit.event && users.length > 0 && <label>负责人<select value={form.ownerId} onChange={e => setForm(f => ({ ...f, ownerId: e.target.value }))}><option value="">待认领</option>{users.map(u => <option key={u.id} value={u.id}>{u.displayName || u.username}</option>)}</select></label>}</div>{edit.event && <p className="ms-muted">到料时间由跟进人员维护，当前预计：{time(edit.event.expectedArrivalAt)}</p>}
    </> : edit.kind === 'complete' ? <div className="mg-complete-confirm"><PackageCheck size={38}/><h3>确认本工单的物料已全部配齐</h3><p>确认后同步计划与生产页面，并记录您的姓名和时间。</p></div> : <><p>{edit.event?.exceptionNote}</p><label className="ms-field">{edit.kind === 'resolve' ? '实物核验与解决说明 *' : '取消原因 *'}<textarea autoFocus rows={3} value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))}/></label>{edit.kind === 'resolve' && <label className="ms-field">本项解决后<select value={form.resolution} onChange={e => setForm(f => ({ ...f, resolution: e.target.value }))}><option value="pending">继续仓库配料</option><option value="completed">所有异常解决后完成配料</option></select></label>}</> }{(edit.kind === 'resolve' || edit.kind === 'complete') && <label className="ms-check mg-physical-check"><input type="checkbox" checked={verified} onChange={e=>setVerified(e.target.checked)}/>已核对型号、数量与实物，确认无误</label>}</div><footer><button onClick={() => setEdit(null)} disabled={busy}>取消</button><button className="ms-primary" onClick={save} disabled={busy || ((edit.kind === 'resolve' || edit.kind === 'complete') && !verified) || (edit.kind === 'complete' ? false : edit.kind === 'edit' ? !form.exceptionNote.trim() || (needsMaterialIdentity(form.exceptionType) && (form.supplySource === 'UNKNOWN' || !form.materialModel.trim())) : !form.note.trim())}>{busy ? '保存中…' : edit.kind === 'resolve' ? '核对完成，确认解决' : edit.kind === 'complete' ? '确认配齐' : '保存'}</button></footer></section></div>}
  </>;
}
