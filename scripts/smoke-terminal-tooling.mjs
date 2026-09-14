import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import XLSX from 'xlsx';
const origin = process.env.TOOLING_QA_BASE || 'http://127.0.0.1:3000';
if (process.env.TOOLING_QA_ALLOW !== 'disposable-tooling-runtime' || !['127.0.0.1', 'localhost'].includes(new URL(origin).hostname)) throw Error('Disposable loopback runtime required');
const f = JSON.parse(fs.readFileSync(process.env.TOOLING_QA_FIXTURE, 'utf8'));
const output = process.env.TOOLING_QA_OUTPUT || 'artifacts/terminal-tooling/release-http.json';
const checks = [];
let cookie = '';
async function call(route, method = 'GET', data, status = 200) {
  const response = await fetch(origin + route, { method, headers: { Origin: origin, Cookie: cookie, ...(data ? { 'Content-Type': 'application/json' } : {}) }, body: data ? JSON.stringify(data) : undefined });
  const body = await response.json();
  assert.equal(response.status, status, `${method} ${route}: ${JSON.stringify(body)}`);
  checks.push(`${method} ${route} -> ${status}`);
  return body;
}
await call('/api/terminal-tooling/blades', 'GET', undefined, 401);
const login = await fetch(origin + '/api/auth/login', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ username: f.username, password: f.password }) });
assert.equal(login.status, 200); cookie = (login.headers.get('set-cookie') || '').match(/hm_session=[^;]+/)?.[0] || ''; assert.ok(cookie);
const positions = ['UPPER_OUTER', 'UPPER_INNER', 'LOWER_OUTER', 'LOWER_INNER'];
const payload = { model: f.marker + '-API', manufacturer: '验收制造商', remark: '整组说明', isDraft: false, positionSpecs: positions.map((position, i) => ({ position, specification: `${i + 1}.2×1.5`, dimensionA: `${i + 1}.2`, dimensionB: '1.5', dimensionUnit: 'mm', material: `材质${i}`, hardness: `硬度${i}`, remark: `刀位备注${i}`, needsReview: false, supplierLinks: [
  { supplierName: f.marker + '-supply', supplierSku: `sku-${i}`, productUrl: `https://example.com/${i}`, remark: `来源备注${i}` },
  { supplierName: f.marker + '-spare', supplierSku: `备用-${i}`, productUrl: '', remark: '备用来源' },
] })) };
let blade = (await call('/api/terminal-tooling/blades', 'POST', payload)).blade;
assert.deepEqual(blade.positionSpecs.map(spec => spec.specification), payload.positionSpecs.map(spec => spec.specification));
await call('/api/terminal-tooling/blades', 'POST', payload, 409);
const before = structuredClone(blade);
const edit = { ...payload, lockVersion: blade.lockVersion, positionSpecs: structuredClone(payload.positionSpecs) };
edit.positionSpecs[0].specification = '9.25×1.5'; edit.positionSpecs[0].dimensionA = '9.25';
blade = (await call('/api/terminal-tooling/blades/' + blade.id, 'PATCH', edit)).blade;
for (const position of positions.slice(1)) assert.deepEqual(blade.positionSpecs.find(spec => spec.position === position), before.positionSpecs.find(spec => spec.position === position));
await call('/api/terminal-tooling/blades/' + blade.id, 'PATCH', edit, 409);
await call('/api/terminal-tooling/blades/' + blade.id, 'PATCH', { lockVersion: blade.lockVersion, specification: 'old client overwrite' }, 409);
await call('/api/terminal-tooling/blades/' + blade.id, 'PATCH', { ...edit, lockVersion: blade.lockVersion, positionSpecs: edit.positionSpecs.slice(0, 3) }, 400);
assert.equal((await call('/api/terminal-tooling/blades?keyword=' + encodeURIComponent('4.2×1.5'))).blades.some(row => row.id === blade.id), true);
const csvResponse = await fetch(origin + '/api/terminal-tooling/export.csv?entity=blades', { headers: { Cookie: cookie } });
assert.equal(csvResponse.status, 200);
const csv = await csvResponse.text(); const book = XLSX.read(csv, { type: 'string', raw: true });
const rows = XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], { header: 1, raw: true });
const row = rows.find(row => row[0] === payload.model); assert.ok(row);
assert.equal(row[rows[0].indexOf('下内刀规格')], '4.2×1.5');
const exportedSupplies = JSON.parse(row[rows[0].indexOf('下内刀采购来源JSON')]); assert.equal(exportedSupplies.length, 2); assert.equal(exportedSupplies[1].supplierSku, '备用-3');
row[0] = f.marker + '-IMPORT';
const uploadCsv = XLSX.utils.sheet_to_csv(XLSX.utils.aoa_to_sheet([rows[0], row]));
const upload = new FormData(); upload.set('entity', 'blades'); upload.set('file', new Blob([uploadCsv], { type: 'text/csv' }), '四刀位导入.csv');
const previewResponse = await fetch(origin + '/api/terminal-tooling/import/preview', { method: 'POST', headers: { Cookie: cookie, Origin: origin }, body: upload });
assert.equal(previewResponse.status, 200); const preview = await previewResponse.json(); assert.equal(preview.summary.ready, 1);
const importedResult = await call('/api/terminal-tooling/import/commit', 'POST', { entity: 'blades', rows: preview.rows, fileName: '四刀位导入.csv' });
assert.equal(importedResult.summary.created, 1);
const imported = (await call('/api/terminal-tooling/blades?keyword=' + encodeURIComponent(row[0]))).blades[0];
for (const spec of imported.positionSpecs) {
  const original = blade.positionSpecs.find(item => item.position === spec.position);
  for (const key of ['specification', 'dimensionA', 'dimensionB', 'material', 'hardness', 'remark']) assert.equal(spec[key], original[key]);
  assert.deepEqual(spec.supplierLinks.map(({ supplierName, supplierSku, productUrl, remark }) => ({ supplierName, supplierSku, productUrl, remark })), original.supplierLinks.map(({ supplierName, supplierSku, productUrl, remark }) => ({ supplierName, supplierSku, productUrl, remark })));
}
checks.push('CSV download, upload preview and import preserve all four independent positions and suppliers');
const draft = (await call('/api/terminal-tooling/blades', 'POST', { model: f.marker + '-DRAFT', isDraft: true, positionSpecs: [payload.positionSpecs[0]] })).blade;
const terminal = (await call('/api/terminal-tooling/terminals', 'POST', { specification: f.marker + '-T' })).terminal;
await call('/api/terminal-tooling/setups', 'POST', { terminalId: terminal.id, positions: [{ position: 'UPPER_OUTER', bladeId: draft.id }] }, 400);
const setup = (await call('/api/terminal-tooling/setups', 'POST', { terminalId: terminal.id, positions: positions.map(position => ({ position, bladeId: blade.id })) })).setup;
const published = (await call('/api/terminal-tooling/setups/' + setup.id + '/publish', 'POST', { lockVersion: setup.lockVersion })).setup;
assert.equal(published.status, 'PUBLISHED');
for (const item of published.positions) assert.equal(item.blade.positionSpecs.find(spec => spec.position === item.position).specification, blade.positionSpecs.find(spec => spec.position === item.position).specification);
const disabled = (await call('/api/terminal-tooling/blades/' + blade.id, 'PATCH', { lockVersion: blade.lockVersion, isActive: false })).blade;
assert.equal(disabled.isActive, false); assert.deepEqual(disabled.positionSpecs, blade.positionSpecs);
const enabled = (await call('/api/terminal-tooling/blades/' + blade.id, 'PATCH', { lockVersion: disabled.lockVersion, isActive: true })).blade;
assert.equal(enabled.isActive, true);
fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, JSON.stringify({ passed: true, checks, bladeId: blade.id, setupId: setup.id }, null, 2));
console.log(`Terminal tooling HTTP acceptance passed: ${checks.length} checks`);
