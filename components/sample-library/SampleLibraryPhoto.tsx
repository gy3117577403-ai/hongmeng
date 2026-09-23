'use client';
/* eslint-disable @next/next/no-img-element */
import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, RotateCw, Scan, X } from 'lucide-react';
import { usePreviewGestures } from '@/components/usePreviewGestures';
import { useModalLayer } from '@/components/useModalLayer';
import { photoLabels, type LibraryPhoto } from '@/lib/sample-library';

export default function SampleLibraryPhoto({ photos, index, onIndex, onClose }: { photos: LibraryPhoto[]; index: number; onIndex: (index: number)=>void; onClose: ()=>void }) {
  const photo=photos[index], stageRef=useRef<HTMLDivElement>(null), modalRef=useRef<HTMLDivElement>(null);
  const [natural,setNatural]=useState({width:0,height:0}),[box,setBox]=useState({width:0,height:0}),[failed,setFailed]=useState(false),[reload,setReload]=useState(0);
  const swipe=useRef<{x:number;y:number;single:boolean}|null>(null);
  const gestures=usePreviewGestures({stageRef,contentSize:natural,viewportSize:box,resetKey:photo.id,initialFitMode:'fit-window'});
  useModalLayer({open:true,layerRef:modalRef,onClose});
  useEffect(()=>{setFailed(false);setNatural({width:0,height:0});},[photo.id]);
  useEffect(()=>{ const node=stageRef.current;if(!node)return;const resize=()=>setBox({width:node.clientWidth,height:node.clientHeight});resize();const observer=new ResizeObserver(resize);observer.observe(node);return()=>observer.disconnect();},[]);
  return <div className="sl-photo-view" ref={modalRef} role="dialog" aria-modal="true" aria-label="样品照片预览" tabIndex={-1}>
    <header><button aria-label="关闭照片" onClick={onClose}><X/></button><span>{index+1} / {photos.length}</span><button aria-label="旋转照片" onClick={()=>gestures.rotateBy(90)}><RotateCw/></button><button aria-label="照片适屏" onClick={()=>gestures.reset()}><Scan/></button></header>
    <div className="sl-photo-stage" ref={stageRef} onDoubleClick={gestures.onDoubleClick}
      onPointerDown={e=>{if(swipe.current)swipe.current.single=false;else swipe.current={x:e.clientX,y:e.clientY,single:true};gestures.onPointerDown(e);}}
      onPointerMove={gestures.onPointerMove} onPointerCancel={e=>{swipe.current=null;gestures.onPointerCancel(e);}}
      onPointerUp={e=>{const start=swipe.current;swipe.current=null;gestures.onPointerUp(e);if(start?.single&&gestures.zoom<=gestures.fitWindowZoom*1.05&&Math.abs(e.clientX-start.x)>65&&Math.abs(e.clientX-start.x)>Math.abs(e.clientY-start.y)*1.8){const next=index+(e.clientX<start.x?1:-1);if(photos[next])onIndex(next);}}}>
      {!failed&&<div className="sl-photo-transform" style={{width:natural.width||undefined,height:natural.height||undefined,transform:`translate(${gestures.panX}px,${gestures.panY}px) rotate(${gestures.rotation}deg) scale(${gestures.zoom})`}}><img key={photo.id+reload} src={`/api/sample-library/photos/${photo.id}?retry=${reload}`} alt={photo.caption||photo.name} draggable={false} onLoad={e=>setNatural({width:e.currentTarget.naturalWidth,height:e.currentTarget.naturalHeight})} onError={()=>setFailed(true)}/></div>}
      {failed?<div className="sl-photo-failure"><p>照片暂时加载失败</p><button onClick={()=>{setFailed(false);setReload(n=>n+1);}}>重新加载</button></div>:!natural.width&&<span className="sl-photo-failure">照片加载中…</span>}
    </div>
    <footer><div className="sl-photo-nav"><button disabled={!index} aria-label="上一张照片" onClick={()=>onIndex(index-1)}><ChevronLeft/></button><span>双指缩放 · 双击放大 · 放大后拖动</span><button disabled={index>=photos.length-1} aria-label="下一张照片" onClick={()=>onIndex(index+1)}><ChevronRight/></button></div><strong>{photo.caption||photo.name}</strong><small>{photoLabels[photo.category]||photo.category} · 上传 {new Date(photo.date).toLocaleString('zh-CN',{hour12:false})}</small></footer>
  </div>;
}
