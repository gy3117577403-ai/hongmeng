'use client';

/* eslint-disable @next/next/no-img-element */

import { ShieldAlert } from 'lucide-react';
import type { Ref } from 'react';
import type { WorkOrderQualityWarningSnapshot } from '@/lib/work-order-qr-service';

export type QualityWarningSheetOrder = {
  workOrderCode: string;
  businessWorkOrderCode?: string | null;
  productName: string;
  specification?: string | null;
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

function warningLines(value?: string | null): string[] {
  return String(value || '').split(/\r?\n|[；;]/).map(item => item.replace(/^\s*[\d一二三四五六七八九十]+[.、)）]\s*/, '').trim()).filter(Boolean).slice(0, 6);
}

export function QualityWarningPrintSheet({
  order,
  warning,
  qrImage,
  pageNumber,
  totalPages,
  previewState = 'ARCHIVED',
  sheetRef,
  sourceKey,
}: {
  order: QualityWarningSheetOrder;
  warning: WorkOrderQualityWarningSnapshot;
  qrImage?: string;
  pageNumber: number;
  totalPages: number;
  previewState?: 'DRAFT' | 'ARCHIVED';
  sheetRef?: Ref<HTMLElement>;
  sourceKey?: string;
}) {
  const actions = warningLines(warning.requiredAction);
  const photos = warning.attachments.filter(item => item.mimeType.startsWith('image/')).slice(0, 3);
  return <article className={`quality-warning-sheet${previewState === 'DRAFT' ? ' draft-preview' : ''}`} ref={sheetRef} data-warning-source={sourceKey}>
    {previewState === 'DRAFT' && <div className="quality-warning-preview-watermark" aria-hidden="true">预览 · 未归档 · 不可用于生产</div>}
    <header className="quality-warning-print-head">
      <div><ShieldAlert /><span><strong>产品质量异常作业警示单</strong><small>归档异常自动同步 · 随工单执行并留存</small></span></div>
      <em>R{warning.revisionNumber} · {warning.printPolicy === 'REQUIRED' ? '必须随单打印' : warning.printPolicy === 'SYSTEM_ONLY' ? '仅系统警示' : '可选附页'}</em>
    </header>
    <section className="quality-warning-meta">
      <div className="wide"><span>异常标题</span><strong>{warning.title}</strong></div>
      <div><span>异常编号</span><strong>{warning.reportNo}</strong></div>
      <div><span>风险等级</span><strong className={`risk-${warning.severity.toLowerCase()}`}>{warning.severity === 'CRITICAL' ? '重大' : warning.severity === 'HIGH' ? '高' : warning.severity === 'MEDIUM' ? '中' : '低'}</strong></div>
      <div className="wide"><span>产品</span><strong>{order.specification || order.productName}</strong></div>
      <div><span>关联工单</span><strong>{order.businessWorkOrderCode || order.workOrderCode}</strong></div>
      <div><span>{previewState === 'DRAFT' ? '预计归档' : '归档时间'}</span><strong>{dateTimeText(warning.archivedAt)}</strong></div>
    </section>
    <section className="quality-warning-analysis">
      <div><h3>异常现象与风险</h3><p>{warning.warningSummary || warning.defectPhenomenon || '见异常归档记录'}</p><small><b>确认根因：</b>{warning.rootCause || '本项选填 / 见归档分析'}</small></div>
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
      <div className="quality-warning-qr">{qrImage ? <img src={qrImage} alt="异常归档二维码" /> : <span>二维码生成中</span>}</div>
      <div><h3>扫码查看完整异常归档</h3><p>原因、措施、证据图片、版本历史与关联产品均以系统归档版本为准。</p><small>适用工序：{warning.applicableProcess || '全部相关工序'} · 升级联系人：{warning.escalationContact || '质量部'}</small></div>
    </section>
    <section className="quality-warning-signatures">
      {['工艺确认', '质量确认', '生产确认', '操作员确认'].map(label => <div key={label}><strong>{label}</strong><span>姓名：</span><span>签字：</span><span>日期：</span></div>)}
    </section>
    <footer><span>警示快照 {warning.reportNo}-R{warning.revisionNumber}</span><strong>{previewState === 'DRAFT' ? '归档前预览，不得下发' : '请随工单一同下发与归档'}</strong><small>第 {pageNumber} / {totalPages} 张警示附页</small></footer>
  </article>;
}
