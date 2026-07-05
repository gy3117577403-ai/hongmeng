import { connectorParameterSnapshot, snapshotChange } from '@/lib/change-snapshots';
import { logOp } from '@/lib/logs';
import { NativeUnauthorizedError, nativeError, nativeOk, nativeUnauthorized, requireNativeUser } from '@/lib/native-api';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireNativeUser(req);
    const userName = user.displayName || user.username;
    const body = await req.json().catch(() => ({})) as { confirmText?: string };
    if (String(body.confirmText || '').trim() !== 'ROLLBACK') return nativeError('导入批次回滚确认不匹配', 400);
    const batch = await prisma.connectorParameterImportBatch.findUnique({ where: { id: params.id } });
    if (!batch) return nativeError('导入批次不存在', 404);
    if (batch.rolledBackAt) return nativeError('该批次已回滚，不能重复回滚', 409);
    const beforeItems = await prisma.connectorParameter.findMany({ where: { importBatchId: batch.id, deletedAt: null }, take: 100 });
    const result = await prisma.connectorParameter.updateMany({ where: { importBatchId: batch.id, deletedAt: null }, data: { deletedAt: new Date(), updatedBy: userName } });
    const updatedBatch = await prisma.connectorParameterImportBatch.update({ where: { id: batch.id }, data: { rolledBackAt: new Date(), rolledBackBy: userName } });
    await logOp({ userId: user.id, action: 'rollback_connector_parameter_import_batch', targetType: 'connector_parameter_import_batch', targetId: batch.id, detail: { count: result.count, fileName: batch.fileName, softDelete: true, client: 'harmony_native' } });
    await snapshotChange({
      entityType: 'connector_parameter_import_batch',
      entityId: batch.id,
      action: 'rollback_connector_parameter_import_batch',
      before: { id: batch.id, rolledBackAt: batch.rolledBackAt, activeParameterCount: beforeItems.length, sample: beforeItems.map(connectorParameterSnapshot) },
      after: { id: updatedBatch.id, rolledBackAt: updatedBatch.rolledBackAt, rolledBackBy: updatedBatch.rolledBackBy, deletedCount: result.count },
      changedBy: userName,
    });
    return nativeOk({ count: result.count });
  } catch (e) {
    if (e instanceof NativeUnauthorizedError) return nativeUnauthorized();
    console.error(e);
    return nativeError('导入批次回滚失败', 500);
  }
}
