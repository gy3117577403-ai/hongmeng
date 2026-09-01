'use client';

import { ArrowLeft, FilePenLine, Printer } from 'lucide-react';
import Link from 'next/link';
import type { SamplePrintMode } from '@/lib/sample-task-print';

export default function SampleTaskPrintToolbar({
  backHref,
  currentHref,
  blankHref,
  mode,
  taskCode,
  pageCount,
}: {
  backHref: string;
  currentHref: string;
  blankHref: string;
  mode: SamplePrintMode;
  taskCode: string;
  pageCount: number;
}) {
  return <header className="sample-print-toolbar" data-print-hidden>
    <Link href={backHref}><ArrowLeft size={17} aria-hidden="true" />返回样品计划</Link>
    <div>
      <span>样品工艺采集单</span>
      <strong>{taskCode}</strong>
      <small>预计 {pageCount} 页 A4 · 打印前请核对纸张为 100%</small>
    </div>
    <nav aria-label="打印内容模式">
      <Link className={mode === 'current' ? 'active' : ''} aria-current={mode === 'current' ? 'page' : undefined} href={currentHref}><FilePenLine size={15} aria-hidden="true" />当前内容</Link>
      <Link className={mode === 'blank' ? 'active' : ''} aria-current={mode === 'blank' ? 'page' : undefined} href={blankHref}>空白模板</Link>
      <button type="button" onClick={() => window.print()}><Printer size={17} aria-hidden="true" />打印</button>
    </nav>
  </header>;
}
