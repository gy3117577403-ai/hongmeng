import assert from 'node:assert/strict';
import test from 'node:test';
import { rebuildProductionArrangementRemaining } from '@/lib/production-arrangement-domain';

test('unreported task replaces the complete future crew', () => {
  const result = rebuildProductionArrangementRemaining({
    plannedQty: 30,
    completedQty: 0,
    currentEmployeeIds: ['old-a', 'old-b'],
    replacementEmployeeIds: ['new-a', 'new-b'],
  });
  assert.equal(result.remainingQty, 30);
  assert.deepEqual(result.finalEmployeeIds, ['new-a', 'new-b']);
  assert.deepEqual(result.assignments, [
    { employeeId: 'new-a', quantity: 15 },
    { employeeId: 'new-b', quantity: 15 },
  ]);
});

test('partially reported task only redistributes unfinished quantity', () => {
  const result = rebuildProductionArrangementRemaining({
    plannedQty: 30,
    completedQty: 12,
    currentEmployeeIds: ['available', 'absent'],
    replacementEmployeeIds: ['replacement'],
    sourceEmployeeId: 'absent',
  });
  assert.equal(result.completedQty, 12);
  assert.equal(result.remainingQty, 18);
  assert.deepEqual(result.finalEmployeeIds, ['available', 'replacement']);
  assert.equal(result.assignments.reduce((sum, row) => sum + row.quantity, 0), 18);
});

test('completed task has no replacement assignments', () => {
  const result = rebuildProductionArrangementRemaining({
    plannedQty: 10,
    completedQty: 10,
    currentEmployeeIds: ['old'],
    replacementEmployeeIds: ['new'],
  });
  assert.equal(result.remainingQty, 0);
  assert.deepEqual(result.assignments, []);
});
