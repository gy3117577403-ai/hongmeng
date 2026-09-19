import test from 'node:test';
import assert from 'node:assert/strict';
import { currentPlanWeek, planWeekStart, planWeekLabel, shiftPlanWeek } from '../lib/drawing-plan-week';

test('plan weeks use Shanghai calendar dates and Monday boundaries across years', () => {
  assert.equal(currentPlanWeek(new Date('2026-09-20T15:59:59Z')), '2026-09-14');
  assert.equal(currentPlanWeek(new Date('2026-09-20T16:00:00Z')), '2026-09-21');
  assert.equal(planWeekStart('2026-09-27'), '2026-09-21');
  assert.equal(planWeekStart('2027-01-01'), '2026-12-28');
  assert.equal(shiftPlanWeek('2026-12-28', 1), '2027-01-04');
  assert.equal(planWeekLabel('2026-09-23'), '2026-09-21 — 2026-09-27');
  for (const invalid of ['2026-02-30', '2026-13-01', '2026-00-03', 'abc', '2026-9-21']) assert.throws(() => planWeekStart(invalid), /日期无效/);
});
