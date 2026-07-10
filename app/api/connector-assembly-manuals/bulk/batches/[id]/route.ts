import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { refreshManualImportBatch, serializeManualImportBatch } from '@/lib/connector-manual-bulk-import';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireUser();
    const batch = await prisma.connectorAssemblyManualImportBatch.findUnique({
      where: { id: params.id },
      include: { items: { orderBy: { createdAt: 'asc' } } },
    });
    if (!batch) return NextResponse.json({ ok: false, error: '说明书导入批次不存在' }, { status: 404 });
    return NextResponse.json({ ok: true, batch: serializeManualImportBatch(batch) });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error(error);
    return NextResponse.json({ ok: false, error: '说明书导入批次加载失败' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireUser();
    const body = await req.json().catch(() => ({})) as { action?: string };
    if (body.action !== 'cancel') return NextResponse.json({ ok: false, error: '不支持的批次操作' }, { status: 400 });
    const batch = await prisma.connectorAssemblyManualImportBatch.findUnique({ where: { id: params.id } });
    if (!batch) return NextResponse.json({ ok: false, error: '说明书导入批次不存在' }, { status: 404 });
    await prisma.connectorAssemblyManualImportItem.updateMany({ where: { batchId: batch.id, status: 'pending' }, data: { status: 'cancelled', errorMessage: '用户取消未开始任务' } });
    await refreshManualImportBatch(batch.id);
    await prisma.connectorAssemblyManualImportBatch.update({ where: { id: batch.id }, data: { status: 'cancelled', completedAt: new Date() } });
    const updated = await prisma.connectorAssemblyManualImportBatch.findUniqueOrThrow({ where: { id: batch.id }, include: { items: { orderBy: { createdAt: 'asc' } } } });
    return NextResponse.json({ ok: true, batch: serializeManualImportBatch(updated) });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error(error);
    return NextResponse.json({ ok: false, error: '取消说明书导入批次失败' }, { status: 500 });
  }
}
