import { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { internalQualityRiskInclude, serializeInternalQualityRisk } from './internal-quality-risks';
import { qualityTaskCauses } from './quality-direct-shared';
import { eligibleUserIdsForCapability } from './system-notifications';
import { canIssuePasswordSession, hasPureFieldReporterAccess } from './login-security';
import { enqueueQualityNotification } from './quality-risk-notifications';

/** Caller holds the same report lock as task writes. Read AFTER updating the last task. */
export async function submitReadyQualityReview(tx: Prisma.TransactionClient, reportId: string, actor: { id?: string; name: string }) {
  const report = await tx.internalQualityRiskReport.findUniqueOrThrow({ where: { id: reportId }, include: internalQualityRiskInclude });
  if (report.workflowVersion < 4 || report.deletedAt || !['SUBMITTED', 'CONTAINMENT', 'COLLABORATING', 'REVISING'].includes(report.status)) return;
  const tasks = report.tasks.filter(task => task.status !== 'CANCELLED');
  if (!tasks.length || tasks.some(task => !['COMPLETED', 'VERIFIED'].includes(task.status))) return;
  const incomplete = tasks.filter(task => { const causes = qualityTaskCauses(task, report); return !causes.occurrenceCause.trim() || !causes.rootCause.trim() || !task.actionTaken?.trim() || !task.result?.trim(); });
  if (incomplete.length) {
    await tx.internalQualityRiskTask.updateMany({ where: { id: { in: incomplete.map(task => task.id) } }, data: { status: 'IN_PROGRESS', reviewNote: '请补齐发生原因、根本原因、处理措施和结果。原有内容已保留。', version: { increment: 1 } } });
    await tx.internalQualityRiskReport.update({ where: { id: reportId }, data: { status: 'COLLABORATING', version: { increment: 1 } } });
    return;
  }
  const reviewer = report.reviewerUserId ? await tx.user.findUnique({ where: { id: report.reviewerUserId }, include: { accessGrants: true } }) : null;
  const allowed = reviewer && canIssuePasswordSession(reviewer) && !hasPureFieldReporterAccess(reviewer)
    && (await eligibleUserIdsForCapability(tx, 'QUALITY', 'EXECUTE_WORKFLOW')).includes(reviewer.id) && !tasks.some(task => task.ownerUserId === reviewer.id);
  if (!allowed || !reviewer) {
    const reason = '处理内容已保存，请质量管理人员重新指定有效的独立品质确认人，指定后自动送审。';
    if (report.reviewBlockReason !== reason) await tx.internalQualityRiskReport.update({ where: { id: reportId }, data: { reviewBlockReason: reason, version: { increment: 1 } } });
    return;
  }
  const joined = (get: (task: typeof tasks[number]) => string) => tasks.map(task => `【${task.ownerName || '责任人'}】\n${get(task)}`).join('\n\n');
  const fields = { occurrenceCause: joined(task => qualityTaskCauses(task, report).occurrenceCause), rootCause: joined(task => qualityTaskCauses(task, report).rootCause),
    correctiveAction: joined(task => task.actionTaken!), finalConclusion: joined(task => task.result!) };
  const dto = serializeInternalQualityRisk(report);
  const round = report.reviewRound + 1;
  const snapshot = { qualitySource: report.qualitySource, reportNo: report.reportNo, title: report.title, defectPhenomenon: report.defectPhenomenon,
    problemCategory: report.problemCategory, severity: report.severity, products: dto.products, tasks: dto.tasks, attachments: dto.attachments,
    analysis: fields, sourceVersion: report.version + 1, submissionMode: 'ALL_TASKS_COMPLETED', legacyAnalysis: tasks.some(task => qualityTaskCauses(task, report).legacy) ? { occurrenceCause: report.occurrenceCause, rootCause: report.rootCause } : null } as unknown as Prisma.InputJsonObject;
  await tx.qualityRiskReview.create({ data: { reportId, round, reviewerId: reviewer.id, submittedById: actor.id || 'system:quality-direct-review', snapshot } });
  await tx.internalQualityRiskReport.update({ where: { id: reportId }, data: { ...fields, status: 'VERIFYING', reviewRound: round, reviewBlockReason: null, verificationResult: null, verifiedAt: null, verifiedById: null, version: { increment: 1 } } });
  await tx.internalQualityRiskActivity.create({ data: { reportId, actorId: actor.id, actorName: actor.name, action: 'AUTO_SUBMIT_REVIEW', content: `全部责任任务完成，自动送第 ${round} 轮品质确认`, detail: { round, taskIds: tasks.map(task => task.id) } } });
  await enqueueQualityNotification(tx, { reportId, reportNo: report.reportNo, recipientId: reviewer.id, event: 'REVIEW', title: `待品质确认 · 第${round}轮`, summary: report.defectPhenomenon || report.title, round, actorId: actor.id, key: `direct-review:${round}` });
}

/** Recover migrated ready records and interrupted handoffs; never approve or archive. */
export async function resumeReadyQualityReviews() {
  const reports = await prisma.internalQualityRiskReport.findMany({ where: { workflowVersion: 4, deletedAt: null, reviewBlockReason: null, status: { in: ['SUBMITTED', 'CONTAINMENT', 'COLLABORATING', 'REVISING'] },
    tasks: { some: { status: { not: 'CANCELLED' } }, every: { status: { in: ['COMPLETED', 'VERIFIED', 'CANCELLED'] } } } },
    select: { id: true }, orderBy: { updatedAt: 'asc' }, take: 30 });
  for (const report of reports) {
    await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`internal-quality-risk:${report.id}`}))`;
      await submitReadyQualityReview(tx, report.id, { name: '系统接续' });
    });
  }
  return reports.length;
}
