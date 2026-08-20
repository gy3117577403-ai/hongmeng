import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';
import {
  parseCourseInput,
  serializeTrainingCourse,
  TrainingInputError,
  trainingCourseInclude,
} from '@/lib/training';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const current = await prisma.trainingCourse.findFirst({ where: { id: params.id, deletedAt: null } });
    if (!current) return NextResponse.json({ ok: false, error: '培训课程不存在或已删除' }, { status: 404 });
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const input = parseCourseInput({
      name: body.name ?? current.name,
      category: body.category ?? current.category,
      objective: body.objective ?? current.objective,
      description: body.description ?? current.description,
      targetAudience: body.targetAudience ?? current.targetAudience,
      defaultDurationMinutes: body.defaultDurationMinutes ?? current.defaultDurationMinutes,
      mode: body.mode ?? current.mode,
      isRequired: body.isRequired ?? current.isRequired,
      assessmentMode: body.assessmentMode ?? current.assessmentMode,
      passScore: body.passScore ?? current.passScore,
      skillId: body.skillId ?? current.skillId,
      targetLevel: body.targetLevel ?? current.targetLevel,
      validityMonths: body.validityMonths ?? current.validityMonths,
      retrainingMonths: body.retrainingMonths ?? current.retrainingMonths,
      ownerEmployeeId: body.ownerEmployeeId ?? current.ownerEmployeeId,
      status: body.status ?? current.status,
    });
    if (input.skillId) {
      const skill = await prisma.skillDefinition.findFirst({ where: { id: input.skillId, isActive: true }, select: { id: true } });
      if (!skill) throw new TrainingInputError('关联技能不存在或已停用');
    }
    if (input.ownerEmployeeId) {
      const owner = await prisma.employee.findFirst({ where: { id: input.ownerEmployeeId, isActive: true }, select: { id: true } });
      if (!owner) throw new TrainingInputError('课程负责人不是在岗员工');
    }
    const expectedVersion = Number(body.version ?? current.version);
    const updated = await prisma.trainingCourse.updateMany({
      where: { id: current.id, version: expectedVersion, deletedAt: null },
      data: { ...input, updatedById: user.id, version: { increment: 1 } },
    });
    if (updated.count !== 1) throw new TrainingInputError('课程已被其他人更新，请刷新后重试', 409);
    const course = await prisma.trainingCourse.findUniqueOrThrow({ where: { id: current.id }, include: trainingCourseInclude });
    await logOp({
      userId: user.id,
      action: 'update_training_course',
      targetType: 'training_course',
      targetId: course.id,
      detail: { code: course.code, version: course.version },
    });
    return NextResponse.json({ ok: true, course: serializeTrainingCourse(course) });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof TrainingInputError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.statusCode });
    }
    console.error('update training course failed', error);
    return NextResponse.json({ ok: false, error: '培训课程保存失败' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const current = await prisma.trainingCourse.findFirst({
      where: { id: params.id, deletedAt: null },
      select: { id: true, code: true, name: true, _count: { select: { plans: { where: { deletedAt: null } } } } },
    });
    if (!current) return NextResponse.json({ ok: false, error: '培训课程不存在或已删除' }, { status: 404 });
    if (current._count.plans > 0) {
      return NextResponse.json({ ok: false, error: '课程已有培训计划引用，请停用课程而不是删除' }, { status: 409 });
    }
    await prisma.trainingCourse.update({ where: { id: current.id }, data: { deletedAt: new Date(), updatedById: user.id, version: { increment: 1 } } });
    await logOp({ userId: user.id, action: 'delete_training_course', targetType: 'training_course', targetId: current.id, detail: { code: current.code, name: current.name } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error('delete training course failed', error);
    return NextResponse.json({ ok: false, error: '培训课程删除失败' }, { status: 500 });
  }
}
