import assert from 'node:assert/strict';
import test from 'node:test';
import { formatProductionPercentage, getProductionQuantitySummary } from '../lib/production-quantity';

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
