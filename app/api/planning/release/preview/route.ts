import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { previewProductionPlanRelease } from '@/lib/production-planning';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ReleaseTarget = 'preparation' | 'active';

function releaseTarget(value: unknown): ReleaseTarget | null {
  return value === 'preparation' || value === 'active' ? value : null;
}

export async function POST(req: NextRequest) {
  try {
    await requireUser();
    const body = await req.json().catch(() => ({})) as { batchIds?: unknown; target?: unknown };
    const batchIds = Array.isArray(body.batchIds)
      ? body.batchIds.map(value => String(value)).filter(Boolean).slice(0, 100)
      : [];
    const target = releaseTarget(body.target);
    if (!batchIds.length) return NextResponse.json({ ok: false, error: '请选择要下达的排产批次' }, { status: 400 });
    if (!target) return NextResponse.json({ ok: false, error: '下达目标不正确' }, { status: 400 });
    const preview = await prisma.$transaction(tx => previewProductionPlanRelease(tx, { batchIds, target }));
    return NextResponse.json({ ok: true, preview });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof Error && error.message === 'PLAN_BATCH_SELECTION_INVALID') {
      return NextResponse.json({ ok: false, error: '部分排产批次不存在或已删除' }, { status: 404 });
    }
    console.error('planning release preview failed', error);
    return NextResponse.json({ ok: false, error: '下达预检失败' }, { status: 500 });
  }
}
