import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { chinaDateKey } from '@/lib/china-date';
import { productionBatchWeekStartWindow, productionWeekDateBounds } from '@/lib/production-week';
import { assertProductionScopeRead, productionTeamScopeWhere, type ProductionEntityScope } from '@/lib/production-access-scope';
import { calculateTaskStandardMilliseconds } from '@/lib/daily-plan-domain';
import { originalPlanTime, summarizeTimeComparison, type TaskTimeComparison } from '@/lib/production-time-comparison';
import { reportedWorkloadMilliseconds, workloadStep, workloadTotals, workloadPeople, workloadCoverage,
  type ProductionWorkloadReport, type WorkloadTask } from '@/lib/production-workload';

const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const stepKey = (order: string, step: string) => `${order}:${step}`;
type Facts = { before: number; current: number; pending: number };
const zero = (): Facts => ({ before: 0, current: 0, pending: 0 });

/** Read one database snapshot so a pending submission becoming a completion cannot disappear or count twice. */
export async function loadProductionWorkload(weekInput: string, scope: ProductionEntityScope, now = new Date()): Promise<ProductionWorkloadReport> {
  assertProductionScopeRead(scope);
  const week = productionWeekDateBounds(weekInput);
  const window = productionBatchWeekStartWindow(weekInput);
  const tomorrow = new Date(`${chinaDateKey(now)}T00:00:00Z`); tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const factEnd = new Date(Math.min(week.endExclusiveDate.getTime(), tomorrow.getTime()));
  const teamWhere = productionTeamScopeWhere(scope) as Prisma.ProductionTeamWhereInput | null;
  return prisma.$transaction(async db => {
    const batches = await db.productionPlanBatch.findMany({
      where: { deletedAt: null, planOrder: { deletedAt: null }, releaseState: { not: 'cancelled' },
        ...(teamWhere ? { dailyProcessTasks: { some: { status: { not: 'CANCELLED' }, plan: { team: teamWhere } } } } : {}),
        OR: [{ weekStartDate: { gte: window.gte, lt: window.lt } },
          { carryovers: { some: { targetWeekStartDate: { gte: window.gte, lt: window.lt }, status: { not: 'DISMISSED' } } } }] },
      select: { id: true, batchNo: true, quantity: true, weekStartDate: true, workOrderId: true,
        totalMillisecondsSnapshot: true, unitMillisecondsSnapshot: true, importedUnitMilliseconds: true,
        planOrder: { select: { customerName: true, specification: true, planningUnitMilliseconds: true,
          drawingLibraryItem: { select: { deletedAt: true, productTimeProfiles: {
            where: { status: 'published' }, orderBy: { version: 'desc' }, take: 1,
            select: { entries: { select: { unitMilliseconds: true } } } } } } } },
        workOrder: { select: { id: true, code: true, specification: true, customerName: true, deletedAt: true,
          processRoute: { select: { version: true, steps: { orderBy: { position: 'asc' },
            select: { id: true, processName: true, position: true, retiredAt: true, status: true, timeBasis: true,
              standardMillisecondsPerUnit: true, setupMilliseconds: true, unitsPerProduct: true } } } } } } },
    });
    const allocations = await db.wipWeekAllocation.findMany({
      where: { lot: { scheduleStatus: { not: 'CANCELLED' }, workOrder: { deletedAt: null },
        productionPlanBatch: { deletedAt: null, planOrder: { deletedAt: null } } },
        OR: [{ targetWeekStartDate: week.startDate, ...(teamWhere ? { team: { is: teamWhere } } : {}) },
          { lot: { productionPlanBatchId: { in: batches.map(b => b.id) } } }] },
      select: { id: true, targetWeekStartDate: true, status: true, team: { select: { id: true, code: true, name: true, legacyTeamName: true } },
        lot: { select: { id: true, workOrderId: true, routeVersion: true, sourceWeekStartDate: true,
          productionPlanBatch: { select: { weekStartDate: true } },
          workOrder: { select: { code: true, specification: true, customerName: true } } } },
        steps: { select: { id: true, plannedStandardMilliseconds: true, completedStandardMilliseconds: true,
          lotStep: { select: { stepId: true, processName: true, position: true } } } } },
    });
    const orderIds = [...new Set([...batches.flatMap(b => b.workOrderId ? [b.workOrderId] : []), ...allocations.map(a => a.lot.workOrderId)])];
    const completions = orderIds.length ? await db.processCompletion.findMany({
      where: { workOrderId: { in: orderIds }, workDate: { lt: factEnd }, voidedAt: null },
      select: { id: true, workOrderId: true, stepId: true, workDate: true, processedQty: true, coveredQty: true,
        reportedUnitQty: true, reportQuantityBasis: true, reportingWipAllocationId: true,
        timeBasis: true, standardMillisecondsPerUnit: true, setupMilliseconds: true, unitsPerProduct: true,
        workOrder: { select: { productionTargetQty: true } },
        wipCredits: { where: { status: 'ACTIVE' }, select: { quantity: true, allocationStep: { select: { allocationId: true } } } } },
    }) : [];
    const submissions = orderIds.length ? await db.processReportSubmission.findMany({
      where: { workOrderId: { in: orderIds }, workDate: { lt: factEnd }, status: 'PENDING', completionId: null },
      select: { id: true, workOrderId: true, stepId: true, workDate: true, snapshot: true, payload: true, sourceAllocationId: true,
        workOrder: { select: { productionTargetQty: true } } },
    }) : [];
    const sourceLots = batches.length ? await db.semiFinishedLot.findMany({
      where: { productionPlanBatchId: { in: batches.map(b => b.id) }, scheduleStatus: { not: 'CANCELLED' },
        enteredAt: { lt: new Date(`${week.endKey}T23:59:59.999+08:00`) } },
      select: { id: true, workOrderId: true, steps: { where: { status: { not: 'CANCELLED' } },
        select: { stepId: true, remainingStandardMilliseconds: true } } },
    }) : [];
    const employees = await db.employee.findMany({
      select: { id: true, employeeNo: true, name: true, department: true, team: true, position: true,
        attainmentStream: true, isActive: true, hireDate: true, resignedAt: true,
        attainmentPolicyChanges: { select: { effectiveDate: true, revision: true, beforePolicy: true, afterPolicy: true } } },
      orderBy: { employeeNo: 'asc' },
    });
    const allowedTeamRecords = teamWhere ? await db.productionTeam.findMany({ where: teamWhere,
      select: { id: true, code: true, name: true, legacyTeamName: true } }) : null;
    const allowedTeams = allowedTeamRecords ? new Set(allowedTeamRecords.flatMap(t => [t.id, t.code, t.name, t.legacyTeamName || '']).filter(Boolean).map(s => s.toLocaleLowerCase('zh-CN'))) : undefined;
    const fullFacts = new Map<string, Facts>(), wipFacts = new Map<string, Facts>(), allocationFacts = new Map<string, Facts>();
    const lotBefore = new Map<string, number>();
    const allocationById = new Map(allocations.map(a => [a.id, a]));
    function add(map: Map<string, Facts>, key: string, ms: number, date: Date, pending: number) {
      const value = map.get(key) || zero();
      if (date < week.startDate) value.before += ms;
      else { value.current += ms; value.pending += pending; }
      map.set(key, value);
    }
    function record(orderId: string, stepId: string, date: Date, milliseconds: number, pending: number, shares: Array<{ id: string; ratio: number }>) {
      const key = stepKey(orderId, stepId);
      add(fullFacts, key, milliseconds, date, pending);
      let distributed = 0, distributedPending = 0;
      for (const share of shares) {
        const amount = Math.min(milliseconds - distributed, Math.round(milliseconds * share.ratio));
        const pendingAmount = Math.min(pending - distributedPending, Math.round(pending * share.ratio));
        distributed += amount; distributedPending += pendingAmount;
        add(wipFacts, key, amount, date, pendingAmount);
        add(allocationFacts, stepKey(share.id, stepId), amount, date, pendingAmount);
        const allocation = allocationById.get(share.id);
        if (allocation && date < week.startDate) {
          const lotKey = stepKey(allocation.lot.id, stepId);
          lotBefore.set(lotKey, (lotBefore.get(lotKey) || 0) + amount);
        }
      }
    }
    for (const completion of completions) {
      const action = completion.reportQuantityBasis === 'action';
      const target = completion.workOrder.productionTargetQty || 0;
      const ms = reportedWorkloadMilliseconds({ ...completion, unitsPerProduct: action ? 1 : completion.unitsPerProduct },
        action ? completion.reportedUnitQty : completion.processedQty,
        action ? target * Math.max(1, completion.unitsPerProduct) : target);
      const pending = completion.processedQty > 0 ? Math.round(ms * Math.max(0, completion.processedQty - completion.coveredQty) / completion.processedQty) : ms;
      const shares = completion.reportingWipAllocationId ? [{ id: completion.reportingWipAllocationId, ratio: 1 }]
        : completion.wipCredits.map(c => ({ id: c.allocationStep.allocationId, ratio: completion.processedQty > 0 ? c.quantity / completion.processedQty : 0 }));
      record(completion.workOrderId, completion.stepId, completion.workDate, ms, pending, shares);
    }
    for (const submission of submissions) {
      const snapshot = object(submission.snapshot), payload = object(submission.payload);
      const action = snapshot.reportQuantityBasis === 'action';
      const quantity = Number(action ? payload.reportedUnitQty || 0 : payload.processedQty || 0);
      const target = Number(snapshot.targetQuantity || submission.workOrder.productionTargetQty || 0);
      const ms = reportedWorkloadMilliseconds({ ...snapshot, unitsPerProduct: action ? 1 : snapshot.unitsPerProduct }, quantity, target);
      record(submission.workOrderId, submission.stepId, submission.workDate, ms, ms,
        submission.sourceAllocationId ? [{ id: submission.sourceAllocationId, ratio: 1 }] : []);
    }
    const movedByStep = new Map<string, number>();
    for (const lot of sourceLots) for (const step of lot.steps) {
      const key = stepKey(lot.workOrderId, step.stepId);
      const outstanding = Math.max(0, Number(step.remainingStandardMilliseconds) - (lotBefore.get(stepKey(lot.id, step.stepId)) || 0));
      movedByStep.set(key, (movedByStep.get(key) || 0) + outstanding);
    }
    const tasks: WorkloadTask[] = [];
    for (const batch of batches) {
      if (batch.workOrder?.deletedAt) continue;
      const order = batch.workOrder;
      const task: WorkloadTask = { id: batch.id, workOrderId: batch.workOrderId, code: order?.code || `待下发 · 批次${batch.batchNo}`,
        specification: order?.specification || batch.planOrder.specification || '未填写规格', customer: batch.planOrder.customerName,
        sourceWeek: chinaDateKey(batch.weekStartDate), kind: chinaDateKey(batch.weekStartDate) === week.startKey ? 'plan' : 'carryover',
        routeVersion: order?.processRoute?.version ?? null, steps: [] };
      const drawing = batch.planOrder.drawingLibraryItem;
      const publishedUnit = drawing && !drawing.deletedAt ? drawing.productTimeProfiles[0]?.entries.reduce((n, e) => n + e.unitMilliseconds, 0) : null;
      const originalPlan = originalPlanTime({ quantity: batch.quantity, batchUnit: batch.unitMillisecondsSnapshot,
        orderUnit: batch.planOrder.planningUnitMilliseconds, publishedUnit, totalSnapshot: batch.totalMillisecondsSnapshot });
      const comparison: TaskTimeComparison = { originalPlan: originalPlan.milliseconds, originalSource: originalPlan.source,
        currentStandard: 0, missingSteps: 0, priorDeducted: 0, adjustedReported: 0, estimate: 0, movedOut: 0, executionBasis: 0 };
      let activeStepCount = 0;
      for (const step of order?.processRoute?.steps || []) {
        const key = stepKey(order!.id, step.id), facts = fullFacts.get(key) || zero(), wip = wipFacts.get(key) || zero();
        const retired = step.retiredAt !== null || step.status === 'skipped';
        if (retired && !facts.current) continue;
        const valid = (step.timeBasis === 'per_unit' || step.timeBasis === 'per_batch') && (step.standardMillisecondsPerUnit || 0) > 0;
        const original = retired ? facts.before + facts.current : valid ? Number(calculateTaskStandardMilliseconds({
          timeBasis: step.timeBasis as 'per_unit' | 'per_batch', standardMillisecondsPerUnit: step.standardMillisecondsPerUnit!,
          setupMilliseconds: step.setupMilliseconds, unitsPerProduct: Math.max(1, step.unitsPerProduct),
        }, batch.quantity)) : 0;
        if (!retired) {
          activeStepCount += 1;
          comparison.currentStandard += original;
          comparison.priorDeducted += Math.min(original, Math.max(0, facts.before));
          if (!valid) comparison.missingSteps += 1;
        } else comparison.adjustedReported += facts.current;
        task.steps.push(workloadStep({ id: step.id, name: `${step.processName}${retired ? '（已调整）' : ''}`, position: step.position,
          original, before: facts.before, movedOut: movedByStep.get(key) || 0,
          reported: Math.max(0, facts.current - wip.current), pending: Math.max(0, facts.pending - wip.pending), missingStandard: !valid }));
      }
      if (!task.steps.length) { task.steps.push(workloadStep({ id: `${batch.id}:unbound`, name: '计划工时（待补工序）', position: 0,
        original: Number(batch.totalMillisecondsSnapshot || 0n) || (batch.unitMillisecondsSnapshot || batch.importedUnitMilliseconds || 0) * batch.quantity,
        reported: 0, missingStandard: true })); comparison.estimate = task.steps[0].planned; }
      if (!activeStepCount) comparison.missingSteps = Math.max(1, comparison.missingSteps);
      comparison.movedOut = task.steps.reduce((n, s) => n + s.movedOut, 0);
      comparison.executionBasis = task.steps.reduce((n, s) => n + s.planned, 0);
      task.timeComparison = comparison;
      tasks.push(task);
    }
    for (const allocation of allocations) {
      if (allocation.status === 'CANCELLED' || allocation.targetWeekStartDate.toISOString().slice(0, 10) !== week.startKey) continue;
      if (allowedTeams && ![allocation.team?.id, allocation.team?.code, allocation.team?.name, allocation.team?.legacyTeamName]
        .some(v => v && allowedTeams.has(v.toLocaleLowerCase('zh-CN')))) continue;
      tasks.push({ id: allocation.id, workOrderId: allocation.lot.workOrderId, code: allocation.lot.workOrder.code,
        specification: allocation.lot.workOrder.specification || '未填写规格', customer: allocation.lot.workOrder.customerName || '',
        kind: 'wip', sourceWeek: chinaDateKey(allocation.lot.productionPlanBatch.weekStartDate), routeVersion: allocation.lot.routeVersion,
        steps: allocation.steps.map(step => {
          const facts = allocationFacts.get(stepKey(allocation.id, step.lotStep.stepId)) || zero();
          const original = Number(step.plannedStandardMilliseconds);
          return workloadStep({ id: step.id, name: step.lotStep.processName, position: step.lotStep.position,
            original, before: facts.before, reported: facts.current, pending: facts.pending,
            movedOut: allocation.status === 'SUPERSEDED' ? Math.max(0, original - facts.before - facts.current) : 0,
            missingStandard: original <= 0 });
        }).sort((a, b) => a.position - b.position) });
    }
    const plan = workloadTotals(tasks.filter(t => t.kind !== 'carryover'));
    const carryover = workloadTotals(tasks.filter(t => t.kind === 'carryover'));
    const all = workloadTotals(tasks);
    const timeComparison = summarizeTimeComparison(tasks.filter(t => t.kind === 'plan').map(t => t.timeComparison!),
      workloadTotals(tasks.filter(t => t.kind === 'wip')).planned);
    const people = workloadPeople(employees, week.startKey, now, allowedTeams);
    const planned = people.reduce((s, p) => s + p.planned, 0), remaining = people.reduce((s, p) => s + p.remaining, 0);
    return { weekStart: week.startKey, weekEnd: week.endKey, calculatedAt: now.toISOString(), tasks, plan, carryover, all, people, timeComparison,
      capacity: { count: people.filter(p => p.included).length, excludedCount: people.filter(p => !p.included).length,
        planned, remaining, planCoverage: workloadCoverage(planned, plan.planned, plan.missingStandard > 0),
        outstandingCoverage: workloadCoverage(planned, all.remaining, all.missingStandard > 0),
        remainingCoverage: workloadCoverage(remaining, all.remaining, all.missingStandard > 0),
        gap: Math.max(0, all.remaining - remaining), surplus: Math.max(0, remaining - all.remaining) } };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30_000 });
}
