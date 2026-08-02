import assert from 'node:assert/strict';
import test from 'node:test';
import {productionPlanningDateBoundary} from '../lib/production-planning-date';

test('planning memberships use the Shanghai calendar date at a date-only boundary', () => {
  const shortlyAfterMidnight = new Date('2026-08-01T16:01:00.000Z');
  const shortlyBeforeNextMidnight = new Date('2026-08-02T15:59:59.999Z');

  assert.equal(
    productionPlanningDateBoundary(shortlyAfterMidnight).toISOString(),
    '2026-08-02T00:00:00.000Z',
  );
  assert.equal(
    productionPlanningDateBoundary(shortlyBeforeNextMidnight).toISOString(),
    '2026-08-02T00:00:00.000Z',
  );
});

test('an effectiveTo date remains active through its Shanghai business day', () => {
  const boundary = productionPlanningDateBoundary(new Date('2026-08-02T08:00:00.000Z'));
  const endsToday = new Date('2026-08-02T00:00:00.000Z');
  const endedYesterday = new Date('2026-08-01T00:00:00.000Z');

  assert.equal(endsToday >= boundary, true);
  assert.equal(endedYesterday >= boundary, false);
});
