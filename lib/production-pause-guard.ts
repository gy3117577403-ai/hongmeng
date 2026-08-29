import { Prisma } from '@prisma/client';
import { ProductionControlError, serializeProductionControl } from '@/lib/production-control';

export function isProductionSerializationConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && (error.code === 'P2034'
    || (error.code === 'P2010' && ['40001', '40P01'].includes(String(error.meta?.code))));
}

/** Use inside the same transaction as the production mutation. */
export async function lockProductionWorkOrder(tx: Prisma.TransactionClient, workOrderId: string) {
  const identity = await tx.workOrder.findUnique({ where: { id: workOrderId }, select: { id: true, rootWorkOrderId: true } });
  if (!identity) throw new ProductionControlError('工单不存在', 'WORK_ORDER_NOT_FOUND', 404);
  const ids = [...new Set([identity.id, identity.rootWorkOrderId || identity.id])].sort();
  await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "work_orders" WHERE "id" IN (${Prisma.join(ids)}) ORDER BY "id" FOR UPDATE`);
  const root = await tx.workOrder.findUniqueOrThrow({ where: { id: identity.rootWorkOrderId || identity.id } });
  return root;
}

export type ProductionBackfillAuthorization = {
  requestId: string; actorId: string; actorName: string; reason: string;
  workStartedAt: Date; workEndedAt: Date; expectedPauseAt: string;
};

export async function assertProductionMayRun(
  tx: Prisma.TransactionClient,
  workOrderId: string,
  backfill?: ProductionBackfillAuthorization,
): Promise<void> {
  const root = await lockProductionWorkOrder(tx, workOrderId);
  const activeHold = await tx.productionPlanBatchHold.findFirst({
    where: {
      status: 'ACTIVE',
      OR: [
        { workOrderId: root.id },
        { batch: { workOrderId: root.id } },
      ],
    },
    select: { holdType: true, reason: true },
    orderBy: { frozenAt: 'asc' },
  });
  if (activeHold) {
    throw new ProductionControlError(
      `工单已冻结：${activeHold.reason || '请联系计划或仓库确认恢复'}。本次生产操作未提交。`,
      'PRODUCTION_HELD',
      409,
    );
  }
  if (!root.productionPausedAt) {
    if (backfill) throw new ProductionControlError('暂停状态已变化，请刷新后重新确认补录方式', 'PRODUCTION_BACKFILL_INVALID', 409);
    return;
  }
  if (backfill) {
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
  }
  const view = serializeProductionControl(root);
  throw new ProductionControlError(`工单已暂停：${view.pause?.reason || '请联系计划或主管确认恢复'}。本次生产操作未提交。`, 'PRODUCTION_PAUSED', 409);
}

/** Read filters do not replace the transactional guard. */
const withoutActivePlanHold: Prisma.WorkOrderWhereInput = {
  OR: [
    { productionPlanBatch: { is: null } },
    { productionPlanBatch: { is: { holds: { none: { status: 'ACTIVE' } } } } },
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
