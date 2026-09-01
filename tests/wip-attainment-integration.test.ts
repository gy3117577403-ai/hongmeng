import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { ProcessLaborPoolStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { chinaWeekRange } from '../lib/production-planning';
import type { ProductionEntityScope } from '../lib/production-access-scope';
import {
  enterWipWarehouse,
  loadWipWeekLaborMetrics,
  scheduleWipLot,
} from '../lib/wip-warehouse';

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

test('08-24 batch executed as 08-31 carryover reaches 100 percent before its remaining work moves to 09-07 WIP', {
  skip: !enabled,
  timeout: 90_000,
}, async () => {
  const suffix = randomUUID().slice(0, 8);
  const prefix = `IT-WIP-ATTAIN-${suffix}`;
  // A later editable execution week keeps this fixture isolated from the live
  // board while preserving the exact original -> carryover -> WIP week shape.
  const executionWeek = chinaWeekRange(plusDays(new Date(), 56));
  const sourceWeek = chinaWeekRange(plusDays(executionWeek.start, -7));
  const targetWeekStart = plusDays(executionWeek.start, 7);
  const actor = await prisma.user.create({
    data: { username: prefix, displayName: '半成品达成率集成测试', passwordHash: 'integration-test-only' },
  });
  const workOrder = await prisma.workOrder.create({
    data: {
      code: prefix,
      customerName: prefix,
      productName: '完成首工序后转仓测试',
      specification: prefix,
      planType: 'managed_plan',
      planActive: true,
      productionTargetQty: 100,
      uncompletedQty: '100',
      stage: 'frontend',
      status: 'in_progress',
      startedAt: sourceWeek.start,
      processRoute: {
        create: {
          templateName: prefix,
          templateVersion: 1,
          status: 'in_progress',
          version: 0,
          confirmedAt: sourceWeek.start,
          confirmedById: actor.id,
          startedAt: sourceWeek.start,
          steps: {
            create: Array.from({ length: 4 }, (_, index) => ({
              processCode: `${prefix}-${index + 1}`,
              processName: `工序${index + 1}`,
              stageGroup: 'frontend',
              position: index + 1,
              sequenceGroup: index + 1,
              status: index === 0 ? 'completed' : index === 1 ? 'current' : 'pending',
              inputQty: 100,
              processedQty: index === 0 ? 100 : 0,
              goodOutputQty: index === 0 ? 100 : 0,
              releasedGoodQty: index === 0 ? 100 : 0,
              standardSource: 'integration_test',
              timeBasis: 'per_unit',
              unitLabel: '件',
              standardMillisecondsPerUnit: 1_000,
              unitsPerProduct: 1,
              countsForEfficiency: true,
            })),
          },
        },
      },
    },
    include: { processRoute: { include: { steps: { orderBy: { position: 'asc' } } } } },
  });
  const planOrder = await prisma.productionPlanOrder.create({
    data: {
      sourceOrderNo: prefix,
      sourceLineNo: 1,
      customerName: prefix,
      productName: '完成首工序后转仓测试',
      specification: prefix,
      orderQuantity: 100,
      orderDate: sourceWeek.start,
      customerDueDate: plusDays(targetWeekStart, 6),
      createdById: actor.id,
      updatedById: actor.id,
      batches: {
        create: {
          batchNo: 1,
          quantity: 100,
          weekStartDate: sourceWeek.start,
          weekEndDate: sourceWeek.end,
          plannedCompletionDate: sourceWeek.end,
          releaseState: 'active',
          workOrderId: workOrder.id,
        },
      },
    },
    include: { batches: true },
  });
  const batch = planOrder.batches[0];
  const carryover = await prisma.productionCarryover.create({
    data: {
      productionPlanBatchId: batch.id,
      workOrderId: workOrder.id,
      sourceWeekStartDate: sourceWeek.start,
      targetWeekStartDate: executionWeek.start,
      inclusionType: 'AUTO_PREVIOUS_WEEK',
      status: 'ACTIVE',
      reason: '集成测试：原批次进入下一周遗留执行',
      includedById: actor.id,
    },
  });
  const route = workOrder.processRoute!;
  const firstStep = route.steps[0];
  let completionId: string | null = null;
  let lotId: string | null = null;
  let targetCarryoverId: string | null = null;

  try {
    const completion = await prisma.processCompletion.create({
      data: {
        workOrderId: workOrder.id,
        routeId: route.id,
        stepId: firstStep.id,
        workDate: executionWeek.start,
        processedQty: 100,
        goodQty: 100,
        defectQty: 0,
        reportedUnitQty: 100,
        reportedGoodUnitQty: 100,
        reportedDefectUnitQty: 0,
        coveredQty: 100,
        coveredGoodQty: 100,
        routeVersion: route.version,
        idempotencyKey: `${prefix}:completion:first`,
        standardSource: 'integration_test',
        timeBasis: 'per_unit',
        unitLabel: '件',
        standardMillisecondsPerUnit: 1_000,
        unitsPerProduct: 1,
        createdById: actor.id,
      },
    });
    completionId = completion.id;
    await prisma.processLaborPool.create({
      data: {
        completionId: completion.id,
        workOrderId: workOrder.id,
        stepId: firstStep.id,
        workDate: executionWeek.start,
        eligibleQty: 100,
        claimedQty: 0,
        remainingQty: 100,
        status: ProcessLaborPoolStatus.OPEN,
        standardMillisecondsPerUnit: 1_000,
        unitsPerProduct: 1,
        totalStandardLaborMilliseconds: 100_000n,
        claimedStandardLaborMilliseconds: 0n,
        remainingStandardLaborMilliseconds: 100_000n,
        countsForEfficiency: true,
        standardSource: 'integration_test',
      },
    });

    const lot = await enterWipWarehouse({
      batchId: batch.id,
      quantity: 100,
      reason: '第一道工序本周完成，剩余三道转入半成品仓',
      actorId: actor.id,
      actorName: actor.displayName,
      idempotencyKey: `${prefix}:enter`,
      productionScope: scope,
    });
    lotId = lot.id;
    // The domain service stamps real current time. Move only the entry timestamp
    // into this isolated future fixture so effective-source-week attribution is
    // exercised without altering any completion or labor fact.
    await prisma.semiFinishedLot.update({ where: { id: lot.id }, data: { enteredAt: executionWeek.start } });

    const [executionBeforeScheduling, originalWeekMetrics] = await Promise.all([
      loadWipWeekLaborMetrics(executionWeek.start),
      loadWipWeekLaborMetrics(sourceWeek.start),
    ]);
    assert.equal(executionBeforeScheduling.nativePlannedMilliseconds, 400_000);
    assert.equal(executionBeforeScheduling.movedOutMilliseconds, 300_000);
    assert.equal(executionBeforeScheduling.scheduledInMilliseconds, 0);
    assert.equal(executionBeforeScheduling.effectivePlannedMilliseconds, 100_000);
    assert.equal(executionBeforeScheduling.completedMilliseconds, 100_000);
    assert.equal(executionBeforeScheduling.percentage, 100);
    assert.equal(executionBeforeScheduling.unscheduledWipQuantity, 100);
    assert.equal(originalWeekMetrics.nativePlannedMilliseconds, 400_000);
    assert.equal(originalWeekMetrics.movedOutMilliseconds, 0, 'carryover-week transfer must not be subtracted from 08-24 again');
    assert.equal(originalWeekMetrics.effectivePlannedMilliseconds, 400_000);
    assert.equal(originalWeekMetrics.completedMilliseconds, 0, '08-31 reporting must not be fabricated in the original week');
    assert.equal(originalWeekMetrics.percentage, 0);

    await scheduleWipLot({
      lotId: lot.id,
      quantity: 100,
      targetWeekStartDate: targetWeekStart,
      reason: '剩余三道工序安排到目标周',
      actorId: actor.id,
      actorName: actor.displayName,
      idempotencyKey: `${prefix}:schedule`,
      productionScope: scope,
    });
    // The source order can legitimately be inherited into the target week as
    // well. Its native remainder and the WIP continuation are the same work;
    // the effective target denominator must therefore include them only once.
    const targetCarryover = await prisma.productionCarryover.create({
      data: {
        productionPlanBatchId: batch.id,
        workOrderId: workOrder.id,
        sourceWeekStartDate: executionWeek.start,
        targetWeekStartDate: targetWeekStart,
        inclusionType: 'AUTO_PREVIOUS_WEEK',
        status: 'ACTIVE',
        reason: '集成测试：目标周同时存在来源遗留和半成品续作',
        includedById: actor.id,
      },
    });
    targetCarryoverId = targetCarryover.id;
    const [sourceAfterScheduling, targetAfterScheduling] = await Promise.all([
      loadWipWeekLaborMetrics(executionWeek.start),
      loadWipWeekLaborMetrics(targetWeekStart),
    ]);
    assert.equal(sourceAfterScheduling.effectivePlannedMilliseconds, 100_000);
    assert.equal(sourceAfterScheduling.completedMilliseconds, 100_000);
    assert.equal(sourceAfterScheduling.percentage, 100);
    assert.equal(targetAfterScheduling.nativePlannedMilliseconds, 300_000);
    assert.equal(targetAfterScheduling.movedOutMilliseconds, 300_000);
    assert.equal(targetAfterScheduling.scheduledInMilliseconds, 300_000);
    assert.equal(targetAfterScheduling.effectivePlannedMilliseconds, 300_000);
    assert.equal(targetAfterScheduling.completedMilliseconds, 0);
    assert.equal(targetAfterScheduling.percentage, 0);
  } finally {
    if (completionId) {
      await prisma.processLaborPool.deleteMany({ where: { completionId } });
      await prisma.processWipCredit.deleteMany({ where: { completionId } });
      await prisma.processCompletion.deleteMany({ where: { id: completionId } });
    }
    if (lotId) {
      await prisma.wipWeekAllocation.deleteMany({ where: { lotId } });
      await prisma.semiFinishedLot.deleteMany({ where: { id: lotId } });
    }
    await prisma.productionCarryover.deleteMany({
      where: { id: { in: [carryover.id, ...(targetCarryoverId ? [targetCarryoverId] : [])] } },
    });
    await prisma.operationLog.deleteMany({ where: { userId: actor.id } });
    await prisma.productionPlanOrder.deleteMany({ where: { id: planOrder.id } });
    await prisma.workOrder.deleteMany({ where: { id: workOrder.id } });
    await prisma.user.deleteMany({ where: { id: actor.id } });
  }
});
