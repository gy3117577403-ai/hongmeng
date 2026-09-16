import { planTotalMilliseconds, resolvePlanMilliseconds } from '@/lib/planning-time';

/** Match Planning Center's precedence without overwriting any saved plan values. */
export function originalPlanTime(input: { quantity: number; batchUnit?: number | null; orderUnit?: number | null;
  publishedUnit?: number | null; totalSnapshot?: string | bigint | null }) {
  const unit = resolvePlanMilliseconds(input.batchUnit, input.orderUnit, input.publishedUnit);
  const total = planTotalMilliseconds(unit, input.quantity);
  const fallback = Number(input.totalSnapshot || 0);
  return { milliseconds: total !== null ? Number(total) : fallback > 0 ? fallback : null,
    source: resolvePlanMilliseconds(input.batchUnit) ? 'batch' : resolvePlanMilliseconds(input.orderUnit) ? 'order'
      : resolvePlanMilliseconds(input.publishedUnit) ? 'published' : fallback > 0 ? 'total' : 'missing' } as const;
}

export type TaskTimeComparison = {
  originalPlan: number | null; originalSource: ReturnType<typeof originalPlanTime>['source'];
  currentStandard: number; missingSteps: number; priorDeducted: number; adjustedReported: number;
  estimate: number; movedOut: number; executionBasis: number;
};
export type PlanTimeComparison = {
  count: number; originalPlan: number; currentStandard: number; missingPlanCount: number; missingRouteCount: number;
  fallbackCount: number; changedCount: number; difference: number | null;
  priorDeducted: number; adjustedReported: number; estimate: number; movedOut: number;
  nativeBasis: number; wipBasis: number; executionBasis: number;
};
export function summarizeTimeComparison(rows: readonly TaskTimeComparison[], wipBasis = 0): PlanTimeComparison {
  const sum = (key: keyof TaskTimeComparison) => rows.reduce((n, row) => n + Number(row[key] || 0), 0);
  const missingPlanCount = rows.filter(r => r.originalPlan === null).length;
  const missingRouteCount = rows.filter(r => r.missingSteps > 0).length;
  return { count: rows.length, originalPlan: sum('originalPlan'), currentStandard: sum('currentStandard'),
    missingPlanCount, missingRouteCount, fallbackCount: rows.filter(r => r.originalSource === 'published').length,
    changedCount: rows.filter(r => r.originalPlan !== null && !r.missingSteps && r.originalPlan !== r.currentStandard).length,
    difference: missingPlanCount || missingRouteCount ? null : sum('originalPlan') - sum('currentStandard'),
    priorDeducted: sum('priorDeducted'), adjustedReported: sum('adjustedReported'), estimate: sum('estimate'), movedOut: sum('movedOut'),
    nativeBasis: sum('executionBasis'), wipBasis, executionBasis: sum('executionBasis') + wipBasis };
}
