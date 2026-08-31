import assert from 'node:assert/strict';
import test from 'node:test';
import { canManageWipWarehouse } from '../lib/wip-access';

function subject(input: {
  laborRole?: string;
  roles?: string[];
  profiles?: string[];
}) {
  return {
    laborRole: input.laborRole || 'EMPLOYEE',
    dailyPlanningRoles: input.roles || [],
    access: {
      effectiveGrants: (input.profiles || []).map((profile, index) => ({
        id: `grant-${index}`,
        profile,
        grantType: 'PRIMARY',
        departmentCode: null,
        scopeKey: 'GLOBAL',
        isActive: true,
        effectiveFrom: null,
        effectiveTo: null,
      })),
    },
  } as Parameters<typeof canManageWipWarehouse>[0];
}

test('only admin, planning, supervisor and team-lead identities may change WIP plans', () => {
  assert.equal(canManageWipWarehouse(subject({ laborRole: 'ADMIN' })), true);
  assert.equal(canManageWipWarehouse(subject({ laborRole: 'TEAM_LEAD' })), true);
  assert.equal(canManageWipWarehouse(subject({ roles: ['WORKSHOP_SUPERVISOR'] })), true);
  assert.equal(canManageWipWarehouse(subject({ roles: ['TEAM_LEADER'] })), true);
  assert.equal(canManageWipWarehouse(subject({ profiles: ['PLANNING_COLLABORATOR'] })), true);
  assert.equal(canManageWipWarehouse(subject({ profiles: ['WORKSHOP_TEAM_LEADER'] })), true);
  assert.equal(canManageWipWarehouse(subject({ profiles: ['FIELD_REPORTER'] })), false);
  assert.equal(canManageWipWarehouse(subject({ profiles: ['PRODUCTION_COLLABORATOR'] })), false);
});
