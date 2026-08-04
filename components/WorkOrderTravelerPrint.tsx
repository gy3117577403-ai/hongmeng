'use client';

import { ArrowLeft, LoaderCircle, Printer } from 'lucide-react';
import QRCode from 'qrcode';
import { useEffect, useMemo, useState } from 'react';
import type { WorkOrderTravelerPrintRecord } from '@/lib/work-order-qr-service';

function dateTimeText(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('zh-CN', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
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

export default function WorkOrderTravelerPrint({ records }: { records: WorkOrderTravelerPrintRecord[] }) {
  const [qrImages, setQrImages] = useState<Record<string, string>>({});
  const [qrError, setQrError] = useState('');
  const ready = records.every(record => Boolean(qrImages[record.printId]));
  const originKey = useMemo(() => records.map(record => record.printId).join('|'), [records]);

  useEffect(() => {
    let cancelled = false;
    setQrError('');
    void Promise.all(records.map(async record => {
      const link = `${window.location.origin}/field-report/${encodeURIComponent(record.publicCode)}`;
      const dataUrl = await QRCode.toDataURL(link, {
        errorCorrectionLevel: 'M',
        margin: 1,
        width: 520,
        color: { dark: '#111827', light: '#ffffff' },
      });
      return [record.printId, dataUrl] as const;
    })).then(entries => {
      if (!cancelled) setQrImages(Object.fromEntries(entries));
    }).catch(reason => {
      if (!cancelled) setQrError(reason instanceof Error ? reason.message : '二维码生成失败');
    });
    return () => { cancelled = true; };
  }, [originKey, records]);

  return <main className="traveler-print-screen">
    <header className="traveler-print-toolbar">
      <a href="/production"><ArrowLeft size={18} />返回生产执行</a>
      <div><strong>工单现场流转单</strong><span>{records.length} 张 · 一工单一码</span></div>
      <button type="button" disabled={!ready} onClick={() => window.print()}>
        {ready ? <Printer size={18} /> : <LoaderCircle className="spin" size={18} />}
        {ready ? '打印全部' : '正在生成二维码'}
      </button>
    </header>
    {qrError && <div className="traveler-print-warning">二维码生成失败：{qrError}</div>}
    <section className="traveler-print-pages" aria-label="待打印工单流转单">
      {records.map(record => {
        const snapshot = record.snapshot;
        return <article className={`traveler-sheet${snapshot.steps.length > 18 ? ' dense' : ''}`} key={record.printId}>
          <header className="traveler-sheet-head">
            <div className="traveler-brand"><b>杭</b><span><strong>杭连电子生产流转单</strong><small>扫码报工 · 整单随单流转</small></span></div>
            <div className="traveler-version"><span>工艺版本</span><strong>V{snapshot.routeVersion}</strong><small>{dateTimeText(record.printedAt)}</small></div>
          </header>
          <section className="traveler-order-grid">
            <div className="traveler-order-main">
              <span>产品 / 规格</span>
              <strong>{snapshot.specification || snapshot.productName}</strong>
              <small>{snapshot.customerName || '客户待维护'} · {snapshot.productName}</small>
              <dl>
                <div className="traveler-business-code"><dt>内部工单</dt><dd>{snapshot.businessWorkOrderCode || '待生成'}</dd></div>
                <div><dt>生产数量</dt><dd>{snapshot.targetQty.toLocaleString()} {snapshot.unitLabel}</dd></div>
                <div><dt>计划交期</dt><dd>{deliveryText(snapshot.deliveryDay)}</dd></div>
              </dl>
            </div>
            <div className="traveler-qr">
              {qrImages[record.printId]
                ? <>{/* A data-URL QR must print at its exact intrinsic pixels. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={qrImages[record.printId]} alt={`${snapshot.workOrderCode}现场报工二维码`} /></>
                : <span><LoaderCircle className="spin" size={28} />生成中</span>}
              <strong>手机扫码报工</strong>
              <small>短码 {record.shortCode}</small>
            </div>
          </section>
          <section className="traveler-route-title"><span>工艺路线</span><strong>共 {snapshot.steps.length} 道工序</strong><small>扫码可单选或批量报工</small></section>
          <table className="traveler-process-table">
            <thead><tr><th>序号</th><th>工序名称</th><th>顺序组</th><th>标准工时</th><th>首件确认</th><th>数量</th><th>日期 / 确认</th></tr></thead>
            <tbody>{snapshot.steps.map(step => <tr key={step.id}>
              <td>{String(step.position).padStart(2, '0')}</td>
              <td><strong>{step.processName}</strong></td>
              <td>{step.sequenceGroup}</td>
              <td>{standardTimeText(step.standardMillisecondsPerUnit, step.timeBasis, step.unitsPerProduct)}</td>
              <td><span className="traveler-first-piece-box" aria-label="首件确认方框" /></td>
              <td />
              <td />
            </tr>)}</tbody>
          </table>
          <footer className="traveler-sheet-foot">
            <div><span>质量异常</span><b /></div><div><span>最终包装</span><b /></div>
            <p>二维码仅用于定位工单，提交报工前必须使用员工编号登录并核对姓名。纸面版本与系统不一致时，以手机端最新工艺为准并重新打印。</p>
          </footer>
        </article>;
      })}
    </section>
  </main>;
}
