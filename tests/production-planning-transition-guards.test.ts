import assert from 'node:assert/strict';
import test from 'node:test';
import {
  productionPlanProductIdentityLocked,
  productionPlanReleaseTransitionBlocker,
  releasedBatchWeekChangeLocked,
} from '../lib/production-planning';

test('active production batches cannot be downgraded to preparation', () => {
  assert.match(
    productionPlanReleaseTransitionBlocker('active', 'preparation') || '',
    /不能退回/,
  );
  assert.equal(productionPlanReleaseTransitionBlocker('preparation', 'active'), null);
  assert.equal(productionPlanReleaseTransitionBlocker('draft', 'preparation'), null);
});

test('released plans lock product identity but retain non-product edits', () => {
  assert.equal(productionPlanProductIdentityLocked({
    hasReleasedBatch: true,
    identityChanged: true,
  }), true);
  assert.equal(productionPlanProductIdentityLocked({
    hasReleasedBatch: true,
    identityChanged: false,
  }), false);
  assert.equal(productionPlanProductIdentityLocked({
    hasReleasedBatch: false,
    identityChanged: true,
  }), false);
});

test('released batches change production week only through release or withdrawal flows', () => {
  assert.equal(releasedBatchWeekChangeLocked({
    released: true,
    weekStartChanged: true,
    weekEndChanged: false,
  }), true);
  assert.equal(releasedBatchWeekChangeLocked({
    released: true,
    weekStartChanged: false,
    weekEndChanged: false,
  }), false);
  assert.equal(releasedBatchWeekChangeLocked({
    released: false,
    weekStartChanged: true,
    weekEndChanged: true,
  }), false);
});
