import assert from 'node:assert/strict';
import test from 'node:test';
import { materialAmounts, materialForecast, materialOrderState } from '../lib/material-order-domain';
test('material quantities distinguish usable, reported, in transit and rejected without mixing units', () => {
  const quantities = materialAmounts(100, [
    { status: 'VERIFIED', quantity: 40, acceptedQuantity: 30, rejectedQuantity: 10 },
    { status: 'ARRIVED', quantity: 20, acceptedQuantity: 0, rejectedQuantity: 0 },
    { status: 'SHIPPED', quantity: 15, acceptedQuantity: 0, rejectedQuantity: 0 },
    { status: 'CANCELLED', quantity: 20, acceptedQuantity: 0, rejectedQuantity: 0 },
  ]);
  assert.deepEqual(quantities, { usable: 30, pending: 20, transit: 15, rejected: 10, remaining: 50, unallocated: 35 });
  assert.equal(materialAmounts(null, []).remaining, null);
  assert.equal(materialOrderState('pending', 0, 0), 'UNCHECKED');
  assert.equal(materialOrderState('pending', 0, 2), 'CONFIRM');
  assert.equal(materialOrderState('completed', 1, 2), 'SHORTAGE');
  assert.equal(materialOrderState('completed', 0, 2), 'READY');
});
test('unknown ETA is retained beside the latest known promise and reported-full does not forecast missing units', () => {
  assert.deepEqual(materialForecast([
    { open: true, remaining: 2, expectedAt: '2026-09-28' },
    { open: true, remaining: 1, expectedAt: '2026-09-30' },
    { open: true, remaining: null, expectedAt: null },
    { open: true, remaining: 0, expectedAt: null },
    { open: false, remaining: 20, expectedAt: null },
  ]), { next: '2026-09-28', latest: '2026-09-30', unknown: 1 });
});
