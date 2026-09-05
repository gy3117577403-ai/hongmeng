import Link from 'next/link';
import { ArrowUpRight, ClipboardCheck, ScanLine, Wrench } from 'lucide-react';
export default function QualityScanEntry({code,name}:{code:string;name:string}) {
  return <main className="qd-scan-entry"><header><span className="qd-scan-mark"><ScanLine size={24}/></span><div><b>工单现场操作</b><small>{name} · 已登录</small></div></header><div className="qd-scan-welcome"><small>选择本次操作</small><h1>报工与检验，一码进入</h1><p>两个入口使用当前工单，进入后仍可切换。</p></div><Link className="qd-entry-card" href={'/field-report/'+encodeURIComponent(code)+'?mode=report'}><Wrench size={30}/><div><h2>生产报工</h2><p>登记工序进度、数量与工时</p></div><ArrowUpRight size={22}/></Link><Link className="qd-entry-card quality" href={'/quality-capture/'+encodeURIComponent(code)}><ClipboardCheck size={30}/><div><h2>质量登记</h2><p>压检、拉力、成品、首检与巡检</p></div><ArrowUpRight size={22}/></Link><p className="qd-scan-foot">检验记录随订单批次归档</p></main>;
}
