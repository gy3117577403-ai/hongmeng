import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';
import {
  cleanSkillText,
  parseBoundedInteger,
  serializeSkill,
  SkillInputError,
} from '@/lib/skills';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const categories = new Set(['PROCESS', 'QUALITY', 'WAREHOUSE', 'SAFETY', 'MANAGEMENT', 'GENERAL']);

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const action = cleanSkillText(body.action, 40) || 'create';

    if (action === 'sync_processes') {
      const processes = await prisma.processDefinition.findMany({
        where: { isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        take: 500,
      });
      const result = await prisma.$transaction(async tx => {
        let created = 0;
        let updated = 0;
        for (const process of processes) {
          const existing = await tx.skillDefinition.findUnique({
            where: { sourceProcessDefinitionId: process.id },
            select: { id: true },
          });
          await tx.skillDefinition.upsert({
            where: { sourceProcessDefinitionId: process.id },
            create: {
              code: `PROC-${process.code}`.slice(0, 120),
              name: process.name,
              category: 'PROCESS',
              description: `${process.stageGroup}工序能力`,
              sourceProcessDefinitionId: process.id,
              sortOrder: process.sortOrder,
            },
            update: {
              name: process.name,
              description: `${process.stageGroup}工序能力`,
              sortOrder: process.sortOrder,
              isActive: true,
            },
          });
          if (existing) updated += 1;
          else created += 1;
        }
        return { created, updated, total: processes.length };
      });
      await logOp({
        userId: user.id,
        action: 'sync_skill_catalog_from_processes',
        targetType: 'skill_definition',
        detail: result,
      });
      return NextResponse.json({ ok: true, result });
    }

    if (action !== 'create') throw new SkillInputError('不支持的技能目录操作');
    const name = cleanSkillText(body.name, 100);
    if (!name) throw new SkillInputError('请填写技能名称');
    const category = cleanSkillText(body.category, 30) || 'GENERAL';
    if (!categories.has(category)) throw new SkillInputError('技能分类不正确');
    const defaultValidityMonths = parseBoundedInteger(
      body.defaultValidityMonths ?? 12,
      '有效期',
      1,
      120,
    );
    const providedCode = cleanSkillText(body.code, 100).toUpperCase();
    const code = providedCode || `SKL-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
    const skill = await prisma.skillDefinition.create({
      data: {
        code,
        name,
        category,
        description: cleanSkillText(body.description, 500) || null,
        isCritical: Boolean(body.isCritical),
        defaultValidityMonths,
      },
    });
    await logOp({
      userId: user.id,
      action: 'create_skill_definition',
      targetType: 'skill_definition',
      targetId: skill.id,
      detail: { code: skill.code, name: skill.name, category: skill.category },
    });
    return NextResponse.json({ ok: true, skill: serializeSkill(skill) }, { status: 201 });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof SkillInputError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.statusCode });
    }
    if (String(error).includes('Unique constraint')) {
      return NextResponse.json({ ok: false, error: '技能编号已存在' }, { status: 409 });
    }
    console.error('skill catalog update failed', error);
    return NextResponse.json({ ok: false, error: '技能目录更新失败' }, { status: 500 });
  }
}
