import assert from 'node:assert/strict';
import test from 'node:test';
import { allocateBatchLabor, repriceBatchLaborPools } from '../lib/batch-labor-allocation';

test('batch reports share one fixed budget and the completing contribution receives rounding residue', () => {
  const first = allocateBatchLabor({ targetQty: 3, totalMilliseconds: 100n, existingQty: 0, existingMilliseconds: 0n, reportQty: 1 });
  const second = allocateBatchLabor({ targetQty: 3, totalMilliseconds: 100n, existingQty: 1, existingMilliseconds: first, reportQty: 1 });
  const last = allocateBatchLabor({ targetQty: 3, totalMilliseconds: 100n, existingQty: 2, existingMilliseconds: first + second, reportQty: 1 });
  assert.deepEqual([first, second, last], [33n, 33n, 34n]);
  // Removing an earlier report does not change another employee's 34 ms.
  const replacement = allocateBatchLabor({ targetQty: 3, totalMilliseconds: 100n, existingQty: 2, existingMilliseconds: second + last, reportQty: 1 });
  assert.equal(replacement + second + last, 100n);
});

test('batch setup is part of a single fixed total and repeated partial reports cannot duplicate it', () => {
  let qty = 0; let labor = 0n;
  const batchWithSetup = 3_600_000n + 600_000n;
  for (const reportQty of [2, 3, 5]) {
    const amount = allocateBatchLabor({ targetQty: 10, totalMilliseconds: batchWithSetup, existingQty: qty, existingMilliseconds: labor, reportQty });
    qty += reportQty; labor += amount;
  }
  assert.equal(labor, batchWithSetup);
  assert.throws(() => allocateBatchLabor({ targetQty: 10, totalMilliseconds: batchWithSetup, existingQty: qty, existingMilliseconds: labor, reportQty: 1 }));
});

test('a whole-batch standard correction reprices every contribution once and rejects mixed timing contracts', () => {
  const pools = [1, 2].map((qty, index) => ({ id: `pool-${index}`, allocationPolicy: 'batch_proportional_v1', batchTargetQty: 3, eligibleQty: qty }));
  assert.deepEqual([...repriceBatchLaborPools(pools, 'per_batch', 1201n).values()], [400n, 801n]);
  assert.throws(() => repriceBatchLaborPools(pools, 'per_unit', 1201n));
  assert.throws(() => repriceBatchLaborPools([...pools, { id: 'old', allocationPolicy: 'legacy', batchTargetQty: null, eligibleQty: 3 }], 'per_batch', 1201n));
});
