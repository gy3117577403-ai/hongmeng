import assert from 'node:assert/strict';
import test from 'node:test';
import type { Prisma } from '@prisma/client';
import { resolveAccessContext } from '../lib/department-access';
import { canManageEmployeeAccounts, canManageEmployeeAccountTarget, employeeAccountUpdateFieldsAllowed } from '../lib/employee-account-access';
import {
  AccessGrantInputError,
  assertEmployeeRebindAllowed,
  parseAccessEndDate,
  parseAccessStartDate,
  primaryTeamGrantSyncPending,
  prepareAccessGrant,
  reconcileFieldReportPinEligibility,
  requiresAdminPasswordSetup,
  serializeAdminUser,
} from '../lib/user-access-admin';

test('HR can manage employee accounts without gaining system administration or access to administrator credentials', () => {
  const actor = { id: 'hr-user', laborRole: 'EMPLOYEE', access: resolveAccessContext([{
    profile: 'DEPARTMENT_FULL', departmentCode: 'HR', grantType: 'PRIMARY', scopeKey: 'DEPARTMENT:HR',
  }]) };
  assert.equal(canManageEmployeeAccounts(actor), true);
  assert.equal(actor.access.capabilities.includes('ACCOUNT_ADMIN:MANAGE'), false);
  const target = { id: 'employee-user', employeeId: 'employee-1', laborRole: 'EMPLOYEE', accessGrants: [{ profile: 'FIELD_REPORTER' }] };
  assert.equal(canManageEmployeeAccountTarget(actor, target), true);
  assert.equal(canManageEmployeeAccountTarget(actor, { ...target, id: actor.id }), false);
  assert.equal(canManageEmployeeAccountTarget(actor, { ...target, employeeId: null }), false);
  assert.equal(canManageEmployeeAccountTarget(actor, { ...target, laborRole: 'ADMIN' }), false);
  assert.equal(canManageEmployeeAccountTarget(actor, { ...target, accessGrants: [{ profile: 'ADMIN_GLOBAL' }] }), false);
  const trainer = { ...actor, access: resolveAccessContext([{ profile: 'TRAINING_COLLABORATOR', grantType: 'CONCURRENT', scopeKey: 'GLOBAL:TRAINING' }]) };
  assert.equal(canManageEmployeeAccounts(trainer), false);
  assert.equal(canManageEmployeeAccountTarget(trainer, target), false);
  assert.equal(employeeAccountUpdateFieldsAllowed({ displayName: '姓名', accountStatus: 'DISABLED' }), true);
  for (const key of ['profileKey', 'employeeId', 'laborRole', 'password', 'fieldReportEnabled', 'departmentId']) {
    assert.equal(employeeAccountUpdateFieldsAllowed({ displayName: '姓名', [key]: 'new-value' }), false);
  }
});

test('temporary-password FIELD_REPORTER promotion stays pending until administrator reset', () => {
  const now = new Date('2026-08-10T08:00:00.000Z');
  const grants = [
    { profile: 'FIELD_REPORTER' as const, isActive: false, effectiveFrom: new Date('2026-08-01T00:00:00.000Z'), effectiveTo: null },
    { profile: 'WORKSHOP_TEAM_LEADER' as const, isActive: true, effectiveFrom: new Date('2026-08-01T00:00:00.000Z'), effectiveTo: null },
  ];
  assert.equal(requiresAdminPasswordSetup({
    isActive: true,
    accountStatus: 'ACTIVE',
    mustChangePassword: false,
    fieldPasswordOnly: true,
    lastLoginAt: null,
    accessGrants: grants,
  }, now), true);

  // A strong administrator reset clears the field-only credential marker.
  assert.equal(requiresAdminPasswordSetup({
    isActive: true,
    accountStatus: 'ACTIVE',
    mustChangePassword: true,
    fieldPasswordOnly: false,
    lastLoginAt: null,
    accessGrants: grants,
  }, now), false);
});

test('field-only and expired workbench grants do not claim password setup is pending', () => {
  const now = new Date('2026-08-10T08:00:00.000Z');
  assert.equal(requiresAdminPasswordSetup({
    isActive: true,
    accountStatus: 'ACTIVE',
    mustChangePassword: false,
    fieldPasswordOnly: true,
    lastLoginAt: null,
    accessGrants: [{ profile: 'FIELD_REPORTER', isActive: true, effectiveFrom: new Date('2026-08-01T00:00:00.000Z'), effectiveTo: null }],
  }, now), false);
  assert.equal(requiresAdminPasswordSetup({
    isActive: true,
    accountStatus: 'ACTIVE',
    mustChangePassword: false,
    fieldPasswordOnly: true,
    lastLoginAt: null,
    accessGrants: [
      { profile: 'FIELD_REPORTER', isActive: true, effectiveFrom: new Date('2026-08-01T00:00:00.000Z'), effectiveTo: null },
      { profile: 'DEPARTMENT_FULL', isActive: true, effectiveFrom: new Date('2026-08-01T00:00:00.000Z'), effectiveTo: now },
    ],
  }, now), false);
});

