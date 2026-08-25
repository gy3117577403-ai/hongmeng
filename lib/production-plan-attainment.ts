export type ProductionPlanAttainment = {
  totalOrders: number;
  completedOrders: number;
  percentage: number | null;
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
