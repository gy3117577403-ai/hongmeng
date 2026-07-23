export type ProcessCompletionTimeBasis = 'per_unit' | 'per_batch';

export class ProcessCompletionDomainError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = 'ProcessCompletionDomainError';
    this.code = code;
  }
}

function safeInteger(value: unknown, label: string, code: string, minimum: number): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) {
    throw new ProcessCompletionDomainError(`${label}必须是${minimum > 0 ? '正' : '非负'}整数`, code);
  }
  return parsed;
}

function positiveBigInt(value: bigint, label: string, code: string): bigint {
  if (value <= 0n) throw new ProcessCompletionDomainError(`${label}必须大于 0`, code);
  return value;
}

function nonnegativeBigInt(value: bigint, label: string, code: string): bigint {
  if (value < 0n) throw new ProcessCompletionDomainError(`${label}不能小于 0`, code);
  return value;
}

export type CompletionQuantityResolution = {
  availableInputQty: number;
  processedQty: number;
  goodQty: number;
  defectQty: number;
  remainingInputQty: number;
  completesInput: boolean;
};

export function resolveCompletionQuantities(input: {
  availableInputQty: unknown;
  processedQty: unknown;
  defectQty: unknown;
}): CompletionQuantityResolution {
  const availableInputQty = safeInteger(
    input.availableInputQty,
    '当前工序可处理数量',
    'INVALID_AVAILABLE_INPUT_QTY',
    1,
  );
  const processedQty = safeInteger(input.processedQty, '本次完成数量', 'INVALID_PROCESSED_QTY', 1);
  const defectQty = safeInteger(input.defectQty, '本次不良品数量', 'INVALID_DEFECT_QTY', 0);
  if (processedQty > availableInputQty) {
    throw new ProcessCompletionDomainError(
      `本次完成数量不能超过当前工序可处理数量 ${availableInputQty}`,
      'PROCESSED_QTY_EXCEEDS_AVAILABLE',
    );
  }
  if (defectQty > processedQty) {
    throw new ProcessCompletionDomainError(
      '不良品数量不能超过本次完成数量',
      'DEFECT_QTY_EXCEEDS_PROCESSED',
    );
  }
  const goodQty = processedQty - defectQty;
  const remainingInputQty = availableInputQty - processedQty;
  return {
    availableInputQty,
    processedQty,
    goodQty,
    defectQty,
    remainingInputQty,
    completesInput: remainingInputQty === 0,
  };
}

export type CompletionLaborSnapshot = {
  timeBasis: ProcessCompletionTimeBasis;
  eligibleQty: number;
  standardMillisecondsPerUnit: number;
  setupMilliseconds: number;
  unitsPerProduct: number;
  totalStandardLaborMilliseconds: bigint;
};

export function calculateCompletionLaborSnapshot(input: {
  timeBasis: ProcessCompletionTimeBasis;
  eligibleQty: unknown;
  standardMillisecondsPerUnit: unknown;
  setupMilliseconds?: unknown;
  unitsPerProduct?: unknown;
}): CompletionLaborSnapshot {
  if (input.timeBasis !== 'per_unit' && input.timeBasis !== 'per_batch') {
    throw new ProcessCompletionDomainError('标准工时计时方式不正确', 'INVALID_TIME_BASIS');
  }
  const eligibleQty = safeInteger(input.eligibleQty, '可领取数量', 'INVALID_ELIGIBLE_QTY', 1);
  const standardMillisecondsPerUnit = safeInteger(
    input.standardMillisecondsPerUnit,
    '单位标准工时',
    'INVALID_STANDARD_MILLISECONDS',
    1,
  );
  const setupMilliseconds = safeInteger(
    input.setupMilliseconds ?? 0,
    '准备工时',
    'INVALID_SETUP_MILLISECONDS',
    0,
  );
  const unitsPerProduct = safeInteger(
    input.unitsPerProduct ?? 1,
    '单套工序次数',
    'INVALID_UNITS_PER_PRODUCT',
    1,
  );
  const variableMilliseconds = input.timeBasis === 'per_batch'
    ? BigInt(standardMillisecondsPerUnit)
    : BigInt(standardMillisecondsPerUnit) * BigInt(eligibleQty) * BigInt(unitsPerProduct);
  const totalStandardLaborMilliseconds = positiveBigInt(
    BigInt(setupMilliseconds) + variableMilliseconds,
    '工时池标准工时',
    'INVALID_TOTAL_STANDARD_LABOR',
  );
  return {
    timeBasis: input.timeBasis,
    eligibleQty,
    standardMillisecondsPerUnit,
    setupMilliseconds,
    unitsPerProduct,
    totalStandardLaborMilliseconds,
  };
}

