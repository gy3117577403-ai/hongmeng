import { hasCapability, resolveAccessContext, type AccessGrant } from '@/lib/department-access';
import type { CurrentUserDTO } from '@/types';
export type OtherWorkActor = Pick<CurrentUserDTO, 'id' | 'displayName' | 'username' | 'employeeId' | 'laborRole' | 'access' | 'dailyPlanningTeamIds'>;
export type OtherWorkRecordScope = { createdById: string; employeeId: string; teamIdSnapshot: string | null; teamSnapshot: string | null };

export function otherWorkScope(actor: Pick<OtherWorkActor, 'laborRole' | 'access'>) {
  if (actor.laborRole === 'ADMIN') return { manage: true, global: true, teams: [] as string[] };
  // Resolve only review profiles: a concurrent global read grant must not widen a team writer.
  const access = resolveAccessContext((actor.access.effectiveGrants || []).filter(g =>
    g.profile === 'WORKSHOP_SUPERVISOR' || g.profile === 'WORKSHOP_TEAM_LEADER').map(g => ({
      profile: g.profile as AccessGrant['profile'], grantType: g.grantType as AccessGrant['grantType'], scopeKey: g.scopeKey,
      isActive: true, effectiveFrom: g.effectiveFrom, effectiveTo: g.effectiveTo,
    })), { accountActive: actor.access.accountActive });
  const write = hasCapability(access, 'PRODUCTION', 'EXECUTE_WORKFLOW');
  const global = write && access.effectiveGrants.some(g => g.profile === 'WORKSHOP_SUPERVISOR' && !/^TEAM:/i.test(g.scopeKey));
  const teams = access.effectiveGrants.filter(g => /^TEAM:/i.test(g.scopeKey)).map(g => g.scopeKey.replace(/^TEAM:/i, '')).filter(Boolean);
  return { manage: write && (global || teams.length > 0), global, teams };
}
export function canReviewOtherWork(actor: OtherWorkActor, row: OtherWorkRecordScope) {
  const scope = otherWorkScope(actor);
  return scope.manage && actor.id !== row.createdById && actor.employeeId !== row.employeeId
    && (scope.global || scope.teams.some(key => [row.teamIdSnapshot, row.teamSnapshot].some(v => v?.toLowerCase() === key.toLowerCase())));
}
export function canReadOtherWork(actor: OtherWorkActor, row: OtherWorkRecordScope) {
  return row.createdById === actor.id || row.employeeId === actor.employeeId || canReviewOtherWork(actor, row) || actor.laborRole === 'ADMIN';
}
