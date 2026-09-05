import Link from 'next/link';
export default function QualityScanTabs({ code, active, canReport = true }: { code: string; active: 'report' | 'quality'; canReport?: boolean }) {
  return <nav aria-label="工单扫码功能" style={{ display:'flex',gap:8,padding:'10px 16px',background:'#fff7ed',borderBottom:'1px solid #fed7aa',justifyContent:'center' }}>
    {canReport&&<Link href={'/field-report/'+encodeURIComponent(code)} aria-current={active==='report'?'page':undefined} style={{ padding:'10px 24px',borderRadius:8,background:active==='report'?'#b45309':'white',color:active==='report'?'white':'#78350f',fontWeight:700,textDecoration:'none' }}>生产报工</Link>}
    <Link href={'/quality-capture/'+encodeURIComponent(code)} aria-current={active==='quality'?'page':undefined} style={{ padding:'10px 24px',borderRadius:8,background:active==='quality'?'#b45309':'white',color:active==='quality'?'white':'#78350f',fontWeight:700,textDecoration:'none' }}>质量填报</Link>
  </nav>;
}
