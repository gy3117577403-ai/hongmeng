import assert from 'node:assert/strict';
import test from 'node:test';
import { BUSINESS_ACCESS_MODULES, moduleConfiguration, moduleFixtureActionAllowed, parseModulePermissions, type ModulePermissions } from '@/lib/module-permissions';
import { resolveAccessContext, hasCapability, type AccessGrant } from '@/lib/department-access';
import { canAccessAppRoute } from '@/lib/app-route-access';
import { canAccessApiRoute } from '@/lib/api-route-access';
import { PLATFORM_NAVIGATION_GROUPS } from '@/lib/platform-navigation';
import { hasPureFieldReporterAccess } from '@/lib/login-security';
import { canManageEmployeeAccounts, isGlobalAccountManager } from '@/lib/employee-account-access';
const grant = (scopeKey: string, profile: AccessGrant['profile'] = 'MODULE_ACCESS'): AccessGrant => ({ profile, scopeKey, grantType: scopeKey.startsWith('MODULES:') ? 'PRIMARY' : 'CONCURRENT', isActive: true });
function access(permissions: ModulePermissions) { return resolveAccessContext([grant('MODULES:ON'), ...Object.entries(permissions).map(([key, level]) => grant(`MODULE:${key}:${level}`))], { accountActive: true }); }
const endpoints = { production: '/api/sample-tasks', quality: '/api/quality-data', materials: '/api/material-follow-ups', technology: '/api/drawing-library', people: '/api/employees', collaboration: '/api/changes', reports: '/api/reports/overview' };
for (const module of BUSINESS_ACCESS_MODULES) {
  test(`${module.key}: selected module is visible, unselected module pages stay closed`, () => {
    const context = access({ [module.key]: 'READ' });
    for (const group of PLATFORM_NAVIGATION_GROUPS) for (const item of group.items) {
      if (item.href === '/workspace/messages') continue; // personal notification inbox
      assert.equal(canAccessAppRoute(context, item.href), group.id === module.key, item.href);
    }
    assert.equal(canAccessAppRoute(context, '/workspace/reports'), module.key === 'reports');
    assert.equal(canAccessAppRoute(context, '/dashboard?openSettings=1'), false);
  });
  test(`${module.key}: read cannot mutate, even through direct API requests`, () => {
    const context = access({ [module.key]: 'READ' });
    assert.equal(canAccessApiRoute(context, endpoints[module.key], 'GET'), true);
    for (const endpoint of Object.values(endpoints)) for (const method of ['POST', 'PATCH', 'PUT', 'DELETE']) assert.equal(canAccessApiRoute(context, endpoint, method), false, `${method} ${endpoint}`);
    for (const endpoint of ['/api/quality-fixtures', '/api/resource-files/upload', '/api/upload', '/api/work-orders/id/complete', '/api/users/module-access']) assert.equal(canAccessApiRoute(context, endpoint, 'POST'), false, endpoint);
  });
  test(`${module.key}: collaboration keeps system and account authority separate`, () => {
    const context = access({ [module.key]: 'COLLABORATE' });
    assert.equal(canAccessApiRoute(context, endpoints[module.key], 'POST'), module.key !== 'reports');
    assert.equal(hasCapability(context, 'ACCOUNT_ADMIN', 'MANAGE'), false);
    assert.equal(hasCapability(context, 'SYSTEM_CONFIGURATION', 'UPDATE'), false);
    assert.equal(canAccessApiRoute(context, '/api/users/module-access', 'POST'), false);
    assert.equal(canAccessApiRoute(context, '/api/quality/internal-risks/id/purge', 'POST'), false);
    assert.equal(canAccessApiRoute(context, '/api/system/settings', 'PATCH'), false);
  });
}
test('explicit read configuration replaces legacy write and cross-department concurrent grants', () => {
  const context = resolveAccessContext([grant('MODULES:ON'), grant('MODULE:people:READ'), { ...grant('DEPARTMENT:HR', 'DEPARTMENT_FULL'), departmentCode: 'HR' }, grant('GLOBAL', 'PLANNING_COLLABORATOR')], { accountActive: true });
  assert.equal(hasCapability(context, 'HR', 'READ'), true);
  assert.equal(hasCapability(context, 'HR', 'UPDATE'), false);
  assert.equal(hasCapability(context, 'PLANNING', 'READ'), false);
});
test('field-only marker never opens the backend or weakens field-only password checks', () => {
  const grants = [grant('MODULES:OFF'), grant('EMPLOYEE:e', 'FIELD_REPORTER')];
  const context = resolveAccessContext(grants, { accountActive: true });
  assert.equal(canAccessAppRoute(context, '/home'), false);
  assert.equal(canAccessAppRoute(context, '/field-report'), true);
  assert.equal(canAccessApiRoute(context, '/api/employees', 'GET'), false);
  assert.equal(hasPureFieldReporterAccess({ isActive: true, accountStatus: 'ACTIVE', mustChangePassword: false, fieldPasswordOnly: true, lastLoginAt: null, accessGrants: grants.map(g => ({ profile: g.profile, scopeKey: g.scopeKey, isActive: true, effectiveFrom: new Date('2020-01-01'), effectiveTo: null })) }), true);
});
test('unmarked and legacy accounts remain compatible; invalid module inputs fail closed', () => {
  assert.equal(moduleConfiguration([grant('GLOBAL', 'PLANNING_COLLABORATOR')]), null);
  assert.deepEqual(moduleConfiguration([grant('MODULE:people:COLLABORATE')])?.permissions, {});
  for (const value of [null, [], { people: 'ADMIN' }, { system: 'COLLABORATE' }]) assert.throws(() => parseModulePermissions(value));
  const old = resolveAccessContext([grant('GLOBAL', 'PLANNING_COLLABORATOR')], { accountActive: true });
  assert.equal(canAccessAppRoute(old, '/weekly-plan-center'), true);
});
test('HR collaborator can maintain normal accounts without granting permissions', () => {
  const person = { id: 'hr', laborRole: 'EMPLOYEE' as const, access: access({ people: 'COLLABORATE' }) };
  assert.equal(canManageEmployeeAccounts(person), true);
  assert.equal(isGlobalAccountManager(person), false);
  assert.equal(canManageEmployeeAccounts({ ...person, access: access({ people: 'READ' }) }), false);
});
test('shared drawing commands distinguish preparation, review and system reviewer configuration', () => {
  assert.equal(moduleFixtureActionAllowed(access({ technology: 'COLLABORATE' }), 'RESPOND_RETURN'), true);
  assert.equal(moduleFixtureActionAllowed(access({ technology: 'COLLABORATE' }), 'APPROVE'), false);
  assert.equal(moduleFixtureActionAllowed(access({ quality: 'READ' }), 'APPROVE'), false);
  assert.equal(moduleFixtureActionAllowed(access({ quality: 'COLLABORATE' }), 'APPROVE'), true);
  assert.equal(moduleFixtureActionAllowed(access({ quality: 'COLLABORATE' }), 'SAVE_SETTINGS'), false);
});
