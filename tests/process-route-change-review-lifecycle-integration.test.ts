import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { ProcessRouteChangeStatus } from '@prisma/client';
import {
  activateProcessRouteChange,
  createProcessRouteChangeProposal,
  reevaluateProcessRouteChange,
  reviewProcessRouteChange,
  submitProcessRouteChange,
} from '../lib/process-route-change-service';
import { prisma } from '../lib/prisma';

const runDatabaseIntegration = process.env.RUN_DB_INTEGRATION === '1';

test(
  'route changes can re-evaluate a stale approval and reject before activation',
  { skip: runDatabaseIntegration ? false : 'set RUN_DB_INTEGRATION=1 to use the configured database' },
  async () => {
    const prefix = `IT-RC-LIFE-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const actor = await prisma.user.create({
      data: {
        username: `${prefix}-ADMIN`,
        passwordHash: 'integration-test-not-a-login-hash',
        displayName: `${prefix} administrator`,
        laborRole: 'ADMIN',
      },
      select: { id: true, username: true, displayName: true },
    });
    const definitions = await Promise.all([
      prisma.processDefinition.create({
        data: { code: `${prefix}-BASE`, name: `${prefix} base`, stageGroup: 'frontend', sortOrder: 1 },
      }),
      prisma.processDefinition.create({
        data: { code: `${prefix}-A`, name: `${prefix} insert A`, stageGroup: 'frontend', sortOrder: 2 },
      }),
      prisma.processDefinition.create({
        data: { code: `${prefix}-B`, name: `${prefix} insert B`, stageGroup: 'frontend', sortOrder: 3 },
      }),
    ]);
    let workOrderId = '';
    let routeId = '';
    try {
      const order = await prisma.workOrder.create({
        data: {
          code: `${prefix}-ORDER`,
          customerName: 'integration-test',
          productName: 'route-change lifecycle',
          stage: 'frontend',
          status: 'processing',
          processName: definitions[0].name,
          uncompletedQty: '30',
          productionTargetQty: 30,
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
              routeSource: 'integration_test',
              steps: {
                create: {
                  processDefinitionId: definitions[0].id,
                  processCode: definitions[0].code,
                  processName: definitions[0].name,
                  stageGroup: definitions[0].stageGroup,
                  position: 1,
                  sequenceGroup: 1,
                  standardSource: 'integration_test',
                  timeBasis: 'per_unit',
                  unitLabel: 'piece',
                  standardMillisecondsPerUnit: 1_000,
                  setupMilliseconds: 0,
                  unitsPerProduct: 1,
                  countsForEfficiency: true,
                  inputQty: 30,
                  status: 'current',
                },
              },
            },
          },
        },
        include: { processRoute: { include: { steps: true } } },
      });
      workOrderId = order.id;
      assert.ok(order.processRoute);
      routeId = order.processRoute.id;
      const baseStep = order.processRoute.steps[0];
      const proposal = async (suffix: string, definitionIndex: 1 | 2) => {
        const created = await createProcessRouteChangeProposal({
          workOrderId,
          routeId,
          title: `${prefix} ${suffix}`,
          scope: 'CURRENT_WORK_ORDER_ONLY',
          diffs: [{
            kind: 'INSERT_STEP',
            processDefinitionId: definitions[definitionIndex].id,
            targetStepId: baseStep.id,
            afterData: {
              processName: definitions[definitionIndex].name,
              standardMillisecondsPerUnit: definitionIndex === 1 ? 2_000 : 3_000,
              requiredQty: 30,
            },
          }],
          idempotencyKey: `${prefix}-${suffix}-create`,
          expectedVersion: 0,
          userId: actor.id,
          actor: actor.displayName || actor.username,
        });
        return submitProcessRouteChange({
          changeId: created.id,
          idempotencyKey: `${prefix}-${suffix}-submit`,
          expectedVersion: created.version,
          userId: actor.id,
          actor: actor.displayName || actor.username,
        });
      };

      const staleSubmitted = await proposal('stale', 1);
      const staleApproved = await reviewProcessRouteChange({
        changeId: staleSubmitted.id,
        decision: 'approve',
        expectedVersion: staleSubmitted.version,
        idempotencyKey: `${prefix}-stale-approve`,
        userId: actor.id,
        actor: actor.displayName || actor.username,
      });
      const firstSubmitted = await proposal('first', 2);
      const firstApproved = await reviewProcessRouteChange({
        changeId: firstSubmitted.id,
        decision: 'approve',
        expectedVersion: firstSubmitted.version,
        idempotencyKey: `${prefix}-first-approve`,
        userId: actor.id,
        actor: actor.displayName || actor.username,
      });
      await activateProcessRouteChange({
        changeId: firstApproved.id,
        expectedVersion: firstApproved.version,
        expectedRouteVersion: 0,
        idempotencyKey: `${prefix}-first-activate`,
        userId: actor.id,
        actor: actor.displayName || actor.username,
      });

      await assert.rejects(
        () => activateProcessRouteChange({
          changeId: staleApproved.id,
          expectedVersion: staleApproved.version,
          expectedRouteVersion: 1,
          idempotencyKey: `${prefix}-stale-activate`,
          userId: actor.id,
          actor: actor.displayName || actor.username,
        }),
        (error: unknown) => (
          error instanceof Error
          && 'code' in error
          && error.code === 'PROCESS_ROUTE_VERSION_CONFLICT'
        ),
      );
      const reevaluated = await reevaluateProcessRouteChange({
        changeId: staleApproved.id,
        expectedVersion: staleApproved.version,
        idempotencyKey: `${prefix}-stale-reevaluate`,
        userId: actor.id,
        actor: actor.displayName || actor.username,
      });
      assert.equal(reevaluated.status, ProcessRouteChangeStatus.SUBMITTED);
      assert.equal(reevaluated.baseRouteVersion, 1);
      assert.equal(reevaluated.currentRouteVersion, 1);
      assert.equal(reevaluated.routeVersionConflict, false);
      assert.equal(reevaluated.reviewDecision, null);
      assert.equal(reevaluated.reviewedAt, null);

      const reapproved = await reviewProcessRouteChange({
        changeId: reevaluated.id,
        decision: 'approve',
        expectedVersion: reevaluated.version,
        idempotencyKey: `${prefix}-stale-reapprove`,
        userId: actor.id,
        actor: actor.displayName || actor.username,
      });
      const rejected = await reviewProcessRouteChange({
        changeId: reapproved.id,
        decision: 'reject',
        expectedVersion: reapproved.version,
        reviewReason: 'route changed; withdraw approval',
        idempotencyKey: `${prefix}-stale-reject-after-approval`,
        userId: actor.id,
        actor: actor.displayName || actor.username,
      });
      assert.equal(rejected.status, ProcessRouteChangeStatus.REJECTED);
      assert.equal(rejected.reviewDecision, 'REJECTED');
      assert.equal(rejected.reviewNote, 'route changed; withdraw approval');
      const rejectEvent = await prisma.processRouteChangeEvent.findFirstOrThrow({
        where: { changeId: rejected.id, action: 'reject' },
      });
      assert.equal(rejectEvent.fromStatus, ProcessRouteChangeStatus.APPROVED);
      assert.equal(rejectEvent.toStatus, ProcessRouteChangeStatus.REJECTED);
    } finally {
      if (workOrderId) {
        const changes = await prisma.processRouteChange.findMany({
          where: { workOrderId },
          select: { id: true, changeRequestId: true },
        });
        const changeIds = changes.map(item => item.id);
        if (changeIds.length) {
          await prisma.processSupplementObligation.deleteMany({ where: { changeId: { in: changeIds } } });
          await prisma.processRouteChangeOutbox.deleteMany({ where: { changeId: { in: changeIds } } });
          await prisma.processRouteChangeEvent.deleteMany({ where: { changeId: { in: changeIds } } });
          await prisma.processRouteChangeDiff.deleteMany({ where: { changeId: { in: changeIds } } });
          await prisma.processRouteChange.deleteMany({ where: { id: { in: changeIds } } });
          await prisma.changeRequest.deleteMany({ where: { id: { in: changes.map(item => item.changeRequestId) } } });
        }
        await prisma.workOrder.deleteMany({ where: { id: workOrderId } });
      }
      await prisma.processDefinition.deleteMany({ where: { id: { in: definitions.map(item => item.id) } } });
      await prisma.user.deleteMany({ where: { id: actor.id } });
    }
  },
);
