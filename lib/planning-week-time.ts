import type { Prisma } from '@prisma/client';
import { getProductionQuantitySummary } from './production-quantity';
import { weekRemainder } from './planning-week-domain';
import { chinaDateKey } from './china-date';

/** Keep weekly allocations coherent when existing plan editing changes time. */
export async function refreshPlanningWeekTime(tx: Prisma.TransactionClient, batchId: string, previousTotal: bigint | null) {
  const batch = await tx.productionPlanBatch.findUnique({ where: { id: batchId }, include: {
    weekSlots: { orderBy: { weekStartDate: 'asc' } }, planOrder: true,
    workOrder: { include: { processRoute: { include: { steps: { where: { retiredAt: null }, include: { supplementObligation: true } } } } } },
  } });
  if (!batch?.weekSlots?.length) return;
  const unit = batch.unitMillisecondsSnapshot || batch.planOrder.planningUnitMilliseconds;
  const total = unit ? BigInt(unit) * BigInt(batch.quantity) : null;
  const remaining = weekRemainder(batch.quantity, unit, batch.workOrder ? getProductionQuantitySummary(batch.workOrder).completedQty || 0 : 0, batch.workOrder?.processRoute?.steps || []);
  const current = batch.weekSlots.find(s => chinaDateKey(s.weekStartDate) === chinaDateKey(batch.weekStartDate));
  if (!current) throw new Error('WEEK_ALLOCATION_SOURCE_MISSING');
  let historicalTotal = 0n, historicalQuantity = 0;
  for (const slot of batch.weekSlots.filter(s => s.id !== current.id)) {
    const value = total === null ? null : previousTotal && slot.plannedMilliseconds !== null
      ? total * slot.plannedMilliseconds / previousTotal
      : remaining.standard && slot.standardMilliseconds !== null ? total * slot.standardMilliseconds / remaining.standard
        : total * BigInt(slot.quantity) / BigInt(Math.max(1, batch.quantity));
    historicalTotal += value || 0n; historicalQuantity += slot.quantity;
    await tx.productionPlanWeekSlot.update({ where: { id: slot.id }, data: { plannedMilliseconds: value } });
  }
  const currentTotal = total === null ? null : batch.scheduleState === 'DEFERRED'
    ? total - (remaining.remainingPlanned || 0n) - historicalTotal : total - historicalTotal;
  await tx.productionPlanWeekSlot.update({ where: { id: current.id }, data: {
    quantity: Math.max(0, batch.quantity - historicalQuantity - (batch.scheduleState === 'DEFERRED' ? remaining.remainingQuantity : 0)),
    plannedMilliseconds: currentTotal === null ? null : currentTotal > 0n ? currentTotal : 0n,
  } });
}
