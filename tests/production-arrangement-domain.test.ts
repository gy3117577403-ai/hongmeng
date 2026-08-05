import assert from 'node:assert/strict';
import test from 'node:test';
import {
  productionArrangementCrossesWeek,
  resolveProductionArrangementProgress,
  splitProductionArrangementQuantity,
} from '../lib/production-arrangement-domain';

test('splitProductionArrangementQuantity preserves quantity and balances multiple employees', () => {
  const result = splitProductionArrangementQuantity(10, ['e1', 'e2', 'e3']);
  assert.deepEqual(result, [
    { employeeId: 'e1', quantity: 4 },
    { employeeId: 'e2', quantity: 3 },
    { employeeId: 'e3', quantity: 3 },
  ]);
  assert.equal(result.reduce((sum, item) => sum + item.quantity, 0), 10);
});

test('splitProductionArrangementQuantity rotates tiny batches without duplicating quantity', () => {
  assert.deepEqual(splitProductionArrangementQuantity(1, ['e1', 'e2'], 1), [
    { employeeId: 'e2', quantity: 1 },
  ]);
});

test('resolveProductionArrangementProgress distinguishes overdue partial and completed work', () => {
  assert.deepEqual(resolveProductionArrangementProgress({
    workDate: '2026-08-04',
    today: '2026-08-05',
    plannedQty: 100,
    completedQty: 40,
    taskStatus: 'IN_PROGRESS',
  }), {
    status: 'overdue',
    completed: false,
    partial: true,
    overdue: true,
    remainingQty: 60,
  });
  assert.equal(resolveProductionArrangementProgress({
    workDate: '2026-08-05',
    today: '2026-08-05',
    plannedQty: 100,
    completedQty: 100,
  }).status, 'completed');
});

test('productionArrangementCrossesWeek marks dates outside the order week', () => {
  assert.equal(productionArrangementCrossesWeek({
    workDate: '2026-08-10',
    weekStartDate: '2026-08-03',
    weekEndDate: '2026-08-09',
  }), true);
  assert.equal(productionArrangementCrossesWeek({
    workDate: '2026-08-05',
    weekStartDate: '2026-08-03',
    weekEndDate: '2026-08-09',
  }), false);
});
