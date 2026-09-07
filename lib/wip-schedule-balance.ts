import type { Prisma } from '@prisma/client';

/** Entry snapshots describe ownership; reports and active schedules describe remaining work. */
export async function loadWipScheduleBalances(tx: Prisma.TransactionClient, lotId: string, excludeAllocationId?: string) {
  const lot = await tx.semiFinishedLot.findUniqueOrThrow({ where: { id: lotId }, include: {
    workOrder: { select: { productionTargetQty: true, uncompletedQty: true } },
    steps: { where: { status: { not: 'CANCELLED' } }, include: {
      step: { select: { supplementObligation: { select: { requiredQty: true, systemCoveredQty: true } } } },
      allocationSteps: { include: { credits: { where: { status: 'ACTIVE' } } } },
    } },
  } });
  const ids = lot.steps.map(step => step.stepId);
  const [reports, commitments, pending] = await Promise.all([
    tx.processCompletion.groupBy({ by: ['stepId'], where: { stepId: { in: ids }, voidedAt: null }, _sum: { processedQty: true } }),
    tx.wipWeekAllocationStep.findMany({ where: { lotStep: { stepId: { in: ids } }, status: { not: 'CANCELLED' },
      allocation: { status: { in: ['ACTIVE', 'IN_PROGRESS'] }, ...(excludeAllocationId ? { id: { not: excludeAllocationId } } : {}) } },
      select: { lotStepId: true, plannedQty: true, completedQty: true, lotStep: { select: { stepId: true } } } }),
    tx.processReportSubmission.findMany({ where: { stepId: { in: ids }, status: 'PENDING', completionId: null },
      select: { stepId: true, reservedProductQty: true } }),
  ]);
  return lot.steps.map(step => {
    const credited = step.allocationSteps.reduce((sum, row) => sum + row.credits.reduce((n, credit) => n + credit.quantity, 0), 0);
    const obligation = step.step.supplementObligation;
    const target = obligation ? Math.max(0, obligation.requiredQty - obligation.systemCoveredQty)
      : lot.workOrder.productionTargetQty || Number(lot.workOrder.uncompletedQty) || lot.quantity;
    const reported = reports.find(row => row.stepId === step.stepId)?._sum.processedQty || 0;
    const remainingQty = Math.max(0, Math.min(step.remainingQty - credited, target - reported));
    const outstanding = commitments.filter(row => row.lotStep.stepId === step.stepId);
    const globalScheduled = outstanding.reduce((sum, row) => sum + Math.max(0, row.plannedQty - row.completedQty), 0);
    const scheduledQty = outstanding.filter(row => row.lotStepId === step.id).reduce((sum, row) => sum + Math.max(0, row.plannedQty - row.completedQty), 0);
    return { lotStepId: step.id, stepId: step.stepId, processName: step.processName, remainingQty, scheduledQty,
      pendingQty: pending.filter(row => row.stepId === step.stepId).reduce((sum, row) => sum + row.reservedProductQty, 0),
      availableQty: Math.max(0, Math.min(remainingQty - scheduledQty, target - reported - globalScheduled)) };
  });
}
