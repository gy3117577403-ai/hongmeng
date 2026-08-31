import type {
  AccessActionCode,
  AccessModuleCode,
  CapabilityCode,
} from '@/lib/department-access';

type AppAccess = {
  modules: readonly AccessModuleCode[];
  capabilities?: readonly CapabilityCode[];
};

type RouteAccessRule = {
  prefix: string;
  anyOf: readonly AccessModuleCode[];
  action?: AccessActionCode;
};

/**
 * Page-level visibility rules for the first department-permission rollout.
 *
 * These rules only decide whether a module entry/page is available. APIs still
 * perform their own action and entity-scope checks; a visible page is never an
 * authorization grant by itself.
 */
export const APP_ROUTE_ACCESS_RULES: readonly RouteAccessRule[] = [
  { prefix: '/field-report', anyOf: ['FIELD_REPORT'] },
  { prefix: '/sample-capture', anyOf: ['ACCOUNT_SELF', 'BASIC_SUMMARY', 'FIELD_REPORT', 'PRODUCTION', 'PLANNING', 'ENGINEERING', 'PROCESS'] },
  { prefix: '/material-upload', anyOf: ['QUALITY'] },
  { prefix: '/account', anyOf: ['ACCOUNT_SELF'] },
  { prefix: '/home', anyOf: ['BASIC_SUMMARY'] },
  { prefix: '/production/qr-print', anyOf: ['PRODUCTION'], action: 'EXECUTE_WORKFLOW' },
  { prefix: '/production', anyOf: ['BUSINESS', 'PRODUCTION'] },
  { prefix: '/weekly-plan-center', anyOf: ['PLANNING'] },
  { prefix: '/workspace/daily-plans', anyOf: ['PLANNING', 'PRODUCTION'], action: 'UPDATE' },
  { prefix: '/workspace/weekly-processes', anyOf: ['PLANNING', 'PRODUCTION'] },
  { prefix: '/workspace/wip', anyOf: ['PLANNING', 'PRODUCTION'] },
  { prefix: '/drawing-library', anyOf: ['ENGINEERING', 'DRAWING_LIBRARY'] },
  { prefix: '/connector-assembly-manuals', anyOf: ['ENGINEERING', 'ASSEMBLY_MANUALS'] },
  { prefix: '/connector-parameters', anyOf: ['ENGINEERING'] },
  { prefix: '/workspace/terminal-tooling', anyOf: ['TERMINAL_TOOLING'] },
  { prefix: '/workspace/capability-showcase', anyOf: ['ACCOUNT_SELF'] },
  { prefix: '/workspace/material-library', anyOf: ['QUALITY'] },
  { prefix: '/workspace/quality-tasks', anyOf: ['ACCOUNT_SELF'] },
  { prefix: '/workspace/quality-confirmation', anyOf: ['QUALITY'], action: 'EXECUTE_WORKFLOW' },
  { prefix: '/workspace/quality', anyOf: ['QUALITY', 'ISSUE_MANAGEMENT'] },
  { prefix: '/workspace/issues', anyOf: ['QUALITY', 'ISSUE_MANAGEMENT'] },
  { prefix: '/workspace/approvals', anyOf: ['QUALITY', 'MAJOR_APPROVAL'] },
  { prefix: '/workspace/changes', anyOf: ['ENGINEERING', 'QUALITY', 'CHANGE_MANAGEMENT'] },
  {
    prefix: '/workspace/workflows',
    anyOf: [
      'BUSINESS',
      'PROCUREMENT',
      'WAREHOUSE',
      'ENGINEERING',
      'QUALITY',
      'PROCESS',
      'PLANNING',
      'HR',
      'PRODUCTION',
      'MAJOR_APPROVAL',
    ],
  },
  { prefix: '/workspace/warehouse', anyOf: ['WAREHOUSE'] },
  { prefix: '/workspace/procurement', anyOf: ['PROCUREMENT'] },
  { prefix: '/workspace/product-times', anyOf: ['PROCESS', 'PRODUCT_TIME'] },
  { prefix: '/workspace/time-standards', anyOf: ['PROCESS'] },
  { prefix: '/workspace/processes', anyOf: ['PROCESS'] },
  { prefix: '/workspace/employees/accounts', anyOf: ['HR', 'ACCOUNT_ADMIN'], action: 'UPDATE' },
  { prefix: '/workspace/employees', anyOf: ['HR', 'TRAINING'] },
  { prefix: '/workspace/attendance', anyOf: ['HR', 'ATTENDANCE'] },
  { prefix: '/workspace/abnormal-times', anyOf: ['HR', 'QUALITY', 'PRODUCTION'] },
  { prefix: '/workspace/responsibilities', anyOf: ['HR', 'SYSTEM_CONFIGURATION'] },
  {
    prefix: '/workspace/reports',
    anyOf: ['BUSINESS', 'PLANNING', 'PRODUCTION', 'MAJOR_APPROVAL', 'REPORT_CENTER', 'HR'],
  },
  { prefix: '/workspace/knowledge', anyOf: ['SYSTEM_CONFIGURATION'] },
  { prefix: '/workspace/reviews', anyOf: ['ENGINEERING', 'QUALITY'] },
  { prefix: '/workspace/organization', anyOf: ['SYSTEM_CONFIGURATION'] },
  { prefix: '/workspace/permissions', anyOf: ['SYSTEM_CONFIGURATION'] },
  { prefix: '/workspace/messages', anyOf: ['NOTIFICATIONS'] },
  { prefix: '/workspace/initiated', anyOf: ['BASIC_SUMMARY'] },
  { prefix: '/workspace/involved', anyOf: ['BASIC_SUMMARY'] },
  { prefix: '/workspace/copied', anyOf: ['BASIC_SUMMARY'] },
  { prefix: '/workspace/following', anyOf: ['BASIC_SUMMARY'] },
  { prefix: '/workspace/help', anyOf: ['ACCOUNT_SELF', 'BASIC_SUMMARY'] },
  { prefix: '/workspace/more', anyOf: ['BASIC_SUMMARY'] },
  { prefix: '/dashboard', anyOf: ['ACCOUNT_ADMIN', 'SYSTEM_CONFIGURATION'] },
] as const;

function normalizedPath(pathname: string): string {
  const value = String(pathname || '/').split('?')[0] || '/';
  if (value === '/') return value;
  return value.replace(/\/+$/, '');
}

export function routeAccessRule(pathname: string): RouteAccessRule | null {
  const path = normalizedPath(pathname);
  return APP_ROUTE_ACCESS_RULES.find(rule => (
    path === rule.prefix || path.startsWith(`${rule.prefix}/`)
  )) || null;
}

export function canAccessAppRoute(access: AppAccess, pathname: string): boolean {
  const rule = routeAccessRule(pathname);
  if (!rule) return false;
  const modules = new Set(access.modules);
  return rule.anyOf.some(module => {
    if (!modules.has(module)) return false;
    if (!rule.action) return true;
    return access.capabilities?.includes(`${module}:${rule.action}` as CapabilityCode) === true;
  });
}

export function landingRouteForAccess(access: AppAccess): string {
  const modules = new Set(access.modules);
  if (modules.has('BASIC_SUMMARY')) return '/home';
  if (modules.has('ACCOUNT_SELF')) return '/account';
  return '/access-unavailable';
}
