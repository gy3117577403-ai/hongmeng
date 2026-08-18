import assert from 'node:assert/strict';
import test from 'node:test';
import {
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
