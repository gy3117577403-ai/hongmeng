import assert from 'node:assert/strict';
import test from 'node:test';
import { prisma } from '../lib/prisma';
import { productionWeekWhere } from '../lib/production-execution';
import { reconcileAutomaticallyReleasedProductionPlanBatches } from '../lib/production-planning';

const runDatabaseIntegration = process.env.RUN_DB_INTEGRATION === '1';

class RollbackIntegrationFixture extends Error {}

test(
  'current and next week plan batches become visible production work orders and roll over safely',
  {
    skip: !runDatabaseIntegration,
  },
  async () => {
    await assert.rejects(
      prisma.$transaction(
        async (tx) => {
          const actor = await tx.user.create({
            data: {
              username: 'plan-auto-release-integration',
              passwordHash: 'integration-test-only',
              displayName: 'Plan auto release integration',
            },
          });
          const currentStart = new Date('2026-08-03T04:00:00.000Z');
          const currentEnd = new Date('2026-08-09T04:00:00.000Z');
          const nextStart = new Date('2026-08-10T04:00:00.000Z');
          const nextEnd = new Date('2026-08-16T04:00:00.000Z');
          const orderDate = new Date('2026-08-01T04:00:00.000Z');
          const customerDueDate = new Date('2026-08-20T04:00:00.000Z');

          const currentOrder = await tx.productionPlanOrder.create({
            data: {
              sourceOrderNo: 'AUTO-CURRENT',
              sourceLineNo: 1,
              customerName: 'Integration customer',
              productName: 'Current week product',
              specification: 'AUTO-CURRENT-SPEC',
              orderQuantity: 10,
              orderDate,
              customerDueDate,
              createdById: actor.id,
              updatedById: actor.id,
              batches: {
                create: {
                  batchNo: 1,
                  quantity: 10,
                  weekStartDate: currentStart,
                  weekEndDate: currentEnd,
                  plannedCompletionDate: currentEnd,
                },
              },
            },
          });
          const nextOrder = await tx.productionPlanOrder.create({
            data: {
              sourceOrderNo: 'AUTO-NEXT',
              sourceLineNo: 1,
              customerName: 'Integration customer',
              productName: 'Next week product',
              specification: 'AUTO-NEXT-SPEC',
              orderQuantity: 12,
              orderDate,
              customerDueDate,
              createdById: actor.id,
              updatedById: actor.id,
              batches: {
                create: {
                  batchNo: 1,
                  quantity: 12,
                  weekStartDate: nextStart,
                  weekEndDate: nextEnd,
                  plannedCompletionDate: nextEnd,
                },
              },
            },
          });

          const first =
            await reconcileAutomaticallyReleasedProductionPlanBatches(tx, {
              actorId: actor.id,
              now: currentStart,
            });
          assert.deepEqual(
            { active: first.active, preparation: first.preparation },
            { active: 1, preparation: 1 },
          );
          assert.ok(first.warningCount >= 2);

          const [currentBatch, nextBatch] = await Promise.all([
            tx.productionPlanBatch.findFirstOrThrow({
              where: { planOrderId: currentOrder.id },
              include: {
                workOrder: {
                  include: { materialTask: true, processRoute: true },
                },
              },
            }),
            tx.productionPlanBatch.findFirstOrThrow({
              where: { planOrderId: nextOrder.id },
              include: {
                workOrder: {
                  include: { materialTask: true, processRoute: true },
                },
              },
            }),
          ]);
          assert.equal(currentBatch.releaseState, 'active');
          assert.equal(currentBatch.workOrder?.planActive, true);
          assert.equal(nextBatch.releaseState, 'preparation');
          assert.equal(nextBatch.workOrder?.planActive, false);
          for (const batch of [currentBatch, nextBatch]) {
            assert.ok(batch.workOrder);
            assert.equal(batch.workOrder.startedAt, null);
            assert.equal(batch.workOrder.materialTask?.status, 'pending');
            assert.equal(batch.workOrder.processRoute?.status, 'draft');
            assert.equal(
              batch.workOrder.processRoute?.routeSource,
              'product_time_pending',
            );
          }

          const [visibleCurrent, visibleNext] = await Promise.all([
            tx.workOrder.count({
              where: productionWeekWhere({
                scope: 'current',
                weekStart: currentStart,
                weekEnd: currentEnd,
              }),
            }),
            tx.workOrder.count({
              where: productionWeekWhere({
                scope: 'next',
                weekStart: nextStart,
                weekEnd: nextEnd,
              }),
            }),
          ]);
          assert.equal(visibleCurrent, 1);
          assert.equal(visibleNext, 1);

          const rollover =
            await reconcileAutomaticallyReleasedProductionPlanBatches(tx, {
              actorId: actor.id,
              now: nextStart,
            });
          assert.deepEqual(
            { active: rollover.active, preparation: rollover.preparation },
            { active: 1, preparation: 0 },
          );
          const rolledOver = await tx.productionPlanBatch.findFirstOrThrow({
            where: { planOrderId: nextOrder.id },
            include: { workOrder: true },
          });
          assert.equal(rolledOver.releaseState, 'active');
          assert.equal(rolledOver.workOrder?.planActive, true);
          assert.equal(rolledOver.workOrder?.startedAt, null);
          assert.equal(
            await tx.workOrder.count({
              where: productionWeekWhere({
                scope: 'current',
                weekStart: nextStart,
                weekEnd: nextEnd,
              }),
            }),
            1,
          );
          throw new RollbackIntegrationFixture();
        },
        { timeout: 60_000 },
      ),
      (error) => error instanceof RollbackIntegrationFixture,
    );
  },
);
