'use client';
import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import Image from 'next/image';
import { Check, Copy, Download, QrCode, X } from 'lucide-react';
import { useModalLayer } from '@/components/useModalLayer';
import '@/app/sample-library/sample-library.css';
export function SampleLibraryQrDialog({ productId, title='手机样品库', onClose }: {productId?:string;title?:string;onClose:()=>void}) {
  const ref=useRef<HTMLElement>(null),[png,setPng]=useState(''),[url,setUrl]=useState(''),[copied,setCopied]=useState(false),[error,setError]=useState('');
  useModalLayer({open:true,layerRef:ref,onClose});
  useEffect(()=>{const value=new URL('/sample-library',window.location.origin);if(productId)value.searchParams.set('product',productId);setUrl(value.href);void QRCode.toDataURL(value.href,{width:600,margin:3,errorCorrectionLevel:'M'}).then(setPng).catch(()=>setError('二维码生成失败，请关闭后重试'));},[productId]);
  return <div className="sl-sheet-backdrop"><section className="sl-sheet sl-qr" ref={ref} role="dialog" aria-modal="true" aria-label="手机样品库二维码" tabIndex={-1}><header><div><small>扫码查看 · 需员工账号登录</small><h2>{title}</h2></div><button aria-label="关闭二维码" onClick={onClose}><X/></button></header>{png?<Image unoptimized src={png} alt="手机样品库二维码" width={260} height={260}/>:<p>{error||'正在生成二维码…'}</p>}<p>{productId?'固定产品入口，新资料上传后仍可使用同一张码。':'贴在样品工作区，员工扫码后搜索型号、筛选客户即可查看。'}</p><div className="sl-qr-actions"><button onClick={()=>void navigator.clipboard.writeText(url).then(()=>setCopied(true)).catch(()=>setError('复制失败，请手动复制下方链接'))}>{copied?<Check size={17}/>:<Copy size={17}/>} {copied?'已复制':'复制链接'}</button>{png&&<a href={png} download={productId?'产品样品资料二维码.png':'手机样品库二维码.png'}><Download size={17}/>保存二维码</a>}</div>{error&&<p role="alert">{error}</p>}<input aria-label="样品库链接" readOnly value={url}/></section></div>;
}
export default function SampleLibraryEntry({ productId, title, returnTo, onNavigate }: {productId?:string;title?:string;returnTo?:string;onNavigate?:()=>void}) {
  const [open,setOpen]=useState(false);
  const params=new URLSearchParams();if(productId)params.set('product',productId);if(returnTo)params.set('returnTo',returnTo);
  return <><a className="hm-workbench-button" href={`/sample-library?${params}`} onClick={onNavigate}>手机样品库</a><button className="hm-workbench-button" aria-label="样品库二维码" onClick={()=>setOpen(true)}><QrCode size={17}/></button>{open&&<SampleLibraryQrDialog productId={productId} title={title} onClose={()=>setOpen(false)}/>}</>;
}
