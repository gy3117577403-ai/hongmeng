import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareProductionQuantityAdjustment } from '../lib/production-quantity-adjustment';

test('missing quantity can be supplemented without changing the drawing stage', () => {
  const result = prepareProductionQuantityAdjustment({
    targetQty: '500', frontendTransferredQty: '0', completedQty: '0', currentStage: 'not_issued',
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value, {
    targetQty: 500,
    frontendTransferredQty: 0,
    completedQty: 0,
    frontendRemainingQty: 500,
    backendRemainingQty: 0,
    nextStage: 'not_issued',
    stageQuantity: 500,
    percentage: 0,
    reopensCompletedOrder: false,
  });
});

test('T=500 F=360 C=200 derives current stage quantity and percentage', () => {
  const result = prepareProductionQuantityAdjustment({
    targetQty: 500, frontendTransferredQty: 360, completedQty: 200, currentStage: 'frontend',
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.nextStage, 'frontend');
  assert.equal(result.value.stageQuantity, 140);
  assert.equal(result.value.frontendRemainingQty, 140);
  assert.equal(result.value.backendRemainingQty, 160);
  assert.equal(result.value.percentage, 40);
});

test('changing a completed order to a larger target explicitly reports reopening', () => {
  const result = prepareProductionQuantityAdjustment({
    targetQty: 600, frontendTransferredQty: 500, completedQty: 500, currentStage: 'completed',
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.nextStage, 'frontend');
  assert.equal(result.value.stageQuantity, 100);
  assert.equal(result.value.reopensCompletedOrder, true);
});

test('completed, transferred and target quantities must satisfy C <= F <= T', () => {
  const completedOverTransferred = prepareProductionQuantityAdjustment({
    targetQty: 100, frontendTransferredQty: 50, completedQty: 51, currentStage: 'backend',
  });
  assert.equal(completedOverTransferred.ok, false);
  if (!completedOverTransferred.ok) assert.equal(completedOverTransferred.code, 'COMPLETED_EXCEEDS_TRANSFERRED');

  const transferredOverTarget = prepareProductionQuantityAdjustment({
    targetQty: 100, frontendTransferredQty: 101, completedQty: 50, currentStage: 'frontend',
  });
  assert.equal(transferredOverTarget.ok, false);
  if (!transferredOverTarget.ok) assert.equal(transferredOverTarget.code, 'TRANSFERRED_EXCEEDS_TARGET');

  const zeroTarget = prepareProductionQuantityAdjustment({
    targetQty: 0, frontendTransferredQty: 0, completedQty: 0, currentStage: 'not_issued',
  });
  assert.equal(zeroTarget.ok, false);
  if (!zeroTarget.ok) assert.equal(zeroTarget.code, 'INVALID_TARGET_QUANTITY');
});
