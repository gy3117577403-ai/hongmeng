import {
  hasCapability,
  type AccessContext,
  type AccessScopeHint,
  type ProductionScopeLevel,
} from '@/lib/department-access';

export type ProductionEntityScope = {
  level: ProductionScopeLevel;
  canRead: boolean;
  canWrite: boolean;
  canReconcile: boolean;
  readOnly: boolean;
  teamKeys: readonly string[];
};

export type ProductionScopeSubject = {
  access: Pick<AccessContext, 'capabilities' | 'productionScope' | 'scopeHints'>;
  /** Stable ProductionTeam ids from the planning-membership compatibility layer. */
  dailyPlanningTeamIds?: readonly string[];
};

export type DailyPlanningActorScopeSources = {
  hasExplicitAccessGrants: boolean;
  explicitWorkshopAccess: boolean;
  explicitTeamIds: readonly string[];
  legacySupervisor: boolean;
  legacyLeaderTeamIds: readonly string[];
  legacyMemberTeamIds: readonly string[];
};

export class ProductionAccessScopeError extends Error {
  constructor(
    message: string,
    public readonly code: 'PRODUCTION_SCOPE_FORBIDDEN' | 'PRODUCTION_TEAM_FORBIDDEN',
    public readonly status = 403,
  ) {
    super(message);
  }
}

function normalizedKey(value: unknown): string {
  return String(value || '').trim();
}

function teamKeyFromHint(hint: AccessScopeHint): string | null {
  if (hint.module !== 'PRODUCTION' || hint.level !== 'TEAM') return null;
  const explicit = normalizedKey(hint.teamId);
  if (explicit) return explicit;
  const scopeKey = normalizedKey(hint.scopeKey);
  if (!scopeKey.toLocaleUpperCase('en-US').startsWith('TEAM:')) return null;
  return normalizedKey(scopeKey.slice(scopeKey.indexOf(':') + 1)) || null;
}

function uniqueKeys(values: readonly (string | null | undefined)[]): string[] {
  const result = new Map<string, string>();
  for (const value of values) {
    const key = normalizedKey(value);
    if (!key) continue;
    const normalized = key.toLocaleLowerCase('zh-CN');
    if (!result.has(normalized)) result.set(normalized, key);
  }
  return [...result.values()];
}

/**
 * Stored access grants are authoritative once an account has been migrated.
 * Planning memberships remain a compatibility source only for accounts that
 * do not have any explicit grant yet; otherwise an old supervisor membership
 * could silently widen a newly assigned TEAM grant back to the whole workshop.
 */
export function resolveDailyPlanningActorScopeSources(
  sources: DailyPlanningActorScopeSources,
): Pick<ProductionEntityScope, 'teamKeys'> & {
  isSupervisor: boolean;
  memberTeamIds: string[];
} {
  const useLegacyMemberships = !sources.hasExplicitAccessGrants;
  return {
    isSupervisor: sources.explicitWorkshopAccess
      || (useLegacyMemberships && sources.legacySupervisor),
    teamKeys: uniqueKeys(useLegacyMemberships
      ? sources.legacyLeaderTeamIds
      : sources.explicitTeamIds),
    memberTeamIds: uniqueKeys(useLegacyMemberships ? sources.legacyMemberTeamIds : []),
  };
}

/**
 * Resolve the entity boundary for production data.
 *
 * A planning department grant is deliberately global for production entities.
 * GM has a GLOBAL production hint but no write capability, therefore remains
 * read-only. Team identifiers accept both the new access-grant key (often a
 * legacy team name) and stable planning membership ids during migration.
 */
