'use client';

import { ArrowLeft, CheckCircle2, ExternalLink, FileCheck2, FileImage, FileText, LoaderCircle, Printer, X } from 'lucide-react';
import QRCode from 'qrcode';
import { useEffect, useMemo, useState } from 'react';
import type { WorkOrderTravelerPrintRecord } from '@/lib/work-order-qr-service';

type PrintTarget = 'all' | 'traveler' | 'sop';
type PrintMaterial = 'TRAVELER' | 'SOP' | 'DRAWING';

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

function itemKey(printId: string, material: PrintMaterial) {
  return `${printId}:${material}`;
}

function printItem(record: WorkOrderTravelerPrintRecord, material: PrintMaterial) {
  return record.items.find(item => item.material === material) || null;
}

async function renderSopPages(printId: string): Promise<string[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = '/api/pdf-worker';
  const response = await fetch(`/api/work-order-qr/prints/${encodeURIComponent(printId)}/sop`, {
    credentials: 'include',
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(response.status === 404 ? 'SOP 文件不存在或已失效' : `SOP 文件读取失败（${response.status}）`);
  }
  const data = new Uint8Array(await response.arrayBuffer());
  const loadingTask = pdfjs.getDocument({
    data,
    isEvalSupported: false,
  });
  const document = await loadingTask.promise;
  const pages: string[] = [];
  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1.65 });
      const canvas = window.document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext('2d', { alpha: false });
      if (!context) throw new Error('浏览器无法创建 SOP 打印画布');
      await page.render({ canvasContext: context, viewport }).promise;
      pages.push(canvas.toDataURL('image/jpeg', 0.94));
      page.cleanup();
    }
  } finally {
    await document.destroy();
  }
  return pages;
}

