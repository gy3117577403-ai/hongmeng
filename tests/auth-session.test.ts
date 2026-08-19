import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cookieOptions,
  createToken,
  DEFAULT_SESSION_TTL_SECONDS,
  REMEMBERED_SESSION_TTL_SECONDS,
  verifyToken,
} from '@/lib/auth';

const originalSecret = process.env.SESSION_SECRET;

test.before(() => {
  process.env.SESSION_SECRET = 'test-session-secret-for-auth-tests';
});

test.after(() => {
  if (originalSecret === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = originalSecret;
});

test('default login uses a short-lived session token and a browser-session cookie', () => {
  const now = Math.floor(Date.now() / 1000);
  const token = createToken({ userId: 'u1', username: 'worker', sessionVersion: 3 });
  const session = verifyToken(token);

  assert.ok(session);
  assert.equal(session.userId, 'u1');
  assert.equal(session.username, 'worker');
  assert.equal(session.sessionVersion, 3);
  assert.ok(session.exp >= now + DEFAULT_SESSION_TTL_SECONDS - 1);
  assert.ok(session.exp <= now + DEFAULT_SESSION_TTL_SECONDS + 1);
  assert.equal('maxAge' in cookieOptions(), false);
});

test('remember-device login uses a 30-day persistent cookie without storing a password', () => {
  const now = Math.floor(Date.now() / 1000);
  const token = createToken(
    { userId: 'u2', username: 'planner', sessionVersion: 1 },
    { rememberDevice: true },
  );
  const session = verifyToken(token);
  const options = cookieOptions({ rememberDevice: true });

  assert.ok(session);
  assert.ok(session.exp >= now + REMEMBERED_SESSION_TTL_SECONDS - 1);
  assert.ok(session.exp <= now + REMEMBERED_SESSION_TTL_SECONDS + 1);
  assert.ok('maxAge' in options);
  assert.equal(options.maxAge, REMEMBERED_SESSION_TTL_SECONDS);
  assert.equal(options.httpOnly, true);
});
