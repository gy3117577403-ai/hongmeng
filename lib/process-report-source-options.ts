export type ProcessReportSourceChoice = {
  key: string;
  kind: 'NATIVE' | 'WIP';
  lotId?: string;
  lotNo?: string;
  allocationId?: string;
  availability: 'READY' | 'EXPIRED' | 'UNSCHEDULED' | 'FUTURE';
  startDate?: string;
  endDate?: string;
  limits: Array<{ stepId: string; quantity: number; actionQuantity: number }>;
};

export function reportSourceCanCoverSteps(source: ProcessReportSourceChoice, stepIds: string[]): boolean {
  return stepIds.length > 0 && stepIds.every(id => source.limits.some(step => step.stepId === id && (step.quantity > 0 || step.actionQuantity > 0)));
}

export function defaultProcessReportSource(choices: ProcessReportSourceChoice[], stepIds: string[]): string {
  const legal = choices.filter(source => source.availability === 'READY' && reportSourceCanCoverSteps(source, stepIds));
  return legal.length === 1 ? legal[0].key : '';
}

export function processReportSourceDateState(startDate: string | null | undefined, endDate: string | null | undefined, workDate: string): ProcessReportSourceChoice['availability'] {
  if (!startDate || !endDate) return 'UNSCHEDULED';
  if (workDate < startDate) return 'FUTURE';
  return workDate > endDate ? 'EXPIRED' : 'READY';
}

export function processReportSourceLabel(source: ProcessReportSourceChoice): string {
  if (source.kind === 'NATIVE') return '原订单未转出数量';
  return source.availability === 'READY' ? '可直接报工'
    : source.availability === 'EXPIRED' ? '原计划周已结束 · 续作待确认'
      : source.availability === 'FUTURE' ? '未来计划 · 提前生产待确认'
        : '仓内未排周 · 续作待确认';
}
