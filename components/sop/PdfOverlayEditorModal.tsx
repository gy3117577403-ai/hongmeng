'use client';

import {
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsDown,
  ChevronsUp,
  Eye,
  EyeOff,
  FileText,
  Highlighter,
  ImagePlus,
  Layers3,
  Lock,
  Minus,
  MousePointer2,
  Pencil,
  Redo2,
  Save,
  Scan,
  Send,
  ShieldCheck,
  ShieldOff,
  Square,
  Trash2,
  Type,
  Undo2,
  Unlock,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type {
  ChangeEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from 'react';
import type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  PDFPageProxy,
  RenderTask,
} from 'pdfjs-dist';
import { createPdfJsAssetOptions } from '@/lib/pdfjs-assets';
import { documentDisplaySettingsUrl, type PageRotations } from '@/lib/document-orientation';
import styles from './PdfOverlayEditorModal.module.css';
import { exportPdfOverlayPngs } from './pdf-overlay-export';
import {
  PDF_OVERLAY_SCHEMA_VERSION,
} from './pdf-overlay-editor-types';
import type {
  PdfOverlayAnnotation,
  PdfOverlayAnnotationStyle,
  PdfOverlayDocument,
  PdfOverlayControlMode,
  PdfOverlayEditorModalProps,
  PdfOverlayPersistenceResult,
  PdfOverlayPoint,
  PdfOverlayTool,
} from './pdf-overlay-editor-types';

export type {
  PdfOverlayAnnotation,
  PdfOverlayDocument,
  PdfOverlayEditorModalProps,
  PdfOverlayPoint,
  PdfOverlayTool,
} from './pdf-overlay-editor-types';

type PdfJsModule = typeof import('pdfjs-dist/legacy/build/pdf.mjs');
type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';
type RightPanelTab = 'properties' | 'layers';
type ResizeCorner = 'nw' | 'ne' | 'sw' | 'se';
type StageSize = { width: number; height: number };
type PageSize = { width: number; height: number };

type PointerInteraction = {
  mode: 'create' | 'move' | 'resize';
  pointerId: number;
  annotationId: string;
  start: PdfOverlayPoint;
  original: PdfOverlayAnnotation;
  before: PdfOverlayAnnotation[];
  corner?: ResizeCorner;
};

type PromiseWithResolversResult<T> = {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
};

type PromiseConstructorWithResolvers = PromiseConstructor & {
  withResolvers?: <T>() => PromiseWithResolversResult<T>;
};

const SVG_WIDTH = 1000;
const MAX_HISTORY = 60;
const MAX_INLINE_IMAGE_BYTES = 16 * 1024 * 1024;

const TOOL_LABELS: Record<PdfOverlayTool, string> = {
  select: '选择',
  text: '文字',
  image: '图片',
  rectangle: '矩形',
  arrow: '箭头',
  pen: '画笔',
  highlight: '高亮',
  cover: '遮盖',
};

const ANNOTATION_LABELS: Record<PdfOverlayAnnotation['kind'], string> = {
  text: '文字',
  image: '图片',
  rectangle: '矩形',
  arrow: '箭头',
  pen: '画笔',
  highlight: '高亮',
  cover: '遮盖',
};

function clamp(value: number, minimum = 0, maximum = 1): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function cloneAnnotations(value: PdfOverlayAnnotation[]): PdfOverlayAnnotation[] {
  return typeof structuredClone === 'function'
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value)) as PdfOverlayAnnotation[];
}

function annotationsSignature(value: PdfOverlayAnnotation[]): string {
  return JSON.stringify(value);
}

