import type {
  ReportCenterFocusStatusDTO,
  ReportCenterRiskDTO,
} from '@/types';

const DAY_MS = 86_400_000;

export function parseReportQuantity(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const normalized = typeof value === 'string' ? value.replaceAll(',', '').trim() : value;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}

export function reportBasisPoints(
  numerator: number,
  denominator: number,
  capAtHundred = true,
): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return null;
  const value = Math.max(0, Math.round((numerator / denominator) * 10_000));
  return capAtHundred ? Math.min(10_000, value) : value;
}

export function reportDateKey(value: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(value);
}

export function reportRangeDayKeys(start: Date, end: Date): string[] {
  const keys: string[] = [];
  for (let cursor = start.getTime(); cursor < end.getTime() && keys.length < 31; cursor += DAY_MS) {
    keys.push(reportDateKey(new Date(cursor)));
  }
  return keys;
}

export function reportDateLabel(dateKey: string): string {
  const parts = dateKey.split('-');
  return parts.length === 3 ? `${parts[1]}/${parts[2]}` : dateKey;
}

export function reportPlanningDateKey(input: {
  plannedAt: Date | null;
  start: Date;
  end: Date;
}): string {
  const plannedAt = input.plannedAt;
  const selected = plannedAt && plannedAt >= input.start && plannedAt < input.end
    ? plannedAt
    : input.start;
  return reportDateKey(selected);
}

export function reportWorkOrderStatus(input: {
  completed: boolean;
  started: boolean;
  dueAt: Date | null;
  referenceAt: Date;
}): { status: ReportCenterFocusStatusDTO; label: string } {
  if (input.completed) return { status: 'completed', label: '已完成' };
  if (input.dueAt && input.dueAt.getTime() < input.referenceAt.getTime()) {
    return { status: 'overdue', label: '已逾期' };
  }
  if (input.started) return { status: 'in_progress', label: '进行中' };
  return { status: 'pending', label: '待开始' };
}

export function reportSampleStatus(input: {
  status: string;
  dueAt: Date | null;
  referenceAt: Date;
  pendingReviewCount: number;
}): { status: ReportCenterFocusStatusDTO; label: string } {
  const normalized = input.status.trim().toUpperCase();
  if (['COMPLETED', 'PROCESSED', 'CANCELLED'].includes(normalized)) {
    return { status: 'completed', label: normalized === 'CANCELLED' ? '已取消' : '已完成' };
  }
  if (input.dueAt && input.dueAt.getTime() < input.referenceAt.getTime()) {
    return { status: 'overdue', label: '已逾期' };
  }
  if (input.pendingReviewCount > 0 || normalized === 'PENDING_REVIEW') {
    return { status: 'review', label: '待审核' };
  }
  if (['IN_PROGRESS', 'COLLECTING', 'SUBMITTED'].includes(normalized)) {
    return { status: 'in_progress', label: '进行中' };
  }
  return { status: 'pending', label: '待开始' };
}

export function reportRisk(input: {
  status: ReportCenterFocusStatusDTO;
  dueAt: Date | null;
  referenceAt: Date;
  missingDataCount: number;
  pendingReviewCount?: number;
}): { risk: ReportCenterRiskDTO; label: string } {
  if (input.status === 'completed') return { risk: 'low', label: '已完成' };
  if (input.status === 'overdue') return { risk: 'high', label: '逾期需处理' };
  if (input.missingDataCount >= 2) return { risk: 'high', label: '关键资料缺口' };
  if ((input.pendingReviewCount || 0) > 0) return { risk: 'medium', label: '存在待审核项' };
  if (input.missingDataCount > 0) return { risk: 'medium', label: '资料待补齐' };
  if (input.dueAt) {
    const days = Math.ceil((input.dueAt.getTime() - input.referenceAt.getTime()) / DAY_MS);
    if (days >= 0 && days <= 2) return { risk: 'medium', label: '临近交期' };
  }
  return { risk: 'low', label: '正常' };
}

export function reportCompletenessBasisPoints(items: Array<{
  routeReady: boolean;
  standardReady: boolean;
  drawingReady: boolean;
}>): number | null {
  if (!items.length) return null;
  const completedChecks = items.reduce((sum, item) => sum
    + Number(item.routeReady)
    + Number(item.standardReady)
    + Number(item.drawingReady), 0);
  return reportBasisPoints(completedChecks, items.length * 3);
}
