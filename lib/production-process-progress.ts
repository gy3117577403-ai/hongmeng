type ProgressStep = {
  id: string; processName: string; status: string; inputQty?: number; processedQty?: number;
  executionMode?: string; completedProcessedQuantity?: number;
  actualRequiredQty?: number | null; supplementRemainingQty?: number | null;
};

export function productionProcessProgress(steps: readonly ProgressStep[], targetQuantity: number) {
  return steps.filter(step => !['completed', 'skipped'].includes(step.status)).map(step => {
    const supplemental = step.executionMode === 'SUPPLEMENTAL_OBLIGATION';
    const required = supplemental ? Math.max(0, step.actualRequiredQty || 0) : Math.max(step.inputQty || 0, targetQuantity);
    const confirmed = supplemental ? Math.max(0, required - (step.supplementRemainingQty ?? required)) : step.processedQty || 0;
    const reported = supplemental ? confirmed : Math.max(confirmed, step.completedProcessedQuantity || 0);
    const pending = supplemental ? 0 : Math.max(0, reported - confirmed);
    const remaining = Math.max(0, required - reported);
    const reason = pending > 0 ? `已报 ${reported}，待核销 ${pending}`
      : remaining > 0 ? `已确认 ${confirmed}/${required}，待报 ${remaining}`
      : '数量已齐，待工序状态同步';
    return { id: step.id, name: step.processName, required, confirmed, reported, pending, remaining, reason,
      percentage: required > 0 ? Math.min(100, Math.floor(confirmed / required * 100)) : 0 };
  });
}
