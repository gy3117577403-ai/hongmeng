import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { WipWeekAllocationStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { chinaWeekRange } from '../lib/production-planning';
import {
  enterWipWarehouse,
  loadWipWeekLaborMetrics,
  previewWipEntry,
  rescheduleWipAllocation,
  scheduleWipLot,
} from '../lib/wip-warehouse';
import {
  creditWipCompletion,
  resolveWipReportingAllocation,
  voidWipCreditsForCompletion,
} from '../lib/wip-reporting';
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
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

test('WIP entry, scheduling, reporting withdrawal and rescheduling preserve quantity and weekly labor', {
  skip: !enabled,
  timeout: 90_000,
}, async () => {
  const suffix = randomUUID().slice(0, 8);
  const prefix = `IT-WIP-${suffix}`;
  const currentWeek = chinaWeekRange(new Date());
  const nextWeekStart = plusDays(currentWeek.start, 7);
  const nextWeekEnd = plusDays(currentWeek.end, 7);
  const laterWeekStart = plusDays(currentWeek.start, 14);
  const laterWeekEnd = plusDays(currentWeek.end, 14);
  const actor = await prisma.user.create({
    data: { username: prefix, displayName: '半成品集成测试', passwordHash: 'integration-test-only' },
  });
  const workOrder = await prisma.workOrder.create({
    data: {
      code: prefix,
      customerName: prefix,
      productName: '半成品工时守恒测试',
      specification: prefix,
      planType: 'managed_plan',
      planActive: true,
      productionTargetQty: 10,
      uncompletedQty: '10',
      stage: 'frontend',
      status: 'in_progress',
      startedAt: currentWeek.start,
      materialTask: {
        create: {
          status: 'exception',
          exceptionType: 'wrong_material',
          exceptionNote: '料错仅提示',
          updatedById: actor.id,
        },
      },
      processRoute: {
        create: {
          templateName: prefix,
          templateVersion: 1,
          status: 'in_progress',
          version: 0,
          confirmedAt: currentWeek.start,
          confirmedById: actor.id,
          startedAt: currentWeek.start,
          steps: {
            create: [
              {
                processCode: `${prefix}-01`,
                processName: '已完成工序',
                stageGroup: 'frontend',
                position: 1,
                sequenceGroup: 1,
                status: 'completed',
                inputQty: 10,
                processedQty: 10,
                goodOutputQty: 10,
                releasedGoodQty: 10,
                standardSource: 'integration_test',
                timeBasis: 'per_unit',
                unitLabel: '件',
                standardMillisecondsPerUnit: 1_000,
                unitsPerProduct: 1,
                countsForEfficiency: true,
              },
              {
                processCode: `${prefix}-02`,
                processName: '剩余工序',
                stageGroup: 'frontend',
                position: 2,
                sequenceGroup: 2,
                status: 'current',
                inputQty: 10,
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
    include: { processRoute: { include: { steps: { orderBy: { position: 'asc' } } } } },
  });
  const order = await prisma.productionPlanOrder.create({
    data: {
      sourceOrderNo: prefix,
      sourceLineNo: 1,
      customerName: prefix,
      productName: '半成品工时守恒测试',
      specification: prefix,
      orderQuantity: 10,
      orderDate: currentWeek.start,
      customerDueDate: nextWeekEnd,
      createdById: actor.id,
      updatedById: actor.id,
      batches: {
        create: {
          batchNo: 1,
          quantity: 10,
          weekStartDate: currentWeek.start,
          weekEndDate: currentWeek.end,
          plannedCompletionDate: currentWeek.end,
          releaseState: 'active',
          workOrderId: workOrder.id,
        },
      },
    },
    include: { batches: true },
  });
  const batch = order.batches[0];
  const route = workOrder.processRoute!;
  const remainingStep = route.steps[1];
  const completionIds: string[] = [];
  try {
    const preview = await previewWipEntry({ batchId: batch.id, quantity: 6, productionScope: scope });
    assert.deepEqual(preview.completedSteps.map(step => step.processName), ['已完成工序']);
    assert.equal(preview.remainingStandardMilliseconds, 12_000);
    assert.match(preview.materialWarning || '', /物料异常/);

    const lot = await enterWipWarehouse({
      batchId: batch.id,
      quantity: 6,
      reason: '物料到货日期不确定，保留已完工事实并转移剩余计划',
      actorId: actor.id,
      actorName: actor.displayName,
      idempotencyKey: `${prefix}:enter`,
      productionScope: scope,
    });
    const allocation = await scheduleWipLot({
      lotId: lot.id,
      quantity: 6,
      targetWeekStartDate: nextWeekStart,
      reason: '安排到下周继续生产',
      actorId: actor.id,
      actorName: actor.displayName,
      idempotencyKey: `${prefix}:schedule`,
      productionScope: scope,
    });
    assert.equal(allocation.plannedStandardMilliseconds, 12_000n);

    const reportAndCredit = async (idempotencyKey: string) => prisma.$transaction(async tx => {
      const resolution = await resolveWipReportingAllocation(tx, {
        workOrderId: workOrder.id,
        stepId: remainingStep.id,
        workDate: nextWeekStart,
        processedQty: 2,
        reportableQty: 6,
        requestedAllocationId: allocation.id,
      });
      assert.ok(resolution);
      const completion = await tx.processCompletion.create({
        data: {
          workOrderId: workOrder.id,
          routeId: route.id,
          stepId: remainingStep.id,
          workDate: nextWeekStart,
          processedQty: 2,
          goodQty: 2,
          defectQty: 0,
          reportedUnitQty: 2,
          reportedGoodUnitQty: 2,
          reportedDefectUnitQty: 0,
          coveredQty: 2,
          coveredGoodQty: 2,
          routeVersion: route.version,
          idempotencyKey,
          standardSource: 'integration_test',
          timeBasis: 'per_unit',
          unitLabel: '件',
          standardMillisecondsPerUnit: 2_000,
          unitsPerProduct: 1,
          createdById: actor.id,
        },
      });
      completionIds.push(completion.id);
      await creditWipCompletion(tx, {
        resolution,
        completionId: completion.id,
        workDate: nextWeekStart,
        idempotencyKey,
      });
      return completion;
    });

    const withdrawn = await reportAndCredit(`${prefix}:completion:withdraw`);
    await prisma.$transaction(tx => voidWipCreditsForCompletion(tx, withdrawn.id));
    const afterVoid = await prisma.wipWeekAllocation.findUniqueOrThrow({ where: { id: allocation.id } });
    assert.equal(afterVoid.completedQty, 0);
    assert.equal(afterVoid.completedStandardMilliseconds, 0n);
    assert.equal(afterVoid.status, WipWeekAllocationStatus.ACTIVE);

    await reportAndCredit(`${prefix}:completion:keep`);
    const credited = await prisma.wipWeekAllocation.findUniqueOrThrow({ where: { id: allocation.id } });
    assert.equal(credited.completedQty, 2);
    assert.equal(credited.completedStandardMilliseconds, 4_000n);

    const rescheduled = await rescheduleWipAllocation({
      allocationId: allocation.id,
      targetWeekStartDate: laterWeekStart,
      reason: '剩余物料仍未到货，改排到后续周',
      actorId: actor.id,
      actorName: actor.displayName,
      idempotencyKey: `${prefix}:reschedule`,
      productionScope: scope,
    });
    assert.equal(rescheduled.quantity, 4);
    assert.equal(rescheduled.plannedStandardMilliseconds, 8_000n);

    const [sourceMetrics, oldTargetMetrics, newTargetMetrics] = await Promise.all([
      loadWipWeekLaborMetrics(currentWeek.start),
      loadWipWeekLaborMetrics(nextWeekStart),
      loadWipWeekLaborMetrics(laterWeekStart),
    ]);
    assert.equal(sourceMetrics.movedOutMilliseconds, 12_000);
    assert.equal(sourceMetrics.effectivePlannedMilliseconds, 18_000);
    assert.equal(oldTargetMetrics.scheduledInMilliseconds, 4_000);
    assert.equal(oldTargetMetrics.completedMilliseconds, 4_000);
    assert.equal(oldTargetMetrics.percentage, 100);
    assert.equal(newTargetMetrics.scheduledInMilliseconds, 8_000);

    const storedLot = await prisma.semiFinishedLot.findUniqueOrThrow({
      where: { id: lot.id },
      include: { allocations: true },
    });
    assert.equal(storedLot.quantity, 6);
    assert.equal(storedLot.allocations.find(item => item.id === allocation.id)?.status, 'SUPERSEDED');
    assert.equal(storedLot.allocations.find(item => item.id === rescheduled.id)?.quantity, 4);
  } finally {
    await prisma.processWipCredit.deleteMany({ where: { completionId: { in: completionIds } } });
    await prisma.processCompletion.deleteMany({ where: { id: { in: completionIds } } });
    await prisma.semiFinishedLot.deleteMany({ where: { productionPlanBatchId: batch.id } });
    await prisma.operationLog.deleteMany({ where: { userId: actor.id } });
    await prisma.productionPlanOrder.delete({ where: { id: order.id } });
    await prisma.workOrder.delete({ where: { id: workOrder.id } });
    await prisma.user.delete({ where: { id: actor.id } });
  }
});
