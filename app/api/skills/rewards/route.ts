import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';
import {
  cleanSkillText,
  parseBoundedInteger,
  parseSkillLevel,
  serializeRewardRule,
  SkillInputError,
} from '@/lib/skills';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const action = cleanSkillText(body.action, 30) || 'upsert';
    const id = cleanSkillText(body.id, 80);
    const version = Number(body.version);

    if (action === 'remove') {
      if (!id) throw new SkillInputError('请选择要删除的奖励规则');
      if (!Number.isInteger(version) || version < 0) throw new SkillInputError('奖励规则版本无效，请刷新后重试');
      const existing = await prisma.skillRewardRule.findUnique({
        where: { id },
        include: { skill: { select: { name: true } } },
      });
      if (!existing) throw new SkillInputError('奖励规则已删除或不存在', 404);
      const removed = await prisma.skillRewardRule.deleteMany({ where: { id, version } });
      if (removed.count !== 1) throw new SkillInputError('奖励规则已被其他人更新，请刷新后重试', 409);
      await logOp({
        userId: user.id,
        action: 'remove_skill_reward_rule',
        targetType: 'skill_reward_rule',
        targetId: id,
        detail: {
          jobName: existing.jobName,
          jobKeyword: existing.jobKeyword,
          skill: existing.skill.name,
          minimumLevel: existing.minimumLevel,
          rewardName: existing.rewardName,
        },
      });
      return NextResponse.json({ ok: true, removed: true });
    }

    if (action !== 'upsert') throw new SkillInputError('不支持的奖励规则操作');
    const jobName = cleanSkillText(body.jobName, 80);
    const jobKeyword = cleanSkillText(body.jobKeyword, 60);
    const skillId = cleanSkillText(body.skillId, 80);
    const rewardName = cleanSkillText(body.rewardName, 100);
    const rewardDescription = cleanSkillText(body.rewardDescription, 500) || null;
    const minimumLevel = parseSkillLevel(body.minimumLevel, '奖励门槛');
    const sortOrder = parseBoundedInteger(body.sortOrder ?? 0, '排序', 0, 9999);
    if (!jobName) throw new SkillInputError('请填写奖励岗位名称');
    if (!jobKeyword) throw new SkillInputError('请填写岗位匹配关键字');
    if (!skillId) throw new SkillInputError('请选择奖励技能');
    if (!rewardName) throw new SkillInputError('请填写奖励名称');

    const skill = await prisma.skillDefinition.findFirst({
      where: { id: skillId, isActive: true },
      select: { id: true, name: true },
    });
    if (!skill) throw new SkillInputError('所选奖励技能不存在或已停用', 404);

    let rule;
    if (id) {
      if (!Number.isInteger(version) || version < 0) throw new SkillInputError('奖励规则版本无效，请刷新后重试');
      const updated = await prisma.skillRewardRule.updateMany({
        where: { id, version },
        data: {
          jobName,
          jobKeyword,
          skillId,
          minimumLevel,
          rewardName,
          rewardDescription,
          isActive: body.isActive !== false,
          sortOrder,
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) throw new SkillInputError('奖励规则已被其他人更新，请刷新后重试', 409);
      rule = await prisma.skillRewardRule.findUniqueOrThrow({ where: { id } });
    } else {
      rule = await prisma.skillRewardRule.create({
        data: {
          code: `RR-${Date.now().toString(36).toUpperCase()}-${randomUUID().slice(0, 6).toUpperCase()}`,
          jobName,
          jobKeyword,
          skillId,
          minimumLevel,
          rewardName,
          rewardDescription,
          isActive: body.isActive !== false,
          sortOrder,
        },
      });
    }

    await logOp({
      userId: user.id,
      action: id ? 'update_skill_reward_rule' : 'create_skill_reward_rule',
      targetType: 'skill_reward_rule',
      targetId: rule.id,
      detail: {
        jobName,
        jobKeyword,
        skill: skill.name,
        minimumLevel,
        rewardName,
        isActive: rule.isActive,
      },
    });
    return NextResponse.json({ ok: true, rewardRule: serializeRewardRule(rule) }, { status: id ? 200 : 201 });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof SkillInputError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.statusCode });
    }
    if (typeof error === 'object' && error && 'code' in error && error.code === 'P2002') {
      return NextResponse.json({ ok: false, error: '同一岗位关键字与技能只能配置一条奖励规则' }, { status: 409 });
    }
    console.error('skill reward rule update failed', error);
    return NextResponse.json({ ok: false, error: '技能奖励规则保存失败' }, { status: 500 });
  }
}
