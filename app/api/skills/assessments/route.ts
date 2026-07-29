import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';
import {
  cleanSkillText,
  parseSkillLevel,
  serializeAssessment,
  skillAssessmentInclude,
  SkillInputError,
} from '@/lib/skills';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function activeEmployee(id: string, label: string) {
  const employee = await prisma.employee.findFirst({ where: { id, isActive: true } });
  if (!employee) throw new SkillInputError(`${label}不是在岗员工`);
  return employee;
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const employeeId = cleanSkillText(body.employeeId, 80);
    const templateId = cleanSkillText(body.templateId, 80);
    const assessorId = cleanSkillText(body.assessorId, 80);
    const reviewerId = cleanSkillText(body.reviewerId, 80);
    if (!employeeId) throw new SkillInputError('请选择被考核员工');
    if (!templateId) throw new SkillInputError('请选择岗位考核表');
    if (!assessorId) throw new SkillInputError('请选择填报或考核人');
    if (!reviewerId) throw new SkillInputError('请选择审核人');
    if (reviewerId === employeeId) throw new SkillInputError('被考核员工不能审核自己的考核');
    if (reviewerId === assessorId) throw new SkillInputError('审核人应与填报或考核人分开');
    const [employee, assessor, reviewer, template] = await Promise.all([
      activeEmployee(employeeId, '被考核员工'),
      activeEmployee(assessorId, '填报或考核人'),
      activeEmployee(reviewerId, '审核人'),
      prisma.skillAssessmentTemplate.findFirst({
        where: { id: templateId, status: 'ACTIVE' },
        include: { items: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] } },
      }),
    ]);
    if (!template) throw new SkillInputError('考核表不存在或已停用', 404);
    if (!template.skillId) throw new SkillInputError('考核表尚未关联技能');
    if (template.department && template.department !== (employee.department || '')) {
      throw new SkillInputError('所选考核表不适用于该员工部门');
    }
    if (template.position && template.position !== (employee.position || '')) {
      throw new SkillInputError('所选考核表不适用于该员工岗位');
    }
    if (template.team && template.team !== (employee.team || '')) {
      throw new SkillInputError('所选考核表不适用于该员工班组');
    }
    const proposedLevel = parseSkillLevel(body.proposedLevel ?? template.targetLevel, '拟认证等级');
    const code = `SKA-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${crypto.randomUUID().slice(0, 7).toUpperCase()}`;
    const assessment = await prisma.$transaction(async tx => {
      const created = await tx.skillAssessment.create({
        data: {
          code,
          employeeId,
          skillId: template.skillId!,
          templateId: template.id,
          templateVersion: template.version,
          assessorId,
          reviewerId,
          proposedLevel,
          createdById: user.id,
          updatedById: user.id,
          answers: {
            create: template.items.map(item => ({ itemId: item.id })),
          },
          activities: {
            create: {
              action: 'create',
              toStatus: 'DRAFT',
              content: `${employee.name} · ${template.name} V${template.version} · 审核人 ${reviewer.name}`,
              actorId: user.id,
            },
          },
        },
      });
      return tx.skillAssessment.findUniqueOrThrow({
        where: { id: created.id },
        include: skillAssessmentInclude,
      });
    });
    const people = new Map([
      [employee.id, employee],
      [assessor.id, assessor],
      [reviewer.id, reviewer],
    ]);
    await logOp({
      userId: user.id,
      action: 'create_skill_assessment',
      targetType: 'skill_assessment',
      targetId: assessment.id,
      detail: {
        code: assessment.code,
        employee: employee.name,
        template: template.name,
        assessor: assessor.name,
        reviewer: reviewer.name,
      },
    });
    return NextResponse.json({
      ok: true,
      assessment: serializeAssessment(assessment, people),
    }, { status: 201 });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof SkillInputError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.statusCode });
    }
    console.error('skill assessment create failed', error);
    return NextResponse.json({ ok: false, error: '技能考核任务创建失败' }, { status: 500 });
  }
}
