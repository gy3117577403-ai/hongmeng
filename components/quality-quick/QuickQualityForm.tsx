'use client';
import { useEffect, useRef, useState } from 'react';
import { Camera, ImagePlus, Loader2, Search, X } from 'lucide-react';
import { useModalLayer } from '@/components/useModalLayer';
import type { QuickQualityDTO, QuickDrawingOption } from '@/lib/quality-quick-shared';
import QuickPhotoAnnotator from './QuickPhotoAnnotator';
const today=()=>new Date(Date.now()+8*3600000).toISOString().slice(0,10);
export default function QuickQualityForm({record,workOrderId,code,productId,onClose,onSaved}:{record?:QuickQualityDTO;workOrderId?:string;code?:string;productId?:string;onClose:()=>void;onSaved:(record:QuickQualityDTO)=>void}) {
  const [description,setDescription]=useState(record?.description||''),[drawing,setDrawing]=useState<QuickDrawingOption|null>(record?.drawing||null),[sourceOrderIds,setSourceOrderIds]=useState<string[]>(record?.orders.map(o=>o.id)||[]),[search,setSearch]=useState(''),[options,setOptions]=useState<QuickDrawingOption[]>([]);
  const [date,setDate]=useState(record?new Date(new Date(record.occurredAt).getTime()+8*3600000).toISOString().slice(0,10):today()),[until,setUntil]=useState(record?.effectiveUntil?.slice(0,10)||''),[process,setProcess]=useState(record?.processName||''),[print,setPrint]=useState(record?record.printPolicy!=='SYSTEM_ONLY':true);
  const [photos,setPhotos]=useState(record?.photos||[]),[files,setFiles]=useState<Array<{file:File;url:string}>>([]),[annotate,setAnnotate]=useState<File|null>(null);
  const [busy,setBusy]=useState(false),[progress,setProgress]=useState(''),[error,setError]=useState(''),[dirty,setDirty]=useState(false);
  const layer=useRef<HTMLDivElement>(null),camera=useRef<HTMLInputElement>(null),album=useRef<HTMLInputElement>(null),key=useRef(crypto.randomUUID()),urls=useRef<string[]>([]),request=useRef<XMLHttpRequest|null>(null),preselectDone=useRef(false);
  function close(){if(!busy&&(!dirty||window.confirm('内容尚未保存，确定离开？')))onClose();}
  useModalLayer({open:true,layerRef:layer,onClose:close,interactionEnabled:!annotate});
  useEffect(()=>()=>{urls.current.forEach(u=>URL.revokeObjectURL(u));request.current?.abort();},[]);
  useEffect(()=>{if(!dirty)return;const unload=(e:BeforeUnloadEvent)=>{e.preventDefault();e.returnValue='';};window.addEventListener('beforeunload',unload);return()=>window.removeEventListener('beforeunload',unload);},[dirty]);
  useEffect(()=>{const a=new AbortController();const timer=setTimeout(async()=>{try{const initial=!record&&!drawing&&!search&&!preselectDone.current;const query=new URLSearchParams({q:search,...(initial&&workOrderId?{ids:workOrderId}:{}),...(initial&&code?{code}:{}),...(initial&&productId?{productId}:{})});const r=await fetch('/api/quality-quick/options?'+query,{signal:a.signal});const b=await r.json();if(!r.ok)throw new Error(b.error);setOptions(b.rows);if(initial&&(workOrderId||code||productId)&&b.rows.length===1){preselectDone.current=true;setDrawing(b.rows[0]);setSourceOrderIds(b.sourceOrderIds||[]);}}catch(e){if(!a.signal.aborted)setError(e instanceof Error?e.message:'图纸加载失败');}},200);return()=>{clearTimeout(timer);a.abort();};},[search,record,workOrderId,code,productId,drawing]);

  function changed(){setDirty(true);key.current=crypto.randomUUID();setError('');}
  function addFiles(incoming:File[]){if(busy)return;const valid=incoming.filter(f=>/^image\/(jpeg|png|webp)$/.test(f.type)||/\.(jpe?g|png|webp)$/i.test(f.name));if(valid.length!==incoming.length){setError('支持 JPG、PNG、WEBP 照片');return;}if(valid.some(f=>f.size>20*1024*1024)||valid.reduce((n,f)=>n+f.size,files.reduce((n,x)=>n+x.file.size,0))>32*1024*1024){setError('单张最多 20 MB，本次照片总大小最多 32 MB');return;}if(photos.length+files.length+valid.length>12){setError('每条记录最多 12 张照片');return;}changed();setFiles(current=>[...current,...valid.map(file=>{const url=URL.createObjectURL(file);urls.current.push(url);return{file,url};})]);}
  async function save(publish:boolean){
    if(busy)return;
    if(!drawing||!description.trim()){setError('请选择图纸，并填写问题与处理说明');return;}
    setBusy(true);setError('');setProgress(files.length?'正在上传照片…':'正在保存…');
    try{
      const form=new FormData();form.set('data',JSON.stringify({id:record?.id,version:record?.version,mutationKey:key.current,description,productId:drawing.id,orderIds:sourceOrderIds,occurredAt:date,effectiveUntil:until,processName:process,printPolicy:print?(record?.printPolicy==='OPTIONAL'?'OPTIONAL':'REQUIRED'):'SYSTEM_ONLY',keepPhotoIds:photos.map(p=>p.id),publish}));files.forEach(({file})=>form.append('photos',file));
      const result=await new Promise<{record:QuickQualityDTO}>((resolve,reject)=>{const xhr=new XMLHttpRequest();request.current=xhr;xhr.open('POST','/api/quality-quick');xhr.timeout=120000;xhr.upload.onprogress=e=>{if(e.lengthComputable)setProgress(e.loaded===e.total?'正在保存记录…':'照片上传 '+Math.round(e.loaded/e.total*100)+'%');};xhr.onerror=()=>reject(new Error('网络中断，内容已保留，请重试'));xhr.ontimeout=()=>reject(new Error('上传超时，内容已保留，请重试'));xhr.onabort=()=>reject(new Error('上传已取消'));xhr.onload=()=>{try{const b=JSON.parse(xhr.responseText);if(xhr.status>=400||!b.ok)reject(new Error(b.error||'保存失败'));else resolve(b);}catch{reject(new Error('服务器暂时无法响应，内容已保留'));}};xhr.send(form);});
      setDirty(false);window.dispatchEvent(new Event('quality-quick-changed'));onSaved(result.record);
    }catch(e){setError(e instanceof Error?e.message:'保存失败');}finally{setBusy(false);setProgress('');}
  }
  return <div className="qq-modal" ref={layer} tabIndex={-1}><section className="qq-form" role="dialog" aria-modal="true" aria-label={record?'编辑快处记录':'快速记录异常'}>
    <header><div><small>品质现场记录</small><h2>{record?'编辑快处记录':'快速记录异常'}</h2></div><button aria-label="关闭表单" disabled={busy} onClick={close}><X/></button></header>
    <div className="qq-form-scroll" onPaste={e=>{const f=Array.from(e.clipboardData.files);if(f.length){e.preventDefault();addFiles(f);}}} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();addFiles(Array.from(e.dataTransfer.files));}}>
      <fieldset disabled={busy}>
      <label>关联图纸 <span className="qq-required">*</span></label><div className="qq-selected-orders">{drawing&&<span><b>{drawing.specification}</b> {drawing.customerName} · {drawing.productName}<button aria-label="更换关联图纸" onClick={()=>{changed();preselectDone.current=true;setDrawing(null);setSourceOrderIds([]);setSearch('');}}>×</button></span>}</div>
      <div className="qq-search"><Search size={17}/><input aria-label="搜索关联图纸" placeholder="搜索客户、产品或图号 / 规格" value={search} onChange={e=>setSearch(e.target.value)}/></div>
      {(!drawing||search.trim())&&<div className="qq-order-options">{options.map(o=><button key={o.id} onClick={()=>{changed();setDrawing(o);setSourceOrderIds([]);setSearch('');}}><b>{o.specification}</b><span>{o.customerName} · {o.productName}</span></button>)}{!options.length&&<p>没有匹配图纸，试试其他关键词</p>}</div>}
      <small>发布后进入图纸的质量异常，关联订单及后续新订单自动带出。</small>
      <label htmlFor="qq-description">问题与处理说明 <span className="qq-required">*</span></label><textarea id="qq-description" value={description} maxLength={3000} rows={4} placeholder="例如：端子方向装反，现场已纠正。后续装配注意卡扣朝外。" onChange={e=>{changed();setDescription(e.target.value);}}/>
      <label>现场图片 <small>支持多张，可直接拍照</small></label>
      <div className="qq-upload-actions"><button onClick={()=>camera.current?.click()}><Camera size={19}/>拍照</button><button onClick={()=>album.current?.click()}><ImagePlus size={19}/>选择图片</button><small>也可粘贴或拖入图片</small></div>
      <input ref={camera} hidden type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={e=>{addFiles(Array.from(e.target.files||[]));e.target.value='';}}/><input ref={album} hidden type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={e=>{addFiles(Array.from(e.target.files||[]));e.target.value='';}}/>
      <div className="qq-upload-grid">{photos.map(p=><div key={p.id}><img src={p.url} alt={p.name}/><button className="qq-remove-photo" aria-label={'移除 '+p.name} onClick={()=>{changed();setPhotos(photos.filter(x=>x.id!==p.id));}}>×</button></div>)}{files.map((p,i)=><div key={p.url}><img src={p.url} alt={p.file.name}/><button className="qq-remove-photo" aria-label={'移除 '+p.file.name} onClick={()=>{changed();setFiles(files.filter((_,n)=>n!==i));}}>×</button><button className="qq-mark-photo" onClick={()=>setAnnotate(p.file)}>标注</button></div>)}</div>
      <details className="qq-settings"><summary>补充信息与打印设置</summary>
      <div className="qq-form-pair"><label>发生日期<input type="date" value={date} onChange={e=>{changed();setDate(e.target.value);}}/></label><label>涉及工序<input value={process} placeholder="需要时填写" onChange={e=>{changed();setProcess(e.target.value);}}/></label></div>
      <label>警示到期日期<input type="date" value={until} onChange={e=>{changed();setUntil(e.target.value);}}/></label><small>留空则由品质主动下线。</small>
      <label className="qq-check"><input type="checkbox" checked={print} onChange={e=>{changed();setPrint(e.target.checked);}}/>随工单打印异常告知</label>
      </details></fieldset>
    </div>
    <footer>{error&&<p className="qq-error" role="alert">{error}</p>}{busy&&<p role="status"><Loader2 size={16} className="spin"/>{progress}</p>}<div>{record?.state!=='ACTIVE'&&<button disabled={busy} onClick={()=>void save(false)}>仅保存记录</button>}<button className="qq-primary" disabled={busy} onClick={()=>void save(true)}>{record?.state==='ACTIVE'?'保存并更新警示':'保存并发布警示'}</button></div></footer>
  </section>{annotate&&<QuickPhotoAnnotator file={annotate} onClose={()=>setAnnotate(null)} onDone={file=>{addFiles([file]);setAnnotate(null);}}/>}</div>;
}
