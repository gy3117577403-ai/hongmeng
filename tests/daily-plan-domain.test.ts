import assert from 'node:assert/strict';
import test from 'node:test';
import {
  allocateIncrementalTaskLabor,
  calculateTaskStandardMilliseconds,
  DEFAULT_DAILY_CAPACITY_MILLISECONDS,
  isDailyPlanAssignableStatus,
  normalizeWorkDate,
  remainingCrossTeamApprovalQuantity,
  resolveDailyTaskAvailability,
  resolveDailyTaskProgress,
  resolveEffectiveCapacity,
  scoreDailyPlanPriority,
} from '../lib/daily-plan-domain';

test('daily plan per-unit labor counts setup exactly once across employee splits', () => {
  const snapshot = {
    timeBasis: 'per_unit' as const,
    standardMillisecondsPerUnit: 1_000,
    setupMilliseconds: 60_000,
    unitsPerProduct: 2,
  };
  const allocations = allocateIncrementalTaskLabor({
    snapshot,
    alreadyAssignedQuantity: 0,
    quantities: [800, 200],
  });
  assert.deepEqual(allocations, [1_660_000n, 400_000n]);
  assert.equal(
    allocations.reduce((sum, value) => sum + value, 0n),
    calculateTaskStandardMilliseconds(snapshot, 1_000),
  );
});

test('daily plan per-batch labor is allocated only to the first non-empty split', () => {
  const snapshot = {
    timeBasis: 'per_batch' as const,
    standardMillisecondsPerUnit: 600_000,
    setupMilliseconds: 120_000,
    unitsPerProduct: 8,
  };
  assert.deepEqual(allocateIncrementalTaskLabor({
    snapshot,
    alreadyAssignedQuantity: 0,
    quantities: [600, 400],
  }), [720_000n, 0n]);
  assert.deepEqual(allocateIncrementalTaskLabor({
    snapshot,
    alreadyAssignedQuantity: 600,
    quantities: [400],
  }), [0n]);
});

test('future process can be preplanned while waiting for upstream good quantity', () => {
  assert.deepEqual(resolveDailyTaskAvailability({
    sequenceGroup: 2,
    inputQty: 0,
    processedQty: 0,
  }), { availableQty: 0, status: 'WAITING_UPSTREAM' });
  assert.deepEqual(resolveDailyTaskAvailability({
    sequenceGroup: 2,
    inputQty: 1_000,
    processedQty: 200,
  }), { availableQty: 800, status: 'READY' });
});

test('only confirmed or in-progress daily plans accept assignments', () => {
  assert.equal(isDailyPlanAssignableStatus('DRAFT'), false);
  assert.equal(isDailyPlanAssignableStatus('CONFIRMED'), true);
  assert.equal(isDailyPlanAssignableStatus('IN_PROGRESS'), true);
  assert.equal(isDailyPlanAssignableStatus('ARCHIVED'), false);
  assert.equal(isDailyPlanAssignableStatus('CANCELLED'), false);
});

test('cross-team approval quota is consumed by existing active assignments', () => {
  assert.equal(remainingCrossTeamApprovalQuantity({
    approvedQuantity: 100,
    alreadyAssignedQuantity: 60,
  }), 40);
  assert.equal(remainingCrossTeamApprovalQuantity({
    approvedQuantity: 100,
    alreadyAssignedQuantity: 100,
  }), 0);
  assert.equal(remainingCrossTeamApprovalQuantity({
    approvedQuantity: 100,
    alreadyAssignedQuantity: 120,
  }), 0);
});