function makeId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `overlay-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function defaultStyle(kind: PdfOverlayAnnotation['kind']): PdfOverlayAnnotationStyle {
  if (kind === 'highlight') {
    return {
      stroke: '#f7c948',
      fill: 'transparent',
      textColor: '#172033',
      opacity: 0.42,
      strokeWidth: 22,
      fontSize: 28,
    };
  }
  if (kind === 'cover') {
    return {
      stroke: '#d9e0ea',
      fill: '#ffffff',
      textColor: '#172033',
      opacity: 1,
      strokeWidth: 1.5,
      fontSize: 28,
    };
  }
  if (kind === 'text') {
    return {
      stroke: 'transparent',
      fill: 'transparent',
      textColor: '#172033',
      opacity: 1,
      strokeWidth: 2.5,
      fontSize: 30,
    };
  }
  return {
    stroke: '#ff6a00',
    fill: kind === 'rectangle' ? 'rgba(255, 106, 0, 0.06)' : 'transparent',
    textColor: '#172033',
    opacity: 1,
    strokeWidth: kind === 'pen' ? 4 : 3,
    fontSize: 28,
  };
}

function createAnnotation(
  kind: PdfOverlayAnnotation['kind'],
  page: number,
  point: PdfOverlayPoint,
  zIndex: number,
): PdfOverlayAnnotation {
  const timestamp = nowIso();
  const sized = kind === 'text'
    ? { width: 0.28, height: 0.085 }
    : kind === 'image'
      ? { width: 0.3, height: 0.22 }
      : { width: 0.001, height: 0.001 };
  return {
    id: makeId(),
    page,
    kind,
    x: clamp(point.x),
    y: clamp(point.y),
    ...sized,
    endX: kind === 'arrow' ? clamp(point.x + 0.001) : undefined,
    endY: kind === 'arrow' ? clamp(point.y + 0.001) : undefined,
    points: kind === 'pen' || kind === 'highlight' ? [point] : undefined,
    text: kind === 'text' ? '输入说明文字' : undefined,
    style: defaultStyle(kind),
    zIndex,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function annotationBounds(annotation: PdfOverlayAnnotation): { x: number; y: number; width: number; height: number } {
  if (annotation.kind === 'arrow') {
    const endX = annotation.endX ?? annotation.x + annotation.width;
    const endY = annotation.endY ?? annotation.y + annotation.height;
    return {
      x: Math.min(annotation.x, endX),
      y: Math.min(annotation.y, endY),
      width: Math.max(0.012, Math.abs(endX - annotation.x)),
      height: Math.max(0.012, Math.abs(endY - annotation.y)),
    };
  }
  if ((annotation.kind === 'pen' || annotation.kind === 'highlight') && annotation.points?.length) {
    const xs = annotation.points.map(point => point.x);
    const ys = annotation.points.map(point => point.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    return {
      x: minX,
      y: minY,
      width: Math.max(0.012, Math.max(...xs) - minX),
      height: Math.max(0.012, Math.max(...ys) - minY),
    };
  }
  return {
    x: annotation.x,
    y: annotation.y,
    width: Math.max(0.012, annotation.width),
    height: Math.max(0.012, annotation.height),
  };
}

function normalizedPagePoint(
  event: ReactPointerEvent<SVGElement>,
  node: SVGSVGElement,
): PdfOverlayPoint {
  const matrix = node.getScreenCTM();
  if (matrix) {
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    return { x: clamp(point.x / Math.max(1, node.viewBox.baseVal.width)), y: clamp(point.y / Math.max(1, node.viewBox.baseVal.height)) };
  }
  const box = node.getBoundingClientRect();
  return {
    x: clamp((event.clientX - box.left) / Math.max(1, box.width)),
    y: clamp((event.clientY - box.top) / Math.max(1, box.height)),
  };
}

function ensurePromiseWithResolvers(): void {
  const promiseConstructor = Promise as PromiseConstructorWithResolvers;
  if (typeof promiseConstructor.withResolvers === 'function') return;
  promiseConstructor.withResolvers = function withResolvers<T>(): PromiseWithResolversResult<T> {
    let resolveFn: (value: T | PromiseLike<T>) => void = () => {};
    let rejectFn: (reason?: unknown) => void = () => {};
    const promise = new Promise<T>((resolve, reject) => {
      resolveFn = resolve;
      rejectFn = reject;
    });
    return { promise, resolve: resolveFn, reject: rejectFn };
  };
}

async function loadPdfJs(): Promise<PdfJsModule> {
  ensurePromiseWithResolvers();
  return import('pdfjs-dist/legacy/build/pdf.mjs');
}

async function sourceData(source: Blob | ArrayBuffer | Uint8Array): Promise<ArrayBuffer> {
  if (source instanceof Blob) return source.arrayBuffer();
  if (source instanceof ArrayBuffer) return source.slice(0);
  return source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength) as ArrayBuffer;
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('读取图片失败'));
    reader.readAsDataURL(file);
  });
}

function normalizeInitialDocument(
  initial: PdfOverlayDocument | null | undefined,
  sourceId: string | undefined,
  baseFileId: string | undefined,
  fileName: string,
): PdfOverlayDocument {
  const annotations = Array.isArray(initial?.annotations)
    ? initial.annotations.filter(item => item && typeof item.id === 'string' && Number(item.page) > 0)
    : [];
  return {
    schemaVersion: PDF_OVERLAY_SCHEMA_VERSION,
    sourceId: sourceId || initial?.sourceId,
    baseFileId: baseFileId || initial?.baseFileId,
    sourceFileName: fileName,
    pageCount: Math.max(0, Number(initial?.pageCount || 0)),
    annotations: cloneAnnotations(annotations),
    revision: initial?.revision,
    updatedAt: initial?.updatedAt || nowIso(),
  };
}

function draftIdentityError(
  initial: PdfOverlayDocument | null | undefined,
  sourceId: string | undefined,
  baseFileId: string | undefined,
): string {
  if (initial?.baseFileId && baseFileId && initial.baseFileId !== baseFileId) {
    return '草稿所属文件版本与当前 PDF 不一致，已阻止载入和保存。请重新获取当前文件的草稿。';
  }
  if (initial?.sourceId && sourceId && initial.sourceId !== sourceId) {
    return '草稿所属资料与当前资料不一致，已阻止载入和保存。请重新选择正确的资料。';
  }
  return '';
}

function statusLabel(state: SaveState, lastSavedAt: Date | null): string {
  if (state === 'saving') return '正在保存';
  if (state === 'error') return '保存失败';
  if (state === 'dirty') return '有未保存修改';
  if (state === 'saved' && lastSavedAt) {
    return `${lastSavedAt.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })} 已保存`;
  }
  return '草稿未修改';
}

function toolIcon(tool: PdfOverlayTool): ReactNode {
  switch (tool) {
    case 'select': return <MousePointer2 size={18} />;
    case 'text': return <Type size={18} />;
    case 'image': return <ImagePlus size={18} />;
    case 'rectangle': return <Square size={18} />;
    case 'arrow': return <ArrowUpRight size={18} />;
    case 'pen': return <Pencil size={18} />;
    case 'highlight': return <Highlighter size={18} />;
    case 'cover': return <Scan size={18} />;
  }
}

function visibleThumbnailPages(pageCount: number, pageNumber: number): number[] {
  if (pageCount <= 14) return Array.from({ length: pageCount }, (_, index) => index + 1);
  const pages = new Set<number>([1, pageCount]);
  for (let value = pageNumber - 3; value <= pageNumber + 3; value += 1) {
    if (value >= 1 && value <= pageCount) pages.add(value);
  }
  return [...pages].sort((a, b) => a - b);
}

function PdfPageThumbnail({
  document,
  page,
  rotation = 0,
  active,
  changeCount,
  onSelect,
}: {
  document: PDFDocumentProxy;
  page: number;
  rotation?: number;
  active: boolean;
  changeCount: number;
  onSelect: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let alive = true;
    let renderTask: RenderTask | null = null;
    void document.getPage(page).then(pdfPage => {
      if (!alive || !canvasRef.current) return;
      const base = pdfPage.getViewport({ scale: 1, rotation: (pdfPage.rotate + rotation) % 360 });
      const scale = Math.min(0.24, 112 / Math.max(1, base.width));
      const viewport = pdfPage.getViewport({ scale, rotation: (pdfPage.rotate + rotation) % 360 });
      const canvas = canvasRef.current;
      canvas.width = Math.max(1, Math.round(viewport.width));
      canvas.height = Math.max(1, Math.round(viewport.height));
      const context = canvas.getContext('2d');
      if (!context) return;
      renderTask = pdfPage.render({ canvasContext: context, viewport });
      return renderTask.promise;
    }).catch(() => undefined);
    return () => {
      alive = false;
      renderTask?.cancel();
    };
  }, [document, page, rotation]);

  return (
    <button
      type="button"
      className={`${styles.thumbnail}${active ? ` ${styles.thumbnailActive}` : ''}`}
      onClick={onSelect}
      aria-current={active ? 'page' : undefined}
    >
      <span className={styles.thumbnailCanvas}><canvas ref={canvasRef} /></span>
      <span className={styles.thumbnailMeta}>
        <strong>第 {page} 页</strong>
        {changeCount > 0 ? <em>{changeCount} 处修改</em> : <span>原稿</span>}
      </span>
    </button>
  );
}

export function PdfOverlayEditorModal({
  open,
  sourceUrl,
  sourceFile,
  sourceId,
  baseFileId,
  fileName,
  title = 'SOP 图纸二次编辑',
  versionLabel = '当前版本',
  initialDocument,
  onClose,
  onSave,
  onPublish,
  onUploadImage,
  autoSaveDelayMs = 0,
}: PdfOverlayEditorModalProps) {
  const identityError = useMemo(
    () => draftIdentityError(initialDocument, sourceId, baseFileId),
    [baseFileId, initialDocument, sourceId],
  );
  const stableSourceKey = baseFileId
    ? `${baseFileId}::${sourceId || ''}`
    : sourceId || sourceUrl || fileName;
  const initial = useMemo(
    () => normalizeInitialDocument(identityError ? null : initialDocument, sourceId, baseFileId, fileName),
    [baseFileId, fileName, identityError, initialDocument, sourceId],
  );
  const [annotations, setAnnotations] = useState<PdfOverlayAnnotation[]>(initial.annotations);
  const annotationsRef = useRef(annotations);
  const [undoStack, setUndoStack] = useState<PdfOverlayAnnotation[][]>([]);
  const [redoStack, setRedoStack] = useState<PdfOverlayAnnotation[][]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tool, setTool] = useState<PdfOverlayTool>('select');
  const [pdfDocument, setPdfDocument] = useState<PDFDocumentProxy | null>(null);
  const [pdfPage, setPdfPage] = useState<PDFPageProxy | null>(null);
  const [pageCount, setPageCount] = useState(initial.pageCount);
  const [revision, setRevision] = useState(initial.revision);
  const [pageNumber, setPageNumber] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>({ width: 595, height: 842 });
  const [displayRotations, setDisplayRotations] = useState<PageRotations>({});
  const [directionError, setDirectionError] = useState('');
  const [directionLoading, setDirectionLoading] = useState(false);
  useEffect(() => {
    const url = documentDisplaySettingsUrl(sourceUrl || '');
    setDisplayRotations({}); setDirectionError('');
    if (!open || !url) return;
    const controller = new AbortController();
    setDirectionLoading(true);
    void fetch(url, { cache: 'no-store', signal: controller.signal }).then(async response => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '阅读方向读取失败，请关闭后重试');
      setDisplayRotations(data.pageRotations);
    }).catch(error => {
      if (!controller.signal.aborted) setDirectionError(error instanceof Error ? error.message : '阅读方向读取失败');
    }).finally(() => { if (!controller.signal.aborted) setDirectionLoading(false); });
    return () => controller.abort();
  }, [open, sourceUrl]);
  const [stageSize, setStageSize] = useState<StageSize>({ width: 720, height: 780 });
  const [zoom, setZoom] = useState(100);
  const [fitMode, setFitMode] = useState<'page' | 'width' | 'custom'>('page');
  const [loading, setLoading] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [minimized, setMinimized] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);
  const [rightTab, setRightTab] = useState<RightPanelTab>('properties');
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [message, setMessage] = useState('');
  const [uploadingImage, setUploadingImage] = useState(false);
  const [publishPromptOpen, setPublishPromptOpen] = useState(false);
  const [publishControlMode, setPublishControlMode] = useState<PdfOverlayControlMode>('uncontrolled');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<SVGSVGElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const renderTaskRef = useRef<RenderTask | null>(null);
  const loadingTaskRef = useRef<PDFDocumentLoadingTask | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const interactionRef = useRef<PointerInteraction | null>(null);
  const propertyEditBeforeRef = useRef<PdfOverlayAnnotation[] | null>(null);
  const imageInsertPointRef = useRef<PdfOverlayPoint>({ x: 0.35, y: 0.22 });
  const savePromiseRef = useRef<Promise<PdfOverlayDocument | null> | null>(null);
  const loadedSourceRef = useRef<string | null>(null);

  const selected = useMemo(
    () => annotations.find(annotation => annotation.id === selectedId) || null,
    [annotations, selectedId],
  );
  const pageAnnotations = useMemo(
    () => annotations
      .filter(annotation => annotation.page === pageNumber)
      .sort((first, second) => first.zIndex - second.zIndex),
    [annotations, pageNumber],
  );
  const thumbnailPages = useMemo(
    () => visibleThumbnailPages(pageCount, pageNumber),
    [pageCount, pageNumber],
  );

  useEffect(() => {
    annotationsRef.current = annotations;
  }, [annotations]);

  useEffect(() => {
    if (!open) return;
    if (loadedSourceRef.current === stableSourceKey) return;
    loadedSourceRef.current = stableSourceKey;
    const next = normalizeInitialDocument(identityError ? null : initialDocument, sourceId, baseFileId, fileName);
    annotationsRef.current = next.annotations;
    setAnnotations(next.annotations);
    setUndoStack([]);
    setRedoStack([]);
    setSelectedId(null);
    setPageNumber(1);
    setPageCount(next.pageCount);
    setRevision(next.revision);
    setTool('select');
    setZoom(100);
    setFitMode('page');
    setSaveState('idle');
    setLastSavedAt(null);
    setMessage(identityError);
    setMinimized(false);
    setPublishPromptOpen(false);
    setPublishControlMode('uncontrolled');
  }, [baseFileId, fileName, identityError, initialDocument, open, sourceId, stableSourceKey]);

  useEffect(() => {
    if (!open || minimized) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [minimized, open]);

  useEffect(() => {
    if (!open || !stableSourceKey) return undefined;
    let alive = true;
    let loadedDocument: PDFDocumentProxy | null = null;
    setLoading(true);
    setLoadError('');
    setPdfDocument(null);
    setPdfPage(null);

    void (async () => {
      try {
        const pdfjs = await loadPdfJs();
        pdfjs.GlobalWorkerOptions.workerSrc = '/api/pdf-worker';
        const assetOptions = createPdfJsAssetOptions();
        const params = sourceFile
          ? { data: await sourceData(sourceFile), ...assetOptions, useWorkerFetch: false, isEvalSupported: false }
          : sourceUrl
            ? { url: sourceUrl, withCredentials: true, ...assetOptions }
            : null;
        if (!params) throw new Error('没有可加载的 PDF 文件');
        const loadingTask = pdfjs.getDocument(params);
        loadingTaskRef.current = loadingTask;
        loadedDocument = await loadingTask.promise;
        if (!alive) return;
        setPdfDocument(loadedDocument);
        setPageCount(loadedDocument.numPages);
      } catch (error) {
        if (alive) setLoadError(error instanceof Error ? error.message : 'PDF 加载失败');
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
      renderTaskRef.current?.cancel();
      loadingTaskRef.current?.destroy?.();
      loadedDocument?.destroy?.();
      loadingTaskRef.current = null;
    };
  }, [open, sourceFile, sourceUrl, stableSourceKey]);

  useEffect(() => {
    if (!pdfDocument) return undefined;
    let alive = true;
    void pdfDocument.getPage(pageNumber).then(page => {
      if (!alive) return;
      const viewport = page.getViewport({ scale: 1 });
      setPdfPage(page);
      setPageSize({ width: viewport.width, height: viewport.height });
    }).catch(error => {
      if (alive) setLoadError(error instanceof Error ? error.message : '页面加载失败');
    });
    return () => {
      alive = false;
    };
  }, [pageNumber, pdfDocument]);

  useEffect(() => {
    const node = stageRef.current;
    if (!node || minimized) return undefined;
    let frame = 0;
    const resize = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        setStageSize(current => {
          const next = { width: node.clientWidth, height: node.clientHeight };
          return current.width === next.width && current.height === next.height ? current : next;
        });
      });
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(node);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [minimized, open]);

  const displayRotation = displayRotations[pageNumber] || 0;
  const rotatedPageSize = displayRotation % 180 === 90 ? { width: pageSize.height, height: pageSize.width } : pageSize;
  const pageFitScale = useMemo(() => Math.max(0.1, Math.min(
    Math.max(100, stageSize.width - 76) / Math.max(1, rotatedPageSize.width),
    Math.max(100, stageSize.height - 76) / Math.max(1, rotatedPageSize.height),
  )), [rotatedPageSize.height, rotatedPageSize.width, stageSize.height, stageSize.width]);
  const widthFitScale = useMemo(() => Math.max(
    0.1,
    Math.max(100, stageSize.width - 76) / Math.max(1, rotatedPageSize.width),
  ), [rotatedPageSize.width, stageSize.width]);
  const displayScale = fitMode === 'page'
    ? pageFitScale
    : fitMode === 'width'
      ? widthFitScale
      : pageFitScale * zoom / 100;
  const displayWidth = Math.max(1, Math.round(pageSize.width * displayScale));
  const displayHeight = Math.max(1, Math.round(pageSize.height * displayScale));
  const svgHeight = SVG_WIDTH * pageSize.height / Math.max(1, pageSize.width);

  useEffect(() => {
    if (!pdfPage || !canvasRef.current || minimized) return undefined;
    let alive = true;
    const canvas = canvasRef.current;
    setRendering(true);
    renderTaskRef.current?.cancel();
    void (async () => {
      try {
        const density = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
        const renderScale = Math.min(4, Math.max(1, displayScale * density));
        const viewport = pdfPage.getViewport({ scale: renderScale });
        const offscreen = document.createElement('canvas');
        offscreen.width = Math.max(1, Math.round(viewport.width));
        offscreen.height = Math.max(1, Math.round(viewport.height));
        const context = offscreen.getContext('2d');
        if (!context) throw new Error('浏览器不支持 PDF 画布');
        const task = pdfPage.render({ canvasContext: context, viewport });
        renderTaskRef.current = task;
        await task.promise;
        if (!alive) return;
        canvas.width = offscreen.width;
        canvas.height = offscreen.height;
        canvas.style.width = `${displayWidth}px`;
        canvas.style.height = `${displayHeight}px`;
        const target = canvas.getContext('2d');
        if (!target) throw new Error('浏览器不支持 PDF 画布');
        target.clearRect(0, 0, canvas.width, canvas.height);
        target.drawImage(offscreen, 0, 0);
      } catch (error) {
        if (alive && !(error instanceof Error && error.name === 'RenderingCancelledException')) {
          setLoadError(error instanceof Error ? error.message : 'PDF 渲染失败');
        }
      } finally {
        if (alive) setRendering(false);
      }
    })();
    return () => {
      alive = false;
      renderTaskRef.current?.cancel();
    };
  }, [directionLoading, directionError, displayHeight, displayScale, displayWidth, minimized, pdfPage]);

  const pushHistory = useCallback((before: PdfOverlayAnnotation[]) => {
    if (annotationsSignature(before) === annotationsSignature(annotationsRef.current)) return;
    setUndoStack(stack => [...stack.slice(-(MAX_HISTORY - 1)), cloneAnnotations(before)]);
    setRedoStack([]);
    setSaveState('dirty');
  }, []);

  const commitAnnotations = useCallback((next: PdfOverlayAnnotation[]) => {
    const before = cloneAnnotations(annotationsRef.current);
    annotationsRef.current = next;
    setAnnotations(next);
    pushHistory(before);
  }, [pushHistory]);

  const updateAnnotation = useCallback((id: string, patch: Partial<PdfOverlayAnnotation>, record = true) => {
    const before = cloneAnnotations(annotationsRef.current);
    const next = annotationsRef.current.map(annotation => annotation.id === id
      ? { ...annotation, ...patch, updatedAt: nowIso() }
      : annotation);
    annotationsRef.current = next;
    setAnnotations(next);
    if (record) pushHistory(before);
    else setSaveState('dirty');
  }, [pushHistory]);

  const buildDocument = useCallback((): PdfOverlayDocument => ({
    schemaVersion: PDF_OVERLAY_SCHEMA_VERSION,
    sourceId,
    baseFileId,
    sourceFileName: fileName,
    pageCount,
    annotations: cloneAnnotations(annotationsRef.current),
    revision,
    updatedAt: nowIso(),
  }), [baseFileId, fileName, pageCount, revision, sourceId]);

  const applyPersistenceResult = useCallback((
    request: PdfOverlayDocument,
    result: PdfOverlayPersistenceResult,
  ): PdfOverlayDocument => {
    if (!result || typeof result !== 'object') {
      throw new Error('保存接口必须返回最新 revision。');
    }
    const nextRevision = Number(result.revision);
    if (!Number.isInteger(nextRevision) || nextRevision < 0) {
      throw new Error('保存结果缺少有效 revision，无法安全继续编辑。');
    }
    const updatedAt = result.updatedAt || nowIso();
    setRevision(nextRevision);
    return {
      ...request,
      revision: nextRevision,
      updatedAt,
      // Identity metadata always belongs to the source currently open in the
      // modal; a persistence response cannot silently retarget this draft.
      sourceId,
      baseFileId,
      sourceFileName: fileName,
      pageCount,
    };
  }, [baseFileId, fileName, pageCount, sourceId]);

  const save = useCallback(async (): Promise<PdfOverlayDocument | null> => {
    if (identityError) {
      setSaveState('error');
      setMessage(identityError);
      return null;
    }
    if (!onSave) {
      setMessage('当前未接入保存回调，批注仍保留在本次编辑会话中。');
      return null;
    }
    if (savePromiseRef.current) return savePromiseRef.current;
    const signature = annotationsSignature(annotationsRef.current);
    const run = (async () => {
      setSaveState('saving');
      setMessage('');
      try {
        const request = buildDocument();
        const result = await onSave(request);
        const savedDocument = applyPersistenceResult(request, result);
        setLastSavedAt(new Date());
        setSaveState(annotationsSignature(annotationsRef.current) === signature ? 'saved' : 'dirty');
        return savedDocument;
      } catch (error) {
        setSaveState('error');
        setMessage(error instanceof Error ? error.message : '保存失败，请稍后重试。');
        return null;
      } finally {
        savePromiseRef.current = null;
      }
    })();
    savePromiseRef.current = run;
    return run;
  }, [applyPersistenceResult, buildDocument, identityError, onSave]);

  useEffect(() => {
    if (!open || autoSaveDelayMs <= 0 || !onSave || saveState !== 'dirty') return undefined;
    const timer = window.setTimeout(() => void save(), autoSaveDelayMs);
    return () => window.clearTimeout(timer);
  }, [autoSaveDelayMs, onSave, open, save, saveState]);

  useEffect(() => {
    if (!open || saveState !== 'dirty') return undefined;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [open, saveState]);

  const publish = useCallback(async (controlMode: PdfOverlayControlMode) => {
    if (identityError) {
      setSaveState('error');
      setMessage(identityError);
      return;
    }
    if (!onPublish) {
      setMessage('当前未接入发布回调。');
      return;
    }
    setPublishPromptOpen(false);
    const savedDocument = saveState === 'dirty' && onSave ? await save() : null;
    if (saveState === 'dirty' && onSave && !savedDocument) return;
    setSaveState('saving');
    try {
      if (!pdfDocument) throw new Error('PDF 尚未加载完成，暂时不能发布。');
      const document = savedDocument
        ? { ...buildDocument(), revision: savedDocument.revision, updatedAt: savedDocument.updatedAt }
        : buildDocument();
      const pageSizes: Array<{ page: number; width: number; height: number }> = [];
      for (let page = 1; page <= pdfDocument.numPages; page += 1) {
        const sourcePage = await pdfDocument.getPage(page);
        const viewport = sourcePage.getViewport({ scale: 1 });
        pageSizes.push({ page, width: viewport.width, height: viewport.height });
      }
      const overlays = await exportPdfOverlayPngs(document, pageSizes);
      const result = await onPublish({ document, overlays, controlMode });
      applyPersistenceResult(document, result);
      setLastSavedAt(new Date());
      setSaveState('saved');
      setMessage(`当前批注版本已按${controlMode === 'controlled' ? '受控' : '未受控'}模式发布。`);
    } catch (error) {
      setSaveState('error');
      setMessage(error instanceof Error ? error.message : '发布失败，请稍后重试。');
    }
  }, [applyPersistenceResult, buildDocument, identityError, onPublish, onSave, pdfDocument, save, saveState]);

  const requestClose = useCallback(() => {
    if (saveState === 'dirty' && !window.confirm('当前有未保存修改，确定关闭编辑器吗？')) return;
    onClose();
  }, [onClose, saveState]);

  const undo = useCallback(() => {
    setUndoStack(stack => {
      const previous = stack[stack.length - 1];
      if (!previous) return stack;
      setRedoStack(current => [...current.slice(-(MAX_HISTORY - 1)), cloneAnnotations(annotationsRef.current)]);
      annotationsRef.current = cloneAnnotations(previous);
      setAnnotations(annotationsRef.current);
      setSelectedId(null);
      setSaveState('dirty');
      return stack.slice(0, -1);
    });
  }, []);

  const redo = useCallback(() => {
    setRedoStack(stack => {
      const next = stack[stack.length - 1];
      if (!next) return stack;
      setUndoStack(current => [...current.slice(-(MAX_HISTORY - 1)), cloneAnnotations(annotationsRef.current)]);
      annotationsRef.current = cloneAnnotations(next);
      setAnnotations(annotationsRef.current);
      setSelectedId(null);
      setSaveState('dirty');
      return stack.slice(0, -1);
    });
  }, []);

  const deleteSelected = useCallback(() => {
    if (!selectedId) return;
    const current = annotationsRef.current.find(annotation => annotation.id === selectedId);
    if (!current || current.locked) return;
    commitAnnotations(annotationsRef.current.filter(annotation => annotation.id !== selectedId));
    setSelectedId(null);
  }, [commitAnnotations, selectedId]);

  const beginPropertyEdit = useCallback(() => {
    if (!propertyEditBeforeRef.current) {
      propertyEditBeforeRef.current = cloneAnnotations(annotationsRef.current);
    }
  }, []);

  const finishPropertyEdit = useCallback(() => {
    const before = propertyEditBeforeRef.current;
    propertyEditBeforeRef.current = null;
    if (before) pushHistory(before);
  }, [pushHistory]);

  const replaceLiveAnnotation = useCallback((id: string, nextAnnotation: PdfOverlayAnnotation) => {
    const next = annotationsRef.current.map(annotation => annotation.id === id ? nextAnnotation : annotation);
    annotationsRef.current = next;
    setAnnotations(next);
    setSaveState('dirty');
  }, []);

  const toggleAnnotationHidden = useCallback((annotation: PdfOverlayAnnotation) => {
    updateAnnotation(annotation.id, { hidden: !annotation.hidden });
  }, [updateAnnotation]);

  const toggleAnnotationLocked = useCallback((annotation: PdfOverlayAnnotation) => {
    updateAnnotation(annotation.id, { locked: !annotation.locked });
  }, [updateAnnotation]);

  const moveLayer = useCallback((annotation: PdfOverlayAnnotation, direction: 'up' | 'down') => {
    const samePage = annotationsRef.current
      .filter(item => item.page === annotation.page)
      .sort((first, second) => first.zIndex - second.zIndex);
    const index = samePage.findIndex(item => item.id === annotation.id);
    const targetIndex = direction === 'up' ? index + 1 : index - 1;
    if (index < 0 || targetIndex < 0 || targetIndex >= samePage.length) return;
    const target = samePage[targetIndex];
    const before = cloneAnnotations(annotationsRef.current);
    const next = annotationsRef.current.map(item => {
      if (item.id === annotation.id) return { ...item, zIndex: target.zIndex, updatedAt: nowIso() };
      if (item.id === target.id) return { ...item, zIndex: annotation.zIndex, updatedAt: nowIso() };
      return item;
    });
    annotationsRef.current = next;
    setAnnotations(next);
    pushHistory(before);
  }, [pushHistory]);

  const cancelInteraction = useCallback(() => {
    const interaction = interactionRef.current;
    if (!interaction) return;
    annotationsRef.current = cloneAnnotations(interaction.before);
    setAnnotations(annotationsRef.current);
    interactionRef.current = null;
  }, []);

  const finishInteraction = useCallback(() => {
    const interaction = interactionRef.current;
    if (!interaction) return;
    let next = annotationsRef.current;
    if (interaction.mode === 'create') {
      next = next.map(annotation => {
        if (annotation.id !== interaction.annotationId) return annotation;
        if ((annotation.kind === 'rectangle' || annotation.kind === 'cover')
          && (annotation.width < 0.012 || annotation.height < 0.012)) {
          return {
            ...annotation,
            width: Math.min(0.2, 1 - annotation.x),
            height: Math.min(0.09, 1 - annotation.y),
            updatedAt: nowIso(),
          };
        }
        if (annotation.kind === 'arrow') {
          const endX = annotation.endX ?? annotation.x;
          const endY = annotation.endY ?? annotation.y;
          if (Math.hypot(endX - annotation.x, endY - annotation.y) < 0.015) {
            return {
              ...annotation,
              endX: clamp(annotation.x + 0.18),
              endY: clamp(annotation.y + 0.07),
              updatedAt: nowIso(),
            };
          }
        }
        if ((annotation.kind === 'pen' || annotation.kind === 'highlight') && (annotation.points?.length || 0) < 2) {
          return {
            ...annotation,
            points: [interaction.start, { x: clamp(interaction.start.x + 0.02), y: interaction.start.y }],
            width: 0.02,
            height: 0.012,
            updatedAt: nowIso(),
          };
        }
        return annotation;
      });
      annotationsRef.current = next;
      setAnnotations(next);
      setTool('select');
    }
    interactionRef.current = null;
    pushHistory(interaction.before);
  }, [pushHistory]);

  const handleStagePointerDown = useCallback((event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.button !== 0 || !overlayRef.current) return;
    const point = normalizedPagePoint(event, overlayRef.current);
    if (tool === 'select') {
      setSelectedId(null);
      return;
    }
    if (tool === 'image') {
      imageInsertPointRef.current = point;
      imageInputRef.current?.click();
      return;
    }
    const annotation = createAnnotation(tool, pageNumber, point, Math.max(0, ...annotationsRef.current.map(item => item.zIndex)) + 1);
    const before = cloneAnnotations(annotationsRef.current);
    const next = [...annotationsRef.current, annotation];
    annotationsRef.current = next;
    setAnnotations(next);
    setSelectedId(annotation.id);
    setSaveState('dirty');
    if (tool === 'text') {
      pushHistory(before);
      setTool('select');
      return;
    }
    interactionRef.current = {
      mode: 'create',
      pointerId: event.pointerId,
      annotationId: annotation.id,
      start: point,
      original: annotation,
      before,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }, [pageNumber, pushHistory, tool]);

  const handleAnnotationPointerDown = useCallback((
    event: ReactPointerEvent<SVGGElement>,
    annotation: PdfOverlayAnnotation,
  ) => {
    if (tool !== 'select' || event.button !== 0 || !overlayRef.current) return;
    event.stopPropagation();
    setSelectedId(annotation.id);
    if (annotation.locked) return;
    const point = normalizedPagePoint(event, overlayRef.current);
    interactionRef.current = {
      mode: 'move',
      pointerId: event.pointerId,
      annotationId: annotation.id,
      start: point,
      original: cloneAnnotations([annotation])[0],
      before: cloneAnnotations(annotationsRef.current),
    };
    overlayRef.current.setPointerCapture(event.pointerId);
  }, [tool]);

  const handleResizePointerDown = useCallback((
    event: ReactPointerEvent<SVGCircleElement>,
    annotation: PdfOverlayAnnotation,
    corner: ResizeCorner,
  ) => {
    if (!overlayRef.current || annotation.locked) return;
    event.stopPropagation();
    const point = normalizedPagePoint(event, overlayRef.current);
    interactionRef.current = {
      mode: 'resize',
      pointerId: event.pointerId,
      annotationId: annotation.id,
      start: point,
      original: cloneAnnotations([annotation])[0],
      before: cloneAnnotations(annotationsRef.current),
      corner,
    };
    overlayRef.current.setPointerCapture(event.pointerId);
  }, []);

  const handleStagePointerMove = useCallback((event: ReactPointerEvent<SVGSVGElement>) => {
    const interaction = interactionRef.current;
    if (!interaction || interaction.pointerId !== event.pointerId || !overlayRef.current) return;
    const point = normalizedPagePoint(event, overlayRef.current);
    const original = interaction.original;

    if (interaction.mode === 'create') {
      let nextAnnotation = annotationsRef.current.find(item => item.id === interaction.annotationId);
      if (!nextAnnotation) return;
      if (nextAnnotation.kind === 'rectangle' || nextAnnotation.kind === 'cover') {
        nextAnnotation = {
          ...nextAnnotation,
          x: Math.min(interaction.start.x, point.x),
          y: Math.min(interaction.start.y, point.y),
          width: Math.abs(point.x - interaction.start.x),
          height: Math.abs(point.y - interaction.start.y),
          updatedAt: nowIso(),
        };
      } else if (nextAnnotation.kind === 'arrow') {
        nextAnnotation = { ...nextAnnotation, endX: point.x, endY: point.y, updatedAt: nowIso() };
      } else if (nextAnnotation.kind === 'pen' || nextAnnotation.kind === 'highlight') {
        const points = nextAnnotation.points || [interaction.start];
        const last = points[points.length - 1];
        if (Math.hypot(last.x - point.x, last.y - point.y) < 0.0025) return;
        const nextPoints = [...points, point];
        const xs = nextPoints.map(item => item.x);
        const ys = nextPoints.map(item => item.y);
        nextAnnotation = {
          ...nextAnnotation,
          points: nextPoints,
          x: Math.min(...xs),
          y: Math.min(...ys),
          width: Math.max(...xs) - Math.min(...xs),
          height: Math.max(...ys) - Math.min(...ys),
          updatedAt: nowIso(),
        };
      }
      replaceLiveAnnotation(interaction.annotationId, nextAnnotation);
      return;
    }

    if (interaction.mode === 'move') {
      const dx = point.x - interaction.start.x;
      const dy = point.y - interaction.start.y;
      let nextAnnotation: PdfOverlayAnnotation;
      if ((original.kind === 'pen' || original.kind === 'highlight') && original.points) {
        const bounds = annotationBounds(original);
        const safeDx = clamp(original.x + dx, 0, 1 - bounds.width) - original.x;
        const safeDy = clamp(original.y + dy, 0, 1 - bounds.height) - original.y;
        nextAnnotation = {
          ...original,
          x: original.x + safeDx,
          y: original.y + safeDy,
          points: original.points.map(item => ({ x: item.x + safeDx, y: item.y + safeDy })),
          updatedAt: nowIso(),
        };
      } else if (original.kind === 'arrow') {
        const bounds = annotationBounds(original);
        const safeDx = clamp(bounds.x + dx, 0, 1 - bounds.width) - bounds.x;
        const safeDy = clamp(bounds.y + dy, 0, 1 - bounds.height) - bounds.y;
        nextAnnotation = {
          ...original,
          x: original.x + safeDx,
          y: original.y + safeDy,
          endX: (original.endX ?? original.x) + safeDx,
          endY: (original.endY ?? original.y) + safeDy,
          updatedAt: nowIso(),
        };
      } else {
        nextAnnotation = {
          ...original,
          x: clamp(original.x + dx, 0, 1 - original.width),
          y: clamp(original.y + dy, 0, 1 - original.height),
          updatedAt: nowIso(),
        };
      }
      replaceLiveAnnotation(interaction.annotationId, nextAnnotation);
      return;
    }

    const bounds = annotationBounds(original);
    let left = bounds.x;
    let top = bounds.y;
    let right = bounds.x + bounds.width;
    let bottom = bounds.y + bounds.height;
    if (interaction.corner?.includes('w')) left = Math.min(point.x, right - 0.02);
    if (interaction.corner?.includes('e')) right = Math.max(point.x, left + 0.02);
    if (interaction.corner?.includes('n')) top = Math.min(point.y, bottom - 0.02);
    if (interaction.corner?.includes('s')) bottom = Math.max(point.y, top + 0.02);
    left = clamp(left);
    top = clamp(top);
    right = clamp(right);
    bottom = clamp(bottom);
    replaceLiveAnnotation(interaction.annotationId, {
      ...original,
      x: left,
      y: top,
      width: Math.max(0.02, right - left),
      height: Math.max(0.02, bottom - top),
      updatedAt: nowIso(),
    });
  }, [replaceLiveAnnotation]);

  const handleImageChange = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setMessage('请选择 PNG、JPG、WEBP 等图片文件。');
      return;
    }
    if (file.size > MAX_INLINE_IMAGE_BYTES) {
      setMessage('图片不能超过 16 MB，请压缩后重试。');
      return;
    }
    setUploadingImage(true);
    setMessage('');
    try {
      const uploaded = onUploadImage
        ? await onUploadImage(file)
        : { url: await fileToDataUrl(file) };
      const point = imageInsertPointRef.current;
      const annotation = createAnnotation(
        'image',
        pageNumber,
        { x: clamp(point.x, 0, 0.7), y: clamp(point.y, 0, 0.78) },
        Math.max(0, ...annotationsRef.current.map(item => item.zIndex)) + 1,
      );
      annotation.imageSrc = uploaded.url;
      annotation.imageAssetId = uploaded.assetId;
      commitAnnotations([...annotationsRef.current, annotation]);
      setSelectedId(annotation.id);
      setTool('select');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '图片插入失败。');
    } finally {
      setUploadingImage(false);
    }
  }, [commitAnnotations, onUploadImage, pageNumber]);

  useEffect(() => {
    if (!open || minimized) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const editing = target?.matches('input, textarea, select, [contenteditable="true"]');
      const command = event.ctrlKey || event.metaKey;
      if (command && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void save();
        return;
      }
      if (editing) return;
      if (command && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo(); else undo();
      } else if (command && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        redo();
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        deleteSelected();
      } else if (event.key === 'Escape') {
        if (interactionRef.current) cancelInteraction();
        else if (selectedId) setSelectedId(null);
        else setTool('select');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [cancelInteraction, deleteSelected, minimized, open, redo, save, selectedId, undo]);

  const goToPage = useCallback((page: number) => {
    setPageNumber(clamp(Math.round(page), 1, Math.max(1, pageCount)));
    setSelectedId(null);
  }, [pageCount]);

  const adjustZoom = useCallback((delta: number) => {
    setFitMode('custom');
    setZoom(current => Math.round(clamp(current + delta, 30, 300)));
  }, []);

  const selectionBounds = selected ? annotationBounds(selected) : null;

  const renderAnnotation = (annotation: PdfOverlayAnnotation) => {
    if (annotation.hidden) return null;
    const x = annotation.x * SVG_WIDTH;
    const y = annotation.y * svgHeight;
    const width = annotation.width * SVG_WIDTH;
    const height = annotation.height * svgHeight;
    const common = {
      opacity: annotation.style.opacity,
      stroke: annotation.style.stroke,
      strokeWidth: annotation.style.strokeWidth,
    };
    let content: ReactNode;
    if (annotation.kind === 'rectangle' || annotation.kind === 'cover') {
      content = <rect x={x} y={y} width={width} height={height} fill={annotation.style.fill} {...common} />;
    } else if (annotation.kind === 'arrow') {
      content = (
        <line
          x1={x}
          y1={y}
          x2={(annotation.endX ?? annotation.x + annotation.width) * SVG_WIDTH}
          y2={(annotation.endY ?? annotation.y + annotation.height) * svgHeight}
          fill="none"
          markerEnd="url(#pdfOverlayArrowHead)"
          strokeLinecap="round"
          {...common}
        />
      );
    } else if (annotation.kind === 'pen' || annotation.kind === 'highlight') {
      content = (
        <polyline
          points={(annotation.points || []).map(point => `${point.x * SVG_WIDTH},${point.y * svgHeight}`).join(' ')}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
          {...common}
        />
      );
    } else if (annotation.kind === 'image') {
      content = annotation.imageSrc
        ? <image href={annotation.imageSrc} x={x} y={y} width={width} height={height} preserveAspectRatio="xMidYMid meet" opacity={annotation.style.opacity} />
        : null;
    } else if (annotation.kind === 'text') {
      content = (
        <foreignObject x={x} y={y} width={Math.max(36, width)} height={Math.max(28, height)} opacity={annotation.style.opacity}>
          {selectedId === annotation.id && !annotation.locked ? (
            <textarea
              className={styles.inlineTextEditor}
              value={annotation.text || ''}
              onPointerDown={event => event.stopPropagation()}
              onFocus={beginPropertyEdit}
              onBlur={finishPropertyEdit}
              onChange={event => updateAnnotation(annotation.id, { text: event.target.value }, false)}
              style={{ color: annotation.style.textColor, fontSize: `${annotation.style.fontSize}px` }}
              aria-label="批注文字"
            />
          ) : (
            <div
              className={styles.inlineText}
              style={{ color: annotation.style.textColor, fontSize: `${annotation.style.fontSize}px` }}
            >
              {annotation.text}
            </div>
          )}
        </foreignObject>
      );
    } else {
      content = null;
    }
    return (
      <g
        key={annotation.id}
        className={`${styles.annotation}${selectedId === annotation.id ? ` ${styles.annotationSelected}` : ''}`}
        onPointerDown={event => handleAnnotationPointerDown(event, annotation)}
      >
        {content}
      </g>
    );
  };

  if (!open) return null;

  if (minimized) {
    return (
      <aside className={styles.minimizedBar} aria-label="已最小化的 SOP 编辑器">
        <span className={styles.minimizedIcon}><FileText size={18} /></span>
        <span className={styles.minimizedCopy}>
          <strong>{title}</strong>
          <small>{fileName} · {statusLabel(saveState, lastSavedAt)}</small>
        </span>
        <button type="button" className={styles.restoreButton} onClick={() => setMinimized(false)}>恢复编辑</button>
        <button type="button" className={styles.iconButton} onClick={requestClose} aria-label="关闭"><X size={18} /></button>
      </aside>
    );
  }

  const tools: PdfOverlayTool[] = ['select', 'text', 'image', 'rectangle', 'arrow', 'pen', 'highlight', 'cover'];
  const editableSelection = selected && !selected.locked;

  return (
    <div className={styles.backdrop} role="presentation">
      <section className={styles.dialog} role="dialog" aria-modal="true" aria-label={title}>
        <header className={styles.header}>
          <span className={styles.brandMark}><Pencil size={20} /></span>
          <div className={styles.heading}>
            <span>SOP 在线修订</span>
            <strong>{title}</strong>
            <small>{fileName} · {versionLabel}</small>
          </div>
          <div className={styles.headerStatus} data-state={saveState}>
            <span />{statusLabel(saveState, lastSavedAt)}
          </div>
          <button type="button" className={styles.iconButton} onClick={() => setMinimized(true)} aria-label="最小化"><Minus size={19} /></button>
          <button type="button" className={styles.iconButton} onClick={requestClose} aria-label="关闭"><X size={20} /></button>
        </header>

        <div className={styles.commandBar}>
          <div className={styles.toolGroup} aria-label="批注工具">
            {tools.map(item => (
              <button
                key={item}
                type="button"
                className={`${styles.toolButton}${tool === item ? ` ${styles.toolButtonActive}` : ''}`}
                onClick={() => {
                  setTool(item);
                  if (item !== 'select') setSelectedId(null);
                  if (item === 'image') {
                    imageInsertPointRef.current = { x: 0.35, y: 0.22 };
                    imageInputRef.current?.click();
                  }
                }}
                title={item === 'cover' ? '用白色遮盖旧内容' : TOOL_LABELS[item]}
              >
                {toolIcon(item)}<span>{TOOL_LABELS[item]}</span>
              </button>
            ))}
          </div>
          <span className={styles.divider} />
          <button type="button" className={styles.compactButton} disabled={!undoStack.length} onClick={undo} title="撤销 Ctrl+Z"><Undo2 size={17} /></button>
          <button type="button" className={styles.compactButton} disabled={!redoStack.length} onClick={redo} title="重做 Ctrl+Y"><Redo2 size={17} /></button>
          <span className={styles.divider} />
          <button type="button" className={styles.compactButton} onClick={() => adjustZoom(-10)} title="缩小"><ZoomOut size={17} /></button>
          <strong className={styles.zoomValue}>{Math.round(displayScale / pageFitScale * 100)}%</strong>
          <button type="button" className={styles.compactButton} onClick={() => adjustZoom(10)} title="放大"><ZoomIn size={17} /></button>
          <label className={styles.fitSelect}>
            <select
              value={fitMode}
              onChange={event => setFitMode(event.target.value as 'page' | 'width' | 'custom')}
              aria-label="缩放方式"
            >
              <option value="page">适合页面</option>
              <option value="width">适合宽度</option>
              <option value="custom">自定义</option>
            </select>
            <ChevronDown size={15} />
          </label>
          <button
            type="button"
            className={`${styles.compareButton}${showOriginal ? ` ${styles.compareActive}` : ''}`}
            onClick={() => setShowOriginal(value => !value)}
          >
            {showOriginal ? <EyeOff size={17} /> : <Eye size={17} />}
            {showOriginal ? '返回修订稿' : '原稿对比'}
          </button>
          <span className={styles.commandSpacer} />
          <button type="button" className={styles.secondaryAction} onClick={() => void save()} disabled={!onSave || saveState === 'saving' || Boolean(identityError)}><Save size={17} />保存草稿</button>
          <button type="button" className={styles.primaryAction} onClick={() => setPublishPromptOpen(true)} disabled={!onPublish || saveState === 'saving' || Boolean(identityError)}><Send size={17} />发布新版本</button>
        </div>

        <div className={styles.editorBody}>
          <aside className={styles.pageRail}>
            <div className={styles.railHeading}>
              <span>页面</span><strong>{pageCount || '--'}</strong>
            </div>
            <div className={styles.pageJump}>
              <button type="button" onClick={() => goToPage(pageNumber - 1)} disabled={pageNumber <= 1}><ChevronLeft size={16} /></button>
              <label><input value={pageNumber} onChange={event => goToPage(Number(event.target.value))} aria-label="当前页码" /> / {pageCount || 1}</label>
              <button type="button" onClick={() => goToPage(pageNumber + 1)} disabled={pageNumber >= pageCount}><ChevronRight size={16} /></button>
            </div>
            <div className={styles.thumbnailList}>
              {pdfDocument && thumbnailPages.map((page, index) => (
                <div key={page} className={styles.thumbnailSlot}>
                  {index > 0 && page - thumbnailPages[index - 1] > 1 ? <span className={styles.pageEllipsis}>···</span> : null}
                  <PdfPageThumbnail
                    document={pdfDocument}
                    page={page}
                    rotation={displayRotations[page] || 0}
                    active={page === pageNumber}
                    changeCount={annotations.filter(item => item.page === page && !item.hidden).length}
                    onSelect={() => goToPage(page)}
                  />
                </div>
              ))}
            </div>
          </aside>

          <main className={styles.workspace}>
            <div className={styles.workspaceHeader}>
              <div>
                <span>当前编辑</span>
                <strong>第 {pageNumber} 页</strong>
                <small>{pageAnnotations.filter(item => !item.hidden).length} 处批注</small>
              </div>
              <p><MousePointer2 size={15} />拖动选择对象；拖动空白区创建标注。发布只叠加透明批注层，不改变原始 PDF。</p>
            </div>
            <div ref={stageRef} className={styles.stage} data-tool={tool}>
              {identityError ? <div className={styles.stageError}><FileText size={28} /><strong>草稿身份校验失败</strong><span>{identityError}</span></div> : null}
              {loading || directionLoading ? <div className={styles.stageState}><span className={styles.spinner} />正在加载原始 PDF 与阅读方向…</div> : null}
              {directionError ? <div className={styles.stageError} role="alert">{directionError}</div> : null}
              {loadError ? <div className={styles.stageError}><FileText size={28} /><strong>PDF 无法加载</strong><span>{loadError}</span></div> : null}
              {!identityError && !loading && !directionLoading && !directionError && !loadError && pdfPage ? (
                <div style={{ position: 'relative', flexShrink: 0, width: rotatedPageSize.width * displayScale, height: rotatedPageSize.height * displayScale }}>
                <div className={styles.pageSurface} style={{ position: 'absolute', left: '50%', top: '50%', width: displayWidth, height: displayHeight, transform: `translate(-50%, -50%) rotate(${displayRotation}deg)` }}>
                  <canvas ref={canvasRef} className={styles.pdfCanvas} />
                  {rendering ? <span className={styles.renderBadge}>渲染中</span> : null}
                  <svg
                    ref={overlayRef}
                    className={`${styles.overlay}${showOriginal ? ` ${styles.overlayHidden}` : ''}`}
                    viewBox={`0 0 ${SVG_WIDTH} ${svgHeight}`}
                    preserveAspectRatio="none"
                    onPointerDown={handleStagePointerDown}
                    onPointerMove={handleStagePointerMove}
                    onPointerUp={finishInteraction}
                    onPointerCancel={cancelInteraction}
                    aria-label="PDF 批注图层"
                  >
                    <defs>
                      <marker id="pdfOverlayArrowHead" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="strokeWidth">
                        <path d="M 0 0 L 8 4 L 0 8 z" fill="#ff6a00" />
                      </marker>
                    </defs>
                    {pageAnnotations.map(renderAnnotation)}
                    {selected && selectionBounds && selected.page === pageNumber && !selected.hidden ? (
                      <g className={styles.selectionBox}>
                        <rect
                          x={selectionBounds.x * SVG_WIDTH}
                          y={selectionBounds.y * svgHeight}
                          width={selectionBounds.width * SVG_WIDTH}
                          height={selectionBounds.height * svgHeight}
                        />
                        {!selected.locked && !['arrow', 'pen', 'highlight'].includes(selected.kind)
                          ? (['nw', 'ne', 'sw', 'se'] as ResizeCorner[]).map(corner => {
                            const cx = (corner.includes('w') ? selectionBounds.x : selectionBounds.x + selectionBounds.width) * SVG_WIDTH;
                            const cy = (corner.includes('n') ? selectionBounds.y : selectionBounds.y + selectionBounds.height) * svgHeight;
                            return <circle key={corner} cx={cx} cy={cy} r={7} onPointerDown={event => handleResizePointerDown(event, selected, corner)} />;
                          })
                          : null}
                      </g>
                    ) : null}
                  </svg>
                  {showOriginal ? <span className={styles.originalBadge}><Eye size={14} />原稿</span> : null}
                </div>
                </div>
              ) : null}
            </div>
          </main>

          <aside className={styles.inspector}>
            <div className={styles.inspectorTabs}>
              <button type="button" className={rightTab === 'properties' ? styles.inspectorTabActive : ''} onClick={() => setRightTab('properties')}>属性</button>
              <button type="button" className={rightTab === 'layers' ? styles.inspectorTabActive : ''} onClick={() => setRightTab('layers')}><Layers3 size={15} />图层</button>
            </div>
            {rightTab === 'properties' ? (
              <div className={styles.inspectorContent}>
                {selected ? (
                  <>
                    <div className={styles.selectionSummary}>
                      <span>{ANNOTATION_LABELS[selected.kind]}</span>
                      <strong>第 {selected.page} 页 · 图层 {selected.zIndex}</strong>
                      <div>
                        <button type="button" onClick={() => toggleAnnotationLocked(selected)}>{selected.locked ? <Unlock size={15} /> : <Lock size={15} />}{selected.locked ? '解锁' : '锁定'}</button>
                        <button type="button" onClick={() => toggleAnnotationHidden(selected)}>{selected.hidden ? <Eye size={15} /> : <EyeOff size={15} />}{selected.hidden ? '显示' : '隐藏'}</button>
                      </div>
                    </div>
                    {selected.kind === 'text' ? (
                      <label className={styles.fieldBlock}>
                        <span>文字内容</span>
                        <textarea
                          value={selected.text || ''}
                          disabled={!editableSelection}
                          onFocus={beginPropertyEdit}
                          onBlur={finishPropertyEdit}
                          onChange={event => updateAnnotation(selected.id, { text: event.target.value }, false)}
                        />
                      </label>
                    ) : null}
                    <div className={styles.propertyGrid}>
                      {selected.kind !== 'image' ? (
                        <label><span>{selected.kind === 'text' ? '文字颜色' : '线条颜色'}</span><input type="color" disabled={!editableSelection} value={selected.kind === 'text' ? selected.style.textColor : selected.style.stroke} onFocus={beginPropertyEdit} onBlur={finishPropertyEdit} onChange={event => updateAnnotation(selected.id, { style: { ...selected.style, ...(selected.kind === 'text' ? { textColor: event.target.value } : { stroke: event.target.value }) } }, false)} /></label>
                      ) : null}
                      {selected.kind === 'rectangle' || selected.kind === 'cover' ? (
                        <label><span>填充颜色</span><input type="color" disabled={!editableSelection} value={selected.style.fill === 'transparent' ? '#ffffff' : selected.style.fill} onFocus={beginPropertyEdit} onBlur={finishPropertyEdit} onChange={event => updateAnnotation(selected.id, { style: { ...selected.style, fill: event.target.value } }, false)} /></label>
                      ) : null}
                      {selected.kind === 'text' ? (
                        <label><span>字号</span><input type="number" min="12" max="96" disabled={!editableSelection} value={selected.style.fontSize} onFocus={beginPropertyEdit} onBlur={finishPropertyEdit} onChange={event => updateAnnotation(selected.id, { style: { ...selected.style, fontSize: Number(event.target.value) || 12 } }, false)} /></label>
                      ) : null}
                      {!['image', 'text'].includes(selected.kind) ? (
                        <label><span>线宽</span><input type="number" min="1" max="48" disabled={!editableSelection} value={selected.style.strokeWidth} onFocus={beginPropertyEdit} onBlur={finishPropertyEdit} onChange={event => updateAnnotation(selected.id, { style: { ...selected.style, strokeWidth: Number(event.target.value) || 1 } }, false)} /></label>
                      ) : null}
                    </div>
                    <label className={styles.rangeField}>
                      <span>透明度 <strong>{Math.round(selected.style.opacity * 100)}%</strong></span>
                      <input type="range" min="10" max="100" disabled={!editableSelection} value={Math.round(selected.style.opacity * 100)} onPointerDown={beginPropertyEdit} onPointerUp={finishPropertyEdit} onChange={event => updateAnnotation(selected.id, { style: { ...selected.style, opacity: Number(event.target.value) / 100 } }, false)} />
                    </label>
                    <div className={styles.layerActions}>
                      <button type="button" disabled={!editableSelection} onClick={() => moveLayer(selected, 'up')}><ChevronsUp size={16} />上移</button>
                      <button type="button" disabled={!editableSelection} onClick={() => moveLayer(selected, 'down')}><ChevronsDown size={16} />下移</button>
                      <button type="button" className={styles.dangerButton} disabled={!editableSelection} onClick={deleteSelected}><Trash2 size={16} />删除</button>
                    </div>
                  </>
                ) : (
                  <div className={styles.emptyInspector}><MousePointer2 size={25} /><strong>选择一个批注</strong><span>可调整颜色、透明度、层级与锁定状态。</span></div>
                )}
              </div>
            ) : (
              <div className={styles.layerList}>
                <div className={styles.baseLayer}><FileText size={17} /><span><strong>原始 PDF</strong><small>底稿只读，不会被栅格化</small></span><Lock size={14} /></div>
                {[...pageAnnotations].reverse().map(annotation => (
                  <button
                    key={annotation.id}
                    type="button"
                    className={`${styles.layerRow}${selectedId === annotation.id ? ` ${styles.layerRowActive}` : ''}`}
                    onClick={() => setSelectedId(annotation.id)}
                  >
                    <span className={styles.layerKind}>{toolIcon(annotation.kind)}</span>
                    <span><strong>{ANNOTATION_LABELS[annotation.kind]}</strong><small>图层 {annotation.zIndex}</small></span>
                    <i onClick={event => { event.stopPropagation(); toggleAnnotationHidden(annotation); }}>{annotation.hidden ? <EyeOff size={14} /> : <Eye size={14} />}</i>
                    <i onClick={event => { event.stopPropagation(); toggleAnnotationLocked(annotation); }}>{annotation.locked ? <Lock size={14} /> : <Unlock size={14} />}</i>
                  </button>
                ))}
                {!pageAnnotations.length ? <div className={styles.emptyLayers}>本页尚无批注</div> : null}
              </div>
            )}
          </aside>
        </div>

        <footer className={styles.footer}>
          <span className={styles.statusDot} data-state={saveState} />
          <strong>{message || (showOriginal ? '正在查看原稿，批注层已临时隐藏。' : '修改以独立图层保存；发布后由业务层生成新的 PDF 版本。')}</strong>
          <span className={styles.footerSpacer} />
          <span>快捷键：Ctrl+S 保存 · Ctrl+Z 撤销 · Delete 删除</span>
        </footer>
      </section>
      <input ref={imageInputRef} className={styles.hiddenInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={handleImageChange} />
      {uploadingImage ? <div className={styles.uploadToast}><span className={styles.spinner} />正在插入图片…</div> : null}
      {publishPromptOpen ? (
        <div className={styles.publishBackdrop} role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setPublishPromptOpen(false); }}>
          <section className={styles.publishDialog} role="dialog" aria-modal="true" aria-labelledby="pdf-overlay-publish-title">
            <header>
              <span><ShieldCheck size={22} /></span>
              <div><small>SOP 版本发布</small><h3 id="pdf-overlay-publish-title">选择文件受控状态</h3></div>
              <button type="button" className={styles.iconButton} onClick={() => setPublishPromptOpen(false)} aria-label="关闭发布窗口"><X size={19} /></button>
            </header>
            <p>该状态会永久记录在本次发布的 PDF 版本上，并在资料预览和文件列表中展示。</p>
            <div className={styles.controlModeGrid} role="radiogroup" aria-label="文件受控状态">
              <button type="button" role="radio" aria-checked={publishControlMode === 'controlled'} className={publishControlMode === 'controlled' ? styles.controlModeActive : ''} onClick={() => setPublishControlMode('controlled')}>
                <span><ShieldCheck size={22} /></span><strong>受控</strong><small>已审核并纳入正式生产资料，现场应优先使用此版本。</small><i>{publishControlMode === 'controlled' ? <Check size={16} /> : null}</i>
              </button>
              <button type="button" role="radio" aria-checked={publishControlMode === 'uncontrolled'} className={publishControlMode === 'uncontrolled' ? styles.controlModeActive : ''} onClick={() => setPublishControlMode('uncontrolled')}>
                <span><ShieldOff size={22} /></span><strong>未受控</strong><small>用于验证、讨论或临时参考，不能替代正式受控版本。</small><i>{publishControlMode === 'uncontrolled' ? <Check size={16} /> : null}</i>
              </button>
            </div>
            <footer>
              <button type="button" className={styles.secondaryAction} onClick={() => setPublishPromptOpen(false)}>取消</button>
              <button type="button" className={styles.primaryAction} onClick={() => void publish(publishControlMode)} disabled={saveState === 'saving'}><Send size={17} />确认发布</button>
            </footer>
          </section>
        </div>
      ) : null}
    </div>
  );
}
