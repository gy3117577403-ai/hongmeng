import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { validateNewPassword } from '@/lib/password-policy';

const requireModule = createRequire(import.meta.url);
const seed = requireModule('../prisma/seed.cjs') as {
  requiresSeedAdminPassword(existingAdmin: unknown, resetAdminPassword: boolean): boolean;
  seedAdmin(
    prisma: unknown,
    options: {
      env: Record<string, string | undefined>;
      hashPassword?: (password: string) => Promise<string>;
    },
  ): Promise<{ action: string }>;
  validateSeedAdminPassword(password: string, username?: string | null): string | null;
};

const STRONG_PASSWORD = 'River-Quartz-2026!';

test('seed password validation stays aligned with the application password policy', () => {
  const cases: Array<[password: string, username: string]> = [
    ['', 'admin'],
    ['short', 'admin'],
    ['12345678', 'admin'],
    ['AAAAAAAA', 'admin'],
    ['        ', 'admin'],
    ['Admin-safe-2026!', 'admin'],
    [STRONG_PASSWORD, 'admin'],
    ['normal-pass-2026', 'operator'],
  ];

  for (const [index, [password, username]] of cases.entries()) {
    assert.equal(
      seed.validateSeedAdminPassword(password, username),
      validateNewPassword(password, username),
      `policy mismatch for case ${index}`,
    );
  }
});

test('only first creation and explicit reset require a seed password', () => {
  assert.equal(seed.requiresSeedAdminPassword(null, false), true);
  assert.equal(seed.requiresSeedAdminPassword({ id: 'admin-1' }, true), true);
  assert.equal(seed.requiresSeedAdminPassword({ id: 'admin-1' }, false), false);
});

test('first creation rejects a missing or weak seed password before writing', async () => {
  let transactionCalls = 0;
  let hashCalls = 0;
  const prisma = {
    user: { findUnique: async () => null },
    $transaction: async () => {
      transactionCalls += 1;
      throw new Error('transaction must not run');
    },
  };
  const hashPassword = async () => {
    hashCalls += 1;
    return 'unused';
  };

  await assert.rejects(
    seed.seedAdmin(prisma, {
      env: { SEED_ADMIN_USERNAME: 'admin' },
      hashPassword,
    }),
    /必须通过 SEED_ADMIN_PASSWORD 提供强密码/,
  );
  await assert.rejects(
    seed.seedAdmin(prisma, {
      env: {
        SEED_ADMIN_USERNAME: 'admin',
        SEED_ADMIN_PASSWORD: '12345678',
      },
      hashPassword,
    }),
    /不符合密码策略/,
  );

  assert.equal(hashCalls, 0);
  assert.equal(transactionCalls, 0);
});

test('first creation stores a hash, forces password change and creates active global admin access', async () => {
  let createdUserData: Record<string, unknown> | undefined;
  let createdGrantData: Record<string, unknown> | undefined;
  let hashedPlaintext: string | undefined;
  const prisma = {
    user: { findUnique: async () => null },
    $transaction: async (run: (tx: unknown) => Promise<unknown>) => run({
      user: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          createdUserData = data;
          return {
            id: 'admin-new',
            sessionVersion: 0,
            ...data,
          };
        },
      },
      userAccessGrant: {
        findFirst: async () => null,
        create: async ({ data }: { data: Record<string, unknown> }) => {
          createdGrantData = data;
          return { id: 'grant-new', version: 0, ...data };
        },
      },
    }),
  };

  const result = await seed.seedAdmin(prisma, {
    env: {
      SEED_ADMIN_USERNAME: 'admin',
      SEED_ADMIN_PASSWORD: STRONG_PASSWORD,
    },
    hashPassword: async password => {
      hashedPlaintext = password;
      return 'strong-password-hash';
    },
  });

  assert.equal(result.action, 'created');
  assert.equal(hashedPlaintext, STRONG_PASSWORD);
  assert.equal(createdUserData?.passwordHash, 'strong-password-hash');
  assert.equal(createdUserData?.mustChangePassword, true);
  assert.equal(createdUserData?.accountStatus, 'ACTIVE');
  assert.equal(createdUserData?.isActive, true);
  assert.equal(createdUserData?.laborRole, 'ADMIN');
  assert.equal(createdGrantData?.profile, 'ADMIN_GLOBAL');
  assert.equal(createdGrantData?.grantType, 'PRIMARY');
  assert.equal(createdGrantData?.scopeKey, 'GLOBAL');
  assert.equal(createdGrantData?.isActive, true);
});

