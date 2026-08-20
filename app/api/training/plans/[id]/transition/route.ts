import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';
import { activeUserIdsForEmployees, createSystemNotification } from '@/lib/system-notifications';
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
      where: { id: params.id, deletedAt: null },
      include: { participants: true, sessions: true },
    });
    if (!current) return NextResponse.json({ ok: false, error: '培训计划不存在或已删除' }, { status: 404 });
    const nextStatus = nextTrainingPlanStatus(current.status, action);
    if (action === 'publish' && (!current.participants.length || !current.sessions.length)) {
      throw new TrainingInputError('发布前必须配置参训人员和培训场次', 409);
    }
    if (action === 'cancel' && !reason) throw new TrainingInputError('取消计划时请填写原因');
    if (['submit_review', 'complete'].includes(action)) {
      const unresolvedAttendance = current.participants.filter(person => person.attendanceStatus === 'INVITED');
      if (unresolvedAttendance.length) {
        throw new TrainingInputError(`还有 ${unresolvedAttendance.length} 名参训人员未登记签到结果`, 409);
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
        await tx.trainingSession.updateMany({
          where: { planId: current.id, status: 'SCHEDULED' },
          data: { status: 'IN_PROGRESS', actualStartAt: now, version: { increment: 1 } },
        });
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
      }
      await tx.trainingActivity.create({
        data: {
          planId: current.id,
          action,
          fromStatus: current.status,
          toStatus: nextStatus,
          content: action === 'cancel' ? `取消计划：${reason}` : `${current.status} → ${nextStatus}`,
          actorId: user.id,
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
          targetRoute: `/workspace/employees?view=training&planId=${current.id}`,
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
      detail: { code: current.code, fromStatus: current.status, toStatus: nextStatus, reason },
    });
    return NextResponse.json({ ok: true, plan: serializeTrainingPlan(updatedPlan, people) });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof TrainingInputError) return NextResponse.json({ ok: false, error: error.message }, { status: error.statusCode });
    console.error('training plan transition failed', error);
    return NextResponse.json({ ok: false, error: '培训计划状态更新失败' }, { status: 500 });
  }
}
