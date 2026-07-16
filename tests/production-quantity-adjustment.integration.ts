import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { prisma } from '../lib/prisma';
import {
  adjustProductionQuantities,
  ProductionQuantityAdjustmentServiceError,
} from '../lib/production-quantity-adjustment-service';

const runId = randomUUID().slice(0, 8);
const userId = randomUUID();
const actor = `quantity-test-${runId}`;
const workOrderIds: string[] = [];

async function createOrder(input: {
  suffix: string;
  stage: 'not_issued' | 'frontend' | 'backend' | 'completed';
  importedTarget?: string | null;
  targetOverride?: number | null;
  completed?: string | null;
  transferred?: number | null;
}) {
  const order = await prisma.workOrder.create({
    data: {
      code: `QTY-IT-${runId}-${input.suffix}`,
      productName: '生产数量校正隔离测试',
      customerName: '隔离测试客户',
      specification: `QTY-${runId}-${input.suffix}`,
      stage: input.stage,
      status: input.stage === 'completed' ? 'done' : input.stage === 'not_issued' ? 'pending' : 'processing',
      uncompletedQty: input.importedTarget ?? null,
      productionTargetQty: input.targetOverride ?? null,
      completedQty: input.completed ?? null,
      frontendTransferredQty: input.transferred ?? null,
      completedAt: input.stage === 'completed' ? new Date() : null,
      planType: 'weekly_plan',
      planActive: true,
      weekStartDate: new Date('2026-07-13T00:00:00+08:00'),
      weekEndDate: new Date('2026-07-19T00:00:00+08:00'),
    },
  });
  workOrderIds.push(order.id);
  return order;
}

function adjust(orderId: string, input: {
  targetQty: number;
  frontendTransferredQty: number;
  completedQty: number;
  expectedVersion: number;
  reason?: string;
  confirmReopen?: boolean;
}) {
  return adjustProductionQuantities({ workOrderId: orderId, userId, actor, ...input, reason: input.reason ?? '' });
}

