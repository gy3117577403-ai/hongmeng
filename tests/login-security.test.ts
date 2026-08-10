import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canIssuePasswordSession,
  canRetainPasswordSession,
  isLoginLocked,
  LOGIN_LOCK_DURATION_MS,
  MAX_FAILED_LOGIN_ATTEMPTS,
  nextFailedLoginState,
  requiresAdminPasswordSetup,
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

test('FIELD_REPORTER-only account cannot receive an ordinary password session', () => {
  assert.equal(canIssuePasswordSession({
    isActive: true,
    accountStatus: 'ACTIVE',
    mustChangePassword: false,
    lastLoginAt: null,
    accessGrants: [loginGrant('FIELD_REPORTER')],
  }, PASSWORD_LOGIN_NOW), false);
});

test('a mixed account keeps password login through a current non-reporter grant', () => {
  assert.equal(canIssuePasswordSession({
    isActive: true,
    accountStatus: 'ACTIVE',
    mustChangePassword: false,
    lastLoginAt: new Date('2026-08-09T08:00:00.000Z'),
    accessGrants: [
      loginGrant('FIELD_REPORTER'),
      loginGrant('WORKSHOP_TEAM_LEADER'),
    ],
  }, PASSWORD_LOGIN_NOW), true);
});

test('an existing mixed-account session is rejected exactly when its workbench grant expires', () => {
  const account = {
    isActive: true,
    accountStatus: 'ACTIVE',
    mustChangePassword: false,
    lastLoginAt: new Date('2026-08-09T08:00:00.000Z'),
    sessionVersion: 4,
    accessGrants: [
      loginGrant('FIELD_REPORTER'),
      loginGrant('WORKSHOP_TEAM_LEADER', {
        effectiveTo: new Date('2026-08-10T08:15:00.000Z'),
      }),
    ],
  };

  assert.equal(
    canRetainPasswordSession(account, 4, new Date('2026-08-10T08:14:59.999Z')),
    true,
  );
  assert.equal(
    canRetainPasswordSession(account, 4, new Date('2026-08-10T08:15:00.000Z')),
    false,
  );
});

test('current ADMIN_GLOBAL session remains valid while pure FIELD_REPORTER and stale versions fail closed', () => {
  const admin = {
    isActive: true,
    accountStatus: 'ACTIVE',
    mustChangePassword: false,
    lastLoginAt: new Date('2026-08-09T08:00:00.000Z'),
    sessionVersion: 2,
    accessGrants: [loginGrant('ADMIN_GLOBAL')],
  };
  const reporter = {
    ...admin,
    accessGrants: [loginGrant('FIELD_REPORTER')],
  };

  assert.equal(canRetainPasswordSession(admin, 2, PASSWORD_LOGIN_NOW), true);
  assert.equal(canRetainPasswordSession(admin, 1, PASSWORD_LOGIN_NOW), false);
  assert.equal(canRetainPasswordSession(reporter, 2, PASSWORD_LOGIN_NOW), false);
});

test('FIELD_REPORTER promotion requires an administrator password reset before issue or retention', () => {
  const pending = {
    isActive: true,
    accountStatus: 'ACTIVE',
    mustChangePassword: false,
    lastLoginAt: null,
    sessionVersion: 7,
    accessGrants: [
      loginGrant('FIELD_REPORTER', { isActive: false }),
      loginGrant('WORKSHOP_SUPERVISOR'),
    ],
  };

  assert.equal(requiresAdminPasswordSetup(pending, PASSWORD_LOGIN_NOW), true);
  assert.equal(canIssuePasswordSession(pending, PASSWORD_LOGIN_NOW), false);
  assert.equal(canRetainPasswordSession(pending, 7, PASSWORD_LOGIN_NOW), false);

  const reset = { ...pending, mustChangePassword: true };
  assert.equal(requiresAdminPasswordSetup(reset, PASSWORD_LOGIN_NOW), false);
  assert.equal(canIssuePasswordSession(reset, PASSWORD_LOGIN_NOW), true);
  assert.equal(canRetainPasswordSession(reset, 7, PASSWORD_LOGIN_NOW), true);

  const previouslyLoggedIn = {
    ...pending,
    lastLoginAt: new Date('2026-08-09T08:00:00.000Z'),
  };
  assert.equal(requiresAdminPasswordSetup(previouslyLoggedIn, PASSWORD_LOGIN_NOW), false);
  assert.equal(canIssuePasswordSession(previouslyLoggedIn, PASSWORD_LOGIN_NOW), true);
  assert.equal(canRetainPasswordSession(previouslyLoggedIn, 7, PASSWORD_LOGIN_NOW), true);
});

test('inactive, future and expired non-reporter grants cannot unlock password login', () => {
  const accessGrants = [
    loginGrant('FIELD_REPORTER'),
    loginGrant('DEPARTMENT_FULL', { isActive: false }),
    loginGrant('WORKSHOP_SUPERVISOR', {
      effectiveFrom: new Date('2026-08-10T08:00:00.001Z'),
    }),
    loginGrant('ADMIN_GLOBAL', {
      effectiveTo: new Date('2026-08-10T08:00:00.000Z'),
    }),
  ];
  assert.equal(canIssuePasswordSession({
    isActive: true,
    accountStatus: 'ACTIVE',
    mustChangePassword: false,
    lastLoginAt: new Date('2026-08-09T08:00:00.000Z'),
    accessGrants,
  }, PASSWORD_LOGIN_NOW), false);
});

test('account lifecycle and missing explicit workbench access fail closed', () => {
  const accessGrants = [loginGrant('DEPARTMENT_FULL')];
  assert.equal(canIssuePasswordSession({
    isActive: false,
    accountStatus: 'ACTIVE',
    mustChangePassword: false,
    lastLoginAt: new Date('2026-08-09T08:00:00.000Z'),
    accessGrants,
  }, PASSWORD_LOGIN_NOW), false);
  assert.equal(canIssuePasswordSession({
    isActive: true,
    accountStatus: 'SUSPENDED',
    mustChangePassword: false,
    lastLoginAt: new Date('2026-08-09T08:00:00.000Z'),
    accessGrants,
  }, PASSWORD_LOGIN_NOW), false);
  assert.equal(canIssuePasswordSession({
    isActive: true,
    accountStatus: 'ACTIVE',
    mustChangePassword: false,
    lastLoginAt: new Date('2026-08-09T08:00:00.000Z'),
    accessGrants: [],
  }, PASSWORD_LOGIN_NOW), false);
});
