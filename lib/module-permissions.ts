import { BUSINESS_SUBMODULES, submoduleDefinition, type SubmoduleKey } from './submodule-catalog';
export { BUSINESS_SUBMODULES } from './submodule-catalog';
/** Business-facing access contract. UI groups are stable; departments are not grants. */
export const BUSINESS_ACCESS_MODULES = [
  { key: 'production', label: '生产与计划', description: '量产与样品计划、生产执行、日出货、周工序', capabilities: ['PLANNING', 'PRODUCTION', 'BUSINESS'] },
  { key: 'quality', label: '质量中心', description: '资料审核与治具、质量管理、首检巡检、品质确认', capabilities: ['QUALITY', 'QUALITY_DATA'] },
  { key: 'materials', label: '物料与仓储', description: '配料、采购与客供跟进、采购、成品仓、半成品、物料库', capabilities: ['WAREHOUSE', 'PROCUREMENT', 'MATERIAL_LIBRARY'] },
  { key: 'technology', label: '技术与资料', description: '图纸与 SOP、连接器、端子调模、产品工时、知识库', capabilities: ['ENGINEERING', 'DRAWING_LIBRARY', 'ASSEMBLY_MANUALS', 'PROCESS', 'PRODUCT_TIME', 'TERMINAL_TOOLING', 'KNOWLEDGE'] },
  { key: 'people', label: '人事与工时', description: '员工档案、招聘培训、职责、考勤、异常与其他工时', capabilities: ['HR', 'TRAINING', 'ATTENDANCE'] },
  { key: 'collaboration', label: '协同与审批', description: '问题、变更、流程中心、重大审批、工时审批与消息', capabilities: ['ISSUE_MANAGEMENT', 'CHANGE_MANAGEMENT', 'MAJOR_APPROVAL'] },
  { key: 'reports', label: '报表中心', description: '业务报表、指标查询、明细与导出', capabilities: ['REPORT_CENTER'] },
] as const;
export type BusinessAccessModule = typeof BUSINESS_ACCESS_MODULES[number]['key'];
export type ModuleAccessLevel = 'READ' | 'COLLABORATE';
export type ModulePermissionKey = BusinessAccessModule | SubmoduleKey;
export type ModulePermissions = Partial<Record<ModulePermissionKey, ModuleAccessLevel>>;
export type ModuleAccessCarrier = { modulePermissions?: ModulePermissions | null; workbenchEnabled?: boolean; sampleLibraryEnabled?: boolean; sampleCaptureEnabled?: boolean; employeeAccountManager?: boolean };
export const MODULE_ACCESS_PROFILE = 'MODULE_ACCESS';
export const MODULE_MARKER_ON = 'MODULES:ON';
export const MODULE_MARKER_OFF = 'MODULES:OFF';

