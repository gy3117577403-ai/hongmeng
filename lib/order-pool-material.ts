import type { Prisma } from '@prisma/client';
import { PoolError } from './order-pool-domain';
import { synchronizeMaterialProductionHold } from './production-plan-holds';
export async function lockOrderPool(tx: Prisma.TransactionClient) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(734247::bigint)`;
}
export async function ensurePoolPreparation(tx: Prisma.TransactionClient, orderId: string, actorId: string | null) {
  const order = await tx.productionPlanOrder.findUniqueOrThrow({ where: { id: orderId }, include: { batches: { where: { deletedAt: null }, select: { quantity: true } } } });
  if (order.deletedAt || ['cancelled', 'completed'].includes(order.status) || order.batches.reduce((n,b) => n+b.quantity,0) >= order.orderQuantity) return null;
  if (!order.preparationRank) {
    const max = await tx.productionPlanOrder.aggregate({ _max: { preparationRank: true } });
    await tx.productionPlanOrder.update({ where: { id: orderId }, data: { preparationRank: (max._max.preparationRank || 0) + 1 } });
  }
  return tx.warehouseMaterialTask.upsert({ where: { planOrderId: orderId }, create: { planOrderId: orderId, updatedById: actorId }, update: {} });
}
/** The parent's confirmed product units are allocated once, oldest scheduled batch first. */
export async function distributePoolCoverage(tx: Prisma.TransactionClient, orderId: string, actorId: string | null) {
  const order = await tx.productionPlanOrder.findUniqueOrThrow({
    where: { id: orderId },
    include: { poolMaterialTask: true, batches: {
      where: { deletedAt: null, poolPreparationLinked: true },
      orderBy: [{ createdAt: 'asc' }, { batchNo: 'asc' }],
      include: { workOrder: { select: { id: true, materialTask: { include: {
        exceptionCases: { where: { status: 'OPEN' }, select: { id: true } },
      } } } } },
    } },
  });
  const source = order.poolMaterialTask;
  if (!source) return;
  let available = Math.min(source.preparedQuantity, order.orderQuantity);
  for (const batch of order.batches) {
    const credit = Math.min(available, batch.quantity); available -= credit;
    if (batch.poolPreparedQuantity !== credit) await tx.productionPlanBatch.update({ where: { id: batch.id }, data: { poolPreparedQuantity: credit } });
    const task = batch.workOrder?.materialTask;
    if (!task) continue;
    const full = credit === batch.quantity && !task.exceptionCases.length;
    // A separately confirmed weekly task remains valid; a carried confirmation is revoked with its source.
    const wasCarried = task.poolCompletionInherited;
    const next = full ? 'completed' : wasCarried ? (task.exceptionCases.length ? 'exception' : 'pending') : task.status;
    await tx.warehouseMaterialTask.update({ where: { id: task.id }, data: {
      preparationTaskId: source.id, preparedQuantity: credit, status: next,
      poolCompletionInherited: full && (wasCarried || task.status !== 'completed'),
      ...(full ? { completedAt: source.completedAt || new Date(), completedById: actorId, requirementsConfirmed: true } : wasCarried ? { completedAt: null, completedById: null, requirementsConfirmed: false } : {}),
      ...(task.status !== next || task.preparedQuantity !== credit ? { version: { increment: 1 }, updatedById: actorId } : {}),
    } });
    if (task.status !== next && batch.workOrderId) {
      await tx.workOrder.update({ where: { id: batch.workOrderId }, data: { materialStatus: full ? '已配料' : '待配料' } });
      if (actorId) await synchronizeMaterialProductionHold(tx, { workOrderId: batch.workOrderId, warehouseTaskId: task.id, status: next as 'pending' | 'completed' | 'exception', exceptionType: null, exceptionNote: null, expectedAt: null, actorId });
      await tx.warehouseMaterialActivity.create({ data: { taskId: task.id, action: 'pool_coverage', actorId, content: `订单池确认覆盖 ${credit}/${batch.quantity} 套`, detail: { sourceTaskId: source.id } } });
    }
  }
}
export async function confirmPoolQuantity(tx: Prisma.TransactionClient, taskId: string, quantity: number, actorId: string) {
  const task = await tx.warehouseMaterialTask.findUniqueOrThrow({ where: { id: taskId }, include: { planOrder: { include: { batches: { where: { deletedAt: null }, select: { poolPreparedQuantity: true } } } } } });
  const order = task.planOrder;
  if (!order) throw new PoolError('该任务不是订单池配料');
  if (quantity > (order.preparationQuantity ?? order.orderQuantity)) throw new PoolError('已配套数量不能超过计划准备数量');
  const consumed = order.batches.reduce((n,b) => n+b.poolPreparedQuantity,0);
  if (quantity < consumed) throw new PoolError(`已有 ${consumed} 套分配到周计划；如需撤销请使用重新核对`,409);
  const open = await tx.warehouseMaterialExceptionCase.count({ where: { warehouseTaskId: taskId, status: 'OPEN' } });
  const full = (order.preparationQuantity ?? order.orderQuantity)>0 && quantity >= (order.preparationQuantity ?? order.orderQuantity);
  if (full && open) throw new PoolError('请先确认缺料事项已解决，再确认全部配齐',409);
  await tx.warehouseMaterialTask.update({ where: { id: taskId }, data: { preparedQuantity: quantity, status: full ? 'completed' : open ? 'exception' : 'pending', completedAt: full ? new Date() : null, completedById: full ? actorId : null, requirementsConfirmed: full, updatedById: actorId, version: { increment: 1 } } });
  await tx.warehouseMaterialActivity.create({ data: { taskId, action: 'confirm_prepared', actorId, content: `仓库确认累计可配套 ${quantity} / ${order.preparationQuantity ?? order.orderQuantity} 套` } });
  await distributePoolCoverage(tx, order.id, actorId);
}
