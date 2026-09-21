import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

// Read-only acceptance against the release workflow's existing disposable fixture.
assert.equal(process.env.PERFORMANCE_QA_ALLOW, 'disposable-performance-runtime');
const base = process.env.PERFORMANCE_QA_BASE || 'http://127.0.0.1:3000';
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(base).hostname));
const fixture = JSON.parse((await fs.readFile(process.env.PERFORMANCE_QA_FIXTURE, 'utf8')).replace(/^\uFEFF/, ''));
const output = process.env.PERFORMANCE_QA_OUTPUT || 'artifacts/performance-loading/http.json';
const checks = [], responses = {};
let cookie = '';
async function get(url, expected = 200) {
  const start = performance.now();
  const res = await fetch(base + url, { headers: cookie ? { Cookie: cookie } : {}, signal: AbortSignal.timeout(30000) });
  const raw = await res.text();
  assert.equal(res.status, expected, `${url}: ${raw.slice(0, 500)}`);
  const body = JSON.parse(raw);
  checks.push({ url, status: res.status, ms: Math.round((performance.now() - start) * 10) / 10,
    bytes: Buffer.byteLength(raw), serverTiming: res.headers.get('server-timing') });
  if (expected === 200) responses[url] = body;
  return body;
}
await get('/api/workflows?view=list', 401);
const login = await fetch(base + '/api/auth/login', { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: fixture.actor.username, password: fixture.password }) });
assert.equal(login.status, 200);
cookie = login.headers.get('set-cookie')?.match(/hm_session=[^;]+/)?.[0]; assert.ok(cookie);
const first = await get('/api/workflows?view=list&page=1&pageSize=1&entityType=production');
assert.equal(first.items.length, 1);
assert.ok(first.items.every(item => item.steps.length === 0 && item.activities.length === 0));
if (first.pagination.total > 1) {
  const second = await get('/api/workflows?view=list&page=2&pageSize=1&entityType=production');
  assert.notEqual(first.items[0].id, second.items[0].id);
}
const detail = await get('/api/workflows?view=detail&id=' + encodeURIComponent(first.items[0].id));
assert.ok(detail.item.steps.length > 0);
assert.equal(detail.item.currentStep, first.items[0].currentStep);
const empty = await get('/api/workflows?view=list&keyword=__nonexistent_performance_fixture__');
assert.equal(empty.pagination.total, 0);
await get('/api/workflows?view=list&entityType=issue');
await get('/api/workflows?view=detail&id=invalid', 400);
await get('/api/workflows?view=navigation');
const summary = await get('/api/workflows?view=summary');
assert.ok(summary.summary.production >= first.pagination.total);
const weekly = await get('/api/planning/orders?read=week&week=' + fixture.weekStart);
assert.ok(weekly.orders.length > 0);
assert.equal(weekly.productOptions, undefined); assert.equal(weekly.summary, undefined);
assert.ok(weekly.orders.flatMap(order => order.batches).every(batch => batch.weekStartDate === fixture.weekStart));
const all = await get('/api/planning/orders?read=all');
for (const row of weekly.orders) {
  const full = all.orders.find(order => order.id === row.id);
  assert.equal(row.allocatedQuantity, full.allocatedQuantity);
  assert.equal(row.remainingQuantity, full.remainingQuantity);
}
const metadata = await get('/api/planning/orders?read=metadata');
assert.equal(metadata.orders, undefined);
assert.equal(metadata.periods.current.batchCount, weekly.orders.flatMap(order => order.batches).length);
await get('/api/planning/orders?read=options');
await get('/api/planning/orders?read=week&week=2026-02-31', 400);
const board = await get('/api/work-orders/execution?view=board&scope=current&pageSize=2');
assert.ok(board.data.items.length > 0 && board.data.items.length <= 2);
assert.ok(board.data.pagination.snapshotToken);
if (board.data.pagination.total > 2) {
  const next = await get('/api/work-orders/execution?view=board&scope=current&pageSize=2&offset=2&snapshotToken=' + board.data.pagination.snapshotToken);
  assert.equal(new Set([...board.data.items, ...next.data.items].map(item => item.executionKey)).size, board.data.items.length + next.data.items.length);
}
await get('/api/dashboard/production-summary?scope=current');
await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, JSON.stringify({ passed: true, at: new Date().toISOString(), environment: 'disposable release runtime',
  checks, responses }, null, 2));
console.log(JSON.stringify({ passed: true, checks: checks.length, timings: checks.map(({ url, ms, bytes }) => ({ url, ms, bytes })) }));
