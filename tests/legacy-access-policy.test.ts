import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveAccessContext } from '../lib/department-access';
import { legacyFallbackGrants } from '../lib/legacy-access-policy';

function legacyProductionLead(team: string) {
  return {
    laborRole: 'TEAM_LEAD' as const,
    employeeId: 'employee-1',
    employee: {
      id: 'employee-1',
      team,
      departmentRef: { code: 'PRODUCTION' },
    },
  };
}

test('legacy production TEAM_LEAD receives field reporting only', () => {
  const grants = legacyFallbackGrants(legacyProductionLead('A组'));
  const access = resolveAccessContext(grants);

  assert.deepEqual(grants, [{
    profile: 'FIELD_REPORTER',
    grantType: 'PRIMARY',
    departmentCode: 'PRODUCTION',
    scopeKey: 'EMPLOYEE:employee-1',
    isActive: true,
  }]);
  assert.deepEqual(access.modules, ['FIELD_REPORT']);
  assert.equal(access.productionScope, 'NONE');
});

test('changing an employee HR team cannot drift legacy permissions', () => {
  const before = legacyFallbackGrants(legacyProductionLead('A组'));
  const after = legacyFallbackGrants(legacyProductionLead('B组'));

  assert.deepEqual(after, before);
  assert.equal(after.some(grant => grant.profile === 'WORKSHOP_TEAM_LEADER'), false);
  assert.equal(after.some(grant => grant.scopeKey.startsWith('TEAM:')), false);
});

test('administrator compatibility remains global', () => {
  assert.deepEqual(legacyFallbackGrants({
    laborRole: 'ADMIN',
    employeeId: null,
    employee: null,
  }), [{
    profile: 'ADMIN_GLOBAL',
    grantType: 'PRIMARY',
    scopeKey: 'GLOBAL',
    isActive: true,
  }]);
});
