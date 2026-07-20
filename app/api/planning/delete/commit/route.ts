import { Prisma } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { deleteProductionPlanBatches } from '@/lib/production-planning';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function batchIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map(item => String(item).trim()).filter(Boolean))).slice(0, 100);
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({})) as { batchIds?: unknown; confirm?: unknown };
    const ids = batchIds(body.batchIds);
    if (!ids.length) return NextResponse.json({ ok: false, error: '请先勾选要删除的计划批次' }, { status: 400 });
    if (body.confirm !== true) return NextResponse.json({ ok: false, error: '请先确认删除计划' }, { status: 400 });
    const result = await prisma.$transaction(
      tx => deleteProductionPlanBatches(tx, { batchIds: ids, actorId: user.id }),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30_000 },
    );
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    const message = error instanceof Error ? error.message : '';
    if (message === 'PLAN_BATCH_SELECTION_INVALID') {
      return NextResponse.json({ ok: false, error: '部分计划批次不存在、已删除或状态已变化' }, { status: 409 });
    }
    if (message === 'PLAN_BATCH_DELETE_BLOCKED') {
      return NextResponse.json({ ok: false, error: '所选计划中存在已开工或已完成批次，不能删除' }, { status: 409 });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
      return NextResponse.json({ ok: false, error: '计划状态刚刚发生变化，请重新预检后再试' }, { status: 409 });
    }
    console.error('planning deletion commit failed', error);
    return NextResponse.json({ ok: false, error: '删除计划失败' }, { status: 500 });
  }
}
