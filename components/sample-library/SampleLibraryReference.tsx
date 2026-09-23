'use client';
import { useEffect, useRef, useState } from 'react';
import { BookOpen, X } from 'lucide-react';
import { useModalLayer } from '@/components/useModalLayer';
import '@/app/sample-library/sample-library.css';
/** Keep the source screen mounted, including its filters, scroll and unsubmitted input. */
export function SampleLibraryReferenceDialog({ productId, context = 'capture', open, onClose }: {
  productId?: string;
  context?: 'capture' | 'planning';
  open: boolean;
  onClose: () => void;
}) {
  const ref = useRef<HTMLElement>(null), frame = useRef<HTMLIFrameElement>(null);
  useModalLayer({ open, layerRef: ref, onClose });
  useEffect(() => {
    if (!open) return;
    const receive = (event: MessageEvent) => {
      if (event.origin === window.location.origin && event.source === frame.current?.contentWindow && event.data?.type === 'sample-library-close') onClose();
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [onClose, open]);
  const params = new URLSearchParams({ embedded: '1' });
  if (productId) params.set('product', productId);
  const capture = context === 'capture';
  return open ? <div className="sl-reference-backdrop"><section ref={ref} role="dialog" aria-modal="true" aria-label={capture ? '参考历次样品' : '手机样品库预览'} className="sl-reference">
    <header><span>{capture ? '参考历史 · 当前采集草稿保留' : '手机样品库 · 原计划筛选与位置保留'}</span><button aria-label={capture ? '返回当前采集' : '返回原计划'} onClick={onClose}><X size={18}/>{capture ? '返回采集' : '返回计划'}</button></header>
    <iframe ref={frame} title="手机样品参考库" src={`/sample-library?${params}`}/>
  </section></div> : null;
}

export default function SampleLibraryReference({ productId }: { productId: string }) {
  const [open, setOpen] = useState(false);
  return <><button className="sample-reference-button" onClick={() => setOpen(true)}><BookOpen size={18}/>参考历次样品资料</button><SampleLibraryReferenceDialog open={open} productId={productId} onClose={() => setOpen(false)}/></>;
}
