import Link from 'next/link';
import { ClipboardCheck, Wrench } from 'lucide-react';
import './quality-scan.css';
export default function QualityScanTabs({ code, active, canReport = true }: { code: string; active: 'report' | 'quality'; canReport?: boolean }) {
  return <nav className="qd-scan-tabs" aria-label="工单扫码功能">
    {canReport && <Link href={'/field-report/'+encodeURIComponent(code)+'?mode=report'} aria-current={active==='report'?'page':undefined}><Wrench size={17}/>生产报工</Link>}
    <Link href={'/quality-capture/'+encodeURIComponent(code)} aria-current={active==='quality'?'page':undefined}><ClipboardCheck size={17}/>质量登记</Link>
  </nav>;
}
