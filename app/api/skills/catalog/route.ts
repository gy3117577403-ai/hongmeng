import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import {
  forbidden,
  ForbiddenError,
  requireAdmin,
  unauthorized,
  UnauthorizedError,
} from '@/lib/auth';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';
import { assertSameOriginMutationRequest } from '@/lib/request-origin';
import {
  cleanSkillText,
  parseBoundedInteger,
  parseSkillLevel,
  serializeSkill,
  SkillInputError,
} from '@/lib/skills';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function parseSubsidyConfiguration(body: Record<string, unknown>): {
  isSubsidyEligible: boolean;
  subsidyMinimumLevel: number | null;
} {
  const isSubsidyEligible = body.isSubsidyEligible === true;
  return {
    isSubsidyEligible,
    subsidyMinimumLevel: isSubsidyEligible
      ? parseSkillLevel(body.subsidyMinimumLevel ?? 1, '补贴申请最低等级')
      : null,
  };
}

async function assertUniqueActiveName(name: string, excludedId?: string): Promise<void> {
  const duplicate = await prisma.skillDefinition.findFirst({
    where: {
      name: { equals: name, mode: 'insensitive' },
      isActive: true,
      ...(excludedId ? { id: { not: excludedId } } : {}),
    },
    select: { id: true },
  });
  if (duplicate) throw new SkillInputError('已存在同名的启用参考技能', 409);
}

export async function POST(req: NextRequest) {
  try {
    assertSameOriginMutationRequest(req);
    const user = await requireAdmin();
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const action = cleanSkillText(body.action, 40) || 'create';

    if (action === 'sync_processes') {
      throw new SkillInputError('等级参考技能不再与产品明细工序同步，请在“技能设置”中维护参考项', 409);
    }

    if (action === 'create') {
      const name = cleanSkillText(body.name, 100);
      if (!name) throw new SkillInputError('请填写参考技能名称');
      await assertUniqueActiveName(name);
      const defaultValidityMonths = parseBoundedInteger(
        body.defaultValidityMonths ?? 12,
        '有效期',
        1,
        120,
      );
      const sortOrder = parseBoundedInteger(body.sortOrder ?? 100, '排序', 0, 9999);
      const subsidy = parseSubsidyConfiguration(body);
      const code = `REF-CUSTOM-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
      const skill = await prisma.skillDefinition.create({
        data: {
          code,
          name,
          category: 'PROCESS',
          description: cleanSkillText(body.description, 500) || null,
          sourceProcessDefinitionId: null,
          isCore: false,
          ...subsidy,
          isCritical: Boolean(body.isCritical),
          defaultValidityMonths,
          isActive: true,
          sortOrder,
        },
      });
      await logOp({
        userId: user.id,
        action: 'create_skill_reference',
        targetType: 'skill_definition',
        targetId: skill.id,
        detail: {
          code: skill.code,
          name: skill.name,
          isSubsidyEligible: skill.isSubsidyEligible,
          subsidyMinimumLevel: skill.subsidyMinimumLevel,
        },
      });
      return NextResponse.json({ ok: true, skill: serializeSkill(skill) }, { status: 201 });
    }

    if (action !== 'update') throw new SkillInputError('不支持的参考技能目录操作');
    const id = cleanSkillText(body.id, 80);
    const version = Number(body.version);
    if (!id) throw new SkillInputError('请选择要修改的参考技能');
    if (!Number.isInteger(version) || version < 0) {
      throw new SkillInputError('参考技能版本无效，请刷新后重试');
    }
    const current = await prisma.skillDefinition.findUnique({ where: { id } });
    if (!current) throw new SkillInputError('参考技能不存在或已被删除', 404);

    const requestedName = cleanSkillText(body.name, 100);
    const name = current.isCore ? current.name : requestedName;
    if (!name) throw new SkillInputError('请填写参考技能名称');
    const isActive = current.isCore ? true : body.isActive !== false;
    if (isActive) await assertUniqueActiveName(name, current.id);
    const subsidy = parseSubsidyConfiguration(body);
    const defaultValidityMonths = parseBoundedInteger(
      body.defaultValidityMonths ?? current.defaultValidityMonths,
      '有效期',
      1,
      120,
    );
    const sortOrder = parseBoundedInteger(body.sortOrder ?? current.sortOrder, '排序', 0, 9999);

    const updated = await prisma.skillDefinition.updateMany({
      where: { id: current.id, version },
      data: {
        name,
        category: 'PROCESS',
        description: cleanSkillText(body.description, 500) || null,
        sourceProcessDefinitionId: null,
        ...subsidy,
        isCritical: Boolean(body.isCritical),
        defaultValidityMonths,
        isActive,
        sortOrder,
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) {
      throw new SkillInputError('参考技能已被其他管理员更新，请刷新后重试', 409);
    }
    const skill = await prisma.skillDefinition.findUniqueOrThrow({ where: { id: current.id } });
    await logOp({
      userId: user.id,
      action: 'update_skill_reference',
      targetType: 'skill_definition',
      targetId: skill.id,
      detail: {
        before: {
          name: current.name,
          isActive: current.isActive,
          isSubsidyEligible: current.isSubsidyEligible,
          subsidyMinimumLevel: current.subsidyMinimumLevel,
        },
        after: {
          name: skill.name,
          isActive: skill.isActive,
          isSubsidyEligible: skill.isSubsidyEligible,
          subsidyMinimumLevel: skill.subsidyMinimumLevel,
        },
        historicalFactsRetained: true,
      },
    });
    return NextResponse.json({ ok: true, skill: serializeSkill(skill) });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof ForbiddenError) return forbidden('只有管理员可以维护等级参考技能和补贴资格');
    if (error instanceof SkillInputError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.statusCode });
    }
    if ((error as { code?: string }).code === 'P2002' || String(error).includes('Unique constraint')) {
      return NextResponse.json({ ok: false, error: '参考技能编号或名称已存在' }, { status: 409 });
    }
    console.error('skill reference catalog update failed', error);
    return NextResponse.json({ ok: false, error: '参考技能目录更新失败' }, { status: 500 });
  }
}
