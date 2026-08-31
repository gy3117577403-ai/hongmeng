import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { decideMaterialExecution } from '../lib/material-execution-control';
import { prisma } from '../lib/prisma';
import { assertProductionMayBeScheduled, assertProductionMayRun } from '../lib/production-pause-guard';
import { startConfirmedProcessRoute } from '../lib/process-route-service';

const enabled = process.env.RUN_DB_INTEGRATION === '1';
const rejectsCode = (code: string) => (error: unknown) => Boolean(
  error && typeof error === 'object' && 'code' in error && error.code === code,
);

test('pending, shortage and wrong-material states never gate scheduling, start or reporting', {
  skip: !enabled,
  timeout: 60_000,
}, async () => {
  const prefix = `IT-MAT-AUTH-${randomUUID().slice(0, 8)}`;
  const actor = await prisma.user.create({
    data: { username: prefix, displayName: '计划授权测试', passwordHash: 'integration-test-only' },
  });
  const workOrder = await prisma.workOrder.create({
    data: {
      code: prefix,
      customerName: prefix,
      productName: '授权测试产品',
      specification: prefix,
      planType: 'managed_plan',
      planActive: true,
      productionTargetQty: 10,
      uncompletedQty: '10',
      stage: 'not_issued',
      status: 'not_issued',
      materialTask: { create: { status: 'pending', updatedById: actor.id } },
      processRoute: {
        create: {
          templateName: prefix,
          templateVersion: 1,
          status: 'confirmed',
          version: 0,
          confirmedAt: new Date(),
          confirmedById: actor.id,
          steps: {
            create: {
              processCode: `${prefix}-CUT`,
              processName: '裁线',
              stageGroup: 'frontend',
              position: 1,
              sequenceGroup: 1,
              status: 'pending',
              standardSource: 'integration_test',
              timeBasis: 'per_unit',
              unitLabel: '件',
              standardMillisecondsPerUnit: 1000,
              unitsPerProduct: 1,
              countsForEfficiency: true,
            },
          },
        },
      },
    },
    include: { materialTask: true },
  });
  const order = await prisma.productionPlanOrder.create({
    data: {
      sourceOrderNo: prefix,
      sourceLineNo: 1,
      customerName: prefix,
      productName: '授权测试产品',
      specification: prefix,
      orderQuantity: 10,
      orderDate: new Date(),
      customerDueDate: new Date(),
      batches: {
        create: {
          batchNo: 1,
          quantity: 10,
          weekStartDate: new Date(),
          weekEndDate: new Date(),
          plannedCompletionDate: new Date(),
          releaseState: 'active',
          workOrderId: workOrder.id,
        },
      },
    },
    include: { batches: true },
  });
  const batch = order.batches[0];
  try {
    await prisma.$transaction(tx => assertProductionMayBeScheduled(tx, workOrder.id));
    await prisma.$transaction(tx => assertProductionMayRun(tx, workOrder.id));

    await assert.rejects(prisma.$transaction(tx => decideMaterialExecution(tx, {
      batchId: batch.id,
      allowed: true,
      expectedTaskVersion: workOrder.materialTask!.version,
      reason: '旧开关调用应被拒绝',
      actorId: actor.id,
      actorName: actor.displayName,
    })), rejectsCode('MATERIAL_EXECUTION_POLICY_RETIRED'));
    assert.equal(await prisma.$transaction(tx => startConfirmedProcessRoute(tx, {
      workOrderId: workOrder.id,
      userId: actor.id,
      actor: actor.displayName,
      now: new Date(),
      trigger: 'automatic_plan_reconciliation',
    })), true, 'automatic start is independent of material readiness');

    await prisma.warehouseMaterialTask.update({
      where: { id: workOrder.materialTask!.id },
      data: { status: 'exception', exceptionType: 'wrong_material', exceptionNote: '来料型号错误', version: { increment: 1 } },
    });
    await prisma.$transaction(tx => assertProductionMayRun(tx, workOrder.id));
  } finally {
    await prisma.productionPlanOrder.delete({ where: { id: order.id } });
    await prisma.operationLog.deleteMany({ where: { userId: actor.id } });
    await prisma.workOrder.delete({ where: { id: workOrder.id } });
    await prisma.user.delete({ where: { id: actor.id } });
  }
});