export function parseModulePermissions(value: unknown): ModulePermissions {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('请选择有效的模块权限');
  const result: ModulePermissions = {};
  for (const [key, level] of Object.entries(value)) {
    if (!BUSINESS_ACCESS_MODULES.some(module => module.key === key) && !submoduleDefinition(key) || !['READ', 'COLLABORATE'].includes(String(level))) throw new Error('模块或权限级别不正确');
    result[key as ModulePermissionKey] = level as ModuleAccessLevel;
  }
  for (const item of BUSINESS_SUBMODULES) if (result[item.key] && result[item.group]) throw new Error('请按小模块保存，不能混用同组的大模块与小模块授权');
  return result;
}
export function parseModuleScope(scope: string): { module: ModulePermissionKey; level: ModuleAccessLevel } | null {
  const [, key, level] = /^MODULE:([^:]+):(READ|COLLABORATE)$/.exec(scope) || [];
  return BUSINESS_ACCESS_MODULES.some(module => module.key === key) || submoduleDefinition(key) ? { module: key as ModulePermissionKey, level: level as ModuleAccessLevel } : null;
}
/** Explicit children are authoritative for their whole group; a stale parent never restores a removed sibling. */
export function expandModulePermissions(permissions: ModulePermissions): ModulePermissions {
  const result: ModulePermissions = {};
  for (const group of BUSINESS_ACCESS_MODULES) {
    const children = BUSINESS_SUBMODULES.filter(item => item.group === group.key);
    const explicit = children.some(item => permissions[item.key] !== undefined);
    for (const child of children) {
      const level = explicit ? permissions[child.key] : permissions[group.key];
      if (level) result[child.key] = child.readOnly ? 'READ' : level;
    }
  }
  return result;
}
export function moduleLevel(access: ModuleAccessCarrier, key: ModulePermissionKey): ModuleAccessLevel | undefined {
  if (access.workbenchEnabled === false || access.modulePermissions == null) return undefined;
  const expanded = expandModulePermissions(access.modulePermissions);
  if (submoduleDefinition(key)) return expanded[key];
  const levels = BUSINESS_SUBMODULES.filter(item => item.group === key).map(item => expanded[item.key]);
  return levels.includes('COLLABORATE') ? 'COLLABORATE' : levels.includes('READ') ? 'READ' : undefined;
}
export function moduleReadOnly(access: ModuleAccessCarrier, key: ModulePermissionKey): boolean {
  return access.modulePermissions != null && moduleLevel(access, key) !== 'COLLABORATE';
}
export function moduleConfiguration(grants: readonly { profile?: string; profileKey?: string; scopeKey: string }[]) {
  const selected = grants.filter(grant => (grant.profile || grant.profileKey) === MODULE_ACCESS_PROFILE);
  if (!selected.length) return null;
  const permissions: ModulePermissions = {};
  const workbenchEnabled = selected.some(grant => grant.scopeKey === MODULE_MARKER_ON);
  if (workbenchEnabled) for (const grant of selected) {
    const scope = parseModuleScope(grant.scopeKey);
    if (scope && permissions[scope.module] !== 'COLLABORATE') permissions[scope.module] = scope.level;
  }
  return { permissions, workbenchEnabled };
}
export function hasModuleCollaboration(access: ModuleAccessCarrier, module: ModulePermissionKey): boolean {
  return moduleLevel(access, module) === 'COLLABORATE';
}
export function moduleAllows(access: ModuleAccessCarrier, owners: readonly ModulePermissionKey[], write = false): boolean | null {
  if (access.modulePermissions == null) return null;
  if (access.workbenchEnabled === false) return false;
  return owners.some(owner => write ? moduleLevel(access, owner) === 'COLLABORATE' : Boolean(moduleLevel(access, owner)));
}
export function hasSubmoduleConfiguration(access: ModuleAccessCarrier): boolean {
  return Object.keys(access.modulePermissions || {}).some(key => Boolean(submoduleDefinition(key)));
}
function matchingSubmodules(path: string, kind: 'paths' | 'apis'): SubmoduleKey[] {
  const matches = BUSINESS_SUBMODULES.flatMap(item => item[kind].filter(prefix => prefixMatch(path, prefix)).map(prefix => ({ key: item.key, length: prefix.length })));
  const longest = Math.max(0, ...matches.map(item => item.length));
  return matches.filter(item => item.length === longest).map(item => item.key);
}
const PAGE_OWNERS: Array<[string, BusinessAccessModule[]]> = [
  ['/tooling-mobile', ['technology']],
  ['/workspace/other-hours/approvals', ['collaboration']], ['/workspace/employees/accounts', ['people']],
  ['/workspace/reviews', ['quality', 'technology']], ['/workspace/quality', ['quality']], ['/workspace/quality-', ['quality']], ['/quality-capture', ['quality']], ['/quality-quick-capture', ['quality']],
  ['/material-upload', ['materials']], ['/workspace/material-library', ['materials']], ['/workspace/finished-goods', ['materials']], ['/workspace/wip', ['materials']], ['/workspace/warehouse', ['materials']], ['/workspace/procurement', ['materials']], ['/workspace/purchases', ['materials']],
  ['/drawing-library', ['technology']], ['/connector-', ['technology']], ['/workspace/terminal-tooling', ['technology']], ['/workspace/product-times', ['technology']], ['/workspace/time-standards', ['technology']], ['/workspace/processes', ['technology']], ['/workspace/knowledge', ['technology']], ['/workspace/capability-showcase', ['technology']],
  ['/workspace/employees', ['people']], ['/workspace/attendance', ['people']], ['/workspace/abnormal-times', ['people']], ['/workspace/other-hours', ['people']], ['/workspace/responsibilities', ['people']],
  ['/workspace/reports', ['reports']], ['/workspace/issues', ['collaboration']], ['/workspace/changes', ['collaboration']], ['/workspace/approvals', ['collaboration']], ['/workspace/workflows', ['collaboration']],
  ['/workspace/reporting-recovery', ['production']], ['/production', ['production']], ['/weekly-plan-center', ['production']], ['/workspace/daily-plans', ['production']], ['/workspace/weekly-processes', ['production']], ['/sample-capture', ['production']],
];
function prefixMatch(path: string, prefix: string): boolean { return path === prefix || path.startsWith(prefix + '/') || (prefix.endsWith('-') && path.startsWith(prefix)); }
export function modulePageDecision(access: ModuleAccessCarrier, pathname: string): boolean | null {
  if (access.modulePermissions == null) return null;
  const path = pathname.split('?')[0].replace(/\/+$/, '') || '/';
  if (hasSubmoduleConfiguration(access)) {
    const query = new URLSearchParams(pathname.split('?')[1] || '');
    if (path === '/weekly-plan-center') return moduleAllows(access, query.get('branch') === 'samples' ? ['sample-planning'] : query.get('view') === 'pool' ? ['order-pool'] : ['planning', 'sample-planning', 'order-pool']);
    if (path === '/workspace/quality-fixtures') return moduleAllows(access, ['plans', 'fixtures', 'stock'].includes(query.get('view') || '') ? ['fixture-management'] : ['quality-review', 'fixture-management', 'drawing-library']);
    if (path === '/workspace/employees') return moduleAllows(access, ['employees', 'recruitment', 'training', 'employee-accounts']);
    if (path === '/workspace/reports') return moduleAllows(access, ['reports']);
    const keys = matchingSubmodules(path, 'paths');
    if (keys.length) return moduleAllows(access, keys);
    if (path.startsWith('/workspace/reports/')) return false;
  }
  const owners = PAGE_OWNERS.find(([prefix]) => prefixMatch(path, prefix))?.[1];
  if (owners) return moduleAllows(access, owners);
  // Personal account and independently enabled field reporting use their existing checks.
  if (['/account', '/field-report', '/workspace/messages', '/workspace/help', '/workspace/initiated', '/workspace/involved', '/workspace/copied', '/workspace/following', '/workspace/more'].some(prefix => prefixMatch(path, prefix))) return null;
  if (path === '/home') return access.workbenchEnabled !== false;
  return false;
}

