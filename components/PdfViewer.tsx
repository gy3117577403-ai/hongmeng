'use client';

import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist';

declare global {
  interface Window {
    __HONGMENG_WEBVIEW__?: boolean;
  }
}

type PdfDocument = PDFDocumentProxy;
type PdfLoadingTask = PDFDocumentLoadingTask;
type PdfJsModule = typeof import('pdfjs-dist/legacy/build/pdf.mjs');

type PromiseWithResolversResult<T> = {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: Error | string) => void;
};

type PromiseConstructorWithResolvers = PromiseConstructor & {
  withResolvers?: <T>() => PromiseWithResolversResult<T>;
};

type FitMode = 'width' | 'page' | 'custom';
type PdfLoadError = { title: string; detail: string };

export function PdfViewer({
  fileId,
  title,
  contentUrl,
  downloadUrl,
  viewUrl,
}: {
  fileId: string;
  title: string;
  contentUrl?: string;
  downloadUrl?: string;
  viewUrl?: string;
}) {
  const [fullscreen, setFullscreen] = useState(false);
  const source = contentUrl || `/api/resource-files/${fileId}/content`;
  const fallbackDownloadUrl = downloadUrl || `/api/resource-files/${fileId}/download`;
  const fallbackViewUrl = viewUrl || `/api/resource-files/${fileId}/view`;

  return (
    <>
      <PdfCanvas source={source} title={title} downloadUrl={fallbackDownloadUrl} viewUrl={fallbackViewUrl} onFullscreen={() => setFullscreen(true)} />
      {fullscreen && (
        <PreviewModal title={title} onClose={() => setFullscreen(false)}>
          <PdfCanvas source={source} title={title} downloadUrl={fallbackDownloadUrl} viewUrl={fallbackViewUrl} fullscreen onClose={() => setFullscreen(false)} />
        </PreviewModal>
      )}
    </>
  );
}

