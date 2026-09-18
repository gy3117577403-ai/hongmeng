import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { PDFDocument } from 'pdf-lib';
const base = process.env.DRAWING_LIBRARY_QA_BASE || 'http://127.0.0.1:3115';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
assert.equal(process.env.DRAWING_LIBRARY_QA_ALLOW, 'disposable-drawing-runtime');
const fixture = JSON.parse((await fs.readFile(process.env.DRAWING_LIBRARY_QA_FIXTURE || '.docker/drawing-library-fixture.json', 'utf8')).replace(/^\uFEFF/, ''));
let cookie = ''; const checks = [];
async function request(route, method = 'GET', body, status = 200) {
  const response = await fetch(base + route, {
    method, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(method !== 'GET' ? { Origin: base } : {}), ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? body instanceof FormData ? body : JSON.stringify(body) : undefined, signal: AbortSignal.timeout(90000),
  });
  const json = await response.json();
  assert.equal(response.status, status, `${method} ${route}: ${JSON.stringify(json).slice(0, 700)}`);
  return { response, ...json };
}
async function login(role) {
  cookie = '';
  const data = await request('/api/auth/login', 'POST', { username: fixture.users[role].username, password: fixture.password });
  cookie = data.response.headers.get('set-cookie')?.match(/hm_session=[^;]+/)?.[0];
  assert.ok(cookie);
}
await request('/api/drawing-library', 'GET', undefined, 401);
await login('editor');
await request(`/api/drawing-library/${fixture.archived.id}/restore`, 'POST', { reason: '越权检查' }, 403);
await request(`/api/drawing-library/${fixture.historical.id}`, 'DELETE', { reason: '越权检查' }, 403);
checks.push('unauthenticated access denied; non-admin delete and restore denied');
await login('admin');
const duplicate = await request('/api/drawing-library', 'POST', { customerName: fixture.marker + '杭州昆泰', specification: fixture.historical.specification.toLowerCase(), productName: '测试线束' }, 409);
assert.equal(duplicate.itemId, fixture.historical.id);
checks.push('manual create detects customer suffix and case variants');
const created = (await request('/api/drawing-library', 'POST', { customerName: fixture.marker, specification: fixture.marker + '-EMPTY', productName: '删除恢复验收' })).item;
await request(`/api/drawing-library/${created.id}`, 'DELETE', {}, 409);
await request(`/api/drawing-library/${created.id}`, 'DELETE', { reason: '验收空档案删除' });
await request(`/api/drawing-library/${created.id}`, 'GET', undefined, 404);
assert.ok((await request('/api/drawing-library/trash?itemId=' + created.id)).items.some(item => item.id === created.id));
await request(`/api/drawing-library/${created.id}/restore`, 'POST', { reason: '验收原编号恢复' });
assert.equal((await request(`/api/drawing-library/${created.id}`)).item.id, created.id);
checks.push('empty archive delete, trash listing, ID-preserving restore and reason validation');
const categories = (await request('/api/drawing-library')).categories;
const originalCategory = categories.find(category => category.code === 'drawing');
assert.ok(originalCategory);
const pdf = await PDFDocument.create(); pdf.addPage([300, 200]).drawText('Drawing reuse QA');
const form = new FormData(); form.set('categoryId', originalCategory.id); form.set('file', new Blob([await pdf.save()], { type: 'application/pdf' }), 'qa-original.pdf');
await request(`/api/drawing-library/${fixture.historical.id}/files/upload`, 'POST', form);
await request(`/api/drawing-library/${fixture.historical.id}`, 'DELETE', { reason: '带资料阻止删除' }, 409);
checks.push('real PDF upload to object storage blocks archive deletion');

