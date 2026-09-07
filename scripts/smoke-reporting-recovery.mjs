import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
const base = process.env.REPORT_RECOVERY_QA_BASE || 'http://127.0.0.1:33133';
assert.equal(process.env.REPORT_RECOVERY_QA_ALLOW, 'disposable-reporting-runtime');
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(base).hostname));
const fixture = JSON.parse((await fs.readFile(process.env.REPORT_RECOVERY_QA_FIXTURE, 'utf8')).replace(/^\uFEFF/, ''));
const checks = [], cookies = {};
async function call(actor, path, method = 'GET', data, expected = 200) {
  const response = await fetch(base + path, { method, headers: { ...(cookies[actor] ? { Cookie: cookies[actor] } : {}), ...(method !== 'GET' ? { Origin: base } : {}), ...(data ? { 'Content-Type': 'application/json' } : {}) }, body: data ? JSON.stringify(data) : undefined, redirect: 'manual', signal: AbortSignal.timeout(90_000) });
  const content = await response.text(); let body; try { body = JSON.parse(content); } catch { body = content; }
  assert.ok([expected].flat().includes(response.status), `${actor} ${method} ${path}: ${response.status} ${content.slice(0, 700)}`);
  checks.push({ actor, path: path.split('?')[0], method, status: response.status });
  return { body, response };
}
const recovery = '/api/process-report-submissions';
await call('none', recovery, 'GET', undefined, 401);
for (const actor of Object.keys(fixture.users)) {
  const login = await call(actor, '/api/auth/login', 'POST', { username: fixture.users[actor].username, password: fixture.password });
  cookies[actor] = login.response.headers.get('set-cookie')?.match(/hm_session=[^;]+/)[0]; assert.ok(cookies[actor]);
}
const order = fixture.orders.http, endpoint = `/api/field-report/tickets/${order.publicCode}/completions`;
const command = { stepId: order.stepId, expectedRouteVersion: 0, processedQty: 0, defectQty: 0, reportedUnitQty: 40, reportedDefectUnitQty: 0,
  employeeIds: [fixture.users.operator.employeeId], workDate: fixture.workDate, idempotencyKey: randomUUID(), expectedUserId: fixture.users.operator.id, allowPending: true, source: { kind: 'NATIVE' } };
await call('operator', endpoint, 'POST', { ...command, expectedUserId: fixture.users.other.id }, 409);
const submitted = (await call('operator', endpoint, 'POST', command, 202)).body;
assert.equal(submitted.pending, true); assert.equal(submitted.submission.reasonCode, 'STANDARD_MISMATCH');
const id = submitted.submission.id;
assert.ok(submitted.submission.assigneeUserIds.includes(fixture.users.handler.id));
const repeated = (await call('operator', endpoint, 'POST', command, 202)).body;
assert.equal(repeated.submission.id, id);
await call('operator', endpoint, 'POST', { ...command, reportedUnitQty: 39 }, 409);
await call('other', `${recovery}/${id}/preview`, 'GET', undefined, 404);
assert.ok(!(await call('other', recovery)).body.data.items.some(item => item.id === id));
const inbox = (await call('handler', '/api/notifications?state=pending')).body;
const notification = inbox.notifications.find(item => item.sourceId === id && item.requiresAction);
assert.ok(notification, 'responsible account must receive actionable inbox message');
assert.equal(notification.targetRoute, `/workspace/reporting-recovery?id=${id}`);
await call('handler', `/api/notifications/${notification.id}`, 'PATCH', { completed: true }, 409);
let preview = (await call('handler', `${recovery}/${id}/preview`)).body.data;
assert.equal(preview.canResolve, true); assert.equal(preview.quantityMappingRequired, true);
const resolution = { expectedVersion: preview.submission.version, expectedRouteVersion: preview.routeVersion,
  expectedProfileVersion: preview.standardPreview.published.productTimeProfileVersion, expectedEntryId: preview.standardPreview.published.productTimeEntryId,
  confirmQuantityMapping: true, processedQty: 40, defectQty: 0 };
await call('operator', `${recovery}/${id}/resolve`, 'POST', resolution, 403);
const result = (await call('handler', `${recovery}/${id}/resolve`, 'POST', resolution)).body;
assert.equal(result.pending, false); assert.equal(result.data.status, 'COMPLETED'); assert.ok(result.data.completionId);
assert.equal(result.data.result.autoAssignedLaborMilliseconds, 600000);
const again = (await call('handler', `${recovery}/${id}/resolve`, 'POST', resolution)).body;
assert.equal(again.data.completionId, result.data.completionId);
const originalReplay = (await call('operator', endpoint, 'POST', command)).body;
assert.equal(originalReplay.data.completionId, result.data.completionId);
const completedInbox = (await call('handler', '/api/notifications?state=completed')).body;
const done = completedInbox.notifications.find(item => item.id === notification.id);
assert.ok(done?.completedAt); assert.equal(done.completionKind, 'SOURCE_RESOLVED');
await call('handler', `/api/notifications/${notification.id}`, 'PATCH', { completed: false }, 409);
const receipt = (await call('operator', `${recovery}/${id}/preview`)).body.data;
assert.equal(receipt.submission.status, 'COMPLETED'); assert.equal(receipt.canResolve, false);
await fs.writeFile(process.env.REPORT_RECOVERY_QA_OUTPUT || 'output/reporting-recovery-http.json', JSON.stringify({ passed: true, checks, marker: fixture.marker, submissionId: id, completionId: result.data.completionId, autoAssignedLaborMilliseconds: 600000 }, null, 2));
console.log(JSON.stringify({ passed: true, checks: checks.length, submissionId: id, completionId: result.data.completionId }));
