/** Shared read model. Deriving a display stage never changes approval or archive facts. */
export const QUALITY_PHASE_LABELS = { DRAFT: '草稿', SUBMITTED: '待接单', COLLABORATING: '处理中', SUMMARIZING: '待汇总', VERIFYING: '待品质确认', PENDING_CLOSE: '待归档', ARCHIVED: '已归档' } as const;
export type QualityPhase = keyof typeof QUALITY_PHASE_LABELS;
export const QUALITY_TASK_LABELS: Record<string, string> = { TODO: '待接单', IN_PROGRESS: '处理中', COMPLETED: '已提交', VERIFIED: '品质已通过', CANCELLED: '已取消' };
export const QUALITY_HANDLING = ['SUBMITTED', 'CONTAINMENT', 'COLLABORATING', 'REVISING'];
type Task = { id: string; status: string; ownerUserId?: string | null; ownerName?: string | null; dueAt?: string | Date | null; reviewNote?: string | null };
type Report = { status: string; title?: string; defectPhenomenon?: string | null; ownerUserId?: string | null; ownerName?: string | null; reviewerUserId?: string | null; reviewerName?: string | null; createdById?: string | null; deletedAt?: string | Date | null; reviewRound?: number; workflowVersion?: number; reviewBlockReason?: string | null; tasks: Task[] };
export function qualityEventTitle(report: Pick<Report, 'title' | 'defectPhenomenon'>) {
  const title = report.title?.trim() || '';
  return !title || ['工艺问题', '品质问题', '现场问题', '物料问题'].includes(title) ? report.defectPhenomenon?.trim().replace(/\s+/g, ' ').slice(0, 70) || title || '待补充问题事实' : title;
}
export function qualityDate(value?: string | Date | null) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date) : '';
}
export function qualityWorkflowView(report: Report, now = new Date()) {
  const active = report.tasks.filter(task => task.status !== 'CANCELLED');
  const pending = active.filter(task => !['COMPLETED', 'VERIFIED'].includes(task.status));
  const submitted = active.length - pending.length;
  let phase: QualityPhase = 'COLLABORATING';
  if (['DRAFT', 'VERIFYING', 'PENDING_CLOSE', 'ARCHIVED'].includes(report.status)) phase = report.status as QualityPhase;
  else if (active.length && !pending.length && (report.workflowVersion || 2) < 4) phase = 'SUMMARIZING';
  else if (active.length && active.every(task => task.status === 'TODO')) phase = 'SUBMITTED';
  const waiting = phase === 'VERIFYING' ? [{ id: report.reviewerUserId, name: report.reviewerName || '指定品质确认人' }]
    : phase === 'SUMMARIZING' ? [{ id: report.ownerUserId, name: report.ownerName || '牵头人' }]
    : pending.map(task => ({ id: task.ownerUserId, name: task.ownerName || '待指派' }));
  const today = qualityDate(now);
  const handling = QUALITY_HANDLING.includes(report.status);
  const overdue = handling ? pending.filter(task => qualityDate(task.dueAt) && qualityDate(task.dueAt) < today) : [];
  const dueDays = pending.map(task => qualityDate(task.dueAt)).filter(Boolean).sort();
  const next = (report.workflowVersion || 2) >= 4 && phase === 'COLLABORATING' ? report.reviewBlockReason || (active.length && !pending.length ? '处理已完成，正在送品质确认' : active.length ? '责任人完成各自内容，全部提交后自动送品质确认' : '请质量人员补充有效责任任务') : ({ DRAFT: '补齐事实与责任分工，提交并分派', SUBMITTED: '责任人接单并开始处理', COLLABORATING: active.length ? '完成各自任务，再由牵头人汇总' : '请质量人员补充有效责任任务', SUMMARIZING: '牵头人汇总原因与方案，提交品质确认', VERIFYING: '指定品质确认人验证或定向退回', PENDING_CLOSE: '检查归档条件，预览并归档', ARCHIVED: '查看正式版本；需要调整时启动修订' })[phase];
  return { phase, label: report.deletedAt ? '回收站' : QUALITY_PHASE_LABELS[phase], title: qualityEventTitle(report), activeTasks: active.length, submittedTasks: submitted,
    waitingNames: [...new Set(waiting.map(item => item.name))], waitingUserIds: [...new Set(waiting.map(item => item.id).filter((id): id is string => Boolean(id)))],
    unaccepted: active.filter(task => task.status === 'TODO').length, overdueTasks: overdue.length, dueDate: dueDays[0] || null, next,
    returned: handling && Boolean(report.reviewRound) && pending.some(task => Boolean(task.reviewNote)), revising: report.status === 'REVISING' };
}
export function qualityMyPending(report: Report, userId: string) {
  if (report.deletedAt || report.status === 'ARCHIVED') return false;
  if (report.status === 'DRAFT') return report.createdById === userId;
  if (report.status === 'VERIFYING') return report.reviewerUserId === userId;
  if (!QUALITY_HANDLING.includes(report.status)) return false;
  const view = qualityWorkflowView(report);
  return view.phase === 'SUMMARIZING' ? report.ownerUserId === userId : report.tasks.some(task => task.ownerUserId === userId && ['TODO', 'IN_PROGRESS'].includes(task.status));
}
