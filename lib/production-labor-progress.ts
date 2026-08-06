export type ProductionLaborExecution = {
  standardLaborMilliseconds: bigint | number | string;
};

export type ProductionLaborCompletion = {
  laborPool: {
    status: string;
    totalStandardLaborMilliseconds: bigint | number | string;
  } | null;
};

export type ProductionLaborStep = {
  status: string;
  timeBasis: string | null;
  standardMillisecondsPerUnit: number | null;
  setupMilliseconds: number;
  unitsPerProduct: number;
  executions: readonly ProductionLaborExecution[];
  completions: readonly ProductionLaborCompletion[];
};

export type ProductionLaborProgress = {
  totalStandardMilliseconds: bigint;
  completedStandardMilliseconds: bigint;
  remainingStandardMilliseconds: bigint;
  percentage: number | null;
  stepCount: number;
  configuredStepCount: number;
  missingStandardStepCount: number;
  pendingCompletionStandardCount: number;
  targetQuantityMissing: boolean;
};

function positiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function nonnegativeInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function nonnegativeBigInt(value: bigint | number | string): bigint | null {
  try {
    const parsed = typeof value === 'bigint' ? value : BigInt(value);
    return parsed >= 0n ? parsed : null;
  } catch {
    return null;
  }
}

function plannedStepLabor(step: ProductionLaborStep, targetQuantity: number): bigint | null {
  const standard = positiveInteger(step.standardMillisecondsPerUnit);
  const setup = nonnegativeInteger(step.setupMilliseconds);
  const units = positiveInteger(step.unitsPerProduct);
  if (!standard || setup === null || !units) return null;
  if (step.timeBasis === 'per_batch') return BigInt(setup) + BigInt(standard);
  if (step.timeBasis !== 'per_unit') return null;
  return BigInt(setup) + BigInt(standard) * BigInt(targetQuantity) * BigInt(units);
}

/**
 * Calculates work-order progress from standard labor, not finished quantity.
 * Planned labor uses the currently published route. Completed labor comes from
 * immutable execution/labor-pool snapshots so corrections and historical
 * standard versions stay aligned with the employee labor ledger.
 */
export function calculateProductionLaborProgress(input: {
  targetQuantity: unknown;
  steps: readonly ProductionLaborStep[];
}): ProductionLaborProgress {
  const targetQuantity = positiveInteger(input.targetQuantity);
  const activeSteps = input.steps.filter(step => step.status !== 'skipped');
  let totalStandardMilliseconds = 0n;
  let completedStandardMilliseconds = 0n;
  let configuredStepCount = 0;
  let missingStandardStepCount = 0;
  let pendingCompletionStandardCount = 0;

  for (const step of activeSteps) {
    if (targetQuantity) {
      const planned = plannedStepLabor(step, targetQuantity);
      if (planned === null) missingStandardStepCount += 1;
      else {
        configuredStepCount += 1;
        totalStandardMilliseconds += planned;
      }
    }

    for (const execution of step.executions) {
      const labor = nonnegativeBigInt(execution.standardLaborMilliseconds);
      if (labor !== null) completedStandardMilliseconds += labor;
      else pendingCompletionStandardCount += 1;
    }

    for (const completion of step.completions) {
      const pool = completion.laborPool;
      if (pool?.status === 'VOIDED') continue;
      if (!pool || pool.status === 'LOCKED') {
        pendingCompletionStandardCount += 1;
        continue;
      }
      const labor = nonnegativeBigInt(pool.totalStandardLaborMilliseconds);
      if (labor !== null) completedStandardMilliseconds += labor;
      else pendingCompletionStandardCount += 1;
    }
  }

  const targetQuantityMissing = targetQuantity === null;
  if (targetQuantityMissing) missingStandardStepCount = activeSteps.length;
  const remainingStandardMilliseconds = totalStandardMilliseconds > completedStandardMilliseconds
    ? totalStandardMilliseconds - completedStandardMilliseconds
    : 0n;
  const percentage = targetQuantityMissing
    || missingStandardStepCount > 0
    || pendingCompletionStandardCount > 0
    || totalStandardMilliseconds <= 0n
      ? null
      : Math.min(100, Number((completedStandardMilliseconds * 1_000n) / totalStandardMilliseconds) / 10);

  return {
    totalStandardMilliseconds,
    completedStandardMilliseconds,
    remainingStandardMilliseconds,
    percentage,
    stepCount: activeSteps.length,
    configuredStepCount,
    missingStandardStepCount,
    pendingCompletionStandardCount,
    targetQuantityMissing,
  };
}

export function serializeProductionLaborProgress(progress: ProductionLaborProgress) {
  return {
    ...progress,
    totalStandardMilliseconds: progress.totalStandardMilliseconds.toString(),
    completedStandardMilliseconds: progress.completedStandardMilliseconds.toString(),
    remainingStandardMilliseconds: progress.remainingStandardMilliseconds.toString(),
  };
}
