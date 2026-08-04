import assert from 'node:assert/strict';
import test from 'node:test';
import {
  branchBusinessWorkOrderCode,
  businessProductKey,
  businessWorkOrderCodeBase,
} from '../lib/work-order-business-code';

test('business work order code uses the production date and readable product specification', () => {
  assert.equal(
    businessWorkOrderCodeBase({
      specification: 'F120451123 / 前阅读灯',
      productName: '前阅读灯排线分总成',
      plannedAt: new Date('2026-08-04T08:00:00+08:00'),
    }),
    'SC-HL-20260804-F120451123-前阅读灯',
  );
  assert.equal(businessProductKey({ specification: ' EHPS-1.5-11A-630 ', productName: null }), 'EHPS-1-5-11A-630');
  assert.equal(businessProductKey({ specification: null, productName: '前阅读灯 排线分总成' }), '前阅读灯-排线分总成');
});

test('branch business work order code stays attached to its parent code', () => {
  assert.equal(
    branchBusinessWorkOrderCode(
      'SC-HL-20260804-F120451123-01',
      { productName: 'fallback' },
      'RW',
      2,
    ),
    'SC-HL-20260804-F120451123-01-RW02',
  );
});
