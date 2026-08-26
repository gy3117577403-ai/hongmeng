'use client';

/* eslint-disable @next/next/no-img-element */

import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ExternalLink,
  FileCheck2,
  FileImage,
  Files,
  FileText,
  LoaderCircle,
  Printer,
  ShieldAlert,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import QRCode from 'qrcode';
import { useEffect, useMemo, useRef, useState } from 'react';
import { calculateStandardHourlyCapacity } from '@/lib/process-capacity';
import { workOrderPrintReturnLabel } from '@/lib/work-order-print-navigation';
import type { WorkOrderTravelerPrintRecord } from '@/lib/work-order-qr-service';
import {
  AUTO_FIRST_PAGE_STEP_CAPACITY,
  createTravelerPageManifest,
  MAX_CUSTOM_TRAVELER_PAGES,
  paginateTravelerSteps,
  type TravelerLayoutMode,
  type TravelerLayoutSelection,
  type TravelerPageChunk,
} from '@/lib/work-order-traveler-layout';

type PrintTarget = 'all' | 'traveler' | 'warning' | 'traveler_warning' | 'sop';
type PrintMaterial = 'TRAVELER' | 'QUALITY_WARNING' | 'SOP' | 'DRAWING';
type PacketState = {
  status: 'loading' | 'ready' | 'error';
  url?: string;
  pageCount?: number;
  message?: string;
};

type TravelerStep = WorkOrderTravelerPrintRecord['snapshot']['steps'][number];
type TravelerPage = TravelerPageChunk<TravelerStep>;
type QualityWarning = WorkOrderTravelerPrintRecord['snapshot']['qualityWarnings'][number];

function warningLines(value?: string | null): string[] {
  return String(value || '').split(/\r?\n|[；;]/).map(item => item.replace(/^\s*[\d一二三四五六七八九十]+[.、)）]\s*/, '').trim()).filter(Boolean).slice(0, 6);
}

const TRAVELER_LAYOUT_OPTIONS: Array<{
  value: TravelerLayoutMode;
  label: string;
  description: string;
}> = [
  { value: 'auto', label: '自动分页', description: '按工序数自动保持清晰度' },
  { value: 'single', label: '强制 1 页', description: '全部工序缩放到一张纸' },
  { value: 'double', label: '固定 2 页', description: '均衡拆成两张流转单' },
  { value: 'custom', label: '自定义多页', description: '指定流转单打印页数' },
];

function dateTimeText(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('zh-CN', {
        timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: false,
      }).format(date);
}

function deliveryText(value: string | null): string {
  if (!value) return '待维护';
  const date = new Date(`${value.replace(/\//g, '-')}T00:00:00+08:00`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', year: 'numeric',
  }).format(date);
}

function standardTimeText(milliseconds: number | null, timeBasis: string | null, units: number): string {
  if (!milliseconds || milliseconds <= 0) return '待维护';
  const seconds = milliseconds / 1000;
  const value = Number.isInteger(seconds) ? String(seconds) : seconds.toFixed(1);
  return timeBasis === 'per_batch' ? `${value} 秒/批` : `${value} 秒 × ${Math.max(1, units)}`;
}

function hourlyCapacityText(input: {
  timeBasis: string | null;
  standardMillisecondsPerUnit: number | null;
  unitsPerProduct: number;
  unitLabel: string;
}): string {
  const capacity = calculateStandardHourlyCapacity(input);
  if (capacity.kind === 'per_batch') return '按批计时';
  if (capacity.kind === 'missing') return '待维护';
  return `${capacity.quantityPerHour.toLocaleString('zh-CN', { maximumFractionDigits: 1 })} ${input.unitLabel}/小时`;
}

function modeText(mode: WorkOrderTravelerPrintRecord['mode']): string {
  if (mode === 'TRAVELER_QUALITY_WARNING') return '流转单 + 异常警示附页';
  if (mode === 'TRAVELER_SOP_DUPLEX') return '流转单 + SOP 双面';
  if (mode === 'TRAVELER_SOP_SEPARATE') return '流转单与 SOP 分开';
  if (mode === 'DRAWING_SOP_TRAVELER_SEPARATE') return '原图、SOP、流转单分开';
  if (mode === 'DRAWING_SEPARATE_TRAVELER_SOP_DUPLEX') return '原图单独 + 流转单/SOP 双面';
  if (mode === 'CUSTOM') return '自定义补打';
  return '仅流转单';
}

function materialText(material: PrintMaterial): string {
  if (material === 'TRAVELER') return '二维码流转单';
  if (material === 'QUALITY_WARNING') return '异常警示附页';
  if (material === 'SOP') return 'SOP';
  return '原图';
}

function targetText(target: PrintTarget): string {
  if (target === 'all') return '流转单 + SOP 双面打印包';
  if (target === 'traveler') return '二维码流转单';
  if (target === 'warning') return '异常警示附页';
  if (target === 'traveler_warning') return '流转单 + 异常警示打印包';
  return 'SOP 打印包';
}

function sourceFormatText(item: WorkOrderTravelerPrintRecord['items'][number]): string {
  const name = String(item.fileName || '').toLowerCase();
  const mime = String(item.mimeType || '').toLowerCase();
  if (mime === 'application/pdf' || name.endsWith('.pdf')) return 'PDF';
  if (mime === 'image/jpeg' || name.endsWith('.jpg') || name.endsWith('.jpeg')) return 'JPEG图片';
  if (mime === 'image/png' || name.endsWith('.png')) return 'PNG图片';
  if (mime === 'image/webp' || name.endsWith('.webp')) return 'WebP图片';
  return '可打印文件';
}

