'use client';

import { ArrowLeft, Printer } from 'lucide-react';

export default function SkillPrintToolbar() {
  return (
    <div className="skill-print-toolbar">
      <button type="button" onClick={() => window.history.back()}>
        <ArrowLeft />
        返回
      </button>
      <button className="primary" type="button" onClick={() => window.print()}>
        <Printer />
        打印 / 保存为 PDF
      </button>
    </div>
  );
}
