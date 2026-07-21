import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import {
  effectivePlanningUnitMilliseconds,
  parseProductionPlanBatchInput,
  planBatchSnapshot,
  productionPlanOrderInclude,
  refreshProductionPlanOrderStatus,
  resolvePlanningReferences,
  serializeProductionPlanOrder,
} from '@/lib/production-planning';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, context: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const parsed = parseProductionPlanBatchInput(body);
    if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
    const order = await prisma.productionPlanOrder.findUnique({
      where: { id: context.params.id },
      include: { batches: { select: { batchNo: true, quantity: true, deletedAt: true } } },
    });
    if (!order || order.deletedAt) return NextResponse.json({ ok: false, error: '计划订单不存在' }, { status: 404 });
    if (order.status === 'cancelled' || order.status === 'completed') {
      return NextResponse.json({ ok: false, error: '已取消或已完成订单不能继续排产' }, { status: 409 });
    }
    const allocated = order.batches.filter(batch => !batch.deletedAt).reduce((sum, batch) => sum + batch.quantity, 0);
    if (allocated + parsed.data.quantity > order.orderQuantity) {
      return NextResponse.json({ ok: false, error: `本次排产超过剩余数量 ${Math.max(0, order.orderQuantity - allocated)}` }, { status: 409 });
    }
    const updated = await prisma.$transaction(async tx => {
      const refs = await resolvePlanningReferences(tx, order);
      const effectiveUnitMilliseconds = effectivePlanningUnitMilliseconds(
        parsed.data.unitMilliseconds,
        refs.unitMilliseconds,
        order.planningUnitMilliseconds,
      );
      const batchData = {
        quantity: parsed.data.quantity,
        weekStartDate: parsed.data.weekStartDate,
        weekEndDate: parsed.data.weekEndDate,
        plannedCompletionDate: parsed.data.plannedCompletionDate,
      };
      const batchNo = Math.max(0, ...order.batches.map(batch => batch.batchNo)) + 1;
      if (body.unitMilliseconds !== undefined && effectiveUnitMilliseconds && !order.planningUnitMilliseconds) {
        await tx.productionPlanOrder.update({
          where: { id: order.id },
          data: { planningUnitMilliseconds: effectiveUnitMilliseconds, updatedById: user.id },
        });
      }
      const batch = await tx.productionPlanBatch.create({
        data: {
          planOrderId: order.id,
          batchNo,
          ...batchData,
          productTimeProfileId: refs.productTimeProfileId,
          productTimeProfileVersion: refs.productTimeProfileVersion,
          unitMillisecondsSnapshot: effectiveUnitMilliseconds,
          totalMillisecondsSnapshot: effectiveUnitMilliseconds ? BigInt(effectiveUnitMilliseconds) * BigInt(parsed.data.quantity) : null,
        },
      });
      await refreshProductionPlanOrderStatus(tx, order.id);
      await tx.productionPlanChange.create({
        data: {
          planOrderId: order.id,
          batchId: batch.id,
          action: 'create_plan_batch',
          afterData: planBatchSnapshot({ ...parsed.data, unitMilliseconds: effectiveUnitMilliseconds, batchNo }),
          actorId: user.id,
        },
      });
      await tx.operationLog.create({
        data: {
          userId: user.id,
          action: 'create_production_plan_batch',
          targetType: 'production_plan_batch',
          targetId: batch.id,
          detail: { planOrderId: order.id, batchNo, quantity: batch.quantity },
        },
      });
      return tx.productionPlanOrder.findUniqueOrThrow({ where: { id: order.id }, include: productionPlanOrderInclude });
    });
    return NextResponse.json({ ok: true, order: serializeProductionPlanOrder(updated) }, { status: 201 });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error('create planning batch failed', error);
    return NextResponse.json({ ok: false, error: '新增排产批次失败' }, { status: 500 });
  }
}
