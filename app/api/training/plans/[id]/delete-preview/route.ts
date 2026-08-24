import { NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import {
  readTrainingPlanLifecycleImpact,
  trainingPlanCanDelete,
} from '@/lib/training-plan-lifecycle';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  try {
    await requireUser();
    const current = await prisma.trainingPlan.findFirst({
      where: { id: params.id, deletedAt: null, archivedAt: null },
      select: { id: true, code: true, title: true, status: true, version: true },
    });
    if (!current) return NextResponse.json({ ok: false, error: '培训计划不存在或已删除' }, { status: 404 });
    const impact = await prisma.$transaction(tx => readTrainingPlanLifecycleImpact(tx, current.id));
    const canDelete = trainingPlanCanDelete(current.status, impact);
    const blockers = canDelete
      ? []
      : [current.status !== 'DRAFT'
          ? '只有草稿可以删除；已发布计划请取消，已完成或已取消计划请归档'
          : '草稿已经产生执行事实，不能删除'];
    return NextResponse.json({
      ok: true,
      preview: {
        plan: current,
        impact,
        canDelete,
        blockers,
        confirmationCode: current.code,
        recoverable: true,
      },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error('preview training plan deletion failed', error);
    return NextResponse.json({ ok: false, error: '草稿删除影响计算失败' }, { status: 500 });
  }
}