function PdfCanvas({
  source,
  title,
  downloadUrl,
  viewUrl,
  fullscreen = false,
  onFullscreen,
  onClose,
}: {
  source: string;
  title: string;
  downloadUrl: string;
  viewUrl: string;
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
  const [error, setError] = useState<PdfLoadError | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

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
    let loadingTask: PdfLoadingTask | null = null;
    let loadedDoc: PdfDocument | null = null;

    setLoading(true);
    setRendering(false);
    setError(null);
    setDoc(null);
    setPageNo(1);
    setPageCount(0);

    (async () => {
      try {
        ensurePromiseWithResolvers();
        const pdfjs = await loadPdfJs();
        pdfjs.GlobalWorkerOptions.workerSrc = '/api/pdf-worker';
        if (isTabletWebView()) {
          const data = await loadPdfArrayBuffer(source);
          loadingTask = pdfjs.getDocument({ data, useWorkerFetch: false, isEvalSupported: false });
        } else {
          loadingTask = pdfjs.getDocument({ url: source, withCredentials: true });
        }
        loadedDoc = await loadingTask.promise;
        if (!alive) return;
        setDoc(loadedDoc);
        setPageCount(loadedDoc.numPages);
      } catch (e) {
        if (alive) setError(pdfError(e));
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
  }, [source, reloadKey]);

  useEffect(() => {
    if (loading || !doc || !canvasRef.current || box.width <= 0 || box.height <= 0) return undefined;
    let alive = true;
    const canvas = canvasRef.current;

    (async () => {
      setRendering(true);
      setError(null);
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
          setError(pdfError(e, 'PDF 渲染失败，请重新加载，或下载原文件查看'));
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

  function openSystem() {
    window.location.assign(viewUrl || downloadUrl || source);
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
        {error && (
          <ViewerState
            title={error.title}
            detail={error.detail}
            error
            onReload={() => setReloadKey(v => v + 1)}
            downloadUrl={downloadUrl}
            onOpenSystem={openSystem}
          />
        )}
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

function ensurePromiseWithResolvers(): void {
  const promiseConstructor = Promise as PromiseConstructorWithResolvers;
  if (typeof promiseConstructor.withResolvers === 'function') {
    return;
  }

  promiseConstructor.withResolvers = function withResolvers<T>(): PromiseWithResolversResult<T> {
    let resolveFn: (value: T | PromiseLike<T>) => void = () => {};
    let rejectFn: (reason?: Error | string) => void = () => {};
    const promise = new Promise<T>((resolve, reject) => {
      resolveFn = resolve;
      rejectFn = reject;
    });

    return {
      promise,
      resolve: resolveFn,
      reject: rejectFn,
    };
  };
}

async function loadPdfJs(): Promise<PdfJsModule> {
  ensurePromiseWithResolvers();
  return import('pdfjs-dist/legacy/build/pdf.mjs');
}

async function loadPdfArrayBuffer(source: string): Promise<ArrayBuffer> {
  const response = await fetch(source, { credentials: 'include', cache: 'no-store' });
  const contentType = response.headers.get('content-type') || '';
  if (!response.ok) throw await responseError(response, contentType);
  if (!contentType.toLowerCase().includes('application/pdf')) throw await responseError(response, contentType);
  return response.arrayBuffer();
}

class PdfResponseError extends Error {
  readonly status: number;
  readonly contentType: string;

  constructor(name: string, status: number, contentType: string, message: string) {
    super(message);
    this.name = name;
    this.status = status;
    this.contentType = contentType;
  }
}

async function responseError(response: Response, contentType: string): Promise<PdfResponseError> {
  let summary = '';
  try {
    const text = await response.text();
    summary = contentType.toLowerCase().includes('application/json')
      ? sanitizeSnippet(extractJsonMessage(text) || text)
      : sanitizeSnippet(text);
  } catch {
    summary = '';
  }
  const diagnostic = `HTTP ${response.status} · ${contentType || '未知类型'}`;
  const detail = summary ? `${diagnostic} · 服务响应：${summary}` : diagnostic;
  const name = response.status === 401 ? 'PdfUnauthorized'
    : response.status === 404 ? 'PdfNotFound'
      : contentType.toLowerCase().includes('text/html') ? 'PdfHtmlResponse'
        : 'PdfBadResponse';
  return new PdfResponseError(name, response.status, contentType, detail);
}

function extractJsonMessage(value: string): string {
  const errorMatch = value.match(/"error"\s*:\s*"([^"]+)"/);
  if (errorMatch?.[1]) return errorMatch[1];
  const messageMatch = value.match(/"message"\s*:\s*"([^"]+)"/);
  if (messageMatch?.[1]) return messageMatch[1];
  return '';
}

function sanitizeSnippet(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, '[token hidden]')
    .replace(/"token"\s*:\s*"[^"]+"/gi, '"token":"[token hidden]"')
    .replace(/"signedUrl"\s*:\s*"[^"]+"/gi, '"signedUrl":"[hidden]"')
    .replace(/\s+/g, ' ')
    .slice(0, 200);
}

function isTabletWebView(): boolean {
  if (typeof window === 'undefined') return false;
  const ua = navigator.userAgent || '';
  return !!window.__HONGMENG_WEBVIEW__ || ua.includes('HongmengWorkorderWebView') || ua.includes('; wv') || /\bwv\b/i.test(ua);
}

function pdfError(error: unknown, fallback = 'PDF 预览组件初始化失败，可下载或用系统打开'): PdfLoadError {
  if (error instanceof Error) {
    if (error.name === 'PdfUnauthorized') return { title: '登录已过期，请重新登录', detail: '请退出后重新登录，再打开当前 PDF。' };
    if (error.name === 'PdfNotFound') return { title: 'PDF 文件不存在或已被删除', detail: '请刷新资料列表，确认文件仍在当前工单中。' };
    if (error.name === 'PdfHtmlResponse') return { title: '服务返回了页面而不是 PDF，请检查登录状态或重新打开文件', detail: error.message || '当前响应不是 PDF 文件流。' };
    if (/withResolvers/i.test(error.message)) return { title: 'PDF 预览组件初始化失败，可下载或用系统打开', detail: '检测到 Promise.withResolvers 兼容问题，请重新加载；若仍失败，请更新 APK 或系统 WebView。' };
    if (/worker|fake worker|pdf-worker/i.test(error.message)) return { title: 'PDF 预览组件初始化失败，可下载或用系统打开', detail: 'PDF worker 加载失败，请使用下方按钮处理。' };
    if (error.name === 'PdfBadResponse') return { title: 'PDF 文件流响应异常', detail: error.message || '服务没有返回 application/pdf。' };
    return { title: fallback, detail: error.message || '请重新加载，或下载原文件查看。' };
  }
  return { title: fallback, detail: '请重新加载，或下载原文件查看。' };
}

function ViewerState({
  title,
  detail,
  error = false,
  onReload,
  downloadUrl,
  onOpenSystem,
}: {
  title: string;
  detail: string;
  error?: boolean;
  onReload?: () => void;
  downloadUrl?: string;
  onOpenSystem?: () => void;
}) {
  return (
    <div className={error ? 'viewer-state error' : 'viewer-state'}>
      <span />
      <strong>{title}</strong>
      <p>{detail}</p>
      {error && (
        <div className="viewer-state-actions">
          {onReload && <button type="button" onClick={onReload}>重新加载</button>}
          {downloadUrl && <a href={downloadUrl} target="_blank" rel="noreferrer">下载 PDF</a>}
          {onOpenSystem && <button type="button" onClick={onOpenSystem}>用系统打开</button>}
        </div>
      )}
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
