import type { SampleTaskDTO } from '@/types';
export function sampleDocumentState(task: Pick<SampleTaskDTO, 'drawingCount' | 'drawingVersion' | 'drawingReviewStatus' | 'documentReviewRequired' | 'drawingDocumentCount'>) {
  const count = task.drawingCount ?? task.drawingDocumentCount ?? 0;
  return count > 0 ? { label: '已上传', tone: 'good' } : { label: '待上传', tone: 'warning' };
}
export function sampleKittingState(status?: string | null) {
  return status === 'completed' ? { label: '已配齐', tone: 'good' } : status === 'exception' ? { label: '缺料', tone: 'danger' } : { label: '待配料', tone: 'muted' };
}
export function sampleProgress(task: Pick<SampleTaskDTO, 'status' | 'taskType' | 'dataStatus' | 'completedQuantity'>) {
  if (task.status === 'COMPLETED') return { label: '已完成', tone: 'good' };
  if (task.status === 'CANCELLED') return { label: '已取消', tone: 'muted' };
  if (task.taskType !== 'REPEAT' && (task.status === 'SUBMITTED' || task.dataStatus === 'PENDING_REVIEW')) return { label: '待整包审核', tone: 'warning' };
  if (task.completedQuantity) return {label:'部分完成',tone:'info'};
  if (task.taskType === 'NEW' && task.dataStatus === 'PROCESSED') return {label:'待登记完成',tone:'info'};
  if (task.dataStatus === 'NEEDS_CHANGES') return { label: '采集待补充', tone: 'warning' };
  return task.status === 'PLANNED' ? { label: '待开始', tone: 'muted' } : { label: task.taskType === 'REPEAT' ? '制作中' : '试制采集中', tone: 'info' };
}
export const sampleTaskHref = (path: string, id: string) => `${path}?branch=samples&taskId=${encodeURIComponent(id)}`;

export function samplePrimaryAction(task: SampleTaskDTO): {label:string;tab:'documents'|'overview'|'completion'|'review'} {
  if (['COMPLETED','CANCELLED'].includes(task.status)) return {label:'查看记录',tab:'completion'};
  if (task.taskType !== 'REPEAT' && task.counts.pendingReview) return {label:'审核整包',tab:'review'};
  if (task.taskType === 'REPEAT' || task.dataStatus==='PROCESSED') return {label:'登记完成',tab:'completion'};
  return {label:'打开试制',tab:'overview'};
}
