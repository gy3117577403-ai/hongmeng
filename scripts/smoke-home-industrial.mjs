/** Authenticated HTTP acceptance for the dedicated home-page test runtime. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const base = (process.env.HOME_QA_BASE || process.env.APP_BASE_URL || '').replace(/\/+$/, '');
const username = process.env.SMOKE_ADMIN_USERNAME || 'homeqa';
const password = process.env.SMOKE_ADMIN_PASSWORD || process.env.HOME_INDUSTRIAL_QA_PASSWORD;
const expectedVersion = process.env.EXPECTED_APP_VERSION;
const expectedRevision = process.env.EXPECTED_APP_REVISION;
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(base).hostname), 'Home smoke must target a loopback runtime');
assert.equal(process.env.HOME_INDUSTRIAL_QA_ALLOW, 'disposable-home-runtime', 'Dedicated runtime mutation guard is required');
assert.ok(password && expectedVersion, 'An isolated test password and exact expected version are required');
let cookie = '';
const checks = [];
const digest = value => createHash('sha256').update(value).digest('hex');

async function request(label, route, { method = 'GET', body, status = 200, authenticated = true } = {}) {
  const response = await fetch(`${base}${route}`, {
    method, redirect: 'manual', signal: AbortSignal.timeout(60_000), headers: {
      ...(authenticated && cookie ? { Cookie: cookie } : {}),
      ...(method !== 'GET' ? { Origin: base, 'Content-Type': 'application/json' } : {}),
    }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  assert.equal(response.status, status, `${label}: unexpected HTTP status`);
  checks.push({ label, status: response.status });
  return response;
}

async function inbox(state = 'pending') {
  return (await request(`${state} notifications`, `/api/notifications?state=${state}&limit=50`)).json();
}

async function main() {
  await request('unauthenticated notification access rejected', '/api/notifications', { status: 401, authenticated: false });
  const health = await (await request('application health', '/api/health')).json();
  assert.equal(health.ok, true);
  const ready = await (await request('database and object storage readiness', '/api/ready')).json();
  assert.equal(ready.database?.ok, true);
  assert.equal(ready.storage?.ok, true);
  assert.equal(ready.app?.version, expectedVersion);
  if (expectedRevision) assert.equal(ready.app?.revision, expectedRevision);
  const login = await request('test account login', '/api/auth/login', { method: 'POST', body: { username, password } });
  cookie = (login.headers.get('set-cookie') || '').match(/hm_session=[^;]+/)?.[0] || '';
  assert.ok(cookie, 'Login did not set a session cookie');
  const html = await (await request('authenticated industrial home', '/home')).text();
  for (const marker of ['hm-home-industrial', '生产协同总览', '本周计划完成率', '未完成消息', '标准动效']) {
    assert.ok(html.includes(marker), `Home page did not contain ${marker}`);
  }
  const styleRoutes = [...new Set([...html.matchAll(/<link\b[^>]*href="([^\"]+\.css(?:\?[^\"]*)?)"[^>]*>/g)]
    .map(match => match[1].replaceAll('&amp;', '&')).filter(route => route.startsWith('/_next/')))];
  assert.ok(styleRoutes.length, 'The home HTML did not include packaged stylesheets');
  const stylesheets = [];
  for (const route of styleRoutes) {
    stylesheets.push(await (await request('packaged home stylesheet', route)).text());
  }
  assert.ok(stylesheets.some(css => css.includes('.hm-home-industrial')), 'The packaged industrial stylesheet is missing');
  const assets = [];
  for (const name of ['industrial-floor-v134136.webp', 'industrial-workcell-v134136.webp']) {
    const response = await request(`packaged ${name}`, `/assets/home/${name}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const sourceBytes = await readFile(`public/assets/home/${name}`);
    assert.equal(digest(bytes), digest(sourceBytes), `Packaged ${name} differs from the accepted source asset`);
    assets.push({ name, bytes: bytes.length, sha256: digest(bytes) });
  }
  const before = await inbox();
  assert.equal(before.ok, true);
  const notification = before.notifications.find(item => item.title === '首页协同总览已就绪');
  assert.ok(notification, 'Run qa-home-industrial-seed.ts to create the guarded test notification');
  const notificationRoute = `/api/notifications/${encodeURIComponent(notification.id)}`;
  await request('mark a message read', notificationRoute, { method: 'PATCH', body: { read: true } });
  const read = await inbox();
  assert.ok(read.notifications.find(item => item.id === notification.id)?.readAt);
  await request('restore original read state', notificationRoute, { method: 'PATCH', body: { read: Boolean(notification.readAt) } });
  await request('complete a test message', notificationRoute, { method: 'PATCH', body: { completed: true } });
  const completed = await inbox('completed');
  assert.ok(completed.notifications.find(item => item.id === notification.id)?.completedAt);
  assert.equal(completed.completedCount, before.completedCount + 1);
  await request('restore the test message', notificationRoute, { method: 'PATCH', body: { completed: false } });
  await request('restore read state after completion', notificationRoute, { method: 'PATCH', body: { read: Boolean(notification.readAt) } });
  const restored = await inbox();
  assert.equal(restored.pendingCount, before.pendingCount);
  assert.equal(restored.completedCount, before.completedCount);
  const evidence = { verifiedAt: new Date().toISOString(), base, version: ready.app.version,
    revision: ready.app.revision, checks, assets, pendingCount: restored.pendingCount,
    completedCount: restored.completedCount, browserAcceptance: 'Visual, touch, reduced-motion and focus interactions are verified separately.' };
  const output = process.env.HOME_QA_EVIDENCE || 'artifacts/home-industrial-v134136/home-runtime-smoke.json';
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify(evidence, null, 2));
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
