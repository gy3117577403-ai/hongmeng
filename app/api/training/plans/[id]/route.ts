import { Prisma } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';
import { activeUserIdsForEmployees, createSystemNotification } from '@/lib/system-notifications';
import { ensureTrainingSessionAttendanceRows } from '@/lib/training-qr-service';
import {
  prepareTrainingPlanChange,
  readTrainingPlanLifecycleImpact,
  trainingPlanCanDelete,
} from '@/lib/training-plan-lifecycle';
import {
  cleanTrainingText,
  serializeTrainingPlan,
  TrainingInputError,
  trainingCourseSnapshot,
  trainingPlanInclude,
  type TrainingPerson,
} from '@/lib/training';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function planResponse(id: string) {
  const plan = await prisma.trainingPlan.findUniqueOrThrow({ where: { id }, include: trainingPlanInclude });
  const ids = [plan.organizerId, plan.trainerId, plan.reviewerId].filter((value): value is string => Boolean(value));
  const peopleRows = ids.length ? await prisma.employee.findMany({
    where: { id: { in: ids } },
    select: { id: true, employeeNo: true, name: true, department: true, position: true, team: true, isActive: true },
  }) : [];
  return serializeTrainingPlan(plan, new Map(peopleRows.map(person => [person.id, person as TrainingPerson])));
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireUser();
    const exists = await prisma.trainingPlan.findFirst({ where: { id: params.id, deletedAt: null }, select: { id: true } });
    if (!exists) return NextResponse.json({ ok: false, error: '培训计划不存在或已删除' }, { status: 404 });
    return NextResponse.json({ ok: true, plan: await planResponse(exists.id) });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error('training plan detail failed', error);
    return NextResponse.json({ ok: false, error: '培训计划详情加载失败' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const prepared = await prepareTrainingPlanChange(params.id, body);
    const {
      current,
      mainSession,
      input,
      expectedVersion,
      employees,
      course,
      changedFields,
      blockers,
      removedParticipantIds,
      requiresConfirmation,
      scheduleChanged,
    } = prepared;
    if (blockers.length) throw new TrainingInputError(blockers.join('；'), 409);
    if (!changedFields.length) return NextResponse.json({ ok: true, unchanged: true, plan: await planResponse(current.id) });
    const reason = cleanTrainingText(body.reason, 800);
    if (requiresConfirmation && body.confirmed !== true) {
      throw new TrainingInputError('已发布计划的变更必须先确认影响', 409);
    }
    if (requiresConfirmation && !reason) throw new TrainingInputError('变更已发布计划时请填写变更原因');
    const plan = await prisma.$transaction(async tx => {
      if (removedParticipantIds.length) {
        const changedFacts = await tx.trainingParticipant.count({
          where: {
            id: { in: removedParticipantIds },
            planId: current.id,
            OR: [
              { attendanceStatus: { not: 'INVITED' } },
              { checkInAt: { not: null } },
              { checkOutAt: { not: null } },
              { theoryScore: { not: null } },
              { practicalScore: { not: null } },
              { score: { not: null } },
              { submittedAt: { not: null } },
              { reviewStatus: { in: ['PENDING', 'APPROVED', 'RETURNED'] } },
              { certificationId: { not: null } },
              { sessionAttendances: { some: { status: { not: 'INVITED' } } } },
              { feedbacks: { some: {} } },
            ],
          },
        });
        if (changedFacts) throw new TrainingInputError('变更确认后又产生了签到、反馈或成绩事实，请刷新影响预览', 409);
      }
      const updated = await tx.trainingPlan.updateMany({
        where: { id: current.id, version: expectedVersion, status: current.status, deletedAt: null, archivedAt: null },
        data: {
          title: input.title,
          courseId: input.courseId,
          // A published plan is an immutable record of the course rules that were
          // issued to employees. A later schedule-only change must not silently
          // replace that snapshot when the reusable course has since been edited.
          courseVersion: current.status === 'PUBLISHED' ? current.courseVersion : (course?.version || null),
          courseSnapshot: current.status === 'PUBLISHED'
            ? (current.courseSnapshot === null ? Prisma.JsonNull : current.courseSnapshot as Prisma.InputJsonValue)
            : (course ? trainingCourseSnapshot(course) : Prisma.JsonNull),
          purpose: input.purpose,
          scopeType: input.scopeType,
          scopeDescription: input.scopeDescription,
          organizerId: input.organizerId,
          trainerId: input.trainerId,
          reviewerId: input.reviewerId,
          departmentId: input.departmentId,
          startAt: input.startAt,
          endAt: input.endAt,
          location: input.location,
          mode: input.mode,
          isRequired: input.isRequired,
          assessmentMode: input.assessmentMode,
          passScore: input.passScore,
          updatedById: user.id,
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) throw new TrainingInputError('计划已被其他人更新，请刷新后重试', 409);
      await tx.trainingSession.updateMany({
        where: { id: mainSession.id, planId: current.id, sequence: 1 },
        data: {
          name: '主培训场次',
          startAt: input.startAt,
          endAt: input.endAt,
          location: input.location,
          trainerId: input.trainerId,
          checkInOpenMinutes: input.checkInOpenMinutes,
          lateAfterMinutes: input.lateAfterMinutes,
          checkInCloseMinutes: input.checkInCloseMinutes,
          feedbackDeadlineHours: input.feedbackDeadlineHours,
          feedbackRequired: input.feedbackRequired,
          version: { increment: 1 },
        },
      });
      if (removedParticipantIds.length) {
        await tx.trainingParticipant.deleteMany({ where: { planId: current.id, id: { in: removedParticipantIds } } });
      }
      for (const employee of employees) {
        await tx.trainingParticipant.upsert({
          where: { planId_employeeId: { planId: current.id, employeeId: employee.id } },
          create: {
            planId: current.id,
            employeeId: employee.id,
            employeeNoSnapshot: employee.employeeNo,
            employeeNameSnapshot: employee.name,
            departmentSnapshot: employee.department,
            positionSnapshot: employee.position,
            teamSnapshot: employee.team,
            isRequired: input.isRequired,
            reviewStatus: 'NOT_REQUIRED',
            reviewerId: input.reviewerId,
          },
          update: {
            employeeNoSnapshot: employee.employeeNo,
            employeeNameSnapshot: employee.name,
            departmentSnapshot: employee.department,
            positionSnapshot: employee.position,
            teamSnapshot: employee.team,
            isRequired: input.isRequired,
            reviewerId: input.reviewerId,
            reviewStatus: input.assessmentMode === 'NONE' ? 'NOT_REQUIRED' : undefined,
            version: { increment: 1 },
          },
        });
      }
      await ensureTrainingSessionAttendanceRows(tx, current.id);
      if (current.status === 'PUBLISHED' && scheduleChanged) {
        await tx.trainingQrWindow.updateMany({
          where: { session: { planId: current.id }, status: { in: ['SCHEDULED', 'OPEN'] } },
          data: { status: 'REVOKED', closedAt: new Date(), closedById: user.id },
        });
      }
      await tx.trainingActivity.create({
        data: {
          planId: current.id,
          action: current.status === 'PUBLISHED' ? 'change_published_plan' : 'update_draft',
          fromStatus: current.status,
          toStatus: current.status,
          content: `${current.status === 'PUBLISHED' ? '变更已发布计划' : '更新草稿'}：${changedFields.map(field => field.label).join('、')}`,
          actorId: user.id,
          detail: {
            reason: reason || null,
            participantCount: employees.length,
            changes: changedFields.map(field => ({ key: field.key, label: field.label, before: field.before, after: field.after })),
          },
        },
      });
      if (current.status === 'PUBLISHED') {
        const recipientUserIds = await activeUserIdsForEmployees(tx, input.participantIds, { excludeUserIds: [user.id] });
        await createSystemNotification(tx, {
          eventType: 'TRAINING_PLAN_CHANGED',
          dedupeKey: `training-plan-changed:${current.id}:v${expectedVersion + 1}`,
          category: 'TODO',
          priority: current.isRequired ? 'HIGH' : 'NORMAL',
          title: `培训计划有变更：${input.title}`,
          body: `${reason}；变更项：${changedFields.map(field => field.label).join('、')}`,
          targetRoute: null,
          sourceType: 'training_plan',
          sourceId: current.id,
          actorId: user.id,
          metadata: { code: current.code, reason, changedFields: changedFields.map(field => field.key) },
          recipientUserIds,
        });
      }
      return tx.trainingPlan.findUniqueOrThrow({ where: { id: current.id }, include: trainingPlanInclude });
    });
    await logOp({
      userId: user.id,
      action: current.status === 'PUBLISHED' ? 'change_published_training_plan' : 'update_training_plan_draft',
      targetType: 'training_plan',
      targetId: current.id,
      detail: { code: current.code, reason: reason || null, participantCount: employees.length, changedFields: changedFields.map(field => field.key) },
    });
    const roleIds = [plan.organizerId, plan.trainerId, plan.reviewerId].filter((value): value is string => Boolean(value));
    const peopleRows = roleIds.length ? await prisma.employee.findMany({
      where: { id: { in: roleIds } },
      select: { id: true, employeeNo: true, name: true, department: true, position: true, team: true, isActive: true },
    }) : [];
    return NextResponse.json({ ok: true, plan: serializeTrainingPlan(plan, new Map(peopleRows.map(person => [person.id, person as TrainingPerson]))) });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof TrainingInputError) return NextResponse.json({ ok: false, error: error.message }, { status: error.statusCode });
    console.error('update training plan failed', error);
    return NextResponse.json({ ok: false, error: '培训计划保存失败' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const current = await prisma.trainingPlan.findFirst({ where: { id: params.id, deletedAt: null, archivedAt: null } });
    if (!current) return NextResponse.json({ ok: false, error: '培训计划不存在或已删除' }, { status: 404 });
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const reason = cleanTrainingText(body.reason, 500);
    const confirmationCode = cleanTrainingText(body.confirmationCode, 120);
    const expectedVersion = Number(body.version ?? current.version);
    if (!reason) throw new TrainingInputError('删除草稿时请填写原因');
    if (confirmationCode !== current.code) throw new TrainingInputError('请输入完整计划编号确认删除');
    const result = await prisma.$transaction(async tx => {
      const impact = await readTrainingPlanLifecycleImpact(tx, current.id);
      if (!trainingPlanCanDelete(current.status, impact)) {
        throw new TrainingInputError('只有未产生执行事实的草稿可以删除；已发布计划请取消，已完成计划请归档', 409);
      }
      const now = new Date();
      const updated = await tx.trainingPlan.updateMany({
        where: { id: current.id, version: expectedVersion, status: 'DRAFT', deletedAt: null, archivedAt: null },
        data: {
          deletedAt: now,
          deletedById: user.id,
          deleteReason: reason,
          restoredAt: null,
          restoredById: null,
          restoreReason: null,
          updatedById: user.id,
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) throw new TrainingInputError('计划已被其他人更新，请刷新后重试', 409);
      await tx.trainingActivity.create({
        data: {
          planId: current.id,
          action: 'soft_delete_draft',
          fromStatus: current.status,
          toStatus: current.status,
          content: `删除草稿：${reason}`,
          actorId: user.id,
          detail: { reason, impact },
        },
      });
      return { impact, deletedAt: now };
    });
    await logOp({ userId: user.id, action: 'soft_delete_training_plan_draft', targetType: 'training_plan', targetId: current.id, detail: { code: current.code, reason, impact: result.impact } });
    return NextResponse.json({ ok: true, deletedAt: result.deletedAt.toISOString(), recoverable: true });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof TrainingInputError) return NextResponse.json({ ok: false, error: error.message }, { status: error.statusCode });
    console.error('delete training plan failed', error);
    return NextResponse.json({ ok: false, error: '培训计划删除失败' }, { status: 500 });
  }
}
