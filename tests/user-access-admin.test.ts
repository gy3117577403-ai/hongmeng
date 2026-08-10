import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AccessGrantInputError,
  assertEmployeeRebindAllowed,
  parseAccessEndDate,
  parseAccessStartDate,
  primaryTeamGrantSyncPending,
  prepareAccessGrant,
} from '../lib/user-access-admin';

test('date-only acting windows use full Shanghai business days', () => {
  assert.equal(
    parseAccessStartDate('2026-08-10').toISOString(),
    '2026-08-09T16:00:00.000Z',
  );
  assert.equal(
    parseAccessEndDate('2026-08-10')?.toISOString(),
    '2026-08-10T15:59:59.999Z',
  );
});

test('explicit timestamps remain exact', () => {
  assert.equal(
    parseAccessStartDate('2026-08-10T09:15:00.000Z').toISOString(),
    '2026-08-10T09:15:00.000Z',
  );
});

test('acting team-leader grant uses the selected stable production team id', async () => {
  const tx = {
    department: {
      findFirst: async ({ where }: { where: { id: string } }) => (
        where.id === 'department-production'
          ? { id: where.id, code: 'PRODUCTION' }
          : null
      ),
    },
    productionTeam: {
      findFirst: async ({ where }: { where: { id?: string } }) => (
        where.id === 'team-b' ? { id: 'team-b' } : null
      ),
    },
  } as never;

  const grant = await prepareAccessGrant(tx, {
    profileKey: 'WORKSHOP_TEAM_LEADER',
    departmentId: 'department-production',
    targetTeamId: 'team-b',
    grantType: 'ACTING',
    effectiveFrom: '2026-08-10',
    effectiveTo: '2026-08-12',
  }, {
    id: 'employee-a',
    departmentId: 'department-business',
    team: 'A组',
  });

  assert.equal(grant.scopeKey, 'TEAM:team-b');
  assert.equal(grant.departmentId, 'department-production');
});

test('team-leader grant fails closed when the target team cannot be resolved', async () => {
  const tx = {
    department: {
      findFirst: async () => ({ id: 'department-production', code: 'PRODUCTION' }),
    },
    productionTeam: {
      findFirst: async () => null,
    },
  } as never;

  await assert.rejects(
    prepareAccessGrant(tx, {
      profileKey: 'WORKSHOP_TEAM_LEADER',
      departmentId: 'department-production',
      targetTeamId: 'missing-team',
      grantType: 'CONCURRENT',
    }, {
      id: 'employee-a',
      departmentId: 'department-production',
      team: 'A组',
    }),
    /目标班组/,
  );
});

test('employee rebind requires active concurrent and acting grants to be revoked first', () => {
  for (const grantType of ['CONCURRENT', 'ACTING'] as const) {
    assert.throws(
      () => assertEmployeeRebindAllowed('employee-a', 'employee-b', [{
        grantType,
        isActive: true,
      }]),
      error => error instanceof AccessGrantInputError
        && error.status === 409
        && /先撤销/.test(error.message),
    );
  }
});

test('employee rebind proceeds when there is no active additional grant', () => {
  assert.doesNotThrow(() => assertEmployeeRebindAllowed('employee-a', 'employee-b', [
    { grantType: 'PRIMARY', isActive: true },
    { grantType: 'CONCURRENT', isActive: false },
    { grantType: 'ACTING', isActive: false },
  ]));
  assert.doesNotThrow(() => assertEmployeeRebindAllowed('employee-a', 'employee-a', [
    { grantType: 'CONCURRENT', isActive: true },
  ]));
});

test('explicit primary team grant reports HR team drift without rewriting access', () => {
  const teams = [
    { id: 'team-a', code: 'A', name: 'A组', legacyTeamName: '旧A组' },
    { id: 'team-b', code: 'B', name: 'B组', legacyTeamName: null },
  ];
  const grants = [{
    profile: 'WORKSHOP_TEAM_LEADER' as const,
    grantType: 'PRIMARY' as const,
    scopeKey: 'TEAM:team-a',
  }];

  assert.equal(primaryTeamGrantSyncPending('A组', grants, teams), false);
  assert.equal(primaryTeamGrantSyncPending('B组', grants, teams), true);
  assert.equal(grants[0]?.scopeKey, 'TEAM:team-a');
});