function drawingPrintRule(record: WorkOrderTravelerPrintRecord, item: WorkOrderTravelerPrintRecord['items'][number]) {
  const format = sourceFormatText(item);
  if (format === 'PDF') return '保留源页面尺寸和方向';
  const paperSize = record.snapshot.printRendering?.drawingImagePaperSize === 'A3' ? 'A3' : 'A4';
  return `${paperSize}纸张 · 自动横竖 · 完整适配`;
}

function targetMaterials(target: PrintTarget): PrintMaterial[] {
  if (target === 'all') return ['TRAVELER', 'SOP'];
  if (target === 'traveler_warning') return ['TRAVELER', 'QUALITY_WARNING'];
  if (target === 'warning') return ['QUALITY_WARNING'];
  return [target === 'traveler' ? 'TRAVELER' : 'SOP'];
}

function itemKey(printId: string, material: PrintMaterial) {
  return `${printId}:${material}`;
}

function travelerPageKey(printId: string, pageNumber: number) {
  return `${printId}:${pageNumber}`;
}

function warningPageKey(printId: string, pageNumber: number) {
  return `${printId}:warning:${pageNumber}`;
}

function printItem(record: WorkOrderTravelerPrintRecord, material: PrintMaterial) {
  return record.items.find(item => item.material === material) || null;
}

function canvasPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob) resolve(blob);
      else reject(new Error('二维码流转单页面生成失败'));
    }, 'image/png');
  });
}

