import assert from 'node:assert/strict';
import test from 'node:test';
import { formatProductionPercentage, getProductionQuantitySummary } from '../lib/production-quantity';
import {
  compatibleStageForQuantities,
  parsePositiveProductionQuantity,
  productionStageSegments,
  resolveEffectiveFrontendTransferredQty,
} from '../lib/production-stage-flow';

test('3000 / 2990 shows 99.7% and 10 remaining', () => {
  const result = getProductionQuantitySummary({ uncompletedQty: '3,000套', completedQty: '2990', stage: 'backend' });
  assert.deepEqual(result, {
    targetQty: 3000, completedQty: 2990, remainingQty: 10, overrunQty: 0, percentage: 99.7, status: 'in_progress',
  });
  assert.equal(formatProductionPercentage(result.percentage), '99.7%');
});

test('3000 / 3000 is complete', () => {
  const result = getProductionQuantitySummary({ uncompletedQty: '3000', completedQty: '3000', stage: 'backend' });
  assert.equal(result.status, 'complete');
  assert.equal(result.remainingQty, 0);
  assert.equal(formatProductionPercentage(result.percentage), '100%');
});

test('3000 / 3050 is 101.7% with 50 overrun', () => {
  const result = getProductionQuantitySummary({ uncompletedQty: '3000', completedQty: '3050', stage: 'completed' });
  assert.equal(result.status, 'overrun');
  assert.equal(result.overrunQty, 50);
  assert.equal(formatProductionPercentage(result.percentage), '101.7%');
});

test('missing target is unknown', () => {
  assert.equal(getProductionQuantitySummary({ completedQty: '10', stage: 'frontend' }).status, 'unknown');
});

test('manual production target overrides the imported plan quantity without changing it', () => {
  const result = getProductionQuantitySummary({
    uncompletedQty: '500', productionTargetQty: 600, completedQty: '300', stage: 'frontend',
  });
  assert.equal(result.targetQty, 600);
  assert.equal(result.remainingQty, 300);
  assert.equal(result.percentage, 50);

  const flow = resolveEffectiveFrontendTransferredQty({
    uncompletedQty: '500', productionTargetQty: 600, completedQty: '300',
    frontendTransferredQty: 400, executionVersion: 2, stage: 'frontend',
  });
  assert.equal(flow.ok, true);
  if (flow.ok) assert.equal(flow.state.targetQty, 600);
});

test('missing completed quantity defaults to zero', () => {
  const result = getProductionQuantitySummary({ uncompletedQty: '3000', completedQty: '', stage: 'frontend' });
  assert.equal(result.completedQty, 0);
  assert.equal(result.remainingQty, 3000);
});

test('negative quantities are invalid', () => {
  assert.equal(getProductionQuantitySummary({ uncompletedQty: '-3', completedQty: '0' }).status, 'unknown');
  assert.equal(getProductionQuantitySummary({ uncompletedQty: '3', completedQty: '-1' }).status, 'unknown');
});

test('completed stage with remaining quantity is tail remaining', () => {
  const result = getProductionQuantitySummary({ uncompletedQty: '3000', completedQty: '2990', stage: 'completed' });
  assert.equal(result.status, 'tail_remaining');
  assert.equal(result.remainingQty, 10);
});

test('legacy stages derive effective transferred quantity without backfill', () => {
  const cases = [
    { stage: 'not_issued', completedQty: null, transferred: 0, segments: [{ stage: 'not_issued', quantity: 500 }] },
    { stage: 'frontend', completedQty: '0', transferred: 0, segments: [{ stage: 'frontend', quantity: 500 }] },
    { stage: 'backend', completedQty: '200', transferred: 500, segments: [{ stage: 'backend', quantity: 300 }, { stage: 'completed', quantity: 200 }] },
    { stage: 'completed', completedQty: '500', transferred: 500, segments: [{ stage: 'completed', quantity: 500 }] },
  ];
  for (const item of cases) {
    const result = resolveEffectiveFrontendTransferredQty({
      uncompletedQty: '500',
      completedQty: item.completedQty,
      frontendTransferredQty: null,
      executionVersion: 0,
      stage: item.stage,
    });
    assert.equal(result.ok, true);
    if (!result.ok) continue;
    assert.equal(result.state.legacy, true);
    assert.equal(result.state.frontendTransferredQty, item.transferred);
    assert.deepEqual(result.state.segments, item.segments);
  }
});

test('T=500 F=360 C=200 derives three stage cards for one order', () => {
  const result = resolveEffectiveFrontendTransferredQty({
    uncompletedQty: '500套',
    completedQty: '200',
    frontendTransferredQty: 360,
    executionVersion: 7,
    stage: 'frontend',
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.state.segments, [
    { stage: 'frontend', quantity: 140 },
    { stage: 'backend', quantity: 160 },
    { stage: 'completed', quantity: 200 },
  ]);
  assert.equal(result.state.executionVersion, 7);
});

test('full and partial transitions keep the compatible master stage', () => {
  assert.equal(compatibleStageForQuantities({ targetQty: 500, frontendTransferredQty: 360, completedQty: 200 }), 'frontend');
  assert.equal(compatibleStageForQuantities({ targetQty: 500, frontendTransferredQty: 500, completedQty: 200 }), 'backend');
  assert.equal(compatibleStageForQuantities({ targetQty: 500, frontendTransferredQty: 500, completedQty: 500 }), 'completed');
  assert.deepEqual(productionStageSegments({
    targetQty: 500,
    frontendTransferredQty: 500,
    completedQty: 200,
    overallStage: 'backend',
  }), [{ stage: 'backend', quantity: 300 }, { stage: 'completed', quantity: 200 }]);
});

test('flow quantity accepts only positive whole numbers', () => {
  assert.deepEqual(parsePositiveProductionQuantity('20'), { ok: true, value: 20 });
  assert.deepEqual(parsePositiveProductionQuantity(1), { ok: true, value: 1 });
  for (const value of ['0', '-1', '1.5', 'abc', '', 0, -1, 1.5]) {
    assert.deepEqual(parsePositiveProductionQuantity(value), { ok: false });
  }
});

test('invalid persisted quantity relationships are rejected instead of clamped', () => {
  const cases = [
    { input: { uncompletedQty: '500', completedQty: '10', frontendTransferredQty: 600, executionVersion: 0, stage: 'frontend' }, code: 'TRANSFERRED_EXCEEDS_TARGET' },
    { input: { uncompletedQty: '500', completedQty: '300', frontendTransferredQty: 200, executionVersion: 0, stage: 'frontend' }, code: 'COMPLETED_EXCEEDS_TRANSFERRED' },
    { input: { uncompletedQty: '500', completedQty: '600', frontendTransferredQty: 600, executionVersion: 0, stage: 'completed' }, code: 'COMPLETED_EXCEEDS_TARGET' },
    { input: { uncompletedQty: '500', completedQty: '200', frontendTransferredQty: 360, executionVersion: 0, stage: 'backend' }, code: 'STAGE_QUANTITY_CONFLICT' },
    { input: { uncompletedQty: '500', completedQty: '20', frontendTransferredQty: null, executionVersion: 0, stage: 'frontend' }, code: 'LEGACY_STAGE_QUANTITY_CONFLICT' },
  ];
  for (const item of cases) {
    const result = resolveEffectiveFrontendTransferredQty(item.input);
    assert.equal(result.ok, false);
    if (result.ok) continue;
    assert.equal(result.error.code, item.code);
  }
});
