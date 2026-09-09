import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

assert.equal(process.env.DRAWING_LIBRARY_QA_ALLOW, 'disposable-drawing-runtime');
const base = process.env.DRAWING_LIBRARY_QA_BASE;
const target = new URL(base);
const database = new URL(process.env.DATABASE_URL);
assert.equal(target.origin, base);
assert.equal(target.protocol, 'http:');
assert.equal(target.hostname, '127.0.0.1');
assert.ok(['3116', '3117'].includes(target.port));
assert.equal(database.hostname, '127.0.0.1');
assert.equal(database.port, target.port === '3116' ? '55446' : '55447');
assert.equal(database.pathname, '/hongmeng_drawing_library_v134146_release' + (target.port === '3117' ? '_second' : ''));
const username = process.env.SEED_ADMIN_USERNAME;
const originalPassword = process.env.SEED_ADMIN_PASSWORD;
assert.ok(username && originalPassword);
const checks = [];
let cookie = '';
async function request(label, route, { method = 'GET', body, status = 200, authenticated = true } = {}) {
  const response = await fetch(base + route, {
    method, redirect: 'manual', signal: AbortSignal.timeout(60000),
    headers: { ...(authenticated && cookie ? { Cookie: cookie } : {}), ...(method !== 'GET' ? { Origin: base, 'Content-Type': 'application/json' } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  assert.equal(response.status, status, label + ': unexpected HTTP status');
  const data = await response.json();
  checks.push({ label, status: response.status });
  return { data, response };
}
async function login(password) {
  const result = await request('bootstrap login', '/api/auth/login', { method: 'POST', authenticated: false, body: { username, password } });
  cookie = result.response.headers.get('set-cookie')?.match(/hm_session=[^;]+/)?.[0] || '';
  assert.ok(cookie);
  return result.data;
}
const initial = await login(originalPassword);
assert.equal(initial.mustChangePassword, true);
await request('fresh seed is blocked until password change', '/api/drawing-library', { status: 403 });
const nextPassword = 'Drawing-Fresh-' + randomUUID();
await request('fresh seed changes password', '/api/auth/change-password', {
  method: 'POST', body: { currentPassword: originalPassword, newPassword: nextPassword, confirmPassword: nextPassword },
});
await request('password change invalidates previous session', '/api/drawing-library', { status: 403 });
await request('original password no longer works', '/api/auth/login', {
  method: 'POST', status: 401, authenticated: false, body: { username, password: originalPassword },
});
const updated = await login(nextPassword);
assert.equal(updated.mustChangePassword, false);
await request('fresh seed can read library after re-login', '/api/drawing-library');
const output = `artifacts/drawing-library-v134146/bootstrap-${target.port === '3116' ? 'primary' : 'second'}.json`;
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, JSON.stringify({ verifiedAt: new Date().toISOString(), base, checks, passed: checks.length, productionChanged: false }, null, 2));
console.log(JSON.stringify({ bootstrapChecks: checks.length, output }));
