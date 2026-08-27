'use client';

import { AlertTriangle, ArrowLeft, CheckCircle2, Printer, ShieldAlert } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { QualityWarningPrintSheet } from '@/components/QualityWarningPrintSheet';
import type { InternalQualityRiskPrintPreviewDTO } from '@/types';

export default function InternalQualityRiskPrintPreview({ preview }: { preview: InternalQualityRiskPrintPreviewDTO }) {
  const router = useRouter();
  const [qrImage, setQrImage] = useState('');
  const [qrError, setQrError] = useState('');

  useEffect(() => {
    let cancelled = false;
    const link = `${window.location.origin}/workspace/quality/internal-risks?reportId=${encodeURIComponent(preview.warning.reportId)}`;
    void QRCode.toDataURL(link, { errorCorrectionLevel: 'M', margin: 1, width: 420, color: { dark: '#111827', light: '#ffffff' } })
      .then(value => { if (!cancelled) setQrImage(value); })
      .catch(error => { if (!cancelled) setQrError(error instanceof Error ? error.message : '二维码生成失败'); });
    return () => { cancelled = true; };
  }, [preview.warning.reportId]);

  return <main className="risk-print-preview-screen">
    <header className="risk-print-preview-toolbar">
      <Link href={`/workspace/quality/internal-risks?reportId=${encodeURIComponent(preview.warning.reportId)}`}><ArrowLeft size={17} />返回异常工作台</Link>
      <div><span>工单异常警示附页</span><strong>{preview.warning.reportNo} · R{preview.warning.revisionNumber}</strong><small>与正式工单打印共用同一页面组件</small></div>
      <nav>{preview.orders.length > 0 && <label>模拟工单<select aria-label="选择预览工单" value={preview.order.id || ''} onChange={event => router.replace(`/workspace/quality/internal-risks/${encodeURIComponent(preview.warning.reportId)}/print-preview?workOrderId=${encodeURIComponent(event.target.value)}`)}>{preview.orders.map(order => <option key={order.id} value={order.id}>{order.label} · {order.productLabel}</option>)}</select></label>}<button type="button" onClick={() => window.print()}><Printer size={16} />浏览器打印预览</button></nav>
    </header>
    <section className={`risk-print-preview-notice ${preview.previewState === 'ARCHIVED' ? 'archived' : 'draft'}`}>
      {preview.previewState === 'ARCHIVED' ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
      <span><strong>{preview.previewState === 'ARCHIVED' ? '当前显示已归档版本，可核对正式附页内容' : '当前为归档前预览，不会发布警示或写入工单'}</strong><small>{preview.previewState === 'DRAFT' ? `还有 ${preview.readiness.blockers.length} 个归档阻断项；预览页保留明显水印，不能作为生产文件。` : '归档快照不可被后续草稿直接覆盖。'}{qrError ? ` · ${qrError}` : ''}</small></span>
      <em><ShieldAlert size={14} />{preview.order.businessWorkOrderCode || preview.order.workOrderCode}</em>
    </section>
    <section className="risk-print-preview-stage"><div className="risk-print-preview-paper"><QualityWarningPrintSheet order={preview.order} warning={preview.warning} qrImage={qrImage} pageNumber={1} totalPages={1} previewState={preview.previewState} /></div></section>
  </main>;
}
