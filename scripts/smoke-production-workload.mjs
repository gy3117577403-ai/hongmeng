import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
assert.equal(process.env.WORKLOAD_QA_ALLOW, 'disposable-workload-runtime');
const base = process.env.WORKLOAD_QA_BASE || 'http://127.0.0.1:3185';
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(base).hostname));
const fixture = JSON.parse((await fs.readFile(process.env.WORKLOAD_QA_FIXTURE, 'utf8')).replace(/^\uFEFF/, ''));
const output = process.env.WORKLOAD_QA_OUTPUT || 'output/production-workload-v185/http.json';
const hour = 3600000, checks = []; let cookie = '';
async function call(url, method = 'GET', data, expected = 200) {
  const res = await fetch(base + url, { method, signal: AbortSignal.timeout(180000), headers: { Origin: base,
    ...(cookie ? { Cookie: cookie } : {}), ...(data ? { 'content-type': 'application/json' } : {}) }, body: data ? JSON.stringify(data) : undefined });
  const raw = await res.text(); let body; try { body = JSON.parse(raw); } catch { body = raw; }
  assert.equal(res.status, expected, `${method} ${url}: ${raw.slice(0, 1500)}`); checks.push({ url, method, status: res.status });
  if (url === '/api/auth/login') cookie = res.headers.get('set-cookie')?.match(/hm_session=[^;]+/)?.[0]; return body;
}
const read = async () => {
  const r = (await call(`/api/production/workload?weekStart=${fixture.weekStart}`)).data;
  const c = r.timeComparison;
  assert.equal(c.executionBasis, r.plan.planned);
  assert.equal(c.currentStandard - c.priorDeducted + c.adjustedReported - c.movedOut + c.estimate + c.wipBasis, c.executionBasis);
  for (const task of r.tasks.filter(t => t.kind !== 'wip')) {
    const v = task.timeComparison;
    assert.equal(v.currentStandard - v.priorDeducted + v.adjustedReported - v.movedOut + v.estimate, v.executionBasis);
    assert.equal(v.executionBasis, task.steps.reduce((n,s) => n+s.planned, 0));
  }
  return r;
};
const task = (report, index) => report.tasks.find(t => t.id === fixture.orders[index].batchId);
const sum = (t, key) => t.steps.reduce((s, step) => s + step[key], 0) / hour;
async function complete(index, step, extra = {}, expected = 200) {
  const order = fixture.orders[index], url = `/api/process-management/routes/${order.routeId}/completions`;
  const ctx = await call(url + '?stepId=' + order.steps[step]);
  const data = { stepId: order.steps[step], processedQty: 10, defectQty: 0, workDate: fixture.date,
    employeeIds: [fixture.employees[0].id], idempotencyKey: randomUUID(), expectedRouteVersion: ctx.data.routeVersion, ...extra };
  return { result: await call(url, 'POST', data, expected), url, data };
}
await call('/api/production/workload', 'GET', undefined, 401);
await call('/api/auth/login', 'POST', { username: fixture.actor.username, password: fixture.password });
await call('/api/production/workload?weekStart=invalid', 'GET', undefined, 400);
const initial = await read();
assert.equal(task(initial, 0).timeComparison.originalPlan, 5 * hour);
assert.equal(task(initial, 0).timeComparison.currentStandard, 3 * hour);
assert.equal(task(initial, 1).timeComparison.originalPlan, 2 * hour);
assert.equal(task(initial, 2).timeComparison.originalPlan, null);
const planOrders = await call('/api/planning/orders');
const planBatches = planOrders.orders.flatMap(o => o.batches);
assert.equal(Number(planBatches.find(b => b.id === fixture.orders[0].batchId).totalMillisecondsSnapshot), task(initial, 0).timeComparison.originalPlan);
for (const employee of fixture.employees) { const p = initial.people.find(p => p.id === employee.id); assert.equal(p.planned, 48 * hour); assert.equal(p.included, true); }
for (const id of fixture.excludedIds) assert.equal(initial.people.find(p => p.id === id).included, false);
assert.equal(sum(task(initial, 0), 'planned'), 3); assert.equal(task(initial, 2).kind, 'carryover');
await complete(2, 0, { workDate: fixture.previousDate, backfillReason: '隔离验收上周工序' });
const legacy = await read(); assert.equal(sum(task(legacy, 2), 'planned'), 2); assert.equal(sum(task(legacy, 2), 'completed'), 0);
assert.equal(task(legacy, 2).timeComparison.priorDeducted, hour);
assert.equal(task(legacy, 2).timeComparison.currentStandard, 3 * hour);
const rear = await complete(0, 1);
const pending = await read(); assert.equal(sum(task(pending, 0), 'completed'), 2); assert.equal(sum(task(pending, 0), 'pending'), 2);
await call(rear.url, 'POST', rear.data); assert.equal(sum(task(await read(), 0), 'completed'), 2);
await complete(0, 0); const matched = await read(); assert.equal(sum(task(matched, 0), 'completed'), 3); assert.equal(sum(task(matched, 0), 'pending'), 0);
await complete(1, 0);
const lot = (await call('/api/wip', 'POST', { action: 'enter', batchId: fixture.orders[1].batchId, quantity: 10,
  reason: '工时分母与接续归属验收', idempotencyKey: randomUUID() })).data;
