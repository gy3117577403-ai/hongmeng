import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
const base = process.env.QUALITY_WORKBENCH_QA_BASE;
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(base).hostname));
assert.equal(process.env.QUALITY_WORKBENCH_QA_ALLOW, 'disposable-quality-runtime');
const fixture = JSON.parse(await readFile(process.env.QUALITY_WORKBENCH_QA_FIXTURE, 'utf8'));
const checks = [], cookies = {};
async function api(who, route, method = 'GET', data, expected = 200) {
  const response = await fetch(base + route, { method, headers: { Origin: base, Cookie: cookies[who] || '', 'Content-Type': 'application/json' }, body: data ? JSON.stringify(data) : undefined });
  const body = await response.json(); assert.equal(response.status, expected, `${route}: ${JSON.stringify(body)}`);
  checks.push(`${method} ${route}: ${expected}`); return { body, response };
}
for (const who of ['admin', 'lead']) {
  const { response } = await api(who, '/api/auth/login', 'POST', { username: fixture.users[who].username, password: fixture.password });
  cookies[who] = response.headers.get('set-cookie')?.match(/hm_session=[^;]+/)?.[0]; assert.ok(cookies[who]);
}
const path = '/api/integrations/wecom/robot';
let settings = (await api('admin', path)).body;
let employee = settings.recipients.find(row => row.accountId === fixture.users.lead.id); assert.ok(employee);
const command = { action: 'SAVE_IDENTITY', employeeId: employee.id, expectedUpdatedAt: employee.updatedAt, wecomUserId: fixture.marker + '.lead', identityConfirmed: true };
await api('lead', path, 'PATCH', command, 403);
await api('admin', path, 'PATCH', { ...command, identityConfirmed: false }, 400);
await api('admin', path, 'PATCH', { ...command, wecomUserId: '@all' }, 400);
await api('admin', path, 'PATCH', command);
await api('admin', path, 'PATCH', command, 409);
settings = (await api('admin', path)).body;
employee = settings.recipients.find(row => row.id === employee.id);
assert.equal(employee.identityMethod, 'USER_ID'); assert.equal(employee.mentionState, 'UNVERIFIED');
assert.equal(employee.accountId, fixture.users.lead.id);
await api('admin', path, 'PATCH', { action: 'CONFIRM_MENTION', employeeId: employee.id, expectedUpdatedAt: employee.updatedAt, result: 'CONFIRMED' }, 409);
await api('admin', path, 'POST', { employeeIds: [employee.id], confirmed: false }, 400);
const short = await fetch(base + '/q/abcdefghijkl', { redirect: 'manual' });
assert.equal(short.status, 307); assert.match(short.headers.get('location'), /login\?next=/);
assert.match(decodeURIComponent(short.headers.get('location')), /\/q\/abcdefghijkl/);
checks.push('short link preserves login return; configuration does not claim actual @');
const file = process.env.QUALITY_WORKBENCH_QA_OUTPUT.replace(/[^/\\]+$/, 'notification-settings-http.json');
await writeFile(file, JSON.stringify({ passed: true, realWeComUsed: false, checks }, null, 2));
console.log(JSON.stringify({ passed: true, realWeComUsed: false, checks: checks.length }));
