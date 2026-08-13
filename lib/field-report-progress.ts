export type FieldReportStepTone = 'coverage' | 'completed' | 'partial' | 'current' | 'ready';

export type FieldReportStepPresentation = {
  label: string;
  tone: FieldReportStepTone;
  reportingComplete: boolean;
  reportingPercent: number;
  coveragePercent: number;
};

function percent(value: number, target: number): number {
  if (!Number.isFinite(target) || target <= 0) return 0;
  return Math.min(100, Math.max(0, value) / target * 100);
}

export function resolveFieldReportStepPresentation(input: {
  status: string;
  reportedQty: number;
  coveredReportedQty: number;
  pendingCoverageQty: number;
  targetQty: number;
}): FieldReportStepPresentation {
  const reportingComplete = input.targetQty > 0 && input.reportedQty >= input.targetQty;
  if (reportingComplete && input.pendingCoverageQty > 0) {
    return {
      label: '已报满 · 待覆盖',
      tone: 'coverage',
      reportingComplete,
      reportingPercent: percent(input.reportedQty, input.targetQty),
      coveragePercent: percent(input.coveredReportedQty, input.targetQty),
    };
  }
  if (input.pendingCoverageQty > 0) {
    return {
      label: '部分已报 · 待覆盖',
      tone: 'coverage',
      reportingComplete,
      reportingPercent: percent(input.reportedQty, input.targetQty),
      coveragePercent: percent(input.coveredReportedQty, input.targetQty),
    };
  }
  if (input.status === 'completed' || (input.targetQty > 0 && input.coveredReportedQty >= input.targetQty)) {
    return {
      label: '已报完成',
      tone: 'completed',
      reportingComplete: true,
      reportingPercent: 100,
      coveragePercent: 100,
    };
  }
  const tone: FieldReportStepTone = input.reportedQty > 0
    ? 'partial'
    : input.status === 'current'
      ? 'current'
      : 'ready';
  return {
    label: input.reportedQty > 0 ? '部分报工' : input.status === 'current' ? '当前工序' : '可选择报工',
    tone,
    reportingComplete,
    reportingPercent: percent(input.reportedQty, input.targetQty),
    coveragePercent: percent(input.coveredReportedQty, input.targetQty),
  };
}
