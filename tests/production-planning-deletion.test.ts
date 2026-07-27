import assert from 'node:assert/strict';
import test from 'node:test';
import {
  productionPlanOrderDeletionDisposition,
  productionPlanWorkOrderStartBlocker,
  type ProductionPlanDeletionWorkOrderState,
} from '../lib/production-planning';

function untouched(overrides: Partial<ProductionPlanDeletionWorkOrderState> = {}): ProductionPlanDeletionWorkOrderState {
  return {
    stage: 'not_issued',
    status: 'pending',
    progress: 0,
    startedAt: null,
    completedAt: null,
    lastProgressAt: null,
    completedQty: null,
    frontendTransferredQty: null,
    progressLogCount: 0,
    processRoute: {
      status: 'confirmed',
      startedAt: null,
      completedAt: null,
      steps: [{ status: 'pending', startedAt: null, completedAt: null, executionCount: 0 }],
    },
    ...overrides,
  };
}

test('unreleased or released-but-unstarted plans remain deletable', () => {
  assert.equal(productionPlanWorkOrderStartBlocker(null), null);
  assert.equal(productionPlanWorkOrderStartBlocker(untouched()), null);
});

test('production start signals block plan deletion', () => {
  assert.match(productionPlanWorkOrderStartBlocker(untouched({ startedAt: new Date() })) || '', /开始执行/);
  assert.match(productionPlanWorkOrderStartBlocker(untouched({ frontendTransferredQty: 1 })) || '', /开始执行/);
  assert.match(productionPlanWorkOrderStartBlocker(untouched({ completedQty: '10 套' })) || '', /开始执行/);
  assert.match(productionPlanWorkOrderStartBlocker(untouched({ progressLogCount: 1 })) || '', /开始执行/);
});

test('process execution and completed work orders block plan deletion', () => {
  assert.match(productionPlanWorkOrderStartBlocker(untouched({
    processRoute: {
      status: 'in_progress',
      startedAt: new Date(),
      completedAt: null,
      steps: [{ status: 'current', startedAt: new Date(), completedAt: null, executionCount: 1 }],
    },
  })) || '', /工序执行记录/);
  assert.match(productionPlanWorkOrderStartBlocker(untouched({ stage: 'completed', completedAt: new Date() })) || '', /已经完成/);
});

test('deleting a fully scheduled imported plan removes the empty planning order', () => {
  assert.deepEqual(productionPlanOrderDeletionDisposition({
    orderQuantity: 300,
    activeBatchQuantity: 0,
    removedBatchQuantity: 300,
  }), {
    nextOrderQuantity: 0,
    activeBatchQuantity: 0,
    removedBatchQuantity: 300,
    shouldDeleteOrder: true,
  });
});

test('deleted batch quantity is removed without consuming pre-existing unscheduled quantity', () => {
  assert.deepEqual(productionPlanOrderDeletionDisposition({
    orderQuantity: 100,
    activeBatchQuantity: 20,
    removedBatchQuantity: 40,
  }), {
    nextOrderQuantity: 60,
    activeBatchQuantity: 20,
    removedBatchQuantity: 40,
    shouldDeleteOrder: false,
  });
});

test('remaining active batches keep the plan order consistent when legacy totals are stale', () => {
  assert.deepEqual(productionPlanOrderDeletionDisposition({
    orderQuantity: 30,
    activeBatchQuantity: 40,
    removedBatchQuantity: 10,
  }), {
    nextOrderQuantity: 40,
    activeBatchQuantity: 40,
    removedBatchQuantity: 10,
    shouldDeleteOrder: false,
  });
});
