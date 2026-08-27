import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import bcrypt from 'bcryptjs';
import { AccessGrantType, AccessProfileKey } from '@prisma/client';
import {
  canAcceptPasswordCredential,
  canIssuePasswordSession,
  canRetainPasswordSession,
  canUseDefaultFieldPassword,
  FIELD_REPORT_DEFAULT_PASSWORD,
  requiresAdminPasswordSetup,
} from '../lib/login-security';
import { prisma } from '../lib/prisma';

const runDatabaseIntegration = process.env.RUN_DB_INTEGRATION === '1';
const NOW = new Date('2026-08-11T08:00:00.000Z');

test('named technical-read migration is unique, idempotent, audited, and preserves weak-password protection',
  { skip: runDatabaseIntegration ? false : 'set RUN_DB_INTEGRATION=1 to use the configured database' },
  async () => {
    const sql = await readFile(new URL('../prisma/migrations/202608280003_zhuyanjun_technical_read_access/migration.sql', import.meta.url), 'utf8');
    const rollback = new Error('rollback isolated named-access migration fixture');
    try {
      await prisma.$transaction(async tx => {
        assert.equal(await tx.employee.count({ where: { name: '朱艳军' } }), 0, 'integration fixture must not replace an existing named employee');
        const employee = await tx.employee.create({ data: { employeeNo: `IT-TECH-${randomUUID().slice(0, 8)}`, name: '朱艳军', position: '储备生', department: '生产部' } });
        const passwordHash = await bcrypt.hash(FIELD_REPORT_DEFAULT_PASSWORD, 10);
        const user = await tx.user.create({ data: {
          username: employee.employeeNo, displayName: employee.name, employeeId: employee.id,
          passwordHash, fieldPasswordOnly: true,
          accessGrants: { create: { profile: 'FIELD_REPORTER', scopeKey: `EMPLOYEE:${employee.id}`, effectiveFrom: NOW } },
        } });
        await tx.$executeRawUnsafe(sql);
        const first = await tx.user.findUniqueOrThrow({ where: { id: user.id }, include: accountInclude });
        assert.deepEqual(first.accessGrants.map(grant => grant.profile).sort(), ['DRAWING_LIBRARY_READER', 'FIELD_REPORTER', 'PRODUCT_TIME_READER']);
        assert.equal(first.passwordHash, passwordHash);
        assert.equal(first.fieldPasswordOnly, true);
        assert.equal(first.sessionVersion, user.sessionVersion + 1);
        assert.equal(requiresAdminPasswordSetup(first), true);
        assert.equal(canIssuePasswordSession(first), false);
        assert.equal(await tx.operationLog.count({ where: { action: 'grant_named_technical_read_access', targetId: user.id } }), 1);
        await tx.$executeRawUnsafe(sql);
        const second = await tx.user.findUniqueOrThrow({ where: { id: user.id }, include: accountInclude });
        assert.equal(second.accessGrants.length, 3);
        assert.equal(second.sessionVersion, first.sessionVersion);

        const duplicate = await tx.employee.create({ data: { employeeNo: `IT-TECH-DUP-${randomUUID().slice(0, 8)}`, name: '朱艳军', position: '储备生', department: '生产部' } });
        const duplicateUser = await tx.user.create({ data: { username: duplicate.employeeNo, displayName: duplicate.name, employeeId: duplicate.id, passwordHash } });
        await tx.$executeRawUnsafe(sql);
        assert.equal(await tx.userAccessGrant.count({ where: { userId: duplicateUser.id } }), 0);
        assert.equal((await tx.user.findUniqueOrThrow({ where: { id: user.id } })).sessionVersion, first.sessionVersion);
        const skip = await tx.operationLog.findFirstOrThrow({ where: { action: 'named_technical_access_skipped', detail: { path: ['matchedAccounts'], equals: 2 } } });
        assert.equal(skip.userId, null, 'migration must be audited as system activity');
        throw rollback;
      }, { timeout: 20_000 });
    } catch (error) { if (error !== rollback) throw error; }
  },
);

const accountInclude = {
  accessGrants: {
    select: {
      profile: true,
      isActive: true,
      effectiveFrom: true,
      effectiveTo: true,
    },
  },
} as const;

