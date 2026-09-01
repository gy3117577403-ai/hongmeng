import assert from 'node:assert/strict';
import test from 'node:test';
import {
  shouldSuppressNativeOrderForWipTarget,
  summarizeWipMovedOutForProductionOrder,
  wipContinuationsForProductionOrder,
  wipSourceLotsForProductionOrder,
} from '../lib/production-execution';
import type { WipContinuationProjection, WipSourceLotProjection } from '../lib/wip-continuations';

function continuation(input: Partial<WipContinuationProjection> & Pick<
  WipContinuationProjection,
  'allocationId' | 'lotId' | 'lotQuantity' | 'productionPlanBatchId' | 'workOrderId' | 'sourceWeekStartDate' | 'targetWeekStartDate' | 'quantity'
>): WipContinuationProjection {
  return {
    stableId: `wip:${input.allocationId}`,
    sourceAllocationId: null,
    lotNo: `LOT-${input.lotId}`,
    workOrderCode: input.workOrderId,
    batchNo: 1,
    customerName: '同一客户',
    productName: '同一品名',
    specification: '完全相同规格',
    sourceWeekEndDate: '2026-08-30',
    targetWeekEndDate: input.targetWeekStartDate === '2026-09-07' ? '2026-09-13' : '2026-09-20',
    crossWeek: input.sourceWeekStartDate !== input.targetWeekStartDate,
    completedQty: 0,
    remainingQty: input.quantity,
    plannedStandardMilliseconds: input.quantity * 1_000,
    completedStandardMilliseconds: 0,
    remainingStandardMilliseconds: input.quantity * 1_000,
    plannedHours: 0,
    completedHours: 0,
    remainingHours: 0,
    status: 'ACTIVE',
    reason: '跨周续作',
    materialWarning: null,
    team: null,
    scheduledBy: { id: 'actor-1', displayName: '计划员' },
    scheduledAt: '2026-09-01T08:00:00.000Z',
    steps: [],
    ...input,
  };
}

function sourceLot(input: Partial<WipSourceLotProjection> & Pick<
  WipSourceLotProjection,
  'lotId' | 'lotQuantity' | 'outstandingQuantity' | 'productionPlanBatchId' | 'workOrderId'
>): WipSourceLotProjection {
  return {
    lotNo: `LOT-${input.lotId}`,
    scheduledOutstandingQuantity: input.outstandingQuantity,
    sourceWeekStartDate: '2026-08-24',
    sourceWeekEndDate: '2026-08-30',
    scheduleStatus: 'SCHEDULED',
    ...input,
  };
}

const fullOrder = {
  id: 'work-order-630',
  uncompletedQty: '100',
  productionTargetQty: 100,
  completedQty: '0',
  stage: 'frontend',
  status: 'in_progress',
  productionPlanBatch: { id: 'batch-630', deletedAt: null },
};

