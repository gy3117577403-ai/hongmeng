import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { completeProcessStep, loadProcessCompletionContext } from '../lib/process-completion-service';
import {
  previewProcessCompletionWithdrawal,
  withdrawProcessCompletion,
} from '../lib/process-completion-withdrawal-service';
import {
  activateProcessRouteChange,
  completeProcessSupplementObligation,
  createProcessRouteChangeProposal,
  reviewProcessRouteChange,
  submitProcessRouteChange,
} from '../lib/process-route-change-service';
import { prisma } from '../lib/prisma';
import { PRODUCTION_DEPARTMENT } from '../lib/production-workforce';
import { recoverStaleSupplementRouteCompletions as recoverInProcess } from '../lib/process-supplement-completion-recovery';

const runDatabaseIntegration = process.env.RUN_DB_INTEGRATION === '1';
const workDate = '2026-08-11';

// The immutable-image acceptance run sends recovery through the actual bundled
// HTTP worker. Normal CI calls the same service directly in an isolated database.
async function recoverStaleSupplementRouteCompletions(options: { routeId: string }) {
  const origin = process.env.PROCESS_SUPPLEMENT_RECOVERY_TEST_ORIGIN;
  if (!origin) return recoverInProcess(options);
  const url = new URL('/api/internal/process-route-change-outbox', origin);
  assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname), 'image acceptance must use an isolated local server');
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'x-outbox-worker-token': process.env.PROCESS_ROUTE_CHANGE_OUTBOX_WORKER_TOKEN || '' },
  });
  assert.equal(response.status, 200);
  const body = await response.json() as { recovery: Awaited<ReturnType<typeof recoverInProcess>> };
  assert.ok(body.recovery);
  return body.recovery;
}

type Actor = { id: string; username: string; displayName: string | null };

