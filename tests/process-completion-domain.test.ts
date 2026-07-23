import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateCompletionLaborSnapshot,
  calculateParallelGroupReleaseDelta,
  planLaborClaim,
  ProcessCompletionDomainError,
  resolveCompletionQuantities,
} from '../lib/process-completion-domain';

test('process completion conserves processed, good, and defect quantities', () => {
  assert.deepEqual(resolveCompletionQuantities({
    availableInputQty: 1_000,
    processedQty: 600,
    defectQty: 25,
  }), {
    availableInputQty: 1_000,
    processedQty: 600,
    goodQty: 575,
    defectQty: 25,
    remainingInputQty: 400,
    completesInput: false,
  });
});

test('process completion permits an all-defect batch while preserving input', () => {
  const result = resolveCompletionQuantities({
    availableInputQty: 20,
    processedQty: 20,
    defectQty: 20,
  });
  assert.equal(result.goodQty, 0);
  assert.equal(result.remainingInputQty, 0);
  assert.equal(result.completesInput, true);
});

test('process completion rejects over-processing and defects above processed quantity', () => {
  assert.throws(
    () => resolveCompletionQuantities({ availableInputQty: 100, processedQty: 101, defectQty: 0 }),
    (error: unknown) => error instanceof ProcessCompletionDomainError
      && error.code === 'PROCESSED_QTY_EXCEEDS_AVAILABLE',
  );
  assert.throws(
    () => resolveCompletionQuantities({ availableInputQty: 100, processedQty: 80, defectQty: 81 }),
    (error: unknown) => error instanceof ProcessCompletionDomainError
      && error.code === 'DEFECT_QTY_EXCEEDS_PROCESSED',
  );
});

test('per-unit labor snapshot includes setup time and units per product exactly once', () => {
  const snapshot = calculateCompletionLaborSnapshot({
    timeBasis: 'per_unit',
    eligibleQty: 800,
    standardMillisecondsPerUnit: 1_000,
    setupMilliseconds: 60_000,
    unitsPerProduct: 2,
  });
  assert.equal(snapshot.totalStandardLaborMilliseconds, 1_660_000n);
});

test('per-batch labor snapshot is not multiplied by eligible quantity', () => {
  const snapshot = calculateCompletionLaborSnapshot({
    timeBasis: 'per_batch',
    eligibleQty: 1_000,
    standardMillisecondsPerUnit: 600_000,
    setupMilliseconds: 120_000,
    unitsPerProduct: 8,
  });
  assert.equal(snapshot.totalStandardLaborMilliseconds, 720_000n);
});

test('labor claims conserve pool quantity and allocate every standard millisecond', () => {
  const first = planLaborClaim({
    eligibleQty: 1_000,
    claimedQty: 0,
    claimQty: 800,
    totalStandardLaborMilliseconds: 1_000_003n,
    claimedStandardLaborMilliseconds: 0n,
  });
  assert.equal(first.nextClaimedQty, 800);
  assert.equal(first.remainingQty, 200);
  assert.equal(first.claimStandardLaborMilliseconds, 800_002n);
  assert.equal(first.nextStatus, 'PARTIAL');

  const second = planLaborClaim({
    eligibleQty: 1_000,
    claimedQty: first.nextClaimedQty,
    claimQty: 200,
    totalStandardLaborMilliseconds: 1_000_003n,
    claimedStandardLaborMilliseconds: first.nextClaimedStandardLaborMilliseconds,
  });
  assert.equal(second.nextClaimedQty, 1_000);
  assert.equal(second.remainingQty, 0);
  assert.equal(second.claimStandardLaborMilliseconds, 200_001n);
  assert.equal(second.remainingStandardLaborMilliseconds, 0n);
  assert.equal(first.claimStandardLaborMilliseconds + second.claimStandardLaborMilliseconds, 1_000_003n);
  assert.equal(second.nextStatus, 'EXHAUSTED');
});

test('labor claim rejects quantity beyond pool remainder and invalid labor counters', () => {
  assert.throws(
    () => planLaborClaim({
      eligibleQty: 1_000,
      claimedQty: 800,
      claimQty: 201,
      totalStandardLaborMilliseconds: 1_000_000n,
      claimedStandardLaborMilliseconds: 800_000n,
    }),
    (error: unknown) => error instanceof ProcessCompletionDomainError
      && error.code === 'CLAIM_QTY_EXCEEDS_REMAINING',
  );
  assert.throws(
    () => planLaborClaim({
      eligibleQty: 1_000,
      claimedQty: 800,
      claimQty: 200,
      totalStandardLaborMilliseconds: 1_000_000n,
      claimedStandardLaborMilliseconds: 1_000_001n,
    }),
    (error: unknown) => error instanceof ProcessCompletionDomainError
      && error.code === 'CLAIMED_STANDARD_LABOR_EXCEEDS_TOTAL',
  );
});

test('labor claim can continue after a non-LIFO reversal without losing milliseconds', () => {
  const replenished = planLaborClaim({
    eligibleQty: 3,
    claimedQty: 2,
    claimQty: 1,
    totalStandardLaborMilliseconds: 101n,
    claimedStandardLaborMilliseconds: 68n,
  });
  assert.equal(replenished.claimStandardLaborMilliseconds, 33n);
  assert.equal(replenished.nextClaimedStandardLaborMilliseconds, 101n);
  assert.equal(replenished.remainingStandardLaborMilliseconds, 0n);
  assert.equal(replenished.nextStatus, 'EXHAUSTED');
});

test('parallel group releases only the new common good-output minimum', () => {
  assert.deepEqual(calculateParallelGroupReleaseDelta({
    stepGoodOutputQuantities: [800, 650, 900],
    alreadyReleasedQty: 500,
  }), {
    releasableGoodQty: 650,
    alreadyReleasedQty: 500,
    releaseDeltaQty: 150,
  });
  assert.equal(calculateParallelGroupReleaseDelta({
    stepGoodOutputQuantities: [1_000],
    alreadyReleasedQty: 600,
  }).releaseDeltaQty, 400);
});

test('parallel group rejects an already-released quantity above the common output', () => {
  assert.throws(
    () => calculateParallelGroupReleaseDelta({
      stepGoodOutputQuantities: [800, 650],
      alreadyReleasedQty: 651,
    }),
    (error: unknown) => error instanceof ProcessCompletionDomainError
      && error.code === 'RELEASED_QTY_EXCEEDS_PARALLEL_MINIMUM',
  );
});
