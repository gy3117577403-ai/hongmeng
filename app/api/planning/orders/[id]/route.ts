import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import {
  parseProductionPlanOrderInput,
  planOrderSnapshot,
  productionPlanOrderInclude,
  refreshProductionPlanOrderStatus,
  resolvePlanningReferences,
  serializeProductionPlanOrder,
  type ParsedPlanOrder,
} from '@/lib/production-planning';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function currentInput(order: {
  drawingLibraryItemId: string | null;
  sourceOrderNo: string;
  sourceLineNo: number;
  customerName: string;
  salesperson: string | null;
  productName: string;
  specification: string;
  orderQuantity: number;
  planningUnitMilliseconds: number | null;
  orderDate: Date;
  customerDueDate: Date;
  priority: string;
  status: string;
  remark: string | null;
}): ParsedPlanOrder {
  return order as ParsedPlanOrder;
}

export async function PATCH(req: NextRequest, context: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const existing = await prisma.productionPlanOrder.findUnique({
      where: { id: context.params.id },
      include: { batches: { where: { deletedAt: null }, select: { id: true, quantity: true, releaseState: true, workOrderId: true, productTimeProfileId: true } } },
    });
    if (!existing || existing.deletedAt) return NextResponse.json({ ok: false, error: '计划订单不存在' }, { status: 404 });
    const parsed = parseProductionPlanOrderInput(body, currentInput(existing));
    if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
    const references = await resolvePlanningReferences(prisma, parsed.data);
    if (!references.drawingLibraryItemId || !references.customerName || !references.specification || !references.productName) {
      return NextResponse.json({ ok: false, error: '请选择图纸资料库中的有效产品' }, { status: 400 });
    }
    const canonical = {
      ...parsed.data,
      drawingLibraryItemId: references.drawingLibraryItemId,
      customerName: references.customerName,
      productName: references.productName,
      specification: references.specification,
    };
    const allocated = existing.batches.reduce((sum, batch) => sum + batch.quantity, 0);
    if (canonical.orderQuantity < allocated) {
      return NextResponse.json({ ok: false, error: `订单数量不能小于已排产数量 ${allocated}` }, { status: 409 });
    }
    const released = existing.batches.filter(batch => batch.releaseState !== 'draft');
    const effectiveOrderUnitMilliseconds = references.unitMilliseconds || canonical.planningUnitMilliseconds;
    if (released.length && !effectiveOrderUnitMilliseconds) {
      return NextResponse.json({ ok: false, error: '已下达订单必须保留有效单件工时' }, { status: 409 });
    }
    const impactful = canonical.drawingLibraryItemId !== existing.drawingLibraryItemId
      || canonical.customerName !== existing.customerName
      || canonical.salesperson !== existing.salesperson
      || canonical.productName !== existing.productName
      || canonical.specification !== existing.specification
      || canonical.orderQuantity !== existing.orderQuantity
      || canonical.planningUnitMilliseconds !== existing.planningUnitMilliseconds
      || canonical.customerDueDate.getTime() !== existing.customerDueDate.getTime();
    const reason = String(body.reason || '').trim().slice(0, 300);
    if (released.length && impactful && !reason) {
      return NextResponse.json({ ok: false, error: '已下达订单变更必须填写原因' }, { status: 400 });
    }
    if (released.length && impactful && body.confirmImpact !== true) {
      return NextResponse.json({
        ok: false,
        requiresConfirmation: true,
        error: '该订单已经下达，修改会同步关联工单，请确认影响后继续',
        impact: {
          releasedBatchCount: released.length,
          linkedWorkOrderCount: released.filter(batch => batch.workOrderId).length,
          keepsWarehouseProgress: true,
          keepsProcessProgress: true,
        },
      });
    }
    const updated = await prisma.$transaction(async tx => {
      await tx.productionPlanOrder.update({
        where: { id: existing.id },
        data: { ...canonical, updatedById: user.id },
      });
      const linkedIds = released.map(batch => batch.workOrderId).filter((id): id is string => Boolean(id));
      if (linkedIds.length) {
        await tx.workOrder.updateMany({
          where: { id: { in: linkedIds } },
          data: {
            customerName: canonical.customerName,
            salesperson: canonical.salesperson,
            productName: canonical.productName,
            specification: canonical.specification,
            orderDate: canonical.orderDate,
            deliveryDay: canonical.customerDueDate.toISOString().slice(0, 10),
            priority: canonical.priority === 'insert' ? 'urgent' : canonical.priority,
            remark: canonical.remark,
            drawingLibraryItemId: references.drawingLibraryItemId,
          },
        });
      }
      if (canonical.planningUnitMilliseconds !== existing.planningUnitMilliseconds) {
        const effectiveUnitMilliseconds = effectiveOrderUnitMilliseconds;
        for (const batch of existing.batches.filter(item => !item.productTimeProfileId)) {
          const totalMilliseconds = effectiveUnitMilliseconds
            ? BigInt(effectiveUnitMilliseconds) * BigInt(batch.quantity)
            : null;
          await tx.productionPlanBatch.update({
            where: { id: batch.id },
            data: {
              productTimeProfileId: references.productTimeProfileId,
              productTimeProfileVersion: references.productTimeProfileVersion,
              unitMillisecondsSnapshot: effectiveUnitMilliseconds,
              totalMillisecondsSnapshot: totalMilliseconds,
            },
          });
          if (batch.releaseState !== 'draft' && batch.workOrderId && effectiveUnitMilliseconds && totalMilliseconds) {
            await tx.workOrder.update({
              where: { id: batch.workOrderId },
              data: {
                unitWorkHours: String(effectiveUnitMilliseconds / 3_600_000),
                totalWorkHours: String(Number(totalMilliseconds) / 3_600_000),
              },
            });
          }
        }
      }
      await refreshProductionPlanOrderStatus(tx, existing.id);
      await tx.productionPlanChange.create({
        data: {
          planOrderId: existing.id,
          action: released.length ? 'update_released_plan_order' : 'update_plan_order',
          beforeData: planOrderSnapshot(currentInput(existing)),
          afterData: planOrderSnapshot(canonical),
          impactData: { releasedBatchCount: released.length, linkedWorkOrderCount: linkedIds.length },
          reason: reason || null,
          actorId: user.id,
        },
      });
      await tx.operationLog.create({
        data: {
          userId: user.id,
          action: 'update_production_plan_order',
          targetType: 'production_plan_order',
          targetId: existing.id,
          detail: { releasedBatchCount: released.length },
        },
      });
      return tx.productionPlanOrder.findUniqueOrThrow({ where: { id: existing.id }, include: productionPlanOrderInclude });
    });
    return NextResponse.json({ ok: true, order: serializeProductionPlanOrder(updated) });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if ((error as { code?: string }).code === 'P2002') {
      return NextResponse.json({ ok: false, error: '计划订单内部编号冲突，请重试' }, { status: 409 });
    }
    console.error('update planning order failed', error);
    return NextResponse.json({ ok: false, error: '更新计划订单失败' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, context: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const existing = await prisma.productionPlanOrder.findUnique({
      where: { id: context.params.id },
      include: { batches: { where: { deletedAt: null }, select: { releaseState: true } } },
    });
    if (!existing || existing.deletedAt) return NextResponse.json({ ok: false, error: '计划订单不存在' }, { status: 404 });
    if (existing.batches.some(batch => batch.releaseState !== 'draft')) {
      return NextResponse.json({ ok: false, error: '已有下达批次的订单不能删除，请暂停或通过变更调整' }, { status: 409 });
    }
    await prisma.$transaction(async tx => {
      const now = new Date();
      await tx.productionPlanBatch.updateMany({ where: { planOrderId: existing.id, deletedAt: null }, data: { deletedAt: now } });
      await tx.productionPlanOrder.update({ where: { id: existing.id }, data: { deletedAt: now, updatedById: user.id } });
      await tx.productionPlanChange.create({ data: { planOrderId: existing.id, action: 'delete_plan_order', actorId: user.id } });
      await tx.operationLog.create({
        data: { userId: user.id, action: 'delete_production_plan_order', targetType: 'production_plan_order', targetId: existing.id },
      });
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error('delete planning order failed', error);
    return NextResponse.json({ ok: false, error: '删除计划订单失败' }, { status: 500 });
  }
}
