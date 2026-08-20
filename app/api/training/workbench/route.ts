import { NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { hasCapability } from '@/lib/department-access';
import { prisma } from '@/lib/prisma';
import {
  serializeTrainingCourse,
  serializeTrainingPlan,
  summarizeTraining,
  trainingCourseInclude,
  trainingPlanInclude,
  type TrainingPerson,
} from '@/lib/training';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const user = await requireUser();
    const now = new Date();
    const expiryHorizon = new Date(now.getTime());
    expiryHorizon.setUTCMonth(expiryHorizon.getUTCMonth() + 3);
    const [employeeRows, skillRows, courseRows, planRows, expiryRows] = await Promise.all([
      prisma.employee.findMany({
        where: { isActive: true },
        orderBy: [{ department: 'asc' }, { team: 'asc' }, { employeeNo: 'asc' }],
        select: {
          id: true,
          employeeNo: true,
          name: true,
          department: true,
          position: true,
          team: true,
          isActive: true,
        },
      }),
      prisma.skillDefinition.findMany({
        where: { isActive: true },
        orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
        select: { id: true, code: true, name: true, category: true, defaultValidityMonths: true },
      }),
      prisma.trainingCourse.findMany({
        where: { deletedAt: null },
        include: trainingCourseInclude,
        orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
        take: 500,
      }),
      prisma.trainingPlan.findMany({
        where: { deletedAt: null },
        include: trainingPlanInclude,
        orderBy: [{ startAt: 'desc' }, { updatedAt: 'desc' }],
        take: 500,
      }),
      prisma.employeeSkillCertification.findMany({
        where: {
          status: 'ACTIVE',
          expiresAt: { not: null, lte: expiryHorizon },
          employee: { isActive: true },
        },
        include: { employee: true, skill: true },
        orderBy: { expiresAt: 'asc' },
        take: 200,
      }),
    ]);
    const people = new Map(employeeRows.map(person => [person.id, person as TrainingPerson]));
    const courses = courseRows.map(serializeTrainingCourse);
    const plans = planRows.map(plan => serializeTrainingPlan(plan, people));
    return NextResponse.json({
      ok: true,
      generatedAt: now.toISOString(),
      permissions: {
        canRead: hasCapability(user.access, 'TRAINING', 'READ') || hasCapability(user.access, 'HR', 'READ'),
        canCreate: hasCapability(user.access, 'TRAINING', 'CREATE') || hasCapability(user.access, 'HR', 'CREATE'),
        canUpdate: hasCapability(user.access, 'TRAINING', 'UPDATE') || hasCapability(user.access, 'HR', 'UPDATE'),
        canDelete: hasCapability(user.access, 'TRAINING', 'DELETE') || hasCapability(user.access, 'HR', 'DELETE'),
        canExecute: hasCapability(user.access, 'TRAINING', 'EXECUTE_WORKFLOW') || hasCapability(user.access, 'HR', 'EXECUTE_WORKFLOW'),
        actorEmployeeId: user.employeeId,
      },
      summary: summarizeTraining(plans, courses),
      employees: employeeRows,
      skills: skillRows,
      courses,
      plans,
      expiringCertifications: expiryRows.map(row => ({
        id: row.id,
        employeeId: row.employeeId,
        employeeNo: row.employee.employeeNo,
        employeeName: row.employee.name,
        department: row.employee.department,
        team: row.employee.team,
        skillId: row.skillId,
        skillCode: row.skill.code,
        skillName: row.skill.name,
        level: row.level,
        expiresAt: row.expiresAt?.toISOString().slice(0, 10) || null,
        expired: Boolean(row.expiresAt && row.expiresAt.getTime() < now.getTime()),
        requiresReassessment: row.requiresReassessment,
      })),
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error('training workbench load failed', error);
    return NextResponse.json({ ok: false, error: '培训发展数据加载失败' }, { status: 500 });
  }
}
