import type { ProductionPlanBatchDTO, ProductionPlanOrderDTO } from '@/types';

export const PLANNING_READINESS_FILTERS = [
  'missing_time',
  'missing_drawing',
  'missing_material',
  'material_exception',
  'missing_process',
  'ready_preparation',
  'ready_production',
] as const;

export type PlanningReadinessFilter = typeof PLANNING_READINESS_FILTERS[number];

export type PlanningReadinessState = Record<PlanningReadinessFilter, boolean>;

const ORDER_LEVEL_FILTERS: ReadonlySet<PlanningReadinessFilter> = new Set([
  'missing_time',
  'missing_drawing',
  'ready_preparation',
]);

function hasUnitTime(order: ProductionPlanOrderDTO, batch?: ProductionPlanBatchDTO): boolean {
  return Boolean(
    batch?.unitMillisecondsSnapshot
    || order.effectiveUnitMilliseconds
    || order.currentUnitMilliseconds
    || order.planningUnitMilliseconds,
  );
}

function hasOriginalDrawing(order: ProductionPlanOrderDTO): boolean {
  return order.drawingFileCount > 0;
}

function hasConfirmedProcess(batch?: ProductionPlanBatchDTO): boolean {
  return batch?.processStatus === 'confirmed'
    || batch?.processStatus === 'in_progress'
    || batch?.processStatus === 'completed';
}

export function planningReadinessState(
  order: ProductionPlanOrderDTO,
  batch?: ProductionPlanBatchDTO,
): PlanningReadinessState {
  const unitTimeReady = hasUnitTime(order, batch);
  const drawingReady = hasOriginalDrawing(order);
  const preparationReady = unitTimeReady && drawingReady;
  const materialException = batch?.warehouseStatus === 'exception';
  const materialReady = batch?.warehouseStatus === 'completed';
  const processReady = hasConfirmedProcess(batch);

  return {
    missing_time: !unitTimeReady,
    missing_drawing: !drawingReady,
    missing_material: Boolean(batch) && !materialReady && !materialException,
    material_exception: Boolean(batch) && materialException,
    missing_process: Boolean(batch) && !processReady,
    ready_preparation: preparationReady,
    ready_production: Boolean(batch) && preparationReady && materialReady && processReady,
  };
}

export function matchesPlanningReadiness(
  order: ProductionPlanOrderDTO,
  batch: ProductionPlanBatchDTO | undefined,
  filters: readonly PlanningReadinessFilter[],
): boolean {
  if (filters.length === 0) return true;
  const state = planningReadinessState(order, batch);
  return filters.some(filter => state[filter]);
}

export function orderLevelReadinessFilters(
  filters: readonly PlanningReadinessFilter[],
): PlanningReadinessFilter[] {
  return filters.filter(filter => ORDER_LEVEL_FILTERS.has(filter));
}

export function isPlanningReadinessFilter(value: string): value is PlanningReadinessFilter {
  return (PLANNING_READINESS_FILTERS as readonly string[]).includes(value);
}
