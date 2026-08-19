import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeProductionDataInvalidation } from '../lib/production-data-client-sync';

test('production data invalidation accepts only complete deletion messages', () => {
  assert.deepEqual(normalizeProductionDataInvalidation({
    kind: 'plan-order-deleted',
    entityId: 'order-1',
    occurredAt: 1_723_000_000_000,
    nonce: 'nonce-1',
  }), {
    kind: 'plan-order-deleted',
    entityId: 'order-1',
    occurredAt: 1_723_000_000_000,
    nonce: 'nonce-1',
  });
  assert.equal(normalizeProductionDataInvalidation({
    kind: 'unknown',
    entityId: 'order-1',
    occurredAt: Date.now(),
    nonce: 'nonce-2',
  }), null);
  assert.equal(normalizeProductionDataInvalidation({
    kind: 'plan-batch-deleted',
    entityId: '',
    occurredAt: Date.now(),
    nonce: 'nonce-3',
  }), null);
  assert.equal(normalizeProductionDataInvalidation({
    kind: 'plan-order-deleted',
    entityId: 'order-1',
    occurredAt: Number.NaN,
    nonce: 'nonce-4',
  }), null);
});
