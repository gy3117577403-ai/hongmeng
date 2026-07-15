import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { prisma } from '../lib/prisma';
import { resolveEffectiveFrontendTransferredQty } from '../lib/production-stage-flow';
import { applyProductionStageFlow, ProductionStageFlowServiceError } from '../lib/production-stage-flow-service';

const runId = randomUUID().slice(0, 8);
const userId = randomUUID();
const actor = `flow-test-${runId}`;
const workOrderIds: string[] = [];

async function createOrder(input: {
  suffix: string;
  stage: 'not_issued' | 'frontend' | 'backend' | 'completed';
  target: string;
  completed?: string | null;
  transferred?: number | null;
}) {
  const order = await prisma.workOrder.create({
    data: {
      code: `FLOW-IT-${runId}-${input.suffix}`,
      productName: '生产数量流转隔离测试',
      customerName: '隔离测试客户',
      specification: `FLOW-${runId}-${input.suffix}`,
      stage: input.stage,
      status: input.stage === 'completed' ? 'done' : input.stage === 'not_issued' ? 'pending' : 'processing',
      uncompletedQty: input.target,
      completedQty: input.completed ?? null,
      frontendTransferredQty: input.transferred,
      planType: 'weekly_plan',
      planActive: true,
      weekStartDate: new Date('2026-07-13T00:00:00+08:00'),
      weekEndDate: new Date('2026-07-19T00:00:00+08:00'),
    },
  });
  workOrderIds.push(order.id);
  return order;
}

async function flow(orderId: string, action: 'confirm_drawing_issued' | 'transfer_to_backend' | 'complete_from_backend', quantity: number | undefined, expectedVersion: number) {
  return applyProductionStageFlow({
    workOrderId: orderId,
    action,
    quantity,
    expectedVersion,
    userId,
    actor,
  });
}

