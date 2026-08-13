import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertActionFlowDoesNotExceedReportedOutput,
  processReportTargetQuantity,
  resolveProcessReportQuantities,
} from '@/lib/process-report-quantity';

test('action reporting expands a 50-set target into 4,800 terminal actions', () => {
  assert.equal(processReportTargetQuantity({
    productTargetQty: 50,
    basis: 'action',
    unitsPerProduct: 96,
  }), 4_800);
});

test('action quantities stay separate from product-flow quantities', () => {
  assert.deepEqual(resolveProcessReportQuantities({
    basis: 'action',
    productProcessedQty: 1,
    productDefectQty: 0,
    reportedUnitQty: 100,
    reportedDefectUnitQty: 4,
  }), {
    reportedUnitQty: 100,
    reportedGoodUnitQty: 96,
    reportedDefectUnitQty: 4,
    productGoodQty: 1,
  });
});

test('product flow cannot claim more full sets than cumulative good actions support', () => {
  assert.throws(() => assertActionFlowDoesNotExceedReportedOutput({
    unitsPerProduct: 96,
    previousProductGoodQty: 0,
    nextProductGoodQty: 1,
    previousReportedGoodUnitQty: 0,
    nextReportedGoodUnitQty: 95,
  }), /累计整套良品超过动作产出/);
  assert.doesNotThrow(() => assertActionFlowDoesNotExceedReportedOutput({
    unitsPerProduct: 96,
    previousProductGoodQty: 1,
    nextProductGoodQty: 1,
    previousReportedGoodUnitQty: 100,
    nextReportedGoodUnitQty: 92,
  }));
});
