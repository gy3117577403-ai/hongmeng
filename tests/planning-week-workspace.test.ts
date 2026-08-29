import assert from 'node:assert/strict';
import test from 'node:test';
import {
  chinaDate,
  editableProductionPlanningWeek,
  moveProductionPlanBatchToWeek,
} from '../lib/production-planning';

test('editable planning weeks cover the rolling twelve-week planning horizon', () => {
  const now = new Date('2026-07-29T10:00:00+08:00');
  assert.equal(chinaDate(editableProductionPlanningWeek('2026-07-27', now)?.start), '2026-07-27');
  assert.equal(chinaDate(editableProductionPlanningWeek('2026-08-05', now)?.start), '2026-08-03');
  assert.equal(chinaDate(editableProductionPlanningWeek('2026-08-10', now)?.start), '2026-08-10');
  assert.equal(editableProductionPlanningWeek('2026-07-20', now), null);
  assert.equal(chinaDate(editableProductionPlanningWeek('2026-10-12', now)?.start), '2026-10-12');
  assert.equal(editableProductionPlanningWeek('2026-10-19', now), null);
});

test('moving a draft batch preserves its planned completion weekday', () => {
  const moved = moveProductionPlanBatchToWeek({
    weekStartDate: new Date('2026-07-27T12:00:00+08:00'),
    plannedCompletionDate: new Date('2026-07-31T12:00:00+08:00'),
  }, new Date('2026-08-10T12:00:00+08:00'));

  assert.deepEqual({
    weekStartDate: chinaDate(moved.weekStartDate),
    weekEndDate: chinaDate(moved.weekEndDate),
    plannedCompletionDate: chinaDate(moved.plannedCompletionDate),
  }, {
    weekStartDate: '2026-08-10',
    weekEndDate: '2026-08-16',
    plannedCompletionDate: '2026-08-14',
  });
});

test('moving a malformed completion date clamps the completion day to the target week', () => {
  const moved = moveProductionPlanBatchToWeek({
    weekStartDate: new Date('2026-07-27T12:00:00+08:00'),
    plannedCompletionDate: new Date('2026-08-20T12:00:00+08:00'),
  }, new Date('2026-08-03T12:00:00+08:00'));

  assert.equal(chinaDate(moved.plannedCompletionDate), '2026-08-09');
});
