export type WeeklyProcessAllocationSummary = {
  batchQuantity: number;
  processedQuantity: number;
  allocatedQuantity: number;
  coveredQuantity: number;
  remainingQuantity: number;
};

function quantity(value: unknown): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
}

/**
 * A process may be split across daily plans, but its weekly allocation may not
 * exceed the production batch. Actual processed quantity and planned quantity
 * describe overlapping coverage, so the larger value wins rather than adding
 * them together.
 */
export function summarizeWeeklyProcessAllocation(input: {
  batchQuantity: unknown;
  processedQuantity: unknown;
  plannedQuantities: unknown[];
}): WeeklyProcessAllocationSummary {
  const batchQuantity = quantity(input.batchQuantity);
  const processedQuantity = quantity(input.processedQuantity);
  const allocatedQuantity = input.plannedQuantities.reduce<number>((sum, value) => sum + quantity(value), 0);
  const coveredQuantity = Math.max(processedQuantity, allocatedQuantity);
  return {
    batchQuantity,
    processedQuantity,
    allocatedQuantity,
    coveredQuantity,
    remainingQuantity: Math.max(0, batchQuantity - coveredQuantity),
  };
}

export function weeklyProcessTeamEligible(input: {
  processDefinitionId: string | null | undefined;
  teamProcessDefinitionIds: ReadonlySet<string>;
  globallyOwnedProcessDefinitionIds: ReadonlySet<string>;
}): boolean {
  const processDefinitionId = String(input.processDefinitionId || '').trim();
  if (!processDefinitionId) return true;
  return !input.globallyOwnedProcessDefinitionIds.has(processDefinitionId)
    || input.teamProcessDefinitionIds.has(processDefinitionId);
}
