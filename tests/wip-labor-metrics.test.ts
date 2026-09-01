import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateWipCompletedMilliseconds,
  calculateWipWeekAttainment,
} from '../lib/wip-warehouse';

test('mixed ordinary and WIP reporting reclassifies only the WIP labor slice', () => {
  assert.equal(calculateWipCompletedMilliseconds({
    nativeCompleted: 10_000n,
    reclassifiedFromNative: 4_000n,
    targetWipCompleted: 4_000n,
  }), 10_000n, 'same-week WIP keeps the complete mixed report total');
  assert.equal(calculateWipCompletedMilliseconds({
    nativeCompleted: 10_000n,
    reclassifiedFromNative: 4_000n,
    targetWipCompleted: 0n,
  }), 6_000n, 'the source plan keeps only the ordinary labor slice');
  assert.equal(calculateWipCompletedMilliseconds({
    nativeCompleted: 0n,
    reclassifiedFromNative: 0n,
    targetWipCompleted: 4_000n,
  }), 4_000n, 'the target plan receives the WIP labor slice');
});

test('source week reaches 100 percent when completed first-step labor is the entire retained plan', () => {
  const result = calculateWipWeekAttainment({
    // 100 pieces across four one-second operations.
    nativePlanned: 400_000n,
    // Operations 2-4 are frozen into the WIP lot and leave this week.
    movedOut: 300_000n,
    scheduledIn: 0n,
    // Only operation 1 was actually reported in the source week.
    nativeCompleted: 100_000n,
    reclassifiedFromNative: 0n,
    targetWipCompleted: 0n,
  });

  assert.deepEqual(result, {
    effectivePlanned: 100_000n,
    completed: 100_000n,
    percentage: 100,
  });
});

test('moving all work without a completed source-week operation does not fabricate 100 percent', () => {
  assert.deepEqual(calculateWipWeekAttainment({
    nativePlanned: 400_000n,
    movedOut: 400_000n,
    scheduledIn: 0n,
    nativeCompleted: 0n,
    reclassifiedFromNative: 0n,
    targetWipCompleted: 0n,
  }), {
    effectivePlanned: 0n,
    completed: 0n,
    percentage: null,
  });
});

test('same-week WIP credits move labor between ledgers without double counting it', () => {
  const result = calculateWipWeekAttainment({
    nativePlanned: 400_000n,
    movedOut: 300_000n,
    scheduledIn: 300_000n,
    // The ordinary completion ledger contains both the first operation and
    // three WIP operations before credit reclassification.
    nativeCompleted: 400_000n,
    reclassifiedFromNative: 300_000n,
    targetWipCompleted: 300_000n,
  });
  assert.deepEqual(result, {
    effectivePlanned: 400_000n,
    completed: 400_000n,
    percentage: 100,
  });
});

test('attainment is capped at 100 while preserving the real completed-labor fact', () => {
  assert.deepEqual(calculateWipWeekAttainment({
    nativePlanned: 100_000n,
    movedOut: 0n,
    scheduledIn: 0n,
    nativeCompleted: 120_000n,
    reclassifiedFromNative: 0n,
    targetWipCompleted: 0n,
  }), {
    effectivePlanned: 100_000n,
    completed: 120_000n,
    percentage: 100,
  });
});
