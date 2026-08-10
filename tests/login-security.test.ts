import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isLoginLocked,
  LOGIN_LOCK_DURATION_MS,
  MAX_FAILED_LOGIN_ATTEMPTS,
  nextFailedLoginState,
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
