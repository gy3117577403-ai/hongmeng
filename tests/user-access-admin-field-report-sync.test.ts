import assert from 'node:assert/strict';
import test from 'node:test';
import { AccessProfileKey, Prisma } from '@prisma/client';
import { syncAccountFieldReportGrant } from '@/lib/user-access-admin';

const employee = {
  id: 'employee-1',
  departmentId: 'department-production',
  team: '一组',
  departmentRef: { code: 'PRODUCTION' },
};

test('a FIELD_REPORTER primary grant disables redundant reporting grants', async () => {
  let updateWhere: unknown;
  let creates = 0;
  const tx = {
    userAccessGrant: {
      updateMany: async ({ where }: { where: unknown }) => {
        updateWhere = where;
        return { count: 2 };
      },
      findFirst: async () => null,
      create: async () => { creates += 1; },
    },
  } as unknown as Prisma.TransactionClient;

  const result = await syncAccountFieldReportGrant(tx, {
    userId: 'user-1',
    employee,
    enabled: true,
    primaryProfile: AccessProfileKey.FIELD_REPORTER,
    grantedById: 'admin-1',
  });

  assert.equal(result.created, false);
  assert.equal(result.disabledCount, 2);
  assert.equal(creates, 0);
  assert.deepEqual(updateWhere, {
    userId: 'user-1',
    profile: AccessProfileKey.FIELD_REPORTER,
    grantType: { not: 'PRIMARY' },
    isActive: true,
  });
});

test('dual access creates one concurrent reporting grant beside the workbench primary grant', async () => {
  let createdData: Record<string, unknown> | undefined;
  const tx = {
    department: {
      findFirst: async () => ({ id: 'department-production', code: 'PRODUCTION' }),
    },
    userAccessGrant: {
      findFirst: async () => null,
      updateMany: async () => ({ count: 0 }),
      create: async ({ data }: { data: Record<string, unknown> }) => {
        createdData = data;
        return { id: 'grant-reporting', ...data };
      },
    },
  } as unknown as Prisma.TransactionClient;

  const result = await syncAccountFieldReportGrant(tx, {
    userId: 'user-1',
    employee,
    enabled: true,
    primaryProfile: AccessProfileKey.WORKSHOP_SUPERVISOR,
    departmentId: 'department-production',
    effectiveFrom: '2026-08-12',
    grantedById: 'admin-1',
  });

  assert.equal(result.created, true);
  assert.equal(createdData?.userId, 'user-1');
  assert.equal(createdData?.profile, AccessProfileKey.FIELD_REPORTER);
  assert.equal(createdData?.grantType, 'CONCURRENT');
  assert.equal(createdData?.scopeKey, 'EMPLOYEE:employee-1');
  assert.equal(createdData?.departmentId, 'department-production');
  assert.equal(createdData?.grantedById, 'admin-1');
});

test('enabling reporting is idempotent when a current concurrent grant already exists', async () => {
  let creates = 0;
  let duplicateDisableWhere: unknown;
  const tx = {
    userAccessGrant: {
      findFirst: async () => ({ id: 'grant-retained' }),
      updateMany: async ({ where }: { where: unknown }) => {
        duplicateDisableWhere = where;
        return { count: 1 };
      },
      create: async () => { creates += 1; },
    },
  } as unknown as Prisma.TransactionClient;

  const result = await syncAccountFieldReportGrant(tx, {
    userId: 'user-1',
    employee,
    enabled: true,
    primaryProfile: AccessProfileKey.WORKSHOP_SUPERVISOR,
    departmentId: 'department-production',
    grantedById: 'admin-1',
  });

  assert.equal(result.created, false);
  assert.equal(result.disabledCount, 1);
  assert.equal(creates, 0);
  assert.deepEqual(duplicateDisableWhere, {
    userId: 'user-1',
    profile: AccessProfileKey.FIELD_REPORTER,
    grantType: { not: 'PRIMARY' },
    isActive: true,
    id: { not: 'grant-retained' },
  });
});
