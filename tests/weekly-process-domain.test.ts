import assert from 'node:assert/strict';
import test from 'node:test';
import {
  compareWeeklyProcessRows,
  matchesWeeklyCompletionFilter,
  parseWeeklyCompletionFilter,
  parseWeeklyProcessSort,
  weeklyCompletionState,
  weeklyDueTone,
  weeklyProcessKey,
  weeklyProcessLabor,
  weeklyProcessPresetScopeKey,
} from '../lib/weekly-process-domain';

test('weekly process identity prefers stable definitions and normalizes legacy names', () => {
  assert.equal(weeklyProcessKey({ processDefinitionId: 'process-1', processName: '裁 线' }), 'definition:process-1');
  assert.equal(weeklyProcessKey({ processName: ' 裁-线 ' }), 'legacy:裁线');
  assert.equal(
    weeklyProcessPresetScopeKey({ processKey: 'definition:process-1', stepId: 'step-1' }),
    'step:step-1',
  );
  assert.equal(
    weeklyProcessPresetScopeKey({ processKey: 'definition:process-1' }),
    'process:definition:process-1',
  );
});

test('weekly completion filters keep pending coverage inside incomplete work', () => {
  const pending = weeklyCompletionState({
    batchQuantity: 100,
    processedQuantity: 20,
    reportedQuantity: 45,
    pendingCoverageQuantity: 25,
  });
  assert.equal(pending, 'PENDING_COVERAGE');
  assert.equal(matchesWeeklyCompletionFilter(pending, 'INCOMPLETE'), true);
  assert.equal(matchesWeeklyCompletionFilter(pending, 'COMPLETED'), false);
  assert.equal(weeklyCompletionState({
    batchQuantity: 100,
    processedQuantity: 100,
    pendingCoverageQuantity: 0,
  }), 'COMPLETED');
  assert.equal(parseWeeklyCompletionFilter('unknown'), 'ALL');
  assert.equal(parseWeeklyProcessSort('unknown'), 'DUE_ASC');
});

test('weekly labor summary uses exact standard snapshots and separates pending coverage', () => {
  const result = weeklyProcessLabor({
    snapshot: {
      timeBasis: 'per_unit',
      standardMillisecondsPerUnit: 6_000,
      setupMilliseconds: 60_000,
      unitsPerProduct: 2,
    },
    batchQuantity: 100,
    processedQuantity: 30,
    reportedQuantity: 50,
    pendingCoverageQuantity: 20,
  });
  assert.deepEqual(result, {
    total: 1_260_000n,
    completed: 420_000n,
    remaining: 840_000n,
    pendingCoverage: 240_000n,
  });
});

test('per-batch labor is completed only when the whole step closes', () => {
  const snapshot = {
    timeBasis: 'per_batch' as const,
    standardMillisecondsPerUnit: 600_000,
    setupMilliseconds: 120_000,
    unitsPerProduct: 1,
  };
  assert.deepEqual(weeklyProcessLabor({
    snapshot,
    batchQuantity: 100,
    processedQuantity: 50,
  }), {
    total: 720_000n,
    completed: 0n,
    remaining: 720_000n,
    pendingCoverage: 0n,
  });
  assert.equal(weeklyProcessLabor({
    snapshot,
    batchQuantity: 100,
    processedQuantity: 100,
  }).completed, 720_000n);
});

test('due indicators and sorting prioritize urgent high-labor work', () => {
  assert.equal(weeklyDueTone({ dueDate: '2026-08-03', today: '2026-08-04', completed: false }), 'OVERDUE');
  assert.equal(weeklyDueTone({ dueDate: '2026-08-04', today: '2026-08-04', completed: false }), 'TODAY');
  assert.equal(weeklyDueTone({ dueDate: '2026-08-06', today: '2026-08-04', completed: false }), 'SOON');

  const low = {
    dueDate: '2026-08-05',
    remainingLaborMilliseconds: 60_000n,
    totalLaborMilliseconds: 120_000n,
    workOrderCode: 'A',
    position: 1,
  };
  const high = { ...low, remainingLaborMilliseconds: 600_000n, workOrderCode: 'B' };
  assert.ok(compareWeeklyProcessRows(high, low, 'DUE_ASC') < 0);
  assert.ok(compareWeeklyProcessRows(high, low, 'REMAINING_LABOR_DESC') < 0);
});