const API_OWNERS: Array<[string, BusinessAccessModule[]]> = [
  ['/api/other-work-times', ['people', 'collaboration']],
  ['/api/quality-fixtures', ['quality', 'technology', 'production', 'materials']], ['/api/quality', ['quality']], ['/api/quality-data', ['quality']], ['/api/quality-quick', ['quality']], ['/api/process-report-quality', ['quality']],
  ['/api/material-library', ['materials']], ['/api/material-follow-ups', ['materials']], ['/api/warehouse', ['materials']], ['/api/finished-goods', ['materials']], ['/api/purchases', ['materials']], ['/api/wip', ['materials']],
  ['/api/drawing-library', ['technology']], ['/api/connector-', ['technology']], ['/api/terminal-tooling', ['technology']], ['/api/product-times', ['technology']], ['/api/product-time', ['technology']], ['/api/knowledge', ['technology']], ['/api/capability-showcase', ['technology']],
  ['/api/employees', ['people']], ['/api/recruitment', ['people']], ['/api/training', ['people']], ['/api/skills', ['people']], ['/api/attendance', ['people']], ['/api/abnormal-time-events', ['people']], ['/api/responsibilities', ['people']],
  ['/api/reports', ['reports']], ['/api/issues', ['collaboration']], ['/api/changes', ['collaboration']], ['/api/change-requests', ['collaboration']], ['/api/approvals', ['collaboration']], ['/api/workflows', ['collaboration']],
  ['/api/sample-', ['production']], ['/api/production', ['production']], ['/api/planning', ['production']], ['/api/daily-plans', ['production']], ['/api/weekly-plans', ['production']],
  ['/api/resource-files', ['technology', 'production']], ['/api/upload', ['technology', 'production']],
];
export function moduleApiDecision(access: ModuleAccessCarrier, pathname: string, method: string | null | undefined, ruleModules: readonly string[] = []): boolean | null {
  if (access.modulePermissions == null) return null;
  const path = pathname.split('?')[0].replace(/\/+$/, '');
  const verb = String(method || 'GET').toUpperCase();
  const read = ['GET', 'HEAD', 'OPTIONS'].includes(verb);
  // Account administration and independent QR reporting NEVER inherit a business grant.
  if (/^\/api\/(?:users|auth|me|field-report|notifications)(?:\/|$)/.test(path)) return null;
  if (access.workbenchEnabled === false) return false;
  if (/(?:^|\/)(?:purge|permanent-delete|cleanup|reset-all)(?:\/|$)/.test(path) || ruleModules.includes('SYSTEM_CONFIGURATION') && !path.startsWith('/api/knowledge')) return false;
  // Read-only POSTs must be individually declared, never inferred from a UI button label.
  const readCommand = verb === 'POST' && /^\/api\/(?:reports\/[^/]+\/(?:preview|export)|drawing-library\/[^/]+\/print-preview|planning\/weekly-plan-export\/preview|finished-goods\/reports\/preview)$/.test(path);
  const write = !read && !readCommand;
  if (hasSubmoduleConfiguration(access)) return submoduleApiDecision(access, path, write, ruleModules);
  if (path.startsWith('/api/order-pool/commands') || path.startsWith('/api/order-pool/import')) return moduleAllows(access, ['production'], write);
  if (path.startsWith('/api/order-pool')) return moduleAllows(access, ['production', 'materials', 'technology'], write);
  const dependencies = /^\/api\/(?:work-orders|departments|customers|resource-categories|categories)(?:\/|$)/.test(path);
  if (read && dependencies && Object.keys(access.modulePermissions).length) return true;
  if (read && /^\/api\/planning\/import\/drawings(?:\/|$)/.test(path)) return moduleAllows(access, ['production', 'technology']);
  // Only read dependencies needed by selected business screens, never their mutations.
  if (read && /^\/api\/warehouse\/material-orders(?:\/|$)/.test(path)) return moduleAllows(access, ['materials', 'production']);
  if (read && /^\/api\/reports\/employee-attainment(?:\/|$)/.test(path)) return moduleAllows(access, ['people', 'reports']);
  if (read && /^\/api\/quality-fixtures(?:\/|$)/.test(path)) return moduleAllows(access, ['quality', 'technology', 'production', 'materials']);
  // Shared review/plan/warehouse screens must be able to render their linked documents.
  // Grant only content and orientation reads; library browsing and every mutation retain their owners.
  if (read && /^\/api\/drawing-library\/files\/[^/]+\/(?:content|display-settings)$/.test(path)) return moduleAllows(access, ['quality', 'technology', 'production', 'materials']);
  const owners = API_OWNERS.find(([prefix]) => prefixMatch(path, prefix))?.[1];
  if (owners) return moduleAllows(access, owners, write);
  const mapped = BUSINESS_ACCESS_MODULES.filter(module => ruleModules.some(capability => (module.capabilities as readonly string[]).includes(capability))).map(module => module.key);
  if (mapped.length) return moduleAllows(access, mapped, write);
  if (read && ruleModules.some(module => ['BASIC_SUMMARY', 'ACCOUNT_SELF', 'NOTIFICATIONS'].includes(module))) return true;
  return false;
}

