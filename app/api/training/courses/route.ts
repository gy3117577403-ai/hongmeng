import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';
import {
  parseCourseInput,
  serializeTrainingCourse,
  TrainingInputError,
  trainingCode,
  trainingCourseInclude,
} from '@/lib/training';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await requireUser();
    const rows = await prisma.trainingCourse.findMany({
      where: { deletedAt: null },
      include: trainingCourseInclude,
      orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
      take: 500,
    });
    return NextResponse.json({ ok: true, courses: rows.map(serializeTrainingCourse) });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error('training course list failed', error);
    return NextResponse.json({ ok: false, error: '培训课程加载失败' }, { status: 500 });
  }
}

async function validateReferences(skillId: string | null, ownerEmployeeId: string | null) {
  const [skill, owner] = await Promise.all([
    skillId ? prisma.skillDefinition.findFirst({ where: { id: skillId, isActive: true }, select: { id: true } }) : null,
    ownerEmployeeId ? prisma.employee.findFirst({ where: { id: ownerEmployeeId, isActive: true }, select: { id: true } }) : null,
  ]);
  if (skillId && !skill) throw new TrainingInputError('关联技能不存在或已停用');
  if (ownerEmployeeId && !owner) throw new TrainingInputError('课程负责人不是在岗员工');
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const input = parseCourseInput(body);
    await validateReferences(input.skillId, input.ownerEmployeeId);
    const course = await prisma.trainingCourse.create({
      data: {
        code: trainingCode('TRC'),
        ...input,
        createdById: user.id,
        updatedById: user.id,
      },
      include: trainingCourseInclude,
    });
    await logOp({
      userId: user.id,
      action: 'create_training_course',
      targetType: 'training_course',
      targetId: course.id,
      detail: { code: course.code, name: course.name, assessmentMode: course.assessmentMode, skillId: course.skillId },
    });
    return NextResponse.json({ ok: true, course: serializeTrainingCourse(course) }, { status: 201 });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof TrainingInputError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.statusCode });
    }
    console.error('create training course failed', error);
    return NextResponse.json({ ok: false, error: '新建培训课程失败' }, { status: 500 });
  }
}
