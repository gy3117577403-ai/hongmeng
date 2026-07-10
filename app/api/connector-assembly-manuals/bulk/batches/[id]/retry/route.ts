import { NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { serializeManualImportBatch } from '@/lib/connector-manual-bulk-import';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  try {
    await requireUser();
    const batch = await prisma.connectorAssemblyManualImportBatch.findUnique({ where: { id: params.id } });
    if (!batch) return NextResponse.json({ ok: false, error: '说明书导入批次不存在' }, { status: 404 });
    const reset = await prisma.connectorAssemblyManualImportItem.updateMany({
      where: { batchId: batch.id, status: 'failed' },
      data: { status: 'pending', errorMessage: null },
    });
    await prisma.connectorAssemblyManualImportBatch.update({ where: { id: batch.id }, data: { status: reset.count ? 'uploading' : batch.status, completedAt: reset.count ? null : batch.completedAt } });
    const updated = await prisma.connectorAssemblyManualImportBatch.findUniqueOrThrow({ where: { id: batch.id }, include: { items: { orderBy: { createdAt: 'asc' } } } });
    return NextResponse.json({ ok: true, retryCount: reset.count, batch: serializeManualImportBatch(updated) });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error(error);
    return NextResponse.json({ ok: false, error: '重置失败说明书任务失败' }, { status: 500 });
  }
}
