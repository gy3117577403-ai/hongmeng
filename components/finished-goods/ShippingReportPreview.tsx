'use client';
import { useEffect, useRef, useState } from 'react';
import { Minus, Plus, Scan, FileText } from 'lucide-react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { createPdfJsAssetOptions } from '@/lib/pdfjs-assets';

export function ShippingReportPreview({ bytes, loading, onError }: { bytes: ArrayBuffer | null; loading: boolean; onError: (error: string) => void }) {
  const box = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null), [zoom, setZoom] = useState(1), [size, setSize] = useState({ width: 0, height: 0 }), [rendering, setRendering] = useState(false);
  const errorRef = useRef(onError); errorRef.current = onError;
  useEffect(() => {
    if (!box.current) return;
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(box.current); return () => observer.disconnect();
  }, []);
  useEffect(() => {
    setPdf(null);
    setRendering(Boolean(bytes));
    if (!bytes) return;
    let cancelled = false, task: import('pdfjs-dist').PDFDocumentLoadingTask | undefined;
    void (async () => {
      const ctor = Promise as PromiseConstructor & { withResolvers?: <T>() => { promise: Promise<T>; resolve: (value: T | PromiseLike<T>) => void; reject: (reason?: unknown) => void } };
      if (!ctor.withResolvers) ctor.withResolvers = function<T>() { let resolve!: (value: T | PromiseLike<T>) => void, reject!: (reason?: unknown) => void; const promise = new Promise<T>((r, j) => { resolve = r; reject = j; }); return { promise, resolve, reject }; };
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
      if (cancelled) return;
      pdfjs.GlobalWorkerOptions.workerSrc = '/api/pdf-worker';
      task = pdfjs.getDocument({ data: bytes.slice(0), ...createPdfJsAssetOptions(), useWorkerFetch: false, isEvalSupported: false });
      const doc = await task.promise;
      if (!cancelled) setPdf(doc);
    })().catch(e => { if (!cancelled) { setRendering(false); errorRef.current(e instanceof Error ? e.message : '报告预览失败'); } });
    return () => { cancelled = true; void task?.destroy(); };
  }, [bytes]);
  useEffect(() => {
    if (!pdf || !canvas.current || !size.width || !size.height) return;
    setRendering(true);
    let cancelled = false, task: import('pdfjs-dist').RenderTask | undefined;
    void (async () => {
      const page = await pdf.getPage(1); if (cancelled || !canvas.current) return;
      const native = page.getViewport({ scale: 1 });
      const scale = Math.max(0.1, Math.min((size.width - 48) / native.width, (size.height - 42) / native.height)) * zoom;
      const viewport = page.getViewport({ scale }); const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const el = canvas.current; el.width = Math.ceil(viewport.width * dpr); el.height = Math.ceil(viewport.height * dpr); el.style.width = `${viewport.width}px`; el.style.height = `${viewport.height}px`;
      const ctx = el.getContext('2d'); if (!ctx) return;
      task = page.render({ canvasContext: ctx, viewport, transform: [dpr, 0, 0, dpr, 0, 0] }); await task.promise;
    })().catch(e => { if (!cancelled && e?.name !== 'RenderingCancelledException') errorRef.current('预览绘制失败，请重试。'); }).finally(() => { if (!cancelled) setRendering(false); });
    return () => { cancelled = true; task?.cancel(); };
  }, [pdf, size, zoom]);
  return <section className="sr-preview" aria-label="出货报告纸面预览">
    <div className="sr-preview-tools"><span><FileText size={14}/>A4 · 纵向<span className="sr-paper-page">1 / 1</span></span><div><button type="button" aria-label="缩小报告" disabled={zoom <= 0.75} onClick={() => setZoom(z => Math.max(0.75, z - 0.25))}><Minus size={15}/></button><button type="button" className="sr-fit" title="适合页面" onClick={() => setZoom(1)}><Scan size={14}/>{zoom === 1 ? '适合页面' : `${Math.round(zoom * 100)}%`}</button><button type="button" aria-label="放大报告" disabled={zoom >= 3} onClick={() => setZoom(z => Math.min(3, z + 0.25))}><Plus size={15}/></button></div></div>
    <div ref={box} className={`sr-paper-viewport ${loading || rendering ? 'is-refreshing' : ''}`} aria-busy={loading || rendering}><div className="sr-paper-stage">{bytes ? <canvas ref={canvas} aria-label="本次报告 PDF 预览"/> : <div className="sr-preview-empty"><FileText size={38}/><span>{loading ? '正在生成预览' : '选择模板，预览报告'}</span></div>}</div></div>
    {(loading || rendering) && <span className="sr-preview-updating" role="status"><i/>更新预览</span>}
  </section>;
}
