export type ReportDomainKey = 'production' | 'delivery' | 'people' | 'quality' | 'governance' | 'sample';

export type ReportBranchKey =
  | 'quantity-attainment'
  | 'completed-orders'
  | 'order-status'
  | 'production-trend'
  | 'weekly-plan-attainment'
  | 'process-bottlenecks'
  | 'delivery-risk'
  | 'due-soon'
  | 'delivery-orders'
  | 'attendance-attainment'
  | 'team-hours'
  | 'employee-attainment'
  | 'employee-matrix'
  | 'labor-ledger'
  | 'unmatched-labor'
  | 'affected-labor'
  | 'cause-distribution'
  | 'open-events'
  | 'event-ledger'
  | 'completeness'
  | 'missing-route'
  | 'missing-standard'
  | 'missing-drawing'
  | 'missing-material'
  | 'sample-tasks'
  | 'pending-review'
  | 'published-materials'
  | 'review-attainment';

export type ReportBranchDefinition = {
  key: ReportBranchKey;
  label: string;
  shortLabel: string;
  description: string;
};

export type ReportDomainDefinition = {
  key: ReportDomainKey;
  label: string;
  caption: string;
  branches: readonly ReportBranchDefinition[];
};

export const REPORT_DOMAINS: readonly ReportDomainDefinition[] = [
  {
    key: 'production',
    label: '生产结果',
    caption: '计划与完工',
    branches: [
      { key: 'quantity-attainment', label: '数量达成率', shortLabel: '数量达成', description: '计划数量、最终工序良品、缺口与每日达成趋势' },
      { key: 'completed-orders', label: '完成工单', shortLabel: '完成工单', description: '所选周期内已经完成归档的量产工单' },
      { key: 'order-status', label: '工单状态分布', shortLabel: '工单状态', description: '已完成、进行中、待开始、待审核和逾期工单结构' },
      { key: 'production-trend', label: '生产趋势', shortLabel: '生产趋势', description: '按日对比计划数量与最终工序良品数量' },
      { key: 'weekly-plan-attainment', label: '周计划达成', shortLabel: '周计划达成', description: '按月拆解各周计划批次与计划数量完成情况' },
      { key: 'process-bottlenecks', label: '工序瓶颈', shortLabel: '工序瓶颈', description: '按工序分析待处理数量、涉及工单与逾期影响' },
    ],
  },
  {
    key: 'delivery',
    label: '生产交付',
    caption: '交期与风险',
    branches: [
      { key: 'delivery-risk', label: '逾期风险', shortLabel: '逾期风险', description: '已经超过计划交期且尚未完成的量产工单' },
      { key: 'due-soon', label: '即将到期', shortLabel: '即将到期', description: '未来两天内到期、需要提前处理的量产工单' },
      { key: 'delivery-orders', label: '交付工单', shortLabel: '交付工单', description: '按交期、状态、责任人与风险查看量产交付任务' },
    ],
  },
  {
    key: 'people',
    label: '人员工时',
    caption: '出勤与效率',
    branches: [
      { key: 'attendance-attainment', label: '全厂出勤达成率', shortLabel: '出勤达成', description: '确认考勤、有效出勤工时和每日出勤趋势' },
      { key: 'team-hours', label: '班组工时', shortLabel: '班组工时', description: '按班组查看应出勤、有效出勤、标准产出与达成率' },
      { key: 'employee-attainment', label: '员工达成率', shortLabel: '员工达成', description: '按员工核对确认出勤、标准工时、免责异常与达成率' },
      { key: 'employee-matrix', label: '个人达成矩阵', shortLabel: '个人矩阵', description: '员工与日期交叉查看每日达成率、草稿、休息和缺失状态' },
      { key: 'labor-ledger', label: '自动记工明细', shortLabel: '自动记工', description: '报工记录与员工标准工时自动入账映射' },
      { key: 'unmatched-labor', label: '待匹配工时', shortLabel: '待匹配工时', description: '有报工但尚未匹配确认考勤的标准工时' },
    ],
  },
  {
    key: 'quality',
    label: '质量异常',
    caption: '原因与闭环',
    branches: [
      { key: 'affected-labor', label: '异常影响工时', shortLabel: '影响工时', description: '异常事件时长、影响人时与已确认免责人时' },
      { key: 'cause-distribution', label: '异常原因分布', shortLabel: '原因分布', description: '按异常类别拆解事件数量和影响人时' },
      { key: 'open-events', label: '未关闭异常', shortLabel: '未关闭异常', description: '仍在处理中的异常事件和责任状态' },
      { key: 'event-ledger', label: '质量事件明细', shortLabel: '事件明细', description: '异常事件、品质确认状态与处理状态台账' },
    ],
  },
  {
    key: 'governance',
    label: '数据治理',
    caption: '资料完整性',
    branches: [
      { key: 'completeness', label: '资料完整率', shortLabel: '资料完整率', description: '工艺路线、标准工时、当前图纸和辅料规则四项正式资料核查' },
      { key: 'missing-route', label: '缺工艺路线', shortLabel: '缺工艺路线', description: '尚未建立正式工艺路线的量产工单' },
      { key: 'missing-standard', label: '缺标准工时', shortLabel: '缺标准工时', description: '已有工艺路线但效率工序缺少标准工时的工单' },
      { key: 'missing-drawing', label: '缺当前图纸', shortLabel: '缺当前图纸', description: '未关联当前有效图纸的量产工单' },
      { key: 'missing-material', label: '缺辅料规则', shortLabel: '缺辅料规则', description: '关联产品尚未发布辅料规则的量产工单' },
    ],
  },
  {
    key: 'sample',
    label: '样品资料',
    caption: '采集与审核',
    branches: [
      { key: 'sample-tasks', label: '样品任务', shortLabel: '样品任务', description: '样品数据采集、过程照片和任务进度' },
      { key: 'pending-review', label: '待分项审核', shortLabel: '待分项审核', description: '实际已提交但尚未完成分项审核的数据和照片' },
      { key: 'published-materials', label: '已发布资料', shortLabel: '已发布资料', description: '审核完成并已发布到正式产品资料的样品数据' },
      { key: 'review-attainment', label: '审核完成率', shortLabel: '审核完成率', description: '已审核项目与已提交项目的完成比例' },
    ],
  },
] as const;

