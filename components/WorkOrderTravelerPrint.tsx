'use client';

/* eslint-disable @next/next/no-img-element */

import {
  ArrowLeft,
  CheckCircle2,
  ExternalLink,
  FileCheck2,
  FileImage,
  FileText,
  LoaderCircle,
  Printer,
  X,
} from 'lucide-react';
import QRCode from 'qrcode';
import { useEffect, useMemo, useRef, useState } from 'react';
import { workOrderPrintReturnLabel } from '@/lib/work-order-print-navigation';
import type { WorkOrderTravelerPrintRecord } from '@/lib/work-order-qr-service';

type PrintTarget = 'all' | 'traveler' | 'sop';
type PrintMaterial = 'TRAVELER' | 'SOP' | 'DRAWING';
type PacketState = {
  status: 'loading' | 'ready' | 'error';
  url?: string;
  pageCount?: number;
  message?: string;
};

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

function modeText(mode: WorkOrderTravelerPrintRecord['mode']): string {
  if (mode === 'TRAVELER_SOP_DUPLEX') return '流转单 + SOP 双面';
  if (mode === 'TRAVELER_SOP_SEPARATE') return '流转单与 SOP 分开';
  if (mode === 'DRAWING_SOP_TRAVELER_SEPARATE') return '原图、SOP、流转单分开';
  if (mode === 'DRAWING_SEPARATE_TRAVELER_SOP_DUPLEX') return '原图单独 + 流转单/SOP 双面';
  if (mode === 'CUSTOM') return '自定义补打';
  return '仅流转单';
}

function materialText(material: PrintMaterial): string {
  if (material === 'TRAVELER') return '二维码流转单';
  if (material === 'SOP') return 'SOP';
  return '原图';
}

function targetText(target: PrintTarget): string {
  if (target === 'all') return '流转单 + SOP 双面打印包';
  if (target === 'traveler') return '二维码流转单';
  return 'SOP 原版打印包';
}

function targetMaterials(target: PrintTarget): PrintMaterial[] {
  if (target === 'all') return ['TRAVELER', 'SOP'];
  return [target === 'traveler' ? 'TRAVELER' : 'SOP'];
}

