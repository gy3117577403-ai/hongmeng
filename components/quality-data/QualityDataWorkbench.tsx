'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { BookOpen, ClipboardCheck, Download, FileArchive, PanelLeft, Plus, RefreshCw, Search, SlidersHorizontal, Trash2 } from 'lucide-react';
import { AppWorkbenchHeader } from '@/components/layout/AppWorkbenchHeader';
import { QUALITY_DATA_TYPES, QUALITY_LABELS, RESULT_LABELS, beijingInput, type QualityOrder, type QualityRecord, type QualityDataType } from '@/lib/quality-data';
import type { CurrentUserDTO } from '@/types';
import QualityDataEditor from './QualityDataEditor';
import QualityDataDetail from './QualityDataDetail';
import QualityReferenceWorkbench from './QualityReferenceWorkbench';
import { downloadQuality, qualityRequest } from './client';
type List = { total: number; page: number; items: QualityRecord[]; counts: Array<{ result: string; status: string; _count: number }> };
type Orders = { total: number; page: number; items: QualityOrder[] };
export default function QualityDataWorkbench({ user, initialRecordId = '', initialSection = 'records' }: { user: CurrentUserDTO; initialRecordId?: string; initialSection?: string }) {
  const [orders,setOrders] = useState<Orders>({ total: 0, page: 1, items: [] }), [orderPage,setOrderPage] = useState(1), [orderQuery,setOrderQuery] = useState(''), [orderFilter,setOrderFilter] = useState('');
  const [order,setOrder] = useState<QualityOrder | null>(null), [selected,setSelected] = useState<QualityRecord | null>(null);
  const [list,setList] = useState<List>({ total: 0, page: 1, items: [], counts: [] }), [page,setPage] = useState(1);
  const [period,setPeriod] = useState('month'), [date,setDate] = useState(beijingInput().slice(0,10)), [start,setStart] = useState(beijingInput().slice(0,10)), [end,setEnd] = useState(beijingInput().slice(0,10));
  const [timeField,setTimeField] = useState('inspectedAt'), [type,setType] = useState(''), [result,setResult] = useState(''), [status,setStatus] = useState(''), [review,setReview] = useState('');
  const [q,setQ] = useState(''), [search,setSearch] = useState(''), [deleted,setDeleted] = useState(false);
  const [error,setError] = useState(''), [loading,setLoading] = useState(false), [exporting,setExporting] = useState(false), [refresh,setRefresh] = useState(0);
  const [editor,setEditor] = useState<{ order: QualityOrder; type: QualityDataType; record?: QualityRecord; supersedesId?: string } | null>(null);
  const [chooseType,setChooseType] = useState(false);
  const [section,setSection]=useState(initialSection==='references'?'references':'records'),[advanced,setAdvanced]=useState(false),[ordersHidden,setOrdersHidden]=useState(false);
  const preferred=useRef(initialRecordId);
  const linkedRecord=useRef<QualityRecord|null>(null),[openingRecord,setOpeningRecord]=useState(Boolean(initialRecordId));
  const detailRequest = useRef(0);
  useEffect(()=>{
    if(!initialRecordId)return;
    let active=true;setOpeningRecord(true);
    qualityRequest<QualityRecord>('records/'+initialRecordId).then(record=>{if(active){linkedRecord.current=record;preferred.current=record.id;setOrder(record.orderSnapshot);setPeriod('all');setDeleted(Boolean(record.deletedAt));setSelected(record);}}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setOpeningRecord(false);});
    return()=>{active=false;};
  },[initialRecordId]);
  useEffect(() => { const timer = window.setTimeout(() => { setOrderFilter(orderQuery); setOrderPage(1); },350); return () => clearTimeout(timer); },[orderQuery]);
  useEffect(() => {
    let active = true;
    qualityRequest<Orders>('orders?' + new URLSearchParams({ q: orderFilter, page: String(orderPage) })).then(data => { if (active) setOrders(data); }).catch(e => { if(active) setError(e.message); });
    return () => { active = false; };
  },[orderFilter,orderPage]);
  const query = new URLSearchParams({ period,date,startDate:start,endDate:end,timeField,type,result,status,reviewStatus:review,q:search,deleted:deleted ? '1' : '0',page:String(page),...(order ? { workOrderId:order.id } : {}) }).toString();
  useEffect(() => {
    if(openingRecord)return;
    let active = true; setLoading(true); setSelected(null); ++detailRequest.current;
    qualityRequest<List>('records?' + query).then(data => { if (active) { setList(data); setSelected(data.items.find(r=>r.id===preferred.current)||linkedRecord.current||data.items[0]||null); if(page>1&&!data.items.length)setPage(1); } }).catch(e => { if(active) setError(e.message); }).finally(() => { if(active) setLoading(false); });
    return () => { active = false; };
  },[query,refresh,page,openingRecord]);
  const select = useCallback(async (id: string) => {
    linkedRecord.current=null;preferred.current=id; const sequence = ++detailRequest.current;
    try { const r = await qualityRequest<QualityRecord>('records/' + id); if(sequence === detailRequest.current) setSelected(r); }
    catch(e) { setError(e instanceof Error ? e.message : '读取失败'); }
  },[]);
  function changed(r: QualityRecord) { if(linkedRecord.current?.id===r.id)linkedRecord.current=r;preferred.current=r.id; setSelected(r); setRefresh(v => v+1); }
  function filter(action: () => void) { linkedRecord.current=null;action(); setPage(1); setError(''); }
  async function exportData(format: 'xlsx' | 'zip') {
    setExporting(true); setError('');
    try { await downloadQuality('export?' + query + '&format=' + format, format === 'xlsx' ? '质量数据.xlsx' : '质量批次档案.zip'); }
    catch(e) { setError(e instanceof Error ? e.message : '导出失败'); }
    finally { setExporting(false); }
  }
  function newRecord(t?:QualityDataType) { if(!order){setError('请先选择本次检验的生产工单');setOrdersHidden(false);}else if(t)setEditor({order,type:t});else setChooseType(true); }
  const allCount=list.counts.reduce((n,c)=>n+c._count,0);
  return <main className="hm-workbench-root qd-root">
    <AppWorkbenchHeader user={user} activeHref="/workspace/quality/data" subtitle="" menuItems={[]} hideHeader sidebarTriggerTargetId="qd-sidebar-trigger"/>
    <div className="qd-workbench">
      <header className="qd-page-head"><div className="qd-page-title"><span id="qd-sidebar-trigger"/><span className="qd-logo"><ClipboardCheck size={21}/></span><h1>质量数据</h1><nav className="qd-module-tabs" aria-label="质量数据板块"><button className={section==='records'?'active':''} aria-pressed={section==='records'} onClick={()=>setSection('records')}><ClipboardCheck size={15}/>检验记录</button><button className={section==='references'?'active':''} aria-pressed={section==='references'} onClick={()=>setSection('references')}><BookOpen size={15}/>参考数据</button></nav></div>{section==='records'&&<div className="qd-head-actions"><button onClick={()=>setRefresh(v=>v+1)} disabled={loading} aria-label="刷新检验记录"><RefreshCw size={16}/></button><details className="qd-more-menu"><summary>导出</summary><div><button onClick={()=>void exportData('xlsx')} disabled={exporting}><Download size={16}/>导出 Excel</button><button onClick={()=>void exportData('zip')} disabled={exporting}><FileArchive size={16}/>附件打包</button></div></details><button className="qd-primary" onClick={()=>newRecord()}><Plus size={17}/>新增记录</button></div>}</header>
      {section==='references'?<QualityReferenceWorkbench user={user}/>:<>
      {error&&<div role="alert" className="qd-alert error">{error}<button onClick={()=>setError('')}>关闭</button></div>}
      <div className="qd-filter-bar"><button aria-label={ordersHidden?'展开订单列表':'收起订单列表'} onClick={()=>setOrdersHidden(!ordersHidden)}><PanelLeft size={16}/></button><select aria-label="查询周期" value={period} onChange={e=>filter(()=>setPeriod(e.target.value))}><option value="today">日</option><option value="week">周</option><option value="month">月</option><option value="custom">自定义</option><option value="all">全部时间</option></select>{period==='custom'?<><input aria-label="开始日期" type="date" value={start} onChange={e=>filter(()=>setStart(e.target.value))}/><input aria-label="结束日期" type="date" value={end} onChange={e=>filter(()=>setEnd(e.target.value))}/></>:period!=='all'&&<input aria-label="基准日期" type="date" value={date} onChange={e=>filter(()=>setDate(e.target.value))}/>}<form className="qd-search-form" onSubmit={e=>{e.preventDefault();filter(()=>setSearch(q));}}><Search size={17}/><input aria-label="搜索质量内容" placeholder="检验内容、人员、班组、订单…" value={q} onChange={e=>setQ(e.target.value)}/><button>查询</button></form><button className={advanced?'active':''} aria-expanded={advanced} onClick={()=>setAdvanced(!advanced)}><SlidersHorizontal size={16}/>更多筛选{result||status||review||timeField==='createdAt'?' · 已设置':''}</button><button className={deleted?'active':''} onClick={()=>filter(()=>setDeleted(!deleted))}><Trash2 size={16}/>回收站</button></div>
      {advanced&&<div className="qd-advanced-filters"><label>时间口径<select aria-label="时间口径" value={timeField} onChange={e=>filter(()=>setTimeField(e.target.value))}><option value="inspectedAt">实际检验时间</option><option value="createdAt">系统录入时间</option></select></label><label>结论<select aria-label="筛选检验结论" value={result} onChange={e=>filter(()=>setResult(e.target.value))}><option value="">全部结论</option>{Object.entries(RESULT_LABELS).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label><label>状态<select aria-label="筛选记录状态" value={status} onChange={e=>filter(()=>setStatus(e.target.value))}><option value="">全部状态</option><option value="DRAFT">草稿</option><option value="SUBMITTED">已提交</option></select></label><label>复核<select aria-label="筛选复核状态" value={review} onChange={e=>filter(()=>setReview(e.target.value))}><option value="">全部复核</option><option value="UNREVIEWED">未复核</option><option value="APPROVED">已复核</option><option value="RETURNED">已退回</option></select></label><button onClick={()=>filter(()=>{setResult('');setStatus('');setReview('');setTimeField('inspectedAt');})}>重置更多筛选</button></div>}
      <div className="qd-scope-line"><div className="qd-type-bar"><button className={!type?'active':''} onClick={()=>filter(()=>setType(''))}>全部类型</button>{QUALITY_DATA_TYPES.map(t=><button key={t} className={type===t?'active':''} onClick={()=>filter(()=>setType(t))}>{QUALITY_LABELS[t]}</button>)}</div><div className="qd-count-chips" aria-label="记录状态快捷筛选"><button className={!status&&!result?'active':''} onClick={()=>filter(()=>{setStatus('');setResult('');})}>全部 <b>{allCount}</b></button><button className={status==='SUBMITTED'&&!result?'active':''} onClick={()=>filter(()=>{setStatus('SUBMITTED');setResult('');})}>已提交 <b>{list.counts.filter(c=>c.status==='SUBMITTED').reduce((n,c)=>n+c._count,0)}</b></button><button className={'qd-count-fail '+(result==='FAIL'?'active':'')} onClick={()=>filter(()=>{setStatus('SUBMITTED');setResult('FAIL');})}>不合格 <b>{list.counts.filter(c=>c.status==='SUBMITTED'&&c.result==='FAIL').reduce((n,c)=>n+c._count,0)}</b></button><button className={status==='DRAFT'?'active':''} onClick={()=>filter(()=>{setStatus('DRAFT');setResult('');})}>草稿 <b>{list.counts.filter(c=>c.status==='DRAFT').reduce((n,c)=>n+c._count,0)}</b></button></div></div>
      <div className={'qd-panels '+(ordersHidden?'qd-orders-hidden ':'')+(!openingRecord&&!loading&&!list.items.length&&!selected?'qd-panels-empty':'')}>
        {!ordersHidden&&<aside className="qd-orders"><div className="qd-section-title"><b>订单 / 生产批次</b><span>{orders.total}</span></div><input aria-label="搜索生产工单" placeholder="订单号、型号、工单…" value={orderQuery} onChange={e=>setOrderQuery(e.target.value)}/><button className={'qd-order-option '+(!order?'active':'')} onClick={()=>filter(()=>setOrder(null))}><b>全部工单</b><small>查看筛选范围内的检验记录</small></button>{orders.items.map(item=><button key={item.id} className={'qd-order-option '+(order?.id===item.id?'active':'')} onClick={()=>filter(()=>setOrder(item))}><b>{item.specification||item.productName}</b><span>{item.businessCode||item.code}</span><small>{item.customerName||'客户未填写'} · {item.quantity??'—'} 件{item.batchNo?' · 第 '+item.batchNo+' 批':''}</small></button>)}<div className="qd-pagination"><button disabled={orderPage<=1} onClick={()=>setOrderPage(v=>v-1)}>上一页</button><span>{orderPage}</span><button disabled={orderPage*20>=orders.total} onClick={()=>setOrderPage(v=>v+1)}>下一页</button></div></aside>}
        {!openingRecord&&!loading&&!list.items.length&&!selected?<section className="qd-start-state"><div className="qd-start-icon"><ClipboardCheck size={34}/></div><div><small>{deleted?'回收站':order?'本次检验工单':'批次质量档案'}</small><h2>{order?order.specification||order.productName:'当前范围暂无记录'}</h2><p>{order?(order.businessCode||order.code)+' · '+(order.customerName||'客户未填写'):'从左侧选择工单即可登记，也可调整日期和筛选条件。'}</p></div>{!deleted&&<div className="qd-start-types">{QUALITY_DATA_TYPES.map(t=><button key={t} onClick={()=>newRecord(t)}><ClipboardCheck size={20}/><b>{QUALITY_LABELS[t]}</b><Plus size={16}/></button>)}</div>}<p className="qd-help">{order?'检查数据与照片随本批次归档，可按日、周、月查询。':'参考参数可在顶部“参考数据”独立维护。'}</p></section>:<><section className="qd-records" aria-label="质量记录列表"><div className="qd-section-title"><b>{deleted?'回收站记录':'检验记录'}</b><span>{loading?'加载中…':list.total+' 份'}</span></div>{list.items.map(item=><button className={'qd-record-card '+(selected?.id===item.id?'active':'')} key={item.id} onClick={()=>void select(item.id)}><div><span className="qd-record-type">{QUALITY_LABELS[item.type]}</span><span className={'qd-badge '+item.result.toLowerCase()}>{RESULT_LABELS[item.result]}</span></div><strong>{item.title}</strong><p>{item.orderSnapshot.specification||item.orderSnapshot.productName}</p><footer><span>{beijingInput(item.inspectedAt).replace('T',' ')}</span><span>{item.createdByName} · {item.deletedAt?'已作废':item.status==='DRAFT'?'草稿':'已提交'}</span></footer><small>{item.attachments.filter(f=>!f.deletedAt).length} 份附件{item.orderSnapshot.batchNo?' · 第 '+item.orderSnapshot.batchNo+' 批':''}</small></button>)}<div className="qd-pagination"><button disabled={page<=1||loading} onClick={()=>setPage(v=>v-1)}>上一页</button><span>{page} / {Math.max(1,Math.ceil(list.total/20))}</span><button disabled={page*20>=list.total||loading} onClick={()=>setPage(v=>v+1)}>下一页</button></div></section><section className="qd-detail-pane">{selected?<QualityDataDetail key={selected.id+':'+selected.version} user={user} record={selected} onChanged={changed} onEdit={()=>setEditor({order:selected.orderSnapshot,type:selected.type,record:selected})} onRetest={()=>setEditor({order:selected.orderSnapshot,type:selected.type,supersedesId:selected.id})}/>:<div className="qd-empty">{loading?'正在加载记录…':'选择记录查看详情'}</div>}</section></>}
      </div></>}
    </div>
    {chooseType&&order&&<div className="qd-modal" role="dialog" aria-modal="true" aria-label="选择检验类型"><section className="qd-type-picker"><h2>这次记录哪类检验？</h2><p>{order.specification||order.productName} · {order.businessCode||order.code}</p>{QUALITY_DATA_TYPES.map(t=><button key={t} onClick={()=>{setChooseType(false);setEditor({order,type:t});}}><ClipboardCheck size={21}/>{QUALITY_LABELS[t]}<Plus size={18}/></button>)}<button onClick={()=>setChooseType(false)}>取消</button></section></div>}
    {editor&&<div className="qd-modal" role="dialog" aria-modal="true" aria-label="质量数据填写"><QualityDataEditor key={editor.record?.id||editor.type+editor.order.id} user={user} {...editor} onClose={()=>setEditor(null)} onSaved={(r,submitted)=>{changed(r);if(submitted)setEditor(null);}}/></div>}
  </main>;
}
