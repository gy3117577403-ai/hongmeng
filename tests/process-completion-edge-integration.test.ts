import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { prisma } from '../lib/prisma';
import { auditProductionClosure } from '../lib/production-closure-audit';
import { loadProductionClosureAuditSnapshot } from '../lib/production-closure-audit-prisma';
import { completeProcessStep } from '../lib/process-completion-service';
import {
  softDeleteWorkOrderWithProductionGuard,
  WorkOrderDeletionServiceError,
} from '../lib/work-order-deletion-service';
import {
  adjustProductionQuantities,
  ProductionQuantityAdjustmentServiceError,
} from '../lib/production-quantity-adjustment-service';

const runDatabaseIntegration = process.env.RUN_DB_INTEGRATION === '1';
const workDate = '2026-07-23';

type StepPlan = {
  name: string;
  group: number;
  timeBasis?: 'per_unit' | 'per_batch';
  standardMilliseconds?: number;
  setupMilliseconds?: number;
};

test(
  'real Prisma edge flow closes downstream scrap and deferred per-batch labor without quantity loss',
  { skip: runDatabaseIntegration ? false : 'set RUN_DB_INTEGRATION=1 to use the configured database' },
  async () => {
    const prefix = `ITEDGE-${Date.now()}-${randomUUID().slice(0, 8)}`;
    let databaseConnected = false;
    let requestSequence = 0;

    try {
      const actor = await prisma.user.findFirst({
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
      databaseConnected = true;
      assert.ok(actor, 'database integration requires at least one existing User');
      const testActor = actor;

      async function createOrder(label: string, steps: StepPlan[]) {
        const now = new Date();
        const firstGroup = Math.min(...steps.map(step => step.group));
        return prisma.workOrder.create({
          data: {
            code: `${prefix}-${label}`,
            customerName: 'integration-test',
            productName: `${label} quantity conservation`,
            stage: 'frontend',
            status: 'processing',
            processName: steps[0].name,
            uncompletedQty: '100',
            productionTargetQty: 100,
            completedQty: '0',
            frontendTransferredQty: 0,
            planType: 'managed_plan',
            planActive: true,
            startedAt: now,
            processRoute: {
              create: {
                templateName: `${prefix}-${label}-route`,
                templateVersion: 1,
                status: 'in_progress',
                version: 0,
                confirmedAt: now,
                confirmedById: testActor.id,
                startedAt: now,
                routeSource: 'process_template',
                steps: {
                  create: steps.map((step, index) => ({
                    processCode: `${prefix}-${label}-${index + 1}`,
                    processName: step.name,
                    stageGroup: step.group === firstGroup ? 'frontend' : 'backend',
                    position: index + 1,
                    sequenceGroup: step.group,
                    standardSource: 'integration_test',
                    timeBasis: step.timeBasis || 'per_unit',
                    unitLabel: step.timeBasis === 'per_batch' ? 'batch' : 'piece',
                    standardMillisecondsPerUnit: step.standardMilliseconds || 1_000,
                    setupMilliseconds: step.setupMilliseconds || 0,
                    unitsPerProduct: 1,
                    countsForEfficiency: true,
                    inputQty: step.group === firstGroup ? 100 : 0,
                    status: step.group === firstGroup ? 'current' : 'pending',
                    startedAt: step.group === firstGroup ? now : null,
                  })),
                },
              },
            },
          },
          include: {
            processRoute: {
              include: {
                steps: { orderBy: [{ sequenceGroup: 'asc' }, { position: 'asc' }] },
              },
            },
          },
        });
      }

      async function complete(input: {
        routeId: string;
        stepId: string;
        processedQty: number;
        defectQty?: number;
        defectDisposition?: 'rework' | 'scrap_replenish';
        label: string;
      }) {
        const route = await prisma.workOrderProcessRoute.findUniqueOrThrow({
          where: { id: input.routeId },
          select: { version: true },
        });
        requestSequence += 1;
        return completeProcessStep({
          routeId: input.routeId,
          stepId: input.stepId,
          processedQty: input.processedQty,
          defectQty: input.defectQty || 0,
          defectDisposition: input.defectDisposition,
          workDate,
          idempotencyKey: `${prefix}-${requestSequence}-${input.label}`,
          expectedRouteVersion: route.version,
          userId: testActor.id,
          actor: testActor.displayName || testActor.username,
        });
      }

      async function finishBranch(branchWorkOrderId: string, label: string) {
        for (let iteration = 0; iteration < 20; iteration += 1) {
          const route = await prisma.workOrderProcessRoute.findUniqueOrThrow({
            where: { workOrderId: branchWorkOrderId },
            include: {
              steps: { orderBy: [{ sequenceGroup: 'asc' }, { position: 'asc' }] },
            },
          });
          if (route.status === 'completed') return;
          const currentSteps = route.steps.filter(step => step.status === 'current');
          assert.ok(currentSteps.length > 0, `${label} branch must retain a current step`);
          for (const step of currentSteps) {
            const latest = await prisma.workOrderProcessStep.findUniqueOrThrow({
              where: { id: step.id },
            });
            const remainingQty = latest.inputQty - latest.processedQty;
            assert.ok(remainingQty > 0, `${label} current branch step must have remaining input`);
            await complete({
              routeId: route.id,
              stepId: step.id,
              processedQty: remainingQty,
              label: `${label}-${step.position}`,
            });
          }
        }
        assert.fail(`${label} branch did not complete`);
      }

      const dirtySummary = await createOrder('DIRTY-SUMMARY-GUARD', [
        { name: 'dirty A', group: 1 },
        { name: 'dirty B', group: 2 },
      ]);
      assert.ok(dirtySummary.processRoute);
      await assert.rejects(
        adjustProductionQuantities({
          workOrderId: dirtySummary.id,
          targetQty: 120,
          frontendTransferredQty: 0,
          completedQty: 0,
          expectedVersion: dirtySummary.executionVersion,
          reason: 'must not change a started route target',
          userId: actor.id,
          actor: actor.displayName || actor.username,
        }),
        (error: unknown) => error instanceof ProductionQuantityAdjustmentServiceError
          && error.code === 'PROCESS_QUANTITY_LEDGER_LOCKED',
      );
      await prisma.workOrder.update({
        where: { id: dirtySummary.id },
        data: { completedQty: '100' },
      });
      await complete({
        routeId: dirtySummary.processRoute.id,
        stepId: dirtySummary.processRoute.steps[0].id,
        processedQty: 100,
        label: 'dirty-a-100',
      });
      const dirtyAfterFirstStep = await prisma.workOrder.findUniqueOrThrow({
        where: { id: dirtySummary.id },
      });
      assert.equal(dirtyAfterFirstStep.completedAt, null);
      assert.notEqual(dirtyAfterFirstStep.stage, 'completed');

      const serial = await createOrder('SERIAL-DOWNSTREAM-SCRAP', [
        { name: 'serial A', group: 1 },
        { name: 'serial B', group: 2 },
      ]);
      assert.ok(serial.processRoute);
      const [serialA, serialB] = serial.processRoute.steps;
      await complete({
        routeId: serial.processRoute.id,
        stepId: serialA.id,
        processedQty: 100,
        label: 'serial-a-100',
      });
      const serialBCompletion = await complete({
        routeId: serial.processRoute.id,
        stepId: serialB.id,
        processedQty: 100,
        defectQty: 10,
        defectDisposition: 'scrap_replenish',
        label: 'serial-b-100-scrap-10',
      });
      assert.equal(serialBCompletion.goodTransferredQty, 90);
      assert.ok(serialBCompletion.branchWorkOrderId);
      await finishBranch(serialBCompletion.branchWorkOrderId, 'serial-scrap');
      const serialFinished = await prisma.workOrder.findUniqueOrThrow({ where: { id: serial.id } });
      assert.equal(serialFinished.completedQty, '100');
      assert.equal(serialFinished.stage, 'completed');

      const batchRework = await createOrder('PER-BATCH-REWORK-LABOR', [
        {
          name: 'batch rework A',
          group: 1,
          timeBasis: 'per_batch',
          standardMilliseconds: 600_000,
        },
      ]);
      assert.ok(batchRework.processRoute);
      const [batchReworkA] = batchRework.processRoute.steps;
      const batchReworkCompletion = await complete({
        routeId: batchRework.processRoute.id,
        stepId: batchReworkA.id,
        processedQty: 100,
        defectQty: 100,
        defectDisposition: 'rework',
        label: 'batch-rework-a-all-defect',
      });
      assert.ok(batchReworkCompletion.branchWorkOrderId);
      assert.equal(
        await prisma.processLaborPool.count({ where: { stepId: batchReworkA.id } }),
        0,
      );
      await finishBranch(batchReworkCompletion.branchWorkOrderId, 'batch-rework');
      assert.equal(
        await prisma.processLaborPool.count({ where: { stepId: batchReworkA.id } }),
        0,
        'rework return must not create a second labor pool on the original batch step',
      );
      const batchReworkBranchPools = await prisma.processLaborPool.findMany({
        where: { workOrderId: batchReworkCompletion.branchWorkOrderId },
      });
      assert.equal(batchReworkBranchPools.length, 1);
      assert.equal(batchReworkBranchPools[0].eligibleQty, 100);

      const crossed = await createOrder('UPSTREAM-REWORK-DOWNSTREAM-SCRAP', [
        { name: 'cross A', group: 1 },
        { name: 'cross B', group: 2 },
      ]);
      assert.ok(crossed.processRoute);
      const [crossA, crossB] = crossed.processRoute.steps;
      const crossACompletion = await complete({
        routeId: crossed.processRoute.id,
        stepId: crossA.id,
        processedQty: 100,
        defectQty: 10,
        defectDisposition: 'rework',
        label: 'cross-a-rework-10',
      });
      assert.ok(crossACompletion.branchWorkOrderId);
      await assert.rejects(
        softDeleteWorkOrderWithProductionGuard({
          workOrderId: crossACompletion.branchWorkOrderId,
          confirmText: `${
            (await prisma.workOrder.findUniqueOrThrow({
              where: { id: crossACompletion.branchWorkOrderId },
              select: { code: true },
            })).code
          } CONFIRM`,
        }),
        (error: unknown) => error instanceof WorkOrderDeletionServiceError
          && error.code === 'WORK_ORDER_PRODUCTION_LEDGER_LOCKED',
      );
      const crossBCompletion = await complete({
        routeId: crossed.processRoute.id,
        stepId: crossB.id,
        processedQty: 90,
        defectQty: 10,
        defectDisposition: 'scrap_replenish',
        label: 'cross-b-scrap-10',
      });
      assert.ok(crossBCompletion.branchWorkOrderId);
      await finishBranch(crossACompletion.branchWorkOrderId, 'cross-rework');
      const crossAfterRework = await prisma.workOrderProcessStep.findUniqueOrThrow({
        where: { id: crossB.id },
      });
      assert.equal(crossAfterRework.inputQty, 100);
      assert.equal(crossAfterRework.processedQty, 90);
      await complete({
        routeId: crossed.processRoute.id,
        stepId: crossB.id,
        processedQty: 10,
        label: 'cross-b-tail-10',
      });
      await finishBranch(crossBCompletion.branchWorkOrderId, 'cross-scrap');
      const crossedFinished = await prisma.workOrder.findUniqueOrThrow({ where: { id: crossed.id } });
      assert.equal(crossedFinished.completedQty, '100');
      assert.equal(crossedFinished.stage, 'completed');

      const parallelScrap = await createOrder('PARALLEL-DEFERRED-SCRAP', [
        { name: 'parallel scrap A', group: 1 },
        { name: 'parallel scrap B', group: 1 },
        {
          name: 'parallel scrap C batch',
          group: 2,
          timeBasis: 'per_batch',
          standardMilliseconds: 600_000,
          setupMilliseconds: 120_000,
        },
      ]);
      assert.ok(parallelScrap.processRoute);
      const [parallelScrapA, parallelScrapB, parallelScrapC] = parallelScrap.processRoute.steps;
      await complete({
        routeId: parallelScrap.processRoute.id,
        stepId: parallelScrapA.id,
        processedQty: 90,
        label: 'parallel-scrap-a-90',
      });
      await complete({
        routeId: parallelScrap.processRoute.id,
        stepId: parallelScrapB.id,
        processedQty: 100,
        label: 'parallel-scrap-b-100',
      });
      const parallelScrapCCompletion = await complete({
        routeId: parallelScrap.processRoute.id,
        stepId: parallelScrapC.id,
        processedQty: 90,
        label: 'parallel-scrap-c-90',
      });
      assert.equal(parallelScrapCCompletion.laborPoolId, null);
      const parallelScrapAFinal = await complete({
        routeId: parallelScrap.processRoute.id,
        stepId: parallelScrapA.id,
        processedQty: 10,
        defectQty: 10,
        defectDisposition: 'scrap_replenish',
        label: 'parallel-scrap-a-final-defect-10',
      });
      assert.ok(parallelScrapAFinal.branchWorkOrderId);
      const deferredScrapPools = await prisma.processLaborPool.findMany({
        where: { stepId: parallelScrapC.id },
      });
      assert.equal(deferredScrapPools.length, 1);
      assert.equal(deferredScrapPools[0].eligibleQty, 90);
      assert.equal(deferredScrapPools[0].totalStandardLaborMilliseconds, 720_000n);
      await finishBranch(parallelScrapAFinal.branchWorkOrderId, 'parallel-deferred-scrap');
      assert.equal(
        (await prisma.workOrder.findUniqueOrThrow({ where: { id: parallelScrap.id } })).completedQty,
        '100',
      );

      const parallelMixed = await createOrder('PARALLEL-DEFERRED-MIXED', [
        { name: 'parallel mixed A', group: 1 },
        { name: 'parallel mixed B', group: 1 },
        {
          name: 'parallel mixed C batch',
          group: 2,
          timeBasis: 'per_batch',
          standardMilliseconds: 300_000,
          setupMilliseconds: 60_000,
        },
      ]);
      assert.ok(parallelMixed.processRoute);
      const [parallelMixedA, parallelMixedB, parallelMixedC] = parallelMixed.processRoute.steps;
      const mixedACompletion = await complete({
        routeId: parallelMixed.processRoute.id,
        stepId: parallelMixedA.id,
        processedQty: 100,
        defectQty: 10,
        defectDisposition: 'rework',
        label: 'parallel-mixed-a-rework-10',
      });
      const mixedBCompletion = await complete({
        routeId: parallelMixed.processRoute.id,
        stepId: parallelMixedB.id,
        processedQty: 100,
        defectQty: 10,
        defectDisposition: 'scrap_replenish',
        label: 'parallel-mixed-b-scrap-10',
      });
      assert.ok(mixedACompletion.branchWorkOrderId);
      assert.ok(mixedBCompletion.branchWorkOrderId);
      const mixedCCompletion = await complete({
        routeId: parallelMixed.processRoute.id,
        stepId: parallelMixedC.id,
        processedQty: 90,
        label: 'parallel-mixed-c-90',
      });
      assert.equal(mixedCCompletion.laborPoolId, null);
      assert.equal(
        await prisma.processLaborPool.count({ where: { stepId: parallelMixedC.id } }),
        0,
      );
      await finishBranch(mixedACompletion.branchWorkOrderId, 'parallel-mixed-rework');
      const deferredMixedPools = await prisma.processLaborPool.findMany({
        where: { stepId: parallelMixedC.id },
      });
      assert.equal(deferredMixedPools.length, 1);
      assert.equal(deferredMixedPools[0].eligibleQty, 90);
      assert.equal(deferredMixedPools[0].totalStandardLaborMilliseconds, 360_000n);
      await finishBranch(mixedBCompletion.branchWorkOrderId, 'parallel-mixed-scrap');
      const mixedFinished = await prisma.workOrder.findUniqueOrThrow({
        where: { id: parallelMixed.id },
      });
      assert.equal(mixedFinished.completedQty, '100');
      assert.equal(mixedFinished.stage, 'completed');

      const closureAudit = auditProductionClosure(
        await loadProductionClosureAuditSnapshot(prisma),
      );
      assert.deepEqual(
        closureAudit.findings.filter(finding => finding.severity === 'error'),
        [],
        JSON.stringify(closureAudit.findings, null, 2),
      );
    } finally {
      if (databaseConnected) {
        const workOrders = await prisma.workOrder.findMany({
          where: { code: { startsWith: prefix } },
          select: { id: true, parentWorkOrderId: true },
        });
        const workOrderIds = workOrders.map(item => item.id);
        const routes = workOrderIds.length
          ? await prisma.workOrderProcessRoute.findMany({
              where: { workOrderId: { in: workOrderIds } },
              select: { id: true },
            })
          : [];
        const routeIds = routes.map(item => item.id);
        const completions = routeIds.length
          ? await prisma.processCompletion.findMany({
              where: { routeId: { in: routeIds } },
              select: { id: true },
            })
          : [];
        const completionIds = completions.map(item => item.id);
        const pools = completionIds.length
          ? await prisma.processLaborPool.findMany({
              where: { completionId: { in: completionIds } },
              select: { id: true },
            })
          : [];
        const poolIds = pools.map(item => item.id);
        if (poolIds.length) {
          await prisma.processLaborClaim.deleteMany({ where: { poolId: { in: poolIds } } });
          await prisma.processLaborPool.deleteMany({ where: { id: { in: poolIds } } });
        }
        if (completionIds.length) {
          await prisma.processQuantityMovement.deleteMany({
            where: { completionId: { in: completionIds } },
          });
        }
        const logTargetIds = [...workOrderIds, ...routeIds, ...completionIds, ...poolIds];
        if (logTargetIds.length) {
          await prisma.operationLog.deleteMany({ where: { targetId: { in: logTargetIds } } });
        }
        if (workOrderIds.length) {
          await prisma.workOrderProgressLog.deleteMany({
            where: { workOrderId: { in: workOrderIds } },
          });
        }
        if (routeIds.length) {
          await prisma.processRouteActivity.deleteMany({ where: { routeId: { in: routeIds } } });
        }
        const workOrderById = new Map(workOrders.map(order => [order.id, order]));
        const depthOf = (workOrderId: string) => {
          let depth = 0;
          let cursor = workOrderById.get(workOrderId)?.parentWorkOrderId || null;
          const visited = new Set<string>();
          while (cursor && workOrderById.has(cursor) && !visited.has(cursor)) {
            visited.add(cursor);
            depth += 1;
            cursor = workOrderById.get(cursor)?.parentWorkOrderId || null;
          }
          return depth;
        };
        const branchOrders = workOrders
          .filter(order => order.parentWorkOrderId)
          .sort((left, right) => depthOf(right.id) - depthOf(left.id));
        for (const branchOrder of branchOrders) {
          await prisma.processCompletion.deleteMany({
            where: { workOrderId: branchOrder.id },
          });
          await prisma.workOrderProcessRoute.deleteMany({
            where: { workOrderId: branchOrder.id },
          });
          await prisma.workOrder.delete({ where: { id: branchOrder.id } });
        }
        const rootOrderIds = workOrders
          .filter(order => !order.parentWorkOrderId)
          .map(order => order.id);
        if (rootOrderIds.length) {
          await prisma.processCompletion.deleteMany({
            where: { workOrderId: { in: rootOrderIds } },
          });
          await prisma.workOrderProcessRoute.deleteMany({
            where: { workOrderId: { in: rootOrderIds } },
          });
          await prisma.workOrder.deleteMany({ where: { id: { in: rootOrderIds } } });
        }
      }
    }
  },
);
