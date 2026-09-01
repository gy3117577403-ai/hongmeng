import { Prisma } from '@prisma/client';
import { ProductionControlError, serializeProductionControl } from '@/lib/production-control';
import { getProductionQuantitySummary, type ProductionQuantityInput } from '@/lib/production-quantity';
import { lockProductionWorkOrder } from '@/lib/production-work-order-lock';

export { lockProductionWorkOrder } from '@/lib/production-work-order-lock';

export function isProductionSerializationConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && (error.code === 'P2034'
    || (error.code === 'P2010' && ['40001', '40P01'].includes(String(error.meta?.code))));
}

export type ProductionBackfillAuthorization = {
  requestId: string; actorId: string; actorName: string; reason: string;
  workStartedAt: Date; workEndedAt: Date; expectedPauseAt: string;
};

export type ProductionWipSourceGate = {
  productionPlanBatchId: string | null;
  movedOutQuantity: number;
  outstandingWipQuantity: number;
  nativeRemainingQuantity: number | null;
  fullyMovedOut: boolean;
};

/**
 * Read the durable WIP ownership for an original work order while its row is
 * locked. Terminal-step active credits are already reflected in the work
 * order's completed quantity, so they must be removed from WIP outstanding
 * quantity before deciding whether any native execution remains.
 */
export async function loadProductionWipSourceGate(
  tx: Prisma.TransactionClient,
  order: ProductionQuantityInput & { id: string },
): Promise<ProductionWipSourceGate> {
  const batch = await tx.productionPlanBatch.findFirst({
    where: { workOrderId: order.id, deletedAt: null },
    select: { id: true },
  });
  if (!batch) {
    return {
      productionPlanBatchId: null,
      movedOutQuantity: 0,
      outstandingWipQuantity: 0,
      nativeRemainingQuantity: getProductionQuantitySummary(order).remainingQty,
      fullyMovedOut: false,
    };
  }
  const lots = await tx.semiFinishedLot.findMany({
    where: {
      workOrderId: order.id,
      productionPlanBatchId: batch.id,
      scheduleStatus: { not: 'CANCELLED' },
    },
    select: {
      quantity: true,
      steps: {
        orderBy: { position: 'desc' },
        take: 1,
        select: {
          remainingQty: true,
          allocationSteps: {
            select: {
              credits: {
                where: { status: 'ACTIVE' },
                select: { quantity: true },
              },
            },
          },
        },
      },
    },
  });
  const movedOutQuantity = lots.reduce((sum, lot) => sum + lot.quantity, 0);
  const outstandingWipQuantity = lots.reduce((sum, lot) => {
    const terminalStep = lot.steps[0];
    if (!terminalStep) return sum + lot.quantity;
    const creditedQuantity = terminalStep.allocationSteps.reduce((allocationSum, allocationStep) => (
      allocationSum + allocationStep.credits.reduce((creditSum, credit) => creditSum + credit.quantity, 0)
    ), 0);
    return sum + Math.max(0, terminalStep.remainingQty - creditedQuantity);
  }, 0);
  const remainingQuantity = getProductionQuantitySummary(order).remainingQty;
  const nativeRemainingQuantity = remainingQuantity === null
    ? null
    : Math.max(0, remainingQuantity - outstandingWipQuantity);
  return {
    productionPlanBatchId: batch.id,
    movedOutQuantity,
    outstandingWipQuantity,
    nativeRemainingQuantity,
    fullyMovedOut: movedOutQuantity > 0 && nativeRemainingQuantity === 0,
  };
}

async function assertNoActiveNonMaterialHold(
  tx: Prisma.TransactionClient,
  rootWorkOrderId: string,
): Promise<void> {
  const activeHold = await tx.productionPlanBatchHold.findFirst({
    where: {
      status: 'ACTIVE',
      holdType: { not: 'MATERIAL' },
      OR: [
        { workOrderId: rootWorkOrderId },
        { batch: { workOrderId: rootWorkOrderId } },
      ],
    },
    select: { reason: true },
    orderBy: { frozenAt: 'asc' },
  });
  if (activeHold) {
    throw new ProductionControlError(
      `工单已冻结：${activeHold.reason || '请联系计划确认恢复'}。本次生产操作未提交。`,
      'PRODUCTION_HELD',
      409,
    );
  }
}

