import { basisPoints } from '@/lib/attendance';
import { cappedBasisPoints } from '@/lib/report-operations';
import type {
  ReportCompletedBatchRowDTO,
  ReportCompletedBatchStatusDTO,
  ReportCompletedBatchesDTO,
} from '@/types';

export type FinalStepCompletion = {
  completedAt: Date;
  goodQty: number;
};

export type CompletedBatchStateInput = {
  quantity: number;
  plannedCompletionDate: Date;
  cutoffAt: Date;
  releaseState: string;
  workOrderId: string | null;
  hasFinalRouteStep: boolean;
  started: boolean;
  completions: FinalStepCompletion[];
};

export type CompletedBatchState = {
  completedQuantity: number;
  actualCompletionAt: Date | null;
  status: ReportCompletedBatchStatusDTO;
  statusLabel: string;
  overdue: boolean;
};

function shanghaiDateKey(value: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(value);
}

export function completedBatchStatusLabel(status: ReportCompletedBatchStatusDTO): string {
  const labels: Record<ReportCompletedBatchStatusDTO, string> = {
    completed_on_time: '按期完成',
    completed_late: '延期完成',
    overdue: '已逾期',
    in_progress: '进行中',
    pending: '待开始',
    unreleased: '未下发',
    route_missing: '缺工艺路线',
  };
  return labels[status];
}

/**
 * A batch is complete only when non-voided final-step good quantity reaches the
 * batch quantity before the report cutoff. Work-order status flags are not used
 * as a substitute for production facts.
 */
export function deriveCompletedBatchState(input: CompletedBatchStateInput): CompletedBatchState {
  const quantity = Math.max(0, Math.round(input.quantity));
  const cutoffTime = input.cutoffAt.getTime();
  const completions = input.completions
    .filter(item => item.completedAt.getTime() <= cutoffTime)
    .sort((left, right) => left.completedAt.getTime() - right.completedAt.getTime());
  let cumulativeGood = 0;
  let actualCompletionAt: Date | null = null;
  for (const completion of completions) {
    cumulativeGood += Math.max(0, Math.round(completion.goodQty));
    if (!actualCompletionAt && quantity > 0 && cumulativeGood >= quantity) {
      actualCompletionAt = completion.completedAt;
    }
  }
  const completedQuantity = quantity > 0 ? Math.min(quantity, cumulativeGood) : 0;
  const overdue = !actualCompletionAt
    && shanghaiDateKey(input.cutoffAt) > shanghaiDateKey(input.plannedCompletionDate);

  let status: ReportCompletedBatchStatusDTO;
  if (actualCompletionAt) {
    status = shanghaiDateKey(actualCompletionAt) <= shanghaiDateKey(input.plannedCompletionDate)
      ? 'completed_on_time'
      : 'completed_late';
  } else if (input.workOrderId && !input.hasFinalRouteStep) {
    status = 'route_missing';
  } else if (!input.workOrderId || input.releaseState === 'draft') {
    status = 'unreleased';
  } else if (overdue) {
    status = 'overdue';
  } else if (input.started || completedQuantity > 0) {
    status = 'in_progress';
  } else {
    status = 'pending';
  }

  return {
    completedQuantity,
    actualCompletionAt,
    status,
    statusLabel: completedBatchStatusLabel(status),
    overdue,
  };
}

export function summarizeCompletedBatches(
  rows: ReportCompletedBatchRowDTO[],
): ReportCompletedBatchesDTO['summary'] {
  const totals = rows.reduce((sum, row) => ({
    dueBatches: sum.dueBatches + 1,
    completedBatches: sum.completedBatches
      + (row.status === 'completed_on_time' || row.status === 'completed_late' ? 1 : 0),
    onTimeCompletedBatches: sum.onTimeCompletedBatches + (row.status === 'completed_on_time' ? 1 : 0),
    lateCompletedBatches: sum.lateCompletedBatches + (row.status === 'completed_late' ? 1 : 0),
    overdueBatches: sum.overdueBatches + (row.overdue ? 1 : 0),
    inProgressBatches: sum.inProgressBatches + (row.status === 'in_progress' ? 1 : 0),
    pendingBatches: sum.pendingBatches + (row.status === 'pending' ? 1 : 0),
    unreleasedBatches: sum.unreleasedBatches + (row.status === 'unreleased' ? 1 : 0),
    routeMissingBatches: sum.routeMissingBatches + (row.status === 'route_missing' ? 1 : 0),
    plannedQuantity: sum.plannedQuantity + Math.max(0, row.quantity),
    completedQuantity: sum.completedQuantity + Math.max(0, row.completedQuantity),
  }), {
    dueBatches: 0,
    completedBatches: 0,
    onTimeCompletedBatches: 0,
    lateCompletedBatches: 0,
    overdueBatches: 0,
    inProgressBatches: 0,
    pendingBatches: 0,
    unreleasedBatches: 0,
    routeMissingBatches: 0,
    plannedQuantity: 0,
    completedQuantity: 0,
  });
  return {
    ...totals,
    batchCompletionBasisPoints: cappedBasisPoints(totals.completedBatches, totals.dueBatches),
    onTimeAttainmentBasisPoints: cappedBasisPoints(totals.onTimeCompletedBatches, totals.dueBatches),
    quantityAttainmentBasisPoints: cappedBasisPoints(totals.completedQuantity, totals.plannedQuantity),
  };
}

export function completedBatchQuantityBasisPoints(completedQuantity: number, quantity: number): number | null {
  return basisPoints(Math.min(Math.max(0, completedQuantity), Math.max(0, quantity)), Math.max(0, quantity));
}
