import assert from 'node:assert/strict';
import test from 'node:test';
import {
  compactShipmentOrderCode,
  DAILY_SHIPMENT_CUTOVER_DATE,
  dailyShipmentDisplayWindow,
  dailyShipmentWarningWindow,
  safeShipmentProcessName,
} from '../lib/daily-shipment-policy';

test('daily shipment cutover windows use confirmed due-date boundaries', () => {
  const today = dailyShipmentDisplayWindow('2026-09-03');
  assert.equal(today.startKey, DAILY_SHIPMENT_CUTOVER_DATE);
  assert.equal(today.endKey, '2026-09-03');
  assert.equal(today.endExclusiveDate.toISOString(), '2026-09-04T00:00:00.000Z');

  const warning = dailyShipmentWarningWindow('2026-09-03');
  assert.equal(warning.startKey, '2026-09-01');
  assert.equal(warning.endKey, '2026-09-06');
  assert.equal(warning.endExclusiveDate.toISOString(), '2026-09-07T00:00:00.000Z');
});

test('pre-cutover historical views retain their selected-date scope', () => {
  const historical = dailyShipmentDisplayWindow('2020-01-07');
  assert.equal(historical.cutoverApplied, false);
  assert.equal(historical.startKey, '2020-01-07');
  assert.equal(historical.endKey, '2020-01-07');
});

test('order-code compaction and process-name guard preserve business information', () => {
  const code = 'SC-HL-20260913-WL750100-006-004-01';
  const compact = compactShipmentOrderCode(code);
  assert.ok(compact.startsWith('SC-HL-2026'));
  assert.ok(compact.endsWith('006-004-01'));
  assert.equal(safeShipmentProcessName('frontend'), '待生产反馈');
  assert.equal(safeShipmentProcessName('裁线'), '裁线');
});
