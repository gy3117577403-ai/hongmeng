/** Published batch setup and production time are one fixed budget. Every report
 * earns its quantity share on its original work date; the report filling the
 * remaining quantity receives integer-millisecond rounding residue. A withdrawn
 * report releases only its own quantity and budget, so replacement reporting
 * cannot duplicate another employee's earned labor. */
export const BATCH_LABOR_ALLOCATION_POLICY = 'batch_proportional_v1';

export function allocateBatchLabor(input: {
  targetQty: number;
  totalMilliseconds: bigint;
  existingQty: number;
  existingMilliseconds: bigint;
  reportQty: number;
}): bigint {
  if (![input.targetQty, input.existingQty, input.reportQty].every(Number.isSafeInteger)
    || input.targetQty <= 0 || input.existingQty < 0 || input.reportQty <= 0
    || input.existingQty + input.reportQty > input.targetQty
    || input.totalMilliseconds <= 0n || input.existingMilliseconds < 0n
    || input.existingMilliseconds > input.totalMilliseconds) {
    throw new Error('按批工时分摊数量或已计工时不一致，原记录保留，请核对批次');
  }
  const remaining = input.totalMilliseconds - input.existingMilliseconds;
  if (input.existingQty + input.reportQty === input.targetQty) return remaining;
  const proportional = input.totalMilliseconds * BigInt(input.reportQty) / BigInt(input.targetQty);
  return proportional < remaining ? proportional : remaining;
}

export function repriceBatchLaborPools(pools: Array<{
  id: string; allocationPolicy: string; batchTargetQty: number | null; eligibleQty: number;
}>, timeBasis: string, totalMilliseconds: bigint): Map<string, bigint> {
  const proportional = pools.filter(pool => pool.allocationPolicy === BATCH_LABOR_ALLOCATION_POLICY);
  const result = new Map<string, bigint>();
  if (!proportional.length) return result;
  if (timeBasis !== 'per_batch' || proportional.length !== pools.length
    || proportional.some(pool => pool.batchTargetQty !== proportional[0].batchTargetQty)) {
    throw new Error('按批贡献工时不能混用旧整批口径或直接改计时方式，请先核对整批账');
  }
  let qty = 0; let labor = 0n;
  for (const pool of proportional) {
    const amount = allocateBatchLabor({ targetQty: pool.batchTargetQty || 0, totalMilliseconds,
      existingQty: qty, existingMilliseconds: labor, reportQty: pool.eligibleQty });
    result.set(pool.id, amount); qty += pool.eligibleQty; labor += amount;
  }
  return result;
}
