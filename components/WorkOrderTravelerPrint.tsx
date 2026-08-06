'use client';

import { ArrowLeft, CheckCircle2, FileCheck2, FileText, LoaderCircle, Printer, X } from 'lucide-react';
import QRCode from 'qrcode';
import { useEffect, useMemo, useState } from 'react';
import type { WorkOrderTravelerPrintRecord } from '@/lib/work-order-qr-service';

type PrintTarget = 'all' | 'traveler' | 'sop';

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
  return '仅流转单';
}

async function renderSopPages(printId: string): Promise<string[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = '/api/pdf-worker';
  const loadingTask = pdfjs.getDocument({
    url: `/api/work-order-qr/prints/${encodeURIComponent(printId)}/sop`,
    withCredentials: true,
    useWorkerFetch: false,
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
  const [printTarget, setPrintTarget] = useState<PrintTarget>('all');
  const [completedPrintTargets, setCompletedPrintTargets] = useState<Set<PrintTarget>>(() => new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState('');
  const [confirmedIds, setConfirmedIds] = useState(() => new Set(records.filter(record => record.status === 'CONFIRMED').map(record => record.printId)));
  const originKey = useMemo(() => records.map(record => `${record.printId}:${record.mode}`).join('|'), [records]);
  const includesSop = records.some(record => record.mode !== 'TRAVELER_ONLY');
  const separateMode = records.every(record => record.mode === 'TRAVELER_SOP_SEPARATE');
  const separatePrintReady = !separateMode
    || (completedPrintTargets.has('traveler') && completedPrintTargets.has('sop'));
  const pendingPrintIds = records.filter(record => !confirmedIds.has(record.printId)).map(record => record.printId);
  const qrReady = records.every(record => Boolean(qrImages[record.printId]));
  const sopReady = records.every(record => record.mode === 'TRAVELER_ONLY' || Boolean(sopPages[record.printId]?.length));
  const ready = qrReady && sopReady && !loadError;

  useEffect(() => {
    let cancelled = false;
    setLoadError('');
    void Promise.all(records.map(async record => {
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

    const sopRecords = records.filter(record => record.mode !== 'TRAVELER_ONLY');
    if (sopRecords.length) {
      void Promise.all(sopRecords.map(async record => [record.printId, await renderSopPages(record.printId)] as const))
        .then(entries => { if (!cancelled) setSopPages(Object.fromEntries(entries)); })
        .catch(reason => { if (!cancelled) setLoadError(reason instanceof Error ? reason.message : 'SOP 加载失败'); });
    }
    return () => { cancelled = true; };
  }, [originKey, records]);

  useEffect(() => {
    const onAfterPrint = () => {
      if (!pendingPrintIds.length) return;
      if (!separateMode) {
        setConfirmOpen(true);
        return;
      }
      if (printTarget !== 'traveler' && printTarget !== 'sop') return;
      setCompletedPrintTargets(previous => {
        const next = new Set(previous).add(printTarget);
        if (next.has('traveler') && next.has('sop')) setConfirmOpen(true);
        return next;
      });
    };
    window.addEventListener('afterprint', onAfterPrint);
    return () => window.removeEventListener('afterprint', onAfterPrint);
  }, [pendingPrintIds.length, printTarget, separateMode]);

  function startPrint(target: PrintTarget) {
    if (!ready) return;
    setPrintTarget(target);
    window.setTimeout(() => window.print(), 80);
  }

  async function confirmPrinted() {
    if (!pendingPrintIds.length || confirming || !separatePrintReady) return;
    setConfirming(true);
    setConfirmError('');
    try {
      const response = await fetch('/api/work-order-qr/prints/confirm', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ printIds: pendingPrintIds }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || '打印确认失败');
      setConfirmedIds(previous => new Set([...previous, ...pendingPrintIds]));
      setConfirmOpen(false);
    } catch (reason) {
      setConfirmError(reason instanceof Error ? reason.message : '打印确认失败');
    } finally {
      setConfirming(false);
    }
  }

  return <main className="traveler-print-screen" data-print-target={printTarget}>
    <header className="traveler-print-toolbar">
      <a href="/production"><ArrowLeft size={18} />返回生产执行</a>
      <div><strong>生产流转单打印</strong><span>{records.length} 张工单 · {modeText(records[0]?.mode || 'TRAVELER_ONLY')}</span></div>
      <div className="traveler-print-toolbar-actions">
        {separateMode ? <><button type="button" disabled={!ready} onClick={() => startPrint('traveler')}><Printer size={18} />{completedPrintTargets.has('traveler') ? '流转单已打开' : '打印流转单'}</button><button type="button" disabled={!ready} onClick={() => startPrint('sop')}><FileText size={18} />{completedPrintTargets.has('sop') ? 'SOP 已打开' : '打印 SOP'}</button></> : <button type="button" disabled={!ready} onClick={() => startPrint('all')}>
          {ready ? <Printer size={18} /> : <LoaderCircle className="spin" size={18} />}{ready ? '打印全部' : includesSop ? '正在加载 SOP' : '正在生成二维码'}
        </button>}
        {pendingPrintIds.length ? <button className="confirm" type="button" disabled={!separatePrintReady} title={!separatePrintReady ? '请先分别打开流转单和 SOP 的打印对话框' : undefined} onClick={() => setConfirmOpen(true)}><FileCheck2 size={18} />{separatePrintReady ? '确认已打印' : '请完成两项打印'}</button> : <span className="traveler-print-confirmed"><CheckCircle2 size={17} />已确认打印</span>}
      </div>
    </header>
    {records.some(record => record.mode === 'TRAVELER_SOP_DUPLEX') && <div className="traveler-print-instruction"><LayersText />系统已按“流转单 → SOP”排版；请在打印机对话框中选择“双面打印 / 长边翻转”。</div>}
    {loadError && <div className="traveler-print-warning">资料加载失败：{loadError}</div>}
    <section className="traveler-print-pages" aria-label="待打印工单流转单">
      {records.flatMap(record => Array.from({ length: record.copies }, (_, copyIndex) => {
        const snapshot = record.snapshot;
        const pages = sopPages[record.printId] || [];
        const packet = [<article className={`traveler-sheet traveler-print-kind-traveler${snapshot.steps.length > 18 ? ' dense' : ''}`} key={`${record.printId}-${copyIndex}-traveler`}>
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
        </article>];
        if (record.mode !== 'TRAVELER_ONLY') {
          pages.forEach((src, pageIndex) => packet.push(<article className="traveler-sop-sheet traveler-print-kind-sop" key={`${record.printId}-${copyIndex}-sop-${pageIndex}`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}<img src={src} alt={`${snapshot.specification || snapshot.productName} SOP 第 ${pageIndex + 1} 页`} />
          </article>));
          if (record.mode === 'TRAVELER_SOP_DUPLEX' && (1 + pages.length) % 2 === 1) {
            packet.push(<article className="traveler-blank-page traveler-print-kind-sop" aria-label="双面打印补白页" key={`${record.printId}-${copyIndex}-blank`}><span>双面打印补白页</span></article>);
          }
        }
        return packet;
      }))}
    </section>
    {confirmOpen && <div className="traveler-print-confirm-backdrop" role="presentation"><section role="dialog" aria-modal="true" aria-labelledby="traveler-print-confirm-title">
      <button className="close" type="button" aria-label="关闭" disabled={confirming} onClick={() => setConfirmOpen(false)}><X size={19} /></button>
      <FileCheck2 size={34} /><span>实体打印确认</span><h2 id="traveler-print-confirm-title">纸质流转单已经打印完成吗？</h2>
      <p>{separateMode ? '请确认流转单和 SOP 两项纸张均已从打印机输出并核对无误。' : '只有在纸张已从打印机输出并核对无误后再确认。关闭预览或取消打印时不要确认。'}</p>
      {confirmError && <div>{confirmError}</div>}
      <footer><button type="button" disabled={confirming} onClick={() => setConfirmOpen(false)}>尚未完成</button><button className="primary" type="button" disabled={confirming || !separatePrintReady} onClick={() => { void confirmPrinted(); }}>{confirming ? '确认中...' : `确认已打印 ${pendingPrintIds.length} 张`}</button></footer>
    </section></div>}
  </main>;
}

function LayersText() {
  return <FileText size={18} aria-hidden="true" />;
}
