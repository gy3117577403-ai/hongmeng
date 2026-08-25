import assert from 'node:assert/strict';
import test from 'node:test';
import {
  allocatePlanBatchCompletionQuantities,
  cappedBasisPoints,
  nextReportMonth,
  parseReportMonth,
  reportMetricTone,
  reportMonthDateKeys,
  reportMonthWeekBuckets,
  reportWeekKey,
} from '@/lib/report-operations';

test('report month parsing rejects invalid and out-of-range values', () => {
  assert.equal(parseReportMonth('2026-08', '2026-07-18'), '2026-08');
  assert.equal(parseReportMonth('2026-13', '2026-07-18'), '2026-07');
  assert.equal(parseReportMonth('not-a-month', '2026-07-18'), '2026-07');
  assert.equal(nextReportMonth('2026-12'), '2027-01');
});

test('report month dates and week buckets cover each calendar day exactly once', () => {
  const dates = reportMonthDateKeys('2026-08');
  const weeks = reportMonthWeekBuckets('2026-08');
  assert.equal(dates.length, 31);
  assert.equal(dates[0], '2026-08-01');
  assert.equal(dates.at(-1), '2026-08-31');
  assert.equal(weeks.length, 6);
  assert.equal(weeks[0]?.startDate, '2026-08-01');
  assert.equal(weeks.at(-1)?.endDate, '2026-08-31');
  assert.equal(reportWeekKey('2026-08-19'), '2026-08-17');
});

test('semantic metric tones flag low, target, and unusually high values', () => {
  assert.equal(reportMetricTone(null), 'empty');
  assert.equal(reportMetricTone(8_000), 'risk');
  assert.equal(reportMetricTone(9_000), 'watch');
  assert.equal(reportMetricTone(9_700), 'good');
  assert.equal(reportMetricTone(10_000), 'excellent');
  assert.equal(reportMetricTone(11_001), 'over');
});

test('plan completion rates are capped at one hundred percent', () => {
  assert.equal(cappedBasisPoints(12, 10), 10_000);
  assert.equal(cappedBasisPoints(7, 10), 7_000);
  assert.equal(cappedBasisPoints(0, 0), null);
});

test('one work order completion is allocated once across multiple plan batches', () => {
  const allocations = allocatePlanBatchCompletionQuantities([
    { id: 'later', workOrderId: 'wo-1', quantity: 80, plannedDateKey: '2026-08-20' },
    { id: 'first', workOrderId: 'wo-1', quantity: 60, plannedDateKey: '2026-08-10' },
    { id: 'other', workOrderId: 'wo-2', quantity: 20, plannedDateKey: '2026-08-10' },
  ], new Map([['wo-1', 100], ['wo-2', 12]]));
  assert.equal(allocations.get('first'), 60);
  assert.equal(allocations.get('later'), 40);
  assert.equal(allocations.get('other'), 12);
});
