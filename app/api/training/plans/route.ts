import { Prisma } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';
import {
  parsePlanInput,
  serializeTrainingPlan,
  TrainingInputError,
  trainingCode,
  trainingPlanInclude,
  type TrainingPerson,
} from '@/lib/training';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function peopleMap(ids?: readonly string[]) {
  const people = await prisma.employee.findMany({
    where: ids?.length ? { id: { in: [...new Set(ids)] } } : undefined,
    select: { id: true, employeeNo: true, name: true, department: true, position: true, team: true, isActive: true },
  });
  return new Map(people.map(person => [person.id, person as TrainingPerson]));
}

export async function GET() {
  try {
    await requireUser();
    const rows = await prisma.trainingPlan.findMany({
      where: { deletedAt: null },
      include: trainingPlanInclude,
      orderBy: [{ startAt: 'desc' }, { updatedAt: 'desc' }],
      take: 500,
    });
    const roleIds = rows.flatMap(row => [row.organizerId, row.trainerId, row.reviewerId]).filter((id): id is string => Boolean(id));
    const people = await peopleMap(roleIds);
    return NextResponse.json({ ok: true, plans: rows.map(row => serializeTrainingPlan(row, people)) });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error('training plan list failed', error);
    return NextResponse.json({ ok: false, error: '培训计划加载失败' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const input = parsePlanInput(body);
    if (!input.participantIds.length) throw new TrainingInputError('请至少选择一名参训人员');
    const [course, participants] = await Promise.all([
      input.courseId ? prisma.trainingCourse.findFirst({ where: { id: input.courseId, deletedAt: null }, include: { skill: true } }) : null,
      prisma.employee.findMany({ where: { id: { in: input.participantIds }, isActive: true } }),
    ]);
    if (input.courseId && !course) throw new TrainingInputError('所选课程不存在或已删除');
    if (participants.length !== input.participantIds.length) throw new TrainingInputError('参训人员包含离职或不存在的员工', 409);
    const employeeIds = new Set(participants.map(person => person.id));
    for (const [id, label] of [[input.organizerId, '组织人'], [input.trainerId, '讲师'], [input.reviewerId, '审核人']] as const) {
      if (id && !employeeIds.has(id)) {
        const exists = await prisma.employee.findFirst({ where: { id, isActive: true }, select: { id: true } });
        if (!exists) throw new TrainingInputError(`${label}不是在岗员工`);
      }
    }
    const assessmentMode = body.assessmentMode === undefined && course ? course.assessmentMode : input.assessmentMode;
    const passScore = assessmentMode === 'NONE' ? null : (body.passScore === undefined && course ? course.passScore : input.passScore) ?? 80;
    const isRequired = body.isRequired === undefined && course ? course.isRequired : input.isRequired;
    const mode = body.mode === undefined && course ? course.mode : input.mode;
    const courseSnapshot = course ? {
      id: course.id,
      code: course.code,
      name: course.name,
      category: course.category,
      objective: course.objective,
      description: course.description,
      targetAudience: course.targetAudience,
      version: course.version,
      skillId: course.skillId,
      skillName: course.skill?.name || null,
      targetLevel: course.targetLevel,
      validityMonths: course.validityMonths,
      retrainingMonths: course.retrainingMonths,
    } satisfies Prisma.InputJsonObject : null;
    const plan = await prisma.$transaction(async tx => {
      const created = await tx.trainingPlan.create({
        data: {
          code: trainingCode('TRP'),
          title: input.title,
          courseId: input.courseId,
          courseVersion: course?.version || null,
          courseSnapshot: courseSnapshot ?? Prisma.JsonNull,
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
          mode,
          isRequired,
          assessmentMode,
          passScore,
          createdById: user.id,
          updatedById: user.id,
          sessions: {
            create: {
              name: '主培训场次',
              sequence: 1,
              startAt: input.startAt,
              endAt: input.endAt,
              location: input.location,
              trainerId: input.trainerId,
            },
          },
          participants: {
            create: participants.map(person => ({
              employeeId: person.id,
              employeeNoSnapshot: person.employeeNo,
              employeeNameSnapshot: person.name,
              departmentSnapshot: person.department,
              positionSnapshot: person.position,
              teamSnapshot: person.team,
              isRequired,
              // A score only becomes reviewable after the executor submits it.
              // Creating a future plan must not manufacture pending-review work.
              reviewStatus: 'NOT_REQUIRED',
              reviewerId: input.reviewerId,
            })),
          },
        },
      });
      await tx.trainingActivity.create({
        data: {
          planId: created.id,
          action: 'create',
          toStatus: created.status,
          content: `创建计划，参训 ${participants.length} 人`,
          actorId: user.id,
          detail: { participantCount: participants.length, courseId: input.courseId },
        },
      });
      return tx.trainingPlan.findUniqueOrThrow({ where: { id: created.id }, include: trainingPlanInclude });
    });
    const people = await peopleMap([input.organizerId, input.trainerId, input.reviewerId].filter((id): id is string => Boolean(id)));
    await logOp({
      userId: user.id,
      action: 'create_training_plan',
      targetType: 'training_plan',
      targetId: plan.id,
      detail: { code: plan.code, title: plan.title, participantCount: participants.length, courseId: plan.courseId },
    });
    return NextResponse.json({ ok: true, plan: serializeTrainingPlan(plan, people) }, { status: 201 });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof TrainingInputError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.statusCode });
    }
    console.error('create training plan failed', error);
    return NextResponse.json({ ok: false, error: '新建培训计划失败' }, { status: 500 });
  }
}
