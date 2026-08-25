import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';
import { isProductionDepartment } from '@/lib/production-workforce';
import {
  cleanSkillText,
  parseSkillLevel,
  serializeRequirement,
  skillScopeKey,
  SkillInputError,
} from '@/lib/skills';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const department = cleanSkillText(body.department, 80);
    const position = cleanSkillText(body.position, 100);
    const team = cleanSkillText(body.team, 80);
    const skillId = cleanSkillText(body.skillId, 80);
    if (!department) throw new SkillInputError('请选择部门');
    if (!isProductionDepartment(department)) {
      throw new SkillInputError('技能等级参考只适用于生产员工');
    }
    if (!position) throw new SkillInputError('请选择岗位');
    if (!skillId) throw new SkillInputError('请选择技能');
    const skill = await prisma.skillDefinition.findFirst({
      where: { id: skillId, isActive: true },
      select: { id: true, name: true },
    });
    if (!skill) throw new SkillInputError('所选技能不存在或已停用', 404);
    const scopeKey = skillScopeKey(department, position, team);
    const action = cleanSkillText(body.action, 30) || 'upsert';
    if (action === 'remove') {
      const existing = await prisma.positionSkillRequirement.findUnique({
        where: { scopeKey_skillId: { scopeKey, skillId } },
      });
      if (existing) {
        await prisma.positionSkillRequirement.delete({ where: { id: existing.id } });
        await logOp({
          userId: user.id,
          action: 'remove_position_skill_requirement',
          targetType: 'position_skill_requirement',
          targetId: existing.id,
          detail: { department, position, team, skill: skill.name },
        });
      }
      return NextResponse.json({ ok: true, removed: Boolean(existing) });
    }
    if (action !== 'upsert') throw new SkillInputError('不支持的岗位技能操作');
    const targetLevel = parseSkillLevel(body.targetLevel, '岗位目标等级');
    const requirement = await prisma.positionSkillRequirement.upsert({
      where: { scopeKey_skillId: { scopeKey, skillId } },
      create: {
        scopeKey,
        department,
        position,
        team,
        skillId,
        targetLevel,
        isRequired: body.isRequired !== false,
      },
      update: {
        targetLevel,
        isRequired: body.isRequired !== false,
        version: { increment: 1 },
      },
    });
    await logOp({
      userId: user.id,
      action: 'upsert_position_skill_requirement',
      targetType: 'position_skill_requirement',
      targetId: requirement.id,
      detail: { department, position, team, skill: skill.name, targetLevel },
    });
    return NextResponse.json({ ok: true, requirement: serializeRequirement(requirement) });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof SkillInputError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.statusCode });
    }
    console.error('position skill requirement update failed', error);
    return NextResponse.json({ ok: false, error: '岗位技能要求保存失败' }, { status: 500 });
  }
}