const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
const next = new Date(today + 'T00:00:00Z'); next.setUTCDate(next.getUTCDate() + ((8 - next.getUTCDay()) % 7 || 7));
const week = next.toISOString().slice(0, 10);
const due = new Date(next); due.setUTCDate(due.getUTCDate() + 6);
async function preview(specification, customer, source, ref = '') {
  const workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet('导入验收');
  sheet.addRow(['来源订单号', '订单日期', '客户名称', '产品名称', '型号/规格', '订单总量', '本周排产量', '客户交期', '图纸库编号']);
  sheet.addRow([source, today, customer, '测试线束', specification, 5, 5, due.toISOString().slice(0, 10), ref]);
  const data = new FormData(); data.set('file', new Blob([await workbook.xlsx.writeBuffer()]), 'drawing-import.xlsx'); data.set('weekStartDate', week);
  return request('/api/planning/import/preview', 'POST', data);
}
const plan = await preview(fixture.historical.specification.toLowerCase(), fixture.marker + '杭州昆泰', fixture.marker + '-SO');
assert.equal(plan.rows[0].productAction, 'reuse'); assert.equal(plan.rows[0].matchedDrawingLibraryItemId, fixture.historical.id);
const fixtureDecisions = preview => Object.fromEntries(preview.rows.map(row => [row.rowNo, false]));
const committed = await request('/api/planning/import/commit', 'POST', { batchId: plan.batchId, previewToken: plan.previewToken, fixtureDecisions: fixtureDecisions(plan) });
assert.equal(committed.summary.createdProducts, 0); assert.equal(committed.summary.reusedProducts, 1);
const repeated = await request('/api/planning/import/commit', 'POST', { batchId: plan.batchId, previewToken: plan.previewToken, fixtureDecisions: fixtureDecisions(plan) });
assert.deepEqual(repeated.summary, committed.summary);
checks.push('next-week XLSX preview and commit reuse original archive; repeated commit is idempotent');
const deleted = await preview(fixture.archived.specification, fixture.marker + '重庆易猫', fixture.marker + '-ARCHIVED-SO');
assert.equal(deleted.rows[0].status, 'invalid'); assert.match(deleted.rows[0].reason, /管理员先恢复/);
checks.push('import cannot restore archived masters or create replacement duplicates');
const mismatched = await preview(fixture.historical.specification, fixture.marker + '另一客户', fixture.marker + '-INVALID', fixture.historical.id);
assert.equal(mismatched.rows[0].status, 'invalid');
checks.push('explicit archive references must match customer and model');
const ambiguous = await preview(fixture.marker + '-AMBIGUOUS', fixture.marker + '伽利略（天津）', fixture.marker + '-AMBIGUOUS-SO');
assert.equal(ambiguous.rows[0].status, 'conflict'); assert.equal(ambiguous.rows[0].candidates.length, 2);
await request('/api/planning/import/commit', 'POST', { batchId: ambiguous.batchId, previewToken: ambiguous.previewToken, fixtureDecisions: fixtureDecisions(ambiguous) }, 409);
await request('/api/planning/import/commit', 'POST', { batchId: ambiguous.batchId, previewToken: ambiguous.previewToken, fixtureDecisions: fixtureDecisions(ambiguous), decisions: { [ambiguous.rows[0].rowNo]: fixture.historical.id } }, 409);
const chosen = await request('/api/planning/import/commit', 'POST', { batchId: ambiguous.batchId, previewToken: ambiguous.previewToken, fixtureDecisions: fixtureDecisions(ambiguous), decisions: { [ambiguous.rows[0].rowNo]: fixture.ambiguous[0].id } });
assert.equal(chosen.summary.createdProducts, 0);
checks.push('ambiguous import requires an allowed explicit choice and rejects forged decisions');
const page = await request('/api/drawing-library?paged=true&offset=0');
assert.ok(Array.isArray(page.items)); assert.equal(typeof page.hasMore, 'boolean');
checks.push('paged library listing contract');
const output = process.env.DRAWING_LIBRARY_QA_OUTPUT || 'artifacts/drawing-library-v134146/http-smoke.json';
await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, JSON.stringify({ checkedAt: new Date().toISOString(), base, checks, passed: checks.length, fixtureMarker: fixture.marker, archiveId: created.id, productionChanged: false }, null, 2));
console.log(JSON.stringify({ passed: checks.length, output }));