async function main(): Promise<void> {
  await prisma.user.create({
    data: {
      id: userId,
      username: actor,
      displayName: '生产数量校正隔离测试',
      passwordHash: 'integration-test-placeholder',
    },
  });

  const missing = await createOrder({ suffix: 'MISSING', stage: 'not_issued' });
  const supplemented = await adjust(missing.id, {
    targetQty: 120, frontendTransferredQty: 0, completedQty: 0, expectedVersion: 0,
  });
  assert.equal(supplemented.uncompletedQty, null);
  assert.equal(supplemented.productionTargetQty, 120);
  assert.equal(supplemented.frontendTransferredQty, 0);
  assert.equal(supplemented.completedQty, '0');
  assert.equal(supplemented.stage, 'not_issued');
  assert.equal(supplemented.executionVersion, 1);

  const imported = await createOrder({ suffix: 'IMPORTED', stage: 'frontend', importedTarget: '100', completed: '0', transferred: 0 });
  const corrected = await adjust(imported.id, {
    targetQty: 120, frontendTransferredQty: 20, completedQty: 5, expectedVersion: 0, reason: '现场复核总量',
  });
  assert.equal(corrected.uncompletedQty, '100');
  assert.equal(corrected.productionTargetQty, 120);
  assert.equal(corrected.frontendTransferredQty, 20);
  assert.equal(corrected.completedQty, '5');

  const restoredToPlan = await adjust(imported.id, {
    targetQty: 100, frontendTransferredQty: 20, completedQty: 5, expectedVersion: 1, reason: '恢复周计划总量',
  });
  assert.equal(restoredToPlan.uncompletedQty, '100');
  assert.equal(restoredToPlan.productionTargetQty, null);

  const completed = await createOrder({ suffix: 'REOPEN', stage: 'completed', importedTarget: '100', completed: '100', transferred: 100 });
  await assert.rejects(
    () => adjust(completed.id, {
      targetQty: 120, frontendTransferredQty: 100, completedQty: 100, expectedVersion: 0, reason: '追加生产目标',
    }),
    (error: unknown) => error instanceof ProductionQuantityAdjustmentServiceError && error.code === 'REOPEN_CONFIRMATION_REQUIRED',
  );
  const reopened = await adjust(completed.id, {
    targetQty: 120, frontendTransferredQty: 100, completedQty: 100, expectedVersion: 0,
    reason: '追加生产目标', confirmReopen: true,
  });
  assert.equal(reopened.stage, 'frontend');
  assert.equal(reopened.completedAt, null);
  assert.equal(reopened.productionTargetQty, 120);

  const invalidBefore = await prisma.workOrder.findUniqueOrThrow({ where: { id: imported.id } });
  await assert.rejects(
    () => adjust(imported.id, {
      targetQty: 10, frontendTransferredQty: 20, completedQty: 5,
      expectedVersion: invalidBefore.executionVersion, reason: '错误关系校验',
    }),
    (error: unknown) => error instanceof ProductionQuantityAdjustmentServiceError && error.code === 'TRANSFERRED_EXCEEDS_TARGET',
  );
  const invalidAfter = await prisma.workOrder.findUniqueOrThrow({ where: { id: imported.id } });
  assert.equal(invalidAfter.executionVersion, invalidBefore.executionVersion);
  assert.equal(invalidAfter.productionTargetQty, null);

  const concurrent = await createOrder({ suffix: 'CONCURRENT', stage: 'frontend', importedTarget: '100', completed: '0', transferred: 0 });
  const concurrentResults = await Promise.allSettled([
    adjust(concurrent.id, { targetQty: 110, frontendTransferredQty: 10, completedQty: 0, expectedVersion: 0, reason: '并发校正测试' }),
    adjust(concurrent.id, { targetQty: 110, frontendTransferredQty: 10, completedQty: 0, expectedVersion: 0, reason: '并发校正测试' }),
  ]);
  assert.equal(concurrentResults.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(concurrentResults.filter(result => result.status === 'rejected').length, 1);
  const concurrentAfter = await prisma.workOrder.findUniqueOrThrow({ where: { id: concurrent.id } });
  assert.equal(concurrentAfter.executionVersion, 1);

  const successLogs = await prisma.operationLog.count({
    where: { targetId: { in: workOrderIds }, action: 'correct_work_order_quantities' },
  });
  const snapshots = await prisma.dataChangeSnapshot.count({
    where: { entityId: { in: workOrderIds }, action: 'correct_work_order_quantities' },
  });
  const progressLogs = await prisma.workOrderProgressLog.count({
    where: { workOrderId: { in: workOrderIds }, remark: { startsWith: '数量校正：' } },
  });
  assert.equal(successLogs, 5);
  assert.equal(snapshots, 5);
  assert.equal(progressLogs, 5);

  console.log(JSON.stringify({
    ok: true,
    supplementedWithoutPlanReupload: true,
    importedTargetPreserved: true,
    completedReopenConfirmed: true,
    concurrentSuccesses: 1,
    concurrentConflicts: 1,
    operationLogs: successLogs,
    snapshots,
    progressLogs,
  }));
}

async function cleanup(): Promise<void> {
  if (workOrderIds.length) {
    await prisma.dataChangeSnapshot.deleteMany({ where: { entityId: { in: workOrderIds } } });
    await prisma.operationLog.deleteMany({ where: { targetId: { in: workOrderIds } } });
    await prisma.workOrderProgressLog.deleteMany({ where: { workOrderId: { in: workOrderIds } } });
    await prisma.workOrder.deleteMany({ where: { id: { in: workOrderIds } } });
  }
  await prisma.operationLog.deleteMany({ where: { userId } });
  await prisma.user.deleteMany({ where: { id: userId } });
}

main()
  .finally(cleanup)
  .finally(() => prisma.$disconnect())
  .catch(error => {
    console.error(error instanceof Error ? error.message : 'production quantity adjustment integration failed');
    process.exitCode = 1;
  });
