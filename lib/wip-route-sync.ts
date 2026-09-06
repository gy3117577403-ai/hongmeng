import { Prisma } from '@prisma/client';
import { calculateTaskStandardMilliseconds } from '@/lib/daily-plan-domain';
import { materialSequenceGroup } from '@/lib/process-material-sequence';
import { recomputeAllocationAndLot, recomputeLotStep } from '@/lib/wip-reporting';
import { refreshWipLotStatus } from '@/lib/wip-warehouse';

/** Run inside the route publication transaction. Requirements are mutable;
 * reports and warehouse movements remain the audit trail. */
export async function syncWipRequirementsAfterRouteEdit(
  tx: Prisma.TransactionClient,
  input: { routeId: string; actorId: string; changeKey: string; reason: string },
) {
  const route = await tx.workOrderProcessRoute.findUniqueOrThrow({
    where: { id: input.routeId },
    include: { steps: { where: { retiredAt: null, status: { not: 'skipped' } }, include: { supplementObligation: true } } },
  });
  const lots = await tx.semiFinishedLot.findMany({
    where: { routeId: route.id, scheduleStatus: { notIn: ['CANCELLED', 'COMPLETED'] } },
    include: { steps: true, allocations: { include: { steps: true }, orderBy: [{ scheduledAt: 'asc' }, { id: 'asc' }] } },
    orderBy: [{ enteredAt: 'asc' }, { id: 'asc' }],
  });
  if (!lots.length) return { lots: 0, cancelled: 0, inserted: 0 };
  const activeIds = new Set(route.steps.map(step => step.id));
  const now = new Date();
  let cancelled = 0;
  let inserted = 0;
  for (const lot of lots) {
    const lotStepById = new Map(lot.steps.map(step => [step.stepId, step]));
    const completedIds = new Set(Array.isArray(lot.completedStepIds) ? lot.completedStepIds as string[] : []);
    for (const old of lot.steps) {
      if (activeIds.has(old.stepId) || old.status === 'CANCELLED') continue;
      // Match the existing product-time retirement rule: retain real reports,
      // void their efficiency attribution, and remove future requirements.
      await tx.processWipCredit.updateMany({
        where: { allocationStep: { lotStepId: old.id }, status: 'ACTIVE' },
        data: { status: 'VOIDED', voidedAt: now },
      });
      await tx.wipWeekAllocationStep.updateMany({ where: { lotStepId: old.id },
        data: { status: 'CANCELLED', completedQty: 0, completedStandardMilliseconds: 0n } });
      await tx.semiFinishedLotStep.update({ where: { id: old.id }, data: { status: 'CANCELLED' } });
      cancelled += 1;
    }
    for (const step of route.steps) {
      const old = lotStepById.get(step.id);
      if (!old && completedIds.has(step.id)) continue;
      const supplement = step.supplementObligation;
      if (!old && supplement && supplement.status !== 'ACTIVE') continue;
      if ((step.timeBasis !== 'per_unit' && step.timeBasis !== 'per_batch') || !step.standardMillisecondsPerUnit) {
        throw Object.assign(new Error(`工序“${step.processName}”缺少可用于半成品计划的标准工时`), { status: 409, code: 'WIP_STEP_STANDARD_MISSING' });
      }
      // Existing checkpoints must never be reconstructed from today's global
      // order totals. Newly inserted operations apply to this lot's full slice.
      const completedLotQuantity = lot.allocations.reduce((sum, allocation) => sum
        + (['COMPLETED', 'SUPERSEDED'].includes(allocation.status) ? allocation.completedQty : 0), 0);
      const remainingQty = old?.remainingQty ?? Math.min(Math.max(0, lot.quantity - completedLotQuantity),
        supplement ? Math.max(0, supplement.requiredQty - supplement.systemCoveredQty - supplement.reportedQty) : lot.quantity);
      if (remainingQty <= 0) continue;
      const snapshot = { timeBasis: step.timeBasis, standardMillisecondsPerUnit: step.standardMillisecondsPerUnit,
        setupMilliseconds: step.setupMilliseconds, unitsPerProduct: step.unitsPerProduct } as const;
      const before = old?.processedQtyAtEntry ?? (supplement?.reportedQty || 0);
      const standard = (qty: number) => step.countsForEfficiency
        ? calculateTaskStandardMilliseconds(snapshot, before + qty) - calculateTaskStandardMilliseconds(snapshot, before) : 0n;
      const metadata = { routeVersion: route.version, processCode: step.processCode, processName: step.processName,
        stageGroup: step.stageGroup, position: step.position, sequenceGroup: materialSequenceGroup(step),
        ...snapshot, countsForEfficiency: step.countsForEfficiency, remainingStandardMilliseconds: standard(remainingQty) };
      const lotStep = old
        ? await tx.semiFinishedLotStep.update({ where: { id: old.id }, data: metadata })
        : await tx.semiFinishedLotStep.create({ data: { lotId: lot.id, stepId: step.id, plannedQty: lot.quantity,
            remainingQty, processedQtyAtEntry: before, goodOutputQtyAtEntry: 0, ...metadata } });
      if (!old) inserted += 1;
      let coveredQuantity = 0;
      for (const allocation of lot.allocations) {
        if (allocation.status === 'CANCELLED') continue;
        const allocationStep = allocation.steps.find(item => item.lotStepId === lotStep.id);
        const effectiveQuantity = allocation.status === 'SUPERSEDED' ? allocation.completedQty : allocation.quantity;
        const previousCovered = coveredQuantity;
        coveredQuantity += effectiveQuantity;
        if (!allocationStep && ['SUPERSEDED', 'COMPLETED'].includes(allocation.status)) continue;
        const skipped = Math.max(0, lot.quantity - remainingQty);
        const start = Math.min(remainingQty, Math.max(0, previousCovered - skipped));
        const end = Math.min(remainingQty, Math.max(0, coveredQuantity - skipped));
        const plannedQty = allocationStep?.plannedQty ?? Math.max(0, end - start);
        if (plannedQty <= 0) continue;
        const plannedStandardMilliseconds = allocationStep
          ? standard(remainingQty) * BigInt(plannedQty) / BigInt(remainingQty)
          : standard(end) - standard(start);
        const target = allocationStep
          ? await tx.wipWeekAllocationStep.update({ where: { id: allocationStep.id }, data: { plannedStandardMilliseconds } })
          : await tx.wipWeekAllocationStep.create({ data: { allocationId: allocation.id, lotStepId: lotStep.id, plannedQty, plannedStandardMilliseconds } });
        // Reprice the existing WIP slice with the new plan, using cumulative
        // rounding so a fully reported slice exactly closes its millisecond sum.
        const credits = await tx.processWipCredit.findMany({ where: { allocationStepId: target.id, status: 'ACTIVE' }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
        let creditedQty = 0;
        let creditedMs = 0n;
        for (const credit of credits) {
          creditedQty += credit.quantity;
          const cumulative = plannedStandardMilliseconds * BigInt(Math.min(plannedQty, creditedQty)) / BigInt(plannedQty);
          await tx.processWipCredit.update({ where: { id: credit.id }, data: { standardMilliseconds: cumulative - creditedMs } });
          creditedMs = cumulative;
        }
        await tx.wipWeekAllocationStep.update({ where: { id: target.id }, data: {
          completedQty: creditedQty, completedStandardMilliseconds: creditedMs,
          status: creditedQty >= plannedQty ? 'COMPLETED' : creditedQty > 0 ? 'IN_PROGRESS' : 'SCHEDULED',
        } });
      }
      await recomputeLotStep(tx, lotStep.id);
    }
    const liveSteps = await tx.semiFinishedLotStep.findMany({ where: { lotId: lot.id, status: { notIn: ['CANCELLED', 'COMPLETED'] } }, orderBy: [{ sequenceGroup: 'asc' }, { position: 'asc' }] });
    await tx.semiFinishedLot.update({ where: { id: lot.id }, data: {
      routeVersion: route.version, nextStepIds: liveSteps.filter(step => step.sequenceGroup === liveSteps[0]?.sequenceGroup).map(step => step.stepId), version: { increment: 1 },
    } });
    for (const allocation of lot.allocations) await recomputeAllocationAndLot(tx, allocation.id, lot.id);
    await refreshWipLotStatus(tx, lot.id);
    await tx.wipEvent.create({ data: { lotId: lot.id, eventType: 'ROUTE_REQUIREMENTS_SYNCHRONIZED', reason: input.reason,
      actorId: input.actorId, idempotencyKey: `${input.changeKey}:wip:${lot.id}`,
      beforeData: { routeVersion: lot.routeVersion, stepIds: lot.steps.map(step => step.stepId) },
      afterData: { routeVersion: route.version, remainingStepIds: liveSteps.map(step => step.stepId), historicalReportsPreserved: true },
    } });
  }
  return { lots: lots.length, cancelled, inserted };
}