/** Planning/scheduling is independent from warehouse material readiness. */
export async function assertProductionMayBeScheduled(
  tx: Prisma.TransactionClient,
  workOrderId: string,
): Promise<void> {
  const root = await lockProductionWorkOrder(tx, workOrderId);
  await assertNoActiveNonMaterialHold(tx, root.id);
  const wipSourceGate = await loadProductionWipSourceGate(tx, root);
  if (wipSourceGate.fullyMovedOut) {
    throw new ProductionControlError(
      '该来源订单的剩余任务已全部转入半成品仓；原安排仅保留历史，不得新排、续排或重排人员。请在目标周半成品续作行执行。',
      'PRODUCTION_WIP_SOURCE_FULLY_MOVED',
      409,
    );
  }
  if (root.productionPausedAt) {
    const view = serializeProductionControl(root);
    throw new ProductionControlError(
      `工单已暂停：${view.pause?.reason || '请联系计划或主管确认恢复'}。本次计划操作未提交。`,
      'PRODUCTION_PAUSED',
      409,
    );
  }
}

export async function assertProductionMayRun(
  tx: Prisma.TransactionClient,
  workOrderId: string,
  backfill?: ProductionBackfillAuthorization,
): Promise<void> {
  const root = await lockProductionWorkOrder(tx, workOrderId);
  await assertNoActiveNonMaterialHold(tx, root.id);
  if (!root.productionPausedAt) {
    if (backfill) throw new ProductionControlError('暂停状态已变化，请刷新后重新确认补录方式', 'PRODUCTION_BACKFILL_INVALID', 409);
  } else if (backfill) {
    if (!backfill.reason.trim() || backfill.expectedPauseAt !== root.productionPausedAt.toISOString()
      || backfill.workEndedAt > root.productionPausedAt || backfill.workStartedAt >= backfill.workEndedAt
      || !Number.isFinite(backfill.workStartedAt.getTime()) || !Number.isFinite(backfill.workEndedAt.getTime())) {
      throw new ProductionControlError('只能补录本次暂停前已实际完成的工作，请核对作业起止时间及暂停版本', 'PRODUCTION_BACKFILL_INVALID', 409);
    }
    // Authorization is created by the dedicated authenticated backfill route, never from a public request body.
    await tx.productionControlEvent.create({ data: {
      workOrderId: root.id, action: 'backfill_before_pause', reason: backfill.reason,
      actorId: backfill.actorId, actorName: backfill.actorName, requestId: `backfill:${backfill.requestId}`,
      requestHash: backfill.requestId,
      beforeData: { pausedAt: root.productionPausedAt.toISOString() },
      afterData: { workOrderId, workStartedAt: backfill.workStartedAt.toISOString(), workEndedAt: backfill.workEndedAt.toISOString() },
    } });
    return;
  } else {
    const view = serializeProductionControl(root);
    throw new ProductionControlError(`工单已暂停：${view.pause?.reason || '请联系计划或主管确认恢复'}。本次生产操作未提交。`, 'PRODUCTION_PAUSED', 409);
  }

  // Warehouse readiness and material exceptions are operational warnings.
  // They never authorize or prohibit production. Explicit manual pauses and
  // non-material holds remain the only generic execution guards here.
}

/** Read filters do not replace the transactional guard. */
const withoutActivePlanHold: Prisma.WorkOrderWhereInput = {
  OR: [
    { productionPlanBatch: { is: null } },
    { productionPlanBatch: { is: { holds: { none: { status: 'ACTIVE', holdType: { not: 'MATERIAL' } } } } } },
  ],
};

export const runningProductionWorkOrderWhere: Prisma.WorkOrderWhereInput = {
  productionPausedAt: null,
  AND: [
    withoutActivePlanHold,
    {
      OR: [
        { rootWorkOrderId: null },
        {
          rootWorkOrder: {
            is: {
              productionPausedAt: null,
              AND: [withoutActivePlanHold],
            },
          },
        },
      ],
    },
  ],
};
