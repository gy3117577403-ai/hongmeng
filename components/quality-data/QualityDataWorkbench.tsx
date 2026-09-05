'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ClipboardCheck, Download, FileArchive, Plus, RefreshCw, Search, Trash2 } from 'lucide-react';
import { AppWorkbenchHeader } from '@/components/layout/AppWorkbenchHeader';
import { QUALITY_DATA_TYPES, QUALITY_LABELS, RESULT_LABELS, beijingInput, type QualityOrder, type QualityRecord, type QualityDataType } from '@/lib/quality-data';
import type { CurrentUserDTO } from '@/types';
import QualityDataEditor from './QualityDataEditor';
import QualityDataDetail from './QualityDataDetail';
import { downloadQuality, qualityRequest } from './client';
type List = { total: number; page: number; items: QualityRecord[]; counts: Array<{ result: string; status: string; _count: number }> };
type Orders = { total: number; page: number; items: QualityOrder[] };
export default function QualityDataWorkbench({ user, initialRecordId = '' }: { user: CurrentUserDTO; initialRecordId?: string }) {
  const [orders,setOrders] = useState<Orders>({ total: 0, page: 1, items: [] }), [orderPage,setOrderPage] = useState(1), [orderQuery,setOrderQuery] = useState(''), [orderFilter,setOrderFilter] = useState('');
  const [order,setOrder] = useState<QualityOrder | null>(null), [selected,setSelected] = useState<QualityRecord | null>(null);
  const [list,setList] = useState<List>({ total: 0, page: 1, items: [], counts: [] }), [page,setPage] = useState(1);
  const [period,setPeriod] = useState('month'), [date,setDate] = useState(beijingInput().slice(0,10)), [start,setStart] = useState(beijingInput().slice(0,10)), [end,setEnd] = useState(beijingInput().slice(0,10));
  const [timeField,setTimeField] = useState('inspectedAt'), [type,setType] = useState(''), [result,setResult] = useState(''), [status,setStatus] = useState(''), [review,setReview] = useState('');
  const [q,setQ] = useState(''), [search,setSearch] = useState(''), [deleted,setDeleted] = useState(false);
  const [error,setError] = useState(''), [loading,setLoading] = useState(false), [exporting,setExporting] = useState(false), [refresh,setRefresh] = useState(0);
  const [editor,setEditor] = useState<{ order: QualityOrder; type: QualityDataType; record?: QualityRecord; supersedesId?: string } | null>(null);
  const [chooseType,setChooseType] = useState(false);
  const detailRequest = useRef(0);
  useEffect(() => { const timer = window.setTimeout(() => { setOrderFilter(orderQuery); setOrderPage(1); },350); return () => clearTimeout(timer); },[orderQuery]);
  useEffect(() => {
    let active = true;
    qualityRequest<Orders>('orders?' + new URLSearchParams({ q: orderFilter, page: String(orderPage) })).then(data => { if (active) setOrders(data); }).catch(e => { if(active) setError(e.message); });
    return () => { active = false; };
  },[orderFilter,orderPage]);
  const query = new URLSearchParams({ period,date,startDate:start,endDate:end,timeField,type,result,status,reviewStatus:review,q:search,deleted:deleted ? '1' : '0',page:String(page),...(order ? { workOrderId:order.id } : {}) }).toString();
  useEffect(() => {
    let active = true; setLoading(true);
    qualityRequest<List>('records?' + query).then(data => { if (active) setList(data); }).catch(e => { if(active) setError(e.message); }).finally(() => { if(active) setLoading(false); });
    return () => { active = false; };
  },[query,refresh]);
  const select = useCallback(async (id: string) => {
    const sequence = ++detailRequest.current;
    try { const r = await qualityRequest<QualityRecord>('records/' + id); if(sequence === detailRequest.current) setSelected(r); }
    catch(e) { setError(e instanceof Error ? e.message : '读取失败'); }
  },[]);
  useEffect(() => { if(initialRecordId) void select(initialRecordId); },[initialRecordId,select]);
  function changed(r: QualityRecord) { setSelected(r); setRefresh(v => v+1); }
  function filter(action: () => void) { action(); setPage(1); }
  async function exportData(format: 'xlsx' | 'zip') {
    setExporting(true); setError('');
    try { await downloadQuality('export?' + query + '&format=' + format, format === 'xlsx' ? '质量数据.xlsx' : '质量批次档案.zip'); }
    catch(e) { setError(e instanceof Error ? e.message : '导出失败'); }
    finally { setExporting(false); }
  }
  return <main className="hm-workbench-root qd-root">
    <AppWorkbenchHeader user={user} activeHref="/workspace/quality/data" subtitle="按订单批次保存每一次检验" menuItems={[]}/>
    <div className="qd-workbench">
      <header className="qd-page-head"><div className="qd-page-title"><span className="qd-logo"><ClipboardCheck size={24}/></span><div><small>质量管理 / 批次档案</small><h1>质量数据</h1></div></div><div className="qd-head-actions"><button onClick={() => setRefresh(v=>v+1)} disabled={loading}><RefreshCw size={16}/>刷新</button><button onClick={() => void exportData('xlsx')} disabled={exporting}><Download size={16}/>导出 Excel</button><button onClick={() => void exportData('zip')} disabled={exporting}><FileArchive size={16}/>附件打包</button><button className="qd-primary" onClick={() => { if (!order) setError('请先从左侧选择本次检验的生产工单'); else setChooseType(true); }}><Plus size={17}/>新增记录</button></div></header>
      <div className="qd-metrics"><div><span>当前筛选记录</span><strong>{list.total}<small>份</small></strong></div><div><span>已提交</span><strong>{list.counts.filter(c=>c.status==='SUBMITTED').reduce((n,c)=>n+c._count,0)}</strong></div><div className="qd-metric-fail"><span>不合格记录</span><strong>{list.counts.filter(c=>c.status==='SUBMITTED'&&c.result==='FAIL').reduce((n,c)=>n+c._count,0)}</strong></div><div><span>草稿</span><strong>{list.counts.filter(c=>c.status==='DRAFT').reduce((n,c)=>n+c._count,0)}</strong></div></div>
      {error && <div role="alert" className="qd-alert error">{error}<button onClick={()=>setError('')}>关闭</button></div>}
      <div className="qd-filter-bar"><label>周期<select aria-label="查询周期" value={period} onChange={e=>filter(()=>setPeriod(e.target.value))}><option value="today">日</option><option value="week">周</option><option value="month">月</option><option value="custom">自定义</option><option value="all">全部时间</option></select></label>{period === 'custom' ? <><label>开始日期<input type="date" value={start} onChange={e=>filter(()=>setStart(e.target.value))}/></label><label>结束日期<input type="date" value={end} onChange={e=>filter(()=>setEnd(e.target.value))}/></label></> : period !== 'all' && <label>基准日期<input type="date" value={date} onChange={e=>filter(()=>setDate(e.target.value))}/></label>}<label>时间口径<select value={timeField} onChange={e=>filter(()=>setTimeField(e.target.value))}><option value="inspectedAt">实际检验时间</option><option value="createdAt">系统录入时间</option></select></label><form className="qd-search-form" onSubmit={e=>{e.preventDefault();filter(()=>setSearch(q));}}><Search size={17}/><input aria-label="搜索质量内容" placeholder="订单、型号、人员、班组、工序、内容…" value={q} onChange={e=>setQ(e.target.value)}/><button>查询</button></form><button className={deleted?'active':''} onClick={()=>filter(()=>{setDeleted(!deleted);setSelected(null);})}><Trash2 size={16}/>回收站</button></div>
      <div className="qd-type-bar"><button className={!type?'active':''} onClick={()=>filter(()=>setType(''))}>全部类型</button>{QUALITY_DATA_TYPES.map(t=><button key={t} className={type===t?'active':''} onClick={()=>filter(()=>setType(t))}>{QUALITY_LABELS[t]}</button>)}<select aria-label="筛选检验结论" value={result} onChange={e=>filter(()=>setResult(e.target.value))}><option value="">全部结论</option>{Object.entries(RESULT_LABELS).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select><select aria-label="筛选记录状态" value={status} onChange={e=>filter(()=>setStatus(e.target.value))}><option value="">全部状态</option><option value="DRAFT">草稿</option><option value="SUBMITTED">已提交</option></select><select aria-label="筛选复核状态" value={review} onChange={e=>filter(()=>setReview(e.target.value))}><option value="">全部复核</option><option value="UNREVIEWED">未复核</option><option value="APPROVED">已复核</option><option value="RETURNED">已退回</option></select></div>
      <div className="qd-panels">
        <aside className="qd-orders"><div className="qd-section-title"><b>订单 / 生产批次</b><span>{orders.total}</span></div><input aria-label="搜索生产工单" placeholder="搜索订单号、型号、工单…" value={orderQuery} onChange={e=>setOrderQuery(e.target.value)}/><button className={'qd-order-option '+(!order?'active':'')} onClick={()=>filter(()=>setOrder(null))}><b>全部工单</b><small>按右侧条件查询质量记录</small></button>{orders.items.map(item=><button key={item.id} className={'qd-order-option '+(order?.id===item.id?'active':'')} onClick={()=>filter(()=>setOrder(item))}><small>{item.sourceOrderNo || '历史工单'}{item.batchNo?' · 第 '+item.batchNo+' 批':''}</small><b>{item.specification || item.productName}</b><span>{item.businessCode || item.code}</span><small>{item.customerName || '客户未填写'} · {item.quantity ?? '—'} 件</small></button>)}<div className="qd-pagination"><button disabled={orderPage<=1} onClick={()=>setOrderPage(v=>v-1)}>上一页</button><span>{orderPage}</span><button disabled={orderPage*20>=orders.total} onClick={()=>setOrderPage(v=>v+1)}>下一页</button></div></aside>
        <section className="qd-records" aria-label="质量记录列表"><div className="qd-section-title"><b>{order ? order.specification || order.productName : deleted ? '回收站记录' : '检验记录'}</b><span>{loading?'加载中…':list.total+' 份'}</span></div>{list.items.map(item=><button className={'qd-record-card '+(selected?.id===item.id?'active':'')} key={item.id} onClick={()=>void select(item.id)}><div><span className="qd-record-type">{QUALITY_LABELS[item.type]}</span><span className={'qd-badge '+item.result.toLowerCase()}>{RESULT_LABELS[item.result]}</span></div><strong>{item.title}</strong><p>{item.orderSnapshot.specification || item.orderSnapshot.productName}</p><small>{item.orderSnapshot.sourceOrderNo || item.orderSnapshot.code}{item.orderSnapshot.batchNo?' · 第 '+item.orderSnapshot.batchNo+' 批':''}</small><footer><span>{beijingInput(item.inspectedAt).replace('T',' ')}</span><span>{item.createdByName} · {item.deletedAt?'已作废':item.status==='DRAFT'?'草稿':'已提交'}</span></footer></button>)}{!loading&&!list.items.length&&<div className="qd-empty"><ClipboardCheck size={38}/><b>当前范围暂无记录</b><span>可调整日期或选择工单新增检验</span></div>}<div className="qd-pagination"><button disabled={page<=1||loading} onClick={()=>setPage(v=>v-1)}>上一页</button><span>{page} / {Math.max(1,Math.ceil(list.total/20))}</span><button disabled={page*20>=list.total||loading} onClick={()=>setPage(v=>v+1)}>下一页</button></div></section>
        <section className="qd-detail-pane">{selected?<QualityDataDetail key={selected.id+':'+selected.version} user={user} record={selected} onChanged={changed} onEdit={()=>setEditor({order:selected.orderSnapshot,type:selected.type,record:selected})} onRetest={()=>setEditor({order:selected.orderSnapshot,type:selected.type,supersedesId:selected.id})}/>:<div className="qd-empty qd-detail-empty"><FileArchive size={48}/><h2>一批订单，一份完整质量档案</h2><p>选择记录，查看检验数据、原始附件与修订历史。</p><div>端子压检 · 拉力测试 · 成品检验 · 首检 · 巡检</div></div>}</section>
      </div>
    </div>
    {chooseType&&order&&<div className="qd-modal" role="dialog" aria-modal="true" aria-label="选择检验类型"><section className="qd-type-picker"><h2>这次记录哪类检验？</h2><p>{order.specification || order.productName} · {order.businessCode || order.code}</p>{QUALITY_DATA_TYPES.map(t=><button key={t} onClick={()=>{setChooseType(false);setEditor({order,type:t});}}><ClipboardCheck size={21}/>{QUALITY_LABELS[t]}<Plus size={18}/></button>)}<button onClick={()=>setChooseType(false)}>取消</button></section></div>}
    {editor&&<div className="qd-modal" role="dialog" aria-modal="true" aria-label="质量数据填写"><QualityDataEditor key={editor.record?.id || editor.type+editor.order.id} user={user} {...editor} onClose={()=>setEditor(null)} onSaved={(r,submitted)=>{changed(r);if(submitted)setEditor(null);}}/></div>}
  </main>;
}
