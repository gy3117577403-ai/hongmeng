import { Prisma } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import {
  forbidden,
  ForbiddenError,
  requireCapability,
  unauthorized,
  UnauthorizedError,
} from '@/lib/auth';
import { logOp } from '@/lib/logs';
import { materialFollowUpDetailInclude, serializeMaterialFollowUpTask } from '@/lib/material-follow-up';
import { prisma } from '@/lib/prisma';
import {
  chinaDate,
  chinaWeekRange,
  parsePlanDate,
  planBatchSnapshot,
} from '@/lib/production-planning';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function cleanText(value: unknown, max = 300): string {
  return String(value ?? '').trim().slice(0, max);
}

function completedWorkOrder(order: { completedAt: Date | null; stage: string; status: string }): boolean {
  return Boolean(order.completedAt || order.stage === 'completed' || order.status === 'completed');
}

async function loadContext(id: string) {
  return prisma.materialFollowUpTask.findUnique({
    where: { id },
    include: {
      warehouseException: true,
      warehouseTask: {
        include: {
          workOrder: {
            include: {
              productionPlanBatch: { include: { planOrder: true } },
            },
          },
        },
      },
    },
  });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const actor = await requireCapability('PLANNING', 'UPDATE');
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const completionDate = parsePlanDate(body.plannedCompletionDate);
    const customerDueDate = body.customerDueDate ? parsePlanDate(body.customerDueDate) : null;
    if (!completionDate) return NextResponse.json({ ok: false, error: '请填写有效的新计划完成日期' }, { status: 400 });
    if (body.customerDueDate && !customerDueDate) return NextResponse.json({ ok: false, error: '新客户交期格式不正确' }, { status: 400 });
    const current = await loadContext(params.id);
    if (!current) return NextResponse.json({ ok: false, error: '物料跟进任务不存在' }, { status: 404 });
    if (!current.warehouseException.actualArrivalAt) {
      return NextResponse.json({ ok: false, error: '仓库尚未登记实际到料，不能调整受影响计划' }, { status: 409 });
    }
    const workOrder = current.warehouseTask.workOrder;
    const batch = workOrder.productionPlanBatch;
    if (!batch || batch.deletedAt || batch.planOrder.deletedAt) {
      return NextResponse.json({ ok: false, error: '该缺料任务没有可调整的正式排产批次' }, { status: 409 });
    }
    if (completedWorkOrder(workOrder)) {
      return NextResponse.json({ ok: false, error: '关联工单已经完成，历史计划与进度不会被改写' }, { status: 409 });
    }
    const targetWeek = chinaWeekRange(completionDate);
    const crossesWeek = chinaDate(targetWeek.start) !== chinaDate(batch.weekStartDate);
    const reason = cleanText(body.reason, 300);
    const preview = {
      taskId: current.id,
      batchId: batch.id,
      workOrderId: workOrder.id,
      specification: workOrder.specification || workOrder.code,
      actualArrivalAt: current.warehouseException.actualArrivalAt.toISOString(),
      before: {
        plannedCompletionDate: chinaDate(batch.plannedCompletionDate),
        weekStartDate: chinaDate(batch.weekStartDate),
        weekEndDate: chinaDate(batch.weekEndDate),
        customerDueDate: chinaDate(batch.planOrder.customerDueDate),
      },
      after: {
        plannedCompletionDate: chinaDate(completionDate),
        weekStartDate: chinaDate(targetWeek.start),
        weekEndDate: chinaDate(targetWeek.end),
        customerDueDate: chinaDate(customerDueDate || batch.planOrder.customerDueDate),
      },
      crossesWeek,
      keepsWarehouseProgress: true,
      keepsProcessProgress: true,
      completedQuantityPreserved: true,
    };
    if (body.confirm !== true) return NextResponse.json({ ok: true, preview });
    if (!reason) return NextResponse.json({ ok: false, error: '请填写本次改期原因，便于计划追溯' }, { status: 400 });
    const expectedVersion = Number(body.version);
    const expectedBatchUpdatedAt = cleanText(body.batchUpdatedAt, 80);
    if (!Number.isInteger(expectedVersion) || expectedVersion !== current.version || expectedBatchUpdatedAt !== batch.updatedAt.toISOString()) {
      return NextResponse.json({ ok: false, error: '缺料任务或计划已经更新，请重新预览后再确认' }, { status: 409 });
    }
    const now = new Date();
    const result = await prisma.$transaction(async tx => {
      const lockedTask = await tx.materialFollowUpTask.findUnique({
        where: { id: current.id },
        include: {
          warehouseException: true,
          warehouseTask: { include: { workOrder: { include: { productionPlanBatch: { include: { planOrder: true } } } } } },
        },
      });
      const lockedWorkOrder = lockedTask?.warehouseTask.workOrder;
      const lockedBatch = lockedWorkOrder?.productionPlanBatch;
      if (!lockedTask || !lockedWorkOrder || !lockedBatch || lockedBatch.deletedAt || lockedBatch.planOrder.deletedAt) throw new Error('PLAN_RESCHEDULE_CONTEXT_CHANGED');
      if (lockedTask.version !== expectedVersion || lockedBatch.updatedAt.toISOString() !== expectedBatchUpdatedAt) throw new Error('PLAN_RESCHEDULE_CONTEXT_CHANGED');
      if (!lockedTask.warehouseException.actualArrivalAt || completedWorkOrder(lockedWorkOrder)) throw new Error('PLAN_RESCHEDULE_CONTEXT_CHANGED');
      const before = planBatchSnapshot({
        quantity: lockedBatch.quantity,
        weekStartDate: lockedBatch.weekStartDate,
        weekEndDate: lockedBatch.weekEndDate,
        plannedCompletionDate: lockedBatch.plannedCompletionDate,
        unitMilliseconds: lockedBatch.unitMillisecondsSnapshot,
        batchNo: lockedBatch.batchNo,
        releaseState: lockedBatch.releaseState,
      });
      await tx.productionPlanBatch.update({
        where: { id: lockedBatch.id },
        data: {
          plannedCompletionDate: completionDate,
          weekStartDate: targetWeek.start,
          weekEndDate: targetWeek.end,
        },
      });
      await tx.workOrder.update({
        where: { id: lockedWorkOrder.id },
        data: {
          plannedAt: completionDate,
          weekStartDate: targetWeek.start,
          weekEndDate: targetWeek.end,
          ...(customerDueDate ? { deliveryDay: chinaDate(customerDueDate) } : {}),
        },
      });
      if (customerDueDate) {
        await tx.productionPlanOrder.update({
          where: { id: lockedBatch.planOrderId },
          data: { customerDueDate, updatedById: actor.id },
        });
        const linkedBatches = await tx.productionPlanBatch.findMany({
          where: { planOrderId: lockedBatch.planOrderId, deletedAt: null, workOrderId: { not: null } },
          select: { workOrderId: true },
        });
        const linkedWorkOrderIds = linkedBatches.map(item => item.workOrderId).filter((id): id is string => Boolean(id));
        if (linkedWorkOrderIds.length) await tx.workOrder.updateMany({
          where: { id: { in: linkedWorkOrderIds }, completedAt: null, deletedAt: null },
          data: { deliveryDay: chinaDate(customerDueDate) },
        });
      }
      await tx.productionPlanChange.create({
        data: {
          planOrderId: lockedBatch.planOrderId,
          batchId: lockedBatch.id,
          action: 'reschedule_after_material_arrival',
          beforeData: before,
          afterData: planBatchSnapshot({
            quantity: lockedBatch.quantity,
            weekStartDate: targetWeek.start,
            weekEndDate: targetWeek.end,
            plannedCompletionDate: completionDate,
            unitMilliseconds: lockedBatch.unitMillisecondsSnapshot,
            batchNo: lockedBatch.batchNo,
            releaseState: lockedBatch.releaseState,
          }),
          impactData: {
            source: 'material_follow_up',
            taskId: lockedTask.id,
            actualArrivalAt: lockedTask.warehouseException.actualArrivalAt.toISOString(),
            crossesWeek,
            warehouseProgressKept: true,
            processProgressKept: true,
            previousCustomerDueDate: chinaDate(lockedBatch.planOrder.customerDueDate),
            customerDueDate: chinaDate(customerDueDate || lockedBatch.planOrder.customerDueDate),
          },
          reason,
          actorId: actor.id,
        },
      });
      await tx.materialFollowUpActivity.create({
        data: {
          taskId: lockedTask.id,
          action: 'reschedule_plan_after_arrival',
          fromStatus: lockedTask.status,
          toStatus: lockedTask.status,
          content: `到料后调整计划：${chinaDate(lockedBatch.plannedCompletionDate)} → ${chinaDate(completionDate)}；${reason}`,
          actorId: actor.id,
        },
      });
      await tx.warehouseMaterialActivity.create({
        data: {
          taskId: lockedTask.warehouseTaskId,
          action: 'reschedule_plan_after_arrival',
          fromStatus: lockedTask.warehouseException.status,
          toStatus: lockedTask.warehouseException.status,
          content: reason,
          actorId: actor.id,
          detail: preview,
        },
      });
      return tx.materialFollowUpTask.findUniqueOrThrow({
        where: { id: lockedTask.id },
        include: materialFollowUpDetailInclude,
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10_000, timeout: 30_000 });
    await logOp({
      userId: actor.id,
      action: 'reschedule_plan_after_material_arrival',
      targetType: 'material_follow_up_task',
      targetId: current.id,
      detail: preview,
    });
    return NextResponse.json({ ok: true, preview, task: serializeMaterialFollowUpTask(result) });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof ForbiddenError) return forbidden('需要计划中心修改权限才能调整受影响计划');
    if (error instanceof Error && error.message === 'PLAN_RESCHEDULE_CONTEXT_CHANGED') {
      return NextResponse.json({ ok: false, error: '缺料任务或关联计划已经变化，请刷新后重新预览' }, { status: 409 });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
      return NextResponse.json({ ok: false, error: '计划正被其他账号修改，请刷新后重试' }, { status: 409 });
    }
    console.error('reschedule plan after material arrival failed', error);
    return NextResponse.json({ ok: false, error: '到料后调整计划失败' }, { status: 500 });
  }
}
