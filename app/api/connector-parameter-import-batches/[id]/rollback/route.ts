import { NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { connectorParameterSnapshot, snapshotChange } from '@/lib/change-snapshots';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const userName = user.displayName || user.username;
    const batch = await prisma.connectorParameterImportBatch.findUnique({ where: { id: params.id } });
    if (!batch) return NextResponse.json({ ok: false, error: '导入批次不存在' }, { status: 404 });
    if (batch.rolledBackAt) return NextResponse.json({ ok: false, error: '该批次已回滚，不能重复回滚' }, { status: 409 });

    const beforeItems = await prisma.connectorParameter.findMany({
      where: { importBatchId: batch.id, deletedAt: null },
      include: { _count: { select: { productBindings: { where: { isCurrent: true, status: 'PUBLISHED' } }, assemblyManualBindings: true } } },
    });
    const inUse = beforeItems.filter(item => item.lockedAt || item._count.productBindings || item._count.assemblyManualBindings);
    if (inUse.length) {
      return NextResponse.json({ ok: false, code: 'CONNECTOR_PARAMETER_IN_USE', error: `该批次有 ${inUse.length} 条参数已关联产品或说明书，为避免破坏在用版本，本次回滚未执行。` }, { status: 409 });
    }
    const result = await prisma.connectorParameter.updateMany({
      where: { importBatchId: batch.id, deletedAt: null },
      data: { deletedAt: new Date(), status: 'RETIRED', updatedBy: userName },
    });
    const updatedBatch = await prisma.connectorParameterImportBatch.update({
      where: { id: batch.id },
      data: { rolledBackAt: new Date(), rolledBackBy: userName },
    });

    await logOp({
      userId: user.id,
      action: 'rollback_connector_parameter_import_batch',
      targetType: 'connector_parameter_import_batch',
      targetId: batch.id,
      detail: { count: result.count, fileName: batch.fileName, softDelete: true },
    });
    await logOp({
      userId: user.id,
      action: 'rollback_import_batch',
      targetType: 'connector_parameter_import_batch',
      targetId: batch.id,
      detail: { count: result.count, fileName: batch.fileName, softDelete: true },
    });
    await snapshotChange({
      entityType: 'connector_parameter_import_batch',
      entityId: batch.id,
      action: 'rollback_connector_parameter_import_batch',
      before: {
        id: batch.id,
        rolledBackAt: batch.rolledBackAt,
        activeParameterCount: beforeItems.length,
        sample: beforeItems.map(connectorParameterSnapshot),
      },
      after: {
        id: updatedBatch.id,
        rolledBackAt: updatedBatch.rolledBackAt,
        rolledBackBy: updatedBatch.rolledBackBy,
        deletedCount: result.count,
      },
      changedBy: userName,
    });

    return NextResponse.json({ ok: true, count: result.count });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorized();
    console.error(e);
    return NextResponse.json({ ok: false, error: '导入批次回滚失败' }, { status: 500 });
  }
}
