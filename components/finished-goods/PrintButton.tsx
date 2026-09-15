'use client';
export default function PrintButton() { return <button type="button" className="fg-print-button" onClick={() => window.print()}>打印 / 保存 PDF</button>; }
