'use client';
/* eslint-disable @next/next/no-img-element */
import { ShieldAlert } from 'lucide-react';
import type { Ref } from 'react';
import type { WorkOrderQualityWarningSnapshot } from '@/lib/work-order-qr-service';
import { buildQualityWarningPages, wrapQualityPrintText, type QualityPrintPage } from '@/lib/quality-warning-print-layout';

export type QualityWarningSheetOrder = { workOrderCode: string; businessWorkOrderCode?: string | null; productName: string; specification?: string | null };

export function QualityWarningPrintSheet({ order, warning, qrImage, pageNumber, totalPages, previewState = 'ARCHIVED', sheetRef, sourceKey, page }: {
  order: QualityWarningSheetOrder; warning: WorkOrderQualityWarningSnapshot; qrImage?: string;
  pageNumber: number; totalPages: number; previewState?: 'DRAFT' | 'ARCHIVED'; sheetRef?: Ref<HTMLElement>; sourceKey?: string; page?: QualityPrintPage;
}) {
  const content = page || buildQualityWarningPages(warning)[0];
  const severity = ({ CRITICAL: '重大', HIGH: '高', MEDIUM: '中', LOW: '低' } as Record<string, string>)[warning.severity] || warning.severity;
  return <article className={`quality-warning-sheet quality-warning-v2${previewState === 'DRAFT' ? ' draft-preview' : ''}`} ref={sheetRef} data-warning-source={sourceKey}>
    {previewState === 'DRAFT' && <div className="quality-warning-preview-watermark" aria-hidden="true">草稿预览 · 不可用于生产</div>}
    <header className="quality-v2-head"><div><ShieldAlert /><b>异常问题与解决方案</b></div><strong>R{warning.revisionNumber} · {severity}风险</strong></header>
    <section className="quality-v2-meta"><h1>{warning.title}</h1><div><span><b>产品</b> {order.specification || order.productName}</span><span><b>工单</b> {order.businessWorkOrderCode || order.workOrderCode}</span></div><small>{warning.reportNo} · {previewState === 'DRAFT' ? '未归档' : `归档 ${warning.archivedAt.slice(0, 10)}`}{warning.applicableProcess ? ` · ${warning.applicableProcess}` : ''}</small></section>
    <div className="quality-v2-body">{content.blocks.map((block, index) => block.kind === 'text'
      ? <section key={index} className={`quality-v2-text${block.emphasis ? ' emphasis' : ''}`}><h2>{block.title}</h2><p>{block.lines.map((line, n) => <span key={n}>{line || '\u00a0'}</span>)}</p></section>
      : <section key={index} className={`quality-v2-photos cols-${block.photos.length}`}>{block.photos.map(photo => <figure key={photo.id}><img src={photo.contentUrl} alt={photo.caption || photo.displayName} style={{ height: `${block.imageHeightMm}mm` }} /><figcaption>{wrapQualityPrintText(photo.caption || photo.displayName, block.photos.length === 1 ? 84 : 39).map((line, n) => <span key={n}>{line}</span>)}</figcaption></figure>)}</section>)}</div>
    <footer className="quality-v2-footer"><div className="quality-v2-qr">{qrImage && previewState === 'ARCHIVED' ? <img src={qrImage} alt="员工免后台登录查看本版本图文方案" /> : <span>{previewState === 'DRAFT' ? '草稿无员工码' : '未发布员工链接'}</span>}</div><div><b>扫码查看本版本完整图文</b><small>{previewState === 'DRAFT' ? '预览不能替代正式下发，禁止用于生产。' : '无需后台账号；有新版或已撤销时会明确提示。'}</small><span>现场确认：________　日期：________</span></div><strong>第 {pageNumber} / {totalPages} 页</strong></footer>
  </article>;
}
