import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';
import { cleanTrainingText, TrainingInputError } from '@/lib/training';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const current = await prisma.trainingPlan.findFirst({ where: { id: params.id, deletedAt: { not: null } } });
    if (!current) return NextResponse.json({ ok: false, error: '回收站中没有该培训计划' }, { status: 404 });
    if (current.status !== 'DRAFT') throw new TrainingInputError('仅草稿可以从回收站恢复', 409);
    const reason = cleanTrainingText(body.reason, 500);
    const confirmationCode = cleanTrainingText(body.confirmationCode, 120);
    const expectedVersion = Number(body.version ?? current.version);
    if (!reason) throw new TrainingInputError('恢复草稿时请填写原因');
    if (confirmationCode !== current.code) throw new TrainingInputError('请输入完整计划编号确认恢复');
    const now = new Date();
    const updated = await prisma.$transaction(async tx => {
      const result = await tx.trainingPlan.updateMany({
        where: { id: current.id, version: expectedVersion, status: 'DRAFT', deletedAt: current.deletedAt },
        data: {
          deletedAt: null,
          deletedById: null,
          deleteReason: null,
          restoredAt: now,
          restoredById: user.id,
          restoreReason: reason,
          updatedById: user.id,
          version: { increment: 1 },
        },
      });
      if (result.count !== 1) throw new TrainingInputError('草稿已被其他人处理，请刷新后重试', 409);
      await tx.trainingActivity.create({
        data: {
          planId: current.id,
          action: 'restore_draft',
          fromStatus: current.status,
          toStatus: current.status,
          content: `恢复草稿：${reason}`,
          actorId: user.id,
          detail: { reason, previousDeletedAt: current.deletedAt?.toISOString() || null, previousDeleteReason: current.deleteReason },
        },
      });
      return tx.trainingPlan.findUniqueOrThrow({ where: { id: current.id }, select: { version: true } });
    });
    await logOp({ userId: user.id, action: 'restore_training_plan_draft', targetType: 'training_plan', targetId: current.id, detail: { code: current.code, reason } });
    return NextResponse.json({ ok: true, restoredAt: now.toISOString(), version: updated.version });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof TrainingInputError) return NextResponse.json({ ok: false, error: error.message }, { status: error.statusCode });
    console.error('restore training plan failed', error);
    return NextResponse.json({ ok: false, error: '培训计划恢复失败' }, { status: 500 });
  }
}
