import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { previewProductionPlanBatchDeletion } from '@/lib/production-planning';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function batchIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map(item => String(item).trim()).filter(Boolean))).slice(0, 100);
}

export async function POST(req: NextRequest) {
  try {
    await requireUser();
    const body = await req.json().catch(() => ({})) as { batchIds?: unknown };
    const ids = batchIds(body.batchIds);
    if (!ids.length) return NextResponse.json({ ok: false, error: '请先勾选要删除的计划批次' }, { status: 400 });
    const preview = await prisma.$transaction(tx => previewProductionPlanBatchDeletion(tx, ids));
    return NextResponse.json({ ok: true, preview });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof Error && error.message === 'PLAN_BATCH_SELECTION_INVALID') {
      return NextResponse.json({ ok: false, error: '部分计划批次不存在、已删除或已归档' }, { status: 404 });
    }
    console.error('planning deletion preview failed', error);
    return NextResponse.json({ ok: false, error: '删除计划预检失败' }, { status: 500 });
  }
}