async function createRoute(input: {
  prefix: string;
  actor: Actor;
  firstDefinition: { id: string; code: string; name: string; stageGroup: string };
  secondDefinition: { id: string; code: string; name: string; stageGroup: string };
}) {
  const startedAt = new Date('2026-08-11T00:00:00.000Z');
  return prisma.workOrder.create({
    data: {
      code: `${input.prefix}-ORDER`,
      customerName: 'integration-test',
      productName: 'supplement quantity isolation',
      stage: 'frontend',
      status: 'processing',
      processName: input.firstDefinition.name,
      uncompletedQty: '10',
      productionTargetQty: 10,
      completedQty: '0',
      frontendTransferredQty: 0,
      planType: 'managed_plan',
      planActive: true,
      startedAt,
      processRoute: {
        create: {
          templateName: `${input.prefix} route`,
          templateVersion: 1,
          status: 'in_progress',
          version: 0,
          confirmedAt: startedAt,
          confirmedById: input.actor.id,
          startedAt,
          routeSource: 'integration_test',
          steps: {
            create: [
              {
                processDefinitionId: input.firstDefinition.id,
                processCode: input.firstDefinition.code,
                processName: input.firstDefinition.name,
                stageGroup: input.firstDefinition.stageGroup,
                position: 1,
                sequenceGroup: 1,
                standardSource: 'integration_test',
                timeBasis: 'per_unit',
                unitLabel: 'piece',
                standardMillisecondsPerUnit: 1_000,
                setupMilliseconds: 0,
                unitsPerProduct: 1,
                countsForEfficiency: true,
                inputQty: 10,
                status: 'current',
                startedAt,
              },
              {
                processDefinitionId: input.secondDefinition.id,
                processCode: input.secondDefinition.code,
                processName: input.secondDefinition.name,
                stageGroup: input.secondDefinition.stageGroup,
                position: 2,
                sequenceGroup: 2,
                standardSource: 'integration_test',
                timeBasis: 'per_unit',
                unitLabel: 'piece',
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
    include: {
      processRoute: { include: { steps: { orderBy: { position: 'asc' } } } },
    },
  });
}

async function insertSupplement(input: {
  prefix: string;
  actor: Actor;
  workOrderId: string;
  routeId: string;
  routeVersion: number;
  targetStepId: string;
  supplementDefinition: { id: string };
  actionBased?: boolean;
}) {
  const proposal = await createProcessRouteChangeProposal({
    workOrderId: input.workOrderId,
    routeId: input.routeId,
    title: 'Insert missed operation for quantity-isolation regression',
    reason: 'Verify that the supplemental ledger never participates in ordinary quantity flow',
    scope: 'CURRENT_WORK_ORDER_ONLY',
    diffs: [{
      kind: 'INSERT_STEP',
      processDefinitionId: input.supplementDefinition.id,
      targetStepId: input.targetStepId,
      afterData: {
        insertBeforeStepId: input.targetStepId,
        standardMillisecondsPerUnit: 3_000,
        setupMilliseconds: 0,
        requiredQty: 10,
        unitLabel: 'piece',
        ...(input.actionBased ? {
          unitsPerProduct: 3,
          reportQuantityBasis: 'action',
          reportUnitLabel: 'terminal',
        } : {}),
      },
    }],
    idempotencyKey: `${input.prefix}-create-change`,
    expectedVersion: input.routeVersion,
    userId: input.actor.id,
    actor: input.actor.displayName || input.actor.username,
  });
  const submitted = await submitProcessRouteChange({
    changeId: proposal.id,
    idempotencyKey: `${input.prefix}-submit-change`,
    expectedVersion: proposal.version,
    userId: input.actor.id,
    actor: input.actor.displayName || input.actor.username,
  });
  const reviewed = await reviewProcessRouteChange({
    changeId: proposal.id,
    decision: 'approve',
    idempotencyKey: `${input.prefix}-approve-change`,
    expectedVersion: submitted.version,
    userId: input.actor.id,
    actor: input.actor.displayName || input.actor.username,
  });
  const activated = await activateProcessRouteChange({
    changeId: proposal.id,
    expectedRouteVersion: input.routeVersion,
    idempotencyKey: `${input.prefix}-activate-change`,
    expectedVersion: reviewed.version,
    userId: input.actor.id,
    actor: input.actor.displayName || input.actor.username,
  });
  assert.equal(activated.supplementObligations.length, 1);
  return activated.supplementObligations[0];
}

async function assertSupplementQuantityLedgerIsZero(stepId: string) {
  const step = await prisma.workOrderProcessStep.findUniqueOrThrow({ where: { id: stepId } });
  assert.equal(step.inputQty, 0);
  assert.equal(step.processedQty, 0);
  assert.equal(step.goodOutputQty, 0);
  assert.equal(step.defectOutputQty, 0);
  assert.equal(step.releasedGoodQty, 0);
}

async function cleanupWorkOrder(workOrderId: string) {
  const route = await prisma.workOrderProcessRoute.findUnique({
    where: { workOrderId },
    select: { id: true },
  });
  const pools = await prisma.processLaborPool.findMany({
    where: { workOrderId },
    select: { id: true },
  });
  const poolIds = pools.map(item => item.id);
  if (poolIds.length) {
    await prisma.processLaborClaim.deleteMany({ where: { poolId: { in: poolIds } } });
  }
  await prisma.processLaborPool.deleteMany({ where: { workOrderId } });
  await prisma.processCompletionCoverage.deleteMany({
    where: {
      OR: [
        { reportCompletion: { workOrderId } },
        { triggerCompletion: { workOrderId } },
      ],
    },
  });
  await prisma.processQuantityMovement.deleteMany({ where: { workOrderId } });
  await prisma.processActionConsumption.deleteMany({
    where: { step: { route: { workOrderId } } },
  });
  await prisma.processCompletionParticipant.deleteMany({ where: { completion: { workOrderId } } });
  await prisma.processCompletion.deleteMany({ where: { workOrderId } });
  if (route) await prisma.processRouteActivity.deleteMany({ where: { routeId: route.id } });
  const changes = await prisma.processRouteChange.findMany({
    where: { workOrderId },
    select: { id: true, changeRequestId: true },
  });
  const changeIds = changes.map(item => item.id);
  if (changeIds.length) {
    await prisma.processSupplementObligation.deleteMany({ where: { changeId: { in: changeIds } } });
    await prisma.processRouteChangeDiff.deleteMany({ where: { changeId: { in: changeIds } } });
    await prisma.processRouteChangeOutbox.deleteMany({ where: { changeId: { in: changeIds } } });
    await prisma.processRouteChangeEvent.deleteMany({ where: { changeId: { in: changeIds } } });
    await prisma.processRouteChange.deleteMany({ where: { id: { in: changeIds } } });
    await prisma.changeRequest.deleteMany({
      where: { id: { in: changes.map(item => item.changeRequestId) } },
    });
  }
  await prisma.workOrder.deleteMany({ where: { id: workOrderId } });
}

test(
  'a supplemental first group remains zero after fulfillment and later normal first-group reporting',
  { skip: runDatabaseIntegration ? false : 'set RUN_DB_INTEGRATION=1 to use the configured database' },
  async () => {
    const prefix = `IT-SUP-FIRST-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const actor = await prisma.user.create({
      data: {
        username: `${prefix}-ADMIN`,
        passwordHash: 'integration-test-not-a-login-hash',
        displayName: `${prefix} administrator`,
        laborRole: 'ADMIN',
      },
      select: { id: true, username: true, displayName: true },
    });
    const employee = await prisma.employee.create({
      data: {
        employeeNo: `${prefix}-E`,
        name: `${prefix} operator`,
        department: PRODUCTION_DEPARTMENT,
        isActive: true,
        attendanceEnabled: true,
      },
    });
    const definitions = await Promise.all([
      prisma.processDefinition.create({
        data: { code: `${prefix}-A`, name: `${prefix} first`, stageGroup: 'frontend', sortOrder: 1 },
      }),
      prisma.processDefinition.create({
        data: { code: `${prefix}-B`, name: `${prefix} second`, stageGroup: 'backend', sortOrder: 2 },
      }),
      prisma.processDefinition.create({
        data: { code: `${prefix}-SUP`, name: `${prefix} supplement`, stageGroup: 'frontend', sortOrder: 3 },
      }),
    ]);
    let workOrderId = '';
    try {
      const order = await createRoute({
        prefix,
        actor,
        firstDefinition: definitions[0],
        secondDefinition: definitions[1],
      });
      workOrderId = order.id;
      assert.ok(order.processRoute);
      const [firstStep, secondStep] = order.processRoute.steps;
      // A downstream advance report makes the insertion retroactive while the
      // ordinary first group itself still has no quantity fact.
      await completeProcessStep({
        routeId: order.processRoute.id,
        stepId: secondStep.id,
        processedQty: 1,
        defectQty: 0,
        workDate,
        employeeIds: [employee.id],
        requireParticipants: true,
        allowAdvanceReporting: true,
        idempotencyKey: `${prefix}-advance-second`,
        expectedRouteVersion: 0,
        userId: actor.id,
        actor: actor.displayName || actor.username,
      });
      const obligation = await insertSupplement({
        prefix,
        actor,
        workOrderId,
        routeId: order.processRoute.id,
        routeVersion: 1,
        targetStepId: firstStep.id,
        supplementDefinition: definitions[2],
        actionBased: true,
      });
      const fulfilled = await completeProcessSupplementObligation({
        obligationId: obligation.id,
        routeId: order.processRoute.id,
        expectedRouteVersion: 2,
        processedQty: 10,
        defectQty: 0,
        reportedUnitQty: 33,
        reportedDefectUnitQty: 3,
        workDate,
        employeeIds: [employee.id],
        idempotencyKey: `${prefix}-complete-supplement`,
        expectedVersion: 0,
        userId: actor.id,
        actor: actor.displayName || actor.username,
      });
      assert.equal(fulfilled.status, 'FULFILLED');

      const [storedActionObligation, actionCompletion, actionContext] = await Promise.all([
        prisma.processSupplementObligation.findUniqueOrThrow({ where: { id: obligation.id } }),
        prisma.processCompletion.findUniqueOrThrow({
          where: { id: fulfilled.completionId },
          include: { laborPool: true },
        }),
        loadProcessCompletionContext(order.processRoute.id, obligation.displayStepId, {
          allowAdvanceReporting: true,
          allowCompletedSelection: true,
        }),
      ]);
      assert.equal(storedActionObligation.reportQuantityBasis, 'action');
      assert.equal(storedActionObligation.reportedUnitQty, 33);
      assert.equal(storedActionObligation.reportedGoodUnitQty, 30);
      assert.equal(storedActionObligation.reportedDefectUnitQty, 3);
      assert.equal(actionCompletion.principalEmployeeId, employee.id);
      assert.equal(actionCompletion.laborPool?.eligibleQty, 33);
      assert.equal(actionCompletion.laborPool?.totalStandardLaborMilliseconds, 99_000n);
      assert.equal(actionContext.step.reportQuantityBasis, 'action');
      assert.equal(actionContext.reportTargetQty, 30);

      const normalCompletion = await completeProcessStep({
        routeId: order.processRoute.id,
        stepId: firstStep.id,
        processedQty: 10,
        defectQty: 0,
        workDate,
        employeeIds: [employee.id],
        requireParticipants: true,
        idempotencyKey: `${prefix}-complete-normal-first`,
        expectedRouteVersion: 3,
        userId: actor.id,
        actor: actor.displayName || actor.username,
      });
      assert.ok(normalCompletion.goodTransferredQty >= 10);

      await assertSupplementQuantityLedgerIsZero(obligation.displayStepId);
      const [storedFirst, storedSecond] = await Promise.all([
        prisma.workOrderProcessStep.findUniqueOrThrow({ where: { id: firstStep.id } }),
        prisma.workOrderProcessStep.findUniqueOrThrow({ where: { id: secondStep.id } }),
      ]);
      assert.equal(storedFirst.inputQty, 10);
      assert.equal(storedFirst.processedQty, 10);
      assert.equal(storedSecond.inputQty, 10);

      const supplementPreview = await previewProcessCompletionWithdrawal(
        order.processRoute.id,
        fulfilled.completionId,
      );
      assert.equal(supplementPreview.canWithdraw, true);
      const withdrawnSupplement = await withdrawProcessCompletion({
        routeId: order.processRoute.id,
        completionId: fulfilled.completionId,
        expectedRouteVersion: normalCompletion.routeVersion,
        category: 'REPORTING_ERROR',
        reason: '',
        idempotencyKey: `${prefix}-withdraw-supplement`,
        userId: actor.id,
        actor: actor.displayName || actor.username,
      });
      assert.equal(withdrawnSupplement.status, 'WITHDRAWN');
      const [reopenedObligation, reopenedSupplementStep] = await Promise.all([
        prisma.processSupplementObligation.findUniqueOrThrow({ where: { id: obligation.id } }),
        prisma.workOrderProcessStep.findUniqueOrThrow({ where: { id: obligation.displayStepId } }),
      ]);
      assert.equal(reopenedObligation.status, 'ACTIVE');
      assert.equal(reopenedObligation.reportedQty, 0);
      assert.equal(reopenedSupplementStep.status, 'current');
      await assertSupplementQuantityLedgerIsZero(obligation.displayStepId);
    } finally {
      if (workOrderId) await cleanupWorkOrder(workOrderId);
      await prisma.processDefinition.deleteMany({ where: { id: { in: definitions.map(item => item.id) } } });
      await prisma.employee.deleteMany({ where: { id: employee.id } });
      await prisma.user.deleteMany({ where: { id: actor.id } });
    }
  },
);

for (const scenario of ['last-supplement', 'partial-supplement', 'multiple-supplements', 'quantity-gap', 'active-branch',
  'ancestor-closure', 'finished-good-gap', 'deferred-batch', 'legacy-recovery', 'recovery-action-gap', 'concurrent-recovery'] as const) {
  test(
    `ordinary reporting across a supplemental middle group closes safely: ${scenario}`,
    { skip: runDatabaseIntegration ? false : 'set RUN_DB_INTEGRATION=1 to use the configured database' },
    async () => {
      const prefix = `IT-SUP-MIDDLE-${Date.now()}-${randomUUID().slice(0, 8)}`;
      const actor = await prisma.user.create({
        data: {
          username: `${prefix}-ADMIN`,
          passwordHash: 'integration-test-not-a-login-hash',
          displayName: `${prefix} administrator`,
          laborRole: 'ADMIN',
        },
        select: { id: true, username: true, displayName: true },
      });
      const employee = await prisma.employee.create({
        data: {
          employeeNo: `${prefix}-E`,
          name: `${prefix} operator`,
          department: PRODUCTION_DEPARTMENT,
          isActive: true,
          attendanceEnabled: true,
        },
      });
      const definitions = await Promise.all([
        prisma.processDefinition.create({
          data: { code: `${prefix}-A`, name: `${prefix} first`, stageGroup: 'frontend', sortOrder: 1 },
        }),
        prisma.processDefinition.create({
          data: { code: `${prefix}-B`, name: `${prefix} second`, stageGroup: 'backend', sortOrder: 2 },
        }),
        prisma.processDefinition.create({
          data: { code: `${prefix}-SUP`, name: `${prefix} supplement`, stageGroup: 'backend', sortOrder: 3 },
        }),
      ]);
      let workOrderId = '';
      let branchWorkOrderId = '';
      let parentWorkOrderId = '';
      let dailyPlanId = '';
      let dailyTaskId = '';
      let teamId = '';
      try {
        const order = await createRoute({
          prefix,
          actor,
          firstDefinition: definitions[0],
          secondDefinition: definitions[1],
        });
        workOrderId = order.id;
        assert.ok(order.processRoute);
        const [firstStep, secondStep] = order.processRoute.steps;
        if (scenario === 'deferred-batch') {
          await prisma.workOrderProcessStep.update({ where: { id: secondStep.id }, data: { timeBasis: 'per_batch' } });
        }
        const firstPartial = await completeProcessStep({
          routeId: order.processRoute.id,
          stepId: firstStep.id,
          processedQty: 4,
          defectQty: 0,
          workDate,
          employeeIds: [employee.id],
          requireParticipants: true,
          idempotencyKey: `${prefix}-complete-normal-first-partial`,
          expectedRouteVersion: 0,
          userId: actor.id,
          actor: actor.displayName || actor.username,
        });
        assert.equal(firstPartial.goodTransferredQty, 4);

        await completeProcessStep({
          routeId: order.processRoute.id,
          stepId: secondStep.id,
          processedQty: 1,
          defectQty: 0,
          workDate,
          employeeIds: [employee.id],
          requireParticipants: true,
          idempotencyKey: `${prefix}-complete-normal-second-partial`,
          expectedRouteVersion: 1,
          userId: actor.id,
          actor: actor.displayName || actor.username,
        });

        const obligation = await insertSupplement({
          prefix,
          actor,
          workOrderId,
          routeId: order.processRoute.id,
          routeVersion: 2,
          targetStepId: secondStep.id,
          supplementDefinition: definitions[2],
          actionBased: scenario === 'recovery-action-gap',
        });
        const secondPartial = await completeProcessStep({
          routeId: order.processRoute.id,
          stepId: firstStep.id,
          processedQty: 6,
          defectQty: 0,
          workDate,
          employeeIds: [employee.id],
          requireParticipants: true,
          idempotencyKey: `${prefix}-complete-normal-first-rest`,
          expectedRouteVersion: 3,
          userId: actor.id,
          actor: actor.displayName || actor.username,
        });
        assert.equal(secondPartial.goodTransferredQty, 6);

        await assertSupplementQuantityLedgerIsZero(obligation.displayStepId);
        const storedSecond = await prisma.workOrderProcessStep.findUniqueOrThrow({
          where: { id: secondStep.id },
        });
        assert.equal(storedSecond.inputQty, 10);
        assert.equal(
          await prisma.processQuantityMovement.aggregate({
            where: { workOrderId, targetStepId: secondStep.id, type: 'GOOD_TRANSFER' },
            _sum: { quantity: true },
          }).then(result => result._sum.quantity || 0),
          10,
        );
        assert.equal(
          await prisma.processQuantityMovement.count({
            where: { workOrderId, targetStepId: obligation.displayStepId },
          }),
          0,
        );

        const downstreamWhileSupplementActive = await completeProcessStep({
          routeId: order.processRoute.id,
          stepId: secondStep.id,
          processedQty: scenario === 'quantity-gap' ? 8 : 9,
          defectQty: 0,
          workDate,
          employeeIds: [employee.id],
          requireParticipants: true,
          allowAdvanceReporting: true,
          idempotencyKey: `${prefix}-complete-normal-second-rest-before-supplement`,
          expectedRouteVersion: 4,
          userId: actor.id,
          actor: actor.displayName || actor.username,
        });
        assert.equal(downstreamWhileSupplementActive.routeCompleted, false);
        assert.equal(downstreamWhileSupplementActive.pendingCoverageQty, 0);
        const stillOpenObligation = await prisma.processSupplementObligation.findUniqueOrThrow({
          where: { id: obligation.id },
        });
        assert.equal(stillOpenObligation.status, 'ACTIVE');
        assert.equal(stillOpenObligation.reportedQty, 0);
        assert.equal((await recoverStaleSupplementRouteCompletions({ routeId: order.processRoute.id })).scanned, 0);

        if (scenario === 'active-branch') {
          const branch = await prisma.workOrder.create({
            data: {
              code: `${prefix}-BRANCH`, productName: 'unfinished rework branch', parentWorkOrderId: workOrderId,
              branchType: 'REWORK', branchStatus: 'OPEN',
              rootWorkOrderId: workOrderId, originCompletionId: firstPartial.completionId,
              originStepId: firstStep.id, branchSequence: 1,
              productionTargetQty: 1, uncompletedQty: '1', completedQty: '0',
              planType: 'managed_plan', stage: 'frontend', status: 'processing',
            },
          });
          branchWorkOrderId = branch.id;
        }
        if (scenario === 'finished-good-gap') {
          await prisma.workOrder.update({ where: { id: workOrderId }, data: { completedQty: '9' } });
        }
        if (scenario === 'ancestor-closure') {
          const parent = await prisma.workOrder.create({
            data: {
              code: `${prefix}-PARENT`, productName: 'already credited parent',
              productionTargetQty: 10, uncompletedQty: '10', completedQty: '10',
              planType: 'managed_plan', stage: 'backend', status: 'processing',
              processRoute: { create: { templateName: 'completed parent route', templateVersion: 1, status: 'completed' } },
            },
          });
          parentWorkOrderId = parent.id;
          await prisma.workOrder.update({
            where: { id: workOrderId }, data: {
              parentWorkOrderId: parent.id, rootWorkOrderId: parent.id,
              originCompletionId: firstPartial.completionId, originStepId: firstStep.id, branchSequence: 1,
              branchType: 'SCRAP_REPLENISH', branchStatus: 'OPEN',
            },
          });
        }

        let supplementRouteVersion = 5;
        let supplementVersion = 0;
        let additionalObligationId = '';
        if (scenario === 'multiple-supplements') {
          const definition = await prisma.processDefinition.create({
            data: { code: `${prefix}-SUP2`, name: `${prefix} second supplement`, stageGroup: 'backend', sortOrder: 4 },
          });
          definitions.push(definition);
          const additional = await insertSupplement({
            prefix: `${prefix}-second`, actor, workOrderId, routeId: order.processRoute.id,
            routeVersion: supplementRouteVersion++, targetStepId: secondStep.id, supplementDefinition: definition,
          });
          additionalObligationId = additional.id;
        }
        if (scenario === 'partial-supplement') {
          const partial = await completeProcessSupplementObligation({
            obligationId: obligation.id, routeId: order.processRoute.id,
            expectedRouteVersion: supplementRouteVersion++, expectedVersion: supplementVersion++,
            processedQty: 4, defectQty: 0, workDate, employeeIds: [employee.id],
            idempotencyKey: `${prefix}-partial-supplement`, userId: actor.id, actor: actor.username,
          });
          assert.equal(partial.status, 'ACTIVE');
          assert.equal((await prisma.workOrderProcessRoute.findUniqueOrThrow({ where: { id: order.processRoute.id } })).status, 'in_progress');
        }

        const quantitiesBeforeSupplement = await prisma.workOrder.findUniqueOrThrow({
          where: { id: workOrderId },
          select: { completedQty: true, frontendTransferredQty: true },
        });
        const movementsBeforeSupplement = await prisma.processQuantityMovement.count({ where: { workOrderId } });

        const fulfilled = await completeProcessSupplementObligation({
          obligationId: obligation.id,
          routeId: order.processRoute.id,
          expectedRouteVersion: supplementRouteVersion,
          processedQty: scenario === 'partial-supplement' ? 6 : 10,
          defectQty: 0,
          ...(scenario === 'recovery-action-gap' ? { reportedUnitQty: 33, reportedDefectUnitQty: 3 } : {}),
          workDate,
          employeeIds: [employee.id],
          idempotencyKey: `${prefix}-complete-supplement`,
          expectedVersion: supplementVersion,
          userId: actor.id,
          actor: actor.displayName || actor.username,
        });
        assert.equal(fulfilled.status, 'FULFILLED');
        await assertSupplementQuantityLedgerIsZero(obligation.displayStepId);
        const closedRoute = await prisma.workOrderProcessRoute.findUniqueOrThrow({
          where: { id: order.processRoute.id },
          include: { steps: { where: { retiredAt: null } }, workOrder: true },
        });
        const routeShouldClose = scenario !== 'quantity-gap' && scenario !== 'multiple-supplements';
        const orderShouldClose = routeShouldClose && scenario !== 'active-branch' && scenario !== 'finished-good-gap';
        assert.equal(closedRoute.steps.find(step => step.id === secondStep.id)?.status, routeShouldClose ? 'completed' : 'current');
        assert.equal(closedRoute.steps.every(step => ['completed', 'skipped'].includes(step.status)), routeShouldClose);
        assert.equal(closedRoute.status, routeShouldClose ? 'completed' : 'in_progress');
        assert.equal(closedRoute.version, supplementRouteVersion + 1);
        assert.equal(closedRoute.workOrder.stage, orderShouldClose ? 'completed' : 'backend');
        assert.equal(closedRoute.workOrder.status, orderShouldClose ? 'done' : 'processing');
        assert.equal(Boolean(closedRoute.workOrder.completedAt), orderShouldClose);
        assert.equal(closedRoute.workOrder.completedQty, quantitiesBeforeSupplement.completedQty);
        assert.equal(closedRoute.workOrder.frontendTransferredQty, quantitiesBeforeSupplement.frontendTransferredQty);
        assert.equal(await prisma.processQuantityMovement.count({ where: { workOrderId } }), movementsBeforeSupplement);
        if (scenario === 'last-supplement') {
          const replay = await completeProcessSupplementObligation({
            obligationId: obligation.id, routeId: order.processRoute.id,
            expectedRouteVersion: supplementRouteVersion, expectedVersion: supplementVersion,
            processedQty: 10, defectQty: 0, workDate, employeeIds: [employee.id],
            idempotencyKey: `${prefix}-complete-supplement`, userId: actor.id, actor: actor.displayName || actor.username,
          });
          assert.equal(replay.completionId, fulfilled.completionId);
          assert.equal((await prisma.workOrderProcessRoute.findUniqueOrThrow({ where: { id: order.processRoute.id } })).version, closedRoute.version);
        }
        if (additionalObligationId) {
          await completeProcessSupplementObligation({
            obligationId: additionalObligationId, routeId: order.processRoute.id,
            expectedRouteVersion: closedRoute.version, expectedVersion: 0,
            processedQty: 10, defectQty: 0, workDate, employeeIds: [employee.id],
            idempotencyKey: `${prefix}-last-supplement`, userId: actor.id, actor: actor.username,
          });
          assert.equal((await prisma.workOrder.findUniqueOrThrow({ where: { id: workOrderId } })).stage, 'completed');
        }
        if (parentWorkOrderId) {
          const parent = await prisma.workOrder.findUniqueOrThrow({ where: { id: parentWorkOrderId } });
          assert.equal(parent.stage, 'completed');
          assert.equal(parent.completedQty, '10');
          assert.equal(closedRoute.workOrder.branchStatus, 'RESOLVED');
        }
        if (scenario === 'quantity-gap') {
          assert.equal((await recoverStaleSupplementRouteCompletions({ routeId: order.processRoute.id })).scanned, 0);
          const finalNormal = await completeProcessStep({
            routeId: order.processRoute.id, stepId: secondStep.id,
            processedQty: 1, defectQty: 0, workDate, employeeIds: [employee.id], requireParticipants: true,
            idempotencyKey: `${prefix}-last-normal`, expectedRouteVersion: closedRoute.version,
            userId: actor.id, actor: actor.username,
          });
          assert.equal(finalNormal.routeCompleted, true);
        }
        if (scenario === 'deferred-batch') {
          const pools = await prisma.processLaborPool.findMany({ where: { stepId: secondStep.id } });
          assert.equal(pools.length, 1);
          assert.equal(pools[0].totalStandardLaborMilliseconds, 2_000n);
        }
        if (['legacy-recovery', 'recovery-action-gap', 'concurrent-recovery'].includes(scenario)) {
          // Reproduce only the obsolete persisted status projection; all reports,
          // quantities and labor below were produced through the real services.
          await prisma.workOrderProcessStep.update({
            where: { id: secondStep.id }, data: { status: 'current', completedAt: null, completedById: null },
          });
          await prisma.workOrderProcessRoute.update({
            where: { id: order.processRoute.id }, data: { status: 'in_progress', completedAt: null },
          });
          await prisma.workOrder.update({
            where: { id: workOrderId }, data: { stage: 'backend', status: 'processing', completedAt: null },
          });
          if (scenario === 'legacy-recovery') {
            const team = await prisma.productionTeam.create({ data: { code: `${prefix}-TEAM`, name: `${prefix} team` } });
            teamId = team.id;
            const plan = await prisma.dailyProductionPlan.create({
              data: { workDate: new Date(workDate), shiftCode: 'DAY', teamId, status: 'IN_PROGRESS', createdById: actor.id, updatedById: actor.id },
            });
            dailyPlanId = plan.id;
            const task = await prisma.dailyProcessTask.create({
              data: {
                planId: plan.id, workDate: plan.workDate, shiftCode: plan.shiftCode,
                workOrderId, routeId: order.processRoute.id, stepId: secondStep.id,
                routeVersion: closedRoute.version, processCode: secondStep.processCode,
                processName: secondStep.processName, stageGroup: secondStep.stageGroup,
                position: 3, sequenceGroup: 3, standardSource: 'integration_test',
                timeBasis: 'per_unit', unitLabel: 'piece', standardMillisecondsPerUnit: 2_000,
                plannedQty: 10, availableQty: 0, status: 'WAITING_UPSTREAM',
              },
            });
            dailyTaskId = task.id;
          }
          const factSnapshot = async () => ({
            completions: await prisma.processCompletion.findMany({ where: { workOrderId }, orderBy: { id: 'asc' } }),
            pools: await prisma.processLaborPool.findMany({ where: { workOrderId }, orderBy: { id: 'asc' } }),
            movements: await prisma.processQuantityMovement.findMany({ where: { workOrderId }, orderBy: { id: 'asc' } }),
            quantities: await prisma.workOrder.findUniqueOrThrow({
              where: { id: workOrderId }, select: { completedQty: true, frontendTransferredQty: true },
            }),
          });
          const factsBefore = await factSnapshot();
          if (scenario === 'legacy-recovery') {
            await prisma.workOrder.update({ where: { id: workOrderId }, data: { planClearedAt: new Date() } });
            assert.equal((await recoverStaleSupplementRouteCompletions({ routeId: order.processRoute.id })).scanned, 0);
            await prisma.workOrder.update({ where: { id: workOrderId }, data: { planClearedAt: null } });
          }
          if (scenario === 'recovery-action-gap') {
            await prisma.processSupplementObligation.update({ where: { id: obligation.id }, data: { reportedGoodUnitQty: 29, reportedDefectUnitQty: 4 } });
            const blocked = await recoverStaleSupplementRouteCompletions({ routeId: order.processRoute.id });
            assert.equal(blocked.repairedRouteIds.length, 0);
            assert.equal(blocked.skipped, 1);
            await prisma.processSupplementObligation.update({ where: { id: obligation.id }, data: { reportedGoodUnitQty: 30, reportedDefectUnitQty: 3 } });
          }
          const results = await Promise.all(Array.from({ length: scenario === 'concurrent-recovery' ? 2 : 1 }, () => (
            recoverStaleSupplementRouteCompletions({ routeId: order.processRoute!.id })
          )));
          assert.equal(results.reduce((count, result) => count + result.repairedRouteIds.length, 0), 1);
          const recovered = await prisma.workOrderProcessRoute.findUniqueOrThrow({
            where: { id: order.processRoute.id }, include: { workOrder: true, steps: true },
          });
          assert.equal(recovered.status, 'completed');
          assert.equal(recovered.version, closedRoute.version + 1);
          assert.ok(recovered.steps.every(step => ['completed', 'skipped'].includes(step.status)));
          assert.equal(recovered.workOrder.stage, 'completed');
          assert.deepEqual(await factSnapshot(), factsBefore);
          if (dailyTaskId) {
            const task = await prisma.dailyProcessTask.findUniqueOrThrow({ where: { id: dailyTaskId } });
            assert.equal(task.status, 'COMPLETED');
            assert.equal(task.routeVersion, recovered.version);
            assert.equal(await prisma.operationLog.count({ where: { targetId: dailyTaskId, userId: null } }), 1);
            assert.equal(await prisma.dailyPlanRevision.count({ where: { taskId: dailyTaskId } }), 0);
          }
          const again = await recoverStaleSupplementRouteCompletions({ routeId: order.processRoute.id });
          assert.equal(again.scanned, 0);
          assert.equal(await prisma.processRouteActivity.count({
            where: { routeId: order.processRoute.id, action: 'recover_supplement_route_completion' },
          }), 1);
          await prisma.operationLog.deleteMany({ where: { targetId: order.processRoute.id } });
        }
      } finally {
        if (dailyTaskId) {
          await prisma.operationLog.deleteMany({ where: { targetId: dailyTaskId } });
          await prisma.dailyProcessTask.delete({ where: { id: dailyTaskId } });
        }
        if (dailyPlanId) await prisma.dailyProductionPlan.delete({ where: { id: dailyPlanId } });
        if (teamId) await prisma.productionTeam.delete({ where: { id: teamId } });
        if (branchWorkOrderId) await prisma.workOrder.delete({ where: { id: branchWorkOrderId } });
        if (parentWorkOrderId && workOrderId) {
          await prisma.workOrder.update({ where: { id: workOrderId }, data: {
            parentWorkOrderId: null, rootWorkOrderId: null, originCompletionId: null,
            originStepId: null, branchSequence: null, branchType: null, branchStatus: null,
          } });
        }
        if (workOrderId) await cleanupWorkOrder(workOrderId);
        if (parentWorkOrderId) await cleanupWorkOrder(parentWorkOrderId);
        await prisma.processDefinition.deleteMany({ where: { id: { in: definitions.map(item => item.id) } } });
        await prisma.employee.deleteMany({ where: { id: employee.id } });
        await prisma.user.deleteMany({ where: { id: actor.id } });
      }
    },
  );
}
