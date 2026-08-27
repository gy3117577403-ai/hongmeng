import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { reconcileSupplementRouteCompletion } from '@/lib/process-completion-service';
import { syncDailyTasksAfterProcessRouteChange } from '@/lib/process-route-change-daily-task-sync';
import { processSupplementActualRequiredQty } from '@/lib/process-supplement-coverage';

const closedStatuses = ['completed', 'skipped'];
const candidateWhere = (): Prisma.WorkOrderProcessRouteWhereInput => ({
  status: 'in_progress',
  workOrder: {
    deletedAt: null, planClearedAt: null,
    planType: { in: ['weekly_plan', 'managed_plan'] },
    OR: [{ branchStatus: null }, { branchStatus: { not: 'CANCELLED' } }],
  },
  supplementObligations: {
    some: { status: 'FULFILLED' },
    none: { status: 'ACTIVE' },
  },
  steps: {
    some: { retiredAt: null, executionMode: 'NORMAL', status: 'current', inputQty: { gt: 0 } },
    none: {
      retiredAt: null,
      OR: [
        { executionMode: 'NORMAL', processedQty: { not: { equals: prisma.workOrderProcessStep.fields.inputQty } } },
        { executionMode: 'NORMAL', status: { notIn: ['current', ...closedStatuses] } },
        { executionMode: 'SUPPLEMENTAL_OBLIGATION', status: { notIn: closedStatuses } },
      ],
    },
  },
  completions: {
    some: { voidedAt: null, supplementObligationId: null },
    none: { voidedAt: null, coverageStatus: { not: 'COVERED' } },
  },
});

/**
 * Recover only the old "fulfilled supplement / fully covered ordinary steps /
 * stale current status" signature. No report, material movement or quantity is
 * fabricated. The shared closure also retains branch and finished-good gates.
 * A cursor prevents one inconsistent historical row from starving later rows.
 */
export async function recoverStaleSupplementRouteCompletions(options: {
  routeId?: string;
  afterId?: string | null;
  limit?: number;
} = {}) {
  const candidates = await prisma.workOrderProcessRoute.findMany({
    where: {
      ...candidateWhere(),
      ...(options.routeId ? { id: options.routeId } : options.afterId ? { id: { gt: options.afterId } } : {}),
    },
    select: { id: true, version: true },
    orderBy: { id: 'asc' },
    take: Math.min(10, Math.max(1, Math.trunc(options.limit || 3))),
  });
  const result = {
    scanned: 0, repairedRouteIds: [] as string[], skipped: 0,
    failures: [] as { routeId: string; code: string }[],
    nextCursor: null as string | null,
  };
  const deadline = Date.now() + 6_000;
  for (const candidate of candidates) {
    if (Date.now() >= deadline) break;
    result.scanned += 1;
    result.nextCursor = candidate.id;
    try {
      const repaired = await prisma.$transaction(async tx => {
        const route = await tx.workOrderProcessRoute.findFirst({
          where: { ...candidateWhere(), id: candidate.id, version: candidate.version },
          include: {
            steps: { where: { retiredAt: null }, include: { supplementObligation: true } },
          },
        });
        if (!route) return false;
        // Recheck obligation quantities, not just the display label. System
        // coverage and FUTURE_ONLY retain their explicit existing semantics.
        for (const step of route.steps) {
          if (step.executionMode !== 'SUPPLEMENTAL_OBLIGATION') continue;
          const obligation = step.supplementObligation;
          if (!obligation) return false;
          if ([step.inputQty, step.processedQty, step.goodOutputQty,
            step.defectOutputQty, step.releasedGoodQty].some(value => value !== 0)) return false;
          if (obligation.status === 'CANCELLED' && step.status === 'skipped') continue;
          const required = processSupplementActualRequiredQty(obligation);
          if (obligation.status !== 'FULFILLED' || obligation.reportedQty < required) return false;
          if (obligation.reportQuantityBasis === 'action'
            && obligation.reportedGoodUnitQty < required * obligation.unitsPerProduct) return false;
        }
        const reconciliation = await reconcileSupplementRouteCompletion(tx, {
          routeId: route.id, expectedRouteVersion: route.version,
          userId: null, actor: '系统补充工序状态校正', now: new Date(),
        });
        const dailyTaskSync = await syncDailyTasksAfterProcessRouteChange(tx, {
          routeId: route.id, changeId: `supplement-closure:${route.id}:${route.version}`,
          actorId: null, reason: '补充工序已履行，校正历史工序闭环状态；不重复报工',
        });
        const detail = {
          previousRouteVersion: route.version,
          previousStepStatuses: route.steps.map(step => ({ id: step.id, status: step.status })),
          ...reconciliation, dailyTaskSync,
          completedQtyDelta: 0, quantityMovementCount: 0, completionCount: 0,
        };
        await tx.processRouteActivity.create({
          data: {
            routeId: route.id, action: 'recover_supplement_route_completion',
            content: '校正补充工序完成后遗留的工序状态；未重复报工、未增加成品数量',
            detail,
          },
        });
        await tx.operationLog.create({
          data: {
            action: 'recover_supplement_route_completion',
            targetType: 'WorkOrderProcessRoute', targetId: route.id, detail,
          },
        });
        return true;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 1_000, timeout: 5_000 });
      if (repaired) result.repairedRouteIds.push(candidate.id);
      else result.skipped += 1;
    } catch (error) {
      // Conflicts roll back all projections and are retried on a later pass.
      const code = error && typeof error === 'object' && 'code' in error
        ? String(error.code) : 'SUPPLEMENT_COMPLETION_RECOVERY_FAILED';
      result.failures.push({ routeId: candidate.id, code });
    }
  }
  return result;
}