test('account serializer withholds workbench-ready status until password reset', () => {
  const now = new Date('2026-08-10T08:00:00.000Z');
  const baseGrant = {
    id: 'grant-field-history',
    userId: 'user-field-promoted',
    departmentId: null,
    scopeKey: 'EMPLOYEE:employee-1',
    grantType: 'PRIMARY',
    effectiveFrom: new Date('2026-08-01T00:00:00.000Z'),
    effectiveTo: null,
    isActive: false,
    grantedById: 'admin-1',
    version: 1,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: now,
    department: null,
  } as const;
  const user = {
    id: 'user-field-promoted',
    username: '0003',
    displayName: '张三',
    isActive: true,
    accountStatus: 'ACTIVE',
    mustChangePassword: false,
    fieldPasswordOnly: true,
    lastLoginAt: null,
    laborRole: 'TEAM_LEAD',
    employeeId: 'employee-1',
    employee: null,
    accessGrants: [
      { ...baseGrant, profile: 'FIELD_REPORTER' },
      {
        ...baseGrant,
        id: 'grant-supervisor',
        profile: 'WORKSHOP_SUPERVISOR',
        scopeKey: 'WORKSHOP:workshop-1',
        isActive: true,
      },
    ],
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: now,
  };

  const pending = serializeAdminUser(user as never, { now });
  assert.equal(pending.passwordSetupRequired, true);
  assert.equal(pending.accessMethods.workbench, false);

  const reset = serializeAdminUser({
    ...user,
    mustChangePassword: true,
    fieldPasswordOnly: false,
  } as never, { now });
  assert.equal(reset.passwordSetupRequired, false);
  assert.equal(reset.accessMethods.workbench, true);
  assert.equal(reset.mustChangePassword, true);
});

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

test('process department uses the dedicated collaboration template', async () => {
  const tx = {
    department: {
      findFirst: async ({ where }: { where: { id: string } }) => (
        where.id === 'department-process'
          ? { id: where.id, code: 'PROCESS' }
          : where.id === 'department-quality'
            ? { id: where.id, code: 'QUALITY' }
            : null
      ),
    },
  } as never;
  const employee = {
    id: 'employee-process',
    departmentId: 'department-process',
    team: null,
  };

  const grant = await prepareAccessGrant(tx, {
    profileKey: 'PROCESS_SPECIALIST',
    departmentId: 'department-process',
    grantType: 'PRIMARY',
  }, employee);
  assert.equal(grant.profile, 'PROCESS_SPECIALIST');
  assert.equal(grant.scopeKey, 'DEPARTMENT:PROCESS');

  await assert.rejects(
    prepareAccessGrant(tx, {
      profileKey: 'DEPARTMENT_FULL',
      departmentId: 'department-process',
      grantType: 'PRIMARY',
    }, employee),
    /专用权限模板/,
  );
  await assert.rejects(
    prepareAccessGrant(tx, {
      profileKey: 'PROCESS_SPECIALIST',
      departmentId: 'department-quality',
      grantType: 'PRIMARY',
    }, employee),
    /只能绑定工艺部/,
  );
});

