import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { prisma } from '@/lib/prisma';
import { loadWeeklyPlanExportData } from '@/lib/weekly-plan-export';
import { addDays, parseWeek } from '@/lib/weekly-work-orders';

const runDatabaseIntegration = process.env.RUN_DB_INTEGRATION === '1';

class RollbackWeeklyPlanExportFixture extends Error {}

test('weekly plan export reads current batches and only active unfinished carryovers', {
  skip: runDatabaseIntegration ? false : 'set RUN_DB_INTEGRATION=1 to use the configured database',
}, async () => {
  await assert.rejects(
    prisma.$transaction(async tx => {
      const prefix = `weekly-export-${randomUUID()}`;
      const target = parseWeek('2026-08-24')!;
      const previous = addDays(target, -7);
      const baseline = await loadWeeklyPlanExportData({
        now: new Date('2026-08-24T04:00:00.000Z'),
        db: tx,
      });

      const currentOrder = await tx.productionPlanOrder.create({
        data: {
          sourceOrderNo: `${prefix}-CURRENT`,
          sourceLineNo: 1,
          customerName: '本周客户',
          salesperson: '业务员甲',
          productName: '本周产品',
          specification: `${prefix}-CURRENT-SPEC`,
          orderQuantity: 20,
          planningUnitMilliseconds: 60_000,
          orderDate: target,
          customerDueDate: addDays(target, 5),
        },
      });
      await tx.productionPlanBatch.create({
        data: {
          planOrderId: currentOrder.id,
          batchNo: 1,
          quantity: 20,
          weekStartDate: target,
          weekEndDate: addDays(target, 6),
          plannedCompletionDate: addDays(target, 4),
          releaseState: 'draft',
          unitMillisecondsSnapshot: 60_000,
          totalMillisecondsSnapshot: 1_200_000n,
        },
      });

      const carryoverWorkOrder = await tx.workOrder.create({
        data: {
          code: `${prefix}-WO`,
          businessCode: `${prefix}-BIZ`,
          customerName: '遗留客户',
          productName: '遗留产品',
          specification: `${prefix}-LEGACY-SPEC`,
          stage: 'frontend',
          status: 'processing',
          sourceOrderNo: `${prefix}-LEGACY`,
          uncompletedQty: '10',
          productionTargetQty: 10,
          completedQty: '6',
          planType: 'weekly_plan',
          planActive: false,
          weekStartDate: previous,
          weekEndDate: addDays(previous, 6),
        },
      });
      const carryoverOrder = await tx.productionPlanOrder.create({
        data: {
          sourceOrderNo: `${prefix}-LEGACY`,
          sourceLineNo: 1,
          customerName: '遗留客户',
          productName: '遗留产品',
          specification: `${prefix}-LEGACY-SPEC`,
          orderQuantity: 10,
          planningUnitMilliseconds: 120_000,
          orderDate: previous,
          customerDueDate: addDays(target, 3),
        },
      });
      const carryoverBatch = await tx.productionPlanBatch.create({
        data: {
          planOrderId: carryoverOrder.id,
          batchNo: 1,
          quantity: 10,
          weekStartDate: previous,
          weekEndDate: addDays(previous, 6),
          plannedCompletionDate: addDays(previous, 5),
          releaseState: 'archived',
          workOrderId: carryoverWorkOrder.id,
          unitMillisecondsSnapshot: 120_000,
          totalMillisecondsSnapshot: 1_200_000n,
        },
      });
      await tx.productionCarryover.create({
        data: {
          productionPlanBatchId: carryoverBatch.id,
          workOrderId: carryoverWorkOrder.id,
          sourceWeekStartDate: previous,
          targetWeekStartDate: target,
          inclusionType: 'AUTO_PREVIOUS_WEEK',
        },
      });

      const completedWorkOrder = await tx.workOrder.create({
        data: {
          code: `${prefix}-DONE-WO`,
          customerName: '已完成客户',
          productName: '已完成产品',
          specification: `${prefix}-DONE-SPEC`,
          stage: 'completed',
          status: 'completed',
          completedAt: new Date('2026-08-23T08:00:00.000Z'),
          productionTargetQty: 5,
          completedQty: '5',
          planType: 'weekly_plan',
          planActive: false,
          weekStartDate: previous,
          weekEndDate: addDays(previous, 6),
        },
      });
      const completedOrder = await tx.productionPlanOrder.create({
        data: {
          sourceOrderNo: `${prefix}-DONE`,
          sourceLineNo: 1,
          customerName: '已完成客户',
          productName: '已完成产品',
          specification: `${prefix}-DONE-SPEC`,
          orderQuantity: 5,
          orderDate: previous,
          customerDueDate: target,
        },
      });
      const completedBatch = await tx.productionPlanBatch.create({
        data: {
          planOrderId: completedOrder.id,
          batchNo: 1,
          quantity: 5,
          weekStartDate: previous,
          weekEndDate: addDays(previous, 6),
          plannedCompletionDate: addDays(previous, 5),
          releaseState: 'archived',
          workOrderId: completedWorkOrder.id,
        },
      });
      await tx.productionCarryover.create({
        data: {
          productionPlanBatchId: completedBatch.id,
          workOrderId: completedWorkOrder.id,
          sourceWeekStartDate: previous,
          targetWeekStartDate: target,
          inclusionType: 'AUTO_PREVIOUS_WEEK',
        },
      });

      const result = await loadWeeklyPlanExportData({
        now: new Date('2026-08-24T04:00:00.000Z'),
        db: tx,
      });
      assert.equal(result.weekStartDate, '2026-08-24');
      assert.equal(result.summary.current.batchCount, baseline.summary.current.batchCount + 1);
      assert.equal(result.summary.current.quantity, baseline.summary.current.quantity + 20);
      assert.equal(result.summary.previousCarryover.batchCount, baseline.summary.previousCarryover.batchCount + 1);
      assert.equal(result.summary.previousCarryover.quantity, baseline.summary.previousCarryover.quantity + 4);
      assert.equal(result.summary.execution.batchCount, baseline.summary.execution.batchCount + 2);
      assert.equal(result.summary.execution.quantity, baseline.summary.execution.quantity + 24);
      assert.equal(result.rows.some(row => row.orderNo === `${prefix}-DONE`), false);
      const carryover = result.previousCarryoverRows.find(row => row.orderNo === `${prefix}-LEGACY`)!;
      assert.equal(carryover.originalBatchQuantity, 10);
      assert.equal(carryover.completedQuantity, 6);
      assert.equal(carryover.scheduledQuantity, 4);
      assert.equal(carryover.totalHours, null, 'a work order without a configured route must not export zero as known labor');
      assert.equal(carryover.weekLabel, '上周遗留');
      assert.match(carryover.remark, /原批次数量：10/);
      assert.match(carryover.remark, /本周剩余：4/);
      assert.equal(
        result.summary.previousCarryover.hoursMissingCount,
        baseline.summary.previousCarryover.hoursMissingCount + 1,
      );

      const ranged = await loadWeeklyPlanExportData({
        mode: 'schedule_range',
        startDate: '2026-08-28',
        endDate: '2026-08-28',
        db: tx,
      });
      assert.equal(ranged.mode, 'schedule_range');
      assert.equal(ranged.weekStartDate, '2026-08-28');
      assert.equal(ranged.weekEndDate, '2026-08-28');
      assert.equal(ranged.currentRows.some(row => row.orderNo === `${prefix}-CURRENT`), true);
      assert.equal(ranged.rows.some(row => row.orderNo === `${prefix}-LEGACY`), false, 'range export must not inject carryovers');

      throw new RollbackWeeklyPlanExportFixture();
    }),
    RollbackWeeklyPlanExportFixture,
  );
});
