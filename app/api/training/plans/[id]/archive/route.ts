import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';
import {
  readTrainingPlanLifecycleImpact,
  trainingPlanCanArchive,
} from '@/lib/training-plan-lifecycle';
import { cleanTrainingText, TrainingInputError } from '@/lib/training';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const current = await prisma.trainingPlan.findFirst({ where: { id: params.id, deletedAt: null } });
    if (!current) return NextResponse.json({ ok: false, error: '培训计划不存在或已删除' }, { status: 404 });
    if (!trainingPlanCanArchive(current.status, current.archivedAt)) {
      throw new TrainingInputError('只有已完成或已取消且尚未归档的计划可以归档', 409);
    }
    if (body.confirmed !== true) throw new TrainingInputError('请先确认归档影响');
    const reason = cleanTrainingText(body.reason, 500) || '计划资料已核对，转入历史归档';
    const expectedVersion = Number(body.version ?? current.version);
    const result = await prisma.$transaction(async tx => {
      const impact = await readTrainingPlanLifecycleImpact(tx, current.id);
      const now = new Date();
      const updated = await tx.trainingPlan.updateMany({
        where: { id: current.id, version: expectedVersion, status: current.status, deletedAt: null, archivedAt: null },
        data: { archivedAt: now, archivedById: user.id, archiveReason: reason, updatedById: user.id, version: { increment: 1 } },
      });
      if (updated.count !== 1) throw new TrainingInputError('计划已被其他人更新，请刷新后重试', 409);
      await tx.trainingActivity.create({
        data: {
          planId: current.id,
          action: 'archive',
          fromStatus: current.status,
          toStatus: current.status,
          content: `归档计划：${reason}`,
          actorId: user.id,
          detail: { reason, impact },
        },
      });
      return { archivedAt: now, impact };
    });
    await logOp({ userId: user.id, action: 'archive_training_plan', targetType: 'training_plan', targetId: current.id, detail: { code: current.code, reason, impact: result.impact } });
    return NextResponse.json({ ok: true, archivedAt: result.archivedAt.toISOString() });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof TrainingInputError) return NextResponse.json({ ok: false, error: error.message }, { status: error.statusCode });
    console.error('archive training plan failed', error);
    return NextResponse.json({ ok: false, error: '培训计划归档失败' }, { status: 500 });
  }
}
