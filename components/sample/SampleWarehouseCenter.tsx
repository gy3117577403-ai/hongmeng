'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, ChevronLeft, ChevronRight, Loader2, PackageCheck, RefreshCw, Search, X } from 'lucide-react';
import { AppWorkbenchHeader } from '@/components/layout/AppWorkbenchHeader';
import { SampleBranchControls, sampleRequest } from './SampleBranchControls';
import SampleMaterialsPanel from './SampleMaterialsPanel';
import { sampleCurrentWeek } from '@/lib/sample-plan-domain';
import { sampleKittingState, sampleTaskHref } from '@/lib/sample-workbench-view';
import type { CurrentUserDTO, SampleTaskDTO } from '@/types';
import '@/app/sample-branches.css';
import '@/app/sample-planning-warehouse.css';

const statuses = [['','全部'],['pending','待配料'],['exception','缺料'],['completed','已配齐']] as const;
export default function SampleWarehouseCenter({ user }: { user: CurrentUserDTO }) {
  const [type,setType]=useState<'NEW'|'REPEAT'|''>(''),[week,setWeek]=useState(sampleCurrentWeek),[carry,setCarry]=useState(false);
  const [keyword,setKeyword]=useState(''),[search,setSearch]=useState(''),[customer,setCustomer]=useState(''),[status,setStatus]=useState('');
  const [tasks,setTasks]=useState<SampleTaskDTO[]>([]),[customers,setCustomers]=useState<string[]>([]),[selected,setSelected]=useState<SampleTaskDTO|null>(null);
  const [page,setPage]=useState(1),[pagination,setPagination]=useState({page:1,pageSize:20,total:0,totalPages:1}),[counts,setCounts]=useState<Record<string,number>>({});
  const [refresh,setRefresh]=useState(0),[ready,setReady]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState('');
  const focus=useRef<string|null>(null),listRef=useRef<HTMLDivElement>(null);
  useEffect(()=>{const timer=setTimeout(()=>{setSearch(keyword.trim());setPage(1);},280);return()=>clearTimeout(timer);},[keyword]);
  useEffect(()=>{
    const id=new URLSearchParams(window.location.search).get('taskId'),ctrl=new AbortController();
    if(!id){setReady(true);return;}
    sampleRequest(`/api/sample-tasks/${encodeURIComponent(id)}`,{signal:ctrl.signal}).then(body=>{
      setWeek(body.task.planWeekStartDate||'');setType(body.task.taskType||'NEW');focus.current=id;setSelected(body.task);
    }).catch(e=>{if(e.name!=='AbortError')setError(e.message);}).finally(()=>{if(!ctrl.signal.aborted)setReady(true);});
    return()=>ctrl.abort();
  },[]);
  useEffect(()=>{
    if(!ready)return;
    const ctrl=new AbortController(),query=new URLSearchParams({warehouse:'true',summary:'true',view:'ALL',page:String(page),pageSize:'20',week,taskType:type,keyword:search,customer,materialStatus:status,carry:String(carry),sort:'due_asc'});
    if(focus.current)query.set('focusId',focus.current);
    setLoading(true);
    sampleRequest(`/api/sample-tasks?${query}`,{signal:ctrl.signal}).then(body=>{
      setTasks(body.tasks);setCustomers(body.customers);setCounts(body.materialCounts||{});setPagination(body.pagination);setPage(body.pagination.page);
      setSelected(prior=>body.tasks.find((t:SampleTaskDTO)=>t.id===(focus.current||prior?.id))||body.tasks[0]||null);
      focus.current=null;setError('');
    }).catch(e=>{if(e.name!=='AbortError'){setError(e.message);focus.current=null;}}).finally(()=>{if(!ctrl.signal.aborted)setLoading(false);});
    return()=>ctrl.abort();
  },[ready,page,week,type,carry,search,customer,status,refresh]);
  useEffect(()=>{listRef.current?.scrollTo({top:0});},[page,week,type,status,customer,search]);
  const changeFilter=(fn:()=>void)=>{focus.current=null;setPage(1);fn();};
  return <main className="hm-workbench-root hm-workbench-navigation-overlay sw-page">
    <AppWorkbenchHeader user={user} activeHref="/workspace/warehouse" subtitle="样品配料" menuItems={[]} hideHeader sidebarTriggerTargetId="sample-warehouse-sidebar"/>
    <div className="sw-main">
      <header className="sw-commandbar"><div id="sample-warehouse-sidebar"/><h1>仓库配料</h1><nav aria-label="配料业务"><Link prefetch={false} href="/workspace/warehouse">量产配料</Link><span aria-current="page">样品配料</span></nav><div className="sw-header-actions"><Link prefetch={false} href="/weekly-plan-center?branch=samples">样品计划<ArrowUpRight size={15}/></Link><button aria-label="刷新样品配料" onClick={()=>setRefresh(v=>v+1)} disabled={loading}><RefreshCw size={16}/>刷新</button></div></header>
      <SampleBranchControls warehouse type={type} week={week} carry={carry} refresh={refresh} onChange={(kind,next,include)=>changeFilter(()=>{setType(kind);setWeek(next);setCarry(include);})}/>
      <section className="sw-filters"><nav aria-label="配料状态">{statuses.map(([value,label])=><button key={value} className={status===value?'active':''} aria-pressed={status===value} onClick={()=>changeFilter(()=>setStatus(value))}>{label}<b>{counts[value||'all']??'—'}</b></button>)}</nav><label className="sw-search"><Search size={16}/><input aria-label="搜索样品配料" placeholder="搜索客户、产品型号、任务编号" value={keyword} onChange={e=>setKeyword(e.target.value)}/>{keyword&&<button aria-label="清空搜索" onClick={()=>setKeyword('')}><X size={14}/></button>}</label><select aria-label="配料客户" value={customer} onChange={e=>changeFilter(()=>setCustomer(e.target.value))}><option value="">全部客户</option>{customers.map(name=><option key={name}>{name}</option>)}</select></section>
      <section className="sw-workspace" aria-busy={loading}>
        <aside className="sw-task-list"><header><strong>配料任务</strong><span>{pagination.total} 项{loading&&<Loader2 size={13} className="spin"/>}</span></header><div ref={listRef} className="sw-task-scroll">
          {tasks.map(task=>{const kit=sampleKittingState(task.materialStatus);return <button key={task.id} className={selected?.id===task.id?'active':''} aria-pressed={selected?.id===task.id} onClick={()=>setSelected(task)}><small>{task.customerName}<em>{task.taskType==='REPEAT'?'老产品':'新品'}</em></small><strong title={task.specification}>{task.specification}</strong><p>{task.productName||'样品任务'} · {task.sampleQuantity??'—'} 件 / 套</p><footer><span className={`sp-badge ${kit.tone}`}>{kit.label}</span><span>交期 {task.dueDate?.slice(5)||'未设置'}</span></footer></button>;})}
          {!tasks.length&&!loading&&<div className="sw-empty"><PackageCheck size={30}/><strong>当前筛选没有配料任务</strong><span>可切换计划周或搜索条件。</span></div>}
        </div><footer className="sw-pagination"><button aria-label="上一页配料" disabled={loading||page<=1} onClick={()=>setPage(v=>v-1)}><ChevronLeft size={17}/></button><span>{pagination.page} / {pagination.totalPages}</span><button aria-label="下一页配料" disabled={loading||page>=pagination.totalPages} onClick={()=>setPage(v=>v+1)}><ChevronRight size={17}/></button></footer></aside>
        <section className="sw-detail">{selected?<><header className="sw-task-head"><div><small>{selected.customerName} · {selected.taskType==='REPEAT'?'老产品制作':'新品试制'}</small><h2>{selected.specification}</h2><p>{selected.code}<span>计划 {selected.sampleQuantity??'—'} 件 / 套</span><span>计划完成 {selected.plannedCompletionDate||'未设置'}</span><span>客户交期 {selected.dueDate||'未设置'}</span></p></div><Link prefetch={false} href={sampleTaskHref('/production',selected.id)}>样品任务<ArrowUpRight size={15}/></Link></header><SampleMaterialsPanel task={selected} user={user} refresh={refresh} onChanged={()=>setRefresh(v=>v+1)}/></>:<div className="sw-empty"><PackageCheck size={36}/><strong>{loading?'正在读取配料任务…':'选择样品查看配料情况'}</strong></div>}</section>
      </section>
    </div>{error&&<div role="alert" className="sb-toast sb-error">{error}<button onClick={()=>{setError('');setRefresh(v=>v+1);}}>重试</button><button aria-label="关闭错误提示" onClick={()=>setError('')}>×</button></div>}
  </main>;
}
