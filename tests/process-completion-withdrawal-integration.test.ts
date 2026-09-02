import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { prisma } from '../lib/prisma';
import { auditProductionClosure } from '../lib/production-closure-audit';
import { loadProductionClosureAuditSnapshot } from '../lib/production-closure-audit-prisma';
import { completeProcessStep } from '../lib/process-completion-service';
import { correctProcessCompletionStandard } from '../lib/process-completion-correction-service';
import {
  cancelProcessCompletionWithdrawalRequest,
  createProcessCompletionWithdrawalRequest,
  decideProcessCompletionWithdrawalRequest,
  listProcessCompletionWithdrawalRequests,
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
      assert.match(storedCompletion.voidReason || '', /完工撤回（报工错误）/);
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
  'blocked direct withdrawal preserves downstream work without creating an Issue',
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
          reportedUnitQty: 10,
          reportedGoodUnitQty: 10,
          reportedDefectUnitQty: 0,
          reportQuantityBasis: 'product',
          reportUnitLabel: '件',
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
      assert.equal(result.issue, null);
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
      assert.equal(replay.issue, null);
      const unchanged = await prisma.processCompletion.findUniqueOrThrow({ where: { id: completionId } });
      assert.equal(unchanged.voidedAt, null);
      assert.equal(await prisma.processQuantityMovement.count({ where: { completionId, type: 'REVERSAL' } }), 0);
      assert.equal(await prisma.issue.count({ where: { sourceId: completionId } }), 0);
    } finally {
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

type WithdrawalRequestFixture = {
  prefix: string;
  orderId: string;
  routeId: string;
  completionId: string;
  requesterUserId: string;
  requesterEmployeeId: string;
  reviewerUserId: string;
  reviewerName: string;
};

async function createWithdrawalRequestFixture(
  label: string,
  options: { blocked?: boolean } = {},
): Promise<WithdrawalRequestFixture> {
  const prefix = `IT-WITHDRAW-REQUEST-${label}-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const employee = await prisma.employee.create({
    data: {
      employeeNo: `${prefix}-E`,
      name: `${prefix} employee`,
      department: '生产部',
      team: `${prefix}-TEAM`,
    },
  });
  const requester = await prisma.user.create({
    data: {
      username: `${prefix}-REQUESTER`,
      passwordHash: 'integration-test-not-a-login-hash',
      displayName: `${prefix} requester`,
      laborRole: 'EMPLOYEE',
      employeeId: employee.id,
    },
  });
  const reviewer = await prisma.user.create({
    data: {
      username: `${prefix}-ADMIN`,
      passwordHash: 'integration-test-not-a-login-hash',
      displayName: `${prefix} administrator`,
      laborRole: 'ADMIN',
    },
  });
  const order = await prisma.workOrder.create({
    data: {
      code: `${prefix}-ORDER`,
      productName: `${prefix} product`,
      stage: 'frontend',
      status: 'processing',
      uncompletedQty: '10',
      productionTargetQty: 10,
      completedQty: options.blocked ? '0' : '5',
      frontendTransferredQty: options.blocked ? 0 : 5,
      planType: 'managed_plan',
      planActive: true,
      processRoute: {
        create: {
          templateName: `${prefix} route`,
          templateVersion: 1,
          status: 'in_progress',
          version: 0,
          steps: {
            create: [
              {
                processCode: `${prefix}-ONE`,
                processName: '第一工序',
                stageGroup: 'frontend',
                position: 1,
                sequenceGroup: 1,
                standardSource: 'integration_test',
                timeBasis: 'per_unit',
                unitLabel: '件',
                standardMillisecondsPerUnit: 1_000,
                inputQty: 5,
                processedQty: 5,
                goodOutputQty: 5,
                releasedGoodQty: 5,
                status: 'completed',
                completedAt: new Date(),
              },
              ...(options.blocked ? [{
                processCode: `${prefix}-TWO`,
                processName: '第二工序',
                stageGroup: 'frontend',
                position: 2,
                sequenceGroup: 2,
                standardSource: 'integration_test',
                timeBasis: 'per_unit',
                unitLabel: '件',
                standardMillisecondsPerUnit: 1_000,
                inputQty: 5,
                processedQty: 1,
                goodOutputQty: 1,
                releasedGoodQty: 0,
                status: 'current',
                startedAt: new Date(),
              }] : []),
            ],
          },
        },
      },
    },
    include: { processRoute: { include: { steps: { orderBy: { position: 'asc' } } } } },
  });
  assert.ok(order.processRoute);
  const [sourceStep, targetStep] = order.processRoute.steps;
  const completion = await prisma.processCompletion.create({
    data: {
      workOrderId: order.id,
      routeId: order.processRoute.id,
      stepId: sourceStep.id,
      workDate: new Date('2026-09-02T00:00:00.000Z'),
      processedQty: 5,
      goodQty: 5,
      defectQty: 0,
      reportedUnitQty: 5,
      reportedGoodUnitQty: 5,
      reportedDefectUnitQty: 0,
      reportQuantityBasis: 'product',
      reportUnitLabel: '件',
      coverageStatus: 'COVERED',
      coveredQty: 5,
      coveredGoodQty: 5,
      coveredDefectQty: 0,
      routeVersion: 0,
      idempotencyKey: `${prefix}-completion`,
      standardSource: 'integration_test',
      timeBasis: 'per_unit',
      unitLabel: '件',
      standardMillisecondsPerUnit: 1_000,
      reportSource: 'QR_MOBILE',
      createdById: requester.id,
      principalEmployeeId: employee.id,
    },
  });
  await prisma.processQuantityMovement.create({
    data: {
      completionId: completion.id,
      workOrderId: order.id,
      sourceStepId: sourceStep.id,
      targetStepId: targetStep?.id || null,
      type: targetStep ? 'GOOD_TRANSFER' : 'FINISHED_GOOD',
      quantity: 5,
      sourceSequenceGroup: 1,
      targetSequenceGroup: targetStep?.sequenceGroup || null,
      idempotencyKey: `${prefix}-movement`,
    },
  });
  return {
    prefix,
    orderId: order.id,
    routeId: order.processRoute.id,
    completionId: completion.id,
    requesterUserId: requester.id,
    requesterEmployeeId: employee.id,
    reviewerUserId: reviewer.id,
    reviewerName: reviewer.displayName,
  };
}

async function cleanupWithdrawalRequestFixture(fixture: WithdrawalRequestFixture): Promise<void> {
  const requests = await prisma.processCompletionWithdrawalRequest.findMany({
    where: { workOrderId: fixture.orderId },
    select: { id: true },
  });
  const requestIds = requests.map(item => item.id);
  if (requestIds.length) {
    await prisma.systemNotification.deleteMany({
      where: { sourceType: 'process_completion_withdrawal_request', sourceId: { in: requestIds } },
    });
    await prisma.operationLog.deleteMany({ where: { targetId: { in: requestIds } } });
    await prisma.processCompletionWithdrawalRequest.deleteMany({ where: { id: { in: requestIds } } });
  }
  await prisma.operationLog.deleteMany({ where: { targetId: fixture.completionId } });
  await prisma.processRouteActivity.deleteMany({ where: { routeId: fixture.routeId } });
  await prisma.processQuantityMovement.deleteMany({
    where: { workOrderId: fixture.orderId, reversalOfId: { not: null } },
  });
  await prisma.processQuantityMovement.deleteMany({ where: { workOrderId: fixture.orderId } });
  await prisma.processCompletionParticipant.deleteMany({ where: { completionId: fixture.completionId } });
  await prisma.processCompletion.deleteMany({ where: { id: fixture.completionId } });
  await prisma.workOrderProgressLog.deleteMany({ where: { workOrderId: fixture.orderId } });
  await prisma.workOrder.deleteMany({ where: { id: fixture.orderId } });
  await prisma.user.deleteMany({ where: { id: { in: [fixture.requesterUserId, fixture.reviewerUserId] } } });
  await prisma.employee.deleteMany({ where: { id: fixture.requesterEmployeeId } });
}

test(
  'employee withdrawal requests enforce ownership, idempotency and cancellable pending state',
  { skip: runDatabaseIntegration ? false : 'set RUN_DB_INTEGRATION=1 to use the configured database' },
  async () => {
    const fixture = await createWithdrawalRequestFixture('OWNER');
    const otherEmployee = await prisma.employee.create({
      data: { employeeNo: `${fixture.prefix}-OTHER-E`, name: `${fixture.prefix} other employee` },
    });
    const otherUser = await prisma.user.create({
      data: {
        username: `${fixture.prefix}-OTHER`,
        passwordHash: 'integration-test-not-a-login-hash',
        displayName: `${fixture.prefix} other`,
        employeeId: otherEmployee.id,
      },
    });
    try {
      const createKey = `${fixture.prefix}-request-create`;
      const request = await createProcessCompletionWithdrawalRequest({
        routeId: fixture.routeId,
        completionId: fixture.completionId,
        expectedRouteVersion: 0,
        idempotencyKey: createKey,
        userId: fixture.requesterUserId,
        employeeId: fixture.requesterEmployeeId,
        actor: 'requester',
      });
      assert.equal(request.status, 'PENDING');
      const replay = await createProcessCompletionWithdrawalRequest({
        routeId: fixture.routeId,
        completionId: fixture.completionId,
        expectedRouteVersion: 0,
        idempotencyKey: createKey,
        userId: fixture.requesterUserId,
        employeeId: fixture.requesterEmployeeId,
        actor: 'requester',
      });
      assert.equal(replay.id, request.id);

      await assert.rejects(
        () => createProcessCompletionWithdrawalRequest({
          routeId: fixture.routeId,
          completionId: fixture.completionId,
          expectedRouteVersion: 0,
          idempotencyKey: `${fixture.prefix}-other-create`,
          userId: otherUser.id,
          employeeId: otherEmployee.id,
          actor: 'other',
        }),
        (error: unknown) => (
          error instanceof Error
          && (error as { code?: string }).code === 'PROCESS_COMPLETION_WITHDRAWAL_REQUEST_EMPLOYEE_FORBIDDEN'
        ),
      );
      await assert.rejects(
        () => cancelProcessCompletionWithdrawalRequest({
          requestId: request.id,
          routeId: fixture.routeId,
          completionId: fixture.completionId,
          expectedVersion: request.version,
          idempotencyKey: `${fixture.prefix}-other-cancel`,
          userId: otherUser.id,
          employeeId: otherEmployee.id,
        }),
        (error: unknown) => (
          error instanceof Error
          && (error as { code?: string }).code === 'PROCESS_COMPLETION_WITHDRAWAL_REQUEST_NOT_FOUND'
        ),
      );
      const cancelKey = `${fixture.prefix}-owner-cancel`;
      const cancelled = await cancelProcessCompletionWithdrawalRequest({
        requestId: request.id,
        routeId: fixture.routeId,
        completionId: fixture.completionId,
        expectedVersion: request.version,
        idempotencyKey: cancelKey,
        userId: fixture.requesterUserId,
        employeeId: fixture.requesterEmployeeId,
      });
      assert.equal(cancelled.status, 'CANCELLED');
      const cancelReplay = await cancelProcessCompletionWithdrawalRequest({
        requestId: request.id,
        routeId: fixture.routeId,
        completionId: fixture.completionId,
        expectedVersion: request.version,
        idempotencyKey: cancelKey,
        userId: fixture.requesterUserId,
        employeeId: fixture.requesterEmployeeId,
      });
      assert.equal(cancelReplay.status, 'CANCELLED');
      assert.equal((await prisma.processCompletion.findUniqueOrThrow({ where: { id: fixture.completionId } })).voidedAt, null);
    } finally {
      await prisma.user.deleteMany({ where: { id: otherUser.id } });
      await prisma.employee.deleteMany({ where: { id: otherEmployee.id } });
      await cleanupWithdrawalRequestFixture(fixture);
    }
  },
);

test(
  'manager approval applies withdrawal and APPLIED state atomically with replay and scope filtering',
  { skip: runDatabaseIntegration ? false : 'set RUN_DB_INTEGRATION=1 to use the configured database' },
  async () => {
    const fixture = await createWithdrawalRequestFixture('APPROVE');
    try {
      const request = await createProcessCompletionWithdrawalRequest({
        routeId: fixture.routeId,
        completionId: fixture.completionId,
        expectedRouteVersion: 0,
        idempotencyKey: `${fixture.prefix}-create`,
        userId: fixture.requesterUserId,
        employeeId: fixture.requesterEmployeeId,
        actor: 'requester',
      });
      const hidden = await listProcessCompletionWithdrawalRequests({
        status: 'PENDING',
        workOrderWhere: { id: 'outside-scope' },
      });
      assert.equal(hidden.items.some(item => item.id === request.id), false);
      const visible = await listProcessCompletionWithdrawalRequests({
        status: 'PENDING',
        workOrderWhere: { id: fixture.orderId },
      });
      assert.equal(visible.items.some(item => item.id === request.id), true);

      const commands = ['decision-a', 'decision-b'].map(suffix => ({
        key: `${fixture.prefix}-${suffix}`,
        promise: decideProcessCompletionWithdrawalRequest({
          requestId: request.id,
          action: 'APPROVE',
          expectedVersion: request.version,
          expectedRouteVersion: 0,
          idempotencyKey: `${fixture.prefix}-${suffix}`,
          userId: fixture.reviewerUserId,
          actor: fixture.reviewerName,
          workOrderWhere: { id: fixture.orderId },
        }),
      }));
      const settled = await Promise.allSettled(commands.map(item => item.promise));
      const winners = settled
        .map((result, index) => ({ result, key: commands[index].key }))
        .filter((item): item is { result: PromiseFulfilledResult<Awaited<typeof commands[number]['promise']>>; key: string } => item.result.status === 'fulfilled');
      assert.equal(winners.length, 1);
      assert.equal(winners[0].result.value.status, 'APPLIED');
      const [savedRequest, savedCompletion] = await Promise.all([
        prisma.processCompletionWithdrawalRequest.findUniqueOrThrow({ where: { id: request.id } }),
        prisma.processCompletion.findUniqueOrThrow({ where: { id: fixture.completionId } }),
      ]);
      assert.equal(savedRequest.status, 'APPLIED');
      assert.ok(savedCompletion.voidedAt);
      const replay = await decideProcessCompletionWithdrawalRequest({
        requestId: request.id,
        action: 'APPROVE',
        expectedVersion: request.version,
        expectedRouteVersion: 0,
        idempotencyKey: winners[0].key,
        userId: fixture.reviewerUserId,
        actor: fixture.reviewerName,
        workOrderWhere: { id: fixture.orderId },
      });
      assert.equal(replay.status, 'APPLIED');
      assert.equal(replay.withdrawal?.status, 'WITHDRAWN');
      assert.equal(await prisma.issue.count({ where: { sourceId: fixture.completionId } }), 0);
    } finally {
      await cleanupWithdrawalRequestFixture(fixture);
    }
  },
);

test(
  'manager reject, safety blocker and stale route are terminal without Issue side effects',
  { skip: runDatabaseIntegration ? false : 'set RUN_DB_INTEGRATION=1 to use the configured database' },
  async () => {
    const rejectedFixture = await createWithdrawalRequestFixture('REJECT');
    const blockedFixture = await createWithdrawalRequestFixture('BLOCKED', { blocked: true });
    const staleFixture = await createWithdrawalRequestFixture('STALE');
    try {
      const rejectedRequest = await createProcessCompletionWithdrawalRequest({
        routeId: rejectedFixture.routeId,
        completionId: rejectedFixture.completionId,
        expectedRouteVersion: 0,
        idempotencyKey: `${rejectedFixture.prefix}-create`,
        userId: rejectedFixture.requesterUserId,
        employeeId: rejectedFixture.requesterEmployeeId,
        actor: 'requester',
      });
      const rejected = await decideProcessCompletionWithdrawalRequest({
        requestId: rejectedRequest.id,
        action: 'REJECT',
        expectedVersion: rejectedRequest.version,
        idempotencyKey: `${rejectedFixture.prefix}-reject`,
        note: '数量无需撤回',
        userId: rejectedFixture.reviewerUserId,
        actor: rejectedFixture.reviewerName,
        workOrderWhere: { id: rejectedFixture.orderId },
      });
      assert.equal(rejected.status, 'REJECTED');

      const blockedRequest = await createProcessCompletionWithdrawalRequest({
        routeId: blockedFixture.routeId,
        completionId: blockedFixture.completionId,
        expectedRouteVersion: 0,
        idempotencyKey: `${blockedFixture.prefix}-create`,
        userId: blockedFixture.requesterUserId,
        employeeId: blockedFixture.requesterEmployeeId,
        actor: 'requester',
      });
      const blocked = await decideProcessCompletionWithdrawalRequest({
        requestId: blockedRequest.id,
        action: 'APPROVE',
        expectedVersion: blockedRequest.version,
        expectedRouteVersion: 0,
        idempotencyKey: `${blockedFixture.prefix}-approve`,
        userId: blockedFixture.reviewerUserId,
        actor: blockedFixture.reviewerName,
        workOrderWhere: { id: blockedFixture.orderId },
      });
      assert.equal(blocked.status, 'BLOCKED');
      assert.equal(await prisma.issue.count({ where: { sourceId: blockedFixture.completionId } }), 0);
      assert.equal((await prisma.processCompletion.findUniqueOrThrow({ where: { id: blockedFixture.completionId } })).voidedAt, null);

      const staleRequest = await createProcessCompletionWithdrawalRequest({
        routeId: staleFixture.routeId,
        completionId: staleFixture.completionId,
        expectedRouteVersion: 0,
        idempotencyKey: `${staleFixture.prefix}-create`,
        userId: staleFixture.requesterUserId,
        employeeId: staleFixture.requesterEmployeeId,
        actor: 'requester',
      });
      await prisma.workOrderProcessRoute.update({
        where: { id: staleFixture.routeId },
        data: { version: { increment: 1 } },
      });
      const stale = await decideProcessCompletionWithdrawalRequest({
        requestId: staleRequest.id,
        action: 'APPROVE',
        expectedVersion: staleRequest.version,
        expectedRouteVersion: 0,
        idempotencyKey: `${staleFixture.prefix}-approve`,
        userId: staleFixture.reviewerUserId,
        actor: staleFixture.reviewerName,
        workOrderWhere: { id: staleFixture.orderId },
      });
      assert.equal(stale.status, 'STALE');
      assert.equal((await prisma.processCompletion.findUniqueOrThrow({ where: { id: staleFixture.completionId } })).voidedAt, null);
    } finally {
      await cleanupWithdrawalRequestFixture(rejectedFixture);
      await cleanupWithdrawalRequestFixture(blockedFixture);
      await cleanupWithdrawalRequestFixture(staleFixture);
    }
  },
);
