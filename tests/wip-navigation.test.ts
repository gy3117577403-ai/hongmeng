import assert from 'node:assert/strict';
import test from 'node:test';
import { selectPrimaryWipMovedOutTarget } from '../lib/wip-navigation';

function target(
  targetWeekStartDate: string,
  remainingQuantity: number,
  allocationId: string,
) {
  return { targetWeekStartDate, remainingQuantity, allocationIds: [allocationId] };
}

test('source continuation action prefers the earliest target that still owns remaining work', () => {
  const selected = selectPrimaryWipMovedOutTarget([
    target('2026-09-07', 0, 'completed-old-target'),
    target('2026-09-14', 40, 'active-new-target'),
    target('2026-09-21', 10, 'later-active-target'),
  ]);
  assert.equal(selected?.targetWeekStartDate, '2026-09-14');
  assert.equal(selected?.allocationIds[0], 'active-new-target');
});

test('source continuation action uses the latest history only when every target is complete', () => {
  const selected = selectPrimaryWipMovedOutTarget([
    target('2026-09-14', 0, 'latest-completed-target'),
    target('2026-09-07', 0, 'older-completed-target'),
  ]);
  assert.equal(selected?.targetWeekStartDate, '2026-09-14');
  assert.equal(selected?.allocationIds[0], 'latest-completed-target');
});

test('source continuation action has no target for an unscheduled warehouse lot', () => {
  assert.equal(selectPrimaryWipMovedOutTarget([]), null);
});
