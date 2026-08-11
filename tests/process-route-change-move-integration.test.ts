import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import {
  activateProcessRouteChange,
  createProcessRouteChangeProposal,
  ProcessRouteChangeServiceError,
  reviewProcessRouteChange,
  submitProcessRouteChange,
} from '../lib/process-route-change-service';
import { prisma } from '../lib/prisma';

const runDatabaseIntegration = process.env.RUN_DB_INTEGRATION === '1';

async function approveMove(input: {
  prefix: string;
  routeId: string;
  routeVersion: number;
  userId: string;
  stepId: string;
  beforeStepId: string | null;
  position: number;
}) {
  const created = await createProcessRouteChangeProposal({
    routeId: input.routeId,
    changeType: 'MOVE_STEP',
    moveStepId: input.stepId,
    moveBeforeStepId: input.beforeStepId,
    movePosition: input.position,
    title: 'Move a complete sequence group',
    reason: 'The field route order is incorrect',
    scope: 'CURRENT_WORK_ORDER_ONLY',
    expectedVersion: input.routeVersion,
    expectedRouteVersion: input.routeVersion,
    userId: input.userId,
    actor: 'integration test',
    idempotencyKey: `${input.prefix}-create-${randomUUID()}`,
  });
  const submitted = await submitProcessRouteChange({
    changeId: created.id,
    expectedVersion: created.version,
    userId: input.userId,
    actor: 'integration test',
    idempotencyKey: `${input.prefix}-submit-${randomUUID()}`,
  });
  const approved = await reviewProcessRouteChange({
    changeId: submitted.id,
    action: 'approve',
    expectedVersion: submitted.version,
    userId: input.userId,
    actor: 'integration test',
    idempotencyKey: `${input.prefix}-approve-${randomUUID()}`,
  });
  return approved;
}

async function cleanup(prefix: string, workOrderId: string, definitionIds: string[], userId: string) {
  const changes = await prisma.processRouteChange.findMany({
    where: { workOrderId },
    select: { id: true, changeRequestId: true },
  });
  const changeIds = changes.map(change => change.id);
  if (changeIds.length) {
    await prisma.processRouteChangeOutbox.deleteMany({ where: { changeId: { in: changeIds } } });
    await prisma.processRouteChangeEvent.deleteMany({ where: { changeId: { in: changeIds } } });
    await prisma.processRouteChangeDiff.deleteMany({ where: { changeId: { in: changeIds } } });
    await prisma.processRouteChange.deleteMany({ where: { id: { in: changeIds } } });
    await prisma.changeRequest.deleteMany({ where: { id: { in: changes.map(change => change.changeRequestId) } } });
  }
  await prisma.processQuantityMovement.deleteMany({ where: { workOrderId } });
  await prisma.processCompletion.deleteMany({ where: { workOrderId } });
  await prisma.workOrder.deleteMany({ where: { id: workOrderId } });
  await prisma.processDefinition.deleteMany({ where: { id: { in: definitionIds } } });
  await prisma.user.deleteMany({ where: { id: userId } });
  void prefix;
}

async function createRouteFixture(prefix: string) {
  const actor = await prisma.user.create({
    data: {
      username: `${prefix}-ADMIN`,
      passwordHash: 'integration-test-not-a-login-hash',
      displayName: `${prefix} administrator`,
      laborRole: 'ADMIN',
    },
  });
  const definitions = await Promise.all(['CUT', 'PRESS', 'INSPECT', 'PACK'].map((code, index) => (
    prisma.processDefinition.create({
      data: {
        code: `${prefix}-${code}`,
        name: `${prefix} ${code.toLowerCase()}`,
        stageGroup: index < 2 ? 'frontend' : 'backend',
        sortOrder: index + 1,
      },
    })
  )));
  const startedAt = new Date('2026-08-11T01:00:00.000Z');
  const order = await prisma.workOrder.create({
    data: {
      code: `${prefix}-ORDER`,
      customerName: 'integration-test',
      productName: 'route move product',
      stage: definitions[0].stageGroup,
      status: 'processing',
      processName: definitions[0].name,
      uncompletedQty: '10',
      productionTargetQty: 10,
      completedQty: '0',
      frontendTransferredQty: 0,
      planType: 'managed_plan',
      planActive: true,
      startedAt,
      processRoute: {
        create: {
          templateName: `${prefix} route`,
          templateVersion: 1,
          status: 'in_progress',
          version: 0,
          confirmedAt: startedAt,
          confirmedById: actor.id,
          startedAt,
          routeSource: 'integration_test',
          steps: {
            create: definitions.map((definition, index) => ({
              processDefinitionId: definition.id,
              processCode: definition.code,
              processName: definition.name,
              stageGroup: definition.stageGroup,
              position: index + 1,
              sequenceGroup: index + 1,
              standardSource: 'integration_test',
              timeBasis: 'per_unit',
              unitLabel: 'piece',
              standardMillisecondsPerUnit: (index + 1) * 1_000,
              setupMilliseconds: 0,
              unitsPerProduct: 1,
              countsForEfficiency: true,
              inputQty: index === 0 ? 10 : 0,
              status: index === 0 ? 'current' : 'pending',
              startedAt: index === 0 ? startedAt : null,
            })),
          },
        },
      },
    },
    include: { processRoute: { include: { steps: { orderBy: { position: 'asc' } } } } },
  });
  assert.ok(order.processRoute);
  return { actor, definitions, order, route: order.processRoute };
}

