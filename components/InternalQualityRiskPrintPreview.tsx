'use client';

import { AlertTriangle, ArrowLeft, CheckCircle2, Printer, ShieldAlert } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import QRCode from 'qrcode';
import { useEffect, useRef, useState } from 'react';
import { QualityWarningPrintSheet } from '@/components/QualityWarningPrintSheet';
import { buildQualityWarningPages } from '@/lib/quality-warning-print-layout';
import type { InternalQualityRiskPrintPreviewDTO } from '@/types';

export default function InternalQualityRiskPrintPreview({ preview }: { preview: InternalQualityRiskPrintPreviewDTO }) {
  const router = useRouter();
  const [qrImage, setQrImage] = useState('');
  const [qrError, setQrError] = useState('');
  const stageRef = useRef<HTMLElement>(null);
  const [imagesReady, setImagesReady] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [layout, setLayout] = useState(preview.warning.printPhotoLayout || 'PAIR');
  const warning = { ...preview.warning, printPhotoLayout: layout };
  const pages = buildQualityWarningPages(warning);

  useEffect(() => {
    const images = Array.from(stageRef.current?.querySelectorAll('img') || []);
    const check = () => { setImagesReady(images.every(image => image.complete && image.naturalWidth > 0)); setImageError(images.some(image => image.complete && !image.naturalWidth)); };
    images.forEach(image => { image.addEventListener('load', check); image.addEventListener('error', check); }); check();
    return () => images.forEach(image => { image.removeEventListener('load', check); image.removeEventListener('error', check); });
  }, [preview, qrImage, layout]);

  useEffect(() => {
    let cancelled = false;
    if (preview.previewState !== 'ARCHIVED' || !preview.warning.employeePath) { setQrImage(''); return; }
    const link = `${window.location.origin}${preview.warning.employeePath}`;
    void QRCode.toDataURL(link, { errorCorrectionLevel: 'M', margin: 1, width: 420, color: { dark: '#111827', light: '#ffffff' } })
      .then(value => { if (!cancelled) setQrImage(value); })
      .catch(error => { if (!cancelled) setQrError(error instanceof Error ? error.message : '二维码生成失败'); });
    return () => { cancelled = true; };
  }, [preview.warning.employeePath, preview.previewState]);

  return <main className="risk-print-preview-screen">
    <header className="risk-print-preview-toolbar">
      <Link href={`/workspace/quality/internal-risks?reportId=${encodeURIComponent(preview.warning.reportId)}`}><ArrowLeft size={17} />返回异常工作台</Link>
      <div><span>工单异常警示附页</span><strong>{preview.warning.reportNo} · R{preview.warning.revisionNumber}</strong><small>与正式工单打印共用同一页面组件</small></div>
      <nav>{preview.orders.length > 0 && <label>模拟工单<select aria-label="选择预览工单" value={preview.order.id || ''} onChange={event => router.replace(`/workspace/quality/internal-risks/${encodeURIComponent(preview.warning.reportId)}/print-preview?workOrderId=${encodeURIComponent(event.target.value)}`)}>{preview.orders.map(order => <option key={order.id} value={order.id}>{order.label} · {order.productLabel}</option>)}</select></label>}<button type="button" disabled={!imagesReady || (Boolean(preview.warning.employeePath) && !qrImage)} onClick={() => window.print()}><Printer size={16} />浏览器打印预览</button></nav>
    </header>
    <section className={`risk-print-preview-notice ${preview.previewState === 'ARCHIVED' ? 'archived' : 'draft'}`}>
      {preview.previewState === 'ARCHIVED' ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
      <span><strong>{preview.previewState === 'ARCHIVED' ? '当前显示已归档版本，可核对正式附页内容' : '当前为归档前预览，不会发布警示或写入工单'}</strong><small>{preview.previewState === 'DRAFT' ? `还有 ${preview.readiness.blockers.length} 个归档阻断项；预览页保留明显水印，不能作为生产文件。` : '归档快照不可被后续草稿直接覆盖。'}{qrError ? ` · ${qrError}` : ''}{imageError ? ' · 图片读取失败，请刷新重试后打印' : !imagesReady ? ' · 正在等待完整图片' : ''}</small></span>
      <em><ShieldAlert size={14} />{preview.order.businessWorkOrderCode || preview.order.workOrderCode}</em>
    </section>
    <section className="risk-print-layout-options"><label>排版试览 <select aria-label="图片排版试览" value={layout} onChange={event => setLayout(event.target.value as 'PAIR' | 'SINGLE')}><option value="PAIR">自动省纸 · 保持原图比例</option><option value="SINGLE">大图细节 · 按需续页</option></select></label><strong>预计 {pages.length} 页 A4</strong><span>不裁切、不拉伸；同组两图保持并排。{layout !== preview.warning.printPhotoLayout ? '当前为试览，正式随单打印仍使用归档图片设置。' : '正式随单打印使用相同排版规则。'}</span></section>
    <section ref={stageRef} className="risk-print-preview-stage">{pages.map((page, index) => <div className="risk-print-preview-paper" key={index}><QualityWarningPrintSheet page={page} order={preview.order} warning={warning} qrImage={qrImage} pageNumber={index + 1} totalPages={pages.length} previewState={preview.previewState} /></div>)}</section>
  </main>;
}
