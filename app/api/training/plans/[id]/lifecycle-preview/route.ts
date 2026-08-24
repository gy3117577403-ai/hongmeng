import { NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import {
  readTrainingPlanLifecycleImpact,
  trainingPlanCanArchive,
  trainingPlanCanUnarchive,
} from '@/lib/training-plan-lifecycle';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    await requireUser();
    const current = await prisma.trainingPlan.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        code: true,
        title: true,
        status: true,
        version: true,
        archivedAt: true,
        deletedAt: true,
      },
    });
    if (!current) return NextResponse.json({ ok: false, error: '培训计划不存在' }, { status: 404 });
    const impact = await prisma.$transaction(tx => readTrainingPlanLifecycleImpact(tx, current.id));
    return NextResponse.json({
      ok: true,
      preview: {
        plan: {
          ...current,
          archivedAt: current.archivedAt?.toISOString() || null,
          deletedAt: current.deletedAt?.toISOString() || null,
        },
        impact,
        canArchive: !current.deletedAt && trainingPlanCanArchive(current.status, current.archivedAt),
        canUnarchive: !current.deletedAt && trainingPlanCanUnarchive(current.status, current.archivedAt),
        canRestore: current.status === 'DRAFT' && Boolean(current.deletedAt),
      },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error('preview training plan lifecycle failed', error);
    return NextResponse.json({ ok: false, error: '培训计划影响加载失败' }, { status: 500 });
  }
}
