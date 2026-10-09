import { REPORT_DOMAINS, type ReportBranchKey } from './report-center-navigation';

// Stable business identifiers. Group headings are bulk-edit controls, not grants.
export const BUSINESS_SUBMODULE_BASE = [
  { key: 'production-execution', group: 'production', label: '生产执行', capabilities: ['PRODUCTION', 'BUSINESS'], paths: ['/production'], apis: ['/api/production'] },
  { key: 'planning', group: 'production', label: '量产计划', capabilities: ['PLANNING'], paths: ['/weekly-plan-center'], apis: ['/api/planning', '/api/weekly-plans'] },
  { key: 'sample-planning', group: 'production', label: '样品计划', capabilities: ['PLANNING'], paths: ['/sample-capture'], apis: ['/api/sample-'] },
  { key: 'order-pool', group: 'production', label: '订单池', capabilities: ['PLANNING'], paths: [], apis: ['/api/order-pool'] },
  { key: 'daily-shipment', group: 'production', label: '日出货计划', capabilities: ['PLANNING'], paths: ['/workspace/daily-plans'], apis: ['/api/daily-plans', '/api/daily-plan-tasks', '/api/daily-shipments'] },
  { key: 'weekly-process', group: 'production', label: '周工序总览', capabilities: ['PRODUCTION'], paths: ['/workspace/weekly-processes'], apis: ['/api/weekly-processes'] },
  { key: 'reporting-recovery', group: 'production', label: '报工补正与撤回', capabilities: ['PRODUCTION', 'PROCESS'], paths: ['/workspace/reporting-recovery'], apis: ['/api/process-report-submissions', '/api/process-completion-withdrawals'] },
  { key: 'quality-review', group: 'quality', label: '资料审核', capabilities: ['QUALITY'], paths: ['/workspace/reviews'], apis: ['/api/quality-fixtures/review-files', '/api/quality-fixtures/files'] },
  { key: 'fixture-management', group: 'quality', label: '治具管理', capabilities: ['QUALITY'], paths: [], apis: [] },
  { key: 'quality-management', group: 'quality', label: '质量管理', capabilities: ['QUALITY'], paths: ['/workspace/quality', '/quality-quick-capture'], apis: ['/api/quality', '/api/quality-quick'] },
  { key: 'quality-data', group: 'quality', label: '质量数据', capabilities: ['QUALITY_DATA'], paths: ['/workspace/quality/data', '/quality-capture'], apis: ['/api/quality-data', '/api/process-report-quality'] },
  { key: 'quality-tasks', group: 'quality', label: '我的质量任务', capabilities: ['QUALITY'], paths: ['/workspace/quality-tasks'], apis: ['/api/quality-tasks'] },
  { key: 'quality-confirmation', group: 'quality', label: '品质确认', capabilities: ['QUALITY'], paths: ['/workspace/quality-confirmation'], apis: ['/api/quality-confirmations'] },
  { key: 'finished-goods', group: 'materials', label: '成品仓', capabilities: ['WAREHOUSE'], paths: ['/workspace/finished-goods'], apis: ['/api/finished-goods'] },
  { key: 'material-follow-up', group: 'materials', label: '物料跟进', capabilities: ['PROCUREMENT'], paths: ['/workspace/procurement'], apis: ['/api/material-follow-ups'] },
  { key: 'purchasing', group: 'materials', label: '物品采购', capabilities: ['PROCUREMENT'], paths: ['/workspace/purchases'], apis: ['/api/purchases'] },
  { key: 'warehouse', group: 'materials', label: '仓库配料', capabilities: ['WAREHOUSE'], paths: ['/workspace/warehouse'], apis: ['/api/warehouse'] },
  { key: 'wip', group: 'materials', label: '半成品仓', capabilities: ['WAREHOUSE'], paths: ['/workspace/wip'], apis: ['/api/wip'] },
  { key: 'material-library', group: 'materials', label: '物料库', capabilities: ['MATERIAL_LIBRARY'], paths: ['/workspace/material-library', '/material-upload'], apis: ['/api/material-library'] },
  { key: 'drawing-library', group: 'technology', label: '图纸资料库', capabilities: ['DRAWING_LIBRARY', 'ENGINEERING'], paths: ['/drawing-library'], apis: ['/api/drawing-library', '/api/resource-files', '/api/upload'] },
  { key: 'assembly-manuals', group: 'technology', label: '组装说明书', capabilities: ['ASSEMBLY_MANUALS'], paths: ['/connector-assembly-manuals'], apis: ['/api/connector-assembly-manuals', '/api/connector-assembly-manual-versions', '/api/connector-assembly-manual-assets'] },
  { key: 'connector-parameters', group: 'technology', label: '连接器参数', capabilities: ['ENGINEERING'], paths: ['/connector-parameters'], apis: ['/api/connector-parameters', '/api/connector-parameter-files', '/api/connector-parameter-import-batches'] },
  { key: 'terminal-tooling', group: 'technology', label: '端子调模', capabilities: ['TERMINAL_TOOLING'], paths: ['/workspace/terminal-tooling', '/tooling-mobile'], apis: ['/api/terminal-tooling'] },
  { key: 'product-times', group: 'technology', label: '产品工序与工时', capabilities: ['PRODUCT_TIME', 'PROCESS'], paths: ['/workspace/product-times', '/workspace/time-standards', '/workspace/processes'], apis: ['/api/product-times', '/api/product-time-', '/api/processes', '/api/process-time-standards', '/api/process-definitions', '/api/process-templates', '/api/time-standards'] },
  { key: 'knowledge', group: 'technology', label: '知识库', capabilities: ['KNOWLEDGE'], paths: ['/workspace/knowledge'], apis: ['/api/knowledge'] },
  { key: 'capability-showcase', group: 'technology', label: '能力展厅', capabilities: ['ENGINEERING'], paths: ['/workspace/capability-showcase'], apis: ['/api/capability-showcase'] },
  { key: 'employees', group: 'people', label: '员工档案', capabilities: ['HR'], paths: ['/workspace/employees'], apis: ['/api/employees'] },
  { key: 'recruitment', group: 'people', label: '招聘管理', capabilities: ['HR'], paths: [], apis: ['/api/recruitment'] },
  { key: 'training', group: 'people', label: '培训与技能', capabilities: ['TRAINING'], paths: [], apis: ['/api/training', '/api/skills'] },
  { key: 'employee-accounts', group: 'people', label: '员工账号管理', capabilities: ['HR'], paths: ['/workspace/employees/accounts'], apis: [] },
  { key: 'responsibilities', group: 'people', label: '职责管理', capabilities: ['HR'], paths: ['/workspace/responsibilities'], apis: ['/api/responsibilities'] },
  { key: 'attendance', group: 'people', label: '考勤与异常', capabilities: ['ATTENDANCE'], paths: ['/workspace/attendance'], apis: ['/api/attendance'] },
  { key: 'abnormal-time', group: 'people', label: '异常工时', capabilities: ['HR'], paths: ['/workspace/abnormal-times'], apis: ['/api/abnormal-time-events'] },
  { key: 'other-hours', group: 'people', label: '其他工时', capabilities: ['HR'], paths: ['/workspace/other-hours'], apis: ['/api/other-work-times'] },
  { key: 'issues', group: 'collaboration', label: '问题管理', capabilities: ['ISSUE_MANAGEMENT'], paths: ['/workspace/issues'], apis: ['/api/issues'] },
  { key: 'major-approval', group: 'collaboration', label: '重大审批', capabilities: ['MAJOR_APPROVAL'], paths: ['/workspace/approvals'], apis: ['/api/approvals', '/api/major-quality-approvals'] },
  { key: 'other-hours-approval', group: 'collaboration', label: '其他工时审批', capabilities: ['MAJOR_APPROVAL'], paths: ['/workspace/other-hours/approvals'], apis: [] },
  { key: 'changes', group: 'collaboration', label: '变更管理', capabilities: ['CHANGE_MANAGEMENT'], paths: ['/workspace/changes'], apis: ['/api/changes', '/api/change-requests'] },
  { key: 'workflows', group: 'collaboration', label: '流程中心', capabilities: ['MAJOR_APPROVAL', 'PROCESS'], paths: ['/workspace/workflows'], apis: ['/api/workflows'] },
  { key: 'messages', group: 'collaboration', label: '消息中心', capabilities: ['NOTIFICATIONS'], paths: ['/workspace/messages'], apis: [] },
] as const;
export type SubmoduleKey = typeof BUSINESS_SUBMODULE_BASE[number]['key'] | `report-${ReportBranchKey}`;
export type BusinessGroupKey = 'production' | 'quality' | 'materials' | 'technology' | 'people' | 'collaboration' | 'reports';
export type BusinessSubmodule = { key: SubmoduleKey; group: BusinessGroupKey; label: string; capabilities: readonly string[]; paths: readonly string[]; apis: readonly string[]; readOnly?: boolean };
export const BUSINESS_SUBMODULES: readonly BusinessSubmodule[] = [
  ...BUSINESS_SUBMODULE_BASE,
  ...REPORT_DOMAINS.flatMap(domain => domain.branches.map(branch => ({ key: `report-${branch.key}` as SubmoduleKey, group: 'reports' as const, label: branch.label, capabilities: ['REPORT_CENTER'], paths: [`/workspace/reports/${domain.key}/${branch.key}`], apis: [], readOnly: true }))),
];
export function submoduleDefinition(key: string) { return BUSINESS_SUBMODULES.find(item => item.key === key); }