test('historical-source carryover binds by work-order, batch and allocation identity across multiple target weeks', () => {
  const firstTarget = continuation({
    allocationId: 'allocation-40',
    lotId: 'lot-100',
    lotQuantity: 100,
    productionPlanBatchId: 'batch-630',
    workOrderId: 'work-order-630',
    sourceWeekStartDate: '2026-08-24',
    targetWeekStartDate: '2026-09-07',
    quantity: 40,
  });
  const laterTarget = continuation({
    allocationId: 'allocation-60',
    lotId: 'lot-100',
    lotQuantity: 100,
    productionPlanBatchId: 'batch-630',
    workOrderId: 'work-order-630',
    sourceWeekStartDate: '2026-08-24',
    targetWeekStartDate: '2026-09-14',
    quantity: 60,
  });
  const sameSpecificationButDifferentOrder = continuation({
    allocationId: 'allocation-wrong-order',
    lotId: 'lot-wrong-order',
    lotQuantity: 100,
    productionPlanBatchId: 'batch-other',
    workOrderId: 'work-order-other',
    sourceWeekStartDate: '2026-08-24',
    targetWeekStartDate: '2026-09-07',
    quantity: 100,
  });
  const sameOrderButDifferentBatch = continuation({
    allocationId: 'allocation-wrong-batch',
    lotId: 'lot-wrong-batch',
    lotQuantity: 100,
    productionPlanBatchId: 'batch-released-again',
    workOrderId: 'work-order-630',
    sourceWeekStartDate: '2026-08-24',
    targetWeekStartDate: '2026-09-07',
    quantity: 100,
  });
  const candidates = [
    firstTarget,
    laterTarget,
    firstTarget,
    sameSpecificationButDifferentOrder,
    sameOrderButDifferentBatch,
  ];
  const sourceLots = [sourceLot({
    lotId: 'lot-100',
    lotQuantity: 100,
    outstandingQuantity: 100,
    productionPlanBatchId: 'batch-630',
    workOrderId: 'work-order-630',
  })];

  const linked = wipContinuationsForProductionOrder(fullOrder, candidates);
  assert.deepEqual(linked.map(item => item.allocationId), ['allocation-40', 'allocation-60']);
  assert.deepEqual(wipSourceLotsForProductionOrder(fullOrder, [
    ...sourceLots,
    sourceLot({
      lotId: 'lot-wrong-batch',
      lotQuantity: 100,
      outstandingQuantity: 100,
      productionPlanBatchId: 'batch-released-again',
      workOrderId: 'work-order-630',
    }),
  ]).map(item => item.lotId), ['lot-100']);

  const carryoverSummary = summarizeWipMovedOutForProductionOrder({
    order: fullOrder,
    continuations: candidates,
    sourceLots,
    displayedWeekStartDate: '2026-08-31',
  });
  assert.ok(carryoverSummary);
  assert.equal(carryoverSummary.movedOutQuantity, 100, 'one lot split across target weeks must be counted once');
  assert.equal(carryoverSummary.visibleScheduledQuantity, 100);
  assert.equal(carryoverSummary.nativeRemainingQuantity, 0);
  assert.equal(carryoverSummary.fullyMovedOut, true);
  assert.deepEqual(carryoverSummary.targetWeeks.map(item => [item.targetWeekStartDate, item.scheduledQuantity]), [
    ['2026-09-07', 40],
    ['2026-09-14', 60],
  ]);

  assert.equal(shouldSuppressNativeOrderForWipTarget({
    order: fullOrder,
    continuations: candidates,
    sourceLots,
    displayedWeekStartDate: '2026-09-07',
  }), true, 'the full native row must not remain executable beside its target-week WIP projection');
  assert.equal(shouldSuppressNativeOrderForWipTarget({
    order: fullOrder,
    continuations: candidates,
    sourceLots,
    displayedWeekStartDate: '2026-08-31',
  }), false, 'the source/carryover week keeps a read-only historical row before the target week');
});

test('partial WIP leaves an explicit native remainder and never suppresses the original target-week row', () => {
  const partial = continuation({
    allocationId: 'allocation-partial-60',
    lotId: 'lot-partial-60',
    lotQuantity: 60,
    productionPlanBatchId: 'batch-630',
    workOrderId: 'work-order-630',
    sourceWeekStartDate: '2026-08-24',
    targetWeekStartDate: '2026-09-07',
    quantity: 60,
  });
  const summary = summarizeWipMovedOutForProductionOrder({
    order: fullOrder,
    continuations: [partial],
    sourceLots: [sourceLot({
      lotId: 'lot-partial-60',
      lotQuantity: 60,
      outstandingQuantity: 60,
      productionPlanBatchId: 'batch-630',
      workOrderId: 'work-order-630',
    })],
    displayedWeekStartDate: '2026-09-07',
  });
  assert.ok(summary);
  assert.equal(summary.movedOutQuantity, 60);
  assert.equal(summary.nativeRemainingQuantity, 40);
  assert.equal(summary.fullyMovedOut, false);
  assert.equal(shouldSuppressNativeOrderForWipTarget({
    order: fullOrder,
    continuations: [partial],
    sourceLots: [sourceLot({
      lotId: 'lot-partial-60',
      lotQuantity: 60,
      outstandingQuantity: 60,
      productionPlanBatchId: 'batch-630',
      workOrderId: 'work-order-630',
    })],
    displayedWeekStartDate: '2026-09-07',
  }), false);
});

