import { prisma } from '@/lib/prisma';
import { chinaDateKey } from '@/lib/china-date';
import { chinaWeekRange } from '@/lib/production-planning';
import { productionTeamScopeWhere, type ProductionEntityScope } from '@/lib/production-access-scope';
import { summarizeWeeklyPlanProgress, reportWeekStorageRange, type ReportWeekBucket } from '@/lib/report-operations';
import type { Prisma } from '@prisma/client';

/** Both execution and reports count actual finished output. WIP transfer itself earns no output. */
export async function loadWeeklyProductionOutcomes(buckets: ReportWeekBucket[], cutoff: Date, scope?: ProductionEntityScope) {
  const range = reportWeekStorageRange(buckets);
  if (!range) return [];
  const teamWhere = scope ? productionTeamScopeWhere(scope) as Prisma.ProductionTeamWhereInput | null : null;
  const [batches, allocations] = await Promise.all([
    prisma.productionPlanBatch.findMany({ where: { deletedAt: null, planOrder: { deletedAt: null },
      releaseState: { not: 'cancelled' }, weekStartDate: range,
      ...(teamWhere ? { dailyProcessTasks: { some: { status: { not: 'CANCELLED' }, plan: { team: teamWhere } } } } : {}),
    }, select: { id: true, quantity: true, workOrderId: true, weekStartDate: true,
      workOrder: { select: { deletedAt: true } },
      semiFinishedLots: { where: { scheduleStatus: { not: 'CANCELLED' }, enteredAt: { lt: cutoff } },
        select: { id: true, quantity: true, allocations: { where: { status: { not: 'CANCELLED' } },
          select: { id: true, status: true, quantity: true, completedQty: true, targetWeekStartDate: true } } } },
    } }),
    prisma.wipWeekAllocation.findMany({ where: { targetWeekStartDate: range, scheduledAt: { lt: cutoff }, status: { not: 'CANCELLED' },
      lot: { scheduleStatus: { not: 'CANCELLED' }, workOrder: { deletedAt: null }, productionPlanBatch: { deletedAt: null, planOrder: { deletedAt: null } } },
      ...(teamWhere ? { team: { is: teamWhere } } : {}),
    }, select: { id: true, status: true, quantity: true, completedQty: true, targetWeekStartDate: true,
      lot: { select: { id: true, workOrderId: true, productionPlanBatchId: true,
        productionPlanBatch: { select: { weekStartDate: true } } } } } }),
  ]);
  const workOrderIds = [...new Set([...batches.flatMap(batch => batch.workOrderId ? [batch.workOrderId] : []),
    ...allocations.map(allocation => allocation.lot.workOrderId)])];
  const movements = workOrderIds.length ? await prisma.processQuantityMovement.findMany({ where: {
    workOrderId: { in: workOrderIds }, type: 'FINISHED_GOOD', voidedAt: null, reversalOfId: null,
    createdAt: { lt: cutoff }, completion: { voidedAt: null },
  }, select: { id: true, completionId: true, workOrderId: true, quantity: true,
    completion: { select: { wipCredits: { where: { status: 'ACTIVE', voidedAt: null },
      select: { quantity: true, allocationStep: { select: { allocationId: true } } } } } } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  }) : [];
  const nativeCompleted = new Map<string, number>();
  const allocationCompleted = new Map<string, number>();
  // Coverage can emit more than one movement for a single report; allocate its WIP slice once.
  const consumedCredits = new Map<string, number>();
  for (const movement of movements) {
    let native = movement.quantity;
    for (const credit of movement.completion.wipCredits) {
      const key = `${movement.completionId}:${credit.allocationStep.allocationId}`;
      const used = consumedCredits.get(key) || 0;
      const quantity = Math.min(native, Math.max(0, credit.quantity - used));
      allocationCompleted.set(credit.allocationStep.allocationId, (allocationCompleted.get(credit.allocationStep.allocationId) || 0) + quantity);
      consumedCredits.set(key, used + quantity);
      native -= quantity;
    }
    nativeCompleted.set(movement.workOrderId, (nativeCompleted.get(movement.workOrderId) || 0) + native);
  }
  const effective = (allocation: { id: string; quantity: number; completedQty: number; status: string }) => ({
    quantity: allocation.status === 'SUPERSEDED' ? Math.max(0, allocation.completedQty) : allocation.quantity,
    completed: Math.min(allocation.quantity, allocationCompleted.get(allocation.id) || 0),
  });
  const adjustments = new Map<string, { originalQuantity: number; movedQuantity: number; incomingQuantity: number }>();
  const adjustmentFor = (key: string) => {
    let value = adjustments.get(key);
    if (!value) { value = { originalQuantity: 0, movedQuantity: 0, incomingQuantity: 0 }; adjustments.set(key, value); }
    return value;
  };
  const rows: { id: string; weekStartDateKey: string; quantity: number; completedQuantity: number }[] = [];
  for (const batch of batches) {
    if (batch.workOrder?.deletedAt) continue;
    const weekKey = chinaDateKey(batch.weekStartDate);
    const adjustment = adjustmentFor(weekKey); adjustment.originalQuantity += batch.quantity;
    let moved = 0;
    let sameWeekCompleted = 0;
    for (const lot of batch.semiFinishedLots) {
      const sameWeek = lot.allocations.filter(allocation => chinaDateKey(allocation.targetWeekStartDate) === weekKey);
      const retained = sameWeek.reduce((sum, allocation) => sum + effective(allocation).quantity, 0);
      moved += Math.max(0, lot.quantity - retained);
      sameWeekCompleted += sameWeek.reduce((sum, allocation) => sum + effective(allocation).completed, 0);
    }
    moved = Math.min(batch.quantity, moved); adjustment.movedQuantity += moved;
    const quantity = Math.max(0, batch.quantity - moved);
    if (quantity <= 0) continue;
    rows.push({ id: batch.id, weekStartDateKey: weekKey, quantity,
      completedQuantity: Math.min(quantity, (nativeCompleted.get(batch.workOrderId || '') || 0) + sameWeekCompleted) });
  }
  for (const allocation of allocations) {
    const weekKey = chinaDateKey(allocation.targetWeekStartDate);
    if (weekKey === chinaDateKey(allocation.lot.productionPlanBatch.weekStartDate)) continue;
    const progress = effective(allocation);
    if (progress.quantity <= 0) continue;
    adjustmentFor(weekKey).incomingQuantity += progress.quantity;
    rows.push({ id: `wip:${allocation.id}`, weekStartDateKey: weekKey, quantity: progress.quantity, completedQuantity: progress.completed });
  }
  return summarizeWeeklyPlanProgress(buckets, rows, chinaDateKey(cutoff)).map(row => ({ ...row,
    ...(adjustments.get(row.key) || { originalQuantity: 0, movedQuantity: 0, incomingQuantity: 0 }),
    metricVersion: 'actual-finished-output-v3',
  }));
}

export async function loadProductionOutcomeSummary(start: Date, scope?: ProductionEntityScope) {
  const week = chinaWeekRange(start);
  const key = chinaDateKey(week.start);
  const [row] = await loadWeeklyProductionOutcomes([{ key, label: '生产周', startDate: key, endDate: chinaDateKey(week.end) }], new Date(), scope);
  return {
    planTotals: { totalOrders: row?.plannedBatches || 0, completedOrders: row?.completedBatches || 0,
      percentage: row?.batchCompletionBasisPoints == null ? null : row.batchCompletionBasisPoints / 100 },
    quantityTotals: { targetQty: row?.plannedQuantity || 0, completedQty: row?.completedQuantity || 0,
      percentage: row?.quantityCompletionBasisPoints == null ? null : row.quantityCompletionBasisPoints / 100,
      knownOrders: row?.plannedBatches || 0, missingOrders: 0 },
    planAdjustment: { originalQuantity: row?.originalQuantity || 0, movedQuantity: row?.movedQuantity || 0, scheduledQuantity: row?.incomingQuantity || 0 },
  };
}