const allocation = (await call('/api/wip', 'POST', { action: 'schedule', lotId: lot.id, quantity: 10,
  targetWeekStartDate: fixture.weekStart, reason: '本周接续', idempotencyKey: randomUUID() })).data;
const moved = await read(); const own = moved.tasks.filter(t => t.workOrderId === fixture.orders[1].id);
assert.equal(task(moved, 1).timeComparison.originalPlan, 2 * hour);
assert.equal(task(moved, 1).timeComparison.currentStandard, 3 * hour);
assert.equal(task(moved, 1).timeComparison.movedOut, 2 * hour);
assert.equal(own.reduce((s, t) => s + sum(t, 'planned'), 0), 3); assert.equal(own.reduce((s, t) => s + sum(t, 'completed'), 0), 1);
await complete(1, 1, { wipAllocationId: allocation.id, source: { kind: 'WIP', lotId: lot.id, allocationId: allocation.id } });
const wipDone = await read(); assert.equal(wipDone.tasks.filter(t => t.workOrderId === fixture.orders[1].id).reduce((s, t) => s + sum(t, 'completed'), 0), 3);
await complete(2, 1); const final = await read(); assert.equal(sum(task(final, 2), 'completed'), 2); assert.equal(sum(task(final, 2), 'remaining'), 0);
const beforeNonProduction = final.all.completed;
await call('/api/abnormal-time-events', 'POST', { title: '能力验收设备异常', category: 'equipment_tooling', workDate: fixture.date,
  durationMinutes: 30, employeeIds: [fixture.employees[0].id], reason: '验证异常不重复抵扣产品工序' }, 201);
assert.equal((await read()).all.completed, beforeNonProduction);
const summary = (await call('/api/dashboard/production-summary?scope=current')).data;
const operations = (await call('/api/reports/operations?period=week&date=' + fixture.date)).report.weeklyPlan.find(w => w.key === fixture.weekStart);
assert.equal(summary.quantityTotals.completedQty, operations.completedQuantity); assert.equal(summary.planTotals.completedOrders, operations.completedBatches);
assert.equal(summary.quantityTotals.targetQty, operations.plannedQuantity); assert.equal(summary.planTotals.totalOrders, operations.plannedBatches);
await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, JSON.stringify({ passed: true, at: new Date().toISOString(), marker: fixture.marker, checks, initial, final }, null, 2));
console.log(JSON.stringify({ passed: true, checks: checks.length, output }));
