import {
  hasCapability,
  type AccessActionCode,
  type AccessContext,
  type AccessModuleCode,
} from '@/lib/department-access';

type ApiRule = {
  prefix: string;
  allowedMethods?: readonly string[];
  anyOf: readonly AccessModuleCode[];
  /** Modules listed here may match this namespace only for read actions. */
  readOnlyModules?: readonly AccessModuleCode[];
  /**
   * Some POST routes are commands or read-only previews, not creates. Keep the
   * semantic action on the route rule so read-only accounts cannot accidentally
   * execute a command merely because the handler happens to use POST.
   */
  action?: AccessActionCode;
  actionsByMethod?: Readonly<Record<string, AccessActionCode>>;
  /** A mixed-module route may require a stronger action from one owner. */
  actionsByModule?: Readonly<Partial<Record<AccessModuleCode, AccessActionCode>>>;
  /** Applied only when PRODUCTION is the capability that matched this rule. */
  productionMinimumScope?: 'WORKSHOP' | 'GLOBAL';
};

/** Specific routes must appear before their broader namespace. */
export const API_ROUTE_ACCESS_RULES: readonly ApiRule[] = [
  { prefix: '/api/me', anyOf: ['ACCOUNT_SELF'] },
  { prefix: '/api/notifications', anyOf: ['NOTIFICATIONS'] },
  { prefix: '/api/users', anyOf: ['ACCOUNT_ADMIN'] },
  { prefix: '/api/field-report', anyOf: ['FIELD_REPORT'] },
  {
    prefix: '/api/sample-team',
    anyOf: ['FIELD_REPORT', 'BUSINESS', 'PLANNING', 'PRODUCTION', 'ENGINEERING', 'PROCESS'],
    productionMinimumScope: 'WORKSHOP',
  },
  {
    prefix: '/api/sample-entries',
    anyOf: ['FIELD_REPORT', 'BUSINESS', 'PLANNING', 'PRODUCTION', 'ENGINEERING', 'PROCESS'],
    action: 'EXECUTE_WORKFLOW',
    productionMinimumScope: 'WORKSHOP',
  },
  {
    prefix: '/api/sample-photos',
    anyOf: ['FIELD_REPORT', 'BUSINESS', 'PLANNING', 'PRODUCTION', 'ENGINEERING', 'PROCESS'],
    actionsByMethod: { PATCH: 'EXECUTE_WORKFLOW', DELETE: 'EXECUTE_WORKFLOW' },
    productionMinimumScope: 'WORKSHOP',
  },
  {
    prefix: '/api/sample-tasks',
    anyOf: ['BUSINESS', 'PLANNING', 'PRODUCTION', 'ENGINEERING', 'PROCESS'],
    productionMinimumScope: 'WORKSHOP',
  },

  { prefix: '/api/employees', anyOf: ['HR', 'TRAINING'], readOnlyModules: ['TRAINING'] },
  { prefix: '/api/recruitment', anyOf: ['HR'] },
  { prefix: '/api/skills', anyOf: ['HR', 'TRAINING'], readOnlyModules: ['TRAINING'] },
  { prefix: '/api/training', anyOf: ['HR', 'TRAINING'] },
  {
    prefix: '/api/attendance/calendar',
    anyOf: ['HR', 'ATTENDANCE', 'REPORT_CENTER', 'PRODUCTION'],
    productionMinimumScope: 'WORKSHOP',
  },
  { prefix: '/api/attendance', anyOf: ['HR', 'ATTENDANCE'] },
  {
    prefix: '/api/abnormal-time-events',
    anyOf: ['HR', 'QUALITY', 'PRODUCTION', 'ATTENDANCE'],
    readOnlyModules: ['ATTENDANCE'],
  },

  { prefix: '/api/material-follow-ups', anyOf: ['PROCUREMENT'] },
  { prefix: '/api/warehouse', anyOf: ['WAREHOUSE'] },

  { prefix: '/api/material-library', anyOf: ['QUALITY'] },

  { prefix: '/api/quality/internal-risks', anyOf: ['QUALITY', 'ISSUE_MANAGEMENT'], readOnlyModules: ['ISSUE_MANAGEMENT'] },
  { prefix: '/api/quality/internal-risk-attachments', anyOf: ['QUALITY', 'ISSUE_MANAGEMENT'], readOnlyModules: ['ISSUE_MANAGEMENT'] },
  { prefix: '/api/quality/8d', anyOf: ['QUALITY', 'ISSUE_MANAGEMENT'] },
  { prefix: '/api/issues/from-production-alert', anyOf: ['QUALITY'] },
  { prefix: '/api/issues/detected', anyOf: ['QUALITY'] },
  { prefix: '/api/issues', anyOf: ['QUALITY', 'ISSUE_MANAGEMENT'] },
  { prefix: '/api/major-quality-approvals', anyOf: ['QUALITY', 'MAJOR_APPROVAL'] },
  { prefix: '/api/changes', anyOf: ['ENGINEERING', 'QUALITY', 'CHANGE_MANAGEMENT'] },
  { prefix: '/api/change-snapshots', anyOf: ['ENGINEERING', 'QUALITY'] },
  {
    prefix: '/api/drawing-library',
    anyOf: ['ENGINEERING', 'DRAWING_LIBRARY', 'PRODUCT_TIME'],
    readOnlyModules: ['PRODUCT_TIME'],
  },
  {
    prefix: '/api/connector-assembly-manuals',
    anyOf: ['ENGINEERING', 'ASSEMBLY_MANUALS'],
  },
  {
    prefix: '/api/connector-assembly-manual-versions',
    anyOf: ['ENGINEERING', 'ASSEMBLY_MANUALS'],
  },
  {
    prefix: '/api/connector-assembly-manual-assets',
    anyOf: ['ENGINEERING', 'ASSEMBLY_MANUALS'],
  },
  {
    prefix: '/api/connector-parameters',
    anyOf: ['ENGINEERING', 'ASSEMBLY_MANUALS'],
  },
  { prefix: '/api/connector-parameter-files', anyOf: ['ENGINEERING'] },
  { prefix: '/api/connector-parameter-import-batches', anyOf: ['ENGINEERING'] },

  {
    prefix: '/api/terminal-tooling',
    anyOf: ['TERMINAL_TOOLING'],
  },
  {
    prefix: '/api/capability-showcase',
    anyOf: ['ACCOUNT_SELF'],
    actionsByMethod: { POST: 'UPDATE', PATCH: 'UPDATE', DELETE: 'UPDATE' },
  },

  {
    prefix: '/api/product-time-profiles',
    anyOf: ['PROCESS', 'PRODUCT_TIME'],
  },
  {
    prefix: '/api/product-time-deployments',
    anyOf: ['PROCESS', 'PRODUCT_TIME'],
  },
  { prefix: '/api/process-time-standards', anyOf: ['PROCESS'] },
  { prefix: '/api/process-definitions', anyOf: ['PROCESS'] },
  { prefix: '/api/process-templates', anyOf: ['PROCESS'] },
  {
    prefix: '/api/process-labor-pools',
    anyOf: ['PROCESS', 'PRODUCTION', 'BUSINESS', 'PLANNING', 'MAJOR_APPROVAL', 'REPORT_CENTER', 'HR'],
    readOnlyModules: ['BUSINESS', 'PLANNING', 'MAJOR_APPROVAL', 'REPORT_CENTER', 'HR'],
    productionMinimumScope: 'WORKSHOP',
  },
  {
    prefix: '/api/process-labor-claims',
    anyOf: ['PROCESS', 'PRODUCTION'],
    productionMinimumScope: 'WORKSHOP',
  },
  {
    prefix: '/api/process-management',
    anyOf: ['PROCESS', 'PRODUCTION'],
    productionMinimumScope: 'WORKSHOP',
  },
  {
    prefix: '/api/process-executions',
    anyOf: ['PROCESS', 'PRODUCTION'],
    productionMinimumScope: 'WORKSHOP',
  },

  // The export preview may reconcile carryovers for writable planners, but it
  // remains a read-only preview for GM and other read-only Planning viewers.
  { prefix: '/api/planning/weekly-plan-export/preview', anyOf: ['PLANNING'], action: 'READ' },
  { prefix: '/api/planning', anyOf: ['PLANNING'] },
  {
    prefix: '/api/export/production-dispatch.xlsx',
    anyOf: ['PLANNING', 'PRODUCTION'],
    action: 'EXECUTE_WORKFLOW',
  },
  {
    prefix: '/api/daily-plans/organization',
    anyOf: ['PLANNING', 'PRODUCTION'],
    actionsByMethod: { GET: 'UPDATE' },
    productionMinimumScope: 'WORKSHOP',
  },
  { prefix: '/api/daily-plans', anyOf: ['PLANNING', 'PRODUCTION'], actionsByMethod: { GET: 'UPDATE' } },
  { prefix: '/api/daily-plan-tasks', anyOf: ['PLANNING', 'PRODUCTION'], actionsByMethod: { GET: 'UPDATE' } },
  {
    prefix: '/api/daily-shipments',
    anyOf: ['PLANNING', 'PRODUCTION'],
    actionsByMethod: { POST: 'EXECUTE_WORKFLOW' },
  },
  { prefix: '/api/weekly-processes', anyOf: ['PLANNING', 'PRODUCTION'] },
  { prefix: '/api/wip', anyOf: ['PLANNING', 'PRODUCTION'] },
  { prefix: '/api/production', anyOf: ['PRODUCTION', 'PLANNING', 'BUSINESS'] },

  { prefix: '/api/import/work-orders', anyOf: ['BUSINESS', 'PLANNING'] },
  {
    prefix: '/api/export/work-orders.csv',
    anyOf: ['BUSINESS', 'PLANNING', 'PRODUCTION'],
    productionMinimumScope: 'WORKSHOP',
  },
  {
    prefix: '/api/export/production-execution.csv',
    anyOf: ['BUSINESS', 'PLANNING', 'PRODUCTION'],
    productionMinimumScope: 'WORKSHOP',
  },
  { prefix: '/api/export/resource-files.csv', anyOf: ['ENGINEERING'] },
  { prefix: '/api/export/operation-logs.csv', anyOf: ['SYSTEM_CONFIGURATION'] },
  { prefix: '/api/export/metadata.json', anyOf: ['SYSTEM_CONFIGURATION'] },

  // Week lifecycle commands and their previews/audit views belong to Planning.
  {
    prefix: '/api/work-orders/clear-weekly-plan/commit',
    anyOf: ['PLANNING'],
    action: 'EXECUTE_WORKFLOW',
  },
  {
    prefix: '/api/work-orders/clear-weekly-plan/preview',
    anyOf: ['PLANNING'],
    action: 'READ',
  },
  {
    prefix: '/api/work-orders/week/activate-next/commit',
    anyOf: ['PLANNING'],
    action: 'EXECUTE_WORKFLOW',
  },
  {
    prefix: '/api/work-orders/week/activate-next/preview',
    anyOf: ['PLANNING'],
    action: 'READ',
  },
  {
    prefix: '/api/work-orders/week/close/commit',
    anyOf: ['PLANNING'],
    action: 'EXECUTE_WORKFLOW',
  },
  {
    prefix: '/api/work-orders/week/close/preview',
    anyOf: ['PLANNING'],
    action: 'READ',
  },
  { prefix: '/api/work-orders/week/history', anyOf: ['PLANNING'] },
  { prefix: '/api/work-orders/week/diff', anyOf: ['PLANNING'] },

  {
    prefix: '/api/work-orders',
    anyOf: ['BUSINESS', 'PLANNING', 'PRODUCTION', 'ENGINEERING'],
    readOnlyModules: ['ENGINEERING'],
  },
  {
    prefix: '/api/work-order-qr',
    anyOf: ['BUSINESS', 'PRODUCTION'],
    action: 'EXECUTE_WORKFLOW',
    productionMinimumScope: 'WORKSHOP',
  },
  {
    prefix: '/api/resource-files',
    anyOf: ['BUSINESS', 'PRODUCTION', 'ENGINEERING'],
    productionMinimumScope: 'WORKSHOP',
  },

  {
    prefix: '/api/workflows',
    anyOf: ['BUSINESS', 'PROCUREMENT', 'WAREHOUSE', 'ENGINEERING', 'QUALITY', 'PROCESS', 'PLANNING', 'HR', 'PRODUCTION'],
  },
  {
    prefix: '/api/reports/employee-attainment',
    anyOf: ['BUSINESS', 'PLANNING', 'PRODUCTION', 'MAJOR_APPROVAL', 'REPORT_CENTER', 'HR'],
    allowedMethods: ['GET', 'HEAD', 'OPTIONS'],
    action: 'READ',
  },
  {
    prefix: '/api/reports',
    anyOf: ['BUSINESS', 'PLANNING', 'PRODUCTION', 'MAJOR_APPROVAL', 'HR'],
    allowedMethods: ['GET', 'HEAD', 'OPTIONS'],
    action: 'READ',
  },
  { prefix: '/api/dashboard/field-summary', anyOf: ['BUSINESS', 'ENGINEERING', 'PRODUCTION'] },
  { prefix: '/api/dashboard/production-summary', anyOf: ['BUSINESS', 'PLANNING', 'PRODUCTION'] },

  { prefix: '/api/knowledge', anyOf: ['SYSTEM_CONFIGURATION'] },
  { prefix: '/api/search', anyOf: ['SYSTEM_CONFIGURATION'] },
  { prefix: '/api/integrations', anyOf: ['SYSTEM_CONFIGURATION'] },
  { prefix: '/api/system', anyOf: ['SYSTEM_CONFIGURATION'] },
  { prefix: '/api/operation-logs', anyOf: ['SYSTEM_CONFIGURATION'] },
  { prefix: '/api/trash', anyOf: ['SYSTEM_CONFIGURATION'] },
  { prefix: '/api/local-import', anyOf: ['SYSTEM_CONFIGURATION'] },
  { prefix: '/api/resource-categories', anyOf: ['SYSTEM_CONFIGURATION', 'ENGINEERING'] },
] as const;