export function resolveProductionEntityScope(
  subject: ProductionScopeSubject,
  options: { allowBasicSummary?: boolean } = {},
): ProductionEntityScope {
  const productionRead = hasCapability(subject.access, 'PRODUCTION', 'READ');
  const planningRead = hasCapability(subject.access, 'PLANNING', 'READ');
  const basicSummaryRead = options.allowBasicSummary === true
    && hasCapability(subject.access, 'BASIC_SUMMARY', 'READ');
  const summaryOnly = basicSummaryRead && !productionRead && !planningRead;
  const canRead = productionRead || planningRead || basicSummaryRead;
  const canWrite = hasCapability(subject.access, 'PRODUCTION', 'UPDATE')
    || hasCapability(subject.access, 'PRODUCTION', 'CREATE')
    || hasCapability(subject.access, 'PRODUCTION', 'EXECUTE_WORKFLOW')
    || hasCapability(subject.access, 'PLANNING', 'UPDATE')
    || hasCapability(subject.access, 'PLANNING', 'CREATE')
    || hasCapability(subject.access, 'PLANNING', 'EXECUTE_WORKFLOW');

  let level: ProductionScopeLevel = subject.access.productionScope;
  if (planningRead || summaryOnly) level = 'GLOBAL';
  if (!canRead) level = 'NONE';

  const hintKeys = subject.access.scopeHints.map(teamKeyFromHint);
  const teamKeys = level === 'TEAM'
    ? (() => {
        const configuredKeys = uniqueKeys(hintKeys);
        return configuredKeys.length
          ? configuredKeys
          : uniqueKeys(subject.dailyPlanningTeamIds || []);
      })()
    : [];
  // A TEAM grant without a resolvable team fails closed.
  if (level === 'TEAM' && teamKeys.length === 0) level = 'NONE';

  const effectiveCanRead = canRead && level !== 'NONE';
  const effectiveCanWrite = canWrite && level !== 'NONE' && !summaryOnly;
  return {
    level,
    canRead: effectiveCanRead,
    canWrite: effectiveCanWrite,
    // Reconciliation mutates the whole workshop dataset. A team leader must
    // never trigger it from a GET, and a read-only global user (GM) cannot.
    canReconcile: effectiveCanWrite && (level === 'GLOBAL' || level === 'WORKSHOP'),
    readOnly: !effectiveCanWrite,
    teamKeys,
  };
}

export function assertProductionScopeRead(scope: ProductionEntityScope): void {
  if (!scope.canRead) {
    throw new ProductionAccessScopeError('当前账号没有查看生产数据的权限', 'PRODUCTION_SCOPE_FORBIDDEN');
  }
}

export function assertProductionScopeWrite(scope: ProductionEntityScope): void {
  if (!scope.canWrite) {
    throw new ProductionAccessScopeError('当前账号没有修改生产数据的权限', 'PRODUCTION_SCOPE_FORBIDDEN');
  }
}

export function matchesProductionTeam(
  scope: ProductionEntityScope,
  team: { id?: string | null; code?: string | null; name?: string | null; legacyTeamName?: string | null },
): boolean {
  if (scope.level === 'GLOBAL' || scope.level === 'WORKSHOP') return true;
  if (scope.level !== 'TEAM') return false;
  const allowed = new Set(scope.teamKeys.map(key => key.toLocaleLowerCase('zh-CN')));
  return [team.id, team.code, team.name, team.legacyTeamName]
    .some(value => allowed.has(normalizedKey(value).toLocaleLowerCase('zh-CN')));
}

export function assertProductionTeam(
  scope: ProductionEntityScope,
  team: { id?: string | null; code?: string | null; name?: string | null; legacyTeamName?: string | null },
): void {
  assertProductionScopeWrite(scope);
  if (!matchesProductionTeam(scope, team)) {
    throw new ProductionAccessScopeError('只能修改本人班组关联的生产数据', 'PRODUCTION_TEAM_FORBIDDEN');
  }
}

/** A Prisma-compatible relation filter without importing the generated client. */
export function productionTeamScopeWhere(scope: ProductionEntityScope): Record<string, unknown> | null {
  if (scope.level === 'NONE') return { id: { in: [] } };
  if (scope.level !== 'TEAM') return null;
  const keys = [...scope.teamKeys];
  return {
    OR: [
      { id: { in: keys } },
      { code: { in: keys } },
      { name: { in: keys } },
      { legacyTeamName: { in: keys } },
    ],
  };
}
