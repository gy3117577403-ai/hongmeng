export const PRODUCT_TIME_INSERT_POLICIES = [
  'AUTO_BY_PROGRESS',
  'FUTURE_ONLY',
  'RECALL_REWORK',
] as const;

export type ProductTimeInsertPolicy = typeof PRODUCT_TIME_INSERT_POLICIES[number];

export type ProcessSupplementFulfillmentModeValue =
  | 'ACTUAL'
  | 'MIXED'
  | 'SYSTEM_COVERED'
  | 'FUTURE_ONLY'
  | 'RECALL_REQUIRED';

export type ProductTimeCoverageProjection = {
  execution: 'normal' | 'supplement';
  policy: ProductTimeInsertPolicy;
  fulfillmentMode: ProcessSupplementFulfillmentModeValue;
  routeTargetQty: number;
  obligationRequiredQty: number;
  systemCoveredQty: number;
  actualRequiredQty: number;
  obligationStatus: 'ACTIVE' | 'FULFILLED';
  shouldReopenCompletedRoute: boolean;
  excludedFromExistingRoute: boolean;
};

function quantity(value: unknown): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

export function normalizeProductTimeInsertPolicy(value: unknown): ProductTimeInsertPolicy | null {
  const normalized = String(value || '').trim().toUpperCase();
  return PRODUCT_TIME_INSERT_POLICIES.includes(normalized as ProductTimeInsertPolicy)
    ? normalized as ProductTimeInsertPolicy
    : null;
}

export function normalizeProductTimeInsertPolicies(value: unknown): Record<string, ProductTimeInsertPolicy> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const normalized: Record<string, ProductTimeInsertPolicy> = {};
  for (const [occurrenceKey, policyValue] of Object.entries(value as Record<string, unknown>)) {
    const key = String(occurrenceKey || '').trim().slice(0, 120);
    const policy = normalizeProductTimeInsertPolicy(policyValue);
    if (key && policy) normalized[key] = policy;
  }
  return normalized;
}

export function processSupplementActualRequiredQty(input: {
  requiredQty: unknown;
  systemCoveredQty?: unknown;
  fulfillmentMode?: unknown;
}): number {
  if (String(input.fulfillmentMode || '').toUpperCase() === 'FUTURE_ONLY') return 0;
  return Math.max(0, quantity(input.requiredQty) - quantity(input.systemCoveredQty));
}

export function processSupplementRemainingQty(input: {
  requiredQty: unknown;
  systemCoveredQty?: unknown;
  reportedQty?: unknown;
  fulfillmentMode?: unknown;
}): number {
  return Math.max(0, processSupplementActualRequiredQty(input) - quantity(input.reportedQty));
}

export function projectProductTimeCoverage(input: {
  routeTargetQty: number;
  routeHasFacts: boolean;
  routeCompleted: boolean;
  hasNextExistingStep: boolean;
  downstreamHasFacts: boolean;
  boundaryProgressQty: number;
  policy: ProductTimeInsertPolicy;
}): ProductTimeCoverageProjection {
  const routeTargetQty = quantity(input.routeTargetQty);
  const boundaryProgressQty = Math.min(routeTargetQty, quantity(input.boundaryProgressQty));

  if (!input.routeHasFacts) {
    return {
      execution: 'normal',
      policy: input.policy,
      fulfillmentMode: 'ACTUAL',
      routeTargetQty,
      obligationRequiredQty: 0,
      systemCoveredQty: 0,
      actualRequiredQty: routeTargetQty,
      obligationStatus: 'ACTIVE',
      shouldReopenCompletedRoute: false,
      excludedFromExistingRoute: false,
    };
  }

  if (input.policy === 'FUTURE_ONLY') {
    return {
      execution: 'supplement',
      policy: input.policy,
      fulfillmentMode: 'FUTURE_ONLY',
      routeTargetQty,
      // Preserve the route target in the immutable obligation/audit record.
      // FUTURE_ONLY, rather than a zero target, excludes this started route
      // from actual reporting.
      obligationRequiredQty: routeTargetQty,
      systemCoveredQty: 0,
      actualRequiredQty: 0,
      obligationStatus: 'FULFILLED',
      shouldReopenCompletedRoute: false,
      excludedFromExistingRoute: true,
    };
  }

  if (input.policy === 'RECALL_REWORK') {
    return {
      execution: 'supplement',
      policy: input.policy,
      fulfillmentMode: 'RECALL_REQUIRED',
      routeTargetQty,
      obligationRequiredQty: routeTargetQty,
      systemCoveredQty: 0,
      actualRequiredQty: routeTargetQty,
      obligationStatus: routeTargetQty > 0 ? 'ACTIVE' : 'FULFILLED',
      shouldReopenCompletedRoute: input.routeCompleted && routeTargetQty > 0,
      excludedFromExistingRoute: false,
    };
  }

  if (!input.routeCompleted && input.hasNextExistingStep && !input.downstreamHasFacts) {
    return {
      execution: 'normal',
      policy: input.policy,
      fulfillmentMode: 'ACTUAL',
      routeTargetQty,
      obligationRequiredQty: 0,
      systemCoveredQty: 0,
      actualRequiredQty: routeTargetQty,
      obligationStatus: 'ACTIVE',
      shouldReopenCompletedRoute: false,
      excludedFromExistingRoute: false,
    };
  }

  const systemCoveredQty = input.routeCompleted ? routeTargetQty : boundaryProgressQty;
  const actualRequiredQty = Math.max(0, routeTargetQty - systemCoveredQty);
  const fulfillmentMode: ProcessSupplementFulfillmentModeValue = actualRequiredQty === 0
    ? 'SYSTEM_COVERED'
    : systemCoveredQty > 0
      ? 'MIXED'
      : 'ACTUAL';
  return {
    execution: 'supplement',
    policy: input.policy,
    fulfillmentMode,
    routeTargetQty,
    obligationRequiredQty: routeTargetQty,
    systemCoveredQty,
    actualRequiredQty,
    obligationStatus: actualRequiredQty === 0 ? 'FULFILLED' : 'ACTIVE',
    shouldReopenCompletedRoute: input.routeCompleted && actualRequiredQty > 0,
    excludedFromExistingRoute: false,
  };
}
