import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { prisma } from '../lib/prisma';
import { auditProductionClosure } from '../lib/production-closure-audit';
import { loadProductionClosureAuditSnapshot } from '../lib/production-closure-audit-prisma';
import { completeProcessStep } from '../lib/process-completion-service';
import { correctProcessCompletionStandard } from '../lib/process-completion-correction-service';
import {
  previewProcessCompletionWithdrawal,
  withdrawProcessCompletion,
} from '../lib/process-completion-withdrawal-service';
import { claimProcessLaborPool } from '../lib/process-labor-service';

const runDatabaseIntegration = process.env.RUN_DB_INTEGRATION === '1';

test(
  'withdrawal atomically restores quantities and voids claimed employee labor',
  { skip: runDatabaseIntegration ? false : 'set RUN_DB_INTEGRATION=1 to use the configured database' },
  async () => {
    const prefix = `IT-WITHDRAW-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const actor = await prisma.user.create({
      data: {
        username: `${prefix}-ADMIN`,
        passwordHash: 'integration-test-not-a-login-hash',
        displayName: `${prefix} administrator`,
        laborRole: 'ADMIN',
      },
      select: { id: true, displayName: true, username: true },
    });
    const employee = await prisma.employee.create({
      data: {
        employeeNo: `${prefix}-E`,
        name: `${prefix} employee`,
        department: '生产部',
        team: `${prefix}-TEAM`,
      },
    });
    let orderId = '';
    let routeId = '';
    let completionId = '';
    let poolId = '';
    try {
      const order = await prisma.workOrder.create({
        data: {
          code: `${prefix}-ORDER`,
          customerName: 'integration-test',
          productName: 'withdrawal product',
          stage: 'frontend',
          status: 'processing',
          uncompletedQty: '10',
          productionTargetQty: 10,
          completedQty: '0',
          frontendTransferredQty: 0,
          planType: 'managed_plan',
          planActive: true,
          startedAt: new Date(),
          processRoute: {
            create: {
              templateName: `${prefix} route`,
              templateVersion: 1,
              status: 'in_progress',
              version: 0,
              confirmedAt: new Date(),
              confirmedById: actor.id,
              startedAt: new Date(),
              routeSource: 'product_time_profile',
              steps: {
                create: [
                  {
                    processCode: `${prefix}-CUT`,
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
                    inputQty: 10,
                    status: 'current',
                    startedAt: new Date(),
                  },
                  {
                    processCode: `${prefix}-CRIMP`,
                    processName: '压接',
                    stageGroup: 'frontend',
                    position: 2,
                    sequenceGroup: 2,
                    standardSource: 'integration_test',
                    timeBasis: 'per_unit',
                    unitLabel: '套',
                    standardMillisecondsPerUnit: 2_000,
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
      orderId = order.id;
      assert.ok(order.processRoute);
      routeId = order.processRoute.id;
      const [cutStep, crimpStep] = order.processRoute.steps;
      const completion = await completeProcessStep({
        routeId,
        stepId: cutStep.id,
        processedQty: 10,
        defectQty: 0,
        workDate: '2026-08-03',
        employeeIds: [employee.id],
        requireParticipants: true,
        idempotencyKey: `${prefix}-complete`,
        expectedRouteVersion: 0,
        userId: actor.id,
        actor: actor.displayName || actor.username,
      });
      completionId = completion.completionId;
      assert.ok(completion.laborPoolId);
      poolId = completion.laborPoolId;
      const claim = await claimProcessLaborPool({
        poolId,
        employeeId: employee.id,
        quantity: 10,
        expectedVersion: 0,
        idempotencyKey: `${prefix}-claim`,
        userId: actor.id,
      });
      assert.equal(claim.pool.status, 'EXHAUSTED');

      const corrected = await correctProcessCompletionStandard({
        routeId,
        completionId,
        expectedRouteVersion: 1,
        processName: '精确裁线',
        standardMillisecondsPerUnit: 2_000,
        idempotencyKey: `${prefix}-correct`,
        userId: actor.id,
        actor: actor.displayName || actor.username,
      });
      assert.equal(corrected.replacedClaimCount, 1);
      const correctedClaim = await prisma.processLaborClaim.findFirstOrThrow({
        where: { poolId, status: 'ACTIVE' },
      });
      assert.equal(correctedClaim.standardLaborMilliseconds, 20_000n);

      const preview = await previewProcessCompletionWithdrawal(routeId, completionId);
      assert.equal(preview.canWithdraw, true);
      assert.equal(preview.impact.releaseReductionQty, 10);
      assert.equal(preview.impact.laborClaimCount, 1);

      const key = `${prefix}-withdraw`;
      const withdrawn = await withdrawProcessCompletion({
        routeId,
        completionId,
        expectedRouteVersion: preview.routeVersion,
        category: 'REPORTING_ERROR',
        idempotencyKey: key,
        userId: actor.id,
        actor: actor.displayName || actor.username,
      });
      assert.equal(withdrawn.status, 'WITHDRAWN');
      const replay = await withdrawProcessCompletion({
        routeId,
        completionId,
        expectedRouteVersion: preview.routeVersion,
        category: 'REPORTING_ERROR',
        idempotencyKey: key,
        userId: actor.id,
        actor: actor.displayName || actor.username,
      });
      assert.equal(replay.status, 'WITHDRAWN');
      assert.equal(replay.routeVersion, withdrawn.routeVersion);

      const [storedCompletion, storedRoute, steps, pool, claims, reversals] = await Promise.all([
        prisma.processCompletion.findUniqueOrThrow({ where: { id: completionId } }),
        prisma.workOrderProcessRoute.findUniqueOrThrow({ where: { id: routeId } }),
        prisma.workOrderProcessStep.findMany({ where: { routeId }, orderBy: { position: 'asc' } }),
        prisma.processLaborPool.findUniqueOrThrow({ where: { id: poolId } }),
        prisma.processLaborClaim.findMany({ where: { poolId }, orderBy: { createdAt: 'asc' } }),
        prisma.processQuantityMovement.findMany({ where: { completionId, type: 'REVERSAL' } }),
      ]);
      assert.ok(storedCompletion.voidedAt);
      assert.match(storedCompletion.voidReason || '', /主管完工撤回（报工错误）/);
      assert.equal(storedRoute.status, 'in_progress');
      assert.equal(steps[0].processedQty, 0);
      assert.equal(steps[0].goodOutputQty, 0);
      assert.equal(steps[0].releasedGoodQty, 0);
      assert.equal(steps[0].status, 'current');
      assert.equal(steps[1].id, crimpStep.id);
      assert.equal(steps[1].inputQty, 0);
      assert.equal(steps[1].status, 'pending');
      assert.equal(pool.status, 'VOIDED');
      assert.equal(pool.eligibleQty, 10);
      assert.equal(pool.claimedQty, 0);
      assert.equal(pool.remainingQty, 10);
      assert.equal(claims.filter(item => item.status === 'ACTIVE').length, 0);
      assert.equal(claims.filter(item => item.status === 'VOIDED').length, 2);
      assert.equal(claims.filter(item => item.status === 'REVERSAL').length, 2);
      assert.equal(reversals.length, 1);
      assert.equal(reversals[0].quantity, 10);
      assert.ok(reversals[0].reversalOfId);
      const audit = auditProductionClosure(await loadProductionClosureAuditSnapshot(prisma));
      assert.deepEqual(
        audit.findings.filter(finding => finding.workOrderCode === `${prefix}-ORDER`),
        [],
      );
    } finally {
      if (poolId) {
        await prisma.processLaborClaim.deleteMany({ where: { poolId } });
        await prisma.processLaborPool.deleteMany({ where: { id: poolId } });
      }
      if (completionId) {
        await prisma.processQuantityMovement.deleteMany({ where: { completionId, type: 'REVERSAL' } });
        await prisma.processQuantityMovement.deleteMany({ where: { completionId } });
        await prisma.processRouteActivity.deleteMany({ where: { routeId } });
        await prisma.processCompletionParticipant.deleteMany({ where: { completionId } });
        await prisma.processCompletion.deleteMany({ where: { id: completionId } });
      }
      if (orderId) {
        await prisma.workOrderProgressLog.deleteMany({ where: { workOrderId: orderId } });
        await prisma.workOrder.deleteMany({ where: { id: orderId } });
      }
      await prisma.employee.deleteMany({ where: { id: employee.id } });
      await prisma.user.deleteMany({ where: { id: actor.id } });
    }
  },
);

test(
  'withdrawal creates a process issue instead of rewinding processed downstream work',
  { skip: runDatabaseIntegration ? false : 'set RUN_DB_INTEGRATION=1 to use the configured database' },
  async () => {
    const prefix = `IT-WITHDRAW-BLOCK-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const actor = await prisma.user.create({
      data: {
        username: `${prefix}-ADMIN`,
        passwordHash: 'integration-test-not-a-login-hash',
        displayName: `${prefix} administrator`,
        laborRole: 'ADMIN',
      },
      select: { id: true, displayName: true, username: true },
    });
    let orderId = '';
    let routeId = '';
    let completionId = '';
    let issueId = '';
    try {
      const order = await prisma.workOrder.create({
        data: {
          code: `${prefix}-ORDER`,
          productName: 'blocked withdrawal product',
          stage: 'frontend',
          status: 'processing',
          uncompletedQty: '10',
          productionTargetQty: 10,
          completedQty: '0',
          frontendTransferredQty: 0,
          planType: 'managed_plan',
          planActive: true,
          processRoute: {
            create: {
              templateName: `${prefix} route`,
              templateVersion: 1,
              status: 'in_progress',
              version: 0,
              routeSource: 'product_time_profile',
              steps: {
                create: [
                  {
                    processCode: `${prefix}-ONE`, processName: '第一工序', stageGroup: 'frontend',
                    position: 1, sequenceGroup: 1, standardSource: 'integration_test', timeBasis: 'per_unit',
                    unitLabel: '件', standardMillisecondsPerUnit: 1_000, inputQty: 10, processedQty: 10,
                    goodOutputQty: 10, releasedGoodQty: 10, status: 'completed', completedAt: new Date(),
                  },
                  {
                    processCode: `${prefix}-TWO`, processName: '第二工序', stageGroup: 'frontend',
                    position: 2, sequenceGroup: 2, standardSource: 'integration_test', timeBasis: 'per_unit',
                    unitLabel: '件', standardMillisecondsPerUnit: 1_000, inputQty: 10, processedQty: 1,
                    goodOutputQty: 1, releasedGoodQty: 0, status: 'current', startedAt: new Date(),
                  },
                ],
              },
            },
          },
        },
        include: { processRoute: { include: { steps: { orderBy: { position: 'asc' } } } } },
      });
      orderId = order.id;
      assert.ok(order.processRoute);
      routeId = order.processRoute.id;
      const [source, target] = order.processRoute.steps;
      const completion = await prisma.processCompletion.create({
        data: {
          workOrderId: order.id,
          routeId,
          stepId: source.id,
          workDate: new Date('2026-08-03T00:00:00.000Z'),
          processedQty: 10,
          goodQty: 10,
          defectQty: 0,
          routeVersion: 0,
          idempotencyKey: `${prefix}-completion`,
          standardSource: 'integration_test',
          timeBasis: 'per_unit',
          unitLabel: '件',
          standardMillisecondsPerUnit: 1_000,
          createdById: actor.id,
        },
      });
      completionId = completion.id;
      await prisma.processQuantityMovement.create({
        data: {
          completionId,
          workOrderId: order.id,
          sourceStepId: source.id,
          targetStepId: target.id,
          type: 'GOOD_TRANSFER',
          quantity: 10,
          sourceSequenceGroup: 1,
          targetSequenceGroup: 2,
          idempotencyKey: `${prefix}-movement`,
        },
      });
      const preview = await previewProcessCompletionWithdrawal(routeId, completionId);
      assert.equal(preview.canWithdraw, false);
      assert.ok(preview.blockers.some(item => item.code === 'PROCESS_COMPLETION_DOWNSTREAM_PROCESSED'));
      const key = `${prefix}-blocked`;
      const result = await withdrawProcessCompletion({
        routeId,
        completionId,
        expectedRouteVersion: 0,
        category: 'PROCESS_EXCEPTION',
        idempotencyKey: key,
        userId: actor.id,
        actor: actor.displayName || actor.username,
      });
      assert.equal(result.status, 'BLOCKED');
      assert.ok(result.issue);
      issueId = result.issue?.id || '';
      const replay = await withdrawProcessCompletion({
        routeId,
        completionId,
        expectedRouteVersion: 0,
        category: 'PROCESS_EXCEPTION',
        idempotencyKey: key,
        userId: actor.id,
        actor: actor.displayName || actor.username,
      });
      assert.equal(replay.status, 'BLOCKED');
      assert.equal(replay.issue?.id, issueId);
      const unchanged = await prisma.processCompletion.findUniqueOrThrow({ where: { id: completionId } });
      assert.equal(unchanged.voidedAt, null);
      assert.equal(await prisma.processQuantityMovement.count({ where: { completionId, type: 'REVERSAL' } }), 0);
    } finally {
      if (issueId) {
        await prisma.issueActivity.deleteMany({ where: { issueId } });
        await prisma.issue.deleteMany({ where: { id: issueId } });
      }
      if (routeId) await prisma.processRouteActivity.deleteMany({ where: { routeId } });
      if (completionId) {
        await prisma.processQuantityMovement.deleteMany({ where: { completionId } });
        await prisma.processCompletion.deleteMany({ where: { id: completionId } });
        await prisma.operationLog.deleteMany({ where: { targetId: completionId } });
      }
      if (orderId) await prisma.workOrder.deleteMany({ where: { id: orderId } });
      await prisma.user.deleteMany({ where: { id: actor.id } });
    }
  },
);
