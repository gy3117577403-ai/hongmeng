'use client';
import { useEffect, useRef, useState } from 'react';
import { BookOpen, X } from 'lucide-react';
import { useModalLayer } from '@/components/useModalLayer';
import '@/app/sample-library/sample-library.css';
/** Keep the capture editor mounted, including pending photos and unsubmitted text. */
export default function SampleLibraryReference({productId}:{productId:string}) {
  const [open,setOpen]=useState(false),ref=useRef<HTMLElement>(null),frame=useRef<HTMLIFrameElement>(null);
  useModalLayer({open,layerRef:ref,onClose:()=>setOpen(false)});
  useEffect(()=>{if(!open)return;const receive=(event:MessageEvent)=>{if(event.origin===window.location.origin&&event.source===frame.current?.contentWindow&&event.data?.type==='sample-library-close')setOpen(false);};window.addEventListener('message',receive);return()=>window.removeEventListener('message',receive);},[open]);
  return <><button className="sample-reference-button" onClick={()=>setOpen(true)}><BookOpen size={18}/>参考历次样品资料</button>{open&&<div className="sl-reference-backdrop"><section ref={ref} role="dialog" aria-modal="true" aria-label="参考历次样品" className="sl-reference"><header><span>参考历史 · 当前采集草稿保留</span><button aria-label="返回当前采集" onClick={()=>setOpen(false)}><X size={18}/>返回采集</button></header><iframe ref={frame} title="手机样品参考库" src={`/sample-library?product=${encodeURIComponent(productId)}&embedded=1`}/></section></div>}</>;
}
