import { Prisma } from '@prisma/client';

type LifecycleStep = {
  id: string; sequenceGroup: number; executionMode: string;
  inputQty: number; processedQty: number; releasedGoodQty: number;
  status: string; startedAt: Date | null; completedAt: Date | null; completedById: string | null;
};

/** Shared by reporting, withdrawal and route publication, using material order. */
export async function reconcileQuantityStepStatuses<T extends LifecycleStep>(
  tx: Prisma.TransactionClient,
  steps: T[],
  input: { targetQty: number; userId: string | null; now: Date },
): Promise<boolean> {
  const pending = await tx.processCompletion.findMany({
    where: { stepId: { in: steps.map(step => step.id) }, voidedAt: null, coverageStatus: { in: ['PENDING', 'PARTIAL'] } },
    select: { stepId: true }, distinct: ['stepId'],
  });
  const pendingIds = new Set(pending.map(report => report.stepId));
  const ordinary = steps.filter(step => step.executionMode === 'NORMAL');
  const groups = [...new Set(ordinary.map(step => step.sequenceGroup))].sort((a, b) => a - b);
  let priorClosed = true;
  let expectedInput = input.targetQty;
  for (const group of groups) {
    const members = ordinary.filter(step => step.sequenceGroup === group);
    const closed: boolean = priorClosed && members.every(step =>
      step.inputQty >= expectedInput && step.processedQty >= step.inputQty && !pendingIds.has(step.id));
    for (const step of members) {
      const status = pendingIds.has(step.id) ? 'current'
        : closed ? (step.inputQty > 0 ? 'completed' : 'skipped')
          : step.inputQty > 0 && step.inputQty >= expectedInput && step.processedQty >= step.inputQty ? 'completed'
          : step.inputQty > step.processedQty || step.processedQty > 0 ? 'current'
            : 'pending';
      const isClosed = status === 'completed' || status === 'skipped';
      if (status === step.status && (isClosed ? !!step.completedAt : !step.completedAt)) continue;
      const data = {
        status,
        startedAt: step.startedAt || (status === 'current' ? input.now : null),
        completedAt: isClosed ? step.completedAt || input.now : null,
        completedById: isClosed ? step.completedById || input.userId : null,
      };
      await tx.workOrderProcessStep.update({ where: { id: step.id }, data });
      Object.assign(step, data);
    }
    priorClosed = closed;
    expectedInput = Math.min(...members.map(step => step.releasedGoodQty));
  }
  return steps.every(step => step.status === 'completed' || step.status === 'skipped');
}
