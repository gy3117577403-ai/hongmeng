import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';

const base = (process.env.HOURS_QA_BASE || '').replace(/\/+$/, '');
const target = new URL(base);
assert.equal(process.env.HOURS_QA_ALLOW, 'disposable-hours-runtime');
assert.equal(target.protocol, 'http:');
assert.equal(target.hostname, '127.0.0.1');
assert.equal(target.origin, base, 'QA base must be an origin without credentials, a path or query');
assert.ok(['3112', '3113', '3114'].includes(target.port));
if (target.port === '3114') assert.ok(process.env.HOURS_QA_FIXTURE_FILE, 'Second runtime requires its own fixture file');
const fixtureFile = process.env.HOURS_QA_FIXTURE_FILE || '.docker/employee-hours-fixture.json';
const fixture = JSON.parse((await readFile(fixtureFile, 'utf8')).replace(/^\uFEFF/, ''));
if (fixture.runtime || target.port === '3114') {
  assert.equal(fixture.runtime?.base, base, 'Fixture belongs to a different HTTP runtime');
  assert.equal(fixture.runtime.databasePort, target.port === '3114' ? '55443' : '55442');
  if (target.port === '3114') assert.equal(fixture.runtime.database, 'hongmeng_employee_hours_v134142_release_second');
}
const hour = 3_600_000;
const checks = [];
let cookie = '';
async function request(label, route, { method = 'GET', body, status = 200, authenticated = true } = {}) {
  const response = await fetch(base + route, { method, redirect: 'manual', signal: AbortSignal.timeout(120_000),
    headers: { ...(authenticated && cookie ? { Cookie: cookie } : {}), ...(method !== 'GET' ? { Origin: base, 'Content-Type': 'application/json' } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body) });
  const content = await response.text();
  assert.equal(response.status, status, `${label}: HTTP ${response.status} ${content.slice(0, 350)}`);
  let data;
  try { data = JSON.parse(content); } catch { data = content; }
  checks.push({ label, status: response.status });
  return { data, response };
}
async function login(username, password) {
  assert.ok(username && password, 'Login credentials must be supplied through the private environment');
  const result = await request('login ' + username, '/api/auth/login', { method: 'POST', body: { username, password }, authenticated: false });
  cookie = result.response.headers.get('set-cookie')?.match(/hm_session=[^;]+/)?.[0] || '';
  assert.ok(cookie);
  return result.data;
}
async function employee(date, period = 'today', employeeId) {
  const params = new URLSearchParams({ period, date, ...(employeeId ? { employeeId } : {}) });
  return (await request('employee hours ' + period + ' ' + date, '/api/reports/employee-attainment?' + params)).data.report;
}
const rowBy = (report, index) => {
  const row = report.rows.find(item => item.employee.id === fixture.employees[index].id);
  assert.ok(row, 'employee with reporting facts must remain visible');
  return row;
};
function assertHours(row, { attendance, completed, abnormal = 0, rate }) {
  assert.equal(row.attendanceMilliseconds, attendance * hour, 'attendance including overtime once');
  assert.equal(row.standardLaborMilliseconds, completed * hour, 'completed hours on original date');
  assert.equal(row.exemptAbnormalMilliseconds, abnormal * hour, 'recognized personal loss');
  assert.equal(row.attainmentBasisPoints, rate, 'new weighted attainment formula');
  assert.equal(row.unmatchedStandardLaborMilliseconds, 0, 'no unmatched labor bucket');
}
async function main() {
  const ready = (await request('database and object storage readiness', '/api/ready')).data;
  assert.ok(ready.ok && ready.database.ok && ready.storage.ok);
  assert.equal(ready.app.version, process.env.EXPECTED_APP_VERSION);
  if (process.env.EXPECTED_APP_REVISION) assert.equal(ready.app.revision, process.env.EXPECTED_APP_REVISION);
  await request('reports require authentication', '/api/reports/employee-attainment', { status: 401, authenticated: false });
  if (process.env.HOURS_QA_CHECK_BOOTSTRAP === '1') {
    const initial = await login(process.env.SEED_ADMIN_USERNAME, process.env.SEED_ADMIN_PASSWORD);
    assert.equal(initial.mustChangePassword, true);
    await request('fresh seed cannot read reports before changing password', '/api/reports/employee-attainment', { status: 401 });
    const nextPassword = 'Hours-Fresh-' + randomUUID();
    await request('fresh seed must change password', '/api/auth/change-password', { method: 'POST', body: {
      currentPassword: process.env.SEED_ADMIN_PASSWORD, newPassword: nextPassword, confirmPassword: nextPassword,
    } });
    await request('password change invalidates the previous session', '/api/reports/employee-attainment', { status: 401 });
    await request('old bootstrap password no longer works', '/api/auth/login', { method: 'POST', status: 401, authenticated: false,
      body: { username: process.env.SEED_ADMIN_USERNAME, password: process.env.SEED_ADMIN_PASSWORD } });
    const updated = await login(process.env.SEED_ADMIN_USERNAME, nextPassword);
    assert.equal(updated.mustChangePassword, false);
  }
  await login(fixture.actor.username, process.env.HOURS_QA_PASSWORD);
  const first = await employee(fixture.yesterday);
  assertHours(rowBy(first, 0), { attendance: 10, completed: 8, abnormal: 1, rate: 8950 });
  assert.equal(rowBy(first, 0).regularAttendanceMilliseconds, 8 * hour);
  assert.equal(rowBy(first, 0).recognizedOvertimeMilliseconds, 2 * hour);
  assertHours(rowBy(first, 1), { attendance: 8, completed: 2, rate: 2500 });
  const second = await employee(fixture.today);
  assertHours(rowBy(second, 0), { attendance: 5, completed: 6, rate: 12000 });
  assertHours(rowBy(second, 1), { attendance: 8, completed: 5, rate: 6250 });
  assertHours(rowBy(second, 2), { attendance: 0, completed: 2, rate: null });
  assert.equal(second.summary.attainmentBasisPoints, null, 'missing attendance must not produce a misleading overall rate');
  assert.equal(second.summary.standardLaborMilliseconds, 13 * hour);
  const params = new URLSearchParams({ period: 'custom', date: fixture.today, startDate: fixture.yesterday, endDate: fixture.today });
  const combined = (await request('custom two-day employee report', '/api/reports/employee-attainment?' + params)).data.report;
  assertHours(rowBy(combined, 0), { attendance: 15, completed: 14, abnormal: 1, rate: 9967 });
  assertHours(rowBy(combined, 1), { attendance: 16, completed: 7, rate: 4375 });
  const operations = (await request('same-range matrix and team report', '/api/reports/operations?' + params)).data.report;
  for (const row of combined.rows) {
    const matrix = operations.employeeMatrix.find(item => item.employee.id === row.employee.id);
    assert.ok(matrix);
    for (const key of ['attendanceMilliseconds', 'standardLaborMilliseconds', 'exemptAbnormalMilliseconds', 'attainmentBasisPoints']) {
      assert.equal(matrix[key], row[key], `matrix and individual match: ${key}`);
    }
  }
  assert.equal(operations.summary.attainmentBasisPoints, combined.summary.attainmentBasisPoints);
  assert.equal(operations.summary.standardLaborMilliseconds, combined.summary.standardLaborMilliseconds);
  assert.equal(operations.teamMonthly[0].standardLaborMilliseconds, combined.summary.standardLaborMilliseconds);
  for (const period of ['week', 'month']) {
    const report = await employee(fixture.today, period);
    const op = (await request(period + ' matrix consistency', '/api/reports/operations?' + new URLSearchParams({ date: fixture.today, period }))).data.report;
    for (const key of ['attendanceMilliseconds', 'standardLaborMilliseconds', 'exemptAbnormalMilliseconds', 'attainmentBasisPoints']) assert.equal(op.summary[key], report.summary[key]);
  }
  const ticketRoute = `/api/field-report/tickets/${fixture.orders.browser.publicCode}`;
  await login(fixture.operator.username, process.env.HOURS_QA_PASSWORD);
  const ticket = (await request('load live QR context', ticketRoute)).data.data;
  assert.equal(ticket.ticket.access.canReport, true);
  const command = { stepId: fixture.orders.browser.stepId, processedQty: 2, defectQty: 0, workDate: fixture.today,
    employeeIds: [fixture.employees[1].id], expectedUserId: fixture.operator.id, expectedRouteVersion: ticket.ticket.route.version,
    idempotencyKey: randomUUID(), source: { kind: 'NATIVE' } };
  const result = (await request('QR submission immediately credits pending predecessor work', ticketRoute + '/completions', { method: 'POST', body: command })).data;
  assert.equal(result.pending, undefined);
  assert.equal(result.data.autoAssignedLaborMilliseconds, 2 * hour);
  assert.equal(result.data.coverageStatus, 'pending');
  const repeated = (await request('identical QR retry is idempotent', ticketRoute + '/completions', { method: 'POST', body: command })).data;
  assert.equal(repeated.data.completionId, result.data.completionId);
  await login(fixture.actor.username, process.env.HOURS_QA_PASSWORD);
  assertHours(rowBy(await employee(fixture.today), 1), { attendance: 8, completed: 7, rate: 8750 });
  const withdrawal = `/api/process-management/routes/${fixture.orders.browser.routeId}/completions/${result.data.completionId}/withdraw`;
  const preview = (await request('preview audited completion withdrawal', withdrawal)).data.data;
  assert.equal(preview.canWithdraw, true);
  await request('withdraw reverses original personal labor', withdrawal, { method: 'POST', body: { expectedRouteVersion: preview.routeVersion,
    category: 'REPORTING_ERROR', idempotencyKey: randomUUID() } });
  assertHours(rowBy(await employee(fixture.today), 1), { attendance: 8, completed: 5, rate: 6250 });
  await request('report page available', '/workspace/reports/people/employee-attainment?period=today&date=' + fixture.today);
  const old = await request('old unmatched link redirects to hours report', '/workspace/reports/people/unmatched-labor', { status: 307 });
  assert.ok(old.response.headers.get('location')?.includes('employee-attainment'));
  const evidence = { verifiedAt: new Date().toISOString(), base, version: ready.app.version, revision: ready.app.revision,
    fixture: { file: fixtureFile, runtime: fixture.runtime, employees: 3, serviceCompletions: 6 }, checks, productionDataTouched: false };
  const file = process.env.HOURS_QA_EVIDENCE || 'artifacts/employee-hours-v134142/runtime-smoke.json';
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ ok: true, checks: checks.length, version: ready.app.version, revision: ready.app.revision }));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
