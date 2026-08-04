import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { prisma } from '../lib/prisma';
import { completeProcessStepsBatch } from '../lib/process-completion-service';

const runDatabaseIntegration = process.env.RUN_DB_INTEGRATION === '1';

test(
  'one mobile batch submission completes multiple processes atomically and can be replayed safely',
  { skip: runDatabaseIntegration ? false : 'set RUN_DB_INTEGRATION=1 to use the configured database' },
  async () => {
    const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
    const code = `IT-BATCH-${suffix}`;
    const actor = await prisma.user.findFirst({
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, displayName: true, username: true },
    });
    assert.ok(actor, 'database integration requires at least one existing User');

    const order = await prisma.workOrder.create({
      data: {
        code,
        businessCode: `SC-HL-20260804-IT-BATCH-${suffix}`.slice(0, 120),
        customerName: 'integration-test',
        productName: 'batch reporting product',
        specification: `BATCH-${suffix}`,
        stage: 'frontend',
        status: 'processing',
        processName: '裁线',
        uncompletedQty: '12',
        productionTargetQty: 12,
        completedQty: '0',
        planType: 'managed_plan',
        planActive: true,
        startedAt: new Date(),
        processRoute: {
          create: {
            templateName: `${code} route`,
            templateVersion: 1,
            status: 'in_progress',
            version: 0,
            confirmedAt: new Date(),
            confirmedById: actor.id,
            startedAt: new Date(),
            routeSource: 'integration_test',
            steps: {
              create: [
                {
                  processCode: `${code}-CUT`,
                  processName: '裁线',
                  stageGroup: 'frontend',
                  position: 1,
                  sequenceGroup: 1,
                  standardSource: 'integration_test',
                  timeBasis: 'per_unit',
                  unitLabel: '套',
                  standardMillisecondsPerUnit: 1_000,
                  setupMilliseconds: 0,
                  unitsPerProduct: 1,
                  countsForEfficiency: true,
                  inputQty: 12,
                  status: 'current',
                  startedAt: new Date(),
                },
                {
                  processCode: `${code}-PACK`,
                  processName: '包装',
                  stageGroup: 'backend',
                  position: 2,
                  sequenceGroup: 2,
                  standardSource: 'integration_test',
                  timeBasis: 'per_unit',
                  unitLabel: '套',
                  standardMillisecondsPerUnit: 1_000,
                  setupMilliseconds: 0,
                  unitsPerProduct: 1,
                  countsForEfficiency: true,
                  inputQty: 0,
                  status: 'pending',
                },
              ],
            },
          },
        },
      },
      include: { processRoute: { include: { steps: { orderBy: { position: 'asc' } } } } },
    });
    assert.ok(order.processRoute);
    const key = `qr-batch-${randomUUID()}`;

    try {
      const command = {
        routeId: order.processRoute.id,
        items: order.processRoute.steps.map(step => ({ stepId: step.id, processedQty: 12, defectQty: 0 })),
        workDate: '2026-08-04',
        employeeIds: [],
        requireParticipants: false,
        allowAdvanceReporting: true,
        autoAssignLabor: false,
        idempotencyKey: key,
        expectedRouteVersion: 0,
        userId: actor.id,
        actor: actor.displayName || actor.username,
      };
      const completed = await completeProcessStepsBatch(command);
      assert.equal(completed.completionCount, 2);
      assert.equal(completed.pendingCoverageQty, 0);
      assert.deepEqual(completed.items.map(item => item.processName), ['裁线', '包装']);

      const replayed = await completeProcessStepsBatch(command);
      assert.equal(replayed.batchId, completed.batchId);
      assert.deepEqual(
        replayed.items.map(item => item.result.completionId),
        completed.items.map(item => item.result.completionId),
      );

      const stored = await prisma.workOrder.findUniqueOrThrow({
        where: { id: order.id },
        include: { processRoute: true, processCompletions: true },
      });
      assert.equal(stored.processRoute?.status, 'completed');
      assert.equal(Number(stored.completedQty), 12);
      assert.equal(stored.processCompletions.length, 2);
    } finally {
      const completions = await prisma.processCompletion.findMany({
        where: { workOrderId: order.id },
        select: { id: true },
      });
      const completionIds = completions.map(item => item.id);
      const pools = completionIds.length
        ? await prisma.processLaborPool.findMany({ where: { completionId: { in: completionIds } }, select: { id: true } })
        : [];
      const poolIds = pools.map(item => item.id);
      if (poolIds.length) {
        await prisma.processLaborClaim.deleteMany({ where: { poolId: { in: poolIds } } });
        await prisma.processLaborPool.deleteMany({ where: { id: { in: poolIds } } });
      }
      if (completionIds.length) {
        await prisma.processQuantityMovement.deleteMany({ where: { completionId: { in: completionIds } } });
        await prisma.processCompletion.deleteMany({ where: { id: { in: completionIds } } });
      }
      await prisma.operationLog.deleteMany({ where: { targetId: { in: [order.id, order.processRoute.id, ...completionIds, ...poolIds] } } });
      await prisma.workOrderProcessRoute.delete({ where: { id: order.processRoute.id } });
      await prisma.workOrder.delete({ where: { id: order.id } });
    }
  },
);
