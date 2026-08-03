import assert from 'node:assert/strict';
import test from 'node:test';
import {
  productionBatchWeekStartWindow,
  productionWeekDateBounds,
  productionWeekDateValues,
  productionWeekKeys,
} from '../lib/production-week';

test('Monday through Sunday resolve to the same production week', () => {
  const expected = { startKey: '2026-08-03', endKey: '2026-08-09' };
  for (const date of productionWeekDateValues('2026-08-03')) {
    assert.deepEqual(productionWeekKeys(date), expected);
  }
});

test('batch week window includes legacy Shanghai-noon markers on Monday', () => {
  const window = productionBatchWeekStartWindow('2026-08-03');
  const legacyMondayNoon = new Date('2026-08-03T12:00:00+08:00');
  const normalizedMonday = new Date('2026-08-03T00:00:00Z');
  assert.ok(legacyMondayNoon >= window.gte && legacyMondayNoon < window.lt);
  assert.ok(normalizedMonday >= window.gte && normalizedMonday < window.lt);
  assert.equal(window.gte.toISOString(), '2026-08-02T16:00:00.000Z');
  assert.equal(window.lt.toISOString(), '2026-08-03T16:00:00.000Z');
});

test('daily task week bounds use PostgreSQL DATE-compatible UTC midnights', () => {
  const bounds = productionWeekDateBounds('2026-08-09');
  assert.equal(bounds.startDate.toISOString(), '2026-08-03T00:00:00.000Z');
  assert.equal(bounds.endExclusiveDate.toISOString(), '2026-08-10T00:00:00.000Z');
});
