import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseReportPeriod,
  reportDateRange,
  reportRangeDateKeys,
} from '../lib/report-date-range';

test('custom report ranges include both selected boundary dates in China time', () => {
  const range = reportDateRange({
    period: 'custom',
    startDate: '2026-08-03',
    endDate: '2026-08-06',
  });

  assert.equal(range.period, 'custom');
  assert.equal(range.start.toISOString(), '2026-08-02T16:00:00.000Z');
  assert.equal(range.end.toISOString(), '2026-08-06T16:00:00.000Z');
  assert.deepEqual(reportRangeDateKeys(range.start, range.end), [
    '2026-08-03',
    '2026-08-04',
    '2026-08-05',
    '2026-08-06',
  ]);
});

test('custom report ranges reject reversed boundaries and more than 366 days', () => {
  assert.throws(() => reportDateRange({
    period: 'custom',
    startDate: '2026-08-06',
    endDate: '2026-08-03',
  }), /结束日期不能早于开始日期/);

  assert.throws(() => reportDateRange({
    period: 'custom',
    startDate: '2025-01-01',
    endDate: '2026-01-02',
  }), /最多支持 366 天/);
});

test('unknown report period falls back to week', () => {
  assert.equal(parseReportPeriod('quarter'), 'week');
});
