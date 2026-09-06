/** When the last pending requirement is deleted, entry checkpoints can prove
 * that this lot already passed every remaining operation. This does not create
 * another report, material movement, or quantity on the source work order. */
export function wipEntryCheckpointClosesRoute(input: { completedStepIds: unknown; liveStepIds: string[] }) {
  if (!Array.isArray(input.completedStepIds) || !input.liveStepIds.length) return false;
  const completed = new Set(input.completedStepIds);
  return input.liveStepIds.every(id => completed.has(id));
}
