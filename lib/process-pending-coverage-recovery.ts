import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { reconcileSupplementRouteCompletion } from '@/lib/process-completion-service';
import { syncDailyTasksAfterProcessRouteChange } from '@/lib/process-route-change-daily-task-sync';
import { createSystemNotification, eligibleUserIdsForCapability } from '@/lib/system-notifications';

const candidateWhere = (): Prisma.WorkOrderProcessRouteWhereInput => ({
  status: 'in_progress',
  workOrder: { deletedAt: null, planClearedAt: null, productionPausedAt: null, branchType: null, status: { notIn: ['cancelled'] }, planType: { in: ['weekly_plan', 'managed_plan'] } },
  OR: [
    { steps: { some: { retiredAt: null, executionMode: 'NORMAL',
      completions: { some: { voidedAt: null, coverageStatus: { in: ['PENDING', 'PARTIAL'] }, defectQty: 0 } } } } },
    { workOrder: { OR: [{ stage: 'completed' }, { completedAt: { not: null } }] } },
  ],
  steps: { none: { retiredAt: null, executionMode: 'NORMAL', reportQuantityBasis: 'action' } },
  completions: { none: { voidedAt: null, coverageStatus: { in: ['PENDING', 'PARTIAL'] }, defectQty: { gt: 0 } } },
});

/** Replays existing good-output reports when material input is available, or
 * reconciles an operation demonstrably bypassed by an existing full transfer.
 * Serializable transactions and quantity/version guards make repeated workers
 * harmless. Defect disposition, action counts and branches stay out of this
 * unattended recovery path. No completion or per-unit labor is re-created. */
export async function recoverStalePendingCompletionCoverage(options: { routeId?: string; afterId?: string | null; limit?: number } = {}) {
  const candidates = await prisma.workOrderProcessRoute.findMany({
    where: { ...candidateWhere(), ...(options.routeId ? { id: options.routeId } : options.afterId ? { id: { gt: options.afterId } } : {}) },
    select: { id: true, version: true }, orderBy: { id: 'asc' }, take: Math.min(10, Math.max(1, options.limit || 3)),
  });
  const result = { scanned: 0, repairedRouteIds: [] as string[], skipped: 0, failures: [] as { routeId: string; code: string }[], nextCursor: null as string | null };
  const deadline = Date.now() + 6000;
  for (const candidate of candidates) {
    if (Date.now() >= deadline) break;
    result.scanned++; result.nextCursor = candidate.id;
    try {
      const repaired = await prisma.$transaction(async tx => {
        const route = await tx.workOrderProcessRoute.findFirst({ where: { ...candidateWhere(), id: candidate.id, version: candidate.version }, select: { id: true, version: true, workOrderId: true } });
        if (!route) return false;
        const orderBefore = await tx.workOrder.findUniqueOrThrow({ where: { id: route.workOrderId }, select: { stage: true, completedAt: true } });
        const before = await tx.processCompletion.aggregate({ where: { routeId: route.id, voidedAt: null }, _sum: { coveredQty: true } });
        const movementCount = await tx.processQuantityMovement.count({ where: { workOrderId: route.workOrderId } });
        const reconciliation = await reconcileSupplementRouteCompletion(tx, { routeId: route.id, expectedRouteVersion: route.version, userId: null, actor: '系统已有报工核销恢复', now: new Date() });
        const after = await tx.processCompletion.aggregate({ where: { routeId: route.id, voidedAt: null }, _sum: { coveredQty: true } });
        const coveredQuantityDelta = (after._sum.coveredQty || 0) - (before._sum.coveredQty || 0);
        const orderAfter = await tx.workOrder.findUniqueOrThrow({ where: { id: route.workOrderId }, select: { stage: true, completedAt: true, businessCode: true, code: true, specification: true } });
        const lifecycleChanged = orderBefore.stage !== orderAfter.stage || orderBefore.completedAt?.getTime() !== orderAfter.completedAt?.getTime();
        if (coveredQuantityDelta <= 0 && !reconciliation.materialReconciliation.convertedStepIds.length
          && !reconciliation.changedStepIds.length && !lifecycleChanged) throw new Error('NO_COVERAGE_PROGRESS');
        const taskSync = await syncDailyTasksAfterProcessRouteChange(tx, { routeId: route.id, changeId: `pending-coverage:${route.id}:${route.version}`, actorId: null, reason: '上游数量已到位，核销既有报工并同步工序完成状态' });
        const detail = { previousRouteVersion: route.version, ...reconciliation, coveredQuantityDelta,
          completedQtyDelta: reconciliation.coverage?.finishedGoodDelta || 0,
          quantityMovementCount: await tx.processQuantityMovement.count({ where: { workOrderId: route.workOrderId } }) - movementCount,
          completionCount: 0, lifecycleChanged, taskSync };
        await tx.processRouteActivity.create({ data: { routeId: route.id, action: 'recover_pending_completion_coverage', content: '核销已存在的报工并同步完成状态；保留原报工与已记工时', detail } });
        await tx.operationLog.create({ data: { action: 'recover_pending_completion_coverage', targetType: 'WorkOrderProcessRoute', targetId: route.id, detail } });
        if (reconciliation.materialReconciliation.convertedStepIds.length || lifecycleChanged) {
          const recipientUserIds = await eligibleUserIdsForCapability(tx, 'PROCESS', 'UPDATE');
          await createSystemNotification(tx, {
            eventType: 'PROCESS_ROUTE_COVERAGE_RECOVERED', dedupeKey: `route-coverage:${route.id}:${route.version}`,
            category: 'SYSTEM', title: `${orderAfter.specification || orderAfter.businessCode || orderAfter.code} 核销与状态已恢复`,
            body: reconciliation.routeCompleted ? '已有报工已完成核销，整单已按全部有效工序确认完成。'
              : `已恢复原有报工核销，工单保持生产中。${reconciliation.materialReconciliation.outstandingQuantity > 0 ? `仍有 ${reconciliation.materialReconciliation.outstandingQuantity} 套工序工作量需按实际作业报工。` : '请继续完成剩余工序。'}原报工和员工工时未重复生成。`,
            sourceType: 'WorkOrderProcessRoute', sourceId: route.id, targetRoute: `/workspace/workflows?workOrderId=${route.workOrderId}`,
            recipientUserIds, metadata: detail,
          });
        }
        return true;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 1000, timeout: 5000 });
      if (repaired) result.repairedRouteIds.push(candidate.id); else result.skipped++;
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : error instanceof Error ? error.message : 'COVERAGE_RECOVERY_FAILED';
      if (code === 'NO_COVERAGE_PROGRESS' || code === 'PROCESS_COVERAGE_RECOVERY_BRANCH') result.skipped++;
      else result.failures.push({ routeId: candidate.id, code });
    }
  }
  return result;
}
