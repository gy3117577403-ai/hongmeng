'use client';
import Link from 'next/link';
import { ArrowRight, Camera, CheckCircle2, ClipboardCheck, FileText, PackageCheck } from 'lucide-react';
import type { SampleTaskDTO } from '@/types';
import { sampleDocumentState, sampleKittingState } from '@/lib/sample-workbench-view';
import { sampleStamp } from './SampleBranchControls';
export default function SampleOverview({ task, onTab }: { task: SampleTaskDTO; onTab: (tab: 'documents'|'data'|'photos'|'review'|'completion'|'capture')=>void }) {
  const cancelled = task.status === 'CANCELLED', closed = ['COMPLETED','CANCELLED'].includes(task.status), pending=task.counts.pendingReview>0;
  const step=cancelled?-1:closed?3:pending?2:task.status==='IN_PROGRESS'?1:0;
  const doc=sampleDocumentState(task), kit=sampleKittingState(task.materialStatus);
  return <section className="su-overview">
    <ol className="su-stepper">{['资料准备','试制采集','整包审核','完成转仓'].map((label,i)=><li key={label} className={i<=step?'reached':''}><span>{i<step?<CheckCircle2 size={16}/>:String(i+1).padStart(2,'0')}</span>{label}</li>)}</ol>
    <div className="su-task-focus"><div><small>{closed?'历史样品 · 资料可追溯':pending?'下一步 · 确认本次提交':'下一步 · 试制与记录'}</small><h3>{cancelled?'样品已取消，原记录保留':closed?'样品已完成，记录完整保留':pending?'本次试制资料已提交':'在这里继续完成试制'}</h3><p>{cancelled?'可以查看已有资料和操作记录。':closed?`完成 ${sampleStamp(task.completedAt)}${task.archivedAt?' · 已归档':''}`:pending?'查看采集内容与照片，整包确认后转入成品仓。':'采集数据与过程照片均为选填，保存后统一提交审核。'}</p></div><button className="su-primary" onClick={()=>onTab(closed?'completion':pending?'review':'capture')}>{closed?<PackageCheck size={18}/>:pending?<ClipboardCheck size={18}/>:<Camera size={18}/>} {closed?'查看完成记录':pending?'审核本次提交':'开始采集'}<ArrowRight size={16}/></button></div>
    <div className="su-facts"><div><small>计划 / 已完成</small><strong>{task.sampleQuantity??'—'} <em>/ {task.completedQuantity||0}</em></strong></div><div><small>计划完成</small><strong>{task.plannedCompletionDate||'未设置'}</strong></div><div><small>客户交期</small><strong>{task.dueDate||'未设置'}</strong></div><div><small>计划周</small><strong>{task.planWeekStartDate||'未记录'}</strong></div></div>
    <div className="su-preparation"><button onClick={()=>onTab('documents')}><FileText size={20}/><span><strong>图纸资料</strong><small className={doc.tone}>{doc.label}</small></span><ArrowRight size={16}/></button><Link href={`/workspace/warehouse?branch=samples&taskId=${task.id}`}><PackageCheck size={20}/><span><strong>仓库配料</strong><small className={kit.tone}>{kit.label} · 仓库独立处理</small></span><ArrowRight size={16}/></Link></div>
    <div className="su-evidence"><button onClick={()=>onTab('data')}><FileText size={22}/><span>采集数据<strong>{task.counts.data}<small> 条</small></strong></span><ArrowRight size={16}/></button><button onClick={()=>onTab('photos')}><Camera size={22}/><span>过程照片<strong>{task.counts.photos}<small> 张</small></strong></span><ArrowRight size={16}/></button><button onClick={()=>onTab('review')}><ClipboardCheck size={22}/><span>本次审核<strong>{pending?'待确认':cancelled?'已取消':closed?'已完成':'尚未提交'}</strong></span><ArrowRight size={16}/></button></div>
    {!!task.parameterConflictCount&&<Link className="su-parameter-note" href="/connector-parameters?view=conflicts">样品可正常完成 · {task.parameterConflictCount} 项连接器参数差异待处理 <ArrowRight size={15}/></Link>}
    {task.planRemark&&<div className="su-remark"><small>计划备注</small><p>{task.planRemark}</p></div>}
  </section>;
}