test('routine seed preserves a disabled administrator password and account lifecycle', async () => {
  const existingAdmin = {
    id: 'admin-disabled',
    username: 'admin',
    passwordHash: 'existing-hash',
    displayName: '管理员',
    isActive: false,
    accountStatus: 'DISABLED',
    mustChangePassword: false,
    sessionVersion: 7,
    laborRole: 'ADMIN',
    employeeId: 'employee-1',
  };
  let userUpdateData: Record<string, unknown> | undefined;
  let createdGrantData: Record<string, unknown> | undefined;
  let hashCalls = 0;
  const prisma = {
    user: { findUnique: async () => existingAdmin },
    $transaction: async (run: (tx: unknown) => Promise<unknown>) => run({
      user: {
        update: async ({ data }: { data: Record<string, unknown> }) => {
          userUpdateData = data;
          return { ...existingAdmin, ...data };
        },
      },
      userAccessGrant: {
        findFirst: async () => null,
        create: async ({ data }: { data: Record<string, unknown> }) => {
          createdGrantData = data;
          return { id: 'grant-disabled', version: 0, ...data };
        },
      },
    }),
  };

  const result = await seed.seedAdmin(prisma, {
    env: {
      SEED_ADMIN_USERNAME: 'admin',
      SEED_RESET_ADMIN_PASSWORD: 'false',
    },
    hashPassword: async () => {
      hashCalls += 1;
      return 'must-not-be-used';
    },
  });

  assert.equal(result.action, 'confirmed');
  assert.equal(hashCalls, 0);
  assert.deepEqual(userUpdateData, {
    employeeId: null,
  });
  assert.equal(Object.hasOwn(userUpdateData ?? {}, 'passwordHash'), false);
  assert.equal(Object.hasOwn(userUpdateData ?? {}, 'isActive'), false);
  assert.equal(Object.hasOwn(userUpdateData ?? {}, 'accountStatus'), false);
  assert.equal(Object.hasOwn(userUpdateData ?? {}, 'mustChangePassword'), false);
  assert.equal(Object.hasOwn(userUpdateData ?? {}, 'sessionVersion'), false);
  assert.equal(createdGrantData?.profile, 'ADMIN_GLOBAL');
  assert.equal(createdGrantData?.isActive, false);
});

test('routine seed never promotes a non-admin username collision', async () => {
  let transactionCalls = 0;
  const prisma = {
    user: {
      findUnique: async () => ({
        id: 'ordinary-user',
        username: 'admin',
        laborRole: 'EMPLOYEE',
        employeeId: 'employee-1',
      }),
    },
    $transaction: async () => {
      transactionCalls += 1;
      throw new Error('transaction must not run');
    },
  };

  await assert.rejects(
    seed.seedAdmin(prisma, {
      env: {
        SEED_ADMIN_USERNAME: 'admin',
        SEED_RESET_ADMIN_PASSWORD: 'false',
      },
    }),
    /非管理员账号占用/,
  );
  assert.equal(transactionCalls, 0);
});

test('explicit reset reactivates the administrator, rotates sessions and activates the global grant', async () => {
  const existingAdmin = {
    id: 'admin-reset',
    username: 'admin',
    passwordHash: 'existing-hash',
    displayName: '管理员',
    isActive: false,
    accountStatus: 'SUSPENDED',
    mustChangePassword: false,
    sessionVersion: 3,
    laborRole: 'EMPLOYEE',
    employeeId: 'employee-before-admin-reset',
  };
  const existingGrant = {
    id: 'grant-reset',
    userId: existingAdmin.id,
    profile: 'ADMIN_GLOBAL',
    departmentId: null,
    scopeKey: 'GLOBAL',
    grantType: 'PRIMARY',
    effectiveTo: null,
    isActive: false,
    version: 2,
  };
  let userUpdateData: Record<string, unknown> | undefined;
  let grantUpdateData: Record<string, unknown> | undefined;
  const prisma = {
    user: { findUnique: async () => existingAdmin },
    $transaction: async (run: (tx: unknown) => Promise<unknown>) => run({
      user: {
        update: async ({ data }: { data: Record<string, unknown> }) => {
          userUpdateData = data;
          return {
            ...existingAdmin,
            ...data,
            sessionVersion: existingAdmin.sessionVersion + 1,
          };
        },
      },
      userAccessGrant: {
        findFirst: async () => existingGrant,
        update: async ({ data }: { data: Record<string, unknown> }) => {
          grantUpdateData = data;
          return { ...existingGrant, ...data };
        },
      },
    }),
  };

  const result = await seed.seedAdmin(prisma, {
    env: {
      SEED_ADMIN_USERNAME: 'admin',
      SEED_ADMIN_PASSWORD: STRONG_PASSWORD,
      SEED_RESET_ADMIN_PASSWORD: 'true',
    },
    hashPassword: async () => 'replacement-hash',
  });

  assert.equal(result.action, 'reset');
  assert.equal(userUpdateData?.passwordHash, 'replacement-hash');
  assert.equal(userUpdateData?.mustChangePassword, true);
  assert.equal(userUpdateData?.accountStatus, 'ACTIVE');
  assert.equal(userUpdateData?.isActive, true);
  assert.equal(userUpdateData?.laborRole, 'ADMIN');
  assert.equal(userUpdateData?.employeeId, null);
  assert.deepEqual(userUpdateData?.sessionVersion, { increment: 1 });
  assert.deepEqual(grantUpdateData, {
    isActive: true,
    version: { increment: 1 },
  });
});
