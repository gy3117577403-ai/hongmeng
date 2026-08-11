import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canAcceptPasswordCredential,
  canIssuePasswordSession,
  canRetainPasswordSession,
  canUseDefaultFieldPassword,
  hasPureFieldReporterAccess,
  isLoginLocked,
  LOGIN_LOCK_DURATION_MS,
  MAX_FAILED_LOGIN_ATTEMPTS,
  nextFailedLoginState,
  requiresAdminPasswordSetup,
  type PasswordSessionAccount,
} from '../lib/login-security';

test('account locks after the configured consecutive failure threshold', () => {
  const now = new Date('2026-08-10T08:00:00.000Z');
  const before = nextFailedLoginState(MAX_FAILED_LOGIN_ATTEMPTS - 2, now);
  assert.equal(before.failedLoginAttempts, MAX_FAILED_LOGIN_ATTEMPTS - 1);
  assert.equal(before.lockedUntil, null);

  const locked = nextFailedLoginState(MAX_FAILED_LOGIN_ATTEMPTS - 1, now);
  assert.equal(locked.failedLoginAttempts, MAX_FAILED_LOGIN_ATTEMPTS);
  assert.equal(locked.lockedUntil?.getTime(), now.getTime() + LOGIN_LOCK_DURATION_MS);
});

test('expired lock no longer blocks login', () => {
  const now = new Date('2026-08-10T08:20:00.000Z');
  assert.equal(isLoginLocked(new Date('2026-08-10T08:19:59.999Z'), now), false);
  assert.equal(isLoginLocked(new Date('2026-08-10T08:20:00.001Z'), now), true);
});

const PASSWORD_LOGIN_NOW = new Date('2026-08-10T08:00:00.000Z');

function loginGrant(
  profile: string,
  overrides: Partial<{
    isActive: boolean;
    effectiveFrom: Date;
    effectiveTo: Date | null;
  }> = {},
) {
  return {
    profile,
    isActive: true,
    effectiveFrom: new Date('2026-08-01T00:00:00.000Z'),
    effectiveTo: null,
    ...overrides,
  };
}

function loginAccount(
  overrides: Partial<PasswordSessionAccount> = {},
): PasswordSessionAccount {
  return {
    isActive: true,
    accountStatus: 'ACTIVE',
    mustChangePassword: false,
    fieldPasswordOnly: false,
    lastLoginAt: null,
    accessGrants: [loginGrant('DEPARTMENT_FULL')],
    ...overrides,
  };
}

test('pure FIELD_REPORTER can receive and retain a password session for QR APIs', () => {
  const reporter = {
    ...loginAccount({
      fieldPasswordOnly: true,
      accessGrants: [loginGrant('FIELD_REPORTER')],
    }),
    sessionVersion: 4,
  };

  assert.equal(hasPureFieldReporterAccess(reporter, PASSWORD_LOGIN_NOW), true);
  assert.equal(canUseDefaultFieldPassword(reporter, PASSWORD_LOGIN_NOW), true);
  assert.equal(canIssuePasswordSession(reporter, PASSWORD_LOGIN_NOW), true);
  assert.equal(canRetainPasswordSession(reporter, 4, PASSWORD_LOGIN_NOW), true);
});

test('weak field credential is blocked as soon as a current non-field grant exists', () => {
  const promoted = {
    ...loginAccount({
      fieldPasswordOnly: true,
      accessGrants: [
        loginGrant('FIELD_REPORTER'),
        loginGrant('WORKSHOP_TEAM_LEADER'),
      ],
    }),
    sessionVersion: 7,
  };

  assert.equal(requiresAdminPasswordSetup(promoted, PASSWORD_LOGIN_NOW), true);
  assert.equal(canUseDefaultFieldPassword(promoted, PASSWORD_LOGIN_NOW), false);
  assert.equal(canIssuePasswordSession(promoted, PASSWORD_LOGIN_NOW), false);
  assert.equal(canRetainPasswordSession(promoted, 7, PASSWORD_LOGIN_NOW), false);

  const strongReset = {
    ...promoted,
    fieldPasswordOnly: false,
    mustChangePassword: true,
  };
  assert.equal(requiresAdminPasswordSetup(strongReset, PASSWORD_LOGIN_NOW), false);
  assert.equal(canIssuePasswordSession(strongReset, PASSWORD_LOGIN_NOW), true);
  assert.equal(canRetainPasswordSession(strongReset, 7, PASSWORD_LOGIN_NOW), true);
});

