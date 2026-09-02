import React from 'react';
import Image from 'next/image';
import type { SamplePrintDocument, SamplePrintSection } from '@/lib/sample-task-print';

function sectionTable(section: SamplePrintSection) {
  return <section className={`sample-print-section sample-print-${section.kind.toLowerCase()}`} key={section.kind}>
    <h2>{section.title}</h2>
    <table>
      <thead><tr><th className="sequence">序号</th>{section.columns.map(column => <th key={column}>{column}</th>)}<th className="review-state">状态</th></tr></thead>
      <tbody>{section.rows.map((row, index) => <tr className={row.blank ? 'blank' : ''} key={row.id}>
        <td className="sequence">{section.startAt + index}</td>
        {row.cells.map((cell, cellIndex) => <td key={`${row.id}-${cellIndex}`}>{cell}</td>)}
        <td className="review-state">{row.status}</td>
      </tr>)}</tbody>
    </table>
  </section>;
}

function taskHeader(document: SamplePrintDocument, qrDataUrl: string, compact = false) {
  const { task } = document;
  if (compact) return <header className="sample-print-continuation-header">
    <div><span>样品资料采集单 · 续页</span><strong>{task.code}</strong><small>{task.specification} · {task.customerName}</small></div>
    <div><span>文件状态</span><strong>{document.stateLabel}</strong><small>模板 {document.templateVersion}</small></div>
  </header>;
  return <>
    <header className="sample-print-document-header">
      <div className="sample-print-brand"><span>生产计划 / 样品资料</span><h1>样品资料采集单</h1><p>STANDARD SAMPLE DATA COLLECTION SHEET</p></div>
      <div className="sample-print-document-code"><span>任务编号</span><strong>{task.code}</strong><em>{document.stateLabel}</em></div>
      <figure><Image unoptimized priority width={1024} height={1024} src={qrDataUrl} alt={`${task.code} 登录后扫码采集二维码`} /><figcaption><strong>登录后扫码继续采集</strong><span>二维码仅包含任务采集地址</span></figcaption></figure>
    </header>
    <dl className="sample-print-facts">
      <div><dt>客户</dt><dd>{task.customerName || '—'}</dd></div>
      <div><dt>产品名称</dt><dd>{task.productName}</dd></div>
      <div className="model"><dt>型号 / 规格</dt><dd>{task.specification || '—'}</dd></div>
      <div><dt>客户等级</dt><dd>{task.customerLevel}</dd></div>
      <div><dt>样品数量</dt><dd>{task.sampleQuantity}</dd></div>
      <div><dt>计划日期</dt><dd>{task.dueDate}</dd></div>
    </dl>
  </>;
}

export default function SampleTaskPrintSheet({
  document,
  qrDataUrl,
}: {
  document: SamplePrintDocument;
  qrDataUrl: string;
}) {
  return <section className="sample-print-stage" aria-label={`${document.task.code} 打印预览`}>
    {document.pages.map((page, pageIndex) => <article className={`sample-print-paper ${page.continuation ? 'continuation' : 'first'}`} key={`${document.task.code}-${pageIndex}`}>
      {document.task.cancelled && <div className="sample-print-watermark" aria-hidden="true">已取消</div>}
      {taskHeader(document, qrDataUrl, page.continuation)}
      <div className="sample-print-sections">{page.sections.map(section => sectionTable(section))}</div>
      <footer><span>模板版本 {document.templateVersion} · {document.sourceLabel}</span><span>打印人：{document.printedBy} · 打印时间：{document.printedAt}</span><strong>第 {pageIndex + 1} / {document.pages.length} 页</strong></footer>
    </article>)}
  </section>;
}
