/**
 * Pure department access policy.
 *
 * This module intentionally does not import Prisma. The string codes are the
 * stable boundary shared by persistence adapters, API authorization and UI
 * visibility. Entity-level checks (for example, whether a production record
 * belongs to a leader's team) must still apply the returned scope hints.
 */

export const DEPARTMENT_CODES = [
  'PRODUCTION',
  'BUSINESS',
  'PROCUREMENT',
  'WAREHOUSE',
  'ENGINEERING',
  'QUALITY',
  'GM_OFFICE',
  'FINANCE',
  'PROCESS',
  'PLANNING',
  'HR',
] as const;

export type DepartmentCode = typeof DEPARTMENT_CODES[number];

export const ACCESS_PROFILE_CODES = [
  'ADMIN_GLOBAL',
  'DEPARTMENT_FULL',
  'PROCESS_SPECIALIST',
  'DRAWING_LIBRARY_READER',
  'DRAWING_LIBRARY_EDITOR',
  'REPORT_PEOPLE_READER',
  'QUALITY_REVIEWER',
  'FIELD_REPORTER',
  'GM_OFFICE_READER_APPROVER',
  'FINANCE_ACCOUNT_ONLY',
  'WORKSHOP_SUPERVISOR',
  'WORKSHOP_TEAM_LEADER',
] as const;

export type AccessProfileCode = typeof ACCESS_PROFILE_CODES[number];

export const ACCESS_GRANT_TYPES = ['PRIMARY', 'CONCURRENT', 'ACTING'] as const;

export type AccessGrantType = typeof ACCESS_GRANT_TYPES[number];

export const ACCESS_MODULES = [
  'BASIC_SUMMARY',
  'ACCOUNT_SELF',
  'NOTIFICATIONS',
  'FIELD_REPORT',
  'BUSINESS',
  'PROCUREMENT',
  'WAREHOUSE',
  'ENGINEERING',
  'QUALITY',
  'PROCESS',
  'ISSUE_MANAGEMENT',
  'CHANGE_MANAGEMENT',
  'DRAWING_LIBRARY',
  'REPORT_CENTER',
  'TERMINAL_TOOLING',
  'PLANNING',
  'HR',
  'PRODUCTION',
  'MAJOR_APPROVAL',
  'ACCOUNT_ADMIN',
  'SYSTEM_CONFIGURATION',
] as const;

export type AccessModuleCode = typeof ACCESS_MODULES[number];

export const ACCESS_ACTIONS = [
  'READ',
  'CREATE',
  'UPDATE',
  'DELETE',
  'EXECUTE_WORKFLOW',
  'APPROVE',
  'MANAGE',
  'PERMANENT_DELETE',
] as const;

export type AccessActionCode = typeof ACCESS_ACTIONS[number];
export type CapabilityCode = `${AccessModuleCode}:${AccessActionCode}`;

export const DEPARTMENT_OPERATION_ACTIONS = [
  'READ',
  'CREATE',
  'UPDATE',
  'DELETE',
  'EXECUTE_WORKFLOW',
] as const satisfies readonly AccessActionCode[];

export const BUSINESS_MODULES = [
  'BUSINESS',
  'PROCUREMENT',
  'WAREHOUSE',
  'ENGINEERING',
  'QUALITY',
  'PROCESS',
  'PLANNING',
  'HR',
  'PRODUCTION',
] as const satisfies readonly AccessModuleCode[];

export type BusinessModuleCode = typeof BUSINESS_MODULES[number];

/**
 * FINANCE and GM_OFFICE deliberately have no DEPARTMENT_FULL
 * mapping. Their restricted profiles must be used instead. Production uses
 * the workshop profiles so its entity scope remains explicit.
 */
export const DEPARTMENT_MODULE_MAP = {
  BUSINESS: 'BUSINESS',
  PROCUREMENT: 'PROCUREMENT',
  WAREHOUSE: 'WAREHOUSE',
  ENGINEERING: 'ENGINEERING',
  QUALITY: 'QUALITY',
  PROCESS: 'PROCESS',
  PLANNING: 'PLANNING',
  HR: 'HR',
} as const satisfies Partial<Record<DepartmentCode, BusinessModuleCode>>;

