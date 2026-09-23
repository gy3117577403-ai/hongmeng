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
export type ModulePermissions = Partial<Record<BusinessAccessModule, ModuleAccessLevel>>;
export type ModuleAccessCarrier = { modulePermissions?: ModulePermissions | null; workbenchEnabled?: boolean; sampleLibraryEnabled?: boolean };
export const MODULE_ACCESS_PROFILE = 'MODULE_ACCESS';
export const MODULE_MARKER_ON = 'MODULES:ON';
export const MODULE_MARKER_OFF = 'MODULES:OFF';

export function parseModulePermissions(value: unknown): ModulePermissions {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('请选择有效的模块权限');
  const result: ModulePermissions = {};
  for (const [key, level] of Object.entries(value)) {
    if (!BUSINESS_ACCESS_MODULES.some(module => module.key === key) || !['READ', 'COLLABORATE'].includes(String(level))) throw new Error('模块或权限级别不正确');
    result[key as BusinessAccessModule] = level as ModuleAccessLevel;
  }
  return result;
}
export function parseModuleScope(scope: string): { module: BusinessAccessModule; level: ModuleAccessLevel } | null {
  const [, key, level] = /^MODULE:([^:]+):(READ|COLLABORATE)$/.exec(scope) || [];
  return BUSINESS_ACCESS_MODULES.some(module => module.key === key) ? { module: key as BusinessAccessModule, level: level as ModuleAccessLevel } : null;
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
export function hasModuleCollaboration(access: ModuleAccessCarrier, module: BusinessAccessModule): boolean {
  return access.modulePermissions?.[module] === 'COLLABORATE' && access.workbenchEnabled !== false;
}
export function moduleAllows(access: ModuleAccessCarrier, owners: readonly BusinessAccessModule[], write = false): boolean | null {
  if (access.modulePermissions == null) return null;
  if (access.workbenchEnabled === false) return false;
  return owners.some(owner => write ? access.modulePermissions?.[owner] === 'COLLABORATE' : Boolean(access.modulePermissions?.[owner]));
}
const PAGE_OWNERS: Array<[string, BusinessAccessModule[]]> = [
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
  const readCommand = verb === 'POST' && /^\/api\/(?:reports\/[^/]+\/(?:preview|export)|drawing-library\/[^/]+\/print-preview|planning\/weekly-plan-export\/preview)$/.test(path);
  const write = !read && !readCommand;
  const dependencies = /^\/api\/(?:work-orders|departments|customers|resource-categories|categories)(?:\/|$)/.test(path);
  if (read && dependencies && Object.keys(access.modulePermissions).length) return true;
  // Only read dependencies needed by selected business screens, never their mutations.
  if (read && /^\/api\/reports\/employee-attainment(?:\/|$)/.test(path)) return moduleAllows(access, ['people', 'reports']);
  if (read && /^\/api\/quality-fixtures(?:\/|$)/.test(path)) return moduleAllows(access, ['quality', 'technology', 'production', 'materials']);
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
  const owners: BusinessAccessModule[] = ['APPROVE', 'RETURN'].includes(action) ? ['quality', 'production']
    : ['RESPOND_RETURN', 'RESUBMIT_RETURNS'].includes(action) ? ['technology']
    : ['CREATE_FIXTURE_PURCHASE', 'STOCK', 'SAVE_PREPARATION', 'SET_QUANTITY'].includes(action) ? ['quality', 'materials']
    : ['quality', 'technology', 'production'];
  return moduleAllows(access, owners, true) === true;
}