function itemKey(printId: string, material: PrintMaterial) {
  return `${printId}:${material}`;
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
  const [loadError, setLoadError] = useState('');
  const [packetStates, setPacketStates] = useState<Partial<Record<PrintTarget, PacketState>>>({});
  const [activeTarget, setActiveTarget] = useState<PrintTarget>('all');
  const [openedTargets, setOpenedTargets] = useState<Set<PrintTarget>>(() => new Set());
  const [openedDrawings, setOpenedDrawings] = useState<Set<string>>(() => new Set());
  const [openedSops, setOpenedSops] = useState<Set<string>>(() => new Set());
  const [confirmRequest, setConfirmRequest] = useState<{ printIds: string[]; materials: PrintMaterial[] } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState('');
  const travelerRefs = useRef<Record<string, HTMLElement | null>>({});
  const [confirmedItems, setConfirmedItems] = useState(() => new Set(records.flatMap(record => record.items
    .filter(item => item.status === 'CONFIRMED')
    .map(item => itemKey(record.printId, item.material)))));

  const originKey = useMemo(() => records.map(record => `${record.printId}:${record.mode}:${record.items.map(item => `${item.material}:${item.fileVersion || ''}:${item.copies}`).join(',')}`).join('|'), [records]);
  const includesTraveler = records.some(record => Boolean(printItem(record, 'TRAVELER')));
  const includesSop = records.some(record => Boolean(printItem(record, 'SOP')));
  const includesDrawing = records.some(record => Boolean(printItem(record, 'DRAWING')));
  const duplexTravelerSop = records.every(record => record.mode === 'TRAVELER_SOP_DUPLEX' || record.mode === 'DRAWING_SEPARATE_TRAVELER_SOP_DUPLEX');
  const qrReady = records.every(record => !printItem(record, 'TRAVELER') || Boolean(qrImages[record.printId]));
  const allConfirmed = records.every(record => record.items.every(item => confirmedItems.has(itemKey(record.printId, item.material))));
  const separateTargets = useMemo(() => ([
    ...(includesTraveler ? ['traveler' as const] : []),
    ...(includesSop ? ['sop' as const] : []),
  ]), [includesSop, includesTraveler]);

  useEffect(() => {
    let cancelled = false;
    setLoadError('');
    setQrImages({});
    const travelerRecords = records.filter(record => printItem(record, 'TRAVELER'));
    void Promise.all(travelerRecords.map(async record => {
      const link = `${window.location.origin}/field-report/${encodeURIComponent(record.publicCode)}`;
      const dataUrl = await QRCode.toDataURL(link, {
        errorCorrectionLevel: 'M', margin: 1, width: 520,
        color: { dark: '#111827', light: '#ffffff' },
      });
      return [record.printId, dataUrl] as const;
    })).then(entries => {
      if (!cancelled) setQrImages(Object.fromEntries(entries));
    }).catch(reason => {
      if (!cancelled) setLoadError(reason instanceof Error ? reason.message : '二维码生成失败');
    });
    return () => { cancelled = true; };
  }, [originKey, records]);

  useEffect(() => {
    if (loadError || (includesTraveler && !qrReady) || (!includesTraveler && !includesSop)) return;
    let cancelled = false;
    const controller = new AbortController();
    const objectUrls: string[] = [];
    const capturedTravelers = new Map<string, Blob>();
    setPacketStates({});
    setActiveTarget(duplexTravelerSop && includesTraveler && includesSop ? 'all' : (separateTargets[0] || 'traveler'));

    async function captureTravelerPages() {
      if (capturedTravelers.size) return;
      if ('fonts' in document) await document.fonts.ready;
      await new Promise<void>(resolve => window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve())));
      const html2canvas = (await import('html2canvas')).default;
      for (const record of records) {
        if (!printItem(record, 'TRAVELER')) continue;
        const source = travelerRefs.current[record.printId];
        if (!source) throw new Error('二维码流转单页面尚未就绪，请刷新后重试');
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
        capturedTravelers.set(record.printId, await canvasPng(canvas));
        canvas.width = 1;
        canvas.height = 1;
      }
    }

    async function buildPacket(target: PrintTarget): Promise<boolean> {
      if (cancelled) return false;
      setPacketStates(previous => ({ ...previous, [target]: { status: 'loading' } }));
      try {
        if (target === 'all' || target === 'traveler') await captureTravelerPages();
        const form = new FormData();
        form.set('printIds', records.map(record => record.printId).join(','));
        form.set('target', target);
        if (target === 'all' || target === 'traveler') {
          capturedTravelers.forEach((blob, printId) => form.set(`travelerImage:${printId}`, blob, `${printId}.png`));
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
        return;
      }
      for (const target of separateTargets) await buildPacket(target);
    })();

    return () => {
      cancelled = true;
      controller.abort();
      objectUrls.forEach(url => URL.revokeObjectURL(url));
    };
  }, [duplexTravelerSop, includesSop, includesTraveler, loadError, originKey, qrReady, records, separateTargets]);

  function openDrawing(record: WorkOrderTravelerPrintRecord) {
    window.open(`/api/work-order-qr/prints/${encodeURIComponent(record.printId)}/drawing`, '_blank', 'noopener,noreferrer');
    setOpenedDrawings(previous => new Set(previous).add(record.printId));
  }

  function openSop(record: WorkOrderTravelerPrintRecord) {
    window.open(`/api/work-order-qr/prints/${encodeURIComponent(record.printId)}/sop`, '_blank', 'noopener,noreferrer');
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

  function travelerSheet(record: WorkOrderTravelerPrintRecord, capture = false) {
    const snapshot = record.snapshot;
    return <article
      className={`traveler-sheet${snapshot.steps.length > 18 ? ' dense' : ''}`}
      key={`${record.printId}-traveler`}
      ref={capture ? node => { travelerRefs.current[record.printId] = node; } : undefined}
      data-traveler-source={capture ? record.printId : undefined}
    >
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
          ? <><img src={qrImages[record.printId]} alt={`${snapshot.workOrderCode}现场报工二维码`} /></>
          : <span><LoaderCircle className="spin" size={28} />生成中</span>}<strong>手机扫码报工</strong><small>短码 {record.shortCode}</small></div>
      </section>
      <section className="traveler-route-title"><span>工艺路线</span><strong>共 {snapshot.steps.length} 道工序</strong><small>扫码可单选或批量报工</small></section>
      <table className="traveler-process-table"><thead><tr><th>序号</th><th>工序名称</th><th>顺序组</th><th>标准工时</th><th>首件确认</th><th>数量</th><th>日期 / 确认</th></tr></thead><tbody>{snapshot.steps.map(step => <tr key={step.id}><td>{String(step.position).padStart(2, '0')}</td><td><strong>{step.processName}</strong></td><td>{step.sequenceGroup}</td><td>{standardTimeText(step.standardMillisecondsPerUnit, step.timeBasis, step.unitsPerProduct)}</td><td><span className="traveler-first-piece-box" aria-label="首件确认方框" /></td><td /><td /></tr>)}</tbody></table>
      <footer className="traveler-sheet-foot"><div><span>质量异常</span><b /></div><div><span>最终包装</span><b /></div><p>二维码仅用于定位工单，提交报工前必须使用员工编号登录并核对姓名。纸面版本与系统不一致时，以手机端最新工艺为准并重新打印。</p></footer>
    </article>;
  }

  const combinedState = packetStates.all;
  const visibleTargets: PrintTarget[] = duplexTravelerSop && includesTraveler && includesSop
    ? (combinedState?.status === 'error' && packetStates.traveler?.status === 'ready' ? ['traveler'] : ['all'])
    : separateTargets;
  const selectedTarget = visibleTargets.includes(activeTarget) ? activeTarget : (visibleTargets[0] || activeTarget);
  const activePacket = packetStates[selectedTarget];
  const sopPacketFailed = includesSop && (packetStates.sop?.status === 'error' || packetStates.all?.status === 'error');
  const confirmLabels = confirmRequest?.materials.map(materialText).join('、') || '';

  return <>
    <main className="traveler-print-screen">
      <header className="traveler-print-toolbar">
        <a href={returnTo}><ArrowLeft size={18} />{workOrderPrintReturnLabel(returnTo)}</a>
        <div><strong>生产资料打印</strong><span>{records.length} 张工单 · {modeText(records[0]?.mode || 'TRAVELER_ONLY')}</span></div>
        <div className="traveler-print-toolbar-actions">
          {activePacket?.status === 'ready' && activePacket.url && <a
            className="traveler-print-primary"
            href={activePacket.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setOpenedTargets(previous => new Set(previous).add(selectedTarget))}
          ><Printer size={18} />{openedTargets.has(selectedTarget) ? '再次打开打印界面' : '打开完整打印界面'}</a>}
          {activePacket?.status === 'ready' && <button className="confirm" type="button" onClick={() => requestPacketConfirmation(selectedTarget)}><FileCheck2 size={17} />确认已打印</button>}
          {allConfirmed && <span className="traveler-print-confirmed"><CheckCircle2 size={17} />全部资料已确认</span>}
        </div>
      </header>

      {duplexTravelerSop && includesTraveler && includesSop && <div className="traveler-print-instruction"><FileText size={18} /><span><strong>原生 PDF 双面打印包</strong> SOP 保留源文件横竖方向、矢量内容和已发布标注；打印时选择“双面 / 长边翻转”，方向选择“自动”。</span></div>}
      {loadError && <div className="traveler-print-warning">资料加载失败：{loadError}</div>}

      {includesDrawing && <section className="traveler-drawing-jobs" aria-label="原图打印清单">
        <header><span><FileImage size={19} /><strong>原图打印清单</strong><small>每张工单独立打开源 PDF，打印机按 PDF 自带的 A3/A4 页面尺寸和方向输出。</small></span><em>{records.filter(record => printItem(record, 'DRAWING')).length} 项</em></header>
        <div>{records.filter(record => printItem(record, 'DRAWING')).map(record => {
          const drawing = printItem(record, 'DRAWING')!;
          const confirmed = confirmedItems.has(itemKey(record.printId, 'DRAWING'));
          return <article key={record.printId}><span><strong>{record.snapshot.specification || record.snapshot.productName}</strong><small>{drawing.fileName || '原图 PDF'} · {drawing.copies} 份</small></span><b className={confirmed ? 'confirmed' : openedDrawings.has(record.printId) ? 'opened' : ''}>{confirmed ? '已打印' : openedDrawings.has(record.printId) ? '待确认' : '未打开'}</b><button type="button" onClick={() => openDrawing(record)}><ExternalLink size={15} />{openedDrawings.has(record.printId) ? '重新打开原图' : '打开原图'}</button>{!confirmed && <button className="confirm" type="button" disabled={!openedDrawings.has(record.printId)} onClick={() => setConfirmRequest({ printIds: [record.printId], materials: ['DRAWING'] })}><FileCheck2 size={15} />确认已打印</button>}</article>;
        })}</div>
      </section>}

      {visibleTargets.length > 0 ? <section className="traveler-packet-card" aria-label="打印文件预览">
        <header>
          <div><span>打印预览</span><strong>{targetText(selectedTarget)}</strong><small>{activePacket?.status === 'ready' ? `${activePacket.pageCount || '多'} 页 · 原始纸张方向已保留` : '正在准备可重复使用的原生 PDF 打印文件'}</small></div>
          {visibleTargets.length > 1 && <nav aria-label="打印资料切换">{visibleTargets.map(target => <button className={selectedTarget === target ? 'active' : ''} type="button" key={target} onClick={() => setActiveTarget(target)}>{targetText(target)}</button>)}</nav>}
        </header>
        <div className="traveler-packet-preview">
          {(!activePacket || activePacket.status === 'loading') && <div className="traveler-packet-loading"><LoaderCircle className="spin" size={34} /><strong>正在生成打印文件</strong><span>流转单只渲染一次，SOP 直接复制原 PDF，不再逐页转图片。</span></div>}
          {activePacket?.status === 'error' && <div className="traveler-packet-error"><FileText size={34} /><strong>合并打印文件生成失败</strong><span>{activePacket.message}</span>{includesSop && <small>下方已提供 SOP 原文件入口；流转单备用文件会继续生成。</small>}</div>}
          {activePacket?.status === 'ready' && activePacket.url && <iframe title={`${targetText(selectedTarget)}预览`} src={`${activePacket.url}#toolbar=1&navpanes=0&view=FitH`} />}
        </div>
        {activePacket?.status === 'ready' && <footer><span><CheckCircle2 size={16} />预览文件已固定，可连续多次打开，不会再次转换 SOP。</span><small>浏览器预览不会自动标记打印；纸张输出并核对后再点“确认已打印”。</small></footer>}
      </section> : <section className="traveler-print-external-only"><FileImage size={34} /><strong>当前任务仅包含原图</strong><span>请在上方清单逐张打开源 PDF 打印并确认。</span></section>}

      {sopPacketFailed && <section className="traveler-drawing-jobs traveler-sop-fallback" aria-label="SOP 原文件打印清单">
        <header><span><FileText size={19} /><strong>SOP 原文件备用打印</strong><small>仅当合并文件失败时使用；源 PDF 不经过转换，横竖方向和标注保持不变。</small></span><em>{records.filter(record => printItem(record, 'SOP')).length} 项</em></header>
        <div>{records.filter(record => printItem(record, 'SOP')).map(record => {
          const sop = printItem(record, 'SOP')!;
          const confirmed = confirmedItems.has(itemKey(record.printId, 'SOP'));
          return <article key={record.printId}><span><strong>{record.snapshot.specification || record.snapshot.productName}</strong><small>{sop.fileName || 'SOP PDF'} · {sop.copies} 份</small></span><b className={confirmed ? 'confirmed' : openedSops.has(record.printId) ? 'opened' : ''}>{confirmed ? '已打印' : openedSops.has(record.printId) ? '待确认' : '未打开'}</b><button type="button" onClick={() => openSop(record)}><ExternalLink size={15} />{openedSops.has(record.printId) ? '重新打开 SOP' : '打开 SOP'}</button>{!confirmed && <button className="confirm" type="button" disabled={!openedSops.has(record.printId)} onClick={() => setConfirmRequest({ printIds: [record.printId], materials: ['SOP'] })}><FileCheck2 size={15} />确认已打印</button>}</article>;
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
      {records.filter(record => printItem(record, 'TRAVELER')).map(record => travelerSheet(record, true))}
    </div>}
  </>;
}