test(
  'MOVE_STEP transfers initialized current/input state when no production has been reported',
  { skip: runDatabaseIntegration ? false : 'set RUN_DB_INTEGRATION=1 to use the configured database' },
  async () => {
    const prefix = `IT-RCM-INIT-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const fixture = await createRouteFixture(prefix);
    try {
      const [cut, press] = fixture.route.steps;
      await prisma.workOrderProcessStep.update({ where: { id: cut.id }, data: { inputQty: 5 } });
      await assert.rejects(
        () => approveMove({
          prefix,
          routeId: fixture.route.id,
          routeVersion: 0,
          userId: fixture.actor.id,
          stepId: press.id,
          beforeStepId: cut.id,
          position: cut.position,
        }),
        (error: unknown) => error instanceof ProcessRouteChangeServiceError
          && error.status === 409
          && error.code === 'PROCESS_ROUTE_CHANGE_MOVE_QUANTITY_FACT_CONFLICT',
      );
      assert.equal(await prisma.processRouteChange.count({ where: { routeId: fixture.route.id } }), 0);
      await prisma.workOrderProcessStep.update({ where: { id: cut.id }, data: { inputQty: 10 } });
      const approved = await approveMove({
        prefix,
        routeId: fixture.route.id,
        routeVersion: 0,
        userId: fixture.actor.id,
        stepId: press.id,
        beforeStepId: cut.id,
        position: cut.position,
      });
      assert.equal(approved.payload.changeType, 'MOVE_STEP');
      assert.equal(approved.payload.moveStepId, press.id);
      const activated = await activateProcessRouteChange({
        changeId: approved.id,
        expectedVersion: approved.version,
        expectedRouteVersion: 0,
        userId: fixture.actor.id,
        actor: 'integration test',
        idempotencyKey: `${prefix}-activate`,
      });
      assert.equal(activated.status, 'ACTIVE');

      const steps = await prisma.workOrderProcessStep.findMany({
        where: { routeId: fixture.route.id },
        orderBy: [{ sequenceGroup: 'asc' }, { position: 'asc' }],
      });
      assert.deepEqual(steps.map(step => step.id), [press.id, cut.id, fixture.route.steps[2].id, fixture.route.steps[3].id]);
      assert.deepEqual(steps.map(step => [step.sequenceGroup, step.inputQty, step.status]), [
        [1, 10, 'current'],
        [2, 0, 'pending'],
        [3, 0, 'pending'],
        [4, 0, 'pending'],
      ]);
      assert.equal(steps[0].startedAt?.toISOString(), fixture.route.startedAt?.toISOString());
      assert.equal(steps[1].startedAt, null);
      const order = await prisma.workOrder.findUniqueOrThrow({ where: { id: fixture.order.id } });
      assert.equal(order.processName, press.processName);
      assert.equal(await prisma.processCompletion.count({ where: { routeId: fixture.route.id } }), 0);
      assert.equal(await prisma.processQuantityMovement.count({ where: { workOrderId: fixture.order.id } }), 0);
    } finally {
      await cleanup(prefix, fixture.order.id, fixture.definitions.map(item => item.id), fixture.actor.id);
    }
  },
);

test(
  'MOVE_STEP permits fact-free future groups but rejects a ledger fact appearing before activation',
  { skip: runDatabaseIntegration ? false : 'set RUN_DB_INTEGRATION=1 to use the configured database' },
  async () => {
    const prefix = `IT-RCM-FUTURE-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const fixture = await createRouteFixture(prefix);
    try {
      const [cut, press, inspect, pack] = fixture.route.steps;
      const completion = await prisma.processCompletion.create({
        data: {
          workOrderId: fixture.order.id,
          routeId: fixture.route.id,
          stepId: cut.id,
          workDate: new Date('2026-08-11T00:00:00.000Z'),
          processedQty: 10,
          goodQty: 10,
          defectQty: 0,
          routeVersion: 0,
          idempotencyKey: `${prefix}-completion`,
          standardSource: 'integration_test',
          timeBasis: 'per_unit',
          unitLabel: 'piece',
          standardMillisecondsPerUnit: 1_000,
          setupMilliseconds: 0,
          unitsPerProduct: 1,
          countsForEfficiency: true,
          createdById: fixture.actor.id,
        },
      });
      await prisma.processQuantityMovement.create({
        data: {
          completionId: completion.id,
          workOrderId: fixture.order.id,
          sourceStepId: cut.id,
          targetStepId: press.id,
          type: 'GOOD_TRANSFER',
          quantity: 10,
          sourceSequenceGroup: 1,
          targetSequenceGroup: 2,
          idempotencyKey: `${prefix}-movement`,
        },
      });
      await prisma.workOrderProcessStep.update({
        where: { id: cut.id },
        data: { processedQty: 10, goodOutputQty: 10, releasedGoodQty: 10, status: 'completed', completedAt: new Date() },
      });
      await prisma.workOrderProcessStep.update({
        where: { id: press.id },
        data: { inputQty: 10, status: 'current', startedAt: new Date() },
      });

      const approved = await approveMove({
        prefix,
        routeId: fixture.route.id,
        routeVersion: 0,
        userId: fixture.actor.id,
        stepId: pack.id,
        beforeStepId: inspect.id,
        position: inspect.position,
      });
      await activateProcessRouteChange({
        changeId: approved.id,
        expectedVersion: approved.version,
        expectedRouteVersion: 0,
        userId: fixture.actor.id,
        actor: 'integration test',
        idempotencyKey: `${prefix}-activate-safe`,
      });
      const safelyMoved = await prisma.workOrderProcessStep.findMany({
        where: { routeId: fixture.route.id },
        orderBy: [{ sequenceGroup: 'asc' }, { position: 'asc' }],
      });
      assert.deepEqual(safelyMoved.map(step => step.id), [cut.id, press.id, pack.id, inspect.id]);
      assert.equal(safelyMoved[1].inputQty, 10);

      const reverseApproved = await approveMove({
        prefix,
        routeId: fixture.route.id,
        routeVersion: 1,
        userId: fixture.actor.id,
        stepId: inspect.id,
        beforeStepId: pack.id,
        position: pack.position,
      });
      await prisma.processQuantityMovement.create({
        data: {
          completionId: completion.id,
          workOrderId: fixture.order.id,
          sourceStepId: cut.id,
          targetStepId: inspect.id,
          type: 'ADJUSTMENT',
          quantity: 1,
          sourceSequenceGroup: 1,
          targetSequenceGroup: 4,
          idempotencyKey: `${prefix}-concurrent-ledger`,
        },
      });
      const beforeRejectedActivation = await prisma.workOrderProcessStep.findMany({
        where: { routeId: fixture.route.id },
        orderBy: { position: 'asc' },
        select: { id: true, position: true, sequenceGroup: true },
      });
      await assert.rejects(
        () => activateProcessRouteChange({
          changeId: reverseApproved.id,
          expectedVersion: reverseApproved.version,
          expectedRouteVersion: 1,
          userId: fixture.actor.id,
          actor: 'integration test',
          idempotencyKey: `${prefix}-activate-conflict`,
        }),
        (error: unknown) => error instanceof ProcessRouteChangeServiceError
          && error.status === 409
          && error.code === 'PROCESS_ROUTE_CHANGE_MOVE_LEDGER_CONFLICT',
      );
      const afterRejectedActivation = await prisma.workOrderProcessStep.findMany({
        where: { routeId: fixture.route.id },
        orderBy: { position: 'asc' },
        select: { id: true, position: true, sequenceGroup: true },
      });
      assert.deepEqual(afterRejectedActivation, beforeRejectedActivation);
    } finally {
      await cleanup(prefix, fixture.order.id, fixture.definitions.map(item => item.id), fixture.actor.id);
    }
  },
);
