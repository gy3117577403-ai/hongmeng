'use client';
import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, FileText, Loader2, RefreshCw, UploadCloud, X } from 'lucide-react';
import type { SampleTaskDTO } from '@/types';
import { SampleDialog, sampleRequest } from './SampleBranchControls';

export type SampleDoc = { id:string; name:string; kind:string; version:string; mimeType:string; size:number; createdAt:string };
export type SampleDocHistory = { id:string; createdAt:string; detail:{actorName:string;reason:string;old:SampleDoc|null;next:SampleDoc;materialChanged:boolean;completedCorrection?:boolean} };
export type SampleDocContext = { task:{id:string;code:string;version:number;status:string;specification:string}; files:SampleDoc[]; history:SampleDocHistory[] };
export const sampleDocUrl = (taskId:string,fileId:string) => '/api/sample-tasks/'+taskId+'/documents/'+fileId+'/content';
const documentSize = (bytes:number) => bytes < 1024 ? `${bytes} B` : bytes < 1024*1024 ? `${(bytes/1024).toFixed(1)} KB` : `${(bytes/1024/1024).toFixed(2)} MB`;
export default function SampleDocumentChangeDialog({task,onClose,onSaved,initialFileId,initialKind='drawing'}:{task:SampleTaskDTO;onClose:()=>void;onSaved:()=>void;initialFileId?:string;initialKind?:'drawing'|'sop'}) {
 const [context,setContext]=useState<SampleDocContext|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[reload,setReload]=useState(0);
 const [kind,setKind]=useState<'drawing'|'sop'>(initialKind),[replaceId,setReplaceId]=useState(initialFileId || ''),[file,setFile]=useState<File|null>(null),[reason,setReason]=useState(''),[material,setMaterial]=useState(false),[acknowledged,setAcknowledged]=useState(false),[drag,setDrag]=useState(false);
 const picker=useRef<HTMLInputElement>(null),mutation=useRef('');
 useEffect(()=>{const ctrl=new AbortController();setLoading(true);setError('');sampleRequest('/api/sample-tasks/'+task.id+'/documents',{signal:ctrl.signal}).then((data:SampleDocContext)=>{setContext(data);setReplaceId(initialFileId==='new'?'':initialFileId || data.files.find(f=>f.kind===initialKind)?.id || '');}).catch(e=>{if(e.name!=='AbortError')setError(e.message);}).finally(()=>{if(!ctrl.signal.aborted)setLoading(false);});return()=>ctrl.abort();},[task.id,initialFileId,initialKind,reload]);
 useEffect(()=>{mutation.current=crypto.randomUUID();},[file,reason,material,replaceId,kind]);
 useEffect(()=>{if(!file)return;const guard=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};window.addEventListener('beforeunload',guard);return()=>window.removeEventListener('beforeunload',guard);},[file]);
 const files=context?.files.filter(f=>f.kind===kind) || [],old=files.find(f=>f.id===replaceId);
 const status=context?.task.status || task.status,inProgress=status==='IN_PROGRESS'||status==='SUBMITTED',completed=status==='COMPLETED';
 function close(){if(busy)return;if(file && !window.confirm('新文件尚未保存，确定离开？'))return;onClose();}
 function chooseFile(next?:File){if(!next)return;setError('');if(!/\.(pdf|png|jpe?g|webp)$/i.test(next.name)||!next.size||next.size>50*1024*1024){setError('请选择不超过 50 MB 的 PDF、PNG、JPG 或 WebP 文件');return;}setFile(next);}
 async function save(){if(!file||!context||busy)return;setBusy(true);setError('');try{
  const form=new FormData();form.set('file',file);form.set('kind',kind);form.set('replaceFileId',replaceId);form.set('expectedVersion',String(context.task.version));form.set('mutationId',mutation.current);form.set('reason',reason);form.set('materialChanged',String(material));form.set('productionAcknowledged',String(acknowledged));
  await sampleRequest('/api/sample-tasks/'+task.id+'/documents',{method:'POST',body:form});setFile(null);onSaved();
 }catch(e){setError(e instanceof Error?e.message:'图纸保存失败');}finally{setBusy(false);}}
 return <SampleDialog title={old?'替换图纸':'上传图纸'} titleIcon={<span className="sd-modal-icon"><RefreshCw size={23}/></span>} onClose={close} busy={busy} className="sd-change-dialog">
  <div className="sb-dialog-body sd-change-body">
   <div className="sd-order-identity"><strong>{task.specification}</strong><span>{task.customerName} · {task.code}</span></div>
   {loading?<div className="sd-loading"><Loader2 className="spin" size={22}/>读取当前图纸…</div>:context&&<>
    <div className="sd-type-row"><div role="group" aria-label="资料类型">{(['drawing','sop'] as const).map(value=><button type="button" key={value} aria-pressed={kind===value} className={kind===value?'active':''} disabled={busy} onClick={()=>{setKind(value);setReplaceId(context.files.find(f=>f.kind===value)?.id || '');}}>{value==='drawing'?'图纸':'SOP'}</button>)}</div><span className="sd-scope">仅此样品订单</span></div>
    <div className="sd-file-comparison">
     <section className="sd-before"><span className="sd-step">当前文件</span>{files.length>0?<><label className="sd-file-select"><select aria-label="选择待替换文件" disabled={busy} value={replaceId} onChange={e=>setReplaceId(e.target.value)}>{files.map(f=><option value={f.id} key={f.id}>{f.name} · {f.version}</option>)}<option value="">新增一份资料</option></select></label>{old?<div className="sd-file-name"><FileText/><strong>{old.name}</strong><small>{old.version} · 已关联本单</small><a href={sampleDocUrl(task.id,old.id)} target="_blank" rel="noreferrer">预览原图纸 ↗</a></div>:<div className="sd-file-name"><FileText/><strong>追加资料</strong><small>本单已有文件继续保留</small></div>}</>:<div className="sd-file-name"><FileText/><strong>尚未上传</strong><small>本次为订单添加资料</small></div>}</section>
     <ArrowRight className="sd-compare-arrow" size={21}/>
     <section className={'sd-after '+(drag?'sd-drag':'')} onDragOver={e=>{e.preventDefault();if(!busy)setDrag(true);}} onDragLeave={()=>setDrag(false)} onDrop={e=>{e.preventDefault();setDrag(false);if(!busy)chooseFile(e.dataTransfer.files?.[0]);}}>
      <span className="sd-step">{old?'替换为':'新文件'}</span>{file?<div className="sd-file-name"><span className="sd-file-ready"><Check size={25}/></span><strong>{file.name}</strong><small>{documentSize(file.size)} · 待保存</small><button disabled={busy} onClick={()=>picker.current?.click()}>重新选择</button><button className="sd-remove-file" title="移除所选新文件" aria-label="移除所选新文件" disabled={busy} onClick={()=>setFile(null)}><X size={14}/></button></div>:<button className="sd-upload-zone" disabled={busy} onClick={()=>picker.current?.click()}><UploadCloud size={32}/><strong>选择新文件</strong><span>或拖放到这里</span><small>PDF / PNG / JPG / WebP · ≤ 50 MB</small></button>}
     </section>
    </div>
    <input ref={picker} type="file" hidden accept=".pdf,.png,.jpg,.jpeg,.webp" onChange={e=>{chooseFile(e.target.files?.[0]);e.target.value='';}}/>
    <label className="sd-reason">更换说明 <span>{status==='PLANNED'?'选填':'必填'}</span><textarea disabled={busy} value={reason} onChange={e=>setReason(e.target.value)} maxLength={1000} placeholder="例如：修正线长与端子孔位"/></label>
    {inProgress&&<label className="sd-confirm"><input type="checkbox" checked={acknowledged} disabled={busy} onChange={e=>setAcknowledged(e.target.checked)}/><span><strong>已通知现场切换图纸</strong><small>订单正在制作，已打印资料需同步更换。</small></span></label>}
    {!completed&&<label className="sd-confirm"><input type="checkbox" checked={material} disabled={busy} onChange={e=>setMaterial(e.target.checked)}/><span><strong>涉及物料变化，通知仓库重新核对</strong><small>{material?'将本单配料改为待复核，原配料记录保留。':'不勾选则保留当前配料状态。'}</small></span></label>}
    <p className="sd-preserved"><Check size={15}/>{completed?'仅更正图纸资料，原完成记录和当时图纸继续保留。':'订单、二维码、采集数据与工时继续保留，旧图纸可追溯。'}</p>
   </>}
   {error&&<div className="sd-error" role="alert">{error}{!context&&!loading&&<button onClick={()=>setReload(n=>n+1)}>重新加载</button>}</div>}
  </div>
  <footer><span>{file?'新文件已选择 · 保存后生效':'选择文件后保存'}</span><button disabled={busy} onClick={close}>取消</button><button className="sb-primary" disabled={busy||loading||!context||!file||status==='CANCELLED'||(status!=='PLANNED'&&!reason.trim())||(inProgress&&!acknowledged)} onClick={()=>void save()}>{busy?<><Loader2 size={16} className="spin"/>正在保存…</>:<><Check size={17}/>{old?'确认替换':'保存图纸'}</>}</button></footer>
 </SampleDialog>;
}