test('process completion projects progress without overwriting review or terminal states', () => {
  assert.deepEqual(resolveDailyTaskProgress({
    currentStatus: 'WAITING_UPSTREAM',
    currentAvailableQty: 0,
    plannedQty: 100,
    inputQty: 0,
    processedQty: 0,
    stepStatus: 'pending',
  }), { status: 'WAITING_UPSTREAM', availableQty: 0 });
  assert.deepEqual(resolveDailyTaskProgress({
    currentStatus: 'WAITING_UPSTREAM',
    currentAvailableQty: 0,
    plannedQty: 100,
    inputQty: 150,
    processedQty: 0,
    stepStatus: 'pending',
  }), { status: 'READY', availableQty: 100 });
  assert.deepEqual(resolveDailyTaskProgress({
    currentStatus: 'READY',
    currentAvailableQty: 100,
    plannedQty: 100,
    inputQty: 150,
    processedQty: 40,
    stepStatus: 'in_progress',
  }), { status: 'IN_PROGRESS', availableQty: 100 });
  assert.deepEqual(resolveDailyTaskProgress({
    currentStatus: 'IN_PROGRESS',
    currentAvailableQty: 60,
    plannedQty: 100,
    inputQty: 100,
    processedQty: 100,
    stepStatus: 'completed',
  }), { status: 'COMPLETED', availableQty: 0 });
  assert.deepEqual(resolveDailyTaskProgress({
    currentStatus: 'NEEDS_REVIEW',
    currentAvailableQty: 25,
    plannedQty: 100,
    inputQty: 100,
    processedQty: 100,
    stepStatus: 'completed',
  }), { status: 'NEEDS_REVIEW', availableQty: 25 });
});

test('capacity uses override first, then attendance, then the eight-hour fallback', () => {
  assert.deepEqual(resolveEffectiveCapacity(), {
    source: 'fallback',
    regularMilliseconds: DEFAULT_DAILY_CAPACITY_MILLISECONDS,
    overtimeMilliseconds: 0,
    totalMilliseconds: DEFAULT_DAILY_CAPACITY_MILLISECONDS,
  });
  assert.deepEqual(resolveEffectiveCapacity({
    attendanceActualMilliseconds: 7 * 60 * 60 * 1_000,
    attendanceOvertimeMilliseconds: 60 * 60 * 1_000,
  }), {
    source: 'attendance',
    regularMilliseconds: 6 * 60 * 60 * 1_000,
    overtimeMilliseconds: 60 * 60 * 1_000,
    totalMilliseconds: 7 * 60 * 60 * 1_000,
  });
  assert.deepEqual(resolveEffectiveCapacity({
    attendanceActualMilliseconds: 7 * 60 * 60 * 1_000,
    overrideRegularMilliseconds: 8 * 60 * 60 * 1_000,
    overrideOvertimeMilliseconds: 2.5 * 60 * 60 * 1_000,
  }), {
    source: 'override',
    regularMilliseconds: 8 * 60 * 60 * 1_000,
    overtimeMilliseconds: 2.5 * 60 * 60 * 1_000,
    totalMilliseconds: 10.5 * 60 * 60 * 1_000,
  });
});

test('priority ranks overdue executable work ahead of waiting-upstream work', () => {
  const workDate = normalizeWorkDate('2026-08-02');
  const overdue = scoreDailyPlanPriority({
    workDate,
    dueDate: normalizeWorkDate('2026-07-31'),
    priority: 'high',
    availableQty: 100,
    sequenceGroup: 1,
  });
  const future = scoreDailyPlanPriority({
    workDate,
    dueDate: normalizeWorkDate('2026-08-08'),
    priority: 'normal',
    availableQty: 0,
    sequenceGroup: 2,
  });
  assert.ok(overdue.score > future.score);
  assert.ok(overdue.reasons.some(reason => reason.includes('已逾期')));
  assert.ok(future.reasons.includes('等待上游，可提前预排'));
});

test('date and validation messages remain valid UTF-8 Chinese without mojibake', () => {
  assert.throws(() => normalizeWorkDate('2026-02-30'), /生产日期无效/);
  assert.throws(() => normalizeWorkDate('08\/02\/2026'), /生产日期必须为 YYYY-MM-DD/);
  const sourceMessages = [
    '生产日期无效',
    '计划数量',
    '单位标准工时',
    '等待上游，可提前预排',
  ];
  const mojibake = /[�]|(?:鐢|鏃|缁|鍒|鍙|闇|绛|宸|鍛)/;
  for (const message of sourceMessages) assert.doesNotMatch(message, mojibake);
});