/** A shared document endpoint contains several business commands; check its payload too. */
export function moduleFixtureActionAllowed(access: ModuleAccessCarrier, action: string): boolean {
  if (access.modulePermissions == null) return true;
  if (action === 'SAVE_SETTINGS') return false;
  if (hasSubmoduleConfiguration(access)) {
    const owners: ModulePermissionKey[] = ['APPROVE', 'RETURN'].includes(action) ? ['quality-review']
      : ['RESPOND_RETURN', 'RESUBMIT_RETURNS', 'RECONCILE_REVIEW'].includes(action) ? ['drawing-library']
      : ['CREATE_FIXTURE_PURCHASE', 'STOCK', 'SAVE_PREPARATION', 'SET_QUANTITY', 'SAVE_MAPPING', 'DELETE_MAPPING', 'SAVE_TEMPLATE'].includes(action) ? ['fixture-management']
      : ['quality-review', 'drawing-library'];
    return moduleAllows(access, owners, true) === true;
  }
  const owners: BusinessAccessModule[] = ['APPROVE', 'RETURN'].includes(action) ? ['quality', 'production']
    : ['RESPOND_RETURN', 'RESUBMIT_RETURNS', 'RECONCILE_REVIEW'].includes(action) ? ['technology']
    : ['CREATE_FIXTURE_PURCHASE', 'STOCK', 'SAVE_PREPARATION', 'SET_QUANTITY'].includes(action) ? ['quality', 'materials']
    : ['quality', 'technology', 'production'];
  return moduleAllows(access, owners, true) === true;
}