test('future non-field grant immediately blocks a weak field credential', () => {
  const futurePromotion = loginAccount({
    fieldPasswordOnly: true,
    accessGrants: [
      loginGrant('FIELD_REPORTER'),
      loginGrant('WORKSHOP_SUPERVISOR', {
        effectiveFrom: new Date('2026-08-12T00:00:00.000Z'),
      }),
    ],
  });

  assert.equal(hasPureFieldReporterAccess(futurePromotion, PASSWORD_LOGIN_NOW), false);
  assert.equal(requiresAdminPasswordSetup(futurePromotion, PASSWORD_LOGIN_NOW), true);
  assert.equal(canIssuePasswordSession(futurePromotion, PASSWORD_LOGIN_NOW), false);
});

test('inactive and fully expired non-field grants do not block pure field login', () => {
  const reporter = loginAccount({
    fieldPasswordOnly: true,
    accessGrants: [
      loginGrant('FIELD_REPORTER'),
      loginGrant('DEPARTMENT_FULL', { isActive: false }),
      loginGrant('WORKSHOP_TEAM_LEADER', {
        effectiveTo: new Date('2026-08-10T08:00:00.000Z'),
      }),
    ],
  });

  assert.equal(hasPureFieldReporterAccess(reporter, PASSWORD_LOGIN_NOW), true);
  assert.equal(requiresAdminPasswordSetup(reporter, PASSWORD_LOGIN_NOW), false);
  assert.equal(canIssuePasswordSession(reporter, PASSWORD_LOGIN_NOW), true);
});

test('strong mixed account keeps password login through a current non-reporter grant', () => {
  const mixed = loginAccount({
    fieldPasswordOnly: false,
    lastLoginAt: new Date('2026-08-09T08:00:00.000Z'),
    accessGrants: [
      loginGrant('FIELD_REPORTER'),
      loginGrant('WORKSHOP_TEAM_LEADER'),
    ],
  });
  assert.equal(canIssuePasswordSession(mixed, PASSWORD_LOGIN_NOW), true);
  assert.equal(
    canAcceptPasswordCredential(mixed, 'River-Quartz-2026!', true, PASSWORD_LOGIN_NOW),
    true,
  );
  assert.equal(
    canAcceptPasswordCredential(mixed, '123456', true, PASSWORD_LOGIN_NOW),
    false,
    'a matching legacy bcrypt hash must not turn 123456 into a workbench password',
  );
});

test('session version and account lifecycle still fail closed', () => {
  const admin = {
    ...loginAccount({ accessGrants: [loginGrant('ADMIN_GLOBAL')] }),
    sessionVersion: 2,
  };
  assert.equal(canRetainPasswordSession(admin, 2, PASSWORD_LOGIN_NOW), true);
  assert.equal(canRetainPasswordSession(admin, 1, PASSWORD_LOGIN_NOW), false);
  assert.equal(canIssuePasswordSession({ ...admin, isActive: false }, PASSWORD_LOGIN_NOW), false);
  assert.equal(canIssuePasswordSession({ ...admin, accountStatus: 'SUSPENDED' }, PASSWORD_LOGIN_NOW), false);
  assert.equal(canIssuePasswordSession({ ...admin, accessGrants: [] }, PASSWORD_LOGIN_NOW), false);
});