test('field password migration preserves existing password hashes', async () => {
  const sql = await readFile(
    new URL('../prisma/migrations/202608110001_field_report_password_login/migration.sql', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(sql, /SET\s+"password_hash"/i);
  assert.match(sql, /ADD COLUMN "field_password_only"/);
  assert.match(sql, /"grant_type"\s*=\s*'PRIMARY'/);
  assert.match(sql, /"session_version"\s*=\s*"session_version"\s*\+\s*1/);
});

test(
  'field password survives migration, resets to 123456, and cannot promote into workbench access',
  { skip: runDatabaseIntegration ? false : 'set RUN_DB_INTEGRATION=1 to use the configured database' },
  async () => {
    const prefix = `ITFIELD-PASSWORD-${Date.now()}-${randomUUID().slice(0, 8)}`;
    let employeeId: string | null = null;
    let userId: string | null = null;
    try {
      const employee = await prisma.employee.create({
        data: {
          employeeNo: `${prefix}-E`,
          name: `${prefix} employee`,
          department: '生产部',
          isActive: true,
          attendanceEnabled: true,
        },
      });
      employeeId = employee.id;
      const originalHash = await bcrypt.hash(FIELD_REPORT_DEFAULT_PASSWORD, 10);
      const created = await prisma.user.create({
        data: {
          username: employee.employeeNo,
          displayName: employee.name,
          passwordHash: originalHash,
          mustChangePassword: false,
          fieldPasswordOnly: true,
          employeeId: employee.id,
          accessGrants: {
            create: {
              profile: AccessProfileKey.FIELD_REPORTER,
              scopeKey: `EMPLOYEE:${employee.id}`,
              grantType: AccessGrantType.PRIMARY,
              effectiveFrom: new Date('2026-08-01T00:00:00.000Z'),
            },
          },
        },
        include: accountInclude,
      });
      userId = created.id;

      assert.equal(created.passwordHash, originalHash, 'migration-compatible state preserves the old hash');
      assert.equal(await bcrypt.compare(FIELD_REPORT_DEFAULT_PASSWORD, created.passwordHash), true);
      assert.equal(canUseDefaultFieldPassword(created, NOW), true);
      assert.equal(canIssuePasswordSession(created, NOW), true);

      const fieldResetHash = await bcrypt.hash(FIELD_REPORT_DEFAULT_PASSWORD, 10);
      const fieldReset = await prisma.user.update({
        where: { id: created.id },
        data: {
          passwordHash: fieldResetHash,
          mustChangePassword: false,
          fieldPasswordOnly: true,
          sessionVersion: { increment: 1 },
          failedLoginAttempts: 0,
          lockedUntil: null,
        },
        include: accountInclude,
      });
      assert.equal(fieldReset.sessionVersion, created.sessionVersion + 1);
      assert.equal(fieldReset.mustChangePassword, false);
      assert.equal(fieldReset.fieldPasswordOnly, true);
      assert.equal(await bcrypt.compare(FIELD_REPORT_DEFAULT_PASSWORD, fieldReset.passwordHash), true);

      const futurePromotionAt = new Date('2026-08-12T00:00:00.000Z');
      await prisma.$transaction([
        prisma.userAccessGrant.create({
          data: {
            userId: created.id,
            profile: AccessProfileKey.WORKSHOP_SUPERVISOR,
            scopeKey: 'WORKSHOP:main',
            grantType: AccessGrantType.CONCURRENT,
            effectiveFrom: futurePromotionAt,
          },
        }),
        prisma.user.update({
          where: { id: created.id },
          data: { sessionVersion: { increment: 1 } },
        }),
      ]);
      const promoted = await prisma.user.findUniqueOrThrow({
        where: { id: created.id },
        include: accountInclude,
      });
      assert.equal(promoted.sessionVersion, fieldReset.sessionVersion + 1);
      assert.equal(requiresAdminPasswordSetup(promoted, NOW), true);
      assert.equal(canUseDefaultFieldPassword(promoted, NOW), false);
      assert.equal(canIssuePasswordSession(promoted, NOW), false);
      assert.equal(canAcceptPasswordCredential(promoted, '123456', true, NOW), false);
      assert.equal(canRetainPasswordSession(promoted, promoted.sessionVersion, NOW), false);
      assert.equal(canRetainPasswordSession(promoted, fieldReset.sessionVersion, NOW), false);

      const strongTemporaryPassword = 'River-Quartz-2026!';
      const strongReset = await prisma.user.update({
        where: { id: created.id },
        data: {
          passwordHash: await bcrypt.hash(strongTemporaryPassword, 10),
          mustChangePassword: true,
          fieldPasswordOnly: false,
          sessionVersion: { increment: 1 },
          failedLoginAttempts: 0,
          lockedUntil: null,
        },
        include: accountInclude,
      });
      assert.equal(strongReset.sessionVersion, promoted.sessionVersion + 1);
      assert.equal(strongReset.fieldPasswordOnly, false);
      assert.equal(strongReset.mustChangePassword, true);
      assert.equal(await bcrypt.compare(strongTemporaryPassword, strongReset.passwordHash), true);
      assert.equal(await bcrypt.compare(FIELD_REPORT_DEFAULT_PASSWORD, strongReset.passwordHash), false);
      assert.equal(requiresAdminPasswordSetup(strongReset, NOW), false);
      assert.equal(canIssuePasswordSession(strongReset, NOW), true);
      assert.equal(canAcceptPasswordCredential(strongReset, '123456', true, NOW), false);
      assert.equal(
        canAcceptPasswordCredential(strongReset, strongTemporaryPassword, true, NOW),
        true,
      );
      assert.equal(
        canIssuePasswordSession(strongReset, new Date('2026-08-12T00:00:00.001Z')),
        true,
      );
    } finally {
      if (userId) await prisma.user.deleteMany({ where: { id: userId } });
      if (employeeId) await prisma.employee.deleteMany({ where: { id: employeeId } });
    }
  },
);