function submoduleApiDecision(access: ModuleAccessCarrier, path: string, write: boolean, ruleModules: readonly string[]): boolean {
  const allow = (keys: readonly ModulePermissionKey[], mutation = write) => moduleAllows(access, keys, mutation) === true;
  if (!write && /^\/api\/(?:work-orders|departments|customers|resource-categories|categories)(?:\/|$)/.test(path)) return Object.keys(expandModulePermissions(access.modulePermissions || {})).length > 0;
  if (!write && /^\/api\/planning\/import\/drawings(?:\/|$)/.test(path)) return allow(['planning', 'sample-planning', 'order-pool', 'drawing-library']);
  if (!write && /^\/api\/warehouse\/material-orders(?:\/|$)/.test(path)) return allow(['warehouse', 'material-follow-up', 'planning', 'sample-planning', 'order-pool']);
  if (path.startsWith('/api/order-pool')) return allow(!write ? ['order-pool', 'warehouse', 'drawing-library', 'material-follow-up', 'planning'] : /\/progress$/.test(path) ? ['order-pool', 'warehouse', 'drawing-library'] : ['order-pool']);
  if (path.startsWith('/api/quality-fixtures')) return allow(['quality-review', 'fixture-management', 'drawing-library', ...(!write ? ['planning', 'sample-planning', 'warehouse', 'order-pool'] as const : [])]);
  if (!write && /^\/api\/drawing-library\/files\/[^/]+\/(?:content|display-settings)$/.test(path)) return allow(['quality-review', 'drawing-library', 'planning', 'sample-planning', 'order-pool', 'warehouse', 'production-execution', 'fixture-management']);
  if (!write && path === '/api/employees') return allow(['employees', 'employee-accounts', 'training', 'recruitment', 'attendance', 'abnormal-time', 'other-hours', 'other-hours-approval', 'responsibilities']);
  if (!write && path.startsWith('/api/skills')) return allow(['training', 'employees']);
  if (path.startsWith('/api/other-work-times')) return allow(['other-hours', 'other-hours-approval']);
  if (/^\/api\/work-orders\/[^/]+\/process-route/.test(path)) return allow(['product-times', 'production-execution']);
  if (/^\/api\/(?:process-completion|process-report-submissions)/.test(path)) return allow(['reporting-recovery', 'production-execution']);
  if (/^\/api\/work-orders(?:\/|$)/.test(path)) return allow(['planning', 'production-execution']);
  if (path.startsWith('/api/reports')) return !write && allow(['reports', ...(path.startsWith('/api/reports/employee-attainment') ? ['employees', 'attendance'] as const : [])]);
  if (/^\/api\/process-management\/(?:completions|completion-withdrawal-requests)/.test(path) || /^\/api\/process-management\/routes\/[^/]+\/completions\/[^/]+\/withdraw$/.test(path)) return allow(['reporting-recovery', 'production-execution']);
  if (path.startsWith('/api/process-management/route-changes')) return allow(['workflows', 'product-times', 'production-execution']);
  if (/^\/api\/(?:process-management|process-executions|process-labor-claims)/.test(path)) return allow(['production-execution', 'product-times']);
  if (path.startsWith('/api/process-labor-pools')) return allow(write ? ['production-execution', 'product-times'] : ['production-execution', 'product-times', 'report-labor-ledger']);
  if (path.startsWith('/api/import/work-orders')) return allow(['planning']);
  if (path.startsWith('/api/export/production') || path.startsWith('/api/export/work-orders')) return !write && allow(['planning', 'production-execution']);
  if (path.startsWith('/api/export/resource-files')) return !write && allow(['drawing-library']);
  if (path.startsWith('/api/dashboard/')) return !write;
  if (path.startsWith('/api/change-snapshots')) return allow(['changes']);
  if (path.startsWith('/api/work-order-qr')) return allow(['production-execution', 'planning']);
  const keys = matchingSubmodules(path, 'apis');
  if (keys.length) return allow(keys);
  // Remaining legacy endpoints still have capability rules, but never inherit a sibling's write access.
  // Unmapped write namespaces fail closed; a shared capability must not grant a sibling operation.
  return !write && ruleModules.some(module => ['BASIC_SUMMARY', 'ACCOUNT_SELF', 'NOTIFICATIONS'].includes(module));
}
