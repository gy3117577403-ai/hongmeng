'use client';
import { useEffect, useRef, useState } from 'react';
import { Camera, ImagePlus, Loader2, Search, X } from 'lucide-react';
import { useModalLayer } from '@/components/useModalLayer';
import type { QuickQualityDTO } from '@/lib/quality-quick-shared';
import QuickPhotoAnnotator from './QuickPhotoAnnotator';
type Order={id:string;code:string;businessCode?:string|null;productName:string;specification:string|null;drawingLibraryItemId?:string|null};
const today=()=>new Date(Date.now()+8*3600000).toISOString().slice(0,10);
export default function QuickQualityForm({record,workOrderId,code,onClose,onSaved}:{record?:QuickQualityDTO;workOrderId?:string;code?:string;onClose:()=>void;onSaved:(record:QuickQualityDTO)=>void}) {
  const [description,setDescription]=useState(record?.description||''),[orders,setOrders]=useState<Order[]>(record?.orders||[]),[search,setSearch]=useState(''),[options,setOptions]=useState<Order[]>([]);
  const [scope,setScope]=useState(record?.scope||'WORK_ORDER'),[date,setDate]=useState(record?new Date(new Date(record.occurredAt).getTime()+8*3600000).toISOString().slice(0,10):today()),[until,setUntil]=useState(record?.effectiveUntil?.slice(0,10)||''),[process,setProcess]=useState(record?.processName||''),[print,setPrint]=useState(record?.printPolicy==='OPTIONAL');
  const [photos,setPhotos]=useState(record?.photos||[]),[files,setFiles]=useState<Array<{file:File;url:string}>>([]),[annotate,setAnnotate]=useState<File|null>(null);
  const [busy,setBusy]=useState(false),[progress,setProgress]=useState(''),[error,setError]=useState(''),[dirty,setDirty]=useState(false),[scopeConfirmed,setScopeConfirmed]=useState(false);
  const layer=useRef<HTMLDivElement>(null),camera=useRef<HTMLInputElement>(null),album=useRef<HTMLInputElement>(null),key=useRef(crypto.randomUUID()),urls=useRef<string[]>([]),request=useRef<XMLHttpRequest|null>(null);
  function close(){if(!busy&&(!dirty||window.confirm('内容尚未保存，确定离开？')))onClose();}
  useModalLayer({open:true,layerRef:layer,onClose:close});
  useEffect(()=>()=>{urls.current.forEach(u=>URL.revokeObjectURL(u));request.current?.abort();},[]);
  useEffect(()=>{if(!dirty)return;const unload=(e:BeforeUnloadEvent)=>{e.preventDefault();e.returnValue='';};window.addEventListener('beforeunload',unload);return()=>window.removeEventListener('beforeunload',unload);},[dirty]);
  useEffect(()=>{const a=new AbortController();const timer=setTimeout(async()=>{try{const query=new URLSearchParams({q:search,...(!record&&workOrderId&&!search?{ids:workOrderId}:{}),...(!record&&code&&!search?{code}:{})});const r=await fetch('/api/quality-quick/options?'+query,{signal:a.signal});const b=await r.json();if(!r.ok)throw new Error(b.error);setOptions(b.rows);if(!record&&(workOrderId||code)&&!search)setOrders(current=>current.length?current:b.rows);}catch(e){if(!a.signal.aborted)setError(e instanceof Error?e.message:'工单加载失败');}},200);return()=>{clearTimeout(timer);a.abort();};},[search,record,workOrderId,code]);
  function changed(){setDirty(true);key.current=crypto.randomUUID();setError('');}
  function addFiles(incoming:File[]){if(busy)return;const valid=incoming.filter(f=>/^image\/(jpeg|png|webp)$/.test(f.type)||/\.(jpe?g|png|webp)$/i.test(f.name));if(valid.length!==incoming.length){setError('支持 JPG、PNG、WEBP 照片');return;}if(valid.some(f=>f.size>20*1024*1024)||valid.reduce((n,f)=>n+f.size,files.reduce((n,x)=>n+x.file.size,0))>32*1024*1024){setError('单张最多 20 MB，本次照片总大小最多 32 MB');return;}if(photos.length+files.length+valid.length>12){setError('每条记录最多 12 张照片');return;}changed();setFiles(current=>[...current,...valid.map(file=>{const url=URL.createObjectURL(file);urls.current.push(url);return{file,url};})]);}
  async function save(publish:boolean){
    if(busy)return;
    if(!orders.length||!description.trim()){setError('请选择工单，并填写问题与处理说明');return;}
    if(publish&&scope==='PRODUCT'&&!scopeConfirmed){setError('请确认该产品的后续工单也适用此警示');return;}
    setBusy(true);setError('');setProgress(files.length?'正在上传照片…':'正在保存…');
    try{
      const form=new FormData();form.set('data',JSON.stringify({id:record?.id,version:record?.version,mutationKey:key.current,description,orderIds:orders.map(o=>o.id),scope,occurredAt:date,effectiveUntil:until,processName:process,printPolicy:print?'OPTIONAL':'SYSTEM_ONLY',keepPhotoIds:photos.map(p=>p.id),publish}));files.forEach(({file})=>form.append('photos',file));
      const result=await new Promise<{record:QuickQualityDTO}>((resolve,reject)=>{const xhr=new XMLHttpRequest();request.current=xhr;xhr.open('POST','/api/quality-quick');xhr.timeout=120000;xhr.upload.onprogress=e=>{if(e.lengthComputable)setProgress(e.loaded===e.total?'正在保存记录…':'照片上传 '+Math.round(e.loaded/e.total*100)+'%');};xhr.onerror=()=>reject(new Error('网络中断，内容已保留，请重试'));xhr.ontimeout=()=>reject(new Error('上传超时，内容已保留，请重试'));xhr.onabort=()=>reject(new Error('上传已取消'));xhr.onload=()=>{try{const b=JSON.parse(xhr.responseText);if(xhr.status>=400||!b.ok)reject(new Error(b.error||'保存失败'));else resolve(b);}catch{reject(new Error('服务器暂时无法响应，内容已保留'));}};xhr.send(form);});
      setDirty(false);window.dispatchEvent(new Event('quality-quick-changed'));onSaved(result.record);
    }catch(e){setError(e instanceof Error?e.message:'保存失败');}finally{setBusy(false);setProgress('');}
  }
  return <div className="qq-modal" ref={layer} tabIndex={-1}><section className="qq-form" role="dialog" aria-modal="true" aria-label={record?'编辑快处记录':'快速记录异常'}>
    <header><div><small>品质现场记录</small><h2>{record?'编辑快处记录':'快速记录异常'}</h2></div><button aria-label="关闭表单" disabled={busy} onClick={close}><X/></button></header>
    <div className="qq-form-scroll" onPaste={e=>{const f=Array.from(e.clipboardData.files);if(f.length){e.preventDefault();addFiles(f);}}} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();addFiles(Array.from(e.dataTransfer.files));}}>
      <fieldset disabled={busy}>
      <label>关联工单 <span className="qq-required">*</span></label><div className="qq-selected-orders">{orders.map(o=><span key={o.id}><b>{o.businessCode||o.code}</b> {o.productName}<button aria-label={'移除工单 '+o.code} onClick={()=>{changed();setOrders(orders.filter(x=>x.id!==o.id));setScopeConfirmed(false);}}>×</button></span>)}</div>
      <div className="qq-search"><Search size={17}/><input aria-label="搜索关联工单" placeholder="搜索工单号、产品或规格" value={search} onChange={e=>setSearch(e.target.value)}/></div>
      {(!orders.length||search)&&<div className="qq-order-options">{options.map(o=><button key={o.id} disabled={orders.some(x=>x.id===o.id)} onClick={()=>{changed();setOrders([...orders,o]);setSearch('');setScopeConfirmed(false);}}><b>{o.businessCode||o.code}</b><span>{o.productName} · {o.specification}</span></button>)}{!options.length&&<p>没有匹配工单，试试其他关键词</p>}</div>}
      <label htmlFor="qq-description">问题与处理说明 <span className="qq-required">*</span></label><textarea id="qq-description" value={description} maxLength={3000} rows={4} placeholder="例如：端子方向装反，现场已纠正。后续装配注意卡扣朝外。" onChange={e=>{changed();setDescription(e.target.value);}}/>
      <label>现场图片 <small>支持多张，可直接拍照</small></label>
      <div className="qq-upload-actions"><button onClick={()=>camera.current?.click()}><Camera size={19}/>拍照</button><button onClick={()=>album.current?.click()}><ImagePlus size={19}/>选择图片</button><small>也可粘贴或拖入图片</small></div>
      <input ref={camera} hidden type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={e=>{addFiles(Array.from(e.target.files||[]));e.target.value='';}}/><input ref={album} hidden type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={e=>{addFiles(Array.from(e.target.files||[]));e.target.value='';}}/>
      <div className="qq-upload-grid">{photos.map(p=><div key={p.id}><img src={p.url} alt={p.name}/><button className="qq-remove-photo" aria-label={'移除 '+p.name} onClick={()=>{changed();setPhotos(photos.filter(x=>x.id!==p.id));}}>×</button></div>)}{files.map((p,i)=><div key={p.url}><img src={p.url} alt={p.file.name}/><button className="qq-remove-photo" aria-label={'移除 '+p.file.name} onClick={()=>{changed();setFiles(files.filter((_,n)=>n!==i));}}>×</button><button className="qq-mark-photo" onClick={()=>setAnnotate(p.file)}>标注</button></div>)}</div>
      <details className="qq-settings" open={record?.scopeChanged||undefined}><summary>警示设置与补充信息</summary><label htmlFor="qq-scope">适用范围</label><select id="qq-scope" value={scope} onChange={e=>{changed();setScope(e.target.value as typeof scope);setScopeConfirmed(false);}}><option value="WORK_ORDER">仅所选工单</option><option value="PRODUCT">该产品持续警示（含后续工单）</option></select>
      {scope==='PRODUCT'&&<label className="qq-check"><input type="checkbox" checked={scopeConfirmed} onChange={e=>setScopeConfirmed(e.target.checked)}/>确认同产品后续工单也适用，资料换版后需重新确认。</label>}
      {record?.scopeChanged&&<p className="qq-error">关联产品资料已变化，重新发布将使用当前资料版本。</p>}
      <div className="qq-form-pair"><label>发生日期<input type="date" value={date} onChange={e=>{changed();setDate(e.target.value);}}/></label><label>涉及工序<input value={process} placeholder="需要时填写" onChange={e=>{changed();setProcess(e.target.value);}}/></label></div>
      <label>警示到期日期<input type="date" value={until} onChange={e=>{changed();setUntil(e.target.value);}}/></label><small>留空则由品质主动下线。</small>
      <label className="qq-check"><input type="checkbox" checked={print} onChange={e=>{changed();setPrint(e.target.checked);}}/>允许作为工单打印附页</label>
      </details></fieldset>
    </div>
    <footer>{error&&<p className="qq-error" role="alert">{error}</p>}{busy&&<p role="status"><Loader2 size={16} className="spin"/>{progress}</p>}<div>{record?.state!=='ACTIVE'&&<button disabled={busy} onClick={()=>void save(false)}>仅保存记录</button>}<button className="qq-primary" disabled={busy} onClick={()=>void save(true)}>{record?.state==='ACTIVE'?'保存并更新警示':'保存并发布警示'}</button></div></footer>
  </section>{annotate&&<QuickPhotoAnnotator file={annotate} onClose={()=>setAnnotate(null)} onDone={file=>{addFiles([file]);setAnnotate(null);}}/>}</div>;
}
