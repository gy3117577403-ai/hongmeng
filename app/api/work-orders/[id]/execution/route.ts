import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { snapshotChange, workOrderSnapshot } from '@/lib/change-snapshots';
import { logOp } from '@/lib/logs';
import { loadProductionOrderById, serializeProductionOrder } from '@/lib/production-execution';
import { prisma } from '@/lib/prisma';
import { prepareExecutionUpdate, type ExecutionUpdateInput } from '@/lib/work-order-execution';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({})) as ExecutionUpdateInput;
    const old = await prisma.workOrder.findFirst({ where: { id: params.id, deletedAt: null } });
    if (!old) return NextResponse.json({ ok: false, error: '工单不存在' }, { status: 404 });
    if (old.planType !== 'weekly_plan' || !old.planActive || old.planClearedAt) {
      return NextResponse.json({ ok: false, error: '历史周和下周草稿为只读，请在当前启用周更新进度' }, { status: 409 });
    }

    const prepared = prepareExecutionUpdate(old, body);
    if (!prepared.update) return NextResponse.json({ ok: false, error: prepared.error || '执行信息不正确' }, { status: 400 });
    const update = prepared.update;
    const actor = user.displayName || user.username;
    const changed = await prisma.$transaction(async tx => {
      const workOrder = await tx.workOrder.update({ where: { id: old.id }, data: update.data });
      await tx.workOrderProgressLog.create({
        data: {
          workOrderId: old.id,
          previousStage: update.previousStage,
          stage: update.stage,
          completedQty: update.completedQty,
          productionOwner: update.productionOwner,
          workstation: update.workstation,
          remark: update.remark,
          createdBy: actor,
        },
      });
      return workOrder;
    });

    await logOp({
      userId: user.id,
      action: 'update_work_order_execution',
      targetType: 'work_order',
      targetId: old.id,
      detail: { fields: update.changedFields, fromStage: update.previousStage, toStage: update.stage },
    });
    await snapshotChange({
      entityType: 'work_order',
      entityId: old.id,
      action: 'update_work_order_execution',
      before: workOrderSnapshot(old),
      after: workOrderSnapshot(changed),
      changedBy: actor,
    });

    const workOrder = await loadProductionOrderById(old.id);
    return NextResponse.json({ ok: true, data: workOrder ? serializeProductionOrder(workOrder) : null });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error('update work order execution failed', error);
    return NextResponse.json({ ok: false, error: '生产进度更新失败' }, { status: 500 });
  }
}