export const MODULE_ACTION_MATRIX = {
  BASIC_SUMMARY: ['READ'],
  ACCOUNT_SELF: ['READ', 'UPDATE'],
  NOTIFICATIONS: ['READ', 'UPDATE'],
  FIELD_REPORT: ['READ', 'CREATE', 'EXECUTE_WORKFLOW'],
  BUSINESS: DEPARTMENT_OPERATION_ACTIONS,
  PROCUREMENT: DEPARTMENT_OPERATION_ACTIONS,
  WAREHOUSE: DEPARTMENT_OPERATION_ACTIONS,
  ENGINEERING: DEPARTMENT_OPERATION_ACTIONS,
  QUALITY: DEPARTMENT_OPERATION_ACTIONS,
  PROCESS: DEPARTMENT_OPERATION_ACTIONS,
  ISSUE_MANAGEMENT: ['READ', 'CREATE', 'UPDATE', 'EXECUTE_WORKFLOW'],
  CHANGE_MANAGEMENT: ['READ', 'CREATE', 'UPDATE', 'EXECUTE_WORKFLOW'],
  DRAWING_LIBRARY: ['READ', 'CREATE', 'UPDATE'],
  REPORT_CENTER: ['READ'],
  TERMINAL_TOOLING: ['READ', 'CREATE', 'UPDATE', 'EXECUTE_WORKFLOW'],
  PLANNING: DEPARTMENT_OPERATION_ACTIONS,
  HR: DEPARTMENT_OPERATION_ACTIONS,
  PRODUCTION: DEPARTMENT_OPERATION_ACTIONS,
  MAJOR_APPROVAL: ['READ', 'APPROVE'],
  ACCOUNT_ADMIN: ['READ', 'CREATE', 'UPDATE', 'DELETE', 'MANAGE'],
  SYSTEM_CONFIGURATION: ['READ', 'UPDATE', 'MANAGE'],
} as const satisfies Record<AccessModuleCode, readonly AccessActionCode[]>;

export type AccessDateInput = Date | string | number;

export interface AccessGrant {
  id?: string;
  profile: AccessProfileCode;
  grantType: AccessGrantType;
  departmentCode?: DepartmentCode | null;
  scopeKey: string;
  isActive?: boolean;
  effectiveFrom?: AccessDateInput | null;
  effectiveTo?: AccessDateInput | null;
}

export type AccessScopeLevel = 'GLOBAL' | 'DEPARTMENT' | 'WORKSHOP' | 'TEAM' | 'SELF';

export interface AccessScopeHint {
  module: AccessModuleCode;
  level: AccessScopeLevel;
  readOnly: boolean;
  grantType: AccessGrantType;
  scopeKey: string;
  sourceGrantId?: string;
  departmentCode?: DepartmentCode;
  workshopId?: string;
  teamId?: string;
}

export type ProductionScopeLevel = 'NONE' | 'TEAM' | 'WORKSHOP' | 'GLOBAL';

export interface AccessContext {
  accountActive: boolean;
  effectiveGrants: readonly AccessGrant[];
  capabilities: readonly CapabilityCode[];
  modules: readonly AccessModuleCode[];
  scopeHints: readonly AccessScopeHint[];
  productionScope: ProductionScopeLevel;
}

export interface ResolveAccessOptions {
  accountActive?: boolean;
  now?: AccessDateInput;
}

const ACCESS_PROFILE_SET = new Set<string>(ACCESS_PROFILE_CODES);
const ACCESS_GRANT_TYPE_SET = new Set<string>(ACCESS_GRANT_TYPES);

/** Permanent deletion is intentionally absent from MODULE_ACTION_MATRIX. */
export const ADMIN_GLOBAL_ONLY_CAPABILITIES = BUSINESS_MODULES.map(module =>
  capabilityCode(module, 'PERMANENT_DELETE'),
);