export function reportDomain(domain: string | null | undefined): ReportDomainDefinition | null {
  return REPORT_DOMAINS.find(item => item.key === domain) || null;
}

export function reportBranch(domain: string | null | undefined, branch: string | null | undefined): ReportBranchDefinition | null {
  return reportDomain(domain)?.branches.find(item => item.key === branch) || null;
}

export function defaultReportBranch(domain: ReportDomainKey): ReportBranchDefinition {
  return reportDomain(domain)!.branches[0];
}

export function reportRoute(domain: ReportDomainKey, branch: ReportBranchKey): string {
  return `/workspace/reports/${domain}/${branch}`;
}

export function hasFullReportAccess(modules: readonly string[]): boolean {
  return ['BUSINESS', 'PLANNING', 'PRODUCTION', 'MAJOR_APPROVAL'].some(module => modules.includes(module));
}

export function defaultReportRoute(modules: readonly string[]): string {
  return hasFullReportAccess(modules)
    ? reportRoute('production', 'quantity-attainment')
    : reportRoute('people', 'employee-attainment');
}

function firstValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] || '' : value || '';
}

export function legacyReportRoute(
  searchParams: Record<string, string | string[] | undefined>,
  modules: readonly string[],
): string {
  if (!hasFullReportAccess(modules)) return reportRoute('people', 'employee-attainment');
  const requested = firstValue(searchParams.branch) || firstValue(searchParams.view);
  const section = firstValue(searchParams.section);
  if (requested === 'operations') {
    if (section === 'labor') return reportRoute('people', 'team-hours');
    if (section === 'attendance') return reportRoute('people', 'attendance-attainment');
    if (section === 'matrix') return reportRoute('people', 'employee-matrix');
    if (section === 'plan') return reportRoute('production', 'weekly-plan-attainment');
    return reportRoute('production', 'production-trend');
  }
  if (requested === 'people' || requested === 'employee') {
    return section === 'labor' ? reportRoute('people', 'labor-ledger') : reportRoute('people', 'employee-attainment');
  }
  if (requested === 'labor' || requested === 'manual') return reportRoute('people', 'labor-ledger');
  if (requested === 'production') {
    if (section === 'orders') return reportRoute('production', 'order-status');
    if (section === 'load') return reportRoute('production', 'process-bottlenecks');
    return reportRoute('production', 'quantity-attainment');
  }
  if (requested === 'quality' || requested === 'abnormal') {
    return section === 'events' ? reportRoute('quality', 'event-ledger') : reportRoute('quality', 'cause-distribution');
  }
  if (requested === 'governance') return reportRoute('governance', 'completeness');
  if (requested === 'sample') return section === 'review'
    ? reportRoute('sample', 'pending-review')
    : reportRoute('sample', 'sample-tasks');
  return defaultReportRoute(modules);
}
