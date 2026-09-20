// Exercise the published API against disposable PostgreSQL / S3 fixtures.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
const base = process.env.QUALITY_DATA_QA_BASE || 'http://127.0.0.1:3246';
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(base).hostname));
assert.equal(process.env.QUALITY_DATA_QA_ALLOW, 'disposable-quality-runtime');
const fixture = JSON.parse((await fs.readFile(process.env.QUALITY_DATA_QA_FIXTURE, 'utf8')).replace(/^\uFEFF/, ''));
const cookies = {}, checks = [];
async function request(kind, path, method = 'GET', data, expected = 200) {
  const response = await fetch(base + path, { method, redirect: 'manual', headers: { ...(cookies[kind] ? { Cookie: cookies[kind] } : {}), ...(method !== 'GET' ? { Origin: base } : {}), ...(data && !(data instanceof FormData) ? { 'Content-Type': 'application/json' } : {}) }, body: data ? data instanceof FormData ? data : JSON.stringify(data) : undefined, signal: AbortSignal.timeout(90000) });
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.equal(response.status, expected, path + ': ' + bytes.toString().slice(0, 250));
  checks.push({ method, path: path.split('?')[0], status: expected });
  return { response, bytes, data: response.headers.get('content-type')?.includes('application/json') ? JSON.parse(bytes).data : null };
}
for (const kind of ['quality', 'employee']) {
  const r = await request(kind, '/api/auth/login', 'POST', { username: fixture.users[kind].username, password: fixture.password });
  cookies[kind] = r.response.headers.get('set-cookie').match(/hm_session=[^;]+/)[0];
}
const api = '/api/quality-data/';
for (const endpoint of ['first-orders', 'first-records', 'first-export']) {
  await request('anonymous', api + endpoint, 'GET', undefined, 401);
  await request('employee', api + endpoint, 'GET', undefined, 403);
}
await request('quality', api + 'first-orders?week=bad-date', 'GET', undefined, 400);
const marker = 'first-api-' + randomUUID();
const order = fixture.orders[0];
const overview = (await request('quality', api + 'first-steps/' + order.id)).data;
const input = { type: 'FIRST', workOrderId: order.id, inspectionStepId: overview.steps[0].id, title: marker, inspectedAt: '2001-01-03T09:00', data: { mode: 'FILE', context: { inspectedBy: '品质检验员' }, rows: [], summary: marker, paper: { result: 'FAIL', area: '' } }, idempotencyKey: randomUUID() };
let r = (await request('quality', api + 'records', 'POST', input)).data;
const png = await sharp({ create: { width: 140, height: 240, channels: 3, background: '#fff2dd' } }).png().toBuffer();
const form = new FormData(); form.set('file', new File([png], marker + '.png', { type: 'image/png' })); form.set('version', String(r.version));
r = (await request('quality', api + 'records/' + r.id + '/attachments', 'POST', form)).data;
const draft = (await request('quality', api + 'first-records?' + new URLSearchParams({ q: marker, draft: '1', mine: '1' }))).data.items[0];
assert.equal(draft.id, r.id); assert.ok(draft.activity.lastUploadedAt); assert.equal(draft.activity.uploadedBy, '品质检验员');
const firstUpload = draft.activity.firstUploadedAt, lastUpload = draft.activity.lastUploadedAt;
r = (await request('quality', api + 'records/' + r.id, 'PATCH', { ...input, action: 'SUBMIT', version: r.version })).data;
assert.equal(r.result, 'FAIL');
const done = (await request('quality', api + 'first-orders?' + new URLSearchParams({ q: marker, completion: 'DONE' }))).data;
assert.equal(done.total, 1); assert.equal(done.items[0].id, order.id);
const list = (await request('quality', api + 'first-records?' + new URLSearchParams({ q: marker + '.png', mine: '1', completion: 'DONE', result: 'FAIL' }))).data;
assert.equal(list.total, 1); assert.equal(list.items[0].id, r.id);
assert.equal(list.items[0].activity.firstUploadedAt, firstUpload);
assert.equal(list.items[0].activity.lastUploadedAt, lastUpload, 'Submitting metadata must not change upload time');
assert.equal((await request('quality', api + 'first-records?' + new URLSearchParams({ q: marker, period: 'today', date: '2001-01-03', timeField: 'upload' }))).data.total, 0);
assert.equal((await request('quality', api + 'first-records?' + new URLSearchParams({ q: marker, period: 'today', date: '2001-01-03', timeField: 'inspectedAt' }))).data.total, 1);
const xlsx = await request('quality', api + 'first-export?' + new URLSearchParams({ q: marker, mine: '1', result: 'FAIL' }));
const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(xlsx.bytes);
assert.equal(workbook.getWorksheet('记录清单').rowCount, 4);
assert.ok(JSON.stringify(workbook.getWorksheet('记录清单').getRow(3).values).includes('最近上传时间'));
const zip = await JSZip.loadAsync((await request('quality', api + 'first-export?' + new URLSearchParams({ q: marker, format: 'zip' }))).bytes);
const photo = Object.values(zip.files).find(f => f.name.endsWith('.png'));
assert.ok(photo); assert.deepEqual(await photo.async('nodebuffer'), png);
const page = await request('quality', '/workspace/quality/data?type=FIRST&recordId=' + r.id);
assert.ok(page.bytes.toString().includes('首件检验'));
const result = { passed: true, checks: checks.length, recordId: r.id, workOrderId: order.id, firstUpload, lastUpload, results: checks };
await fs.writeFile(process.env.QUALITY_FIRST_QA_OUTPUT || '.docker/first208-api-runtime.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify({ passed: true, checks: checks.length, recordId: r.id }));
