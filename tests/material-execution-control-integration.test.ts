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

test('material execution authorization gates execution, not planning, and expires on warehouse version change', {
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
    await assert.rejects(
      prisma.$transaction(tx => assertProductionMayRun(tx, workOrder.id)),
      rejectsCode('MATERIAL_EXECUTION_NOT_AUTHORIZED'),
    );

    const allowed = await prisma.$transaction(tx => decideMaterialExecution(tx, {
      batchId: batch.id,
      allowed: true,
      expectedTaskVersion: workOrder.materialTask!.version,
      reason: '客户交期紧急，计划确认先行生产',
      actorId: actor.id,
      actorName: actor.displayName,
    }));
    assert.equal(allowed.effectiveAllowed, true);
    await prisma.$transaction(tx => assertProductionMayRun(tx, workOrder.id));
    assert.equal(await prisma.$transaction(tx => startConfirmedProcessRoute(tx, {
      workOrderId: workOrder.id,
      userId: actor.id,
      actor: actor.displayName,
      now: new Date(),
      trigger: 'automatic_plan_reconciliation',
    })), false, 'risk authorization never permits automatic start');
    assert.equal(await prisma.$transaction(tx => startConfirmedProcessRoute(tx, {
      workOrderId: workOrder.id,
      userId: actor.id,
      actor: actor.displayName,
      now: new Date(),
      trigger: 'manual_start',
    })), true, 'risk authorization permits an explicit manual start');
    assert.equal(await prisma.productionPlanChange.count({
      where: { batchId: batch.id, action: 'allow_material_risk_execution' },
    }), 1);
    assert.equal(await prisma.operationLog.count({
      where: { targetId: batch.id, action: 'allow_material_risk_execution' },
    }), 1);

    await prisma.warehouseMaterialTask.update({
      where: { id: workOrder.materialTask!.id },
      data: { status: 'exception', exceptionType: 'shortage', exceptionNote: '端子缺料', version: { increment: 1 } },
    });
    await assert.rejects(
      prisma.$transaction(tx => assertProductionMayRun(tx, workOrder.id)),
      rejectsCode('MATERIAL_EXECUTION_NOT_AUTHORIZED'),
    );
  } finally {
    await prisma.productionPlanOrder.delete({ where: { id: order.id } });
    await prisma.operationLog.deleteMany({ where: { userId: actor.id } });
    await prisma.workOrder.delete({ where: { id: workOrder.id } });
    await prisma.user.delete({ where: { id: actor.id } });
  }
});
