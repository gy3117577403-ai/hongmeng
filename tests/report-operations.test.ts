import assert from 'node:assert/strict';
import test from 'node:test';
import {
  allocatePlanBatchCompletionQuantities,
  cappedBasisPoints,
  effectiveWipSourcePlanAdjustment,
  effectiveWipTargetPlanProgress,
  nextReportMonth,
  parseReportMonth,
  reportMetricTone,
  reportMonthDateKeys,
  reportMonthWeekBuckets,
  reportWeekKey,
  reportWeekStorageRange,
  summarizeWeeklyPlanProgress,
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

test('weekly plan storage range includes every timestamp on the same Shanghai production week', () => {
  const range = reportWeekStorageRange(reportMonthWeekBuckets('2026-08'));
  assert.ok(range);
  assert.equal(range.gte.toISOString(), '2026-07-26T16:00:00.000Z');
  assert.equal(range.lt.toISOString(), '2026-09-06T16:00:00.000Z');
  assert.ok(new Date('2026-08-24T00:00:00.000Z') >= range.gte);
  assert.ok(new Date('2026-08-24T04:00:00.000Z') < range.lt);
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

test('one work order completion is allocated once across multiple plan batches', () => {
  const allocations = allocatePlanBatchCompletionQuantities([
    { id: 'later', workOrderId: 'wo-1', quantity: 80, plannedDateKey: '2026-08-20' },
    { id: 'first', workOrderId: 'wo-1', quantity: 60, plannedDateKey: '2026-08-10' },
    { id: 'other', workOrderId: 'wo-2', quantity: 20, plannedDateKey: '2026-08-10' },
  ], new Map([['wo-1', 100], ['wo-2', 12]]));
  assert.equal(allocations.get('first'), 60);
  assert.equal(allocations.get('later'), 40);
  assert.equal(allocations.get('other'), 12);
});

test('semi-finished transfer keeps completed source scope and yields one hundred percent', () => {
  const adjustment = effectiveWipSourcePlanAdjustment(100, [
    { kind: 'SEMI_FINISHED', quantity: 100 },
  ]);
  assert.deepEqual(adjustment, {
    plannedQuantity: 100,
    completedQuantityCredit: 100,
    waitingProductionQuantity: 0,
    semiFinishedQuantity: 100,
  });

  const current = summarizeWeeklyPlanProgress(reportMonthWeekBuckets('2026-08'), [{
    id: 'source-batch',
    weekStartDateKey: '2026-08-24',
    quantity: adjustment.plannedQuantity,
    completedQuantity: adjustment.completedQuantityCredit,
  }], '2026-08-25').find(row => row.key === '2026-08-24');
  assert.equal(current?.plannedBatches, 1);
  assert.equal(current?.completedBatches, 1);
  assert.equal(current?.plannedQuantity, 100);
  assert.equal(current?.completedQuantity, 100);
  assert.equal(current?.batchCompletionBasisPoints, 10_000);
  assert.equal(current?.quantityCompletionBasisPoints, 10_000);
});

test('waiting-production transfer leaves no false completion in the source week', () => {
  const adjustment = effectiveWipSourcePlanAdjustment(100, [
    { kind: 'WAITING_PRODUCTION', quantity: 100 },
  ]);
  assert.deepEqual(adjustment, {
    plannedQuantity: 0,
    completedQuantityCredit: 0,
    waitingProductionQuantity: 100,
    semiFinishedQuantity: 0,
  });
});

test('partial WIP transfer separates retained source work from target-week continuation', () => {
  const adjustment = effectiveWipSourcePlanAdjustment(100, [
    { kind: 'SEMI_FINISHED', quantity: 40 },
    { kind: 'WAITING_PRODUCTION', quantity: 20 },
  ]);
  assert.equal(adjustment.plannedQuantity, 80);
  assert.equal(adjustment.completedQuantityCredit, 40);

  assert.deepEqual(effectiveWipTargetPlanProgress({
    status: 'ACTIVE',
    quantity: 40,
    completedQuantity: 0,
  }), { plannedQuantity: 40, completedQuantity: 0 });
  assert.deepEqual(effectiveWipTargetPlanProgress({
    status: 'SUPERSEDED',
    quantity: 40,
    completedQuantity: 15,
  }), { plannedQuantity: 15, completedQuantity: 15 });
  assert.deepEqual(effectiveWipTargetPlanProgress({
    status: 'SUPERSEDED',
    quantity: 40,
    completedQuantity: 0,
  }), { plannedQuantity: 0, completedQuantity: 0 });
  assert.deepEqual(effectiveWipTargetPlanProgress({
    status: 'CANCELLED',
    quantity: 40,
    completedQuantity: 40,
  }), { plannedQuantity: 0, completedQuantity: 0 });
});

test('same-week WIP branch is merged into its source plan instead of counted twice', () => {
  const inProgress = effectiveWipSourcePlanAdjustment(100, [{
    kind: 'SEMI_FINISHED',
    quantity: 100,
    sameWeekPlannedQuantity: 100,
    sameWeekCompletedQuantity: 0,
  }]);
  assert.equal(inProgress.plannedQuantity, 100);
  assert.equal(inProgress.completedQuantityCredit, 0);

  const current = summarizeWeeklyPlanProgress(reportMonthWeekBuckets('2026-08'), [{
    id: 'same-week-source-and-wip',
    weekStartDateKey: '2026-08-24',
    quantity: inProgress.plannedQuantity,
    completedQuantity: inProgress.completedQuantityCredit,
  }], '2026-08-25').find(row => row.key === '2026-08-24');
  assert.equal(current?.plannedBatches, 1, 'same-week WIP must not emit a second plan item');
  assert.equal(current?.plannedQuantity, 100);
  assert.equal(current?.completedBatches, 0);
  assert.equal(current?.batchCompletionBasisPoints, 0);

  const completed = effectiveWipSourcePlanAdjustment(100, [{
    kind: 'SEMI_FINISHED',
    quantity: 100,
    sameWeekPlannedQuantity: 100,
    sameWeekCompletedQuantity: 100,
  }]);
  assert.equal(completed.plannedQuantity, 100);
  assert.equal(completed.completedQuantityCredit, 100);
});

test('same-week waiting-production allocation restores plan without fabricating completion', () => {
  const adjustment = effectiveWipSourcePlanAdjustment(100, [{
    kind: 'WAITING_PRODUCTION',
    quantity: 100,
    sameWeekPlannedQuantity: 100,
    sameWeekCompletedQuantity: 0,
  }]);
  assert.equal(adjustment.plannedQuantity, 100);
  assert.equal(adjustment.completedQuantityCredit, 0);
});

test('current production week counts all planned batches and credits early completion immediately', () => {
  const weeks = reportMonthWeekBuckets('2026-08');
  const currentBatches = Array.from({ length: 28 }, (_, index) => ({
    id: `current-${index + 1}`,
    weekStartDateKey: '2026-08-24',
    quantity: index === 0 ? 2_000 : 400,
    completedQuantity: index === 0 ? 2_000 : 0,
  }));
  const rows = summarizeWeeklyPlanProgress(weeks, [
    ...currentBatches,
    { id: 'future', weekStartDateKey: '2026-08-31', quantity: 100, completedQuantity: 100 },
  ], '2026-08-25');
  const current = rows.find(row => row.key === '2026-08-24');
  const future = rows.find(row => row.key === '2026-08-31');

  assert.equal(current?.isFutureWeek, false);
  assert.equal(current?.plannedBatches, 28);
  assert.equal(current?.completedBatches, 1);
  assert.equal(current?.batchCompletionBasisPoints, 357);
  assert.equal(current?.futureBatches, 0);
  assert.equal(future?.isFutureWeek, true);
  assert.equal(future?.plannedBatches, 0);
  assert.equal(future?.completedBatches, 0);
  assert.equal(future?.futureBatches, 1);
  assert.equal(future?.batchCompletionBasisPoints, null);
});
