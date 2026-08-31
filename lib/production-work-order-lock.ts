import { Prisma } from '@prisma/client';
import { ProductionControlError } from '@/lib/production-control';

/** Lock the addressed work order and its root in stable id order. */
export async function lockProductionWorkOrder(tx: Prisma.TransactionClient, workOrderId: string) {
  const identity = await tx.workOrder.findUnique({
    where: { id: workOrderId },
    select: { id: true, rootWorkOrderId: true },
  });
  if (!identity) throw new ProductionControlError('工单不存在', 'WORK_ORDER_NOT_FOUND', 404);
  const ids = [...new Set([identity.id, identity.rootWorkOrderId || identity.id])].sort();
  await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "work_orders" WHERE "id" IN (${Prisma.join(ids)}) ORDER BY "id" FOR UPDATE`);
  return tx.workOrder.findUniqueOrThrow({ where: { id: identity.rootWorkOrderId || identity.id } });
}
