export type WipMovedOutNavigationTarget = {
  targetWeekStartDate: string;
  allocationIds: string[];
  remainingQuantity: number;
};

/**
 * Choose the action target for a source order whose unfinished work moved into
 * WIP. The first target week that still owns remaining work takes precedence;
 * only after every target is complete do we fall back to the latest history.
 */
export function selectPrimaryWipMovedOutTarget<T extends WipMovedOutNavigationTarget>(
  targets: readonly T[],
): T | null {
  const ordered = [...targets].sort((left, right) => (
    left.targetWeekStartDate.localeCompare(right.targetWeekStartDate)
    || (left.allocationIds[0] || '').localeCompare(right.allocationIds[0] || '')
  ));
  return ordered.find(target => target.remainingQuantity > 0)
    || ordered.at(-1)
    || null;
}
