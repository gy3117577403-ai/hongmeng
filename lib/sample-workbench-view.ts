import type { SampleTaskDTO } from '@/types';
export function sampleDocumentState(task: Pick<SampleTaskDTO, 'drawingReviewStatus' | 'documentReviewRequired'>) {
  if (!task.documentReviewRequired) return { label: '历史资料', tone: 'muted' };
  const labels: Record<string, string> = { APPROVED: '资料已审核', RETURNED: '审核退回', REVIEWING: '待双方审核', SUPERVISOR: '待主管审核', QUALITY: '待品质审核', DRAFT: '待提交审核' };
  return { label: labels[task.drawingReviewStatus || ''] || '资料待准备', tone: task.drawingReviewStatus === 'APPROVED' ? 'good' : task.drawingReviewStatus === 'RETURNED' ? 'danger' : 'warning' };
}
export function sampleKittingState(status?: string | null) {
  return status === 'completed' ? { label: '已配齐', tone: 'good' } : status === 'exception' ? { label: '缺料', tone: 'danger' } : { label: '待配料', tone: 'muted' };
}
export function sampleProgress(task: Pick<SampleTaskDTO, 'status' | 'taskType' | 'dataStatus'>) {
  if (task.status === 'COMPLETED') return { label: '已完成', tone: 'good' };
  if (task.status === 'CANCELLED') return { label: '已取消', tone: 'muted' };
  if (task.taskType !== 'REPEAT' && (task.status === 'SUBMITTED' || task.dataStatus === 'PENDING_REVIEW')) return { label: '待整包审核', tone: 'warning' };
  if (task.dataStatus === 'NEEDS_CHANGES') return { label: '采集待补充', tone: 'warning' };
  return task.status === 'PLANNED' ? { label: '待开始', tone: 'muted' } : { label: task.taskType === 'REPEAT' ? '制作中' : '试制采集中', tone: 'info' };
}
export const sampleTaskHref = (path: string, id: string) => `${path}?branch=samples&taskId=${encodeURIComponent(id)}`;
