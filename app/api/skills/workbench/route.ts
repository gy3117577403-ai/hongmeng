import { NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import {
  serializeAssessment,
  serializeCertification,
  serializeEmployee,
  serializeRequirement,
  serializeRewardRule,
  serializeSkill,
  serializeTemplate,
  skillAssessmentInclude,
  skillTemplateInclude,
  summarizeSkillWorkbench,
} from '@/lib/skills';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await requireUser();
    const [
      employees,
      skills,
      requirements,
      certifications,
      rewardRules,
      templates,
      assessments,
    ] = await Promise.all([
      prisma.employee.findMany({
        orderBy: [{ isActive: 'desc' }, { employeeNo: 'asc' }],
        take: 1000,
      }),
      prisma.skillDefinition.findMany({
        orderBy: [{ isActive: 'desc' }, { sortOrder: 'asc' }, { name: 'asc' }],
        take: 500,
      }),
      prisma.positionSkillRequirement.findMany({
        orderBy: [{ department: 'asc' }, { position: 'asc' }, { team: 'asc' }],
        take: 3000,
      }),
      prisma.employeeSkillCertification.findMany({
        orderBy: [{ updatedAt: 'desc' }],
        take: 5000,
      }),
      prisma.skillRewardRule.findMany({
        orderBy: [{ isActive: 'desc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
        take: 500,
      }),
      prisma.skillAssessmentTemplate.findMany({
        where: { status: { not: 'DISABLED' } },
        include: skillTemplateInclude,
        orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
        take: 500,
      }),
      prisma.skillAssessment.findMany({
        include: skillAssessmentInclude,
        orderBy: [{ updatedAt: 'desc' }],
        take: 1000,
      }),
    ]);
    const employeeDtos = employees.map(serializeEmployee);
    const skillDtos = skills.map(serializeSkill);
    const requirementDtos = requirements.map(serializeRequirement);
    const certificationDtos = certifications.map(serializeCertification);
    const employeesById = new Map(employees.map(employee => [employee.id, employee]));
    const assessmentDtos = assessments.map(assessment => serializeAssessment(assessment, employeesById));
    const summary = summarizeSkillWorkbench({
      employees: employeeDtos,
      skills: skillDtos,
      requirements: requirementDtos,
      certifications: certificationDtos,
      pendingReviewCount: assessments.filter(assessment => assessment.status === 'PENDING_REVIEW').length,
    });
    return NextResponse.json({
      ok: true,
      employees: employeeDtos,
      skills: skillDtos,
      requirements: requirementDtos,
      certifications: certificationDtos,
      rewardRules: rewardRules.map(serializeRewardRule),
      templates: templates.map(serializeTemplate),
      assessments: assessmentDtos,
      summary,
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error('skill workbench load failed', error);
    return NextResponse.json({ ok: false, error: '技能绩效工作台加载失败' }, { status: 500 });
  }
}
