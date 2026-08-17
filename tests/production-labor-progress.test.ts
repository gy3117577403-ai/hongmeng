import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateStandardHourlyCapacity } from '@/lib/process-capacity';
import { calculateProductionLaborProgress, type ProductionLaborStep } from '@/lib/production-labor-progress';

function step(overrides: Partial<ProductionLaborStep> = {}): ProductionLaborStep {
  return {
    status: 'pending',
    timeBasis: 'per_unit',
    standardMillisecondsPerUnit: 6_000,
    setupMilliseconds: 1_000,
    unitsPerProduct: 1,
    executions: [],
    completions: [],
    ...overrides,
  };
}

test('production labor progress totals current route and completed snapshots', () => {
  const result = calculateProductionLaborProgress({
    targetQuantity: 100,
    steps: [
      step({
        executions: [{ standardLaborMilliseconds: 120_000 }],
        completions: [{ laborPool: { status: 'EXHAUSTED', totalStandardLaborMilliseconds: 60_000n } }],
      }),
      step({
        standardMillisecondsPerUnit: 10_000,
        setupMilliseconds: 0,
        unitsPerProduct: 2,
      }),
    ],
  });
  assert.equal(result.totalStandardMilliseconds, 2_601_000n);
  assert.equal(result.completedStandardMilliseconds, 180_000n);
  assert.equal(result.remainingStandardMilliseconds, 2_421_000n);
  assert.equal(result.percentage, 6.9);
  assert.equal(result.missingStandardStepCount, 0);
});

test('per-batch standard labor is counted once per work order batch', () => {
  const result = calculateProductionLaborProgress({
    targetQuantity: 5_000,
    steps: [step({ timeBasis: 'per_batch', standardMillisecondsPerUnit: 60_000, setupMilliseconds: 2_000 })],
  });
  assert.equal(result.totalStandardMilliseconds, 62_000n);
});

test('missing route standards never become a misleading zero percentage', () => {
  const result = calculateProductionLaborProgress({
    targetQuantity: 100,
    steps: [step(), step({ standardMillisecondsPerUnit: null })],
  });
  assert.equal(result.missingStandardStepCount, 1);
  assert.equal(result.percentage, null);
});

test('skipped route steps do not inflate planned labor or trigger maintenance warnings', () => {
  const result = calculateProductionLaborProgress({
    targetQuantity: 100,
    steps: [step(), step({ status: 'skipped', standardMillisecondsPerUnit: null })],
  });
  assert.equal(result.stepCount, 1);
  assert.equal(result.configuredStepCount, 1);
  assert.equal(result.missingStandardStepCount, 0);
  assert.equal(result.totalStandardMilliseconds, 601_000n);
  assert.equal(result.percentage, 0);
});

test('system-covered history creates no planned or completed employee labor', () => {
  const result = calculateProductionLaborProgress({
    targetQuantity: 100,
    steps: [
      step({
        status: 'completed',
        executionMode: 'SUPPLEMENTAL_OBLIGATION',
        supplementObligation: {
          requiredQty: 100,
          systemCoveredQty: 100,
          fulfillmentMode: 'SYSTEM_COVERED',
        },
      }),
      step({
        executionMode: 'SUPPLEMENTAL_OBLIGATION',
        supplementObligation: {
          requiredQty: 100,
          systemCoveredQty: 60,
          fulfillmentMode: 'MIXED',
        },
      }),
    ],
  });

  assert.equal(result.totalStandardMilliseconds, 241_000n, 'only the 40 actually required units plus setup are planned');
  assert.equal(result.completedStandardMilliseconds, 0n);
  assert.equal(result.configuredStepCount, 1);
  assert.equal(result.missingStandardStepCount, 0);
});

test('locked completion labor blocks the percentage until standard time is repaired', () => {
  const result = calculateProductionLaborProgress({
    targetQuantity: 100,
    steps: [step({ completions: [{ laborPool: { status: 'LOCKED', totalStandardLaborMilliseconds: 0n } }] })],
  });
  assert.equal(result.pendingCompletionStandardCount, 1);
  assert.equal(result.percentage, null);
});

test('voided labor pools are ignored and do not block the percentage', () => {
  const result = calculateProductionLaborProgress({
    targetQuantity: 100,
    steps: [step({ completions: [{ laborPool: { status: 'VOIDED', totalStandardLaborMilliseconds: 600_000n } }] })],
  });
  assert.equal(result.completedStandardMilliseconds, 0n);
  assert.equal(result.pendingCompletionStandardCount, 0);
  assert.equal(result.percentage, 0);
});

test('labor progress percentage is capped at 100 without losing bigint precision', () => {
  const result = calculateProductionLaborProgress({
    targetQuantity: 1,
    steps: [step({
      setupMilliseconds: 0,
      standardMillisecondsPerUnit: 1,
      executions: [{ standardLaborMilliseconds: '9007199254740993000' }],
    })],
  });
  assert.equal(result.percentage, 100);
  assert.equal(result.remainingStandardMilliseconds, 0n);
});

test('hourly capacity is theoretical per-unit output and does not invent batch capacity', () => {
  assert.deepEqual(calculateStandardHourlyCapacity({
    timeBasis: 'per_unit', standardMillisecondsPerUnit: 6_000, unitsPerProduct: 1,
  }), { kind: 'value', quantityPerHour: 600 });
  assert.deepEqual(calculateStandardHourlyCapacity({
    timeBasis: 'per_unit', standardMillisecondsPerUnit: 6_000, unitsPerProduct: 2,
  }), { kind: 'value', quantityPerHour: 300 });
  assert.deepEqual(calculateStandardHourlyCapacity({
    timeBasis: 'per_batch', standardMillisecondsPerUnit: 60_000, unitsPerProduct: 1,
  }), { kind: 'per_batch' });
});
