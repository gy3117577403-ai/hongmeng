export type ProductionArrangementDisplayStatus =
  | 'planned'
  | 'today'
  | 'partial'
  | 'completed'
  | 'overdue'
  | 'carried_over'
  | 'needs_review';

export type ProductionArrangementProgress = {
  status: ProductionArrangementDisplayStatus;
  completed: boolean;
  partial: boolean;
  overdue: boolean;
  remainingQty: number;
};

function positiveInteger(value: unknown): number {
  const result = Number(value);
  return Number.isSafeInteger(result) && result > 0 ? result : 0;
}

/**
 * Splits one process quantity across the selected employees without creating
 * duplicate production quantity. When a tiny batch has fewer units than
 * selected employees, the offset rotates the participating employees between
 * processes so a multi-process product can still be shared fairly.
 */
export function splitProductionArrangementQuantity(
  quantityValue: unknown,
  employeeIdsValue: readonly string[],
  offset = 0,
): Array<{ employeeId: string; quantity: number }> {
  const quantity = positiveInteger(quantityValue);
  const employeeIds = [...new Set(employeeIdsValue.map(item => String(item).trim()).filter(Boolean))];
  if (!quantity || !employeeIds.length) return [];

  const rotated = employeeIds.map((_, index) => employeeIds[(index + Math.max(0, offset)) % employeeIds.length]);
  const participantCount = Math.min(quantity, rotated.length);
  const participants = rotated.slice(0, participantCount);
  const base = Math.floor(quantity / participantCount);
  const remainder = quantity % participantCount;
  return participants.map((employeeId, index) => ({
    employeeId,
    quantity: base + (index < remainder ? 1 : 0),
  }));
}

export type ProductionArrangementRemainingRebuild = {
  plannedQty: number;
  completedQty: number;
  remainingQty: number;
  finalEmployeeIds: string[];
  assignments: Array<{ employeeId: string; quantity: number }>;
};

/**
 * Rebuilds only the unfinished part of a scheduled task.  Reported quantity is
 * intentionally kept outside of the new assignments because completion and
 * labor ledgers are historical facts, while assignments are a future plan.
 */
export function rebuildProductionArrangementRemaining(input: {
  plannedQty: unknown;
  completedQty: unknown;
  currentEmployeeIds: readonly string[];
  replacementEmployeeIds: readonly string[];
  sourceEmployeeId?: string | null;
  offset?: number;
}): ProductionArrangementRemainingRebuild {
  const plannedQty = positiveInteger(input.plannedQty);
  const completedQty = Math.max(0, Math.min(Number(input.completedQty) || 0, plannedQty));
  const remainingQty = Math.max(0, plannedQty - completedQty);
  const currentEmployeeIds = [...new Set(input.currentEmployeeIds.map(item => String(item).trim()).filter(Boolean))];
  const replacementEmployeeIds = [...new Set(input.replacementEmployeeIds.map(item => String(item).trim()).filter(Boolean))];
  const sourceEmployeeId = String(input.sourceEmployeeId || '').trim();
  const finalEmployeeIds = sourceEmployeeId
    ? [...new Set([...currentEmployeeIds.filter(id => id !== sourceEmployeeId), ...replacementEmployeeIds])]
    : replacementEmployeeIds;

  return {
    plannedQty,
    completedQty,
    remainingQty,
    finalEmployeeIds,
    assignments: splitProductionArrangementQuantity(remainingQty, finalEmployeeIds, input.offset || 0),
  };
}

export function resolveProductionArrangementProgress(input: {
  workDate: string;
  today: string;
  plannedQty: unknown;
  completedQty: unknown;
  taskStatus?: string | null;
}): ProductionArrangementProgress {
  const plannedQty = positiveInteger(input.plannedQty);
  const completedQty = Math.max(0, Math.min(positiveInteger(input.completedQty), plannedQty));
  const remainingQty = Math.max(0, plannedQty - completedQty);
  const taskStatus = String(input.taskStatus || '').toUpperCase();

  if (taskStatus === 'CARRIED_OVER') {
    return {
      status: 'carried_over',
      completed: false,
      partial: completedQty > 0,
      overdue: false,
      remainingQty,
    };
  }
  if (taskStatus === 'NEEDS_REVIEW') {
    return {
      status: 'needs_review',
      completed: false,
      partial: completedQty > 0,
      overdue: input.workDate < input.today && remainingQty > 0,
      remainingQty,
    };
  }
  if (remainingQty === 0 || taskStatus === 'COMPLETED') {
    return { status: 'completed', completed: true, partial: completedQty > 0, overdue: false, remainingQty: 0 };
  }
  const partial = completedQty > 0;
  if (input.workDate < input.today) {
    return { status: 'overdue', completed: false, partial, overdue: true, remainingQty };
  }
  if (partial) {
    return { status: 'partial', completed: false, partial: true, overdue: false, remainingQty };
  }
  if (input.workDate === input.today) {
    return { status: 'today', completed: false, partial: false, overdue: false, remainingQty };
  }
  return { status: 'planned', completed: false, partial: false, overdue: false, remainingQty };
}

export function productionArrangementCrossesWeek(input: {
  workDate: string;
  weekStartDate?: string | null;
  weekEndDate?: string | null;
}): boolean {
  if (!input.weekStartDate || !input.weekEndDate) return false;
  return input.workDate < input.weekStartDate || input.workDate > input.weekEndDate;
}
