import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { PDFDocument, PDFRawStream, PDFName } from 'pdf-lib';
assert.equal(process.env.OFFICE_QA_ALLOW, 'disposable-office-runtime');
const base = process.env.SMOKE_BASE_URL || 'http://127.0.0.1:3275';
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(base).hostname));
const dir = process.env.OFFICE_QA_OUTPUT || 'output/playwright/knowledge-preview-local';
const fixture = JSON.parse(readFileSync(path.join(dir, 'fixture.json'), 'utf8'));
assert.ok(fixture.marker.startsWith('OPQ-'));
const login = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: fixture.user.username, password: fixture.password }) });
assert.equal(login.status, 200); const cookie = login.headers.get('set-cookie')?.match(/hm_session=[^;]+/)?.[0]; assert.ok(cookie);
const results = [];
for (const file of fixture.files) {
  const url = `/api/knowledge/attachments/${file.id}/preview`;
  for (const suffix of ['', '/pdf', '/table']) assert.equal((await fetch(base + url + suffix)).status, 401);
  const first = await (await fetch(base + url, { headers: { cookie } })).json();
  assert.equal(first.preview.pdfStatus, 'ready');
  const response = await fetch(base + first.preview.pdfUrl, { headers: { cookie } }); assert.equal(response.status, 200);
  const bytes = new Uint8Array(await response.arrayBuffer()); writeFileSync(path.join(dir, `preview-${file.type}.pdf`), bytes);
  const pdf = await PDFDocument.load(bytes);
  const images = pdf.context.enumerateIndirectObjects().filter(([, object]) => object instanceof PDFRawStream && object.dict.get(PDFName.of('Subtype'))?.toString() === '/Image').length;
  if (file.type === 'docx') { assert.equal(pdf.getPageCount(), 2); assert.ok(images > 0, 'embedded Word image preserved'); }
  if (file.type === 'xlsx') { assert.ok(pdf.getPageCount() > 2); assert.ok(images > 0, 'embedded Excel image preserved'); }
  results.push({ type: file.type, pages: pdf.getPageCount(), embeddedImages: images, bytes: bytes.length });
  assert.deepEqual((await (await fetch(base + url, { headers: { cookie } })).json()).preview, first.preview);
}
assert.equal((await fetch(base + '/api/internal/knowledge-preview', { method: 'POST' })).status, 404);
// The synthetic historical article has text, so removing one attachment is valid.
const removed = fixture.files.find(file => file.type === 'doc');
assert.equal((await fetch(base + `/api/knowledge/attachments/${removed.id}`, { method: 'DELETE', headers: { cookie } })).status, 200);
for (const suffix of ['', '/pdf', '/table']) assert.equal((await fetch(base + `/api/knowledge/attachments/${removed.id}/preview${suffix}`, { headers: { cookie } })).status, 404);
const evidence = { passed: true, results, authenticatedOnly: true, deletedCacheInaccessible: true, cacheReused: true, productionModified: false };
writeFileSync(path.join(dir, 'http-acceptance.json'), JSON.stringify(evidence, null, 2)); console.log(JSON.stringify(evidence));
