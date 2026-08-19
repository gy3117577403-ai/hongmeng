import type { AccessModuleCode } from '@/lib/department-access';

export type AccessDataContract = {
  label: string;
  endpoints: readonly string[];
  datasetKey?: 'workOrders' | 'drawings' | 'manuals' | 'productTimes' | 'attendance' | 'employees' | 'completions' | 'issues' | 'materialFollowUps';
  scoped?: boolean;
};

/**
 * One registry connects visible modules to their minimum read APIs. The admin
 * audit and tests consume the same registry, so adding a menu without a data
 * contract becomes a visible failure instead of an empty page in production.
 */
export const ACCESS_DATA_CONTRACTS: Partial<Record<AccessModuleCode, AccessDataContract>> = {
  FIELD_REPORT: { label: '现场报工', endpoints: ['/api/field-report/terminals'], scoped: true },
  BUSINESS: { label: '业务订单', endpoints: ['/api/work-orders'], datasetKey: 'workOrders' },
  PROCUREMENT: { label: '物料跟进', endpoints: ['/api/material-follow-ups'], datasetKey: 'materialFollowUps' },
  WAREHOUSE: { label: '仓库管理', endpoints: ['/api/warehouse/material-tasks'] },
  ENGINEERING: { label: '技术资料', endpoints: ['/api/drawing-library'], datasetKey: 'drawings' },
  QUALITY: { label: '质量协同', endpoints: ['/api/issues'], datasetKey: 'issues' },
  PROCESS: { label: '工艺管理', endpoints: ['/api/product-time-profiles'], datasetKey: 'productTimes' },
  ISSUE_MANAGEMENT: { label: '问题管理', endpoints: ['/api/issues'], datasetKey: 'issues' },
  CHANGE_MANAGEMENT: { label: '变更管理', endpoints: ['/api/changes'] },
  DRAWING_LIBRARY: { label: '图纸资料库', endpoints: ['/api/drawing-library'], datasetKey: 'drawings' },
  ASSEMBLY_MANUALS: {
    label: '组装说明书',
    endpoints: [
      '/api/connector-assembly-manuals',
      '/api/connector-assembly-manual-versions/example',
      '/api/connector-assembly-manual-assets/example/content',
      '/api/connector-parameters',
    ],
    datasetKey: 'manuals',
  },
  PRODUCT_TIME: {
    label: '产品工序与工时',
    endpoints: [
      '/api/product-time-profiles',
      '/api/product-time-profiles/example',
      '/api/drawing-library/example',
      '/api/product-time-deployments/example',
    ],
    datasetKey: 'productTimes',
  },
  ATTENDANCE: {
    label: '考勤与异常',
    endpoints: ['/api/attendance/employees', '/api/attendance/records', '/api/abnormal-time-events'],
    datasetKey: 'attendance',
    scoped: true,
  },
  REPORT_CENTER: { label: '报表中心', endpoints: ['/api/reports/employee-attainment'], datasetKey: 'completions' },
  TERMINAL_TOOLING: { label: '端子调模', endpoints: ['/api/terminal-tooling/overview'] },
  PLANNING: { label: '计划中心', endpoints: ['/api/work-orders'], datasetKey: 'workOrders' },
  HR: { label: '人事管理', endpoints: ['/api/employees'], datasetKey: 'employees' },
  PRODUCTION: {
    label: '生产执行与协同',
    endpoints: [
      '/api/work-orders/execution',
      '/api/daily-shipments',
      '/api/weekly-processes',
      '/api/workflows',
      '/api/abnormal-time-events',
      '/api/reports/employee-attainment',
    ],
    datasetKey: 'workOrders',
    scoped: true,
  },
  MAJOR_APPROVAL: { label: '重大审批', endpoints: ['/api/major-quality-approvals'] },
  ACCOUNT_ADMIN: { label: '账号管理', endpoints: ['/api/users'] },
  SYSTEM_CONFIGURATION: { label: '系统配置', endpoints: ['/api/system/access-data-audit'] },
};
