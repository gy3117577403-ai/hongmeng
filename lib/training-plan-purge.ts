import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { cleanTrainingText, TrainingInputError } from '@/lib/training';

async function loadPurgeState(db: Prisma.TransactionClient, id: string) {
  const plan = await db.trainingPlan.findUnique({
    where: { id },
    include: {
      participants: { orderBy: { id: 'asc' } },
      sessions: { orderBy: { id: 'asc' }, include: {
        attendanceRecords: { orderBy: { id: 'asc' } },
        feedbacks: { orderBy: { id: 'asc' } },
        qrWindows: { orderBy: { id: 'asc' } },
      } },
    },
  });
  if (!plan) throw new TrainingInputError('培训计划不存在或已永久删除', 404);
  const [attachments, certificates] = await Promise.all([
    db.trainingAttachment.findMany({ where: { OR: [
      { planId: id }, { session: { planId: id } }, { participant: { planId: id } },
    ] }, orderBy: { id: 'asc' } }),
    db.employeeSkillCertification.findMany({
      where: { id: { in: plan.participants.flatMap(person => person.certificationId ? [person.certificationId] : []) } },
      include: { employee: { select: { name: true, employeeNo: true } }, skill: { select: { name: true } } },
      orderBy: { id: 'asc' },
    }),
  ]);
  const attendanceFactCount = plan.sessions.flatMap(session => session.attendanceRecords).filter(row => (
    row.status !== 'INVITED' || row.checkInAt || row.checkOutAt || row.correctedAt
  )).length;
  const participantFactCount = plan.participants.filter(row => (
    row.attendanceStatus !== 'INVITED' || row.checkInAt || row.checkOutAt || row.actualMinutes !== null
  )).length;
  const scoreOrReviewFactCount = plan.participants.filter(row => (
    row.theoryScore !== null || row.practicalScore !== null || row.score !== null || row.submittedAt
    || row.reviewedAt || row.reviewStatus !== 'NOT_REQUIRED' || row.result !== 'PENDING'
  )).length;
  const feedbackCount = plan.sessions.reduce((total, session) => total + session.feedbacks.length, 0);
  const sessionExecutionCount = plan.sessions.filter(session => (
    session.actualStartAt || session.actualEndAt || session.actualMinutes !== null || ['IN_PROGRESS', 'COMPLETED'].includes(session.status)
  )).length;
  const certificationCount = plan.participants.filter(row => row.certificationId).length;
  const hasExecutionFacts = Boolean(attendanceFactCount || participantFactCount || scoreOrReviewFactCount
    || feedbackCount || sessionExecutionCount || certificationCount || plan.startedAt || plan.completedAt || plan.submittedAt);
  const impact = {
    participantCount: plan.participants.length, attendanceFactCount, participantFactCount,
    scoreOrReviewFactCount, feedbackCount, sessionExecutionCount, certificationCount,
    attachmentCount: attachments.length,
    activeQrWindowCount: plan.sessions.flatMap(session => session.qrWindows).filter(row => ['OPEN', 'SCHEDULED'].includes(row.status)).length,
    hasExecutionFacts,
  };
  // Certificates are shared by employee+skill and can be updated by other
  // training/assessment records. Never revoke/delete/revert them as a cascade.
  const blockingCertificates = certificates.filter(row => row.status !== 'REVOKED');
  const blockers = blockingCertificates.map(row => row.employee.name + ' · ' + row.skill.name + '：存在未撤销的技能证书，请先到技能绩效核对并更正');
  const previewToken = createHash('sha256').update(JSON.stringify({
    plan, attachments: attachments.map(row => ({ ...row, size: String(row.size) })), certificates,
  })).digest('hex');
  return { plan, attachments, preview: {
    plan: { id: plan.id, code: plan.code, title: plan.title, status: plan.status, version: plan.version },
    impact, canPurge: blockers.length === 0, blockers, previewToken,
    requiresInvalidateFacts: hasExecutionFacts,
    willCancel: !['DRAFT', 'CANCELLED', 'COMPLETED'].includes(plan.status),
    certificates: certificates.map(row => ({ id: row.id, employeeName: row.employee.name, skillName: row.skill.name, status: row.status })),
  } };
}

export async function previewTrainingPlanPurge(id: string) {
  return prisma.$transaction(async tx => (await loadPurgeState(tx, id)).preview, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}

export async function permanentlyDeleteTrainingPlan(input: {
  id: string; actorId: string; reason: unknown; confirmationCode: unknown;
  previewToken: unknown; confirmed: unknown; invalidateFacts: unknown;
}) {
  const reason = cleanTrainingText(input.reason, 500);
  if (!reason) throw new TrainingInputError('永久删除必须填写原因');
  if (input.confirmed !== true) throw new TrainingInputError('请确认这是不可恢复的永久删除');
  try {
    return await prisma.$transaction(async tx => {
      const { plan, attachments, preview } = await loadPurgeState(tx, input.id);
      if (input.confirmationCode !== plan.code) throw new TrainingInputError('请输入完整计划编号确认永久删除');
      if (input.previewToken !== preview.previewToken) throw new TrainingInputError('计划或关联数据已经变化，请重新查看删除影响后确认', 409);
      if (!preview.canPurge) throw new TrainingInputError(preview.blockers.join('；'), 409);
      if (preview.requiresInvalidateFacts && input.invalidateFacts !== true) {
        throw new TrainingInputError('已有执行记录，请确认这些是误录记录并作废后删除；真实培训请使用归档', 409);
      }
      const now = new Date();
      const claimed = await tx.trainingPlan.updateMany({ where: { id: plan.id, version: plan.version }, data: { version: { increment: 1 } } });
      if (claimed.count !== 1) throw new TrainingInputError('计划已被其他人更新，请重新查看删除影响', 409);
      for (const file of attachments) {
        await tx.trainingAttachment.update({ where: { id: file.id }, data: {
          deletedAt: file.deletedAt || now, deletedById: input.actorId, deleteReason: reason,
          sourceSnapshot: { planId: plan.id, planCode: plan.code, planTitle: plan.title,
            originalPlanId: file.planId, sessionId: file.sessionId, participantId: file.participantId },
          planId: null, sessionId: null, participantId: null,
        } });
      }
      await tx.systemNotification.updateMany({
        where: { sourceType: 'training_plan', sourceId: plan.id },
        data: { expiresAt: now, targetRoute: null },
      });
      // Independent audit survives cascaded TrainingActivity deletion.
      await tx.operationLog.create({ data: {
        userId: input.actorId, action: 'permanently_delete_training_plan', targetType: 'training_plan', targetId: plan.id,
        detail: { code: plan.code, title: plan.title, previousStatus: plan.status, reason,
          invalidatedFacts: preview.requiresInvalidateFacts, impact: preview.impact,
          startAt: plan.startAt.toISOString(), endAt: plan.endAt.toISOString(),
          attachmentsSoftDeleted: attachments.length, certificatesUntouched: true },
      } });
      await tx.trainingPlan.delete({ where: { id: plan.id } });
      return { code: plan.code, impact: preview.impact, recoverable: false as const };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 20_000 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2034', 'P2003', 'P2025'].includes(error.code)) {
      throw new TrainingInputError('删除时关联记录发生变化，操作已回滚，请刷新后重试', 409);
    }
    throw error;
  }
}
