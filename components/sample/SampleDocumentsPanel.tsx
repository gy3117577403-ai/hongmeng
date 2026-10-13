'use client';
import { useEffect, useState } from 'react';
import { FileText, History, Loader2, Plus, RefreshCw } from 'lucide-react';
import { PdfViewer } from '@/components/PdfViewer';
import { ImageViewer } from '@/components/ImageViewer';
import type { SampleTaskDTO } from '@/types';
import { sampleRequest, sampleStamp } from './SampleBranchControls';
import SampleDocumentChangeDialog, { sampleDocUrl, type SampleDoc, type SampleDocContext } from './SampleDocumentChangeDialog';
export default function SampleDocumentsPanel({task,onChanged}:{task:SampleTaskDTO;onChanged:()=>void}) {
 const [context,setContext]=useState<SampleDocContext|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[revision,setRevision]=useState(0),[selectedId,setSelectedId]=useState(''),[history,setHistory]=useState(false),[oldFile,setOldFile]=useState<SampleDoc|null>(null),[change,setChange]=useState<{fileId?:string;kind:'drawing'|'sop'}|null>(null);
 useEffect(()=>{const ctrl=new AbortController();setLoading(true);sampleRequest('/api/sample-tasks/'+task.id+'/documents',{signal:ctrl.signal}).then(data=>{setContext(data);setError('');}).catch(e=>{if(e.name!=='AbortError')setError(e.message);}).finally(()=>{if(!ctrl.signal.aborted)setLoading(false);});return()=>ctrl.abort();},[task.id,task.version,revision]);
 const current=context?.files.find(f=>f.id===selectedId)||context?.files[0],selected=oldFile || current;
 const url=selected?sampleDocUrl(task.id,selected.id):'';
 return <section className="sb-documents sd-documents">
  <header className="sd-doc-toolbar"><div className="sd-doc-tabs"><button className={!history?'active':''} onClick={()=>{setHistory(false);setOldFile(null);}}><FileText size={16}/>当前资料 <b>{context?.files.length || 0}</b></button><button className={history?'active':''} onClick={()=>setHistory(true)}><History size={16}/>更换记录 {context?.history.length || ''}</button></div><span className="sd-scope">本订单使用版本</span><div className="sb-spacer"/>{task.status!=='CANCELLED'&&<><button onClick={()=>setChange({fileId:current?.id,kind:current?.kind==='sop'?'sop':'drawing'})}><RefreshCw size={15}/>{current?'替换图纸':'上传图纸'}</button>{!!current&&<button title="追加另一份图纸或 SOP" onClick={()=>setChange({fileId:'new',kind:'drawing'})}><Plus size={15}/>追加</button>}</>}<button aria-label="刷新图纸" onClick={()=>setRevision(n=>n+1)}><RefreshCw size={15}/></button></header>
  {error&&<p className="sd-error" role="alert">{error}</p>}
  {loading&&!context?<div className="sb-empty"><Loader2 className="spin"/>正在读取图纸</div>:history?<div className="sd-history">
   {context?.history.map(row=><article key={row.id}><span className="sd-history-dot"/><header><strong>{row.detail.old?'更换图纸':'上传图纸'} · {row.detail.next?.version}</strong><time>{sampleStamp(row.createdAt)}</time></header><p>{row.detail.actorName} <span>· {row.detail.reason || '补充本单资料'}</span></p><div className="sd-history-files">{row.detail.old&&<button onClick={()=>{setOldFile(row.detail.old);setHistory(false);}}><FileText size={16}/><span><small>原文件 · {row.detail.old.version}</small>{row.detail.old.name}</span></button>}<button onClick={()=>{setOldFile(row.detail.next);setHistory(false);}}><FileText size={16}/><span><small>新文件 · {row.detail.next?.version}</small>{row.detail.next?.name}</span></button></div>{row.detail.materialChanged&&<small className="sd-material-note">已通知仓库复核配料</small>}</article>)}
   {!context?.history.length&&<div className="sb-empty"><History size={30}/><h3>尚无更换记录</h3><p>本单每次更换的文件、说明和操作时间会保留在这里。</p></div>}
  </div>:<>
   {!!context?.files.length&&<div className="sd-document-switch"><select aria-label="本订单图纸" value={oldFile?'history':current?.id||''} onChange={e=>{setOldFile(null);setSelectedId(e.target.value);}}>{oldFile&&<option value="history">{oldFile.name} · {oldFile.version} · 历史文件</option>}{context.files.map(f=><option key={f.id} value={f.id}>{f.kind==='sop'?'SOP':'图纸'} · {f.name} · {f.version}</option>)}</select>{oldFile&&<button onClick={()=>setOldFile(null)}>返回当前版本</button>}</div>}
   <div className="sb-document-canvas">{selected?selected.mimeType.startsWith('image/')?<ImageViewer dashboardMode paperMode initialFitMode="fit-window" fileId={selected.id} title={selected.name} contentUrl={url} downloadUrl={url}/>:<PdfViewer dashboardMode initialFitMode="fit-window" fileId={selected.id} title={selected.name} contentUrl={url} viewUrl={url} downloadUrl={url}/>:<div className="sb-empty"><FileText size={38}/><h3>本订单尚无图纸</h3>{task.status!=='CANCELLED'&&<button className="sb-primary" onClick={()=>setChange({kind:'drawing'})}>上传图纸</button>}</div>}</div>
  </>}
  {change&&<SampleDocumentChangeDialog task={task} initialFileId={change.fileId} initialKind={change.kind} onClose={()=>setChange(null)} onSaved={()=>{setChange(null);setOldFile(null);setRevision(n=>n+1);onChanged();}}/>}
 </section>;
}
