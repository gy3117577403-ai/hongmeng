import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { prisma } from '../lib/prisma';
import { chinaDate, chinaWeekRange } from '../lib/production-planning';
import { loadProductionExecution } from '../lib/production-execution';
import {
  enterWipWarehouse,
  rescheduleWipAllocation,
  scheduleWipLot,
} from '../lib/wip-warehouse';
import type { ProductionEntityScope } from '../lib/production-access-scope';

const enabled = process.env.RUN_DB_INTEGRATION === '1';
const scope: ProductionEntityScope = {
  level: 'GLOBAL',
  canRead: true,
  canWrite: true,
  canReconcile: true,
  readOnly: false,
  teamKeys: [],
};

function plusDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

test('historical WIP source remains linked on the current carryover and owns the full target-week execution', {
  skip: !enabled,
  timeout: 90_000,
}, async () => {
  const suffix = randomUUID().slice(0, 8);
  const prefix = `IT-WIP-SOURCE-${suffix}`;
  const currentWeek = chinaWeekRange(new Date());
  const sourceWeekStart = plusDays(currentWeek.start, -7);
  const sourceWeekEnd = plusDays(currentWeek.end, -7);
  const nextWeekStart = plusDays(currentWeek.start, 7);
  const nextWeekEnd = plusDays(currentWeek.end, 7);
  const actor = await prisma.user.create({
    data: { username: prefix, displayName: '半成品来源投影测试', passwordHash: 'integration-test-only' },
  });
  const workOrder = await prisma.workOrder.create({
    data: {
      code: prefix,
      customerName: prefix,
      productName: '历史来源周半成品投影',
      specification: '与其他订单可以同规格但不可串单',
      planType: 'managed_plan',
      planActive: true,
      productionTargetQty: 100,
      uncompletedQty: '100',
      completedQty: '0',
      stage: 'frontend',
      status: 'in_progress',
      weekStartDate: sourceWeekStart,
      weekEndDate: sourceWeekEnd,
      startedAt: sourceWeekStart,
      processRoute: {
        create: {
          templateName: prefix,
          templateVersion: 1,
          status: 'in_progress',
          version: 0,
          confirmedAt: sourceWeekStart,
          confirmedById: actor.id,
          startedAt: sourceWeekStart,
          steps: {
            create: [
              {
                processCode: `${prefix}-01`,
                processName: '来源周已完成工序',
                stageGroup: 'frontend',
                position: 1,
                sequenceGroup: 1,
                status: 'completed',
                inputQty: 100,
                processedQty: 100,
                goodOutputQty: 100,
                releasedGoodQty: 100,
                standardSource: 'integration_test',
                timeBasis: 'per_unit',
                unitLabel: '件',
                standardMillisecondsPerUnit: 1_000,
                unitsPerProduct: 1,
                countsForEfficiency: true,
              },
              {
                processCode: `${prefix}-02`,
                processName: '目标周剩余工序',
                stageGroup: 'frontend',
                position: 2,
                sequenceGroup: 2,
                status: 'current',
                inputQty: 100,
                standardSource: 'integration_test',
                timeBasis: 'per_unit',
                unitLabel: '件',
                standardMillisecondsPerUnit: 2_000,
                unitsPerProduct: 1,
                countsForEfficiency: true,
              },
            ],
          },
        },
      },
    },
  });
  const planOrder = await prisma.productionPlanOrder.create({
    data: {
      sourceOrderNo: prefix,
      sourceLineNo: 1,
      customerName: prefix,
      productName: '历史来源周半成品投影',
      specification: '与其他订单可以同规格但不可串单',
      orderQuantity: 100,
      orderDate: sourceWeekStart,
      customerDueDate: nextWeekEnd,
      createdById: actor.id,
      updatedById: actor.id,
      batches: {
        create: {
          batchNo: 1,
          quantity: 100,
          weekStartDate: sourceWeekStart,
          weekEndDate: sourceWeekEnd,
          plannedCompletionDate: sourceWeekEnd,
          releaseState: 'active',
          workOrderId: workOrder.id,
        },
      },
    },
    include: { batches: true },
  });
  const batch = planOrder.batches[0];
  await prisma.productionCarryover.create({
    data: {
      productionPlanBatchId: batch.id,
      workOrderId: workOrder.id,
      sourceWeekStartDate: sourceWeekStart,
      targetWeekStartDate: currentWeek.start,
      inclusionType: 'AUTO_PREVIOUS_WEEK',
      status: 'ACTIVE',
      reason: '集成测试：历史来源订单进入当前遗留',
      includedById: actor.id,
    },
  });

  try {
    const lot = await enterWipWarehouse({
      batchId: batch.id,
      quantity: 100,
      reason: '来源周已完成首道工序，剩余工序转入半成品仓',
      actorId: actor.id,
      actorName: actor.displayName,
      idempotencyKey: `${prefix}:enter`,
      productionScope: scope,
    });
    const unscheduledExecution = await loadProductionExecution({
      week: { scope: 'current', weekStart: currentWeek.start, weekEnd: currentWeek.end },
      includeSummary: true,
      productionScope: scope,
    });
    const unscheduledSourceRow = unscheduledExecution.items.find(item => item.id === workOrder.id);
    assert.ok(unscheduledSourceRow, 'an unscheduled WIP lot keeps a read-only source fact visible');
    assert.equal(unscheduledSourceRow.wipMovedOutSummary?.movedOutQuantity, 100);
    assert.equal(unscheduledSourceRow.wipMovedOutSummary?.unscheduledWipQuantity, 100);
    assert.equal(unscheduledSourceRow.wipMovedOutSummary?.nativeRemainingQuantity, 0);
    assert.equal(unscheduledSourceRow.wipMovedOutSummary?.fullyMovedOut, true);
    assert.deepEqual(unscheduledSourceRow.wipMovedOutSummary?.targetWeeks, []);

    const nextAllocation = await scheduleWipLot({
      lotId: lot.id,
      quantity: 100,
      targetWeekStartDate: nextWeekStart,
      reason: '安排到下周继续剩余工序',
      actorId: actor.id,
      actorName: actor.displayName,
      idempotencyKey: `${prefix}:schedule-next`,
      productionScope: scope,
    });

    const sourceExecution = await loadProductionExecution({
      week: { scope: 'current', weekStart: currentWeek.start, weekEnd: currentWeek.end },
      includeSummary: true,
      productionScope: scope,
    });
    const sourceRow = sourceExecution.items.find(item => item.id === workOrder.id);
    assert.ok(sourceRow, 'the original work order remains as a current carryover fact');
    assert.equal(sourceRow.carryover?.originalWeekStartDate, chinaDate(sourceWeekStart));
    assert.deepEqual(sourceRow.wipMovedOutContinuations.map(item => item.allocationId), [nextAllocation.id]);
    assert.equal(sourceRow.wipMovedOutSummary?.movedOutQuantity, 100);
    assert.equal(sourceRow.wipMovedOutSummary?.nativeRemainingQuantity, 0);
    assert.equal(sourceRow.wipMovedOutSummary?.fullyMovedOut, true);

    const currentAllocation = await rescheduleWipAllocation({
      allocationId: nextAllocation.id,
      targetWeekStartDate: currentWeek.start,
      reason: '验证目标周全量WIP只保留一个可执行投影',
      actorId: actor.id,
      actorName: actor.displayName,
      idempotencyKey: `${prefix}:reschedule-current`,
      productionScope: scope,
    });
    const targetExecution = await loadProductionExecution({
      week: { scope: 'current', weekStart: currentWeek.start, weekEnd: currentWeek.end },
      includeSummary: true,
      productionScope: scope,
    });
    const sameOrderRows = targetExecution.items.filter(item => item.id === workOrder.id);
    assert.equal(sameOrderRows.length, 1, 'full WIP target must suppress the duplicate native carryover task');
    assert.equal(sameOrderRows[0].executionKey, `wip:${currentAllocation.id}`);
    assert.equal(sameOrderRows[0].wipContinuation?.allocationId, currentAllocation.id);
  } finally {
    await prisma.wipWeekAllocation.deleteMany({ where: { lot: { productionPlanBatchId: batch.id } } });
    await prisma.semiFinishedLot.deleteMany({ where: { productionPlanBatchId: batch.id } });
    await prisma.productionCarryover.deleteMany({ where: { productionPlanBatchId: batch.id } });
    await prisma.operationLog.deleteMany({ where: { userId: actor.id } });
    await prisma.productionPlanOrder.delete({ where: { id: planOrder.id } });
    await prisma.workOrder.delete({ where: { id: workOrder.id } });
    await prisma.user.delete({ where: { id: actor.id } });
  }
});
