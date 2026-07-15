'use client';

import { useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import type { PDFDocumentLoadingTask, PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import { usePreviewGestures } from '@/components/usePreviewGestures';
import { extractManualPageTitleCandidates, extractManualTocSuggestions } from '@/lib/connector-manual-toc';
import type { ConnectorManualTocSuggestion } from '@/lib/connector-manual-toc';

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

type PdfLoadError = { title: string; detail: string };

export type PdfTocSuggestion = ConnectorManualTocSuggestion;

type PdfViewerProps = {
  fileId: string;
  title: string;
  dashboardMode?: boolean;
  contentUrl?: string;
  downloadUrl?: string;
  viewUrl?: string;
  page?: number;
  onPageChange?: (page: number) => void;
  readingMode?: boolean;
  onAddToToc?: (title: string, page: number) => Promise<boolean>;
  onTocSuggestions?: (items: PdfTocSuggestion[]) => void;
  onCopyPageLink?: (page: number) => Promise<void> | void;
};

export function PdfViewer({
  fileId,
  title,
  dashboardMode = false,
  contentUrl,
  downloadUrl,
  viewUrl,
  page,
  onPageChange,
  readingMode = false,
  onAddToToc,
  onTocSuggestions,
  onCopyPageLink,
}: PdfViewerProps) {
  const [fullscreen, setFullscreen] = useState(false);
  const source = contentUrl || `/api/resource-files/${fileId}/content`;
  const fallbackDownloadUrl = downloadUrl || `/api/resource-files/${fileId}/download`;
  const fallbackViewUrl = viewUrl || `/api/resource-files/${fileId}/view`;

  return (
    <>
      <PdfCanvas source={source} title={title} dashboardMode={dashboardMode} downloadUrl={fallbackDownloadUrl} viewUrl={fallbackViewUrl} requestedPage={page} onPageChange={onPageChange} readingMode={readingMode} onAddToToc={onAddToToc} onTocSuggestions={onTocSuggestions} onCopyPageLink={onCopyPageLink} onFullscreen={() => setFullscreen(true)} />
      {fullscreen && (
        <PreviewModal title={title} onClose={() => setFullscreen(false)}>
          <PdfCanvas source={source} title={title} dashboardMode={dashboardMode} downloadUrl={fallbackDownloadUrl} viewUrl={fallbackViewUrl} requestedPage={page} onPageChange={onPageChange} readingMode={readingMode} onAddToToc={onAddToToc} onTocSuggestions={onTocSuggestions} onCopyPageLink={onCopyPageLink} fullscreen onClose={() => setFullscreen(false)} />
        </PreviewModal>
      )}
    </>
  );
}

function PdfCanvas({
  source,
  title,
  dashboardMode = false,
  downloadUrl,
  viewUrl,
  fullscreen = false,
  onFullscreen,
  onClose,
  requestedPage,
  onPageChange,
  readingMode = false,
  onAddToToc,
  onTocSuggestions,
  onCopyPageLink,
}: {
  source: string;
  title: string;
  dashboardMode?: boolean;
  downloadUrl: string;
  viewUrl: string;
  fullscreen?: boolean;
  onFullscreen?: () => void;
  onClose?: () => void;
  requestedPage?: number;
  onPageChange?: (page: number) => void;
  readingMode?: boolean;
  onAddToToc?: (title: string, page: number) => Promise<boolean>;
  onTocSuggestions?: (items: PdfTocSuggestion[]) => void;
  onCopyPageLink?: (page: number) => Promise<void> | void;
}) {
  const shellRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderTaskRef = useRef<{ cancel: () => void } | null>(null);
  const [doc, setDoc] = useState<PdfDocument | null>(null);
  const [pageNo, setPageNo] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const [baseSize, setBaseSize] = useState({ width: 0, height: 0 });
  const [renderedZoom, setRenderedZoom] = useState(1);
  const [loading, setLoading] = useState(true);
  const [slowLoading, setSlowLoading] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState<PdfLoadError | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [tocOpen, setTocOpen] = useState(false);
  const [tocTitle, setTocTitle] = useState('');
  const [tocSaving, setTocSaving] = useState(false);
  const [pageTitleCandidates, setPageTitleCandidates] = useState<string[]>([]);
  const tocSuggestionsCallbackRef = useRef(onTocSuggestions);
  const gestures = usePreviewGestures({
    stageRef: shellRef,
    contentSize: baseSize,
    viewportSize: box,
    resetKey: `${source}|${fullscreen ? 'fullscreen' : 'inline'}|${reloadKey}`,
    initialFitMode: dashboardMode ? 'fit-height' : 'fit-window',
    scrollWheel: dashboardMode,
  });
  const recenterPreview = gestures.recenter;

  useEffect(() => {
    tocSuggestionsCallbackRef.current = onTocSuggestions;
  }, [onTocSuggestions]);

  useEffect(() => {
    const node = shellRef.current;
    if (!node) return undefined;
    let frame = 0;
    const resize = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const width = node.clientWidth;
        const height = node.clientHeight;
        setBox(current => current.width === width && current.height === height ? current : { width, height });
      });
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(node);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    let alive = true;
    let loadingTask: PdfLoadingTask | null = null;
    let loadedDoc: PdfDocument | null = null;

    setLoading(true);
    setSlowLoading(false);
    setRendering(false);
    setError(null);
    setDoc(null);
    setPageNo(1);
    setPageCount(0);
    setBaseSize({ width: 0, height: 0 });
    setRenderedZoom(1);
    setPageTitleCandidates([]);
    setTocOpen(false);

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
        void collectPdfTocSuggestions(loadedDoc).then(items => {
          if (alive) tocSuggestionsCallbackRef.current?.(items);
        });
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
    if (!pageCount || requestedPage === undefined) return;
    const nextPage = Math.max(1, Math.min(pageCount, Math.floor(requestedPage)));
    setPageNo(nextPage);
  }, [pageCount, requestedPage]);

  useEffect(() => {
    if (!doc) return undefined;
    let alive = true;
    void doc.getPage(pageNo).then(page => {
      if (!alive) return;
      const viewport = page.getViewport({ scale: 1, rotation: 0 });
      setBaseSize(current => current.width === viewport.width && current.height === viewport.height ? current : { width: viewport.width, height: viewport.height });
      return extractPdfPageLines(page);
    }).then(lines => {
      if (alive && lines) setPageTitleCandidates(extractManualPageTitleCandidates(lines));
    }).catch(() => {
      if (alive) setPageTitleCandidates([]);
    });
    return () => { alive = false; };
  }, [doc, pageNo]);

  useEffect(() => {
    recenterPreview();
    setTocOpen(false);
  }, [pageNo, recenterPreview]);

  useEffect(() => {
    if (!loading) {
      setSlowLoading(false);
      return undefined;
    }
    const timer = window.setTimeout(() => setSlowLoading(true), 8000);
    return () => window.clearTimeout(timer);
  }, [loading, source, reloadKey]);

  const boxReady = box.width > 0 && box.height > 0;

  useEffect(() => {
    if (loading || !doc || !canvasRef.current || !boxReady) return undefined;
    let alive = true;
    const canvas = canvasRef.current;

    (async () => {
      setRendering(true);
      setError(null);
      try {
        renderTaskRef.current?.cancel();
        const page = await doc.getPage(pageNo);
        if (!alive) return;
        const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
        const viewport = page.getViewport({ scale: gestures.committedZoom * dpr, rotation: gestures.rotation });
        const offscreen = document.createElement('canvas');
        offscreen.width = Math.floor(viewport.width);
        offscreen.height = Math.floor(viewport.height);
        const offscreenContext = offscreen.getContext('2d');
        if (!offscreenContext) throw new Error('Canvas unavailable');
        const task = page.render({ canvasContext: offscreenContext, viewport });
        renderTaskRef.current = task;
        await task.promise;
        if (!alive) return;
        canvas.width = offscreen.width;
        canvas.height = offscreen.height;
        canvas.style.width = `${Math.floor(viewport.width / dpr)}px`;
        canvas.style.height = `${Math.floor(viewport.height / dpr)}px`;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Canvas unavailable');
        context.drawImage(offscreen, 0, 0);
        setRenderedZoom(gestures.committedZoom);
        const nearby = [pageNo - 1, pageNo + 1].filter(value => value >= 1 && value <= doc.numPages);
        await Promise.all(nearby.map(value => doc.getPage(value).catch(() => null)));
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
  }, [boxReady, doc, pageNo, gestures.committedZoom, gestures.rotation, loading]);

  function goToPage(value: number) {
    if (!pageCount) return;
    const nextPage = Math.max(1, Math.min(pageCount, Math.floor(value)));
    setPageNo(nextPage);
    gestures.recenter();
    onPageChange?.(nextPage);
  }

  function openSystem() {
    window.location.assign(viewUrl || downloadUrl || source);
  }

  function openQuickToc(): void {
    setTocTitle(pageTitleCandidates[0] || '');
    setTocOpen(true);
  }

  async function submitQuickToc(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!onAddToToc || !tocTitle.trim()) return;
    setTocSaving(true);
    try {
      const saved = await onAddToToc(tocTitle.trim(), pageNo);
      if (saved) {
        setTocOpen(false);
        setTocTitle('');
      }
    } finally {
      setTocSaving(false);
    }
  }

  function restartReading(): void {
    gestures.reset();
    goToPage(1);
  }

  const displayScale = gestures.zoom / Math.max(0.001, renderedZoom);
  const scrollSurfaceStyle = dashboardMode ? {
    width: `${Math.max(box.width, gestures.rotatedSize.width * gestures.zoom + 40)}px`,
    height: `${Math.max(box.height, gestures.rotatedSize.height * gestures.zoom + 40)}px`,
  } : undefined;

  return (
    <div className={`${fullscreen ? 'pdf-viewer fullscreen-viewer' : 'pdf-viewer'}${readingMode ? ' reading-viewer' : ''}${dashboardMode ? ' dashboard-preview-viewer' : ''}`}>
      <div className="viewer-toolbar pdf-toolbar">
        <div className="viewer-title" title={title}>
          <span>PDF</span>
          <strong>{title}</strong>
        </div>
        <div className="viewer-controls">
          {dashboardMode ? <>
            <button type="button" aria-label="上一页" title="上一页" disabled={pageNo <= 1 || loading} onClick={() => goToPage(pageNo - 1)}>‹</button>
            <label className="page-jump dashboard-page-jump" title="输入页码跳转"><input aria-label="PDF 页码" type="number" min={1} max={pageCount || 1} value={pageNo} disabled={!pageCount || loading} onChange={event => goToPage(Number(event.target.value || 1))} /><span>/ {pageCount || '-'}</span></label>
            <button type="button" aria-label="下一页" title="下一页" disabled={!pageCount || pageNo >= pageCount || loading} onClick={() => goToPage(pageNo + 1)}>›</button>
            <button type="button" aria-label="缩小" title="缩小" disabled={loading} onClick={() => gestures.zoomBy(1 / 1.15)}>−</button>
            <span className="viewer-zoom-value" aria-live="polite">{Math.round(gestures.zoom * 100)}%</span>
            <button type="button" aria-label="放大" title="放大" disabled={loading} onClick={() => gestures.zoomBy(1.15)}>＋</button>
            <button className={gestures.fitMode === 'fit-height' ? 'active' : ''} type="button" disabled={loading} onClick={() => gestures.setFitMode('fit-height')}>适高</button>
            <button type="button" aria-label="向左旋转" title="向左旋转" disabled={loading} onClick={() => gestures.rotateBy(-90)}>↺</button>
            {fullscreen ? <button className="viewer-close-button" type="button" onClick={onClose}>关闭</button> : <button type="button" disabled={loading} onClick={onFullscreen}>全屏</button>}
            <details className="viewer-more"><summary aria-label="更多预览操作" title="更多预览操作">更多</summary><div><button type="button" disabled={loading} onClick={() => gestures.setFitMode('fit-width')}>适应宽度</button><button type="button" disabled={loading} onClick={() => gestures.setFitMode('fit-window')}>适应整页</button><button type="button" disabled={loading} onClick={() => gestures.setFitMode('actual-size')}>原始大小</button><button type="button" disabled={loading} onClick={gestures.reset}>重置视图</button><button type="button" disabled={loading} onClick={() => gestures.rotateBy(90)}>向右旋转</button><a href={downloadUrl} target="_blank" rel="noreferrer">下载</a><button type="button" onClick={openSystem}>系统打开</button></div></details>
          </> : <>
          <button type="button" disabled={pageNo <= 1 || loading} onClick={() => goToPage(pageNo - 1)}>上一页</button>
          <label className="page-jump" title="输入页码跳转"><input aria-label="PDF 页码" type="number" min={1} max={pageCount || 1} value={pageNo} disabled={!pageCount || loading} onChange={event => goToPage(Number(event.target.value || 1))} /><span>/ {pageCount || '-'}</span></label>
          <button type="button" disabled={!pageCount || pageNo >= pageCount || loading} onClick={() => goToPage(pageNo + 1)}>下一页</button>
          <button type="button" disabled={loading} onClick={() => gestures.setFitMode('fit-window')}>适应窗口</button>
          <button type="button" disabled={loading} onClick={() => gestures.rotateBy(-90)}>左旋</button>
          <button type="button" disabled={loading} onClick={() => gestures.rotateBy(90)}>右旋</button>
          {fullscreen ? <button className="viewer-close-button" type="button" onClick={onClose}>关闭</button> : <button type="button" disabled={loading} onClick={onFullscreen}>全屏</button>}
          {onAddToToc && <button className="viewer-toc-action" type="button" disabled={loading || !pageCount} aria-expanded={tocOpen} onClick={openQuickToc}>添加至目录</button>}
          {readingMode ? (
            <details className="viewer-more"><summary>更多</summary><div><button type="button" disabled={loading} onClick={() => gestures.zoomBy(1 / 1.15)}>缩小</button><button type="button" disabled={loading} onClick={() => gestures.zoomBy(1.15)}>放大</button><button type="button" disabled={loading} onClick={() => gestures.setFitMode('fit-width')}>适宽</button><button type="button" disabled={loading} onClick={() => gestures.setFitMode('fit-window')}>整页</button><button type="button" disabled={loading} onClick={() => gestures.setFitMode('actual-size')}>原始大小</button><button type="button" disabled={loading || gestures.rotation === 0} onClick={() => gestures.rotateBy(-gestures.rotation)}>重置旋转</button><button type="button" disabled={loading} onClick={gestures.reset}>重置视图</button><button type="button" disabled={loading} onClick={restartReading}>从头阅读</button><a href={downloadUrl} target="_blank" rel="noreferrer">下载</a><button type="button" onClick={openSystem}>系统打开</button>{onCopyPageLink && <button type="button" onClick={() => void onCopyPageLink(pageNo)}>复制当前页链接</button>}</div></details>
          ) : <><button type="button" disabled={loading} onClick={() => gestures.zoomBy(1 / 1.15)} title="缩小">−</button><button type="button" disabled={loading} onClick={() => gestures.zoomBy(1.15)} title="放大">＋</button><button type="button" disabled={loading} onClick={gestures.reset}>重置</button><button type="button" disabled={loading} onClick={() => gestures.setFitMode('fit-width')}>适宽</button><button type="button" disabled={loading} onClick={() => gestures.setFitMode('actual-size')}>原始大小</button></>}
          </>}
        </div>
        {tocOpen && (
          <form className="viewer-toc-popover" onSubmit={submitQuickToc} role="dialog" aria-label="添加当前页至目录">
            <label><span>目录标题</span><input autoFocus value={tocTitle} onChange={event => setTocTitle(event.target.value)} maxLength={160} placeholder="输入当前页章节标题" /></label>
            <p>当前页：第 {pageNo} 页</p>
            <div><button type="button" onClick={() => setTocOpen(false)}>取消</button><button className="primary-button" type="submit" disabled={tocSaving || !tocTitle.trim()}>{tocSaving ? '添加中...' : '添加'}</button></div>
          </form>
        )}
      </div>
      <div
        className={`viewer-stage pdf-stage gesture-stage${gestures.isDragging ? ' dragging' : ''}`}
        ref={shellRef}
        onPointerDown={gestures.onPointerDown}
        onPointerMove={gestures.onPointerMove}
        onPointerUp={gestures.onPointerUp}
        onPointerCancel={gestures.onPointerCancel}
        onDoubleClick={gestures.onDoubleClick}
      >
        {loading && <ViewerState title={slowLoading ? 'PDF 加载较慢' : 'PDF 加载中'} detail={slowLoading ? 'PDF 加载较慢，可继续等待或下载查看。' : '正在读取同源文件流'} downloadUrl={slowLoading ? downloadUrl : undefined} />}
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
            {dashboardMode ? (
              <div className="viewer-scroll-surface" style={scrollSurfaceStyle}>
                <div className={`viewer-gesture-content${gestures.isGestureActive ? ' active' : ''}`} style={{ transform: `translate3d(${gestures.panX}px, ${gestures.panY}px, 0) scale(${displayScale})` }}>
                  <canvas ref={canvasRef} aria-label={title} />
                </div>
              </div>
            ) : (
              <div className={`viewer-gesture-content${gestures.isGestureActive ? ' active' : ''}`} style={{ transform: `translate3d(${gestures.panX}px, ${gestures.panY}px, 0) scale(${displayScale})` }}>
                <canvas ref={canvasRef} aria-label={title} />
              </div>
            )}
          </>
        )}
        {gestures.zoomHint && <div className="viewer-zoom-hint" aria-live="polite">{gestures.zoomHint}</div>}
      </div>
    </div>
  );
}

