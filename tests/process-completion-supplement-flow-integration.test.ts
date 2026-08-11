import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { completeProcessStep } from '../lib/process-completion-service';
import {
  activateProcessRouteChange,
  completeProcessSupplementObligation,
  createProcessRouteChangeProposal,
  reviewProcessRouteChange,
  submitProcessRouteChange,
} from '../lib/process-route-change-service';
import { prisma } from '../lib/prisma';
import { PRODUCTION_DEPARTMENT } from '../lib/production-workforce';

const runDatabaseIntegration = process.env.RUN_DB_INTEGRATION === '1';
const workDate = '2026-08-11';

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
      });
      const fulfilled = await completeProcessSupplementObligation({
        obligationId: obligation.id,
        routeId: order.processRoute.id,
        expectedRouteVersion: 2,
        processedQty: 10,
        defectQty: 0,
        workDate,
        employeeIds: [employee.id],
        idempotencyKey: `${prefix}-complete-supplement`,
        expectedVersion: 0,
        userId: actor.id,
        actor: actor.displayName || actor.username,
      });
      assert.equal(fulfilled.status, 'FULFILLED');

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
    } finally {
      if (workOrderId) await cleanupWorkOrder(workOrderId);
      await prisma.processDefinition.deleteMany({ where: { id: { in: definitions.map(item => item.id) } } });
      await prisma.employee.deleteMany({ where: { id: employee.id } });
      await prisma.user.deleteMany({ where: { id: actor.id } });
    }
  },
);

test(
  'ordinary upstream reporting skips an active supplemental middle group and feeds the next normal group',
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

      const fulfilled = await completeProcessSupplementObligation({
        obligationId: obligation.id,
        routeId: order.processRoute.id,
        expectedRouteVersion: 4,
        processedQty: 10,
        defectQty: 0,
        workDate,
        employeeIds: [employee.id],
        idempotencyKey: `${prefix}-complete-supplement`,
        expectedVersion: 0,
        userId: actor.id,
        actor: actor.displayName || actor.username,
      });
      assert.equal(fulfilled.status, 'FULFILLED');
      await assertSupplementQuantityLedgerIsZero(obligation.displayStepId);
    } finally {
      if (workOrderId) await cleanupWorkOrder(workOrderId);
      await prisma.processDefinition.deleteMany({ where: { id: { in: definitions.map(item => item.id) } } });
      await prisma.employee.deleteMany({ where: { id: employee.id } });
      await prisma.user.deleteMany({ where: { id: actor.id } });
    }
  },
);
