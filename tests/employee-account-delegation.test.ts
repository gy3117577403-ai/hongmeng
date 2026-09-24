import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveAccessContext, type AccessGrant } from '../lib/department-access';
import { canAccessApiRoute } from '../lib/api-route-access';
import { canAuthorizeEmployeeAccounts, canManageEmployeeAccountTarget } from '../lib/employee-account-access';
const grant = (profile: AccessGrant['profile'], scopeKey: string): AccessGrant => ({ profile, scopeKey, grantType: 'CONCURRENT', isActive: true });
const base = [grant('MODULE_ACCESS', 'MODULES:ON'), grant('MODULE_ACCESS', 'MODULE:people:COLLABORATE')];
const delegation = grant('EMPLOYEE_ACCESS_MANAGER', 'EMPLOYEES:BUSINESS_ACCESS');
test('explicit HR delegation opens only business account settings, never global administration', () => {
  const access = resolveAccessContext([...base, delegation]);
  const actor = { id: 'hr', laborRole: 'EMPLOYEE', access };
  assert.equal(canAuthorizeEmployeeAccounts(actor), true);
  assert.equal(access.capabilities.includes('ACCOUNT_ADMIN:MANAGE'), false);
  for (const url of ['/api/users/module-access', '/api/users/sample-library-access']) assert.equal(canAccessApiRoute(access, url, 'POST'), true);
  for (const url of ['/api/users/another/access-grants', '/api/users/another/field-pin', '/api/system/settings']) assert.equal(canAccessApiRoute(access, url, 'POST'), false);
  const target = { id: 'employee', employeeId: 'person', laborRole: 'EMPLOYEE', accessGrants: [] };
  assert.equal(canManageEmployeeAccountTarget(actor, target), true);
  for (const patch of [{ id: 'hr' }, { employeeId: null }, { laborRole: 'ADMIN' }, { accessGrants: [{ profile: 'ADMIN_GLOBAL' }] }, { accessGrants: [{ profile: 'EMPLOYEE_ACCESS_MANAGER' }] }]) assert.equal(canManageEmployeeAccountTarget(actor, { ...target, ...patch }), false);
});
test('HR read-only, absent, inactive and expired delegation cannot grant business access', () => {
  for (const grants of [base, [delegation], [grant('MODULE_ACCESS', 'MODULES:ON'), grant('MODULE_ACCESS', 'MODULE:people:READ'), delegation], [...base, { ...delegation, isActive: false }], [...base, { ...delegation, effectiveTo: '2020-01-01' }]]) {
    const access = resolveAccessContext(grants);
    assert.equal(canAuthorizeEmployeeAccounts({ id: 'hr', laborRole: 'EMPLOYEE', access }), false);
    assert.equal(canAccessApiRoute(access, '/api/users/module-access', 'POST'), false);
  }
});
