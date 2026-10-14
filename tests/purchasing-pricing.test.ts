import assert from 'node:assert/strict';
import test from 'node:test';
import { pcUnitPrice, pcGoodsCents, pcPurchasePricing } from '../lib/purchasing-pricing';

test('unit price retains precision, rounds the extended amount once and separates adjustments', () => {
  assert.equal(pcUnitPrice('0.123456'), '0.123456');
  assert.equal(pcGoodsCents('0.123456', 3), 37);
  assert.equal(pcGoodsCents('0.005', 3), 2);
  assert.deepEqual(pcPurchasePricing({ unitPrice: '49.5', freightCents: 200, discountCents: 100, actualCents: 10000 }, 2), {
    unitPrice: '49.500000', goodsCents: 9900, freightCents: 200, discountCents: 100, actualCents: 10000,
  });
  assert.throws(() => pcPurchasePricing({ unitPrice: '49.5', actualCents: 10000 }, 2), /采购总额/);
  for (const price of ['0', '-1', '1e2', '0.1234567', 'Infinity', '10000001']) assert.throws(() => pcUnitPrice(price));
  assert.throws(() => pcGoodsCents('10000000', 2));
  assert.throws(() => pcPurchasePricing({ unitPrice: '1', discountCents: 101 }, 1));
});

test('legacy total-only records remain explicitly unpriced', () => {
  assert.deepEqual(pcPurchasePricing({ actualCents: 4001 }, 3), { unitPrice: null, goodsCents: null, freightCents: 0, discountCents: 0, actualCents: 4001 });
  assert.throws(() => pcPurchasePricing({ actualCents: 4001, freightCents: 100 }, 3), /按总额登记/);
});