export type LaborClaimPlan = {
  claimQty: number;
  nextClaimedQty: number;
  remainingQty: number;
  claimStandardLaborMilliseconds: bigint;
  nextClaimedStandardLaborMilliseconds: bigint;
  remainingStandardLaborMilliseconds: bigint;
  nextStatus: 'PARTIAL' | 'EXHAUSTED';
};

export function planLaborClaim(input: {
  eligibleQty: unknown;
  claimedQty: unknown;
  claimQty: unknown;
  totalStandardLaborMilliseconds: bigint;
  claimedStandardLaborMilliseconds: bigint;
}): LaborClaimPlan {
  const eligibleQty = safeInteger(input.eligibleQty, '工时池可领取数量', 'INVALID_ELIGIBLE_QTY', 1);
  const claimedQty = safeInteger(input.claimedQty, '工时池已领取数量', 'INVALID_CLAIMED_QTY', 0);
  const claimQty = safeInteger(input.claimQty, '本次领取数量', 'INVALID_CLAIM_QTY', 1);
  const totalStandardLaborMilliseconds = positiveBigInt(
    input.totalStandardLaborMilliseconds,
    '工时池总标准工时',
    'INVALID_TOTAL_STANDARD_LABOR',
  );
  const claimedStandardLaborMilliseconds = nonnegativeBigInt(
    input.claimedStandardLaborMilliseconds,
    '工时池已领取标准工时',
    'INVALID_CLAIMED_STANDARD_LABOR',
  );
  if (claimedStandardLaborMilliseconds > totalStandardLaborMilliseconds) {
    throw new ProcessCompletionDomainError(
      '工时池已领取标准工时超过总标准工时',
      'CLAIMED_STANDARD_LABOR_EXCEEDS_TOTAL',
    );
  }
  if (claimedQty > eligibleQty) {
    throw new ProcessCompletionDomainError('工时池已领取数量超过可领取数量', 'CLAIMED_QTY_EXCEEDS_ELIGIBLE');
  }
  const remainingBeforeClaim = eligibleQty - claimedQty;
  if (claimQty > remainingBeforeClaim) {
    throw new ProcessCompletionDomainError(
      `本次领取数量不能超过剩余可领取数量 ${remainingBeforeClaim}`,
      'CLAIM_QTY_EXCEEDS_REMAINING',
    );
  }
  const remainingStandardLaborBefore = totalStandardLaborMilliseconds - claimedStandardLaborMilliseconds;
  const nextClaimedQty = claimedQty + claimQty;
  const remainingQty = eligibleQty - nextClaimedQty;
  const claimStandardLaborMilliseconds = remainingQty === 0
    ? remainingStandardLaborBefore
    : remainingStandardLaborBefore * BigInt(claimQty) / BigInt(remainingBeforeClaim);
  const nextClaimedStandardLaborMilliseconds = claimedStandardLaborMilliseconds
    + claimStandardLaborMilliseconds;
  const remainingStandardLaborMilliseconds = remainingStandardLaborBefore
    - claimStandardLaborMilliseconds;
  return {
    claimQty,
    nextClaimedQty,
    remainingQty,
    claimStandardLaborMilliseconds,
    nextClaimedStandardLaborMilliseconds,
    remainingStandardLaborMilliseconds,
    nextStatus: remainingQty === 0 ? 'EXHAUSTED' : 'PARTIAL',
  };
}

export type ParallelGroupReleaseResolution = {
  releasableGoodQty: number;
  alreadyReleasedQty: number;
  releaseDeltaQty: number;
};

export function calculateParallelGroupReleaseDelta(input: {
  stepGoodOutputQuantities: readonly unknown[];
  alreadyReleasedQty: unknown;
}): ParallelGroupReleaseResolution {
  if (!input.stepGoodOutputQuantities.length) {
    throw new ProcessCompletionDomainError('并行工序组不能为空', 'PARALLEL_GROUP_EMPTY');
  }
  const stepGoodOutputQuantities = input.stepGoodOutputQuantities.map((quantity, index) =>
    safeInteger(quantity, `第 ${index + 1} 道并行工序良品数量`, 'INVALID_PARALLEL_GOOD_QTY', 0));
  const alreadyReleasedQty = safeInteger(
    input.alreadyReleasedQty,
    '并行工序组已释放数量',
    'INVALID_ALREADY_RELEASED_QTY',
    0,
  );
  const releasableGoodQty = Math.min(...stepGoodOutputQuantities);
  if (alreadyReleasedQty > releasableGoodQty) {
    throw new ProcessCompletionDomainError(
      '并行工序组已释放数量超过当前共同良品数量',
      'RELEASED_QTY_EXCEEDS_PARALLEL_MINIMUM',
    );
  }
  return {
    releasableGoodQty,
    alreadyReleasedQty,
    releaseDeltaQty: releasableGoodQty - alreadyReleasedQty,
  };
}
