export type ProcessRouteReadinessStep = {
  processName?: string | null;
  status?: string | null;
  timeBasis?: string | null;
  unitLabel?: string | null;
  standardMillisecondsPerUnit?: number | null;
  setupMilliseconds?: number | null;
  unitsPerProduct?: number | null;
};

export type ProcessRouteExecutionReadiness = {
  ready: boolean;
  missingStepNames: string[];
};

function hasValidStandardTime(step: ProcessRouteReadinessStep): boolean {
  const standardMilliseconds = Number(step.standardMillisecondsPerUnit);
  const setupMilliseconds = Number(step.setupMilliseconds ?? 0);
  const unitsPerProduct = Number(step.unitsPerProduct ?? 1);
  return (step.timeBasis === 'per_unit' || step.timeBasis === 'per_batch')
    && Boolean(String(step.unitLabel || '').trim())
    && Number.isSafeInteger(standardMilliseconds)
    && standardMilliseconds > 0
    && Number.isSafeInteger(setupMilliseconds)
    && setupMilliseconds >= 0
    && Number.isSafeInteger(unitsPerProduct)
    && unitsPerProduct > 0;
}

/**
 * Production may start only when every non-skipped process has a complete,
 * immutable standard-time snapshot. Drawing and material readiness are
 * intentionally not part of this gate; they remain operational risk signals.
 */
export function processRouteExecutionReadiness(
  steps: ProcessRouteReadinessStep[] | null | undefined,
): ProcessRouteExecutionReadiness {
  const relevantSteps = (steps || []).filter(step => step.status !== 'skipped');
  const missingStepNames = relevantSteps
    .filter(step => !hasValidStandardTime(step))
    .map((step, index) => String(step.processName || '').trim() || `第 ${index + 1} 道工序`);
  return {
    ready: relevantSteps.length > 0 && missingStepNames.length === 0,
    missingStepNames,
  };
}
