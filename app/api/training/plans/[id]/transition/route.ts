import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';
import { activeUserIdsForEmployees, createSystemNotification } from '@/lib/system-notifications';
import {
  ensureTrainingSessionAttendanceRows,
  trainingPlanAccountReadiness,
} from '@/lib/training-qr-service';
import {
  cleanTrainingText,
  nextTrainingPlanStatus,
  serializeTrainingPlan,
  TrainingInputError,
  trainingPlanInclude,
  type TrainingPerson,
} from '@/lib/training';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const action = cleanTrainingText(body.action, 40);
    const reason = cleanTrainingText(body.reason, 800) || null;
    const current = await prisma.trainingPlan.findFirst({
      where: { id: params.id, deletedAt: null, archivedAt: null },
      include: { participants: true, sessions: true },
    });
    if (!current) return NextResponse.json({ ok: false, error: '培训计划不存在、已删除或已归档' }, { status: 404 });
    const nextStatus = nextTrainingPlanStatus(current.status, action);
    const requestedSessionId = cleanTrainingText(body.sessionId, 80);
    const startSession = action === 'start'
      ? (requestedSessionId
          ? current.sessions.find(session => session.id === requestedSessionId)
          : [...current.sessions]
              .filter(session => session.status === 'SCHEDULED')
              .sort((left, right) => left.sequence - right.sequence)[0])
      : null;
    if (action === 'start' && (!startSession || startSession.status !== 'SCHEDULED')) {
      throw new TrainingInputError('没有可开始的待执行课次', 409);
    }
    if (action === 'publish' && (!current.participants.length || !current.sessions.length)) {
      throw new TrainingInputError('发布前必须配置参训人员和培训场次', 409);
    }
    if (action === 'publish') {
      const readiness = await trainingPlanAccountReadiness(current.id);
      if (readiness.blockedCount) {
        const examples = readiness.participants
          .filter(participant => !participant.ready)
          .slice(0, 3)
          .map(participant => `${participant.employeeName}（${participant.issue}）`)
          .join('、');
        throw new TrainingInputError(
          `还有 ${readiness.blockedCount} 名参训员工的个人账号不可用${examples ? `：${examples}` : ''}`,
          409,
        );
      }
    }
    if (action === 'cancel' && !reason) throw new TrainingInputError('取消计划时请填写原因');
    if (['submit_review', 'complete'].includes(action)) {
      // Plan-level attendance is a compatibility summary. Completion gates must
      // inspect every session so a partially completed multi-session plan cannot
      // pass merely because its summary is no longer INVITED.
      await prisma.$transaction(tx => ensureTrainingSessionAttendanceRows(tx, current.id));
      const sessionFacts = await prisma.trainingSession.findMany({
        where: { planId: current.id, status: { not: 'CANCELLED' } },
        select: {
          id: true,
          name: true,
          feedbackRequired: true,
          attendanceRecords: { select: { participantId: true, status: true } },
          feedbacks: { select: { participantId: true } },
        },
      });
      const unresolvedAttendance = sessionFacts.reduce(
        (count, session) => count + session.attendanceRecords.filter(record => record.status === 'INVITED').length,
        0,
      );
      if (unresolvedAttendance) {
        throw new TrainingInputError(`还有 ${unresolvedAttendance} 条课次出勤未登记结果`, 409);
      }
      if (action === 'complete') {
        const missingRequiredFeedback = sessionFacts.reduce((count, session) => {
          if (!session.feedbackRequired) return count;
          const submitted = new Set(session.feedbacks.map(feedback => feedback.participantId));
          return count + session.attendanceRecords.filter(record => (
            ['PRESENT', 'LATE'].includes(record.status) && !submitted.has(record.participantId)
          )).length;
        }, 0);
        if (missingRequiredFeedback) {
          throw new TrainingInputError(`还有 ${missingRequiredFeedback} 名已到人员未完成必填课后反馈`, 409);
        }
      }
    }
    if (action === 'submit_review' && current.assessmentMode !== 'NONE') {
      const missingScores = current.participants.filter(person => (
        ['PRESENT', 'LATE'].includes(person.attendanceStatus) && person.score === null
      ));
      if (missingScores.length) throw new TrainingInputError(`还有 ${missingScores.length} 名已到人员未录入考核结果`, 409);
    }
    if (action === 'complete' && current.assessmentMode !== 'NONE') {
      const unresolved = current.participants.filter(person => ['PENDING', 'RETURNED'].includes(person.reviewStatus));
      if (unresolved.length) throw new TrainingInputError(`还有 ${unresolved.length} 名参训人员未完成审核`, 409);
    }

    const now = new Date();
    const updatedPlan = await prisma.$transaction(async tx => {
      if (action === 'publish' || action === 'start') {
        await ensureTrainingSessionAttendanceRows(tx, current.id);
      }
      const updateResult = await tx.trainingPlan.updateMany({
        where: { id: current.id, version: Number(body.version ?? current.version), deletedAt: null },
        data: {
          status: nextStatus,
          publishedAt: action === 'publish' ? now : current.publishedAt,
          startedAt: action === 'start' ? now : current.startedAt,
          submittedAt: action === 'submit_review' ? now : current.submittedAt,
          completedAt: action === 'complete' ? now : current.completedAt,
          cancelledAt: action === 'cancel' ? now : current.cancelledAt,
          cancelReason: action === 'cancel' ? reason : current.cancelReason,
          updatedById: user.id,
          version: { increment: 1 },
        },
      });
      if (updateResult.count !== 1) throw new TrainingInputError('计划已被其他人更新，请刷新后重试', 409);
      if (action === 'start') {
        const sessionUpdate = await tx.trainingSession.updateMany({
          where: { id: startSession!.id, planId: current.id, status: 'SCHEDULED' },
          data: { status: 'IN_PROGRESS', actualStartAt: now, version: { increment: 1 } },
        });
        if (sessionUpdate.count !== 1) {
          throw new TrainingInputError('课次已被其他人更新，请刷新后重试', 409);
        }
      }
      if (action === 'submit_review') {
        await tx.trainingParticipant.updateMany({
          where: {
            planId: current.id,
            attendanceStatus: { in: ['PRESENT', 'LATE'] },
            ...(current.assessmentMode === 'NONE' ? {} : { score: { not: null } }),
          },
          data: {
            status: current.assessmentMode === 'NONE' ? 'PASSED' : 'PENDING_REVIEW',
            result: current.assessmentMode === 'NONE' ? 'PASSED' : undefined,
            reviewStatus: current.assessmentMode === 'NONE' ? 'NOT_REQUIRED' : 'PENDING',
            submittedAt: now,
            version: { increment: 1 },
          },
        });
      }
      if (action === 'complete') {
        if (current.assessmentMode === 'NONE') {
          await tx.trainingParticipant.updateMany({
            where: {
              planId: current.id,
              attendanceStatus: { in: ['PRESENT', 'LATE'] },
            },
            data: {
              status: 'PASSED',
              result: 'PASSED',
              reviewStatus: 'NOT_REQUIRED',
              submittedAt: now,
              version: { increment: 1 },
            },
          });
        }
        await tx.trainingSession.updateMany({
          where: { planId: current.id, status: { not: 'CANCELLED' } },
          data: { status: 'COMPLETED', actualEndAt: now, version: { increment: 1 } },
        });
      }
      if (action === 'cancel') {
        await tx.trainingSession.updateMany({
          where: { planId: current.id, status: { not: 'COMPLETED' } },
          data: { status: 'CANCELLED', version: { increment: 1 } },
        });
        await tx.trainingQrWindow.updateMany({
          where: { session: { planId: current.id }, status: { in: ['SCHEDULED', 'OPEN'] } },
          data: { status: 'REVOKED', closedAt: now, closedById: user.id },
        });
      }
      await tx.trainingActivity.create({
        data: {
          planId: current.id,
          action,
          fromStatus: current.status,
          toStatus: nextStatus,
          content: action === 'cancel'
            ? `取消计划：${reason}`
            : action === 'complete'
              ? '培训执行已完成，等待按需归档'
              : `${current.status} → ${nextStatus}`,
          actorId: user.id,
          detail: action === 'start' ? { sessionId: startSession!.id } : undefined,
        },
      });
      if (action === 'publish') {
        const recipientUserIds = await activeUserIdsForEmployees(tx, current.participants.map(person => person.employeeId), { excludeUserIds: [user.id] });
        await createSystemNotification(tx, {
          eventType: 'TRAINING_PLAN_PUBLISHED',
          dedupeKey: `training-plan-published:${current.id}:v${current.version + 1}`,
          category: 'TODO',
          priority: current.isRequired ? 'HIGH' : 'NORMAL',
          title: `培训安排：${current.title}`,
          body: `${current.startAt.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}${current.location ? ` · ${current.location}` : ''}`,
          targetRoute: null,
          sourceType: 'training_plan',
          sourceId: current.id,
          actorId: user.id,
          metadata: { code: current.code, participantCount: current.participants.length },
          recipientUserIds,
        });
      }
      return tx.trainingPlan.findUniqueOrThrow({ where: { id: current.id }, include: trainingPlanInclude });
    });
    const roleIds = [updatedPlan.organizerId, updatedPlan.trainerId, updatedPlan.reviewerId].filter((value): value is string => Boolean(value));
    const peopleRows = roleIds.length ? await prisma.employee.findMany({
      where: { id: { in: roleIds } },
      select: { id: true, employeeNo: true, name: true, department: true, position: true, team: true, isActive: true },
    }) : [];
    const people = new Map(peopleRows.map(person => [person.id, person as TrainingPerson]));
    await logOp({
      userId: user.id,
      action: `${action}_training_plan`,
      targetType: 'training_plan',
      targetId: current.id,
      detail: { code: current.code, fromStatus: current.status, toStatus: nextStatus, reason, sessionId: startSession?.id || null },
    });
    return NextResponse.json({ ok: true, plan: serializeTrainingPlan(updatedPlan, people) });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof TrainingInputError) return NextResponse.json({ ok: false, error: error.message }, { status: error.statusCode });
    console.error('training plan transition failed', error);
    return NextResponse.json({ ok: false, error: '培训计划状态更新失败' }, { status: 500 });
  }
}