function pathOnly(value: string): string {
  const path = String(value || '').split('?')[0] || '/';
  return path.length > 1 ? path.replace(/\/+$/, '') : path;
}

export function apiRouteAccessRule(pathname: string): ApiRule | null {
  const path = pathOnly(pathname);

  // HR cannot enter access-grants, PIN administration, or system configuration.
  if (path === '/api/users') {
    return { prefix: path, anyOf: ['ACCOUNT_ADMIN', 'HR'], actionsByModule: { HR: 'UPDATE' }, allowedMethods: ['GET', 'HEAD', 'POST'] };
  }
  if (/^\/api\/users\/[^/]+\/reset-password$/.test(path)) {
    return { prefix: path, anyOf: ['ACCOUNT_ADMIN', 'HR'], action: 'UPDATE', allowedMethods: ['POST'] };
  }
  if (/^\/api\/users\/[^/]+$/.test(path)) {
    return { prefix: path, anyOf: ['ACCOUNT_ADMIN', 'HR'], action: 'UPDATE', allowedMethods: ['PATCH'] };
  }

  if (/^\/api\/material-library\/sessions\/[^/]+\/complete$/.test(path)) {
    return {
      prefix: '/api/material-library/sessions/:id/complete',
      anyOf: ['QUALITY'],
      action: 'EXECUTE_WORKFLOW',
    };
  }

  if (/^\/api\/material-library\/sessions\/[^/]+\/(?:cancel|heartbeat)$/.test(path)) {
    return {
      prefix: '/api/material-library/sessions/:id/session-command',
      anyOf: ['QUALITY'],
      action: 'UPDATE',
    };
  }

  if (/^\/api\/material-library\/items\/[^/]+\/restore$/.test(path)) {
    return {
      prefix: '/api/material-library/items/:id/restore',
      anyOf: ['QUALITY'],
      action: 'UPDATE',
    };
  }

  if (/^\/api\/material-library\/(?:photos|upload-links)\/[^/]+$/.test(path)) {
    return {
      prefix: '/api/material-library/removable-session-resource/:id',
      anyOf: ['QUALITY'],
      actionsByMethod: { DELETE: 'UPDATE' },
    };
  }

  if (/^\/api\/work-orders\/[^/]+\/quality-alerts\/link$/.test(path)) {
    return {
      prefix: '/api/work-orders/:id/quality-alerts/link',
      anyOf: ['QUALITY'],
      action: 'UPDATE',
    };
  }

  if (/^\/api\/work-orders\/[^/]+\/quality-alerts\/[^/]+\/acknowledge$/.test(path)) {
    return {
      prefix: '/api/work-orders/:id/quality-alerts/:alertId/acknowledge',
      anyOf: ['BUSINESS', 'PLANNING', 'PRODUCTION', 'QUALITY'],
      action: 'UPDATE',
    };
  }

  if (/^\/api\/work-orders\/[^/]+\/quality-alerts$/.test(path)) {
    return {
      prefix: '/api/work-orders/:id/quality-alerts',
      anyOf: ['BUSINESS', 'PLANNING', 'PRODUCTION', 'ENGINEERING', 'QUALITY', 'ISSUE_MANAGEMENT'],
      action: 'READ',
    };
  }

  if (/^\/api\/training\/plans\/[^/]+\/(?:transition|archive|unarchive)$/.test(path)) {
    return {
      prefix: '/api/training/plans/:id/workflow',
      anyOf: ['HR', 'TRAINING'],
      action: 'EXECUTE_WORKFLOW',
    };
  }

  if (/^\/api\/training\/plans\/[^/]+\/change-preview$/.test(path)) {
    return {
      prefix: '/api/training/plans/:id/change-preview',
      anyOf: ['HR', 'TRAINING'],
      action: 'UPDATE',
    };
  }

  if (/^\/api\/training\/plans\/[^/]+\/(?:delete-preview|restore)$/.test(path)) {
    return {
      prefix: '/api/training/plans/:id/recycle',
      anyOf: ['HR', 'TRAINING'],
      action: 'DELETE',
    };
  }

  if (/^\/api\/drawing-library\/(?:[^/]+\/sop\/(?:publish|versions\/[^/]+\/publish|pdf-overlay\/versions\/[^/]+\/publish)|bulk-index|bulk-originals|cleanup-empty\/commit)$/.test(path)) {
    return {
      prefix: '/api/drawing-library/engineering-command',
      anyOf: ['ENGINEERING', 'DRAWING_LIBRARY'],
      action: 'EXECUTE_WORKFLOW',
    };
  }

  if (/^\/api\/sample-tasks\/code\/[^/]+$/.test(path)) {
    return {
      prefix: '/api/sample-tasks/code/:code',
      anyOf: ['FIELD_REPORT', 'BUSINESS', 'PLANNING', 'PRODUCTION', 'ENGINEERING', 'PROCESS'],
      action: 'READ',
      productionMinimumScope: 'WORKSHOP',
    };
  }

  if (/^\/api\/sample-tasks\/[^/]+\/(?:entries|photos)$/.test(path)) {
    return {
      prefix: '/api/sample-tasks/:id/capture',
      anyOf: ['FIELD_REPORT', 'BUSINESS', 'PLANNING', 'PRODUCTION', 'ENGINEERING', 'PROCESS'],
      productionMinimumScope: 'WORKSHOP',
    };
  }

  if (/^\/api\/sample-tasks\/[^/]+\/sections(?:\/[^/]+)?$/.test(path)) {
    return {
      prefix: '/api/sample-tasks/:id/sections',
      anyOf: ['FIELD_REPORT', 'BUSINESS', 'PLANNING', 'PRODUCTION', 'ENGINEERING', 'PROCESS'],
      actionsByMethod: { GET: 'READ', PUT: 'EXECUTE_WORKFLOW' },
      productionMinimumScope: 'WORKSHOP',
    };
  }

  if (/^\/api\/sample-tasks\/[^/]+\/submit$/.test(path)) {
    return {
      prefix: '/api/sample-tasks/:id/submit',
      anyOf: ['FIELD_REPORT', 'BUSINESS', 'PLANNING', 'PRODUCTION', 'ENGINEERING', 'PROCESS'],
      action: 'EXECUTE_WORKFLOW',
      productionMinimumScope: 'WORKSHOP',
    };
  }


  if (/^\/api\/sample-tasks\/[^/]+\/withdraw-submission$/.test(path)) {
    return {
      prefix: '/api/sample-tasks/:id/withdraw-submission',
      anyOf: ['FIELD_REPORT', 'BUSINESS', 'PLANNING', 'PRODUCTION', 'ENGINEERING', 'PROCESS'],
      action: 'EXECUTE_WORKFLOW',
      productionMinimumScope: 'WORKSHOP',
    };
  }

  if (/^\/api\/terminal-tooling\/setups\/[^/]+\/publish$/.test(path)) {
    return {
      prefix: '/api/terminal-tooling/setups/:id/publish',
      anyOf: ['TERMINAL_TOOLING'],
      action: 'EXECUTE_WORKFLOW',
    };
  }

  if (/^\/api\/terminal-tooling\/setups\/[^/]+\/duplicate$/.test(path)) {
    return {
      prefix: '/api/terminal-tooling/setups/:id/duplicate',
      anyOf: ['TERMINAL_TOOLING'],
      action: 'CREATE',
    };
  }

  if (path === '/api/issues/assignee-options') {
    return {
      prefix: '/api/issues/assignee-options',
      anyOf: ['QUALITY', 'ISSUE_MANAGEMENT'],
      action: 'READ',
      actionsByModule: { QUALITY: 'UPDATE', ISSUE_MANAGEMENT: 'READ' },
    };
  }

  if (path === '/api/changes/owner-options') {
    return {
      prefix: '/api/changes/owner-options',
      anyOf: ['ENGINEERING', 'QUALITY', 'CHANGE_MANAGEMENT'],
      action: 'READ',
    };
  }

  if (/^\/api\/issues\/[^/]+\/major-approval\/quality-review$/.test(path)) {
    return {
      prefix: '/api/issues/:id/major-approval/quality-review',
      anyOf: ['QUALITY'],
      action: 'EXECUTE_WORKFLOW',
    };
  }

  if (/^\/api\/issues\/[^/]+\/major-approval\/final-decision$/.test(path)) {
    return {
      prefix: '/api/issues/:id/major-approval/final-decision',
      anyOf: ['MAJOR_APPROVAL'],
      action: 'APPROVE',
    };
  }

  if (/^\/api\/abnormal-time-events\/[^/]+\/quality$/.test(path)) {
    return {
      prefix: '/api/abnormal-time-events/:id/quality',
      anyOf: ['QUALITY', 'PRODUCTION'],
      action: 'EXECUTE_WORKFLOW',
      productionMinimumScope: 'WORKSHOP',
    };
  }

  if (/^\/api\/abnormal-time-events\/[^/]+\/resolve$/.test(path)) {
    return {
      prefix: '/api/abnormal-time-events/:id/resolve',
      anyOf: ['QUALITY', 'PRODUCTION'],
      action: 'EXECUTE_WORKFLOW',
      productionMinimumScope: 'WORKSHOP',
    };
  }

  if (/^\/api\/issues\/[^/]+\/transition$/.test(path)) {
    return {
      prefix: '/api/issues/:id/transition',
      anyOf: ['QUALITY', 'ISSUE_MANAGEMENT'],
      action: 'EXECUTE_WORKFLOW',
    };
  }

  if (/^\/api\/issues\/[^/]+\/(?:activities|attachments\/upload)$/.test(path)) {
    return {
      prefix: '/api/issues/:id/collaboration',
      anyOf: ['QUALITY', 'ISSUE_MANAGEMENT'],
      action: 'UPDATE',
    };
  }

  if (/^\/api\/changes\/[^/]+\/transition$/.test(path)) {
    return {
      prefix: '/api/changes/:id/transition',
      anyOf: ['ENGINEERING', 'QUALITY', 'CHANGE_MANAGEMENT'],
      action: 'EXECUTE_WORKFLOW',
    };
  }

  if (/^\/api\/changes\/[^/]+\/(?:activities|attachments\/upload)$/.test(path)) {
    return {
      prefix: '/api/changes/:id/collaboration',
      anyOf: ['ENGINEERING', 'QUALITY', 'CHANGE_MANAGEMENT'],
      action: 'UPDATE',
    };
  }

  if (/^\/api\/process-management\/route-changes\/[^/]+\/(?:review|activate)$/.test(path)) {
    return {
      prefix: '/api/process-management/route-changes/:id/review-or-activate',
      anyOf: ['PROCESS'],
      action: 'EXECUTE_WORKFLOW',
    };
  }

  if (/^\/api\/process-management\/route-changes(?:\/[^/]+)?$/.test(path)) {
    return {
      prefix: '/api/process-management/route-changes',
      anyOf: ['PROCESS'],
      actionsByMethod: { GET: 'READ' },
    };
  }

  if (/^\/api\/process-management\/completion-withdrawal-requests\/[^/]+\/decision$/.test(path)) {
    return {
      prefix: '/api/process-management/completion-withdrawal-requests/:requestId/decision',
      anyOf: ['PRODUCTION'],
      action: 'EXECUTE_WORKFLOW',
      productionMinimumScope: 'WORKSHOP',
    };
  }

  if (/^\/api\/process-management\/completion-withdrawal-requests(?:\/[^/]+)?$/.test(path)) {
    return {
      prefix: '/api/process-management/completion-withdrawal-requests',
      anyOf: ['PRODUCTION'],
      action: 'UPDATE',
      productionMinimumScope: 'WORKSHOP',
    };
  }

  if (/^\/api\/process-management\/routes\/[^/]+\/completions\/[^/]+\/correct-standard$/.test(path)) {
    return {
      prefix: '/api/process-management/routes/:id/completions/:completionId/correct-standard',
      anyOf: ['PROCESS', 'PRODUCTION'],
      action: 'UPDATE',
      productionMinimumScope: 'WORKSHOP',
    };
  }

  if (/^\/api\/process-management\/routes\/[^/]+\/completions\/[^/]+\/withdraw$/.test(path)) {
    return {
      prefix: '/api/process-management/routes/:id/completions/:completionId/withdraw',
      anyOf: ['PROCESS', 'PRODUCTION'],
      actionsByMethod: { POST: 'EXECUTE_WORKFLOW' },
      productionMinimumScope: 'WORKSHOP',
    };
  }

  if (/^\/api\/process-management\/routes\/[^/]+\/completions$/.test(path)) {
    return {
      prefix: '/api/process-management/routes/:id/completions',
      anyOf: ['PROCESS', 'PRODUCTION'],
      actionsByMethod: { POST: 'EXECUTE_WORKFLOW' },
      productionMinimumScope: 'WORKSHOP',
    };
  }

  if (/^\/api\/process-labor-claims\/[^/]+\/void$/.test(path)) {
    return {
      prefix: '/api/process-labor-claims/:id/void',
      anyOf: ['PROCESS', 'PRODUCTION'],
      action: 'EXECUTE_WORKFLOW',
      productionMinimumScope: 'WORKSHOP',
    };
  }

  if (/^\/api\/process-labor-pools\/[^/]+\/claims(?:\/batch)?$/.test(path)) {
    return {
      prefix: '/api/process-labor-pools/:id/claims',
      anyOf: ['PROCESS', 'PRODUCTION'],
      action: 'EXECUTE_WORKFLOW',
      productionMinimumScope: 'WORKSHOP',
    };
  }

  if (/^\/api\/process-labor-pools\/[^/]+\/standard$/.test(path)) {
    return {
      prefix: '/api/process-labor-pools/:id/standard',
      anyOf: ['PROCESS', 'PRODUCTION'],
      action: 'UPDATE',
      productionMinimumScope: 'WORKSHOP',
    };
  }

  if (/^\/api\/work-orders\/[^/]+\/process-route(?:\/|$)/.test(path)) {
    return {
      prefix: '/api/work-orders/:id/process-route',
      anyOf: ['PROCESS', 'PRODUCTION'],
      action: 'UPDATE',
      productionMinimumScope: 'WORKSHOP',
    };
  }

  if (/^\/api\/work-orders\/[^/]+\/download-all$/.test(path)) {
    return {
      prefix: '/api/work-orders/:id/download-all',
      anyOf: ['BUSINESS', 'PLANNING', 'PRODUCTION', 'ENGINEERING'],
      action: 'READ',
      productionMinimumScope: 'WORKSHOP',
    };
  }

  if (/^\/api\/work-orders\/[^/]+\/restore$/.test(path)) {
    return {
      prefix: '/api/work-orders/:id/restore',
      anyOf: ['BUSINESS', 'PLANNING', 'PRODUCTION'],
      action: 'UPDATE',
      productionMinimumScope: 'WORKSHOP',
    };
  }

  if (/^\/api\/work-orders\/[^/]+\/sync-drawing-library$/.test(path)) {
    return {
      prefix: '/api/work-orders/:id/sync-drawing-library',
      anyOf: ['ENGINEERING'],
      action: 'EXECUTE_WORKFLOW',
    };
  }

  if (path === '/api/work-orders/execution' || path === '/api/work-orders/batch-execution') {
    return {
      prefix: path,
      anyOf: ['BUSINESS', 'PLANNING', 'PRODUCTION'],
    };
  }

  if (/^\/api\/work-orders\/[^/]+\/production-control(?:\/backfill)?$/.test(path)) {
    return { prefix: '/api/work-orders/:id/production-control', anyOf: ['PLANNING', 'PRODUCTION'] };
  }

  if (/^\/api\/work-orders\/[^/]+$/.test(path)) {
    return {
      prefix: '/api/work-orders/:id',
      anyOf: ['BUSINESS', 'PLANNING', 'PRODUCTION', 'ENGINEERING'],
      readOnlyModules: ['ENGINEERING'],
      productionMinimumScope: 'WORKSHOP',
    };
  }

  if (/^\/api\/resource-files\/[^/]+\/delete$/.test(path)) {
    return {
      prefix: '/api/resource-files/:id/delete',
      anyOf: ['BUSINESS', 'PRODUCTION', 'ENGINEERING'],
      action: 'DELETE',
      productionMinimumScope: 'WORKSHOP',
    };
  }

  if (/^\/api\/resource-files\/[^/]+\/restore$/.test(path)) {
    return {
      prefix: '/api/resource-files/:id/restore',
      anyOf: ['BUSINESS', 'PRODUCTION', 'ENGINEERING'],
      action: 'UPDATE',
      productionMinimumScope: 'WORKSHOP',
    };
  }

  if (path === '/api/work-order-qr/prints/confirm') {
    return {
      prefix: path,
      anyOf: ['BUSINESS', 'PRODUCTION'],
      action: 'EXECUTE_WORKFLOW',
      productionMinimumScope: 'WORKSHOP',
    };
  }

  if (path === '/api/work-order-qr/prints/packet') {
    return {
      prefix: path,
      anyOf: ['BUSINESS', 'PRODUCTION'],
      action: 'EXECUTE_WORKFLOW',
      productionMinimumScope: 'WORKSHOP',
    };
  }
  return API_ROUTE_ACCESS_RULES.find(rule => (
    path === rule.prefix || path.startsWith(`${rule.prefix}/`)
  )) || null;
}

