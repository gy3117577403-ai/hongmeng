import assert from 'node:assert/strict';
import test from 'node:test';
import { isExecutableProductionWorkOrder } from '../lib/work-orders';

test('scheduled current and future weekly plans are executable', () => {
  assert.equal(isExecutableProductionWorkOrder({
    planType: 'weekly_plan',
    planClearedAt: null,
  }), true);
  assert.equal(isExecutableProductionWorkOrder({
    planType: 'managed_plan',
    planClearedAt: null,
  }), true);
});

test('cleared or unrelated orders remain outside production execution', () => {
  assert.equal(isExecutableProductionWorkOrder({
    planType: 'weekly_plan',
    planClearedAt: new Date(),
  }), false);
  assert.equal(isExecutableProductionWorkOrder({
    planType: 'legacy_import',
    planClearedAt: null,
  }), false);
});
