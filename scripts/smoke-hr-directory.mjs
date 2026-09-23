import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const base = (process.env.HR_QA_BASE || '').replace(/\/+$/, '');
const target = new URL(base);
assert.equal(process.env.HR_DIRECTORY_QA_ALLOW, 'disposable-hr-runtime');
assert.equal(target.hostname, '127.0.0.1');
assert.ok(['3108', '3109'].includes(target.port));
assert.ok(process.env.HR_DIRECTORY_QA_PASSWORD && process.env.EXPECTED_APP_VERSION);
let cookie = '';
const checks = [];
async function request(label, route, { method = 'GET', body, status = 200, authenticated = true } = {}) {
  const response = await fetch(base + route, { method, redirect: 'manual', signal: AbortSignal.timeout(60_000),
    headers: { ...(authenticated && cookie ? { Cookie: cookie } : {}),
      ...(method !== 'GET' ? { Origin: base, 'Content-Type': 'application/json' } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body) });
  assert.equal(response.status, status, label + ': unexpected status');
  checks.push({ label, status: response.status });
  return response;
}
async function main() {
  await request('employee API requires login', '/api/employees', { authenticated: false, status: 401 });
  const ready = await (await request('database and S3 readiness', '/api/ready')).json();
  assert.ok(ready.ok && ready.database.ok && ready.storage.ok);
  assert.equal(ready.app.version, process.env.EXPECTED_APP_VERSION);
  if (process.env.EXPECTED_APP_REVISION) assert.equal(ready.app.revision, process.env.EXPECTED_APP_REVISION);
  const login = await request('isolated HR account login', '/api/auth/login', {
    method: 'POST', body: { username: 'hrqa', password: process.env.HR_DIRECTORY_QA_PASSWORD } });
  cookie = (login.headers.get('set-cookie') || '').match(/hm_session=[^;]+/)?.[0] || '';
  assert.ok(cookie);
  const html = await (await request('employee workbench page', '/workspace/employees?view=directory')).text();
  assert.ok(html.includes('hr-workbench-v5'));
  assert.ok(!html.includes('hr-account-management-entry'));
  const cssRoutes = [...new Set([...html.matchAll(/<link\b[^>]*href="([^\"]+\.css(?:\?[^\"]*)?)"/g)].map(m => m[1].replaceAll('&amp;', '&')))];
  const css = [];
  for (const route of cssRoutes) css.push(await (await request('packaged employee stylesheet', route)).text());
  assert.ok(css.some(text => text.includes('.hr-profile-save-status') && text.includes('.hr-workbench-v5')));
  const accountEntry = await request('legacy account entry redirects to HR', '/workspace/employees/accounts', { status: 307 });
  assert.equal(accountEntry.headers.get('location'), '/workspace/employees?accountAccess=1');
  await request('account modal retains the HR workbench', accountEntry.headers.get('location'));
  const roster = await (await request('load synthetic employee roster', '/api/employees')).json();
  const employee = roster.employees.find(item => item.employeeNo === '0001');
  assert.ok(employee && roster.employees.length >= 36);
  const route = '/api/employees/' + employee.id;
  await request('empty employee name rejected', route, { method: 'PATCH', body: { name: '' }, status: 400 });
  await request('ordinary edit cannot renumber', route, { method: 'PATCH', body: { employeeNo: '999999' }, status: 409 });
  const name = '李明档案验收';
  const effectiveDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  async function saveDatedProfile(label, fields) {
    const input = { ...fields, attainmentChange: { effectiveDate, reason: '隔离人事档案验收：' + label } };
    const preview = await (await request(label + ' effective-date preview', route + '/attainment-policy', { method: 'POST', body: input })).json();
    return request(label, route, { method: 'PATCH', body: { ...input, attainmentChange: { ...input.attainmentChange, token: preview.preview.token, requestId: randomUUID() } } });
  }
  const update = await (await saveDatedProfile('save profile fields', { name, team: '装配二组', hireDate: '2025-03-18' })).json();
  assert.equal(update.employee.name, name);
  assert.equal(update.employee.team, '装配二组');
  const refreshed = await (await request('reload persisted profile', '/api/employees')).json();
  assert.equal(refreshed.employees.find(item => item.id === employee.id).name, name);
  await saveDatedProfile('restore synthetic profile', { name: employee.name, team: employee.team, hireDate: employee.hireDate });
  const created = await (await request('create synthetic employee with automatic number', '/api/employees', {
    method: 'POST', status: 201, body: { name: '新增档案验收', department: '生产部', position: '装配操作员',
      team: '装配一组', hireDate: '2026-09-01', attendanceEnabled: true, attendanceGroup: 'UNASSIGNED' } })).json();
  assert.ok(created.employee.id && created.employee.employeeNo);
  assert.ok(!roster.employees.some(item => item.employeeNo === created.employee.employeeNo));
  const departed = roster.employees.find(item => !item.isActive);
  assert.ok(departed?.resignedAt);
  await request('departed employee attendance page remains accessible', '/workspace/attendance?employeeId=' + departed.id);
  for (const view of ['overview', 'recruiting', 'attendance', 'performance', 'training', 'organization', 'responsibilities', 'approvals']) {
    await request('HR module route: ' + view, '/workspace/employees?view=' + view);
  }
  const output = process.env.HR_QA_EVIDENCE || 'artifacts/hr-directory-v134139/runtime-smoke.json';
  const evidence = { verifiedAt: new Date().toISOString(), base, version: ready.app.version, revision: ready.app.revision,
    checks, syntheticEmployeesBefore: roster.employees.length, createdEmployeeNo: created.employee.employeeNo,
    productionDataTouched: false, browserAcceptance: 'Layout and interactive states are checked separately in the in-app browser.' };
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