export function apiActionForMethod(method: string | null | undefined): AccessActionCode {
  switch (String(method || 'GET').toUpperCase()) {
    case 'GET':
    case 'HEAD':
    case 'OPTIONS':
      return 'READ';
    case 'DELETE':
      return 'DELETE';
    case 'PATCH':
    case 'PUT':
      return 'UPDATE';
    default:
      return 'CREATE';
  }
}

export function canAccessApiRoute(
  access: Pick<AccessContext, 'capabilities' | 'productionScope'>,
  pathname: string,
  method?: string | null,
): boolean | null {
  const rule = apiRouteAccessRule(pathname);
  if (!rule) return null;
  const normalizedMethod = String(method || 'GET').toUpperCase();
  if (rule.allowedMethods && !rule.allowedMethods.includes(normalizedMethod)) return false;
  const action = rule.actionsByMethod?.[normalizedMethod]
    ?? rule.action
    ?? apiActionForMethod(normalizedMethod);
  const productionScopeRank = {
    NONE: 0,
    TEAM: 1,
    WORKSHOP: 2,
    GLOBAL: 3,
  } as const;

  return rule.anyOf.some(module => {
    const moduleAction = rule.actionsByModule?.[module] ?? action;
    if (!hasCapability(access, module, moduleAction)) return false;
    if (rule.readOnlyModules?.includes(module) && moduleAction !== 'READ') return false;
    if (module !== 'PRODUCTION' || !rule.productionMinimumScope) return true;
    return productionScopeRank[access.productionScope]
      >= productionScopeRank[rule.productionMinimumScope];
  });
}
