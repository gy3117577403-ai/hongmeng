import { NextRequest, NextResponse } from 'next/server';
import type { WorkOrder } from '@prisma/client';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { snapshotChange, workOrderSnapshot } from '@/lib/change-snapshots';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';
import { prepareExecutionUpdate, type ExecutionUpdateInput } from '@/lib/work-order-execution';
import { isActiveProductionWorkOrder } from '@/lib/work-orders';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type BatchOperation = 'set_owner' | 'set_workstation' | 'set_priority' | 'set_stage' | 'add_remark';
type BatchBody = {
  ids?: unknown;
  operation?: unknown;
  value?: unknown;
  remark?: unknown;
};

const operations = new Set<BatchOperation>(['set_owner', 'set_workstation', 'set_priority', 'set_stage', 'add_remark']);

function executionInput(operation: BatchOperation, value: unknown, remark: unknown): ExecutionUpdateInput {
  if (operation === 'set_owner') return { productionOwner: value, remark };
  if (operation === 'set_workstation') return { workstation: value, remark };
  if (operation === 'set_priority') return { priority: value, remark };
  if (operation === 'set_stage') return { stage: value, remark };
  return { remark: String(remark ?? value ?? '').trim() };
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({})) as BatchBody;
    const ids = Array.isArray(body.ids) ? [...new Set(body.ids.map(value => String(value || '').trim()).filter(Boolean))] : [];
    const operation = String(body.operation || '') as BatchOperation;
    if (!ids.length) return NextResponse.json({ ok: false, error: '请至少选择一个工单' }, { status: 400 });
    if (ids.length > 200) return NextResponse.json({ ok: false, error: '单次最多批量处理 200 个工单' }, { status: 400 });
    if (!operations.has(operation)) return NextResponse.json({ ok: false, error: '批量操作类型不正确' }, { status: 400 });
    if (operation === 'set_stage') {
      return NextResponse.json({
        ok: false,
        error: '生产状态只能由图纸下发和“完成当前工序”流程推进，不能批量改写',
      }, { status: 409 });
    }

    const orders = await prisma.workOrder.findMany({ where: { id: { in: ids }, deletedAt: null } });
    const byId = new Map(orders.map(order => [order.id, order]));
    const prepared: Array<{ old: WorkOrder; update: NonNullable<ReturnType<typeof prepareExecutionUpdate>['update']> }> = [];
    const failed: Array<{ id: string; ok: false; error: string }> = [];
    const input = executionInput(operation, body.value, body.remark);
    for (const id of ids) {
      const order = byId.get(id);
      if (!order) {
        failed.push({ id, ok: false, error: '工单不存在' });
        continue;
      }
      if (!isActiveProductionWorkOrder(order)) {
        failed.push({ id, ok: false, error: '历史周和下周草稿为只读' });
        continue;
      }
      const result = prepareExecutionUpdate(order, input);
      if (!result.update) {
        failed.push({ id, ok: false, error: result.error || '执行信息不正确' });
        continue;
      }
      prepared.push({ old: order, update: result.update });
    }
    if (failed.length) {
      return NextResponse.json({ ok: false, error: '批量预检未通过，未写入任何数据', results: failed }, { status: 409 });
    }

    const actor = user.displayName || user.username;
    const changed = await prisma.$transaction(async tx => {
      const rows: WorkOrder[] = [];
      for (const item of prepared) {
        const workOrder = await tx.workOrder.update({ where: { id: item.old.id }, data: item.update.data });
        await tx.workOrderProgressLog.create({
          data: {
            workOrderId: item.old.id,
            previousStage: item.update.previousStage,
            stage: item.update.stage,
            completedQty: item.update.completedQty,
            productionOwner: item.update.productionOwner,
            workstation: item.update.workstation,
            remark: item.update.remark,
            createdBy: actor,
          },
        });
        rows.push(workOrder);
      }
      return rows;
    });

    await logOp({
      userId: user.id,
      action: 'batch_update_work_order_execution',
      targetType: 'work_order_batch',
      detail: { operation, count: changed.length },
    });
    await Promise.all(changed.map((after, index) => snapshotChange({
      entityType: 'work_order',
      entityId: after.id,
      action: 'batch_update_work_order_execution',
      before: workOrderSnapshot(prepared[index].old),
      after: workOrderSnapshot(after),
      changedBy: actor,
    })));

    return NextResponse.json({
      ok: true,
      data: {
        updated: changed.length,
        failed: 0,
        results: changed.map(order => ({ id: order.id, ok: true })),
      },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error('batch update work order execution failed', error);
    return NextResponse.json({ ok: false, error: '批量更新生产执行信息失败' }, { status: 500 });
  }
}
