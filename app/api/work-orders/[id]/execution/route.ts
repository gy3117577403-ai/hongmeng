import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { snapshotChange, workOrderSnapshot } from '@/lib/change-snapshots';
import { logOp } from '@/lib/logs';
import { loadProductionOrderById, serializeProductionOrder } from '@/lib/production-execution';
import {
  applyProductionStageFlow,
  parseProductionStageFlowAction,
  ProductionStageFlowServiceError,
} from '@/lib/production-stage-flow-service';
import { prisma } from '@/lib/prisma';
import { prepareExecutionUpdate, type ExecutionUpdateInput } from '@/lib/work-order-execution';
import { isActiveProductionWorkOrder } from '@/lib/work-orders';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ExecutionRequestBody = ExecutionUpdateInput & {
  action?: unknown;
  quantity?: unknown;
  expectedVersion?: unknown;
};

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({})) as ExecutionRequestBody;
    if (body.action !== undefined) {
      const action = parseProductionStageFlowAction(body.action);
      if (!action) return NextResponse.json({ ok: false, error: '生产流转操作不正确' }, { status: 400 });
      await applyProductionStageFlow({
        workOrderId: params.id,
        action,
        quantity: body.quantity,
        expectedVersion: body.expectedVersion,
        userId: user.id,
        actor: user.displayName || user.username,
      });
      const workOrder = await loadProductionOrderById(params.id);
      return NextResponse.json({ ok: true, data: workOrder ? serializeProductionOrder(workOrder) : null });
    }

    const old = await prisma.workOrder.findFirst({ where: { id: params.id, deletedAt: null } });
    if (!old) return NextResponse.json({ ok: false, error: '工单不存在' }, { status: 404 });
    if (!isActiveProductionWorkOrder(old)) {
      return NextResponse.json({ ok: false, error: '历史周和下周草稿为只读，请在当前启用周更新进度' }, { status: 409 });
    }
    const processRoute = await prisma.workOrderProcessRoute.findUnique({
      where: { workOrderId: old.id },
      select: { status: true },
    });
    if (processRoute && (body.stage !== undefined || body.completedQty !== undefined)) {
      return NextResponse.json({
        ok: false,
        error: processRoute.status === 'draft'
          ? '请先维护并发布当前产品的工序与工时'
          : '该工单已启用完整工艺路线，请使用当前工序按钮推进',
      }, { status: 409 });
    }
    if (old.frontendTransferredQty !== null && (body.stage !== undefined || body.completedQty !== undefined)) {
      return NextResponse.json({ ok: false, error: '该工单已启用分批数量流转，请使用“下一步”更新生产数量' }, { status: 409 });
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
    if (error instanceof ProductionStageFlowServiceError) {
      return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: error.status });
    }
    console.error('update work order execution failed', error);
    return NextResponse.json({ ok: false, error: '生产进度更新失败' }, { status: 500 });
  }
}