test('functional role grants resolve stable global scopes and quality department validation', async () => {
  const tx = {
    department: {
      findFirst: async ({ where }: { where: { id: string } }) => (
        where.id === 'department-quality'
          ? { id: where.id, code: 'QUALITY' }
          : where.id === 'department-hr'
            ? { id: where.id, code: 'HR' }
            : null
      ),
    },
  } as never;
  const employee = { id: 'employee-1', departmentId: 'department-hr', team: null };

  const report = await prepareAccessGrant(tx, {
    profileKey: 'REPORT_PEOPLE_READER',
    departmentId: 'department-hr',
    grantType: 'CONCURRENT',
  }, employee);
  assert.equal(report.scopeKey, 'GLOBAL:REPORT_PEOPLE');

  const quality = await prepareAccessGrant(tx, {
    profileKey: 'QUALITY_REVIEWER',
    departmentId: 'department-quality',
    grantType: 'CONCURRENT',
  }, employee);
  assert.equal(quality.scopeKey, 'GLOBAL:QUALITY_REVIEW');

  await assert.rejects(
    prepareAccessGrant(tx, {
      profileKey: 'QUALITY_REVIEWER',
      departmentId: 'department-hr',
      grantType: 'CONCURRENT',
    }, employee),
    /质量部门/,
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

test('PIN lifecycle remains active while another effective exact FIELD_REPORTER grant exists', async () => {
  const now = new Date('2026-08-10T08:00:00.000Z');
  let eligibilityQuery: unknown;
  let writeCalled = false;
  const tx = {
    employee: {
      findFirst: async (args: unknown) => {
        eligibilityQuery = args;
        return {
          user: {
            isActive: true,
            accountStatus: 'ACTIVE',
            accessGrants: [{ id: 'remaining-field-reporter-grant' }],
          },
        };
      },
    },
    employeeFieldReportPinCredential: {
      updateMany: async () => {
        writeCalled = true;
        return { count: 0 };
      },
    },
    fieldReportPinSession: {
      updateMany: async () => {
        writeCalled = true;
        return { count: 0 };
      },
    },
  } as unknown as Pick<
    Prisma.TransactionClient,
    'employee' | 'employeeFieldReportPinCredential' | 'fieldReportPinSession'
  >;

  assert.deepEqual(
    await reconcileFieldReportPinEligibility(tx, 'employee-1', { now, resetById: 'admin-1' }),
    { eligible: true, pinCredentialDisabled: false, pinSessionsRevoked: 0 },
  );
  assert.equal(writeCalled, false);
  assert.deepEqual(eligibilityQuery, {
    where: {
      id: 'employee-1',
      isActive: true,
      attendanceEnabled: true,
      department: { in: ['生产部', '生产'] },
    },
    select: {
      user: {
        select: {
          isActive: true,
          accountStatus: true,
          accessGrants: {
            where: {
              profile: 'FIELD_REPORTER',
              scopeKey: 'EMPLOYEE:employee-1',
              isActive: true,
              effectiveFrom: { lte: now },
              OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
            },
            select: { id: true },
            take: 1,
          },
        },
      },
    },
  });
});

test('PIN lifecycle disables credential and revokes sessions after final exact grant is lost', async () => {
  const now = new Date('2026-08-10T08:00:00.000Z');
  let credentialUpdate: unknown;
  let sessionUpdate: unknown;
  const tx = {
    employee: {
      findFirst: async () => ({
        user: {
          isActive: true,
          accountStatus: 'ACTIVE',
          accessGrants: [],
        },
      }),
    },
    employeeFieldReportPinCredential: {
      updateMany: async (args: unknown) => {
        credentialUpdate = args;
        return { count: 1 };
      },
    },
    fieldReportPinSession: {
      updateMany: async (args: unknown) => {
        sessionUpdate = args;
        return { count: 2 };
      },
    },
  } as unknown as Pick<
    Prisma.TransactionClient,
    'employee' | 'employeeFieldReportPinCredential' | 'fieldReportPinSession'
  >;

  assert.deepEqual(
    await reconcileFieldReportPinEligibility(tx, 'employee-1', { now, resetById: 'admin-1' }),
    { eligible: false, pinCredentialDisabled: true, pinSessionsRevoked: 2 },
  );
  assert.deepEqual(credentialUpdate, {
    where: { employeeId: 'employee-1', isActive: true },
    data: {
      isActive: false,
      credentialVersion: { increment: 1 },
      failedAttempts: 0,
      lockedUntil: null,
      resetAt: now,
      resetById: 'admin-1',
    },
  });
  assert.deepEqual(sessionUpdate, {
    where: { employeeId: 'employee-1', consumedAt: null, revokedAt: null },
    data: { revokedAt: now },
  });
});

test('PIN lifecycle disables an otherwise authorized PIN when the linked account is disabled', async () => {
  let writes = 0;
  const tx = {
    employee: {
      findFirst: async () => ({
        user: {
          isActive: false,
          accountStatus: 'DISABLED',
          accessGrants: [{ id: 'field-reporter-grant' }],
        },
      }),
    },
    employeeFieldReportPinCredential: {
      updateMany: async () => {
        writes += 1;
        return { count: 1 };
      },
    },
    fieldReportPinSession: {
      updateMany: async () => {
        writes += 1;
        return { count: 1 };
      },
    },
  } as unknown as Pick<
    Prisma.TransactionClient,
    'employee' | 'employeeFieldReportPinCredential' | 'fieldReportPinSession'
  >;

  const result = await reconcileFieldReportPinEligibility(tx, 'employee-1');
  assert.equal(result.eligible, false);
  assert.equal(result.pinCredentialDisabled, true);
  assert.equal(result.pinSessionsRevoked, 1);
  assert.equal(writes, 2);
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
