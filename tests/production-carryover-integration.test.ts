import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { prisma } from '../lib/prisma';
import {
  PRODUCTION_CARRYOVER_ACTIVE,
  PRODUCTION_CARRYOVER_MANUAL,
  productionCarryoverDayWindow,
  reconcileProductionCarryovers,
} from '../lib/production-carryovers';
import { addDays, parseWeek } from '../lib/weekly-work-orders';

const runDatabaseIntegration = process.env.RUN_DB_INTEGRATION === '1';

class RollbackCarryoverFixture extends Error {}

test('default carryover includes only the previous working set and chains a prior manual adoption', {
  skip: !runDatabaseIntegration,
}, async () => {
  await assert.rejects(
    prisma.$transaction(async tx => {
      const prefix = `carryover-${randomUUID()}`;
      const target = parseWeek('2026-08-10')!;
      const previous = addDays(target, -7);
      const older = addDays(target, -21);

      async function createBatch(name: string, weekStartDate: Date, completed = false) {
        const workOrder = await tx.workOrder.create({
          data: {
            code: `${prefix}-${name}`,
            customerName: '跨周测试客户',
            productName: `跨周测试产品 ${name}`,
            specification: `${prefix}-${name}`,
            stage: completed ? 'completed' : 'frontend',
            status: completed ? 'completed' : 'processing',
            completedAt: completed ? new Date() : null,
            planType: 'weekly_plan',
            planActive: weekStartDate.getTime() === previous.getTime(),
            weekStartDate,
            weekEndDate: addDays(weekStartDate, 6),
          },
        });
        const order = await tx.productionPlanOrder.create({
          data: {
            sourceOrderNo: `${prefix}-${name}`,
            sourceLineNo: 1,
            customerName: '跨周测试客户',
            productName: `跨周测试产品 ${name}`,
            specification: `${prefix}-${name}`,
            orderQuantity: 10,
            orderDate: older,
            customerDueDate: addDays(target, 5),
          },
        });
        return tx.productionPlanBatch.create({
          data: {
            planOrderId: order.id,
            batchNo: 1,
            quantity: 10,
            weekStartDate,
            weekEndDate: addDays(weekStartDate, 6),
            plannedCompletionDate: addDays(weekStartDate, 5),
            releaseState: 'archived',
            workOrderId: workOrder.id,
          },
        });
      }

      const nativePrevious = await createBatch('native-previous', previous);
      const manuallyAdoptedOlder = await createBatch('manual-older', older);
      const untouchedOlder = await createBatch('untouched-older', older);
      const completedPrevious = await createBatch('completed-previous', previous, true);
      const deletedPrevious = await createBatch('deleted-previous', previous);

      await tx.productionCarryover.create({
        data: {
          productionPlanBatchId: manuallyAdoptedOlder.id,
          workOrderId: manuallyAdoptedOlder.workOrderId!,
          sourceWeekStartDate: older,
          targetWeekStartDate: previous,
          inclusionType: PRODUCTION_CARRYOVER_MANUAL,
        },
      });
      const completedLink = await tx.productionCarryover.create({
        data: {
          productionPlanBatchId: completedPrevious.id,
          workOrderId: completedPrevious.workOrderId!,
          sourceWeekStartDate: previous,
          targetWeekStartDate: target,
          inclusionType: 'AUTO_PREVIOUS_WEEK',
        },
      });
      const deletedLink = await tx.productionCarryover.create({
        data: {
          productionPlanBatchId: deletedPrevious.id,
          workOrderId: deletedPrevious.workOrderId!,
          sourceWeekStartDate: previous,
          targetWeekStartDate: target,
          inclusionType: 'AUTO_PREVIOUS_WEEK',
        },
      });
      await tx.productionPlanBatch.update({
        where: { id: deletedPrevious.id },
        data: { deletedAt: new Date('2026-08-11T02:00:00.000Z') },
      });

      const first = await reconcileProductionCarryovers(tx, { targetWeekStart: target });
      assert.equal(first.createdCount, 2);
      assert.equal(first.completedCount, 1);
      assert.equal(first.dismissedCount, 1);
      const links = await tx.productionCarryover.findMany({
        where: { targetWeekStartDate: productionCarryoverDayWindow(target), status: PRODUCTION_CARRYOVER_ACTIVE },
        select: { productionPlanBatchId: true },
      });
      assert.deepEqual(
        links.map(link => link.productionPlanBatchId).sort(),
        [nativePrevious.id, manuallyAdoptedOlder.id].sort(),
      );
      assert.equal(links.some(link => link.productionPlanBatchId === untouchedOlder.id), false);
      assert.equal(links.some(link => link.productionPlanBatchId === completedPrevious.id), false);
      const [completedState, dismissedState] = await Promise.all([
        tx.productionCarryover.findUniqueOrThrow({ where: { id: completedLink.id } }),
        tx.productionCarryover.findUniqueOrThrow({ where: { id: deletedLink.id } }),
      ]);
      assert.equal(completedState.status, 'COMPLETED');
      assert.ok(completedState.completedAt);
      assert.equal(completedState.dismissedAt, null);
      assert.equal(dismissedState.status, 'DISMISSED');
      assert.ok(dismissedState.dismissedAt);
      assert.equal(dismissedState.completedAt, null);

      const second = await reconcileProductionCarryovers(tx, { targetWeekStart: target });
      assert.equal(second.createdCount, 0);
      assert.equal(second.completedCount, 0);
      assert.equal(second.dismissedCount, 0);
      assert.equal(await tx.productionCarryover.count({
        where: { targetWeekStartDate: productionCarryoverDayWindow(target), status: PRODUCTION_CARRYOVER_ACTIVE },
      }), 2);

      throw new RollbackCarryoverFixture();
    }),
    RollbackCarryoverFixture,
  );
});
