import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateWipCompletedMilliseconds } from '../lib/wip-warehouse';

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
