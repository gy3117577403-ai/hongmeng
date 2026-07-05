import { NativeUnauthorizedError, nativeError, nativeOk, nativeUnauthorized, requireNativeUser } from '@/lib/native-api';
import { prisma } from '@/lib/prisma';
import { logOp } from '@/lib/logs';
import { serializeWorkOrder } from '@/lib/work-orders';
import { snapshotChange, workOrderSnapshot } from '@/lib/change-snapshots';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireNativeUser(req);
    const old = await prisma.workOrder.findUnique({ where: { id: params.id } });
    if (!old) return nativeError('工单不存在', 404);
    const workOrder = await prisma.workOrder.update({
      where: { id: params.id },
      data: { deletedAt: null },
      include: { resourceFiles: { where: { deletedAt: null, status: 'uploaded' }, select: { categoryId: true } } },
    });
    await logOp({ userId: user.id, action: 'restore_work_order', targetType: 'work_order', targetId: workOrder.id, detail: { code: workOrder.code, client: 'harmony_native' } });
    await snapshotChange({
      entityType: 'work_order',
      entityId: workOrder.id,
      action: 'restore_work_order',
      before: workOrderSnapshot(old),
      after: workOrderSnapshot(workOrder),
      changedBy: user.displayName || user.username,
    });
    return nativeOk({ workOrder: serializeWorkOrder(workOrder) });
  } catch (e) {
    if (e instanceof NativeUnauthorizedError) return nativeUnauthorized();
    console.error(e);
    return nativeError('恢复工单失败', 500);
  }
}