type PdfOutlineNode = {
  title: string;
  dest: string | unknown[] | null;
  items?: PdfOutlineNode[];
};

async function extractPdfPageLines(page: PDFPageProxy): Promise<string[]> {
  const content = await page.getTextContent();
  const rows: Array<{ y: number; items: Array<{ x: number; text: string }> }> = [];
  for (const rawItem of content.items) {
    if (!('str' in rawItem) || !rawItem.str.trim()) continue;
    const x = Number(rawItem.transform?.[4] || 0);
    const y = Number(rawItem.transform?.[5] || 0);
    let row = rows.find(item => Math.abs(item.y - y) <= 2.5);
    if (!row) {
      row = { y, items: [] };
      rows.push(row);
    }
    row.items.push({ x, text: rawItem.str.trim() });
  }
  return rows
    .sort((first, second) => second.y - first.y)
    .map(row => row.items.sort((first, second) => first.x - second.x).map(item => item.text).join(' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

async function resolveOutlinePage(doc: PdfDocument, destination: string | unknown[] | null): Promise<number | null> {
  try {
    const explicit = typeof destination === 'string' ? await doc.getDestination(destination) : destination;
    if (!Array.isArray(explicit) || !explicit[0]) return null;
    const pageIndex = await doc.getPageIndex(explicit[0] as Parameters<PdfDocument['getPageIndex']>[0]);
    return pageIndex + 1;
  } catch {
    return null;
  }
}

async function collectOutlineSuggestions(doc: PdfDocument, nodes: PdfOutlineNode[], output: PdfTocSuggestion[]): Promise<void> {
  for (const node of nodes) {
    const title = String(node.title || '').trim().slice(0, 160);
    const page = await resolveOutlinePage(doc, node.dest);
    if (title && page && !output.some(item => item.title === title && item.pageStart === page)) {
      output.push({ title, pageStart: page, pageEnd: page, source: 'outline' });
    }
    if (node.items?.length) await collectOutlineSuggestions(doc, node.items, output);
  }
}

async function collectPdfTocSuggestions(doc: PdfDocument): Promise<PdfTocSuggestion[]> {
  const suggestions: PdfTocSuggestion[] = [];
  try {
    const outline = await doc.getOutline() as unknown as PdfOutlineNode[] | null;
    if (outline?.length) await collectOutlineSuggestions(doc, outline, suggestions);
  } catch {
    // Outline support is optional; text extraction remains available.
  }
  const documentLines: string[] = [];
  const inspectedPages = Math.min(3, doc.numPages);
  for (let pageNo = 1; pageNo <= inspectedPages; pageNo += 1) {
    try {
      documentLines.push(...await extractPdfPageLines(await doc.getPage(pageNo)));
    } catch {
      // A single unreadable page must not block manual TOC entry.
    }
  }
  for (const suggestion of extractManualTocSuggestions(documentLines, doc.numPages)) {
    if (!suggestions.some(item => item.title.toLocaleLowerCase('zh-CN') === suggestion.title.toLocaleLowerCase('zh-CN') && item.pageStart === suggestion.pageStart)) suggestions.push(suggestion);
  }
  return suggestions.slice(0, 50);
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
      {(error || downloadUrl || onReload || onOpenSystem) && (
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
