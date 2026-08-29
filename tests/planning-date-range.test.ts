import assert from 'node:assert/strict';
import test from 'node:test';
import { parsePlanningDateRange, planningDateKeys, planningMonthRange } from '@/lib/planning-date-range';
import { materialHoldReason, materialHoldReasonCode } from '@/lib/production-plan-holds';

test('planning date ranges are inclusive, strict and capped at 93 days', () => {
  const range = parsePlanningDateRange('2026-08-31', '2026-09-30');
  assert.equal(range.days, 31);
  assert.equal(range.startDate, '2026-08-31');
  assert.equal(range.start.toISOString(), '2026-08-30T16:00:00.000Z');
  assert.equal(range.endExclusive.toISOString(), '2026-09-30T16:00:00.000Z');
  assert.deepEqual(planningDateKeys(range).slice(0, 2), ['2026-08-31', '2026-09-01']);
  assert.throws(() => parsePlanningDateRange('2026-02-31', '2026-03-02'), /有效日历日期/);
  assert.throws(() => parsePlanningDateRange('2026-09-02', '2026-09-01'), /不能早于/);
  assert.throws(() => parsePlanningDateRange('2026-01-01', '2026-04-04'), /93/);
});

test('month ranges cover leap days and cross-year boundaries', () => {
  assert.deepEqual(
    (({ month, startDate, endDate, days }) => ({ month, startDate, endDate, days }))(planningMonthRange('2028-02')),
    { month: '2028-02', startDate: '2028-02-01', endDate: '2028-02-29', days: 29 },
  );
  assert.equal(planningMonthRange('2026-12').endDate, '2026-12-31');
});

test('material hold reasons distinguish pending preparation and warehouse exceptions', () => {
  assert.equal(materialHoldReasonCode('pending'), 'pending');
  assert.equal(materialHoldReasonCode('exception', 'shortage'), 'shortage');
  assert.equal(materialHoldReason('exception', 'insufficient_quantity', '缺 200 套'), '数量不足：缺 200 套');
});
