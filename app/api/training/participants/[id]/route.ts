import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';
import {
  addTrainingMonths,
  calculateTrainingScore,
  cleanTrainingText,
  parseOptionalTrainingInteger,
  TrainingInputError,
  TRAINING_ATTENDANCE_STATUSES,
  type TrainingAttendanceStatus,
} from '@/lib/training';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function dateOnly(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const action = cleanTrainingText(body.action, 40);
    const current = await prisma.trainingParticipant.findUnique({
      where: { id: params.id },
      include: {
        employee: true,
        plan: { include: { course: true } },
      },
    });
    if (!current || current.plan.deletedAt) return NextResponse.json({ ok: false, error: '参训记录不存在' }, { status: 404 });
    if (['COMPLETED', 'CANCELLED'].includes(current.plan.status)) throw new TrainingInputError('已完成或已取消计划不能修改参训记录', 409);
    const expectedVersion = Number(body.version ?? current.version);
    const now = new Date();
    let operationDetail: Record<string, unknown> = {};

    await prisma.$transaction(async tx => {
      if (action === 'attendance') {
        const attendanceStatus = cleanTrainingText(body.attendanceStatus, 30) as TrainingAttendanceStatus;
        if (!TRAINING_ATTENDANCE_STATUSES.includes(attendanceStatus)) throw new TrainingInputError('签到状态不正确');
        const absenceNote = cleanTrainingText(body.absenceNote, 800) || null;
        const attended = ['PRESENT', 'LATE'].includes(attendanceStatus);
        const result = await tx.trainingParticipant.updateMany({
          where: { id: current.id, version: expectedVersion },
          data: {
            attendanceStatus,
            checkInAt: attended ? (current.checkInAt || now) : null,
            checkOutAt: body.checkOut === true && attended ? now : current.checkOutAt,
            actualMinutes: body.actualMinutes === undefined
              ? current.actualMinutes
              : parseOptionalTrainingInteger(body.actualMinutes, '实到分钟', 0, 24 * 60),
            absenceNote: attended ? null : absenceNote,
            status: attended ? 'ATTENDED' : attendanceStatus === 'INVITED' ? 'INVITED' : 'ABSENT',
            reviewStatus: attended && current.plan.assessmentMode !== 'NONE' ? current.reviewStatus : 'NOT_REQUIRED',
            version: { increment: 1 },
          },
        });
        if (result.count !== 1) throw new TrainingInputError('签到记录已被其他人更新，请刷新后重试', 409);
        operationDetail = { attendanceStatus, absenceNote };
      } else if (action === 'save_result') {
        if (!['PRESENT', 'LATE'].includes(current.attendanceStatus)) throw new TrainingInputError('请先完成签到再录入考核结果', 409);
        if (current.plan.assessmentMode === 'NONE') throw new TrainingInputError('当前计划无需考核');
        const theoryScore = parseOptionalTrainingInteger(body.theoryScore, '理论成绩', 0, 100);
        const practicalScore = parseOptionalTrainingInteger(body.practicalScore, '实操成绩', 0, 100);
        const score = calculateTrainingScore({ mode: current.plan.assessmentMode, theoryScore, practicalScore });
        if (score === null) throw new TrainingInputError('请填写当前考核方式要求的成绩');
        const passScore = current.plan.passScore ?? 80;
        const result = score >= passScore ? 'PASSED' : 'FAILED';
        const updated = await tx.trainingParticipant.updateMany({
          where: { id: current.id, version: expectedVersion },
          data: {
            theoryScore,
            practicalScore,
            score,
            result,
            status: 'PENDING_REVIEW',
            reviewStatus: 'PENDING',
            reviewerId: current.plan.reviewerId,
            submittedAt: now,
            reviewComment: null,
            version: { increment: 1 },
          },
        });
        if (updated.count !== 1) throw new TrainingInputError('成绩已被其他人更新，请刷新后重试', 409);
        operationDetail = { theoryScore, practicalScore, score, result, passScore };
      } else if (action === 'approve') {
        if (current.reviewStatus !== 'PENDING') throw new TrainingInputError('只有待审核成绩可以批准', 409);
        const reviewComment = cleanTrainingText(body.reviewComment, 1_000) || null;
        let certificationId: string | null = current.certificationId;
        if (current.result === 'PASSED' && current.plan.course?.skillId) {
          const effectiveFrom = dateOnly(now);
          const validityMonths = current.plan.course.validityMonths || current.plan.course.retrainingMonths || 12;
          const nextExpiresAt = addTrainingMonths(effectiveFrom, validityMonths);
          const existing = await tx.employeeSkillCertification.findUnique({
            where: { employeeId_skillId: { employeeId: current.employeeId, skillId: current.plan.course.skillId } },
          });
          const targetLevel = current.plan.course.targetLevel || 1;
          const expiresAt = existing?.expiresAt && existing.expiresAt > nextExpiresAt ? existing.expiresAt : nextExpiresAt;
          const certification = await tx.employeeSkillCertification.upsert({
            where: { employeeId_skillId: { employeeId: current.employeeId, skillId: current.plan.course.skillId } },
            create: {
              employeeId: current.employeeId,
              skillId: current.plan.course.skillId,
              level: targetLevel,
              status: 'ACTIVE',
              source: 'TRAINING',
              evidenceType: 'TRAINING_RECORD',
              score: current.score,
              assessorId: current.plan.trainerId,
              reviewerId: current.plan.reviewerId || user.employeeId,
              effectiveFrom,
              expiresAt,
              requiresReassessment: false,
              note: `培训计划 ${current.plan.code}${reviewComment ? `：${reviewComment}` : ''}`,
            },
            update: {
              level: Math.max(existing?.level || 1, targetLevel),
              status: 'ACTIVE',
              source: existing?.source === 'ASSESSMENT' ? existing.source : 'TRAINING',
              evidenceType: existing?.source === 'ASSESSMENT' ? existing.evidenceType : 'TRAINING_RECORD',
              score: Math.max(existing?.score || 0, current.score || 0),
              assessorId: current.plan.trainerId || existing?.assessorId,
              reviewerId: current.plan.reviewerId || user.employeeId || existing?.reviewerId,
              effectiveFrom: existing?.effectiveFrom && existing.effectiveFrom < effectiveFrom ? existing.effectiveFrom : effectiveFrom,
              expiresAt,
              requiresReassessment: false,
              note: `培训计划 ${current.plan.code}${reviewComment ? `：${reviewComment}` : ''}`,
              version: { increment: 1 },
            },
          });
          certificationId = certification.id;
        }
        const updated = await tx.trainingParticipant.updateMany({
          where: { id: current.id, version: expectedVersion },
          data: {
            reviewStatus: 'APPROVED',
            reviewerId: user.employeeId || current.plan.reviewerId,
            reviewComment,
            reviewedAt: now,
            status: current.result === 'PASSED' ? 'PASSED' : 'FAILED',
            certificationId,
            version: { increment: 1 },
          },
        });
        if (updated.count !== 1) throw new TrainingInputError('审核记录已被其他人更新，请刷新后重试', 409);
        operationDetail = { result: current.result, certificationId, reviewComment };
      } else if (action === 'return') {
        if (current.reviewStatus !== 'PENDING') throw new TrainingInputError('只有待审核成绩可以退回', 409);
        const reviewComment = cleanTrainingText(body.reviewComment, 1_000);
        if (!reviewComment) throw new TrainingInputError('退回时请填写修改意见');
        const updated = await tx.trainingParticipant.updateMany({
          where: { id: current.id, version: expectedVersion },
          data: {
            reviewStatus: 'RETURNED',
            reviewerId: user.employeeId || current.plan.reviewerId,
            reviewComment,
            reviewedAt: now,
            status: 'ATTENDED',
            version: { increment: 1 },
          },
        });
        if (updated.count !== 1) throw new TrainingInputError('审核记录已被其他人更新，请刷新后重试', 409);
        operationDetail = { reviewComment };
      } else {
        throw new TrainingInputError('参训记录操作不正确');
      }

      await tx.trainingActivity.create({
        data: {
          planId: current.planId,
          action: `participant_${action}`,
          content: `${current.employeeNameSnapshot} · ${action}`,
          actorId: user.id,
          detail: { participantId: current.id, employeeId: current.employeeId, ...operationDetail },
        },
      });
      await tx.trainingPlan.update({ where: { id: current.planId }, data: { updatedById: user.id, version: { increment: 1 } } });
    });

    const participant = await prisma.trainingParticipant.findUniqueOrThrow({ where: { id: current.id } });
    await logOp({
      userId: user.id,
      action: `${action}_training_participant`,
      targetType: 'training_participant',
      targetId: current.id,
      detail: { planId: current.planId, employeeId: current.employeeId, ...operationDetail },
    });
    return NextResponse.json({
      ok: true,
      participant: {
        id: participant.id,
        attendanceStatus: participant.attendanceStatus,
        status: participant.status,
        reviewStatus: participant.reviewStatus,
        score: participant.score,
        result: participant.result,
        certificationId: participant.certificationId,
        version: participant.version,
      },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof TrainingInputError) return NextResponse.json({ ok: false, error: error.message }, { status: error.statusCode });
    console.error('training participant update failed', error);
    return NextResponse.json({ ok: false, error: '参训记录保存失败' }, { status: 500 });
  }
}
