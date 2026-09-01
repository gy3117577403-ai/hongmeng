import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveWipNativeSourceReportLimits } from '../lib/wip-reporting';

test('ordinary source reporting excludes WIP-owned product and action quantities', () => {
  const limits = resolveWipNativeSourceReportLimits({
    reportableQty: 100,
    outstandingWipQuantity: 60,
    reportableUnitQty: 400,
    unitsPerProduct: 4,
  });

  assert.deepEqual(limits, {
    nativeReportableQty: 40,
    nativeReportableUnitQty: 160,
  });
});

test('fully moved-out source has zero ordinary reporting capacity', () => {
  const limits = resolveWipNativeSourceReportLimits({
    reportableQty: 100,
    outstandingWipQuantity: 100,
    reportableUnitQty: 1_500,
    unitsPerProduct: 15,
  });

  assert.equal(limits.nativeReportableQty, 0);
  assert.equal(limits.nativeReportableUnitQty, 0);
});

test('native source limits clamp stale WIP ownership and preserve non-action mode', () => {
  assert.deepEqual(resolveWipNativeSourceReportLimits({
    reportableQty: 20,
    outstandingWipQuantity: 50,
  }), {
    nativeReportableQty: 0,
    nativeReportableUnitQty: null,
  });
  assert.deepEqual(resolveWipNativeSourceReportLimits({
    reportableQty: 20,
    outstandingWipQuantity: 0,
    reportableUnitQty: 20,
    unitsPerProduct: 1,
  }), {
    nativeReportableQty: 20,
    nativeReportableUnitQty: 20,
  });
});