async function main(): Promise<void> {
  await prisma.user.create({
    data: {
      id: userId,
      username: actor,
      displayName: '生产数量流转隔离测试',
      passwordHash: 'integration-test-placeholder',
    },
  });

  const notIssued = await createOrder({ suffix: 'DRAWING', stage: 'not_issued', target: '500' });
  const drawingConfirmed = await flow(notIssued.id, 'confirm_drawing_issued', undefined, 0);
  assert.equal(drawingConfirmed.stage, 'frontend');
  assert.equal(drawingConfirmed.frontendTransferredQty, 0);
  assert.equal(drawingConfirmed.executionVersion, 1);
  assert.equal(drawingConfirmed.drawingStatus, '已发');

  const partial = await createOrder({ suffix: 'PARTIAL', stage: 'frontend', target: '500', completed: '0' });
  const transferred = await flow(partial.id, 'transfer_to_backend', 360, 0);
  assert.equal(transferred.frontendTransferredQty, 360);
  assert.equal(transferred.completedQty, '0');
  assert.equal(transferred.stage, 'frontend');
  assert.equal(transferred.executionVersion, 1);

  const partiallyCompleted = await flow(partial.id, 'complete_from_backend', 200, 1);
  assert.equal(partiallyCompleted.frontendTransferredQty, 360);
  assert.equal(partiallyCompleted.completedQty, '200');
  assert.equal(partiallyCompleted.stage, 'frontend');
  assert.equal(partiallyCompleted.executionVersion, 2);
  const partialState = resolveEffectiveFrontendTransferredQty(partiallyCompleted);
  assert.equal(partialState.ok, true);
  if (partialState.ok) {
    assert.deepEqual(partialState.state.segments, [
      { stage: 'frontend', quantity: 140 },
      { stage: 'backend', quantity: 160 },
      { stage: 'completed', quantity: 200 },
    ]);
  }

  const fullyTransferred = await flow(partial.id, 'transfer_to_backend', 140, 2);
  assert.equal(fullyTransferred.stage, 'backend');
  assert.equal(fullyTransferred.frontendTransferredQty, 500);
  const fullyCompleted = await flow(partial.id, 'complete_from_backend', 300, 3);
  assert.equal(fullyCompleted.stage, 'completed');
  assert.equal(fullyCompleted.completedQty, '500');
  assert.equal(fullyCompleted.executionVersion, 4);

  const legacyBackend = await createOrder({ suffix: 'LEGACY-BACKEND', stage: 'backend', target: '500', completed: '200' });
  const legacyMaterialized = await flow(legacyBackend.id, 'complete_from_backend', 100, 0);
  assert.equal(legacyMaterialized.frontendTransferredQty, 500);
  assert.equal(legacyMaterialized.completedQty, '300');
  assert.equal(legacyMaterialized.executionVersion, 1);

  const concurrent = await createOrder({ suffix: 'CONCURRENT', stage: 'frontend', target: '100', completed: '0' });
  const concurrentResults = await Promise.allSettled([
    flow(concurrent.id, 'transfer_to_backend', 60, 0),
    flow(concurrent.id, 'transfer_to_backend', 60, 0),
  ]);
  assert.equal(concurrentResults.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(concurrentResults.filter(result => result.status === 'rejected').length, 1);
  const concurrentAfter = await prisma.workOrder.findUniqueOrThrow({ where: { id: concurrent.id } });
  assert.equal(concurrentAfter.frontendTransferredQty, 60);
  assert.equal(concurrentAfter.executionVersion, 1);
  const rejected = concurrentResults.find(result => result.status === 'rejected');
  assert.ok(rejected && rejected.status === 'rejected' && rejected.reason instanceof ProductionStageFlowServiceError);
  if (rejected && rejected.status === 'rejected' && rejected.reason instanceof ProductionStageFlowServiceError) {
    assert.equal(rejected.reason.status, 409);
    assert.equal(rejected.reason.message, '工单进度已被其他操作更新，请刷新后重试');
  }

  await assert.rejects(
    () => flow(concurrent.id, 'transfer_to_backend', 50, 0),
    (error: unknown) => error instanceof ProductionStageFlowServiceError && error.status === 409,
  );
  const unchangedAfterRetry = await prisma.workOrder.findUniqueOrThrow({ where: { id: concurrent.id } });
  assert.equal(unchangedAfterRetry.frontendTransferredQty, 60);
  assert.equal(unchangedAfterRetry.executionVersion, 1);

  const overQuantity = await createOrder({ suffix: 'OVER', stage: 'frontend', target: '20', completed: '0' });
  await assert.rejects(
    () => flow(overQuantity.id, 'transfer_to_backend', 21, 0),
    (error: unknown) => error instanceof ProductionStageFlowServiceError && error.code === 'TRANSFER_QUANTITY_EXCEEDS_REMAINING',
  );
  const overAfter = await prisma.workOrder.findUniqueOrThrow({ where: { id: overQuantity.id } });
  assert.equal(overAfter.frontendTransferredQty, null);
  assert.equal(overAfter.executionVersion, 0);

  const backendOverQuantity = await createOrder({
    suffix: 'OVER-BACKEND',
    stage: 'backend',
    target: '20',
    completed: '10',
    transferred: 20,
  });
  await assert.rejects(
    () => flow(backendOverQuantity.id, 'complete_from_backend', 11, 0),
    (error: unknown) => error instanceof ProductionStageFlowServiceError && error.code === 'COMPLETION_QUANTITY_EXCEEDS_REMAINING',
  );
  const backendOverAfter = await prisma.workOrder.findUniqueOrThrow({ where: { id: backendOverQuantity.id } });
  assert.equal(backendOverAfter.frontendTransferredQty, 20);
  assert.equal(backendOverAfter.completedQty, '10');
  assert.equal(backendOverAfter.executionVersion, 0);

  const failedOperationLogs = await prisma.operationLog.findMany({
    where: { targetId: { in: [concurrent.id, overQuantity.id, backendOverQuantity.id] } },
  });
  const auditedFailures = failedOperationLogs.filter(log => {
    const detail = log.detail;
    return typeof detail === 'object'
      && detail !== null
      && !Array.isArray(detail)
      && detail.status === 'failed'
      && detail.after === null;
  });
  assert.ok(auditedFailures.length >= 3);
  assert.ok(auditedFailures.some(log => {
    const detail = log.detail;
    return typeof detail === 'object'
      && detail !== null
      && !Array.isArray(detail)
      && detail.code === 'COMPLETION_QUANTITY_EXCEEDS_REMAINING'
      && detail.quantity === 11
      && detail.before !== null;
  }));

  const orderCount = await prisma.workOrder.count({ where: { id: { in: workOrderIds } } });
  const resourceCount = await prisma.resourceFile.count({ where: { workOrderId: { in: workOrderIds } } });
  assert.equal(orderCount, workOrderIds.length);
  assert.equal(resourceCount, 0);

  const partialProgressLogs = await prisma.workOrderProgressLog.count({ where: { workOrderId: partial.id } });
  const partialOperationLogs = await prisma.operationLog.count({
    where: { targetId: partial.id, action: { in: ['transfer_to_backend', 'complete_from_backend'] } },
  });
  const partialSnapshots = await prisma.dataChangeSnapshot.count({
    where: { entityId: partial.id, action: { in: ['transfer_to_backend', 'complete_from_backend'] } },
  });
  assert.equal(partialProgressLogs, 4);
  assert.equal(partialOperationLogs, 4);
  assert.equal(partialSnapshots, 4);

  console.log(JSON.stringify({
    ok: true,
    workOrders: workOrderIds.length,
    noDuplicatedWorkOrders: orderCount === workOrderIds.length,
    noDuplicatedResources: resourceCount === 0,
    concurrentSuccesses: 1,
    concurrentConflicts: 1,
    auditedFailures: auditedFailures.length,
    snapshots: partialSnapshots,
    operationLogs: partialOperationLogs,
  }));
}

async function cleanup(): Promise<void> {
  if (workOrderIds.length) {
    await prisma.dataChangeSnapshot.deleteMany({ where: { entityId: { in: workOrderIds } } });
    await prisma.operationLog.deleteMany({ where: { targetId: { in: workOrderIds } } });
    await prisma.workOrderProgressLog.deleteMany({ where: { workOrderId: { in: workOrderIds } } });
    await prisma.resourceFile.deleteMany({ where: { workOrderId: { in: workOrderIds } } });
    await prisma.workOrder.deleteMany({ where: { id: { in: workOrderIds } } });
  }
  await prisma.operationLog.deleteMany({ where: { userId } });
  await prisma.user.deleteMany({ where: { id: userId } });
}

main()
  .finally(cleanup)
  .finally(() => prisma.$disconnect())
  .catch(error => {
    console.error(error instanceof Error ? error.message : 'production stage flow integration failed');
    process.exitCode = 1;
  });
