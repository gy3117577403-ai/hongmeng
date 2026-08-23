import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';
import { ensureTrainingSessionAttendanceRows } from '@/lib/training-qr-service';
import {
  cleanTrainingText,
  parsePlanInput,
  serializeTrainingPlan,
  TrainingInputError,
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
    const current = await prisma.trainingPlan.findFirst({
      where: { id: params.id, deletedAt: null },
      include: {
        participants: true,
        sessions: { where: { sequence: 1 }, take: 1 },
      },
    });
    if (!current) return NextResponse.json({ ok: false, error: '培训计划不存在或已删除' }, { status: 404 });
    if (!['DRAFT', 'PUBLISHED'].includes(current.status)) throw new TrainingInputError('计划开始后不能修改基础安排', 409);
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const input = parsePlanInput({
      title: body.title ?? current.title,
      courseId: body.courseId ?? current.courseId,
      purpose: body.purpose ?? current.purpose,
      scopeType: body.scopeType ?? current.scopeType,
      scopeDescription: body.scopeDescription ?? current.scopeDescription,
      organizerId: body.organizerId ?? current.organizerId,
      trainerId: body.trainerId ?? current.trainerId,
      reviewerId: body.reviewerId ?? current.reviewerId,
      departmentId: body.departmentId ?? current.departmentId,
      startAt: body.startAt ?? current.startAt.toISOString(),
      endAt: body.endAt ?? current.endAt.toISOString(),
      location: body.location ?? current.location,
      mode: body.mode ?? current.mode,
      isRequired: body.isRequired ?? current.isRequired,
      assessmentMode: body.assessmentMode ?? current.assessmentMode,
      passScore: body.passScore ?? current.passScore,
      checkInOpenMinutes: body.checkInOpenMinutes ?? current.sessions[0]?.checkInOpenMinutes,
      lateAfterMinutes: body.lateAfterMinutes ?? current.sessions[0]?.lateAfterMinutes,
      checkInCloseMinutes: body.checkInCloseMinutes ?? current.sessions[0]?.checkInCloseMinutes,
      feedbackDeadlineHours: body.feedbackDeadlineHours ?? current.sessions[0]?.feedbackDeadlineHours,
      feedbackRequired: body.feedbackRequired ?? current.sessions[0]?.feedbackRequired,
      participantIds: body.participantIds ?? current.participants.map(person => person.employeeId),
    });
    if (!input.participantIds.length) throw new TrainingInputError('请至少选择一名参训人员');
    const employees = await prisma.employee.findMany({ where: { id: { in: input.participantIds }, isActive: true } });
    if (employees.length !== input.participantIds.length) throw new TrainingInputError('参训人员包含离职或不存在的员工', 409);
    const expectedVersion = Number(body.version ?? current.version);
    await prisma.$transaction(async tx => {
      const updated = await tx.trainingPlan.updateMany({
        where: { id: current.id, version: expectedVersion, deletedAt: null },
        data: {
          title: input.title,
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
        where: { planId: current.id, sequence: 1 },
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
      await tx.trainingParticipant.deleteMany({ where: { planId: current.id, employeeId: { notIn: input.participantIds } } });
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
      await tx.trainingActivity.create({
        data: { planId: current.id, action: 'update', fromStatus: current.status, toStatus: current.status, content: `更新计划安排与人员，共 ${employees.length} 人`, actorId: user.id },
      });
    });
    await logOp({ userId: user.id, action: 'update_training_plan', targetType: 'training_plan', targetId: current.id, detail: { code: current.code, participantCount: employees.length } });
    return NextResponse.json({ ok: true, plan: await planResponse(current.id) });
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
    const current = await prisma.trainingPlan.findFirst({ where: { id: params.id, deletedAt: null } });
    if (!current) return NextResponse.json({ ok: false, error: '培训计划不存在或已删除' }, { status: 404 });
    if (['IN_PROGRESS', 'PENDING_REVIEW', 'COMPLETED'].includes(current.status)) {
      throw new TrainingInputError('执行中或已归档计划不能删除，可取消后保留审计记录', 409);
    }
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const reason = cleanTrainingText(body.reason, 500) || null;
    await prisma.trainingPlan.update({ where: { id: current.id }, data: { deletedAt: new Date(), cancelReason: reason, updatedById: user.id, version: { increment: 1 } } });
    await logOp({ userId: user.id, action: 'delete_training_plan', targetType: 'training_plan', targetId: current.id, detail: { code: current.code, reason } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof TrainingInputError) return NextResponse.json({ ok: false, error: error.message }, { status: error.statusCode });
    console.error('delete training plan failed', error);
    return NextResponse.json({ ok: false, error: '培训计划删除失败' }, { status: 500 });
  }
}