const ALL_CAPABILITIES = [
  ...ACCESS_MODULES.flatMap(module =>
    MODULE_ACTION_MATRIX[module].map(action => capabilityCode(module, action)),
  ),
  ...ADMIN_GLOBAL_ONLY_CAPABILITIES,
];

const SELF_SERVICE_CAPABILITIES = [
  capabilityCode('ACCOUNT_SELF', 'READ'),
  capabilityCode('ACCOUNT_SELF', 'UPDATE'),
  capabilityCode('NOTIFICATIONS', 'READ'),
  capabilityCode('NOTIFICATIONS', 'UPDATE'),
] as const;

const FIELD_REPORT_CAPABILITIES = MODULE_ACTION_MATRIX.FIELD_REPORT.map(action =>
  capabilityCode('FIELD_REPORT', action),
);

const PRODUCTION_SCOPE_PRIORITY: Record<ProductionScopeLevel, number> = {
  NONE: 0,
  TEAM: 1,
  WORKSHOP: 2,
  GLOBAL: 3,
};

export function capabilityCode<M extends AccessModuleCode, A extends AccessActionCode>(
  module: M,
  action: A,
): `${M}:${A}` {
  return `${module}:${action}`;
}

function dateValue(value: AccessDateInput): number | null {
  const timestamp = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

/**
 * Grants are effective on a half-open interval:
 * effectiveFrom <= now < effectiveTo.
 * Missing bounds are open-ended. Invalid codes or dates fail closed.
 */
export function isGrantEffective(
  grant: AccessGrant,
  now: AccessDateInput = new Date(),
): boolean {
  if (!ACCESS_PROFILE_SET.has(grant.profile) || !ACCESS_GRANT_TYPE_SET.has(grant.grantType)) return false;
  if (grant.isActive === false) return false;
  if (!grant.scopeKey.trim()) return false;

  const nowValue = dateValue(now);
  if (nowValue === null) return false;

  if (grant.effectiveFrom != null) {
    const effectiveFrom = dateValue(grant.effectiveFrom);
    if (effectiveFrom === null || effectiveFrom > nowValue) return false;
  }

  if (grant.effectiveTo != null) {
    const effectiveTo = dateValue(grant.effectiveTo);
    if (effectiveTo === null || effectiveTo <= nowValue) return false;
  }

  return true;
}

export function effectiveAccessGrants(
  grants: readonly AccessGrant[],
  now: AccessDateInput = new Date(),
): AccessGrant[] {
  return grants.filter(grant => isGrantEffective(grant, now));
}

function addModuleActions(
  target: Set<CapabilityCode>,
  module: AccessModuleCode,
  actions: readonly AccessActionCode[],
): void {
  for (const action of actions) target.add(capabilityCode(module, action));
}

function addSelfService(target: Set<CapabilityCode>): void {
  for (const capability of SELF_SERVICE_CAPABILITIES) target.add(capability);
}

function addBasicSummary(target: Set<CapabilityCode>): void {
  target.add(capabilityCode('BASIC_SUMMARY', 'READ'));
}

function addWorkbenchCommon(
  capabilities: Set<CapabilityCode>,
  addScope: (scope: AccessScopeHint) => void,
  grant: AccessGrant,
): void {
  addSelfService(capabilities);
  addBasicSummary(capabilities);
  addScope(scopeForGrant(grant, 'ACCOUNT_SELF', 'SELF', false));
  addScope(scopeForGrant(grant, 'NOTIFICATIONS', 'SELF', false));
  addScope(scopeForGrant(grant, 'BASIC_SUMMARY', 'GLOBAL', true));
}

function scopeDedupKey(scope: AccessScopeHint): string {
  return [
    scope.module,
    scope.level,
    scope.readOnly ? 'readonly' : 'write',
    scope.grantType,
    scope.scopeKey,
    scope.sourceGrantId ?? '',
    scope.departmentCode ?? '',
    scope.workshopId ?? '',
    scope.teamId ?? '',
  ].join('|');
}

function scopeForGrant(
  grant: AccessGrant,
  module: AccessModuleCode,
  level: AccessScopeLevel,
  readOnly: boolean,
): AccessScopeHint {
  const separator = grant.scopeKey.indexOf(':');
  const scopePrefix = separator < 0 ? grant.scopeKey : grant.scopeKey.slice(0, separator);
  const scopeId = separator < 0 ? '' : grant.scopeKey.slice(separator + 1);
  return {
    module,
    level,
    readOnly,
    grantType: grant.grantType,
    scopeKey: grant.scopeKey,
    ...(grant.id ? { sourceGrantId: grant.id } : {}),
    ...(grant.departmentCode ? { departmentCode: grant.departmentCode } : {}),
    ...(scopePrefix === 'WORKSHOP' && scopeId ? { workshopId: scopeId } : {}),
    ...(scopePrefix === 'TEAM' && scopeId ? { teamId: scopeId } : {}),
  };
}

function visibleModulesFromCapabilities(capabilities: ReadonlySet<CapabilityCode>): AccessModuleCode[] {
  return ACCESS_MODULES.filter(module => {
    const prefix = `${module}:`;
    for (const capability of capabilities) {
      if (capability.startsWith(prefix)) return true;
    }
    return false;
  });
}

function strongerProductionScope(
  current: ProductionScopeLevel,
  candidate: ProductionScopeLevel,
): ProductionScopeLevel {
  return PRODUCTION_SCOPE_PRIORITY[candidate] > PRODUCTION_SCOPE_PRIORITY[current]
    ? candidate
    : current;
}

/** Resolve all currently effective grants by union. */
export function resolveAccessContext(
  grants: readonly AccessGrant[],
  options: ResolveAccessOptions = {},
): AccessContext {
  const accountActive = options.accountActive !== false;
  const now = options.now ?? new Date();
  if (!accountActive) {
    return {
      accountActive: false,
      effectiveGrants: [],
      capabilities: [],
      modules: [],
      scopeHints: [],
      productionScope: 'NONE',
    };
  }

  const effectiveGrants = effectiveAccessGrants(grants, now);
  const capabilities = new Set<CapabilityCode>();
  const scopes = new Map<string, AccessScopeHint>();
  let productionScope: ProductionScopeLevel = 'NONE';

  const addScope = (scope: AccessScopeHint) => scopes.set(scopeDedupKey(scope), scope);

  for (const grant of effectiveGrants) {
    if (grant.profile === 'ADMIN_GLOBAL') {
      for (const capability of ALL_CAPABILITIES) capabilities.add(capability);
      for (const moduleKey of ACCESS_MODULES) {
        addScope(scopeForGrant(grant, moduleKey, 'GLOBAL', false));
      }
      productionScope = 'GLOBAL';
      continue;
    }

    if (grant.profile === 'FIELD_REPORTER') {
      for (const capability of FIELD_REPORT_CAPABILITIES) capabilities.add(capability);
      addScope(scopeForGrant(grant, 'FIELD_REPORT', 'SELF', false));
      continue;
    }

    if (grant.profile === 'FINANCE_ACCOUNT_ONLY') {
      addSelfService(capabilities);
      addScope(scopeForGrant(grant, 'ACCOUNT_SELF', 'SELF', false));
      addScope(scopeForGrant(grant, 'NOTIFICATIONS', 'SELF', false));
      continue;
    }

    if (grant.profile === 'GM_OFFICE_READER_APPROVER') {
      addSelfService(capabilities);
      addBasicSummary(capabilities);
      addScope(scopeForGrant(grant, 'ACCOUNT_SELF', 'SELF', false));
      addScope(scopeForGrant(grant, 'NOTIFICATIONS', 'SELF', false));
      addScope(scopeForGrant(grant, 'BASIC_SUMMARY', 'GLOBAL', true));
      for (const moduleKey of BUSINESS_MODULES) {
        capabilities.add(capabilityCode(moduleKey, 'READ'));
        addScope(scopeForGrant(grant, moduleKey, 'GLOBAL', true));
      }
      addModuleActions(capabilities, 'MAJOR_APPROVAL', MODULE_ACTION_MATRIX.MAJOR_APPROVAL);
      addScope(scopeForGrant(grant, 'MAJOR_APPROVAL', 'GLOBAL', false));
      productionScope = strongerProductionScope(productionScope, 'GLOBAL');
      continue;
    }

    if (grant.profile === 'DEPARTMENT_FULL') {
      const departmentCode = grant.departmentCode;
      const moduleKey = departmentCode && departmentCode in DEPARTMENT_MODULE_MAP
        ? DEPARTMENT_MODULE_MAP[departmentCode as keyof typeof DEPARTMENT_MODULE_MAP]
        : undefined;
      if (!moduleKey) continue;

      addSelfService(capabilities);
      addBasicSummary(capabilities);
      addModuleActions(capabilities, moduleKey, DEPARTMENT_OPERATION_ACTIONS);
      addScope(scopeForGrant(grant, 'ACCOUNT_SELF', 'SELF', false));
      addScope(scopeForGrant(grant, 'NOTIFICATIONS', 'SELF', false));
      addScope(scopeForGrant(grant, 'BASIC_SUMMARY', 'GLOBAL', true));
      addScope(scopeForGrant(grant, moduleKey, 'DEPARTMENT', false));
      continue;
    }

    if (grant.profile === 'DRAWING_LIBRARY_READER') {
      addWorkbenchCommon(capabilities, addScope, grant);
      capabilities.add(capabilityCode('DRAWING_LIBRARY', 'READ'));
      addScope(scopeForGrant(grant, 'DRAWING_LIBRARY', 'GLOBAL', true));
      continue;
    }

    if (grant.profile === 'DRAWING_LIBRARY_EDITOR') {
      addWorkbenchCommon(capabilities, addScope, grant);
      addModuleActions(capabilities, 'DRAWING_LIBRARY', ['READ', 'CREATE', 'UPDATE']);
      addScope(scopeForGrant(grant, 'DRAWING_LIBRARY', 'GLOBAL', false));
      continue;
    }

    if (grant.profile === 'REPORT_PEOPLE_READER') {
      addWorkbenchCommon(capabilities, addScope, grant);
      capabilities.add(capabilityCode('REPORT_CENTER', 'READ'));
      addScope(scopeForGrant(grant, 'REPORT_CENTER', 'GLOBAL', true));
      continue;
    }

    if (grant.profile === 'QUALITY_REVIEWER') {
      addWorkbenchCommon(capabilities, addScope, grant);
      addModuleActions(capabilities, 'QUALITY', ['READ', 'CREATE', 'UPDATE', 'EXECUTE_WORKFLOW']);
      capabilities.add(capabilityCode('DRAWING_LIBRARY', 'READ'));
      addScope(scopeForGrant(grant, 'QUALITY', 'GLOBAL', false));
      addScope(scopeForGrant(grant, 'DRAWING_LIBRARY', 'GLOBAL', true));
      continue;
    }

    if (grant.profile === 'PROCESS_SPECIALIST') {
      // A process specialist owns process standards while collaborating with
      // production, issues, changes and drawings through deliberately narrower
      // capabilities. In particular, production and drawings remain read-only.
      if (grant.departmentCode !== 'PROCESS') continue;
      addSelfService(capabilities);
      addBasicSummary(capabilities);
      addModuleActions(capabilities, 'PROCESS', DEPARTMENT_OPERATION_ACTIONS);
      addModuleActions(capabilities, 'ISSUE_MANAGEMENT', MODULE_ACTION_MATRIX.ISSUE_MANAGEMENT);
      addModuleActions(capabilities, 'CHANGE_MANAGEMENT', MODULE_ACTION_MATRIX.CHANGE_MANAGEMENT);
      capabilities.add(capabilityCode('DRAWING_LIBRARY', 'READ'));
      addModuleActions(capabilities, 'TERMINAL_TOOLING', MODULE_ACTION_MATRIX.TERMINAL_TOOLING);
      capabilities.add(capabilityCode('PRODUCTION', 'READ'));
      addScope(scopeForGrant(grant, 'ACCOUNT_SELF', 'SELF', false));
      addScope(scopeForGrant(grant, 'NOTIFICATIONS', 'SELF', false));
      addScope(scopeForGrant(grant, 'BASIC_SUMMARY', 'GLOBAL', true));
      addScope(scopeForGrant(grant, 'PROCESS', 'DEPARTMENT', false));
      addScope(scopeForGrant(grant, 'ISSUE_MANAGEMENT', 'DEPARTMENT', false));
      addScope(scopeForGrant(grant, 'CHANGE_MANAGEMENT', 'DEPARTMENT', false));
      addScope(scopeForGrant(grant, 'DRAWING_LIBRARY', 'GLOBAL', true));
      addScope(scopeForGrant(grant, 'TERMINAL_TOOLING', 'GLOBAL', false));
      addScope(scopeForGrant(grant, 'PRODUCTION', 'WORKSHOP', true));
      productionScope = strongerProductionScope(productionScope, 'WORKSHOP');
      continue;
    }

    if (grant.profile === 'WORKSHOP_SUPERVISOR' || grant.profile === 'WORKSHOP_TEAM_LEADER') {
      addSelfService(capabilities);
      addBasicSummary(capabilities);
      addModuleActions(capabilities, 'PRODUCTION', DEPARTMENT_OPERATION_ACTIONS);
      capabilities.add(capabilityCode('TERMINAL_TOOLING', 'READ'));
      addScope(scopeForGrant(grant, 'ACCOUNT_SELF', 'SELF', false));
      addScope(scopeForGrant(grant, 'NOTIFICATIONS', 'SELF', false));
      addScope(scopeForGrant(grant, 'BASIC_SUMMARY', 'GLOBAL', true));
      addScope(scopeForGrant(grant, 'TERMINAL_TOOLING', 'GLOBAL', true));

      const isSupervisor = grant.profile === 'WORKSHOP_SUPERVISOR';
      addScope(scopeForGrant(grant, 'PRODUCTION', isSupervisor ? 'WORKSHOP' : 'TEAM', false));
      productionScope = strongerProductionScope(
        productionScope,
        isSupervisor ? 'WORKSHOP' : 'TEAM',
      );
    }
  }

  const modules = visibleModulesFromCapabilities(capabilities);
  const orderedCapabilities = ACCESS_MODULES.flatMap(module =>
    ACCESS_ACTIONS
      .map(action => capabilityCode(module, action))
      .filter(capability => capabilities.has(capability)),
  );

  return {
    accountActive: true,
    effectiveGrants,
    capabilities: orderedCapabilities,
    modules,
    scopeHints: [...scopes.values()],
    productionScope,
  };
}

export function hasCapability(
  context: Pick<AccessContext, 'capabilities'>,
  capability: CapabilityCode,
): boolean;
export function hasCapability(
  context: Pick<AccessContext, 'capabilities'>,
  module: AccessModuleCode,
  action: AccessActionCode,
): boolean;
export function hasCapability(
  context: Pick<AccessContext, 'capabilities'>,
  moduleOrCapability: AccessModuleCode | CapabilityCode,
  action?: AccessActionCode,
): boolean {
  const capability = action == null
    ? moduleOrCapability as CapabilityCode
    : capabilityCode(moduleOrCapability as AccessModuleCode, action);
  return context.capabilities.includes(capability);
}

export function visibleModules(
  context: Pick<AccessContext, 'modules'>,
): readonly AccessModuleCode[] {
  return context.modules;
}

export function allowedActions(
  context: Pick<AccessContext, 'capabilities'>,
  module: AccessModuleCode,
): AccessActionCode[] {
  return ACCESS_ACTIONS.filter(action =>
    hasCapability(context, module, action),
  );
}

export function scopeHintsFor(
  context: Pick<AccessContext, 'scopeHints'>,
  module: AccessModuleCode,
): AccessScopeHint[] {
  return context.scopeHints.filter(scope => scope.module === module);
}
