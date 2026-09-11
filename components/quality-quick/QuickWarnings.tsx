'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, ShieldAlert, X, ZoomIn } from 'lucide-react';
import { useModalLayer } from '@/components/useModalLayer';
import type { QuickQualityDTO, QuickQualityPhoto } from '@/lib/quality-quick-shared';
import './quick-quality.css';

export function QuickPhotoViewer({photos,index,onClose}:{photos:QuickQualityPhoto[];index:number;onClose:()=>void}) {
  const [at,setAt]=useState(index),[zoom,setZoom]=useState(false),ref=useRef<HTMLDivElement>(null);
  const [mounted,setMounted]=useState(false);
  useEffect(()=>setMounted(true),[]);
  useModalLayer({open:mounted,layerRef:ref,onClose});
  if(!mounted)return null;
  const photo=photos[at];
  return createPortal(<div ref={ref} className="qq-lightbox" role="dialog" aria-modal="true" aria-label="现场图片" tabIndex={-1}>
    <header><span>{at+1} / {photos.length} · {photo.name}</span><button onClick={()=>setZoom(!zoom)} aria-label="切换图片缩放"><ZoomIn/></button><button onClick={onClose} aria-label="关闭图片"><X/></button></header>
    <div className={'qq-lightbox-image '+(zoom?'zoom':'')}><img src={photo.url} alt={photo.name}/></div>
    {photos.length>1&&<footer><button onClick={()=>{setAt((at-1+photos.length)%photos.length);setZoom(false);}} aria-label="上一张"><ChevronLeft/></button><button onClick={()=>{setAt((at+1)%photos.length);setZoom(false);}} aria-label="下一张"><ChevronRight/></button></footer>}
  </div>,document.body);
}
export function QuickWarningCards({rows}:{rows:QuickQualityDTO[]}) {
  const [view,setView]=useState<{photos:QuickQualityPhoto[];index:number}|null>(null);
  return <div className="qq-warning-list">{rows.map(r=><details className="qq-warning" key={r.id}>
    <summary><ShieldAlert size={18}/><div><b>{r.description.split('\n')[0]}</b><small>普通异常 · {r.scope==='PRODUCT'?'关联图纸':'当前工单'}{r.processName?' · '+r.processName:''}</small></div><span>{r.photos.length} 图</span></summary>
    <div className="qq-warning-content"><p>{r.description}</p><div className="qq-photo-strip">{r.photos.map((p,i)=><button key={p.id} onClick={()=>setView({photos:r.photos,index:i})}><img src={p.url} alt={p.name}/></button>)}</div><small>{r.author} · {new Date(r.updatedAt).toLocaleString('zh-CN')}</small></div>
  </details>)}{view&&<QuickPhotoViewer {...view} onClose={()=>setView(null)}/>}</div>;
}
export default function QuickWarnings({workOrderId,productId,manage=false}:{workOrderId?:string;productId?:string;manage?:boolean}) {
  const [rows,setRows]=useState<QuickQualityDTO[]>([]),[error,setError]=useState(''),generation=useRef(0);
  const load=useCallback(async()=>{
    if(!workOrderId&&!productId)return;
    const current=++generation.current;
    try{const r=await fetch('/api/quality-quick/warnings?'+new URLSearchParams(workOrderId?{workOrderId}:{productId:productId!}),{cache:'no-store'});const b=await r.json();if(!r.ok)throw new Error(b.error||'警示加载失败');if(current===generation.current){setRows(b.rows);setError('');}}catch{if(current===generation.current)setError('质量快处提醒暂未加载，点击重试');}
  },[workOrderId,productId]);
  useEffect(()=>{setRows([]);void load();const tick=()=>{if(document.visibilityState==='visible')void load();};const id=setInterval(tick,30000);window.addEventListener('focus',tick);window.addEventListener('quality-quick-changed',tick);return()=>{generation.current++;clearInterval(id);window.removeEventListener('focus',tick);window.removeEventListener('quality-quick-changed',tick);};},[load]);
  if(!rows.length&&!error&&!manage)return null;
  return <section className="qq-inline-warnings">{error?<button className="qq-inline-error" onClick={()=>void load()}>{error}</button>:<QuickWarningCards rows={rows}/>}
    {manage&&workOrderId&&<a className="qq-inline-create" href={'/workspace/quality/quick?new=1&workOrderId='+encodeURIComponent(workOrderId)}>＋ 快速记录图纸异常</a>}
  </section>;
}
