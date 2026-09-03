import assert from 'node:assert/strict';
import test from 'node:test';
import type { Prisma } from '@prisma/client';
import {
  loadOutstandingWipByProcess,
  nativeCheckpointCompletedQuantity,
  nativeExecutableQuantity,
  outstandingWipQuantity,
  wipOwnershipKey,
} from '../lib/wip-native-ownership';

test('native execution excludes only WIP quantity that is still outstanding', () => {
  assert.equal(nativeExecutableQuantity({
    batchQuantity: 100,
    processedQuantity: 0,
    outstandingWipQuantity: 60,
  }), 40);

  assert.equal(nativeExecutableQuantity({
    batchQuantity: 100,
    processedQuantity: 60,
    outstandingWipQuantity: 0,
  }), 40, 'completed WIP already changed process facts and must not be deducted twice');

  assert.equal(nativeExecutableQuantity({
    batchQuantity: 100,
    processedQuantity: 60,
    outstandingWipQuantity: 40,
  }), 0, 'a fully transferred lot may be partially reported while retaining no native quantity');
});

test('outstanding ownership retains unreported quantity and ignores over-credit drift', () => {
  assert.equal(outstandingWipQuantity({ remainingQty: 100, creditedQuantities: [25, 15] }), 60);
  assert.equal(outstandingWipQuantity({ remainingQty: 100, creditedQuantities: [70, 50] }), 0);
  assert.equal(outstandingWipQuantity({ remainingQty: 100, creditedQuantities: [] }), 100);
});

test('a completed first WIP transfer is not reused as the checkpoint of a later transfer', () => {
  assert.equal(nativeCheckpointCompletedQuantity({
    stepGoodOutputQuantity: 40,
    finalGoodOutputQuantity: 10,
    outstandingWipQuantity: 0,
  }), 30, 'only intermediate native progress remains available at an upstream step');

  assert.equal(nativeCheckpointCompletedQuantity({
    stepGoodOutputQuantity: 10,
    finalGoodOutputQuantity: 10,
    outstandingWipQuantity: 0,
  }), 0, 'final output from the earlier WIP lot cannot complete the new lot');

  assert.equal(nativeCheckpointCompletedQuantity({
    stepGoodOutputQuantity: 40,
    finalGoodOutputQuantity: 5,
    outstandingWipQuantity: 10,
  }), 25, 'finished output and still-owned WIP are each deducted exactly once');
});

test('WIP ownership keys bind work-order and process identities', () => {
  assert.equal(
    wipOwnershipKey('work-order-1', 'batch-7', 'step-2'),
    'work-order-1:batch-7:step-2',
  );
});

test('ownership aggregation is batch-bound and sums only requested process rows', async () => {
  const client = {
    semiFinishedLotStep: {
      findMany: async () => [
        {
          stepId: 'step-2',
          remainingQty: 100,
          lot: { workOrderId: 'work-order-1', productionPlanBatchId: 'batch-7' },
          allocationSteps: [{ credits: [{ quantity: 40 }] }],
        },
        {
          stepId: 'step-2',
          remainingQty: 20,
          lot: { workOrderId: 'work-order-1', productionPlanBatchId: 'batch-7' },
          allocationSteps: [{ credits: [] }],
        },
        {
          stepId: 'step-2',
          remainingQty: 999,
          lot: { workOrderId: 'work-order-1', productionPlanBatchId: 'different-batch' },
          allocationSteps: [{ credits: [] }],
        },
      ],
    },
  } as unknown as Prisma.TransactionClient;

  const result = await loadOutstandingWipByProcess(client, [{
    workOrderId: 'work-order-1',
    productionPlanBatchId: 'batch-7',
    stepId: 'step-2',
  }]);
  assert.equal(result.get(wipOwnershipKey('work-order-1', 'batch-7', 'step-2')), 80);
  assert.equal(result.size, 1);
});
