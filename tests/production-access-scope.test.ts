import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveAccessContext, type DepartmentCode } from '../lib/department-access';
import {
  assertProductionScopeWrite,
  matchesProductionTeam,
  productionTeamScopeWhere,
  ProductionAccessScopeError,
  resolveDailyPlanningActorScopeSources,
  resolveProductionEntityScope,
} from '../lib/production-access-scope';

function context(profile: Parameters<typeof resolveAccessContext>[0][number]['profile'], scopeKey: string, departmentCode?: DepartmentCode) {
  return resolveAccessContext([{
    profile,
    scopeKey,
    departmentCode,
    grantType: 'PRIMARY',
  }]);
}

test('administrator and planning department have global writable production scope', () => {
  const admin = resolveProductionEntityScope({ access: context('ADMIN_GLOBAL', 'GLOBAL') });
  assert.deepEqual({ level: admin.level, write: admin.canWrite, reconcile: admin.canReconcile }, {
    level: 'GLOBAL', write: true, reconcile: true,
  });

  const planning = resolveProductionEntityScope({
    access: context('DEPARTMENT_FULL', 'DEPARTMENT:PLANNING', 'PLANNING'),
  });
  assert.deepEqual({ level: planning.level, write: planning.canWrite, reconcile: planning.canReconcile }, {
    level: 'GLOBAL', write: true, reconcile: true,
  });
});

test('GM is global read-only and cannot trigger reconciliation', () => {
  const scope = resolveProductionEntityScope({
    access: context('GM_OFFICE_READER_APPROVER', 'DEPARTMENT:GM_OFFICE'),
  });
  assert.equal(scope.level, 'GLOBAL');
  assert.equal(scope.canRead, true);
  assert.equal(scope.canWrite, false);
  assert.equal(scope.canReconcile, false);
  assert.throws(() => assertProductionScopeWrite(scope), ProductionAccessScopeError);
});

test('workshop supervisor and team leader both manage the shared workshop dataset', () => {
  const supervisor = resolveProductionEntityScope({
    access: context('WORKSHOP_SUPERVISOR', 'WORKSHOP:PRODUCTION'),
  });
  assert.equal(supervisor.level, 'WORKSHOP');
  assert.equal(supervisor.canWrite, true);
  assert.equal(supervisor.canReconcile, true);

  const leader = resolveProductionEntityScope({
    access: context('WORKSHOP_TEAM_LEADER', 'TEAM:装配一组'),
    dailyPlanningTeamIds: ['stable-team-id'],
  });
  assert.equal(leader.level, 'WORKSHOP');
  assert.deepEqual(leader.teamKeys, []);
  assert.equal(leader.canWrite, true);
  assert.equal(leader.canReconcile, true);
  assert.equal(matchesProductionTeam(leader, { id: 'stable-team-id', name: '别组' }), true);
  assert.equal(matchesProductionTeam(leader, { id: 'other', legacyTeamName: '装配一组' }), true);
  assert.equal(matchesProductionTeam(leader, { id: 'other', name: '装配二组' }), true);
  assert.equal(productionTeamScopeWhere(leader), null);
});

test('team identity is not required to read the shared workshop workbench', () => {
  const access = context('WORKSHOP_TEAM_LEADER', 'TEAM:');
  const scope = resolveProductionEntityScope({ access });
  assert.equal(scope.level, 'WORKSHOP');
  assert.equal(scope.canRead, true);
  assert.equal(scope.canWrite, true);
  assert.equal(productionTeamScopeWhere(scope), null);
});

test('basic summary is opt-in, global and always read-only', () => {
  const business = context('DEPARTMENT_FULL', 'DEPARTMENT:BUSINESS', 'BUSINESS');
  const normal = resolveProductionEntityScope({ access: business });
  assert.equal(normal.canRead, false);
  const summary = resolveProductionEntityScope({ access: business }, { allowBasicSummary: true });
  assert.equal(summary.level, 'GLOBAL');
  assert.equal(summary.canRead, true);
  assert.equal(summary.canWrite, false);
  assert.equal(summary.canReconcile, false);

  const admin = resolveProductionEntityScope(
    { access: context('ADMIN_GLOBAL', 'GLOBAL') },
    { allowBasicSummary: true },
  );
  assert.equal(admin.canWrite, true);
  assert.equal(admin.canReconcile, true);

  const leader = resolveProductionEntityScope(
    { access: context('WORKSHOP_TEAM_LEADER', 'TEAM:装配一组') },
    { allowBasicSummary: true },
  );
  assert.equal(leader.level, 'WORKSHOP');
});

test('explicit team grants override stale workshop-supervisor planning memberships', () => {
  const migrated = resolveDailyPlanningActorScopeSources({
    hasExplicitAccessGrants: true,
    explicitWorkshopAccess: false,
    explicitTeamIds: ['team-b'],
    legacySupervisor: true,
    legacyLeaderTeamIds: ['team-a'],
    legacyMemberTeamIds: ['team-a'],
  });
  assert.equal(migrated.isSupervisor, false);
  assert.deepEqual(migrated.teamKeys, ['team-b']);
  assert.deepEqual(migrated.memberTeamIds, []);

  const legacy = resolveDailyPlanningActorScopeSources({
    hasExplicitAccessGrants: false,
    explicitWorkshopAccess: false,
    explicitTeamIds: [],
    legacySupervisor: true,
    legacyLeaderTeamIds: ['team-a'],
    legacyMemberTeamIds: ['team-a'],
  });
  assert.equal(legacy.isSupervisor, true);
  assert.deepEqual(legacy.teamKeys, ['team-a']);
  assert.deepEqual(legacy.memberTeamIds, ['team-a']);
});