export default function WorkOrderTravelerPrint({
  records,
  returnTo,
}: {
  records: WorkOrderTravelerPrintRecord[];
  returnTo: string;
}) {
  const [qrImages, setQrImages] = useState<Record<string, string>>({});
  const [warningQrImages, setWarningQrImages] = useState<Record<string, string>>({});
  const [loadError, setLoadError] = useState('');
  const [packetStates, setPacketStates] = useState<Partial<Record<PrintTarget, PacketState>>>({});
  const [activeTarget, setActiveTarget] = useState<PrintTarget>('all');
  const [openedTargets, setOpenedTargets] = useState<Set<PrintTarget>>(() => new Set());
  const [openedDrawings, setOpenedDrawings] = useState<Set<string>>(() => new Set());
  const [openedSops, setOpenedSops] = useState<Set<string>>(() => new Set());
  const [confirmRequest, setConfirmRequest] = useState<{ printIds: string[]; materials: PrintMaterial[] } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState('');
  const [layoutMode, setLayoutMode] = useState<TravelerLayoutMode>('auto');
  const [customPageCount, setCustomPageCount] = useState(3);
  const travelerRefs = useRef<Record<string, HTMLElement | null>>({});
  const warningRefs = useRef<Record<string, HTMLElement | null>>({});
  const [confirmedItems, setConfirmedItems] = useState(() => new Set(records.flatMap(record => record.items
    .filter(item => item.status === 'CONFIRMED')
    .map(item => itemKey(record.printId, item.material)))));

  const originKey = useMemo(() => records.map(record => `${record.printId}:${record.mode}:${record.items.map(item => `${item.material}:${item.fileVersion || ''}:${item.copies}`).join(',')}`).join('|'), [records]);
  const includesTraveler = records.some(record => Boolean(printItem(record, 'TRAVELER')));
  const includesSop = records.some(record => Boolean(printItem(record, 'SOP')));
  const includesDrawing = records.some(record => Boolean(printItem(record, 'DRAWING')));
  const includesWarning = records.some(record => Boolean(printItem(record, 'QUALITY_WARNING')));
  const duplexTravelerSop = records.every(record => record.mode === 'TRAVELER_SOP_DUPLEX' || record.mode === 'DRAWING_SEPARATE_TRAVELER_SOP_DUPLEX');
  const qrReady = records.every(record => (!printItem(record, 'TRAVELER') || Boolean(qrImages[record.printId]))
    && (!printItem(record, 'QUALITY_WARNING') || record.snapshot.qualityWarnings.every(warning => Boolean(warningQrImages[warning.alertId]))));
  const allConfirmed = records.every(record => record.items.every(item => confirmedItems.has(itemKey(record.printId, item.material))));
  const combinedTravelerWarning = !duplexTravelerSop && includesTraveler && includesWarning;
  const separateTargets = useMemo<PrintTarget[]>(() => (combinedTravelerWarning
    ? ['traveler_warning']
    : [
        ...(includesTraveler ? ['traveler' as const] : []),
        ...(includesWarning ? ['warning' as const] : []),
        ...(includesSop ? ['sop' as const] : []),
      ]), [combinedTravelerWarning, includesSop, includesTraveler, includesWarning]);
  const travelerLayoutSelection = useMemo<TravelerLayoutSelection>(() => ({
    mode: layoutMode,
    customPageCount,
  }), [customPageCount, layoutMode]);
  const travelerPagesByPrintId = useMemo(() => new Map(records.map(record => [
    record.printId,
    paginateTravelerSteps(record.snapshot.steps, travelerLayoutSelection),
  ])), [records, travelerLayoutSelection]);
  const travelerPlanKey = useMemo(() => records.map(record => {
    const pages = travelerPagesByPrintId.get(record.printId) || [];
    return `${record.printId}:${record.snapshot.steps.length}:${pages.length}:${pages.map(page => `${page.startIndex}-${page.endIndexExclusive}`).join(',')}`;
  }).join('|'), [records, travelerPagesByPrintId]);
  const travelerRecords = records.filter(record => Boolean(printItem(record, 'TRAVELER')));
  const totalTravelerPages = travelerRecords.reduce(
    (sum, record) => sum + (travelerPagesByPrintId.get(record.printId)?.length || 0),
    0,
  );
  const totalTravelerSteps = travelerRecords.reduce((sum, record) => sum + record.snapshot.steps.length, 0);
  const maxTravelerSteps = Math.max(0, ...travelerRecords.map(record => record.snapshot.steps.length));
  const singlePageReadabilityWarning = layoutMode === 'single'
    && maxTravelerSteps > AUTO_FIRST_PAGE_STEP_CAPACITY;

  useEffect(() => {
    let cancelled = false;
    setLoadError('');
    setQrImages({});
    setWarningQrImages({});
    const travelerRecords = records.filter(record => printItem(record, 'TRAVELER'));
    const travelerPromise = Promise.all(travelerRecords.map(async record => {
      const link = `${window.location.origin}/field-report/${encodeURIComponent(record.publicCode)}`;
      const dataUrl = await QRCode.toDataURL(link, {
        errorCorrectionLevel: 'M', margin: 1, width: 520,
        color: { dark: '#111827', light: '#ffffff' },
      });
      return [record.printId, dataUrl] as const;
    })).then(entries => {
      if (!cancelled) setQrImages(Object.fromEntries(entries));
    });
    const warningPromise = Promise.all(records.flatMap(record => record.snapshot.qualityWarnings.map(async warning => {
      const link = `${window.location.origin}/workspace/quality/internal-risks?reportId=${encodeURIComponent(warning.reportId)}`;
      const dataUrl = await QRCode.toDataURL(link, { errorCorrectionLevel: 'M', margin: 1, width: 420, color: { dark: '#111827', light: '#ffffff' } });
      return [warning.alertId, dataUrl] as const;
    }))).then(entries => {
      if (!cancelled) setWarningQrImages(Object.fromEntries(entries));
    });
    void Promise.all([travelerPromise, warningPromise]).catch(reason => {
      if (!cancelled) setLoadError(reason instanceof Error ? reason.message : '二维码生成失败');
    });
    return () => { cancelled = true; };
  }, [originKey, records]);

  useEffect(() => {
    if (loadError || ((includesTraveler || includesWarning) && !qrReady) || (!includesTraveler && !includesSop && !includesWarning)) return;
    let cancelled = false;
    const controller = new AbortController();
    const objectUrls: string[] = [];
    const capturedTravelers = new Map<string, Blob[]>();
    const capturedWarnings = new Map<string, Blob[]>();
    setPacketStates({});
    setActiveTarget(duplexTravelerSop && includesTraveler && includesSop ? 'all' : (separateTargets[0] || 'traveler'));

    async function captureTravelerPages() {
      if (capturedTravelers.size) return;
      if ('fonts' in document) await document.fonts.ready;
      await new Promise<void>(resolve => window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve())));
      const html2canvas = (await import('html2canvas')).default;
      for (const record of records) {
        if (!printItem(record, 'TRAVELER')) continue;
        const pages = travelerPagesByPrintId.get(record.printId) || [];
        if (!pages.length) throw new Error('二维码流转单没有可打印工序，请检查工艺路线');
        const pageBlobs: Blob[] = [];
        for (const page of pages) {
          const source = travelerRefs.current[travelerPageKey(record.printId, page.pageNumber)];
          if (!source) throw new Error(`二维码流转单第 ${page.pageNumber} 页尚未就绪，请刷新后重试`);
          const images = [...source.querySelectorAll('img')];
          await Promise.all(images.map(image => image.complete ? image.decode().catch(() => undefined) : new Promise<void>(resolve => {
            image.addEventListener('load', () => resolve(), { once: true });
            image.addEventListener('error', () => resolve(), { once: true });
          })));
          if (cancelled) return;
          const canvas = await html2canvas(source, {
            scale: 2,
            backgroundColor: '#ffffff',
            logging: false,
            useCORS: true,
            width: source.scrollWidth,
            height: source.scrollHeight,
            windowWidth: source.scrollWidth,
            windowHeight: source.scrollHeight,
          });
          pageBlobs.push(await canvasPng(canvas));
          canvas.width = 1;
          canvas.height = 1;
        }
        capturedTravelers.set(record.printId, pageBlobs);
      }
    }

    async function captureWarningPages() {
      if (capturedWarnings.size) return;
      if ('fonts' in document) await document.fonts.ready;
      await new Promise<void>(resolve => window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve())));
      const html2canvas = (await import('html2canvas')).default;
      for (const record of records) {
        if (!printItem(record, 'QUALITY_WARNING')) continue;
        const pageBlobs: Blob[] = [];
        for (let index = 0; index < record.snapshot.qualityWarnings.length; index += 1) {
          const source = warningRefs.current[warningPageKey(record.printId, index + 1)];
          if (!source) throw new Error(`异常警示第 ${index + 1} 页尚未就绪，请刷新后重试`);
          const images = [...source.querySelectorAll('img')];
          await Promise.all(images.map(image => image.complete ? image.decode().catch(() => undefined) : new Promise<void>(resolve => {
            image.addEventListener('load', () => resolve(), { once: true });
            image.addEventListener('error', () => resolve(), { once: true });
          })));
          const canvas = await html2canvas(source, { scale: 2.5, backgroundColor: '#ffffff', logging: false, useCORS: true, width: source.scrollWidth, height: source.scrollHeight, windowWidth: source.scrollWidth, windowHeight: source.scrollHeight });
          pageBlobs.push(await canvasPng(canvas));
          canvas.width = 1;
          canvas.height = 1;
        }
        capturedWarnings.set(record.printId, pageBlobs);
      }
    }

    async function buildPacket(target: PrintTarget): Promise<boolean> {
      if (cancelled) return false;
      setPacketStates(previous => ({ ...previous, [target]: { status: 'loading' } }));
      try {
        if (target === 'all' || target === 'traveler' || target === 'traveler_warning') await captureTravelerPages();
        if (target === 'warning' || target === 'traveler_warning') await captureWarningPages();
        const form = new FormData();
        form.set('printIds', records.map(record => record.printId).join(','));
        form.set('target', target);
        if (target === 'all' || target === 'traveler' || target === 'traveler_warning') {
          for (const record of records) {
            if (!printItem(record, 'TRAVELER')) continue;
            const pages = travelerPagesByPrintId.get(record.printId) || [];
            const pageBlobs = capturedTravelers.get(record.printId) || [];
            if (pages.length !== pageBlobs.length) {
              throw new Error(`二维码流转单生成不完整：应有 ${pages.length} 页，当前为 ${pageBlobs.length} 页`);
            }
            form.set(
              `travelerManifest:${record.printId}`,
              JSON.stringify(createTravelerPageManifest(
                record.snapshot.steps.length,
                pages,
                travelerLayoutSelection,
              )),
            );
            pageBlobs.forEach((blob, index) => form.set(
              `travelerImage:${record.printId}:${index + 1}`,
              blob,
              `${record.printId}-${index + 1}.png`,
            ));
          }
        }
        if (target === 'warning' || target === 'traveler_warning') {
          for (const record of records) {
            if (!printItem(record, 'QUALITY_WARNING')) continue;
            const pageBlobs = capturedWarnings.get(record.printId) || [];
            if (pageBlobs.length !== record.snapshot.qualityWarnings.length) throw new Error('异常警示附页生成不完整，请刷新后重试');
            pageBlobs.forEach((blob, index) => form.set(`warningImage:${record.printId}:${index + 1}`, blob, `${record.printId}-warning-${index + 1}.png`));
          }
        }
        const response = await fetch('/api/work-order-qr/prints/packet', {
          method: 'POST',
          body: form,
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(body.error || `打印文件生成失败（${response.status}）`);
        }
        const blob = await response.blob();
        if (!blob.size || blob.type !== 'application/pdf') throw new Error('服务器返回的打印文件无效');
        const url = URL.createObjectURL(blob);
        objectUrls.push(url);
        if (cancelled) {
          URL.revokeObjectURL(url);
          return false;
        }
        const pageCount = Number(response.headers.get('X-Print-Packet-Pages')) || undefined;
        setPacketStates(previous => ({ ...previous, [target]: { status: 'ready', url, pageCount } }));
        return true;
      } catch (reason) {
        if (controller.signal.aborted || cancelled) return false;
        setPacketStates(previous => ({
          ...previous,
          [target]: { status: 'error', message: reason instanceof Error ? reason.message : '打印文件生成失败' },
        }));
        return false;
      }
    }

    void (async () => {
      if (duplexTravelerSop && includesTraveler && includesSop) {
        const combinedReady = await buildPacket('all');
        if (!combinedReady && !cancelled) {
          const travelerReady = await buildPacket('traveler');
          if (travelerReady && !cancelled) setActiveTarget('traveler');
        }
        if (includesWarning && !cancelled) await buildPacket('warning');
        return;
      }
      for (const target of separateTargets) await buildPacket(target);
    })();

    return () => {
      cancelled = true;
      controller.abort();
      objectUrls.forEach(url => URL.revokeObjectURL(url));
    };
  }, [
    duplexTravelerSop,
    includesSop,
    includesTraveler,
    includesWarning,
    loadError,
    originKey,
    qrReady,
    records,
    separateTargets,
    travelerLayoutSelection,
    travelerPagesByPrintId,
    travelerPlanKey,
  ]);

  function openSourcePdf(url: string) {
    const popup = window.open('', '_blank');
    if (!popup) {
      window.location.assign(url);
      return;
    }
    popup.opener = null;
    popup.location.replace(url);
  }

  function openDrawing(record: WorkOrderTravelerPrintRecord) {
    openSourcePdf(`/api/work-order-qr/prints/${encodeURIComponent(record.printId)}/drawing`);
    setOpenedDrawings(previous => new Set(previous).add(record.printId));
  }

  function openSop(record: WorkOrderTravelerPrintRecord) {
    openSourcePdf(`/api/work-order-qr/prints/${encodeURIComponent(record.printId)}/sop`);
    setOpenedSops(previous => new Set(previous).add(record.printId));
  }

  function requestPacketConfirmation(target: PrintTarget) {
    const materials = targetMaterials(target);
    const printIds = records
      .filter(record => materials.some(material => printItem(record, material)))
      .map(record => record.printId);
    setConfirmRequest({ printIds, materials });
  }

  async function confirmPrinted() {
    if (!confirmRequest || confirming) return;
    const pendingKeys = records.flatMap(record => confirmRequest.printIds.includes(record.printId)
      ? confirmRequest.materials
          .filter(material => printItem(record, material) && !confirmedItems.has(itemKey(record.printId, material)))
          .map(material => itemKey(record.printId, material))
      : []);
    if (!pendingKeys.length) {
      setConfirmRequest(null);
      return;
    }
    setConfirming(true);
    setConfirmError('');
    try {
      const response = await fetch('/api/work-order-qr/prints/confirm', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ printIds: confirmRequest.printIds, materials: confirmRequest.materials }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || '打印确认失败');
      setConfirmedItems(previous => new Set([...previous, ...pendingKeys]));
      setConfirmRequest(null);
    } catch (reason) {
      setConfirmError(reason instanceof Error ? reason.message : '打印确认失败');
    } finally {
      setConfirming(false);
    }
  }

  function travelerSheet(record: WorkOrderTravelerPrintRecord, page: TravelerPage, capture = false) {
    const snapshot = record.snapshot;
    const isContinuation = page.pageNumber > 1;
    const isLastPage = page.pageNumber === page.pageCount;
    const firstStep = page.steps[0];
    const lastStep = page.steps.at(-1);
    return <article
      className={`traveler-sheet${page.steps.length > 18 ? ' dense' : ''}${isContinuation ? ' continuation' : ''}${page.pageCount === 1 && snapshot.steps.length > AUTO_FIRST_PAGE_STEP_CAPACITY ? ' single-fit' : ''}`}
      key={`${record.printId}-traveler-${page.pageNumber}`}
      ref={capture ? node => { travelerRefs.current[travelerPageKey(record.printId, page.pageNumber)] = node; } : undefined}
      data-traveler-source={capture ? `${record.printId}:${page.pageNumber}` : undefined}
    >
      {!isContinuation ? <>
        <header className="traveler-sheet-head">
          <div className="traveler-brand"><b>杭</b><span><strong>杭连电子生产流转单</strong><small>扫码报工 · 整单随单流转</small></span></div>
          <div className="traveler-version"><span>工艺版本</span><strong>V{snapshot.routeVersion}</strong><small>{dateTimeText(record.generatedAt)}</small></div>
        </header>
        <section className="traveler-order-grid">
          <div className="traveler-order-main">
            <span>产品 / 规格</span><strong>{snapshot.specification || snapshot.productName}</strong>
            <small>{snapshot.customerName || '客户待维护'} · {snapshot.productName}</small>
            <dl><div className="traveler-business-code"><dt>内部工单</dt><dd>{snapshot.businessWorkOrderCode || '待生成'}</dd></div><div><dt>生产数量</dt><dd>{snapshot.targetQty.toLocaleString()} {snapshot.unitLabel}</dd></div><div><dt>计划交期</dt><dd>{deliveryText(snapshot.deliveryDay)}</dd></div></dl>
          </div>
          <div className="traveler-qr">{qrImages[record.printId]
            ? <img src={qrImages[record.printId]} alt={`${snapshot.workOrderCode}现场报工二维码`} />
            : <span><LoaderCircle className="spin" size={28} />生成中</span>}<strong>手机扫码报工</strong><small>短码 {record.shortCode}</small></div>
        </section>
      </> : <header className="traveler-continuation-head">
        <div className="traveler-continuation-brand"><b>杭</b><span><small>生产流转单续页</small><strong>{snapshot.specification || snapshot.productName}</strong></span></div>
        <dl><div><dt>内部工单</dt><dd>{snapshot.businessWorkOrderCode || '待生成'}</dd></div><div><dt>工艺版本</dt><dd>V{snapshot.routeVersion}</dd></div><div><dt>生产数量</dt><dd>{snapshot.targetQty.toLocaleString()} {snapshot.unitLabel}</dd></div></dl>
        <div className="traveler-continuation-qr">{qrImages[record.printId]
          ? <img src={qrImages[record.printId]} alt={`${snapshot.workOrderCode}续页报工二维码`} />
          : <span>短码</span>}<small>{record.shortCode}</small></div>
      </header>}
      <section className="traveler-route-title"><span>{isContinuation ? '工艺路线续页' : '工艺路线'}</span><strong>共 {snapshot.steps.length} 道工序</strong><small>本页 {firstStep ? String(firstStep.position).padStart(2, '0') : '-'}～{lastStep ? String(lastStep.position).padStart(2, '0') : '-'}</small></section>
      <table className="traveler-process-table"><thead><tr><th>序号</th><th>工序名称</th><th>标准工时</th><th>标准小时产能</th><th>首件确认</th><th>数量</th><th>员工姓名</th><th>日期 / 确认</th></tr></thead><tbody>{page.steps.map(step => <tr key={step.id}><td>{String(step.position).padStart(2, '0')}</td><td><strong>{step.processName}</strong><small>第 {step.sequenceGroup} 顺序组</small></td><td>{standardTimeText(step.standardMillisecondsPerUnit, step.timeBasis, step.unitsPerProduct)}</td><td><strong>{hourlyCapacityText({ timeBasis: step.timeBasis, standardMillisecondsPerUnit: step.standardMillisecondsPerUnit, unitsPerProduct: step.unitsPerProduct, unitLabel: step.unitLabel || snapshot.unitLabel })}</strong><small>{step.timeBasis === 'per_unit' ? '理论值' : '批量待现场确认'}</small></td><td><span className="traveler-first-piece-box" aria-label="首件确认方框" /></td><td /><td /><td /></tr>)}</tbody></table>
      <footer className={`traveler-sheet-foot${isLastPage ? ' final' : ' continued'}`}>{isLastPage ? <><div><span>质量异常</span><b /></div><div><span>最终包装</span><b /></div><p>二维码仅用于定位工单，提交报工前必须使用员工编号登录并核对姓名。纸面版本与系统不一致时，以手机端最新工艺为准并重新打印。</p></> : <p>工艺路线未结束，请继续使用下一页；不得跳过、拆分或重新编号工序。</p>}<small className="traveler-page-number">{snapshot.businessWorkOrderCode || snapshot.workOrderCode} · 第 {page.pageNumber} / {page.pageCount} 页</small></footer>
    </article>;
  }

  function warningSheet(record: WorkOrderTravelerPrintRecord, warning: QualityWarning, pageNumber: number, capture = false) {
    const snapshot = record.snapshot;
    const actions = warningLines(warning.requiredAction);
    const photos = warning.attachments.filter(item => item.mimeType.startsWith('image/')).slice(0, 3);
    return <article
      className="quality-warning-sheet"
      key={`${record.printId}-warning-${warning.alertId}`}
      ref={capture ? node => { warningRefs.current[warningPageKey(record.printId, pageNumber)] = node; } : undefined}
      data-warning-source={capture ? `${record.printId}:${pageNumber}` : undefined}
    >
      <header className="quality-warning-print-head">
        <div><ShieldAlert /><span><strong>产品质量异常作业警示单</strong><small>归档异常自动同步 · 随工单执行并留存</small></span></div>
        <em>R{warning.revisionNumber} · {warning.printPolicy === 'REQUIRED' ? '必须随单打印' : '可选附页'}</em>
      </header>
      <section className="quality-warning-meta">
        <div className="wide"><span>异常标题</span><strong>{warning.title}</strong></div>
        <div><span>异常编号</span><strong>{warning.reportNo}</strong></div>
        <div><span>风险等级</span><strong className={`risk-${warning.severity.toLowerCase()}`}>{warning.severity === 'CRITICAL' ? '重大' : warning.severity === 'HIGH' ? '高' : warning.severity === 'MEDIUM' ? '中' : '低'}</strong></div>
        <div className="wide"><span>产品</span><strong>{snapshot.specification || snapshot.productName}</strong></div>
        <div><span>关联工单</span><strong>{snapshot.businessWorkOrderCode || snapshot.workOrderCode}</strong></div>
        <div><span>归档时间</span><strong>{dateTimeText(warning.archivedAt)}</strong></div>
      </section>
      <section className="quality-warning-analysis">
        <div><h3>异常现象与风险</h3><p>{warning.warningSummary || warning.defectPhenomenon || '见异常归档记录'}</p><small><b>确认根因：</b>{warning.rootCause || '见归档分析'}</small></div>
        <aside>{photos.length ? photos.map(photo => <figure key={photo.id}><img src={photo.contentUrl} alt={photo.caption || photo.displayName} /><figcaption>{photo.caption || photo.category}</figcaption></figure>) : <div className="quality-warning-no-photo"><ShieldAlert /><span>本版本无图片证据<br />请扫码查看完整归档</span></div>}</aside>
      </section>
      <section className="quality-warning-actions">
        <h3>本批工单执行要求（必须执行）</h3>
        <div>{(actions.length ? actions : ['按归档解决方案执行，并完成首件确认与过程复核。']).map((action, index) => <article key={`${warning.alertId}-action-${index}`}><b>{String(index + 1).padStart(2, '0')}</b><span>{action}</span></article>)}</div>
      </section>
      <section className="quality-warning-controls">
        <div><span>检查方法</span><strong>{warning.inspectionMethod || '按归档方案执行'}</strong></div>
        <div><span>检查频次</span><strong>{warning.inspectionFrequency || '首件及巡检'}</strong></div>
        <div><span>合格判定</span><strong>{warning.acceptanceCriteria || '满足图纸与检验标准'}</strong></div>
        <div><span>停线 / 升级条件</span><strong>{warning.stopConditions || '发现同类异常立即停线并上报质量'}</strong></div>
      </section>
      <section className="quality-warning-knowledge">
        <div className="quality-warning-qr">{warningQrImages[warning.alertId] ? <img src={warningQrImages[warning.alertId]} alt="异常归档二维码" /> : <span>二维码生成中</span>}</div>
        <div><h3>扫码查看完整异常归档</h3><p>原因、措施、证据图片、版本历史与关联产品均以系统归档版本为准。</p><small>适用工序：{warning.applicableProcess || '全部相关工序'} · 升级联系人：{warning.escalationContact || '质量部'}</small></div>
      </section>
      <section className="quality-warning-signatures">
        {['工艺确认', '质量确认', '生产确认', '操作员确认'].map(label => <div key={label}><strong>{label}</strong><span>姓名：</span><span>签字：</span><span>日期：</span></div>)}
      </section>
      <footer><span>警示快照 {warning.reportNo}-R{warning.revisionNumber}</span><strong>请随工单一同下发与归档</strong><small>第 {pageNumber} / {snapshot.qualityWarnings.length} 张警示附页</small></footer>
    </article>;
  }

  const combinedState = packetStates.all;
  const visibleTargets: PrintTarget[] = duplexTravelerSop && includesTraveler && includesSop
    ? (combinedState?.status === 'error' && packetStates.traveler?.status === 'ready'
        ? ['traveler', ...(includesWarning ? ['warning' as const] : [])]
        : ['all', ...(includesWarning ? ['warning' as const] : [])])
    : separateTargets;
  const selectedTarget = visibleTargets.includes(activeTarget) ? activeTarget : (visibleTargets[0] || activeTarget);
  const activePacket = packetStates[selectedTarget];
  const sopPacketFailed = includesSop && (packetStates.sop?.status === 'error' || packetStates.all?.status === 'error');
  const confirmLabels = confirmRequest?.materials.map(materialText).join('、') || '';
  const selectedTargetKeys = records.flatMap(record => targetMaterials(selectedTarget)
    .filter(material => printItem(record, material))
    .map(material => itemKey(record.printId, material)));
  const selectedTargetConfirmed = selectedTargetKeys.length > 0
    && selectedTargetKeys.every(key => confirmedItems.has(key));

  return <>
    <main className="traveler-print-screen">
      <header className="traveler-print-toolbar">
        <a href={returnTo}><ArrowLeft size={18} />{workOrderPrintReturnLabel(returnTo)}</a>
        <div><strong>生产资料打印</strong><span>{records.length} 张工单 · {modeText(records[0]?.mode || 'TRAVELER_ONLY')}</span></div>
        <div className="traveler-print-toolbar-actions">
          {activePacket?.status === 'ready' && activePacket.url && <a
            className="traveler-print-primary"
            href={activePacket.url}
            onClick={() => setOpenedTargets(previous => new Set(previous).add(selectedTarget))}
          ><Printer size={18} />{openedTargets.has(selectedTarget) ? '再次打开打印界面' : '在当前页打开打印界面'}</a>}
          {activePacket?.status === 'ready' && !selectedTargetConfirmed && <button className="confirm" type="button" onClick={() => requestPacketConfirmation(selectedTarget)}><FileCheck2 size={17} />确认已打印</button>}
          {activePacket?.status === 'ready' && selectedTargetConfirmed && !allConfirmed && <span className="traveler-print-confirmed"><CheckCircle2 size={17} />当前资料已确认</span>}
          {allConfirmed && <span className="traveler-print-confirmed"><CheckCircle2 size={17} />全部资料已确认</span>}
        </div>
      </header>

      {duplexTravelerSop && includesTraveler && includesSop && <div className="traveler-print-instruction"><FileText size={18} /><span><strong>统一 PDF 双面打印包</strong> PDF版SOP保留源页面，图片版SOP自动转为A4打印页；打印时选择“双面 / 长边翻转”，方向选择“自动”。</span></div>}
      {includesWarning && <div className="traveler-print-instruction quality"><ShieldAlert size={18} /><span><strong>异常警示使用固定 A4 附页</strong> 每条生效警示独立一页；必打策略已强制加入。流转单/SOP双面包与警示附页分开，避免破坏双面翻页顺序。</span></div>}
      {loadError && <div className="traveler-print-warning">资料加载失败：{loadError}</div>}

      {includesTraveler && <section className="traveler-layout-settings" aria-labelledby="traveler-layout-title">
        <header>
          <span><SlidersHorizontal size={20} /><strong id="traveler-layout-title">流转单分页方式</strong><small>设置变更后自动重新生成预览；只影响二维码流转单，不改变 SOP 原始页数。</small></span>
          <em><Files size={15} />{totalTravelerPages} 页 · {totalTravelerSteps}/{totalTravelerSteps} 道工序</em>
        </header>
        <div className="traveler-layout-body">
          <div className="traveler-layout-options" role="radiogroup" aria-label="流转单分页方式">
            {TRAVELER_LAYOUT_OPTIONS.map(option => <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={layoutMode === option.value}
              className={layoutMode === option.value ? 'active' : ''}
              onClick={() => setLayoutMode(option.value)}
            ><span>{option.label}</span><small>{option.description}</small></button>)}
          </div>
          {layoutMode === 'custom' && <label className="traveler-layout-count" htmlFor="traveler-custom-page-count"><span>指定页数</span><input
            id="traveler-custom-page-count"
            type="number"
            min={1}
            max={MAX_CUSTOM_TRAVELER_PAGES}
            value={customPageCount}
            onChange={event => setCustomPageCount(Math.max(1, Math.min(MAX_CUSTOM_TRAVELER_PAGES, Number(event.target.value) || 1)))}
          /><small>最多 {MAX_CUSTOM_TRAVELER_PAGES} 页；不会创建没有工序的空白流转单。</small></label>}
          <div className={`traveler-layout-result${singlePageReadabilityWarning ? ' warning' : ''}`} aria-live="polite">
            {singlePageReadabilityWarning ? <AlertTriangle size={20} /> : <CheckCircle2 size={20} />}
            <span><strong>{layoutMode === 'single' ? '单页完整缩放' : layoutMode === 'double' ? '固定双页' : layoutMode === 'custom' ? `自定义 ${customPageCount} 页` : '自动清晰分页'}</strong><small>{singlePageReadabilityWarning
              ? `最多 ${maxTravelerSteps} 道工序将完整缩放到单页，保证不裁切，但打印字号会变小。`
              : `${totalTravelerSteps} 道工序已连续分配到 ${totalTravelerPages} 个流转单页面，页码和工序范围将由服务端再次校验。`}</small></span>
          </div>
        </div>
      </section>}

      {includesDrawing && <section className="traveler-drawing-jobs" aria-label="原图打印清单">
        <header><span><FileImage size={19} /><strong>原图打印清单</strong><small>PDF保留源页面尺寸；JPG、PNG、WebP自动转换为所选A4/A3打印页。</small></span><em>{records.filter(record => printItem(record, 'DRAWING')).length} 项</em></header>
        <div>{records.filter(record => printItem(record, 'DRAWING')).map(record => {
          const drawing = printItem(record, 'DRAWING')!;
          const confirmed = confirmedItems.has(itemKey(record.printId, 'DRAWING'));
          return <article key={record.printId}><span><strong>{record.snapshot.specification || record.snapshot.productName}</strong><small>{drawing.fileName || '原图'} · {sourceFormatText(drawing)} · {drawingPrintRule(record, drawing)} · {drawing.copies} 份</small></span><b className={confirmed ? 'confirmed' : openedDrawings.has(record.printId) ? 'opened' : ''}>{confirmed ? '已打印' : openedDrawings.has(record.printId) ? '待确认' : '未打开'}</b><button type="button" onClick={() => openDrawing(record)}><ExternalLink size={15} />{openedDrawings.has(record.printId) ? '重新打开原图' : '打开原图'}</button>{!confirmed && <button className="confirm" type="button" disabled={!openedDrawings.has(record.printId)} onClick={() => setConfirmRequest({ printIds: [record.printId], materials: ['DRAWING'] })}><FileCheck2 size={15} />确认已打印</button>}</article>;
        })}</div>
      </section>}

      {visibleTargets.length > 0 ? <section className="traveler-packet-card" aria-label="打印文件预览">
        <header>
          <div><span>打印预览</span><strong>{targetText(selectedTarget)}</strong><small>{activePacket?.status === 'ready' ? `${activePacket.pageCount || '多'} 页 · PDF保留源页面，图片自动适配` : '正在准备可重复使用的统一 PDF 打印文件'}</small></div>
          {visibleTargets.length > 1 && <nav aria-label="打印资料切换">{visibleTargets.map(target => <button className={selectedTarget === target ? 'active' : ''} type="button" key={target} onClick={() => setActiveTarget(target)}>{targetText(target)}</button>)}</nav>}
        </header>
        <div className="traveler-packet-preview">
          {(!activePacket || activePacket.status === 'loading') && <div className="traveler-packet-loading"><LoaderCircle className="spin" size={34} /><strong>正在生成打印文件</strong><span>流转单与异常警示仅渲染一次；PDF版SOP直接复制页面，图片版SOP安全转换为打印页。</span></div>}
          {activePacket?.status === 'error' && <div className="traveler-packet-error"><FileText size={34} /><strong>合并打印文件生成失败</strong><span>{activePacket.message}</span>{includesSop && <small>下方已提供 SOP 原文件入口；流转单备用文件会继续生成。</small>}</div>}
          {activePacket?.status === 'ready' && activePacket.url && <iframe title={`${targetText(selectedTarget)}预览`} src={`${activePacket.url}#toolbar=1&navpanes=0&view=FitH`} />}
        </div>
        {activePacket?.status === 'ready' && <footer><span><CheckCircle2 size={16} />预览文件已固定，可连续多次打开，不会再次转换 SOP。</span><small>浏览器预览不会自动标记打印；纸张输出并核对后再点“确认已打印”。</small></footer>}
      </section> : <section className="traveler-print-external-only"><FileImage size={34} /><strong>当前任务仅包含原图</strong><span>请在上方清单逐张打开统一PDF打印预览并确认。</span></section>}

      {sopPacketFailed && <section className="traveler-drawing-jobs traveler-sop-fallback" aria-label="SOP 原文件打印清单">
        <header><span><FileText size={19} /><strong>SOP 单文件备用打印</strong><small>仅当合并文件失败时使用；PDF保留源页面，图片自动生成A4打印页。</small></span><em>{records.filter(record => printItem(record, 'SOP')).length} 项</em></header>
        <div>{records.filter(record => printItem(record, 'SOP')).map(record => {
          const sop = printItem(record, 'SOP')!;
          const confirmed = confirmedItems.has(itemKey(record.printId, 'SOP'));
          return <article key={record.printId}><span><strong>{record.snapshot.specification || record.snapshot.productName}</strong><small>{sop.fileName || 'SOP'} · {sourceFormatText(sop)} · {sourceFormatText(sop) === 'PDF' ? '保留源页面' : 'A4自动横竖'} · {sop.copies} 份</small></span><b className={confirmed ? 'confirmed' : openedSops.has(record.printId) ? 'opened' : ''}>{confirmed ? '已打印' : openedSops.has(record.printId) ? '待确认' : '未打开'}</b><button type="button" onClick={() => openSop(record)}><ExternalLink size={15} />{openedSops.has(record.printId) ? '重新打开 SOP' : '打开 SOP'}</button>{!confirmed && <button className="confirm" type="button" disabled={!openedSops.has(record.printId)} onClick={() => setConfirmRequest({ printIds: [record.printId], materials: ['SOP'] })}><FileCheck2 size={15} />确认已打印</button>}</article>;
        })}</div>
      </section>}

      {confirmRequest && <div className="traveler-print-confirm-backdrop" role="presentation"><section role="dialog" aria-modal="true" aria-labelledby="traveler-print-confirm-title">
        <button className="close" type="button" aria-label="关闭" disabled={confirming} onClick={() => setConfirmRequest(null)}><X size={19} /></button>
        <FileCheck2 size={34} /><span>实体打印确认</span><h2 id="traveler-print-confirm-title">{confirmLabels}已经打印完成吗？</h2>
        <p>只有在纸张已从打印机输出并核对无误后再确认。关闭预览、取消打印或纸张异常时不要确认。</p>
        {confirmError && <div>{confirmError}</div>}
        <footer><button type="button" disabled={confirming} onClick={() => setConfirmRequest(null)}>尚未完成</button><button className="primary" type="button" disabled={confirming} onClick={() => { void confirmPrinted(); }}>{confirming ? '确认中...' : `确认 ${confirmLabels} 已打印`}</button></footer>
      </section></div>}
    </main>

    {includesTraveler && <div className="traveler-packet-sources" aria-hidden="true">
      {records.filter(record => printItem(record, 'TRAVELER')).flatMap(record => (
        travelerPagesByPrintId.get(record.printId) || []
      ).map(page => travelerSheet(record, page, true)))}
    </div>}
    {includesWarning && <div className="quality-warning-packet-sources" aria-hidden="true">
      {records.filter(record => printItem(record, 'QUALITY_WARNING')).flatMap(record => record.snapshot.qualityWarnings.map((warning, index) => warningSheet(record, warning, index + 1, true)))}
    </div>}
  </>;
}
