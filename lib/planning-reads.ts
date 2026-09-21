import { prisma } from '@/lib/prisma';
import { productionPlanOrderInclude, serializeProductionPlanOrder } from '@/lib/production-planning';
import { loadWipContinuations } from '@/lib/wip-continuations';

export type PlanningReadMode = 'legacy' | 'all' | 'week' | 'metadata' | 'options';
function addDays(value: Date, days: number) { return new Date(value.getTime() + days * 86400000); }

/** Scoped rows and global allocation totals are intentionally independent. */
export async function loadPlanningRows(read: PlanningReadMode, weekDate?: Date | null) {
    const weekWhere = read === 'week' && weekDate
      ? { weekStartDate: { gte: weekDate, lt: addDays(weekDate, 1) } } : {};
    const metadata = read === 'metadata';
    // Metadata keeps the same count inputs without loading print snapshots, route steps or risk archives.
    const batchInclude = productionPlanOrderInclude.batches.include;
    const workSelect = batchInclude.workOrder.select;
    const include = {
      ...productionPlanOrderInclude,
      drawingLibraryItem: { select: {
        ...productionPlanOrderInclude.drawingLibraryItem.select,
        qualityRiskRevisionLinks: { ...productionPlanOrderInclude.drawingLibraryItem.select.qualityRiskRevisionLinks, ...(metadata ? { take: 0 } : {}) },
        quickQualityRecords: { ...productionPlanOrderInclude.drawingLibraryItem.select.quickQualityRecords, ...(metadata ? { take: 0 } : {}) },
      } },
      batches: { ...productionPlanOrderInclude.batches, where: { deletedAt: null, ...weekWhere }, include: {
        ...batchInclude,
        holds: { ...batchInclude.holds, ...(metadata ? { take: 0 } : {}) },
        workOrder: { select: { ...workSelect,
          processRoute: { select: { ...workSelect.processRoute.select, steps: { ...workSelect.processRoute.select.steps, ...(metadata ? { take: 0 } : {}) } } },
          qrTicket: { select: { prints: { ...workSelect.qrTicket.select.prints, take: metadata ? 0 : 1 } } },
        } },
      } },
    };
    const [allRecords, allWipContinuations] = await Promise.all([
      read === 'options' ? Promise.resolve([]) : prisma.productionPlanOrder.findMany({
        where: { deletedAt: null, ...(read === 'week' ? { batches: { some: { deletedAt: null, ...weekWhere } } } : {}) },
        include,
        orderBy: [{ priority: 'asc' }, { customerDueDate: 'asc' }, { createdAt: 'desc' }],
      }),
      read === 'options' ? Promise.resolve([]) : loadWipContinuations({ targetWeekStartDate: read === 'week' ? weekDate : undefined }),
    ]);
    // Week filtering must not redefine the order's total allocated/remaining quantity.
    const allocationRows = read === 'week' && allRecords.length
      ? await prisma.productionPlanBatch.groupBy({
        by: ['planOrderId'], where: { deletedAt: null, planOrderId: { in: allRecords.map(order => order.id) } },
        _sum: { quantity: true },
      }) : [];
    const allocations = new Map(allocationRows.map(row => [row.planOrderId, row._sum.quantity || 0]));
    const orders = allRecords.map(record => {
      const order = serializeProductionPlanOrder(record);
      if (read !== 'week') return order;
      const allocatedQuantity = allocations.get(record.id) || 0;
      return { ...order, allocatedQuantity, remainingQuantity: Math.max(0, order.orderQuantity - allocatedQuantity) };
    });
    return { orders, wipContinuations: allWipContinuations };
}
