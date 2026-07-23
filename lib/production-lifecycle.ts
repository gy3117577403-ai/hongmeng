export type ProductionLifecycleFacts = {
  routeCompleted: boolean;
  workOrderCompletedAt?: string | Date | null;
};

export type ProductionLifecycleState = {
  routeLocked: boolean;
  aggregateCompleted: boolean;
  awaitingBranchClosure: boolean;
};

export function resolveProductionLifecycle(
  facts: ProductionLifecycleFacts,
): ProductionLifecycleState {
  const aggregateCompleted = Boolean(facts.workOrderCompletedAt);
  const routeLocked = facts.routeCompleted;
  return {
    routeLocked,
    aggregateCompleted,
    awaitingBranchClosure: routeLocked && !aggregateCompleted,
  };
}
