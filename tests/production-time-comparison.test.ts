import assert from 'node:assert/strict';
import test from 'node:test';
import { originalPlanTime, summarizeTimeComparison, type TaskTimeComparison } from '../lib/production-time-comparison';
const H = 3600000;
const row = (overrides: Partial<TaskTimeComparison> = {}): TaskTimeComparison => ({ originalPlan: 5 * H, originalSource: 'batch',
  currentStandard: 3 * H, missingSteps: 0, priorDeducted: 0, adjustedReported: 0, estimate: 0, movedOut: 0, executionBasis: 3 * H, ...overrides });
test('saved batch and order plan values take precedence over current product standard without being rewritten', () => {
  assert.deepEqual(originalPlanTime({ quantity: 10, batchUnit: 60000, orderUnit: 120000, publishedUnit: 180000 }), { milliseconds: 600000, source: 'batch' });
  assert.deepEqual(originalPlanTime({ quantity: 10, orderUnit: 120000, publishedUnit: 180000 }), { milliseconds: 1200000, source: 'order' });
  assert.deepEqual(originalPlanTime({ quantity: 10, publishedUnit: 180000 }), { milliseconds: 1800000, source: 'published' });
  assert.deepEqual(originalPlanTime({ quantity: 10, totalSnapshot: '3600000' }), { milliseconds: H, source: 'total' });
  assert.deepEqual(originalPlanTime({ quantity: 10 }), { milliseconds: null, source: 'missing' });
});
test('offsetting batch differences remain visible even when the overall difference is zero', () => {
  const c = summarizeTimeComparison([row(), row({ originalPlan: H })]);
  assert.equal(c.difference, 0); assert.equal(c.changedCount, 2);
});
test('missing plan or route is unknown, never a zero-valued comparable standard', () => {
  assert.equal(summarizeTimeComparison([row({ originalPlan: null, originalSource: 'missing' })]).difference, null);
  const c = summarizeTimeComparison([row({ missingSteps: 1, originalSource: 'published' })]);
  assert.equal(c.difference, null); assert.equal(c.changedCount, 0); assert.equal(c.fallbackCount, 1);
});
test('same-batch standard comparison stays separate from the actual weekly execution denominator', () => {
  const c = summarizeTimeComparison([row({ originalPlan: 3397564000, currentStandard: 2758385000,
    priorDeducted: 170880000, adjustedReported: 7200000, executionBasis: 2594705000 })], 113960000);
  assert.equal(c.difference, 639179000);
  assert.equal(c.executionBasis, 2708665000);
  assert.equal(c.currentStandard - c.priorDeducted + c.adjustedReported - c.movedOut + c.estimate + c.wipBasis, c.executionBasis);
});
