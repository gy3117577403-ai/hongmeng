import { productionDateKey } from '@/lib/production-control';
import { resolveProductionLifecycle, type ProductionLifecycleFacts, type ProductionLifecycleState } from '@/lib/production-lifecycle';

/** A continuation's completion belongs to its allocation, not its source order's route. */
export function productionDispatchLifecycle(
  facts: ProductionLifecycleFacts & { continuationStatus?: string | null },
): ProductionLifecycleState {
  if (!facts.continuationStatus) return resolveProductionLifecycle(facts);
  const completed = facts.continuationStatus === 'COMPLETED' || facts.continuationStatus === 'SUPERSEDED';
  return { routeLocked: completed, aggregateCompleted: completed, awaitingBranchClosure: false };
}

export function completedProductionDeliveryRisk(input: {
  completedAt?: string | Date | null;
  customerDeliveryDate?: string | null;
}): { label: string; detail: string; tone: 'normal' | 'warning' } {
  const completed = productionDateKey(input.completedAt);
  const delivery = productionDateKey(input.customerDeliveryDate);
  if (!completed) {
    return { label: '已完成（完成时间待核实）', detail: '缺少有效完成时间，暂不判定交期达成', tone: 'normal' };
  }
  if (!delivery) {
    return { label: '已完成（客户交期待补）', detail: `完成日期 ${completed}`, tone: 'normal' };
  }
  const days = Math.round((Date.parse(completed) - Date.parse(delivery)) / 86_400_000);
  return {
    label: days > 0 ? `延期 ${days} 天完成` : '按期完成',
    detail: `完成 ${completed} · 客户交期 ${delivery}`,
    tone: days > 0 ? 'warning' : 'normal',
  };
}
