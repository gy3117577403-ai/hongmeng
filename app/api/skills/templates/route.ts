import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';
import { isProductionDepartment } from '@/lib/production-workforce';
import {
  cleanSkillText,
  parseBoundedInteger,
  parseSkillLevel,
  serializeTemplate,
  skillScopeKey,
  skillTemplateInclude,
  SkillInputError,
} from '@/lib/skills';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type TemplateItemInput = {
  section?: unknown;
  title?: unknown;
  description?: unknown;
  weight?: unknown;
  maxScore?: unknown;
  isRequired?: unknown;
  isCritical?: unknown;
};

type TemplateRemovalResult = {
  archived: boolean;
  assessmentCount: number;
  templateId: string;
  templateName: string;
};

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const name = cleanSkillText(body.name, 120);
    const department = cleanSkillText(body.department, 80);
    const position = cleanSkillText(body.position, 100);
    const team = cleanSkillText(body.team, 80);
    const skillId = cleanSkillText(body.skillId, 80);
    if (!name) throw new SkillInputError('请填写考核表名称');
    if (!department) throw new SkillInputError('请选择适用部门');
    if (!isProductionDepartment(department)) {
      throw new SkillInputError('技能等级考核只适用于生产员工');
    }
    if (!position) throw new SkillInputError('请选择适用岗位');
    if (!skillId) throw new SkillInputError('请选择考核技能');
    const skill = await prisma.skillDefinition.findFirst({
      where: { id: skillId, isActive: true },
      select: { id: true, name: true },
    });
    if (!skill) throw new SkillInputError('所选技能不存在或已停用', 404);

    const targetLevel = parseSkillLevel(body.targetLevel, '目标等级');
    const passScore = parseBoundedInteger(body.passScore ?? 80, '合格分', 1, 100);
    const validityMonths = parseBoundedInteger(body.validityMonths ?? 12, '有效期', 1, 120);
    const rawItems = Array.isArray(body.items) ? body.items as TemplateItemInput[] : [];
    if (!rawItems.length) throw new SkillInputError('考核表至少需要一个考核项目');
    if (rawItems.length > 60) throw new SkillInputError('单张考核表最多 60 个考核项目');
    const items = rawItems.map((rawItem, index) => {
      const title = cleanSkillText(rawItem.title, 160);
      if (!title) throw new SkillInputError(`第 ${index + 1} 个考核项目缺少名称`);
      return {
        code: `I${String(index + 1).padStart(2, '0')}`,
        section: cleanSkillText(rawItem.section, 60) || '岗位实操',
        title,
        description: cleanSkillText(rawItem.description, 500) || null,
        weight: parseBoundedInteger(rawItem.weight ?? 1, `第 ${index + 1} 项权重`, 1, 1000),
        maxScore: parseBoundedInteger(rawItem.maxScore ?? 100, `第 ${index + 1} 项满分`, 1, 1000),
        isRequired: rawItem.isRequired !== false,
        isCritical: Boolean(rawItem.isCritical),
        sortOrder: index,
      };
    });
    if (!items.some(item => item.isRequired)) {
      throw new SkillInputError('考核表至少需要一个必考项目');
    }

    const baseTemplateId = cleanSkillText(body.baseTemplateId, 80);
    const baseTemplate = baseTemplateId
      ? await prisma.skillAssessmentTemplate.findUnique({
        where: { id: baseTemplateId },
        select: { id: true, version: true },
      })
      : null;
    if (baseTemplateId && !baseTemplate) throw new SkillInputError('原考核模板不存在', 404);
    const version = baseTemplate ? baseTemplate.version + 1 : 1;
    const code = `SAT-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${crypto.randomUUID().slice(0, 6).toUpperCase()}-V${version}`;
    const template = await prisma.$transaction(async tx => {
      if (baseTemplate) {
        await tx.skillAssessmentTemplate.update({
          where: { id: baseTemplate.id },
          data: { status: 'REPLACED' },
        });
      }
      const created = await tx.skillAssessmentTemplate.create({
        data: {
          code,
          name,
          department,
          position,
          team,
          skillId,
          version,
          passScore,
          targetLevel,
          validityMonths,
          instructions: cleanSkillText(body.instructions, 1200) || null,
          createdById: user.id,
          items: { create: items },
        },
        include: skillTemplateInclude,
      });
      const scopeKey = skillScopeKey(department, position, team);
      await tx.positionSkillRequirement.upsert({
        where: { scopeKey_skillId: { scopeKey, skillId } },
        create: {
          scopeKey,
          department,
          position,
          team,
          skillId,
          targetLevel,
          isRequired: true,
        },
        update: {
          targetLevel,
          isRequired: true,
          version: { increment: 1 },
        },
      });
      return created;
    });
    await logOp({
      userId: user.id,
      action: baseTemplate ? 'create_skill_template_version' : 'create_skill_assessment_template',
      targetType: 'skill_assessment_template',
      targetId: template.id,
      detail: {
        code: template.code,
        name: template.name,
        department,
        position,
        skill: skill.name,
        targetLevel,
        itemCount: items.length,
      },
    });
    return NextResponse.json({ ok: true, template: serializeTemplate(template) }, { status: 201 });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof SkillInputError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.statusCode });
    }
    console.error('skill assessment template create failed', error);
    return NextResponse.json({ ok: false, error: '岗位技能考核表创建失败' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const templateId = cleanSkillText(body.templateId, 80);
    if (!templateId) throw new SkillInputError('请选择需要删除的岗位考核表');

    const result = await prisma.$transaction(async tx => {
      const template = await tx.skillAssessmentTemplate.findUnique({
        where: { id: templateId },
        select: {
          id: true,
          name: true,
          code: true,
          status: true,
          _count: { select: { assessments: true } },
        },
      });
      if (!template || template.status === 'DISABLED') {
        throw new SkillInputError('岗位考核表不存在或已删除', 404);
      }

      const assessmentCount = template._count.assessments;
      if (assessmentCount > 0) {
        await tx.skillAssessmentTemplate.update({
          where: { id: template.id },
          data: { status: 'DISABLED' },
        });
      } else {
        await tx.skillAssessmentTemplate.delete({
          where: { id: template.id },
        });
      }

      return {
        archived: assessmentCount > 0,
        assessmentCount,
        templateId: template.id,
        templateName: template.name,
      } satisfies TemplateRemovalResult;
    });

    await logOp({
      userId: user.id,
      action: result.archived ? 'archive_skill_assessment_template' : 'delete_skill_assessment_template',
      targetType: 'skill_assessment_template',
      targetId: result.templateId,
      detail: {
        name: result.templateName,
        assessmentCount: result.assessmentCount,
        historicalAssessmentsRetained: result.archived,
      },
    });

    return NextResponse.json({
      ok: true,
      removedTemplateId: result.templateId,
      archived: result.archived,
      retainedAssessmentCount: result.assessmentCount,
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof SkillInputError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.statusCode });
    }
    console.error('skill assessment template delete failed', error);
    return NextResponse.json({ ok: false, error: '岗位技能考核表删除失败' }, { status: 500 });
  }
}
