'use client';

import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

type PdfDocument = {
  numPages: number;
  getPage: (pageNumber: number) => Promise<PdfPage>;
  destroy?: () => Promise<void> | void;
};

type PdfPage = {
  getViewport: (input: { scale: number }) => { width: number; height: number };
  render: (input: { canvasContext: CanvasRenderingContext2D; viewport: { width: number; height: number } }) => {
    promise: Promise<void>;
    cancel: () => void;
  };
};

type FitMode = 'width' | 'page' | 'custom';

export function PdfViewer({ fileId, title, contentUrl }: { fileId: string; title: string; contentUrl?: string }) {
  const [fullscreen, setFullscreen] = useState(false);
  const source = contentUrl || `/api/resource-files/${fileId}/content`;

  return (
    <>
      <PdfCanvas source={source} title={title} onFullscreen={() => setFullscreen(true)} />
      {fullscreen && (
        <PreviewModal title={title} onClose={() => setFullscreen(false)}>
          <PdfCanvas source={source} title={title} fullscreen onClose={() => setFullscreen(false)} />
        </PreviewModal>
      )}
    </>
  );
}

function PdfCanvas({
  source,
  title,
  fullscreen = false,
  onFullscreen,
  onClose,
}: {
  source: string;
  title: string;
  fullscreen?: boolean;
  onFullscreen?: () => void;
  onClose?: () => void;
}) {
  const shellRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderTaskRef = useRef<{ cancel: () => void } | null>(null);
  const effectiveScaleRef = useRef(1);
  const [doc, setDoc] = useState<PdfDocument | null>(null);
  const [pageNo, setPageNo] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [fitMode, setFitMode] = useState<FitMode>('width');
  const [scale, setScale] = useState(1);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const [loading, setLoading] = useState(true);
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const node = shellRef.current;
    if (!node) return undefined;
    const resize = () => setBox({ width: node.clientWidth, height: node.clientHeight });
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let alive = true;
    let loadingTask: { promise: Promise<PdfDocument>; destroy?: () => void } | null = null;
    let loadedDoc: PdfDocument | null = null;

    setLoading(true);
    setRendering(false);
    setError('');
    setDoc(null);
    setPageNo(1);
    setPageCount(0);

    (async () => {
      try {
        const pdfjs = await import('pdfjs-dist');
        pdfjs.GlobalWorkerOptions.workerSrc = '/api/pdf-worker';
        loadingTask = pdfjs.getDocument({ url: source }) as unknown as { promise: Promise<PdfDocument>; destroy?: () => void };
        loadedDoc = await loadingTask.promise;
        if (!alive) return;
        setDoc(loadedDoc);
        setPageCount(loadedDoc.numPages);
      } catch {
        if (alive) setError('PDF 加载失败，请检查文件是否完整或稍后重试');
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
      renderTaskRef.current?.cancel();
      loadingTask?.destroy?.();
      loadedDoc?.destroy?.();
    };
  }, [source]);

  useEffect(() => {
    if (loading || !doc || !canvasRef.current || box.width <= 0 || box.height <= 0) return undefined;
    let alive = true;
    const canvas = canvasRef.current;

    (async () => {
      setRendering(true);
      setError('');
      try {
        renderTaskRef.current?.cancel();
        const page = await doc.getPage(pageNo);
        if (!alive) return;
        const base = page.getViewport({ scale: 1 });
        const widthScale = Math.max(0.25, (box.width - 36) / base.width);
        const heightScale = Math.max(0.25, (box.height - 36) / base.height);
        const nextScale = fitMode === 'width' ? widthScale : fitMode === 'page' ? Math.min(widthScale, heightScale) : scale;
        effectiveScaleRef.current = Math.max(0.25, Math.min(4, nextScale));

        const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
        const viewport = page.getViewport({ scale: effectiveScaleRef.current * dpr });
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Canvas unavailable');

        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = `${Math.floor(viewport.width / dpr)}px`;
        canvas.style.height = `${Math.floor(viewport.height / dpr)}px`;
        const task = page.render({ canvasContext: context, viewport });
        renderTaskRef.current = task;
        await task.promise;
      } catch (e) {
        if (alive && !(e instanceof Error && e.name === 'RenderingCancelledException')) {
          setError('PDF 渲染失败，请刷新或下载原文件查看');
        }
      } finally {
        if (alive) setRendering(false);
      }
    })();

    return () => {
      alive = false;
      renderTaskRef.current?.cancel();
    };
  }, [doc, pageNo, box, fitMode, scale, loading]);

  function zoom(delta: number) {
    setFitMode('custom');
    setScale(Math.max(0.35, Math.min(3, effectiveScaleRef.current + delta)));
  }

  return (
    <div className={fullscreen ? 'pdf-viewer fullscreen-viewer' : 'pdf-viewer'}>
      <div className="viewer-toolbar pdf-toolbar">
        <div className="viewer-title" title={title}>
          <span>PDF</span>
          <strong>{title}</strong>
        </div>
        <div className="viewer-controls">
          <button type="button" disabled={pageNo <= 1 || loading} onClick={() => setPageNo(v => Math.max(1, v - 1))}>上一页</button>
          <span className="page-indicator">{pageCount ? `${pageNo}/${pageCount}` : '-'}</span>
          <button type="button" disabled={!pageCount || pageNo >= pageCount || loading} onClick={() => setPageNo(v => Math.min(pageCount, v + 1))}>下一页</button>
          <button type="button" disabled={loading} onClick={() => zoom(-0.15)}>-</button>
          <button type="button" disabled={loading} onClick={() => zoom(0.15)}>+</button>
          <button type="button" disabled={loading} onClick={() => setFitMode('width')}>适宽</button>
          <button type="button" disabled={loading} onClick={() => setFitMode('page')}>整页</button>
          {fullscreen ? <button className="viewer-close-button" type="button" onClick={onClose}>关闭</button> : <button type="button" disabled={loading} onClick={onFullscreen}>全屏</button>}
        </div>
      </div>
      <div className="viewer-stage pdf-stage" ref={shellRef}>
        {loading && <ViewerState title="PDF 加载中" detail="正在读取同源文件流" />}
        {error && <ViewerState title={error} detail="可尝试刷新页面或下载原文件" error />}
        {!loading && !error && (
          <>
            {rendering && <div className="render-badge">渲染中...</div>}
            <canvas ref={canvasRef} aria-label={title} />
          </>
        )}
      </div>
    </div>
  );
}

function ViewerState({ title, detail, error = false }: { title: string; detail: string; error?: boolean }) {
  return (
    <div className={error ? 'viewer-state error' : 'viewer-state'}>
      <span />
      <strong>{title}</strong>
      <p>{detail}</p>
    </div>
  );
}

export function PreviewModal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [onClose]);

  return (
    <div className="preview-fullscreen-backdrop" role="dialog" aria-modal="true" aria-label={`${title} 全屏预览`}>
      <div className="preview-fullscreen-panel">{children}</div>
    </div>
  );
}
