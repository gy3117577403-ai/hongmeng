export type ProductionPlanAttainment = {
  totalOrders: number;
  completedOrders: number;
  percentage: number | null;
};

export type ProductionPlanAttainmentRecord = {
  completed: boolean;
  weekStartDateKey: string | null;
};

export function productionPlanAttainment(
  completedOrdersValue: number,
  totalOrdersValue: number,
): ProductionPlanAttainment {
  const totalOrders = Math.max(0, Math.trunc(totalOrdersValue || 0));
  const completedOrders = Math.min(totalOrders, Math.max(0, Math.trunc(completedOrdersValue || 0)));
  return {
    totalOrders,
    completedOrders,
    percentage: totalOrders > 0 ? Math.round((completedOrders / totalOrders) * 1000) / 10 : null,
  };
}

/**
 * The current execution board also contains carryover orders. Those orders stay
 * visible and actionable, but they must not dilute the native current-week plan
 * rate. Passing a currentWeekStartDateKey limits the denominator to orders that
 * were actually assigned to that production week; other scopes use all rows.
 */
export function productionPlanAttainmentForScope(
  records: readonly ProductionPlanAttainmentRecord[],
  currentWeekStartDateKey: string | null,
): ProductionPlanAttainment {
  const scopedRecords = currentWeekStartDateKey
    ? records.filter(record => record.weekStartDateKey === currentWeekStartDateKey)
    : records;
  return productionPlanAttainment(
    scopedRecords.filter(record => record.completed).length,
    scopedRecords.length,
  );
}