export default function WorkOrderTravelerPrint({ records }: { records: WorkOrderTravelerPrintRecord[] }) {
  const [qrImages, setQrImages] = useState<Record<string, string>>({});
  const [sopPages, setSopPages] = useState<Record<string, string[]>>({});
  const [loadError, setLoadError] = useState('');
  const [sopLoadError, setSopLoadError] = useState('');
  const [printTarget, setPrintTarget] = useState<PrintTarget>('all');
  const [openedTargets, setOpenedTargets] = useState<Set<string>>(() => new Set());
  const [openedDrawings, setOpenedDrawings] = useState<Set<string>>(() => new Set());
  const [openedSops, setOpenedSops] = useState<Set<string>>(() => new Set());
  const [confirmRequest, setConfirmRequest] = useState<{ printIds: string[]; materials: PrintMaterial[] } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState('');
  const [confirmedItems, setConfirmedItems] = useState(() => new Set(records.flatMap(record => record.items
    .filter(item => item.status === 'CONFIRMED')
    .map(item => itemKey(record.printId, item.material)))));
  const originKey = useMemo(() => records.map(record => `${record.printId}:${record.mode}:${record.items.map(item => `${item.material}:${item.fileVersion || ''}`).join(',')}`).join('|'), [records]);
  const includesTraveler = records.some(record => Boolean(printItem(record, 'TRAVELER')));
  const includesSop = records.some(record => Boolean(printItem(record, 'SOP')));
  const includesDrawing = records.some(record => Boolean(printItem(record, 'DRAWING')));
  const duplexTravelerSop = records.every(record => record.mode === 'TRAVELER_SOP_DUPLEX' || record.mode === 'DRAWING_SEPARATE_TRAVELER_SOP_DUPLEX');
  const qrReady = records.every(record => !printItem(record, 'TRAVELER') || Boolean(qrImages[record.printId]));
  const sopReady = records.every(record => !printItem(record, 'SOP') || Boolean(sopPages[record.printId]?.length));
  const ready = qrReady && sopReady && !loadError && !sopLoadError;
  const allConfirmed = records.every(record => record.items.every(item => confirmedItems.has(itemKey(record.printId, item.material))));

  useEffect(() => {
    let cancelled = false;
    setLoadError('');
    setSopLoadError('');
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

    const sopRecords = records.filter(record => printItem(record, 'SOP'));
    if (sopRecords.length) {
      void Promise.all(sopRecords.map(async record => [record.printId, await renderSopPages(record.printId)] as const))
        .then(entries => { if (!cancelled) setSopPages(Object.fromEntries(entries)); })
        .catch(reason => { if (!cancelled) setSopLoadError(reason instanceof Error ? reason.message : 'SOP 加载失败'); });
    }
    return () => { cancelled = true; };
  }, [originKey, records]);

  useEffect(() => {
    const onAfterPrint = () => {
      const materials: PrintMaterial[] = printTarget === 'all'
        ? (['TRAVELER', 'SOP'] as PrintMaterial[]).filter(material => records.some(record => printItem(record, material)))
        : [printTarget === 'traveler' ? 'TRAVELER' : 'SOP'];
      const printIds = records.filter(record => materials.some(material => printItem(record, material))).map(record => record.printId);
      setOpenedTargets(previous => new Set([...previous, ...materials]));
      if (printIds.some(printId => materials.some(material => !confirmedItems.has(itemKey(printId, material))))) {
        setConfirmRequest({ printIds, materials });
      }
    };
    window.addEventListener('afterprint', onAfterPrint);
    return () => window.removeEventListener('afterprint', onAfterPrint);
  }, [confirmedItems, printTarget, records]);

  function startPrint(target: PrintTarget) {
    const targetReady = target === 'traveler' ? qrReady : target === 'sop' ? sopReady : ready;
    if (!targetReady) return;
    setPrintTarget(target);
    window.setTimeout(() => window.print(), 80);
  }

  function openDrawing(record: WorkOrderTravelerPrintRecord) {
    window.open(`/api/work-order-qr/prints/${encodeURIComponent(record.printId)}/drawing`, '_blank', 'noopener,noreferrer');
    setOpenedDrawings(previous => new Set(previous).add(record.printId));
  }

  function openSop(record: WorkOrderTravelerPrintRecord) {
    window.open(`/api/work-order-qr/prints/${encodeURIComponent(record.printId)}/sop`, '_blank', 'noopener,noreferrer');
    setOpenedSops(previous => new Set(previous).add(record.printId));
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

  function travelerSheet(record: WorkOrderTravelerPrintRecord, copyIndex: number) {
    const snapshot = record.snapshot;
    return <article className={`traveler-sheet traveler-print-kind-traveler${snapshot.steps.length > 18 ? ' dense' : ''}`} key={`${record.printId}-${copyIndex}-traveler`}>
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
          ? <>{/* eslint-disable-next-line @next/next/no-img-element */}<img src={qrImages[record.printId]} alt={`${snapshot.workOrderCode}现场报工二维码`} /></>
          : <span><LoaderCircle className="spin" size={28} />生成中</span>}<strong>手机扫码报工</strong><small>短码 {record.shortCode}</small></div>
      </section>
      <section className="traveler-route-title"><span>工艺路线</span><strong>共 {snapshot.steps.length} 道工序</strong><small>扫码可单选或批量报工</small></section>
      <table className="traveler-process-table"><thead><tr><th>序号</th><th>工序名称</th><th>顺序组</th><th>标准工时</th><th>首件确认</th><th>数量</th><th>日期 / 确认</th></tr></thead><tbody>{snapshot.steps.map(step => <tr key={step.id}><td>{String(step.position).padStart(2, '0')}</td><td><strong>{step.processName}</strong></td><td>{step.sequenceGroup}</td><td>{standardTimeText(step.standardMillisecondsPerUnit, step.timeBasis, step.unitsPerProduct)}</td><td><span className="traveler-first-piece-box" aria-label="首件确认方框" /></td><td /><td /></tr>)}</tbody></table>
      <footer className="traveler-sheet-foot"><div><span>质量异常</span><b /></div><div><span>最终包装</span><b /></div><p>二维码仅用于定位工单，提交报工前必须使用员工编号登录并核对姓名。纸面版本与系统不一致时，以手机端最新工艺为准并重新打印。</p></footer>
    </article>;
  }

  const printablePages = records.flatMap(record => {
    const packet: React.ReactElement[] = [];
    const traveler = printItem(record, 'TRAVELER');
    const sop = printItem(record, 'SOP');
    const pages = sopPages[record.printId] || [];
    if (duplexTravelerSop && traveler && sop) {
      for (let copyIndex = 0; copyIndex < traveler.copies; copyIndex += 1) {
        packet.push(travelerSheet(record, copyIndex));
        pages.forEach((src, pageIndex) => packet.push(<article className="traveler-sop-sheet traveler-print-kind-sop" key={`${record.printId}-${copyIndex}-sop-${pageIndex}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}<img src={src} alt={`${record.snapshot.specification || record.snapshot.productName} SOP 第 ${pageIndex + 1} 页`} />
        </article>));
        if ((1 + pages.length) % 2 === 1) packet.push(<article className="traveler-blank-page traveler-print-kind-sop" aria-label="双面打印补白页" key={`${record.printId}-${copyIndex}-blank`}><span>双面打印补白页</span></article>);
      }
      return packet;
    }
    if (traveler) {
      for (let copyIndex = 0; copyIndex < traveler.copies; copyIndex += 1) packet.push(travelerSheet(record, copyIndex));
    }
    if (sop) {
      for (let copyIndex = 0; copyIndex < sop.copies; copyIndex += 1) pages.forEach((src, pageIndex) => packet.push(<article className="traveler-sop-sheet traveler-print-kind-sop" key={`${record.printId}-${copyIndex}-sop-${pageIndex}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}<img src={src} alt={`${record.snapshot.specification || record.snapshot.productName} SOP 第 ${pageIndex + 1} 页`} />
      </article>));
    }
    return packet;
  });

  const confirmLabels = confirmRequest?.materials.map(materialText).join('、') || '';

  return <main className="traveler-print-screen" data-print-target={printTarget}>
    <header className="traveler-print-toolbar">
      <a href="/production"><ArrowLeft size={18} />返回生产执行</a>
      <div><strong>生产资料打印</strong><span>{records.length} 张工单 · {modeText(records[0]?.mode || 'TRAVELER_ONLY')}</span></div>
      <div className="traveler-print-toolbar-actions">
        {duplexTravelerSop && includesTraveler && includesSop && !sopLoadError
          ? <button type="button" disabled={!ready} onClick={() => startPrint('all')}>{ready ? <Printer size={18} /> : <LoaderCircle className="spin" size={18} />}{openedTargets.has('TRAVELER') ? '重新打印流转单 + SOP' : '打印流转单 + SOP'}</button>
          : <>{includesTraveler && <button type="button" disabled={!qrReady} onClick={() => startPrint('traveler')}><Printer size={18} />{openedTargets.has('TRAVELER') ? '重新打印流转单' : '打印流转单'}</button>}{includesSop && !sopLoadError && <button type="button" disabled={!sopReady} onClick={() => startPrint('sop')}><FileText size={18} />{openedTargets.has('SOP') ? '重新打印 SOP' : '打印 SOP'}</button>}</>}
        {allConfirmed && <span className="traveler-print-confirmed"><CheckCircle2 size={17} />全部资料已确认</span>}
      </div>
    </header>
    {duplexTravelerSop && !sopLoadError && <div className="traveler-print-instruction"><FileText size={18} />流转单与 SOP 已连续排版；请在打印机对话框中选择“双面打印 / 长边翻转”。原图仍按源 PDF 单独打印。</div>}
    {loadError && <div className="traveler-print-warning">资料加载失败：{loadError}</div>}
    {includesDrawing && <section className="traveler-drawing-jobs" aria-label="原图打印清单">
      <header><span><FileImage size={19} /><strong>原图打印清单</strong><small>每张工单独立打开源 PDF，打印机按 PDF 自带的 A3/A4 页面尺寸输出。</small></span><em>{records.filter(record => printItem(record, 'DRAWING')).length} 项</em></header>
      <div>{records.filter(record => printItem(record, 'DRAWING')).map(record => {
        const drawing = printItem(record, 'DRAWING')!;
        const confirmed = confirmedItems.has(itemKey(record.printId, 'DRAWING'));
        return <article key={record.printId}><span><strong>{record.snapshot.specification || record.snapshot.productName}</strong><small>{drawing.fileName || '原图 PDF'} · {drawing.copies} 份</small></span><b className={confirmed ? 'confirmed' : openedDrawings.has(record.printId) ? 'opened' : ''}>{confirmed ? '已打印' : openedDrawings.has(record.printId) ? '待确认' : '未打开'}</b><button type="button" onClick={() => openDrawing(record)}><ExternalLink size={15} />{openedDrawings.has(record.printId) ? '重新打开原图' : '打开原图'}</button>{!confirmed && <button className="confirm" type="button" disabled={!openedDrawings.has(record.printId)} onClick={() => setConfirmRequest({ printIds: [record.printId], materials: ['DRAWING'] })}><FileCheck2 size={15} />确认已打印</button>}</article>;
      })}</div>
    </section>}
    {includesSop && sopLoadError && <section className="traveler-drawing-jobs traveler-sop-fallback" aria-label="SOP 原文件打印清单">
      <header><span><FileText size={19} /><strong>SOP 原文件打印</strong><small>当前浏览器无法合并 SOP 预览，已切换为源 PDF 打印；不会影响文件内容与打印确认。</small></span><em>{records.filter(record => printItem(record, 'SOP')).length} 项</em></header>
      <div>{records.filter(record => printItem(record, 'SOP')).map(record => {
        const sop = printItem(record, 'SOP')!;
        const confirmed = confirmedItems.has(itemKey(record.printId, 'SOP'));
        return <article key={record.printId}><span><strong>{record.snapshot.specification || record.snapshot.productName}</strong><small>{sop.fileName || 'SOP PDF'} · {sop.copies} 份</small></span><b className={confirmed ? 'confirmed' : openedSops.has(record.printId) ? 'opened' : ''}>{confirmed ? '已打印' : openedSops.has(record.printId) ? '待确认' : '未打开'}</b><button type="button" onClick={() => openSop(record)}><ExternalLink size={15} />{openedSops.has(record.printId) ? '重新打开 SOP' : '打开 SOP'}</button>{!confirmed && <button className="confirm" type="button" disabled={!openedSops.has(record.printId)} onClick={() => setConfirmRequest({ printIds: [record.printId], materials: ['SOP'] })}><FileCheck2 size={15} />确认已打印</button>}</article>;
      })}</div>
      <p className="traveler-sop-fallback-note">原因：{sopLoadError}。若需流转单与 SOP 双面合并，请改用支持 PDF.js 的桌面浏览器重试。</p>
    </section>}
    {printablePages.length > 0 ? <section className="traveler-print-pages" aria-label="待打印生产资料">{printablePages}</section> : <section className="traveler-print-external-only"><FileImage size={34} /><strong>当前任务仅包含原图</strong><span>请在上方清单逐张打开源 PDF 打印并确认。</span></section>}
    {confirmRequest && <div className="traveler-print-confirm-backdrop" role="presentation"><section role="dialog" aria-modal="true" aria-labelledby="traveler-print-confirm-title">
      <button className="close" type="button" aria-label="关闭" disabled={confirming} onClick={() => setConfirmRequest(null)}><X size={19} /></button>
      <FileCheck2 size={34} /><span>实体打印确认</span><h2 id="traveler-print-confirm-title">{confirmLabels}已经打印完成吗？</h2>
      <p>只有在纸张已从打印机输出并核对无误后再确认。关闭预览、取消打印或纸张异常时不要确认。</p>
      {confirmError && <div>{confirmError}</div>}
      <footer><button type="button" disabled={confirming} onClick={() => setConfirmRequest(null)}>尚未完成</button><button className="primary" type="button" disabled={confirming} onClick={() => { void confirmPrinted(); }}>{confirming ? '确认中...' : `确认 ${confirmLabels} 已打印`}</button></footer>
    </section></div>}
  </main>;
}
