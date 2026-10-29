import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveAccessContext, type AccessGrant } from '../lib/department-access';
import { BUSINESS_SUBMODULES } from '../lib/module-permissions';
import { APP_ROUTE_ACCESS_RULES, canAccessAppRoute } from '../lib/app-route-access';
import { canAccessApiRoute } from '../lib/api-route-access';
import { canReviewOtherWork, otherWorkScope } from '../lib/other-work-time-access';
import type { OtherWorkActor } from '../lib/other-work-time-access';

const grant = (profile: AccessGrant['profile'], scopeKey: string, departmentCode?: AccessGrant['departmentCode']): AccessGrant => ({ profile, scopeKey, departmentCode, grantType: 'CONCURRENT', isActive: true });
const modules = (permissions: Record<string, string>) => [grant('MODULE_ACCESS', 'MODULES:ON'), ...Object.entries(permissions).map(([key, level]) => grant('MODULE_ACCESS', `MODULE:${key}:${level}`))];

test('module recipient retains its existing access and covers the source production duty', () => {
  const sourceGrants = [grant('WORKSHOP_TEAM_LEADER', 'TEAM:source-team', 'PRODUCTION'), grant('FIELD_REPORTER', 'EMPLOYEE:source-employee', 'PRODUCTION')];
  const snapshot = structuredClone(sourceGrants);
  const source = resolveAccessContext(sourceGrants);
  const beforePermissions = Object.fromEntries(BUSINESS_SUBMODULES.filter(item => !['quality-management', 'employees', 'employee-accounts'].includes(item.key))
    .map(item => [item.key, item.readOnly || ['quality-data', 'quality-tasks', 'quality-confirmation'].includes(item.key) ? 'READ' : 'COLLABORATE']));
  const afterPermissions = { ...beforePermissions, 'quality-data': 'COLLABORATE', 'quality-management': 'COLLABORATE' };
  const before = resolveAccessContext(modules(beforePermissions));
  const after = resolveAccessContext([...modules(afterPermissions), grant('FIELD_REPORTER', 'EMPLOYEE:target-employee', 'PRODUCTION')]);
  for (const capability of [...source.capabilities, ...before.capabilities]) assert.ok(after.capabilities.includes(capability), capability);
  for (const rule of APP_ROUTE_ACCESS_RULES) if (canAccessAppRoute(source, rule.prefix) || canAccessAppRoute(before, rule.prefix)) assert.ok(canAccessAppRoute(after, rule.prefix), rule.prefix);
  for (const [key, level] of Object.entries(beforePermissions)) if (key !== 'quality-data') assert.equal(afterPermissions[key as keyof typeof afterPermissions], level, key);
  for (const url of ['/api/quality-data', '/api/process-report-quality', '/api/quality/8d', '/api/field-report']) assert.equal(canAccessApiRoute(after, url, 'POST'), true, url);
  for (const url of ['/api/users/module-access', '/api/system/settings']) assert.equal(canAccessApiRoute(after, url, 'POST'), false, url);
  assert.ok(after.effectiveGrants.some(g => g.profile === 'FIELD_REPORTER' && g.scopeKey === 'EMPLOYEE:target-employee'));
  assert.ok(!after.effectiveGrants.some(g => g.scopeKey === 'EMPLOYEE:source-employee'));
  assert.deepEqual(sourceGrants, snapshot);
});

test('company other-hours reviewer is independent of legacy labor role and never self-reviews', () => {
  const access = resolveAccessContext(modules({ 'other-hours': 'READ', 'other-hours-approval': 'COLLABORATE' }));
  const actor: OtherWorkActor = { id: 'reviewer', employeeId: 'reviewer-employee', displayName: 'QA reviewer', username: 'qa-reviewer', laborRole: 'EMPLOYEE', access, dailyPlanningTeamIds: [] };
  assert.deepEqual(otherWorkScope(actor), { manage: true, global: true, teams: [] });
  for (const teamIdSnapshot of ['team-a', 'team-b', null]) assert.equal(canReviewOtherWork(actor, { createdById: 'someone-else', employeeId: 'other-employee', teamIdSnapshot, teamSnapshot: null }), true);
  assert.equal(canReviewOtherWork(actor, { createdById: actor.id, employeeId: 'other', teamIdSnapshot: null, teamSnapshot: null }), false);
  assert.equal(canReviewOtherWork(actor, { createdById: 'someone-else', employeeId: actor.employeeId!, teamIdSnapshot: null, teamSnapshot: null }), false);
  const readOnly = { ...actor, access: resolveAccessContext(modules({ 'other-hours-approval': 'READ' })) };
  assert.equal(otherWorkScope(readOnly).manage, false);
  assert.equal(access.capabilities.includes('ACCOUNT_ADMIN:MANAGE'), false);
});
