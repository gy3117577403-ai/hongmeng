import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';
import { trainingPlanCanUnarchive } from '@/lib/training-plan-lifecycle';
import { cleanTrainingText, TrainingInputError } from '@/lib/training';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const current = await prisma.trainingPlan.findFirst({ where: { id: params.id, deletedAt: null } });
    if (!current) return NextResponse.json({ ok: false, error: '培训计划不存在或已删除' }, { status: 404 });
    if (!trainingPlanCanUnarchive(current.status, current.archivedAt)) {
      throw new TrainingInputError('当前计划未归档，不能取消归档', 409);
    }
    if (body.confirmed !== true) throw new TrainingInputError('请先确认取消归档');
    const reason = cleanTrainingText(body.reason, 500) || '重新开放历史计划查看';
    const expectedVersion = Number(body.version ?? current.version);
    const updated = await prisma.$transaction(async tx => {
      const result = await tx.trainingPlan.updateMany({
        where: { id: current.id, version: expectedVersion, status: current.status, deletedAt: null, archivedAt: current.archivedAt },
        data: { archivedAt: null, archivedById: null, archiveReason: null, updatedById: user.id, version: { increment: 1 } },
      });
      if (result.count !== 1) throw new TrainingInputError('计划已被其他人更新，请刷新后重试', 409);
      await tx.trainingActivity.create({
        data: {
          planId: current.id,
          action: 'unarchive',
          fromStatus: current.status,
          toStatus: current.status,
          content: `取消归档：${reason}`,
          actorId: user.id,
          detail: { reason, previousArchivedAt: current.archivedAt?.toISOString() || null, previousArchiveReason: current.archiveReason },
        },
      });
      return tx.trainingPlan.findUniqueOrThrow({ where: { id: current.id }, select: { version: true } });
    });
    await logOp({ userId: user.id, action: 'unarchive_training_plan', targetType: 'training_plan', targetId: current.id, detail: { code: current.code, reason } });
    return NextResponse.json({ ok: true, version: updated.version });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof TrainingInputError) return NextResponse.json({ ok: false, error: error.message }, { status: error.statusCode });
    console.error('unarchive training plan failed', error);
    return NextResponse.json({ ok: false, error: '取消培训计划归档失败' }, { status: 500 });
  }
}
