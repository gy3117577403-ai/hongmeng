import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateClaimStandardLaborMilliseconds,
  parseClaimQuantity,
  parseExpectedPoolVersion,
  parseIdempotencyKey,
  pendingPerBatchResolutionIsSafe,
  poolStatusAfterClaim,
} from '../lib/process-labor-service';

test('800 and 200 quantity claims conserve the complete pool standard labor', () => {
  const total = 1_000_003n;
  const first = calculateClaimStandardLaborMilliseconds({
    eligibleQty: 1_000,
    claimedQty: 0,
    requestedQty: 800,
    totalStandardLaborMilliseconds: total,
    claimedStandardLaborMilliseconds: 0n,
  });
  const second = calculateClaimStandardLaborMilliseconds({
    eligibleQty: 1_000,
    claimedQty: 800,
    requestedQty: 200,
    totalStandardLaborMilliseconds: total,
    claimedStandardLaborMilliseconds: first,
  });
  assert.equal(first, 800_002n);
  assert.equal(second, 200_001n);
  assert.equal(first + second, total);
  assert.equal(poolStatusAfterClaim(1_000, 800), 'PARTIAL');
  assert.equal(poolStatusAfterClaim(1_000, 1_000), 'EXHAUSTED');
});

test('cumulative allocation is independent from how earlier quantities were split', () => {
  const total = 101n;
  const first = calculateClaimStandardLaborMilliseconds({
    eligibleQty: 3,
    claimedQty: 0,
    requestedQty: 1,
    totalStandardLaborMilliseconds: total,
    claimedStandardLaborMilliseconds: 0n,
  });
  const second = calculateClaimStandardLaborMilliseconds({
    eligibleQty: 3,
    claimedQty: 1,
    requestedQty: 1,
    totalStandardLaborMilliseconds: total,
    claimedStandardLaborMilliseconds: first,
  });
  const final = calculateClaimStandardLaborMilliseconds({
    eligibleQty: 3,
    claimedQty: 2,
    requestedQty: 1,
    totalStandardLaborMilliseconds: total,
    claimedStandardLaborMilliseconds: first + second,
  });
  assert.deepEqual([first, second, final], [33n, 34n, 34n]);
  assert.equal(first + second + final, total);
});

test('claim quantity validation rejects zero, decimals, and pool over-claim', () => {
  assert.throws(() => parseClaimQuantity(0), /正整数/);
  assert.throws(() => parseClaimQuantity(1.5), /正整数/);
  assert.throws(() => parseClaimQuantity(true), /正整数/);
  assert.throws(() => calculateClaimStandardLaborMilliseconds({
    eligibleQty: 1_000,
    claimedQty: 800,
    requestedQty: 201,
    totalStandardLaborMilliseconds: 1_000_000n,
    claimedStandardLaborMilliseconds: 800_000n,
  }), /剩余可领取数量 200/);
});

test('optimistic lock and idempotency fields must be explicitly valid', () => {
  assert.equal(parseExpectedPoolVersion(0), 0);
  assert.equal(parseExpectedPoolVersion('3'), 3);
  assert.throws(() => parseExpectedPoolVersion(null), /版本不正确/);
  assert.throws(() => parseExpectedPoolVersion(''), /版本不正确/);
  assert.equal(parseIdempotencyKey(' labor-claim-0001 '), 'labor-claim-0001');
  assert.throws(() => parseIdempotencyKey('short'), /请求标识无效/);
  assert.throws(() => parseIdempotencyKey('x'.repeat(121)), /请求标识无效/);
});

test('a pool remains claimable after an earlier rounded claim is voided', () => {
  const final = calculateClaimStandardLaborMilliseconds({
    eligibleQty: 3,
    claimedQty: 2,
    requestedQty: 1,
    totalStandardLaborMilliseconds: 101n,
    // Three prior one-unit claims allocate 33, 34, 34. Voiding the first
    // leaves two active claims worth 68 rather than floor(101 * 2 / 3) = 67.
    claimedStandardLaborMilliseconds: 68n,
  });
  assert.equal(final, 33n);
  assert.equal(68n + final, 101n);
});

test('manual per-batch backfill is only safe for one fully closed completion pool', () => {
  const closed = {
    routeStatus: 'completed',
    workOrderStage: 'completed',
    workOrderStatus: 'completed',
    stepStatus: 'completed',
    inputQty: 100,
    processedQty: 100,
    completionCount: 1,
    laborPoolCount: 1,
  };
  assert.equal(pendingPerBatchResolutionIsSafe(closed), true);
  assert.equal(pendingPerBatchResolutionIsSafe({
    ...closed,
    routeStatus: 'in_progress',
  }), false);
  assert.equal(pendingPerBatchResolutionIsSafe({
    ...closed,
    completionCount: 2,
    laborPoolCount: 2,
  }), false);
});
