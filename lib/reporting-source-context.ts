import { Prisma } from '@prisma/client';

export type ReportingWipSource = {
  lotId: string; lotNo: string; quantity: number; unscheduledQuantity: number;
  steps: Array<{ stepId: string; remainingQty: number; pendingQty: number }>;
  allocations: Array<{ id: string; targetWeekStartDate: string; targetWeekEndDate: string; status: string; quantity: number;
    steps: Array<{ stepId: string; remainingQty: number }> }>;
};

/** All quantities here exclude active pending reservations. Preserve old/future week allocations for explicit selection. */
export async function loadReportingWipSources(tx: Prisma.TransactionClient, workOrderId: string, excludeSubmissionId?: string): Promise<ReportingWipSource[]> {
  const [lots, pending] = await Promise.all([
    tx.semiFinishedLot.findMany({ where: { workOrderId, scheduleStatus: { notIn: ['COMPLETED', 'CANCELLED'] } }, include: {
      steps: { where: { status: { not: 'CANCELLED' } }, include: { allocationSteps: { include: { credits: { where: { status: 'ACTIVE' } } } } } },
      allocations: { where: { status: { in: ['ACTIVE', 'IN_PROGRESS'] } }, include: {
        steps: { where: { status: { not: 'CANCELLED' } }, include: { lotStep: { select: { stepId: true } } } },
      } },
    }, orderBy: [{ enteredAt: 'asc' }, { id: 'asc' }] }),
    tx.processReportSubmission.findMany({ where: { workOrderId, status: 'PENDING', completionId: null, sourceKind: 'WIP', ...(excludeSubmissionId ? { id: { not: excludeSubmissionId } } : {}) },
      select: { stepId: true, sourceLotId: true, sourceAllocationId: true, reservedProductQty: true } }),
  ]);
  return lots.map(lot => {
    const allocations = lot.allocations.map(allocation => ({
      id: allocation.id, targetWeekStartDate: allocation.targetWeekStartDate.toISOString().slice(0, 10),
      targetWeekEndDate: allocation.targetWeekEndDate.toISOString().slice(0, 10), status: allocation.status, quantity: allocation.quantity,
      steps: allocation.steps.map(step => ({ stepId: step.lotStep.stepId,
        remainingQty: Math.max(0, step.plannedQty - step.completedQty - pending.filter(item => item.stepId === step.lotStep.stepId && item.sourceAllocationId === allocation.id)
          .reduce((sum, item) => sum + item.reservedProductQty, 0)) })),
    }));
    const steps = lot.steps.map(step => {
      const credited = step.allocationSteps.reduce((sum, allocationStep) => sum + allocationStep.credits.reduce((n, credit) => n + credit.quantity, 0), 0);
      const pendingQty = pending.filter(item => item.stepId === step.stepId && item.sourceLotId === lot.id).reduce((sum, item) => sum + item.reservedProductQty, 0);
      return { stepId: step.stepId, remainingQty: Math.max(0, step.remainingQty - credited - pendingQty), pendingQty };
    });
    const unscheduledQuantity = Math.max(0, ...steps.map(step => step.remainingQty - allocations.reduce((sum, allocation) => sum
      + (allocation.steps.find(item => item.stepId === step.stepId)?.remainingQty || 0), 0)));
    return { lotId: lot.id, lotNo: lot.lotNo, quantity: lot.quantity, unscheduledQuantity, steps, allocations };
  });
}
