'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ClipboardCheck, ChevronRight, Plus } from 'lucide-react';
import { QUALITY_DATA_TYPES, QUALITY_LABELS, RESULT_LABELS, beijingInput, type QualityOrder, type QualityRecord, type QualityDataType } from '@/lib/quality-data';
import type { CurrentUserDTO } from '@/types';
import QualityScanTabs from './QualityScanTabs';
import QualityDataEditor from './QualityDataEditor';
import QualityDataDetail from './QualityDataDetail';
import { qualityRequest } from './client';
export default function QualityDataMobile({ code,user }: { code: string; user: CurrentUserDTO }) {
  const [order,setOrder] = useState<QualityOrder|null>(null),[items,setItems] = useState<QualityRecord[]>([]),[error,setError] = useState(''),[message,setMessage] = useState('');
  const [edit,setEdit] = useState<{type:QualityDataType;record?:QualityRecord;supersedesId?:string}|null>(null),[selected,setSelected] = useState<QualityRecord|null>(null),[refresh,setRefresh] = useState(0);
  useEffect(()=>{setOrder(null);setItems([]);setEdit(null);setSelected(null);setError('');setMessage('');},[code]);
  useEffect(()=>{
    let active=true;
    qualityRequest<QualityOrder>('qr/'+encodeURIComponent(code)).then(async value=>{
      if(!active)return;setOrder(value);
      const records=await qualityRequest<{items:QualityRecord[]}>('records?period=all&workOrderId='+encodeURIComponent(value.id));
      if(active)setItems(records.items);
    }).catch(e=>{if(active)setError(e.message);});
    return()=>{active=false;};
  },[code,refresh]);
  function saved(r:QualityRecord,submitted:boolean){setRefresh(v=>v+1);if(submitted){setEdit(null);setSelected(r);setMessage('记录已提交，后台质量数据已同步');}}
  return <main className="qd-mobile-root">
    <header className="qd-mobile-header"><div><ClipboardCheck size={20}/><b>质量现场填报</b></div><span>{user.displayName || user.username}</span></header>
    <QualityScanTabs code={code} active="quality" canReport={user.access.capabilities.includes('FIELD_REPORT:READ')}/>
    {error&&<div role="alert" className="qd-alert error">{error}</div>}
    {message&&<div role="status" className="qd-alert success">{message}</div>}
    {!order&&!error&&<p className="qd-help">正在读取工单…</p>}
    {order&&<div className="qd-mobile-content"><section className="qd-mobile-order"><small>本次检验工单</small><h1>{order.specification || order.productName}</h1><b>{order.businessCode || order.code}</b><p>{order.customerName || '客户未填写'} · {order.sourceOrderNo || '历史工单'}{order.batchNo?' · 第 '+order.batchNo+' 批':''}</p><div><span>计划数量 <strong>{order.quantity ?? '—'}</strong></span><span>{order.stage==='completed'?'已完工 · 可记录成品检验 / 复检':'按实际检查时间登记'}</span></div></section>
      {!selected&&<><div className="qd-section-title"><b>新增质量记录</b><span>选择检验类型</span></div><div className="qd-mobile-types">{QUALITY_DATA_TYPES.map((t,i)=><button key={t} onClick={()=>setEdit({type:t})}><span className="qd-type-number">{String(i+1).padStart(2,'0')}</span><div><b>{QUALITY_LABELS[t]}</b><small>{t==='CRIMP'?'尺寸、外观、剖面与照片':t==='PULL'?'逐样本记录测试数据':t==='FINAL'?'本批成品检查与结论':t==='FIRST'?'开工、换模或调整后的首件':'过程检查、异常与处理情况'}</small></div><Plus size={20}/></button>)}</div><div className="qd-section-title"><b>本工单最近记录</b><Link href={'/workspace/quality/data'}>全部档案</Link></div>{items.map(r=><button className="qd-mobile-record" key={r.id} onClick={()=>setSelected(r)}><div><b>{r.title}</b><small>{beijingInput(r.inspectedAt).replace('T',' ')} · {r.createdByName}</small></div><span className={'qd-badge '+r.result.toLowerCase()}>{r.status==='DRAFT'?'草稿':RESULT_LABELS[r.result]}</span><ChevronRight size={17}/></button>)}{!items.length&&<p className="qd-help">还没有质量记录，从上方选择类型开始填写。</p>}</>}
      {selected&&<><button className="qd-mobile-back" onClick={()=>setSelected(null)}>返回检验类型</button><QualityDataDetail key={selected.id+selected.version} user={user} record={selected} onChanged={r=>{setSelected(r);setRefresh(v=>v+1);}} onEdit={()=>setEdit({type:selected.type,record:selected})} onRetest={()=>setEdit({type:selected.type,supersedesId:selected.id})}/></>}
    </div>}
    {edit&&order&&<div className="qd-modal" role="dialog" aria-modal="true" aria-label="手机质量填报"><QualityDataEditor user={user} order={order} {...edit} sourceQrCode={code} onClose={()=>setEdit(null)} onSaved={saved}/></div>}
  </main>;
}
