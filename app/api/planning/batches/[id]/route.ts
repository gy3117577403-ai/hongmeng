import { Prisma } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import {
  loadProcessQuantityLedgerState,
  processQuantityLedgerIsLocked,
} from '@/lib/process-quantity-ledger-guard';
import {
  effectivePlanningUnitMilliseconds,
  parseProductionPlanBatchInput,
  planBatchSnapshot,
  productionPlanOrderInclude,
  releasedBatchWeekChangeLocked,
  refreshProductionPlanOrderStatus,
  resolvePlanningReferences,
  serializeProductionPlanOrder,
  type ParsedPlanBatch,
} from '@/lib/production-planning';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function currentBatch(batch: {
  quantity: number;
  weekStartDate: Date;
  weekEndDate: Date;
  plannedCompletionDate: Date;
  unitMillisecondsSnapshot: number | null;
}): ParsedPlanBatch {
  return {
    quantity: batch.quantity,
    weekStartDate: batch.weekStartDate,
    weekEndDate: batch.weekEndDate,
    plannedCompletionDate: batch.plannedCompletionDate,
    unitMilliseconds: batch.unitMillisecondsSnapshot,
  };
}

export async function PATCH(req: NextRequest, context: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const updated = await prisma.$transaction(async tx => {
      const existing = await tx.productionPlanBatch.findUnique({
        where: { id: context.params.id },
        include: { planOrder: { include: { batches: { where: { deletedAt: null }, select: { id: true, quantity: true } } } } },
      });
      if (!existing || existing.deletedAt || existing.planOrder.deletedAt) {
        return NextResponse.json({ ok: false, error: '排产批次不存在' }, { status: 404 });
      }
      const parsed = parseProductionPlanBatchInput(body, currentBatch(existing));
      if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
      const otherQuantity = existing.planOrder.batches
        .filter(batch => batch.id !== existing.id)
        .reduce((sum, batch) => sum + batch.quantity, 0);
      if (otherQuantity + parsed.data.quantity > existing.planOrder.orderQuantity) {
        return NextResponse.json({
          ok: false,
          error: `修改后超过订单数量，可用数量 ${Math.max(0, existing.planOrder.orderQuantity - otherQuantity)}`,
        }, { status: 409 });
      }
      const released = existing.releaseState !== 'draft';
      if (releasedBatchWeekChangeLocked({
        released,
        weekStartChanged: parsed.data.weekStartDate.getTime() !== existing.weekStartDate.getTime(),
        weekEndChanged: parsed.data.weekEndDate.getTime() !== existing.weekEndDate.getTime(),
      })) {
        return NextResponse.json({
          ok: false,
          error: '已下达批次不能在普通编辑中改生产周；请使用周计划下达或撤回流程',
        }, { status: 409 });
      }
      const reason = String(body.reason || '').trim().slice(0, 300);
      if (released && !reason) {
        return NextResponse.json({ ok: false, error: '已下达批次变更必须填写原因' }, { status: 400 });
      }
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
      const refs = await resolvePlanningReferences(tx, existing.planOrder);
      const effectiveUnitMilliseconds = effectivePlanningUnitMilliseconds(
        parsed.data.unitMilliseconds,
        refs.unitMilliseconds,
        existing.planOrder.planningUnitMilliseconds,
      );
      if (released && !refs.productTimeProfileId) throw new Error('PRODUCT_TIME_PROFILE_REQUIRED');
      if (released && !effectiveUnitMilliseconds) throw new Error('PLAN_UNIT_WORK_TIME_REQUIRED');
      const quantityChanged = parsed.data.quantity !== existing.quantity;
      if (released && existing.workOrderId && quantityChanged) {
        const processLedger = await loadProcessQuantityLedgerState(tx, existing.workOrderId);
        if (processQuantityLedgerIsLocked(processLedger)) {
          throw new Error('PROCESS_QUANTITY_LEDGER_LOCKED');
        }
      }
      const batchData = {
        quantity: parsed.data.quantity,
        weekStartDate: parsed.data.weekStartDate,
        weekEndDate: parsed.data.weekEndDate,
        plannedCompletionDate: parsed.data.plannedCompletionDate,
      };
      if (body.unitMilliseconds !== undefined && effectiveUnitMilliseconds && !existing.planOrder.planningUnitMilliseconds) {
        await tx.productionPlanOrder.update({
          where: { id: existing.planOrderId },
          data: { planningUnitMilliseconds: effectiveUnitMilliseconds, updatedById: user.id },
        });
      }
      await tx.productionPlanBatch.update({
        where: { id: existing.id },
        data: {
          ...batchData,
          productTimeProfileId: refs.productTimeProfileId,
          productTimeProfileVersion: refs.productTimeProfileVersion,
          unitMillisecondsSnapshot: effectiveUnitMilliseconds,
          totalMillisecondsSnapshot: effectiveUnitMilliseconds ? BigInt(effectiveUnitMilliseconds) * BigInt(parsed.data.quantity) : null,
        },
      });
      if (released && existing.workOrderId) {
        await tx.workOrder.update({
          where: { id: existing.workOrderId },
          data: {
            productionTargetQty: parsed.data.quantity,
            uncompletedQty: quantityChanged ? String(parsed.data.quantity) : undefined,
            plannedAt: parsed.data.plannedCompletionDate,
            weekStartDate: parsed.data.weekStartDate,
            weekEndDate: parsed.data.weekEndDate,
            unitWorkHours: effectiveUnitMilliseconds ? String(effectiveUnitMilliseconds / 3_600_000) : null,
            totalWorkHours: effectiveUnitMilliseconds ? String((effectiveUnitMilliseconds * parsed.data.quantity) / 3_600_000) : null,
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
          afterData: planBatchSnapshot({ ...parsed.data, unitMilliseconds: effectiveUnitMilliseconds, batchNo: existing.batchNo, releaseState: existing.releaseState }),
          impactData: { linkedWorkOrder: Boolean(existing.workOrderId), releaseState: existing.releaseState },
          reason: reason || null,
          actorId: user.id,
        },
      });
      await tx.operationLog.create({
        data: { userId: user.id, action: 'update_production_plan_batch', targetType: 'production_plan_batch', targetId: existing.id },
      });
      return tx.productionPlanOrder.findUniqueOrThrow({ where: { id: existing.planOrderId }, include: productionPlanOrderInclude });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    if (updated instanceof NextResponse) return updated;
    return NextResponse.json({ ok: true, order: serializeProductionPlanOrder(updated) });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
      return NextResponse.json({ ok: false, error: '排产批次已被其他操作更新，请刷新后重试' }, { status: 409 });
    }
    if (error instanceof Error && error.message === 'PLAN_UNIT_WORK_TIME_REQUIRED') {
      return NextResponse.json({ ok: false, error: '已下达批次必须保留有效单件工时' }, { status: 409 });
    }
    if (error instanceof Error && error.message === 'PRODUCT_TIME_PROFILE_REQUIRED') {
      return NextResponse.json({ ok: false, error: '已下达批次必须关联已发布的产品工序与工时' }, { status: 409 });
    }
    if (error instanceof Error && error.message === 'PROCESS_QUANTITY_LEDGER_LOCKED') {
      return NextResponse.json({
        ok: false,
        error: '关联工单已进入工序数量账本，不能直接修改批次数量；请保留原数量并调整后续计划',
      }, { status: 409 });
    }
    console.error('update planning batch failed', error);
    return NextResponse.json({ ok: false, error: '更新排产批次失败' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, context: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const result = await prisma.$transaction(async tx => {
      const existing = await tx.productionPlanBatch.findUnique({ where: { id: context.params.id } });
      if (!existing || existing.deletedAt) {
        return NextResponse.json({ ok: false, error: '排产批次不存在' }, { status: 404 });
      }
      if (existing.releaseState !== 'draft') {
        return NextResponse.json({ ok: false, error: '已下达批次不能删除，请通过变更调整' }, { status: 409 });
      }
      await tx.productionPlanBatch.update({ where: { id: existing.id }, data: { deletedAt: new Date() } });
      await refreshProductionPlanOrderStatus(tx, existing.planOrderId);
      await tx.productionPlanChange.create({
        data: { planOrderId: existing.planOrderId, batchId: existing.id, action: 'delete_plan_batch', actorId: user.id },
      });
      await tx.operationLog.create({
        data: { userId: user.id, action: 'delete_production_plan_batch', targetType: 'production_plan_batch', targetId: existing.id },
      });
      return null;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    if (result instanceof NextResponse) return result;
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
      return NextResponse.json({ ok: false, error: '排产批次已被其他操作更新，请刷新后重试' }, { status: 409 });
    }
    console.error('delete planning batch failed', error);
    return NextResponse.json({ ok: false, error: '删除排产批次失败' }, { status: 500 });
  }
}
