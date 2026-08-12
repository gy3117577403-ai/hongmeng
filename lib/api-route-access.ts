import {
  hasCapability,
  type AccessActionCode,
  type AccessContext,
  type AccessModuleCode,
} from '@/lib/department-access';

type ApiRule = {
  prefix: string;
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
  /** Applied only when PRODUCTION is the capability that matched this rule. */
  productionMinimumScope?: 'WORKSHOP' | 'GLOBAL';
};

/** Specific routes must appear before their broader namespace. */
export const API_ROUTE_ACCESS_RULES: readonly ApiRule[] = [
  { prefix: '/api/me', anyOf: ['ACCOUNT_SELF'] },
  { prefix: '/api/notifications', anyOf: ['NOTIFICATIONS'] },
  { prefix: '/api/users', anyOf: ['ACCOUNT_ADMIN'] },
  { prefix: '/api/field-report', anyOf: ['FIELD_REPORT'] },

  { prefix: '/api/employees', anyOf: ['HR'] },
  { prefix: '/api/recruitment', anyOf: ['HR'] },
  { prefix: '/api/skills', anyOf: ['HR'] },
  { prefix: '/api/attendance', anyOf: ['HR'] },
  { prefix: '/api/abnormal-time-events', anyOf: ['HR', 'QUALITY'] },

  { prefix: '/api/material-follow-ups', anyOf: ['PROCUREMENT'] },
  { prefix: '/api/warehouse', anyOf: ['WAREHOUSE'] },

  { prefix: '/api/issues/from-production-alert', anyOf: ['QUALITY'] },
  { prefix: '/api/issues/detected', anyOf: ['QUALITY'] },
  { prefix: '/api/issues', anyOf: ['QUALITY', 'ISSUE_MANAGEMENT'] },
  { prefix: '/api/major-quality-approvals', anyOf: ['QUALITY', 'MAJOR_APPROVAL'] },
  { prefix: '/api/changes', anyOf: ['ENGINEERING', 'QUALITY', 'CHANGE_MANAGEMENT'] },
  { prefix: '/api/change-snapshots', anyOf: ['ENGINEERING', 'QUALITY'] },
  {
    prefix: '/api/drawing-library',
    anyOf: ['ENGINEERING', 'DRAWING_LIBRARY'],
    readOnlyModules: ['DRAWING_LIBRARY'],
  },
  { prefix: '/api/connector-assembly-manuals', anyOf: ['ENGINEERING'] },
  { prefix: '/api/connector-assembly-manual-versions', anyOf: ['ENGINEERING'] },
  { prefix: '/api/connector-assembly-manual-assets', anyOf: ['ENGINEERING'] },
  { prefix: '/api/connector-parameters', anyOf: ['ENGINEERING'] },
  { prefix: '/api/connector-parameter-files', anyOf: ['ENGINEERING'] },
  { prefix: '/api/connector-parameter-import-batches', anyOf: ['ENGINEERING'] },

  { prefix: '/api/product-time-profiles', anyOf: ['PROCESS'] },
  { prefix: '/api/process-time-standards', anyOf: ['PROCESS'] },
  { prefix: '/api/process-definitions', anyOf: ['PROCESS'] },
  { prefix: '/api/process-templates', anyOf: ['PROCESS'] },
  {
    prefix: '/api/process-labor-pools',
    anyOf: ['PROCESS', 'PRODUCTION'],
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
    anyOf: ['PLANNING'],
    actionsByMethod: { POST: 'EXECUTE_WORKFLOW' },
  },
  { prefix: '/api/weekly-processes', anyOf: ['PLANNING', 'PRODUCTION'] },
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
  { prefix: '/api/reports', anyOf: ['PLANNING', 'PRODUCTION'] },
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

  if (path === '/api/issues/assignee-options') {
    return {
      prefix: '/api/issues/assignee-options',
      anyOf: ['QUALITY', 'ISSUE_MANAGEMENT'],
      action: 'UPDATE',
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

  if (/^\/api\/abnormal-time-events\/[^/]+\/(?:quality|resolve)$/.test(path)) {
    return {
      prefix: '/api/abnormal-time-events/:id/quality-or-resolve',
      anyOf: ['QUALITY'],
      action: 'EXECUTE_WORKFLOW',
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
    if (!hasCapability(access, module, action)) return false;
    if (rule.readOnlyModules?.includes(module) && action !== 'READ') return false;
    if (module !== 'PRODUCTION' || !rule.productionMinimumScope) return true;
    return productionScopeRank[access.productionScope]
      >= productionScopeRank[rule.productionMinimumScope];
  });
}