test('completed WIP is not subtracted twice from the native executable remainder', () => {
  const completedWip = continuation({
    allocationId: 'allocation-completed-60',
    lotId: 'lot-completed-60',
    lotQuantity: 60,
    productionPlanBatchId: 'batch-630',
    workOrderId: 'work-order-630',
    sourceWeekStartDate: '2026-08-24',
    targetWeekStartDate: '2026-09-07',
    quantity: 60,
    completedQty: 60,
    remainingQty: 0,
    status: 'COMPLETED',
  });
  const sourceLots = [sourceLot({
    lotId: completedWip.lotId,
    lotQuantity: 60,
    outstandingQuantity: 0,
    productionPlanBatchId: 'batch-630',
    workOrderId: 'work-order-630',
    scheduleStatus: 'COMPLETED',
  })];
  const partiallyNativeOrder = { ...fullOrder, completedQty: '60' };
  const summary = summarizeWipMovedOutForProductionOrder({
    order: partiallyNativeOrder,
    continuations: [completedWip],
    sourceLots,
    displayedWeekStartDate: '2026-09-07',
  });
  assert.ok(summary);
  assert.equal(summary.outstandingWipQuantity, 0);
  assert.equal(summary.nativeRemainingQuantity, 40);
  assert.equal(summary.fullyMovedOut, false);
  assert.equal(shouldSuppressNativeOrderForWipTarget({
    order: partiallyNativeOrder,
    continuations: [completedWip],
    sourceLots,
    displayedWeekStartDate: '2026-09-07',
  }), false);

  const completedFullWipOrder = { ...fullOrder, completedQty: '100', stage: 'completed', status: 'completed' };
  const completedFullLot = [sourceLot({
    lotId: 'lot-completed-100',
    lotQuantity: 100,
    outstandingQuantity: 0,
    productionPlanBatchId: 'batch-630',
    workOrderId: 'work-order-630',
    scheduleStatus: 'COMPLETED',
  })];
  const completedFullAllocation = continuation({
    allocationId: 'allocation-completed-100',
    lotId: 'lot-completed-100',
    lotQuantity: 100,
    productionPlanBatchId: 'batch-630',
    workOrderId: 'work-order-630',
    sourceWeekStartDate: '2026-08-24',
    targetWeekStartDate: '2026-09-07',
    quantity: 100,
    completedQty: 100,
    remainingQty: 0,
    status: 'COMPLETED',
  });
  assert.equal(shouldSuppressNativeOrderForWipTarget({
    order: completedFullWipOrder,
    continuations: [completedFullAllocation],
    sourceLots: completedFullLot,
    displayedWeekStartDate: '2026-09-07',
  }), true, 'a fully completed WIP target still owns the single target-week projection');
});

test('an unscheduled WIP lot immediately removes source quantity without inventing a target week', () => {
  const unscheduledLot = sourceLot({
    lotId: 'lot-unscheduled-100',
    lotQuantity: 100,
    outstandingQuantity: 100,
    scheduledOutstandingQuantity: 0,
    productionPlanBatchId: 'batch-630',
    workOrderId: 'work-order-630',
    scheduleStatus: 'UNSCHEDULED',
  });
  const summary = summarizeWipMovedOutForProductionOrder({
    order: fullOrder,
    continuations: [],
    sourceLots: [unscheduledLot],
    displayedWeekStartDate: '2026-08-31',
  });
  assert.ok(summary);
  assert.equal(summary.movedOutQuantity, 100);
  assert.equal(summary.outstandingWipQuantity, 100);
  assert.equal(summary.unscheduledWipQuantity, 100);
  assert.equal(summary.nativeRemainingQuantity, 0);
  assert.equal(summary.fullyMovedOut, true);
  assert.deepEqual(summary.targetWeeks, []);
  assert.equal(shouldSuppressNativeOrderForWipTarget({
    order: fullOrder,
    continuations: [],
    sourceLots: [unscheduledLot],
    displayedWeekStartDate: '2026-08-31',
  }), false, 'without a target allocation the source fact stays visible, but its actions can be read-only');
});
