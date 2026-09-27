import { calculateTaskStandardMilliseconds } from './daily-plan-domain';

/** Retained rows stay visible for traceability without occupying the week's order count. */
export function isScheduledPlanningBatch(batch: { scheduleState?: string; retainedWeek?: boolean }) {
  return batch.scheduleState !== 'DEFERRED' && !batch.retainedWeek;
}

type Step = {
  id?: string; status: string; goodOutputQty: number; processedQty: number;
  standardMillisecondsPerUnit: number | null; timeBasis: string | null;
  setupMilliseconds: number; unitsPerProduct: number; countsForEfficiency: boolean;
  supplementObligation?: { requiredQty: number; systemCoveredQty: number; reportedQty: number } | null;
};
/** Standard workload, never actual employee labor. Setup is allocated only once. */
export function weekRemainder(quantity: number, unit: number | null, completed: number, steps: Step[]) {
  const remainingQuantity = Math.max(0, quantity - Math.min(quantity, completed));
  const planned = unit ? BigInt(unit) * BigInt(quantity) : null;
  let standard = 0n, remainingStandard = 0n;
  let missing = false;
  const stepWork: Record<string, { full: string; remaining: string }> = {};
  for (const step of steps.filter(s => s.countsForEfficiency && s.status !== 'skipped')) {
    const target = step.supplementObligation
      ? Math.max(0, step.supplementObligation.requiredQty - step.supplementObligation.systemCoveredQty) : quantity;
    const done = Math.min(target, step.supplementObligation?.reportedQty ?? Math.max(completed, step.goodOutputQty));
    const remaining = step.status === 'completed' ? 0 : Math.max(0, target - done);
    if (!step.standardMillisecondsPerUnit || !['per_unit', 'per_batch'].includes(step.timeBasis || '')) { missing = true; continue; }
    const snapshot = { ...step, timeBasis: step.timeBasis as 'per_unit' | 'per_batch', standardMillisecondsPerUnit: step.standardMillisecondsPerUnit };
    const full = calculateTaskStandardMilliseconds(snapshot, target);
    standard += full;
    let rest = 0n;
    if (remaining) {
      const processed = Math.max(done, step.processedQty);
      rest = calculateTaskStandardMilliseconds(snapshot, processed + remaining) - calculateTaskStandardMilliseconds(snapshot, processed);
      remainingStandard += rest;
    }
    if (step.id) stepWork[step.id] = { full: full.toString(), remaining: rest.toString() };
  }
  const known = steps.length > 0 && !missing && standard > 0n;
  const remainingPlanned = planned === null ? null : known
    ? planned * remainingStandard / standard
    : planned * BigInt(remainingQuantity) / BigInt(Math.max(1, quantity));
  return {
    stepWork, remainingQuantity, planned, standard: known ? standard : null,
    remainingStandard: known ? remainingStandard : null, remainingPlanned,
    basis: known ? 'process' as const : 'quantity' as const,
    started: completed > 0 || steps.some(s => s.processedQty > 0 || s.goodOutputQty > 0 || s.status === 'completed'),
  };
}

export function subtractWorkload(current: bigint | null, remainder: bigint | null): bigint | null {
  if (current === null || remainder === null) return null;
  return current > remainder ? current - remainder : 0n;
}
