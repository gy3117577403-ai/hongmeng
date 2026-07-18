import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import {
  parseProductionPlanBatchInput,
  planBatchSnapshot,
  productionPlanOrderInclude,
  refreshProductionPlanOrderStatus,
  resolvePlanningReferences,
  serializeProductionPlanOrder,
  type ParsedPlanBatch,
} from '@/lib/production-planning';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function currentBatch(batch: { quantity: number; weekStartDate: Date; weekEndDate: Date; plannedCompletionDate: Date }): ParsedPlanBatch {
  return batch;
}

export async function PATCH(req: NextRequest, context: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const existing = await prisma.productionPlanBatch.findUnique({
      where: { id: context.params.id },
      include: { planOrder: { include: { batches: { where: { deletedAt: null }, select: { id: true, quantity: true } } } } },
    });
    if (!existing || existing.deletedAt || existing.planOrder.deletedAt) return NextResponse.json({ ok: false, error: '排产批次不存在' }, { status: 404 });
    const parsed = parseProductionPlanBatchInput(body, currentBatch(existing));
    if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
    const otherQuantity = existing.planOrder.batches.filter(batch => batch.id !== existing.id).reduce((sum, batch) => sum + batch.quantity, 0);
    if (otherQuantity + parsed.data.quantity > existing.planOrder.orderQuantity) {
      return NextResponse.json({ ok: false, error: `修改后超过订单数量，可用数量 ${Math.max(0, existing.planOrder.orderQuantity - otherQuantity)}` }, { status: 409 });
    }
    const released = existing.releaseState !== 'draft';
    const reason = String(body.reason || '').trim().slice(0, 300);
    if (released && !reason) return NextResponse.json({ ok: false, error: '已下达批次变更必须填写原因' }, { status: 400 });
    if (released && body.confirmImpact !== true) {
      return NextResponse.json({
        ok: false,
        requiresConfirmation: true,
        error: '该批次已经下达，修改会同步数量和计划日期到关联工单',
        impact: {
          workOrderId: existing.workOrderId,
          warehouseProgressKept: true,
          processProgressKept: true,
        },
      });
    }
    const updated = await prisma.$transaction(async tx => {
      const refs = await resolvePlanningReferences(tx, existing.planOrder);
      await tx.productionPlanBatch.update({
        where: { id: existing.id },
        data: {
          ...parsed.data,
          productTimeProfileId: refs.productTimeProfileId,
          productTimeProfileVersion: refs.productTimeProfileVersion,
          unitMillisecondsSnapshot: refs.unitMilliseconds,
          totalMillisecondsSnapshot: refs.unitMilliseconds ? BigInt(refs.unitMilliseconds) * BigInt(parsed.data.quantity) : null,
        },
      });
      if (released && existing.workOrderId) {
        await tx.workOrder.update({
          where: { id: existing.workOrderId },
          data: {
            productionTargetQty: parsed.data.quantity,
            uncompletedQty: String(parsed.data.quantity),
            plannedAt: parsed.data.plannedCompletionDate,
            weekStartDate: parsed.data.weekStartDate,
            weekEndDate: parsed.data.weekEndDate,
            unitWorkHours: refs.unitMilliseconds ? String(refs.unitMilliseconds / 3_600_000) : null,
            totalWorkHours: refs.unitMilliseconds ? String((refs.unitMilliseconds * parsed.data.quantity) / 3_600_000) : null,
          },
        });
      }
      await refreshProductionPlanOrderStatus(tx, existing.planOrderId);
      await tx.productionPlanChange.create({
        data: {
          planOrderId: existing.planOrderId,
          batchId: existing.id,
          action: released ? 'update_released_plan_batch' : 'update_plan_batch',
          beforeData: planBatchSnapshot({ ...currentBatch(existing), batchNo: existing.batchNo, releaseState: existing.releaseState }),
          afterData: planBatchSnapshot({ ...parsed.data, batchNo: existing.batchNo, releaseState: existing.releaseState }),
          impactData: { linkedWorkOrder: Boolean(existing.workOrderId), releaseState: existing.releaseState },
          reason: reason || null,
          actorId: user.id,
        },
      });
      await tx.operationLog.create({
        data: { userId: user.id, action: 'update_production_plan_batch', targetType: 'production_plan_batch', targetId: existing.id },
      });
      return tx.productionPlanOrder.findUniqueOrThrow({ where: { id: existing.planOrderId }, include: productionPlanOrderInclude });
    });
    return NextResponse.json({ ok: true, order: serializeProductionPlanOrder(updated) });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error('update planning batch failed', error);
    return NextResponse.json({ ok: false, error: '更新排产批次失败' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, context: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const existing = await prisma.productionPlanBatch.findUnique({ where: { id: context.params.id } });
    if (!existing || existing.deletedAt) return NextResponse.json({ ok: false, error: '排产批次不存在' }, { status: 404 });
    if (existing.releaseState !== 'draft') return NextResponse.json({ ok: false, error: '已下达批次不能删除，请通过变更调整' }, { status: 409 });
    await prisma.$transaction(async tx => {
      await tx.productionPlanBatch.update({ where: { id: existing.id }, data: { deletedAt: new Date() } });
      await refreshProductionPlanOrderStatus(tx, existing.planOrderId);
      await tx.productionPlanChange.create({
        data: { planOrderId: existing.planOrderId, batchId: existing.id, action: 'delete_plan_batch', actorId: user.id },
      });
      await tx.operationLog.create({
        data: { userId: user.id, action: 'delete_production_plan_batch', targetType: 'production_plan_batch', targetId: existing.id },
      });
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error('delete planning batch failed', error);
    return NextResponse.json({ ok: false, error: '删除排产批次失败' }, { status: 500 });
  }
}
