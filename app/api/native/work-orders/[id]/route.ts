import { NextRequest } from 'next/server';
import { logOp } from '@/lib/logs';
import { NativeUnauthorizedError, nativeError, nativeOk, nativeUnauthorized, requireNativeUser } from '@/lib/native-api';
import { prisma } from '@/lib/prisma';
import { parseWorkOrderBody, serializeWorkOrder, workOrderStageText } from '@/lib/work-orders';
import { snapshotChange, workOrderSnapshot } from '@/lib/change-snapshots';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireNativeUser(req);
    const workOrder = await prisma.workOrder.findFirst({
      where: { id: params.id, deletedAt: null },
      include: { resourceFiles: { where: { deletedAt: null, status: 'uploaded' }, select: { categoryId: true } } },
    });
    if (!workOrder) return nativeError('工单不存在', 404);
    return nativeOk({ workOrder: serializeWorkOrder(workOrder) });
  } catch (e) {
    if (e instanceof NativeUnauthorizedError) return nativeUnauthorized();
    console.error(e);
    return nativeError('工单详情加载失败', 500);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireNativeUser(req);
    const old = await prisma.workOrder.findFirst({ where: { id: params.id, deletedAt: null } });
    if (!old) return nativeError('工单不存在', 404);

    const body = await req.json().catch(() => ({}));
    const { data, errors } = parseWorkOrderBody(body, { partial: true });
    if (errors.length) return nativeError(errors[0], 400);
    if (!Object.keys(data).length) return nativeError('没有可更新字段', 400);

    const workOrder = await prisma.workOrder.update({
      where: { id: params.id },
      data,
      include: { resourceFiles: { where: { deletedAt: null, status: 'uploaded' }, select: { categoryId: true } } },
    });

    await logOp({ userId: user.id, action: 'update_work_order', targetType: 'work_order', targetId: workOrder.id, detail: { code: workOrder.code, fields: Object.keys(data), client: 'harmony_native' } });
    await snapshotChange({
      entityType: 'work_order',
      entityId: workOrder.id,
      action: 'update_work_order',
      before: workOrderSnapshot(old),
      after: workOrderSnapshot(workOrder),
      changedBy: user.displayName || user.username,
    });
    if (old.stage !== workOrder.stage) {
      await logOp({
        userId: user.id,
        action: 'update_work_order_status',
        targetType: 'work_order',
        targetId: workOrder.id,
        detail: { code: workOrder.code, from: workOrderStageText(old.stage || old.status), to: workOrderStageText(workOrder.stage || workOrder.status), client: 'harmony_native' },
      });
      await snapshotChange({
        entityType: 'work_order',
        entityId: workOrder.id,
        action: 'update_work_order_status',
        before: { code: old.code, stage: old.stage, status: old.status },
        after: { code: workOrder.code, stage: workOrder.stage, status: workOrder.status },
        changedBy: user.displayName || user.username,
      });
    }
    if (old.priority !== workOrder.priority) {
      await logOp({
        userId: user.id,
        action: 'update_work_order_priority',
        targetType: 'work_order',
        targetId: workOrder.id,
        detail: { code: workOrder.code, from: old.priority, to: workOrder.priority, client: 'harmony_native' },
      });
      await snapshotChange({
        entityType: 'work_order',
        entityId: workOrder.id,
        action: 'update_work_order_priority',
        before: { code: old.code, priority: old.priority },
        after: { code: workOrder.code, priority: workOrder.priority },
        changedBy: user.displayName || user.username,
      });
    }
    if ((old.plannedAt?.getTime() || 0) !== (workOrder.plannedAt?.getTime() || 0)) {
      await logOp({
        userId: user.id,
        action: 'update_work_order_planned_at',
        targetType: 'work_order',
        targetId: workOrder.id,
        detail: { code: workOrder.code, from: old.plannedAt?.toISOString() || null, to: workOrder.plannedAt?.toISOString() || null, client: 'harmony_native' },
      });
      await snapshotChange({
        entityType: 'work_order',
        entityId: workOrder.id,
        action: 'update_work_order_planned_at',
        before: { code: old.code, plannedAt: old.plannedAt },
        after: { code: workOrder.code, plannedAt: workOrder.plannedAt },
        changedBy: user.displayName || user.username,
      });
    }
    if ((old.customerName || '') !== (workOrder.customerName || '')) {
      await logOp({
        userId: user.id,
        action: 'update_work_order_customer',
        targetType: 'work_order',
        targetId: workOrder.id,
        detail: { code: workOrder.code, from: old.customerName || null, to: workOrder.customerName || null, client: 'harmony_native' },
      });
      await snapshotChange({
        entityType: 'work_order',
        entityId: workOrder.id,
        action: 'update_work_order_customer',
        before: { code: old.code, customerName: old.customerName },
        after: { code: workOrder.code, customerName: workOrder.customerName },
        changedBy: user.displayName || user.username,
      });
    }
    return nativeOk({ workOrder: serializeWorkOrder(workOrder) });
  } catch (e) {
    if (e instanceof NativeUnauthorizedError) return nativeUnauthorized();
    if ((e as { code?: string }).code === 'P2002') return nativeError('工单号已存在', 409);
    console.error(e);
    return nativeError('工单更新失败', 500);
  }
}
