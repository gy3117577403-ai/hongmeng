import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const base = (process.env.NAVIGATION_QA_BASE || '').replace(/\/+$/, '');
const target = new URL(base);
assert.equal(process.env.NAVIGATION_QA_ALLOW, 'disposable-navigation-runtime');
assert.equal(target.hostname, '127.0.0.1');
assert.ok(['3110', '3111'].includes(target.port));
assert.ok(process.env.NAVIGATION_QA_PASSWORD && process.env.EXPECTED_APP_VERSION);
let cookie = '';
const checks = [];
async function request(label, route, { method = 'GET', body, status = 200, authenticated = true } = {}) {
  const response = await fetch(base + route, { method, redirect: 'manual', signal: AbortSignal.timeout(120_000),
    headers: { ...(authenticated && cookie ? { Cookie: cookie } : {}), ...(method !== 'GET' ? { Origin: base, 'Content-Type': 'application/json' } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body) });
  assert.equal(response.status, status, label + ': unexpected status');
  checks.push({ label, status: response.status });
  return response;
}
async function login(username, password) {
  const response = await request('login: ' + username, '/api/auth/login', { method: 'POST', body: { username, password } });
  cookie = (response.headers.get('set-cookie') || '').match(/hm_session=[^;]+/)?.[0] || '';
  assert.ok(cookie);
  return response.json();
}
async function main() {
  const ready = await (await request('PostgreSQL and S3 ready', '/api/ready')).json();
  assert.ok(ready.ok && ready.database.ok && ready.storage.ok);
  assert.equal(ready.app.version, process.env.EXPECTED_APP_VERSION);
  if (process.env.EXPECTED_APP_REVISION) assert.equal(ready.app.revision, process.env.EXPECTED_APP_REVISION);
  await request('employee API requires authentication', '/api/employees', { authenticated: false, status: 401 });
  if (process.env.NAVIGATION_QA_CHECK_BOOTSTRAP === '1') {
    const first = await login(process.env.SEED_ADMIN_USERNAME, process.env.SEED_ADMIN_PASSWORD);
    assert.equal(first.mustChangePassword, true);
    const nextPassword = 'Fresh-Nav-' + randomUUID();
    await request('fresh seed password change', '/api/auth/change-password', { method: 'POST', body: {
      currentPassword: process.env.SEED_ADMIN_PASSWORD, newPassword: nextPassword, confirmPassword: nextPassword,
    } });
    const changed = await login(process.env.SEED_ADMIN_USERNAME, nextPassword);
    assert.equal(changed.mustChangePassword, false);
  }
  await login('navqa', process.env.NAVIGATION_QA_PASSWORD);
  const manifest = await readFile('lib/platform-navigation.ts', 'utf8');
  const routes = [...new Set([...manifest.matchAll(/href: '(\/[^']+)'/g)].map(match => match[1]))];
  for (const route of routes) {
    let pageRoute = route;
    if (route === '/workspace/reports') {
      const redirect = await request('report entry resolves its default branch', route, { status: 307 });
      pageRoute = redirect.headers.get('location') || '';
      assert.match(pageRoute, /^\/workspace\/reports\/[a-z-]+\/[a-z-]+(?:\?|$)/);
    }
    const html = await (await request('navigation route ' + pageRoute, pageRoute)).text();
    assert.ok(html.includes('hm-global-navigation'), route + ': shared navigation missing');
    assert.ok(!html.includes('class="hm-platform-side-nav"'), route + ': legacy flat navigation still rendered');
  }
  for (const route of ['/production?branch=samples', '/weekly-plan-center?branch=samples', '/workspace/warehouse?branch=samples&chooseMode=1', '/workspace/employees?view=directory', '/workspace/quality/internal-risks']) {
    await request('preserved deep link ' + route, route);
  }
  await login('navreader', process.env.NAVIGATION_QA_PASSWORD);
  const reader = await (await request('restricted drawing page', '/drawing-library')).text();
  assert.ok(reader.includes('data-hm-nav-group="technology"'));
  assert.ok(!reader.includes('data-hm-nav-group="system"'));
  assert.ok(!reader.includes('data-hm-nav-group="people"'));
  const protectedPage = await request('restricted HR route', '/workspace/employees', { status: 307 });
  assert.equal(protectedPage.headers.get('location'), '/home');
  const evidence = { verifiedAt: new Date().toISOString(), base, version: ready.app.version, revision: ready.app.revision,
    menuRoutes: routes.length, checks, productionDataTouched: false };
  const output = process.env.NAVIGATION_QA_EVIDENCE || 'artifacts/navigation-v134140/runtime-smoke.json';
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
