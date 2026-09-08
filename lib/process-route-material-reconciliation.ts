import { Prisma } from '@prisma/client';
import { getProductionQuantitySummary } from '@/lib/production-quantity';

/** Durable provenance for an existing operation whose material already passed
 * its edited position. This is actual-report coverage, never system credit. */
export const EXISTING_ROUTE_REPORT_POLICY = 'EXISTING_ROUTE_ACTUAL_REPORTS';

export async function reconcileBypassedRouteOperations(
  tx: Prisma.TransactionClient,
  input: { routeId: string; actorId: string | null; now: Date },
) {
  const route = await tx.workOrderProcessRoute.findUniqueOrThrow({
    where: { id: input.routeId },
    include: {
      workOrder: true,
      steps: { where: { retiredAt: null }, orderBy: [{ sequenceGroup: 'asc' }, { position: 'asc' }] },
      activities: { where: { action: 'product_time_deleted_step_quantity_bypassed' }, select: { id: true, detail: true } },
    },
  });
  const result = { convertedStepIds: [] as string[], coveredQuantity: 0, outstandingQuantity: 0 };
  const order = route.workOrder;
  const target = getProductionQuantitySummary(order).targetQty || 0;
  if (route.status !== 'in_progress' || target <= 0 || order.deletedAt || order.planClearedAt
    || order.productionPausedAt || order.branchType || order.status === 'cancelled') return result;
  const ordinary = route.steps.filter(step => step.executionMode === 'NORMAL');
  const candidates = ordinary.filter(step => step.processDefinitionId && step.reportQuantityBasis !== 'action'
    && step.inputQty < target && step.inputQty === step.processedQty
    && step.processedQty === step.goodOutputQty && step.goodOutputQty === step.releasedGoodQty
    && step.defectOutputQty === 0);
  if (!candidates.length) return result;
  // Never infer whole-product identity across rework, scrap or split branches.
  if (await tx.workOrder.count({ where: { parentWorkOrderId: order.id, deletedAt: null,
    OR: [{ branchStatus: null }, { branchStatus: { not: 'CANCELLED' } }],
  } })
    || await tx.semiFinishedLot.count({ where: { workOrderId: order.id } })
    || await tx.processCompletion.count({ where: { routeId: route.id, voidedAt: null, defectQty: { gt: 0 } } })) return result;
  const movements = await tx.processQuantityMovement.findMany({
    where: { workOrderId: order.id, voidedAt: null, type: { not: 'REVERSAL' } },
    include: { reversals: { where: { voidedAt: null }, select: { quantity: true } } },
  });
  if (movements.some(movement => !['GOOD_TRANSFER', 'FINISHED_GOOD'].includes(movement.type)
    || movement.reversals.reduce((sum, reversal) => sum + reversal.quantity, 0) > movement.quantity)) return result;
  const byId = new Map(ordinary.map(step => [step.id, step]));
  const effectiveQuantity = (movement: typeof movements[number]) => movement.quantity
    - movement.reversals.reduce((total, reversal) => total + reversal.quantity, 0);
  const finishedMovements = movements.filter(movement => movement.type === 'FINISHED_GOOD');
  const finishedQuantity = finishedMovements.reduce((total, movement) => total + effectiveQuantity(movement), 0);
  const fullFinishedEvidence = finishedQuantity === target && Number(order.completedQty) === target;
  for (const step of candidates) {
    if (await tx.processReportSubmission.count({ where: { stepId: step.id, status: 'PENDING' } })
      || await tx.processCompletionWithdrawalRequest.count({ where: { completion: { stepId: step.id }, status: { in: ['PENDING', 'BLOCKED'] } } })) continue;
    // A full, unreversed transfer must cross the hole in the *current* route.
    // Zero input by itself is not evidence: normal upstream waiting stays put.
    const crossing = movements.filter(movement => {
      const source = byId.get(movement.sourceStepId);
      const destination = movement.targetStepId ? byId.get(movement.targetStepId) : null;
      return source && destination && source.sequenceGroup < step.sequenceGroup
        && destination.sequenceGroup > step.sequenceGroup
        && source.releasedGoodQty >= target && destination.inputQty >= target;
    });
    const channels = new Map<string, number>();
    for (const movement of crossing) {
      const key = `${movement.sourceStepId}:${movement.targetStepId}`;
      channels.set(key, (channels.get(key) || 0) + movement.quantity
        - movement.reversals.reduce((total, reversal) => total + reversal.quantity, 0));
    }
    if (!fullFinishedEvidence && ![...channels.values()].some(quantity => quantity === target)) continue;
    const partialMaterial = step.processedQty > 0;
    const attached = movements.filter(movement => effectiveQuantity(movement) > 0
      && (movement.sourceStepId === step.id || movement.targetStepId === step.id));
    if (!partialMaterial && attached.length) continue;
    if (partialMaterial) {
      // A partly consumed historic stream requires both full finished-product
      // provenance and an audited route bypass. Do not infer identity across
      // an ordinary shortage, WIP, defects, action units or branches.
      if (!fullFinishedEvidence || !route.activities.length) continue;
      const incoming = attached.filter(movement => movement.targetStepId === step.id)
        .reduce((sum, movement) => sum + effectiveQuantity(movement), 0);
      const channels = new Map<string, number>();
      for (const movement of attached.filter(movement => movement.sourceStepId === step.id)) {
        const key = movement.targetStepId || 'finished';
        channels.set(key, (channels.get(key) || 0) + effectiveQuantity(movement));
      }
      if (incoming !== step.inputQty || !channels.size
        || [...channels.values()].some(quantity => quantity !== step.releasedGoodQty)) continue;
    }
    const reports = await tx.processCompletion.findMany({
      where: { stepId: step.id, voidedAt: null }, orderBy: [{ completedAt: 'asc' }, { id: 'asc' }],
      include: { coverageAllocations: { where: { voidedAt: null }, select: { quantity: true, goodQty: true, defectQty: true } } },
    });
    if (reports.some(report => report.supplementObligationId || report.coveredQty < 0
      || report.coveredQty > report.processedQty || report.coveredGoodQty !== report.coveredQty
      || report.coveredDefectQty !== 0 || report.defectQty !== 0 || report.goodQty !== report.processedQty
      || report.reportQuantityBasis === 'action'
      || report.coverageAllocations.some(coverage => coverage.defectQty !== 0 || coverage.goodQty !== coverage.quantity)
      || report.coverageAllocations.reduce((sum, coverage) => sum + coverage.quantity, 0) !== report.coveredQty)) continue;
    const previouslyCoveredQty = reports.reduce((sum, report) => sum + report.coveredQty, 0);
    if (previouslyCoveredQty !== step.processedQty) continue;
    const reportedQty = reports.reduce((total, report) => total + report.processedQty, 0);
    if (reportedQty > target) continue;
    const fulfilled = reportedQty === target;
    const obligation = await tx.processSupplementObligation.create({ data: {
      reconciliationKey: `existing-route:${step.id}`,
      workOrderId: order.id, routeId: route.id, displayStepId: step.id,
      processDefinitionId: step.processDefinitionId!, source: 'EXISTING',
      processCode: step.processCode, processName: step.processName, stageGroup: step.stageGroup,
      displayPosition: step.position, intendedSequenceGroup: step.sequenceGroup,
      requiredQty: target, systemCoveredQty: 0, reportedQty,
      reportedUnitQty: reports.reduce((total, report) => total + report.reportedUnitQty, 0),
      reportedGoodUnitQty: reports.reduce((total, report) => total + report.reportedGoodUnitQty, 0),
      reportedDefectUnitQty: reports.reduce((total, report) => total + report.reportedDefectUnitQty, 0),
      reportQuantityBasis: step.reportQuantityBasis, reportUnitLabel: step.reportUnitLabel,
      fulfillmentMode: 'ACTUAL', status: fulfilled ? 'FULFILLED' : 'ACTIVE',
      releasePolicy: 'NONE', isCritical: step.isCritical,
      timeBasis: step.timeBasis || 'per_unit', unitLabel: step.unitLabel || '件',
      standardMillisecondsPerUnit: step.standardMillisecondsPerUnit || 0,
      setupMilliseconds: step.setupMilliseconds, unitsPerProduct: step.unitsPerProduct,
      countsForEfficiency: step.countsForEfficiency,
      lastReportedAt: reports.at(-1)?.completedAt, fulfilledAt: fulfilled ? reports.at(-1)?.completedAt : null,
    } });
    const evidence = {
      previousRouteVersion: route.version, previousStepStatus: step.status,
      targetQuantity: target, crossingMovementIds: crossing.map(movement => movement.id),
      finishedMovementIds: fullFinishedEvidence ? finishedMovements.map(movement => movement.id) : [],
      bypassActivityIds: route.activities.map(activity => activity.id),
      retainedMaterial: { inputQty: step.inputQty, processedQty: step.processedQty, releasedGoodQty: step.releasedGoodQty,
        movementIds: attached.map(movement => movement.id) },
      reports: reports.map(report => ({ id: report.id, processedQty: report.processedQty,
        previousCoveredQty: report.coveredQty, previousCoverageStatus: report.coverageStatus })),
      coveredQuantity: reportedQty - previouslyCoveredQty, outstandingQuantity: target - reportedQty,
      completionCount: 0, quantityMovementCount: 0, completedQtyDelta: 0, laborPoolCount: 0,
    };
    await tx.processSupplementCoverage.create({ data: {
      obligationId: obligation.id, workOrderId: order.id, routeId: route.id, displayStepId: step.id,
      policy: EXISTING_ROUTE_REPORT_POLICY, fulfillmentMode: 'ACTUAL', routeTargetQty: target,
      systemCoveredQty: 0, actualRequiredQty: target, evidence, actorId: input.actorId,
    } });
    for (const report of reports) {
      await tx.processCompletion.update({ where: { id: report.id }, data: {
        supplementObligationId: obligation.id, coveredQty: report.processedQty,
        coveredGoodQty: report.goodQty, coveredDefectQty: 0, coverageUpdatedAt: input.now, coverageStatus: 'COVERED',
      } });
      if (report.processedQty > report.coveredQty) await tx.processCompletionCoverage.create({ data: {
        reportCompletionId: report.id, triggerCompletionId: report.id,
        quantity: report.processedQty - report.coveredQty, goodQty: report.goodQty - report.coveredGoodQty, defectQty: 0,
        idempotencyKey: `route-actual-reconciliation:${report.id}`,
      } });
    }
    await tx.workOrderProcessStep.update({ where: { id: step.id }, data: {
      executionMode: 'SUPPLEMENTAL_OBLIGATION', status: fulfilled ? 'completed' : 'current',
      // The old material stream is immutable in movements and the retained
      // snapshot above. The active display now represents actual work only,
      // so it must not remain a second source of product-flow quantities.
      inputQty: 0, processedQty: 0, goodOutputQty: 0, defectOutputQty: 0, releasedGoodQty: 0,
      startedAt: step.startedAt || input.now, completedAt: fulfilled ? reports.at(-1)?.completedAt : null,
      completedById: fulfilled ? reports.at(-1)?.createdById : null, quantityVersion: { increment: 1 },
    } });
    await tx.processRouteActivity.create({ data: {
      routeId: route.id, stepId: step.id, action: 'reconcile_bypassed_operation', actorId: input.actorId,
      content: `${step.processName}已转为独立报工核销：原报工 ${reportedQty}，待实际报工 ${target - reportedQty}`,
      detail: { obligationId: obligation.id, ...evidence },
    } });
    result.convertedStepIds.push(step.id);
    result.coveredQuantity += reportedQty - previouslyCoveredQty;
    result.outstandingQuantity += target - reportedQty;
  }
  return result;
}
