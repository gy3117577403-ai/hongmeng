type WorkflowSelectableItem = {
  id: string;
  batchId?: string | null;
  workOrderId?: string | null;
};

export function selectWorkflowItem<T extends WorkflowSelectableItem>(input: {
  items: readonly T[];
  batchId?: string | null;
  workOrderId?: string | null;
  preferredId?: string | null;
}): T | null {
  const batchId = String(input.batchId || '').trim();
  const workOrderId = String(input.workOrderId || '').trim();
  const deepLinked = batchId
    ? input.items.find(item => item.batchId === batchId)
    : workOrderId
      ? input.items.find(item => item.workOrderId === workOrderId)
      : null;

  if (batchId || workOrderId) return deepLinked || null;
  const preferredId = String(input.preferredId || '').trim();
  return input.items.find(item => item.id === preferredId) || input.items[0] || null;
}
