import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';
import sharp from 'sharp';

// Synthetic fixtures only: never run against a business database or remote service.
const database = new URL(process.env.DATABASE_URL);
const base = process.env.ORIENTATION_QA_BASE || 'http://127.0.0.1:3483';
assert.ok(['localhost', '127.0.0.1'].includes(database.hostname));
assert.ok(/^\/orientation_(qa(?:\d+)?|release_[ab])$/.test(database.pathname) || (process.env.CI === 'true' && database.pathname === '/hongmeng_ci'));
assert.equal(new URL(base).hostname, '127.0.0.1');
const evidence = process.env.ORIENTATION_QA_EVIDENCE || 'artifacts/document-orientation-v13467/runtime-local.json';
const db = new PrismaClient();
const password = 'ViewDirection!2026Q';
const cookies = {};
const results = [];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

async function request(path, who = 'editor', body, method = 'GET', raw = false, origin = base) {
  const response = await fetch(base + path, { method, redirect: 'manual', headers: { ...(who ? { Cookie: cookies[who] } : {}), Origin: origin, ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: body instanceof FormData ? body : JSON.stringify(body) } : {}) });
  return { status: response.status, headers: response.headers, data: raw ? Buffer.from(await response.arrayBuffer()) : await response.json().catch(() => ({})) };
}
async function expected(path, who, body, method, status) {
  const result = await request(path, who, body, method);
  assert.equal(result.status, status, `${method} ${path}: ${JSON.stringify(result.data)}`); return result.data;
}

try {
  assert.equal(await db.user.count({ where: { username: { startsWith: 'qa_orientation_' } } }), 0, 'Use a fresh isolated database');
  const business = await db.department.upsert({ where: { code: 'BUSINESS' }, create: { code: 'BUSINESS', name: '业务部' }, update: {} });
  for (const [name, profile, departmentId] of [['admin', 'ADMIN_GLOBAL', null], ['editor', 'DRAWING_LIBRARY_EDITOR', null], ['reader', 'DRAWING_LIBRARY_READER', null], ['business', 'DEPARTMENT_FULL', business.id]]) {
    await db.user.create({ data: { username: `qa_orientation_${name}`, displayName: `方向验收-${name}`, passwordHash: await bcrypt.hash(password, 10), laborRole: name === 'admin' ? 'ADMIN' : 'EMPLOYEE', accessGrants: { create: { profile, departmentId, scopeKey: 'GLOBAL', effectiveFrom: new Date('2026-01-01T00:00:00Z') } } } });
    const login = await request('/api/auth/login', null, { username: `qa_orientation_${name}`, password }, 'POST');
    assert.equal(login.status, 200, JSON.stringify(login.data)); cookies[name] = login.headers.get('set-cookie').match(/hm_session=[^;]+/)[0];
  }
  const sop = await db.resourceCategory.upsert({ where: { code: 'sop' }, create: { code: 'sop', name: 'SOP指导书', sortOrder: 2 }, update: {} });
  const drawing = await db.resourceCategory.upsert({ where: { code: 'drawing' }, create: { code: 'drawing', name: '原图', sortOrder: 1 }, update: {} });
  const item = await db.drawingLibraryItem.create({ data: { customerName: '方向隔离验收客户', specification: 'ORIENTATION-2026', productName: '横竖混排验收', libraryKey: 'qa-orientation-product' } });
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const first = pdf.addPage([400, 600]); first.setRotation(degrees(90));
  first.drawRectangle({ x: 30, y: 30, width: 340, height: 540, color: rgb(1, 0.93, 0.84), borderColor: rgb(1, 0.4, 0), borderWidth: 2 });
  first.drawText('SOP - ORIGINAL LANDSCAPE', { x: 270, y: 65, size: 22, font, rotate: degrees(90) });
  const second = pdf.addPage([400, 600]); second.drawText('PAGE 2 - PORTRAIT', { x: 40, y: 520, size: 24, font });
  const original = Buffer.from(await pdf.save());
  async function upload(category, bytes, name, mimeType) {
    const body = new FormData(); body.set('categoryId', category.id); body.set('file', new Blob([bytes], { type: mimeType }), name);
    return (await expected(`/api/drawing-library/${item.id}/files/upload`, 'editor', body, 'POST', 200)).file;
  }
  const file = await upload(sop, original, '方向验收SOP.pdf', 'application/pdf');
  const imageBytes = await sharp({ create: { width: 640, height: 960, channels: 3, background: '#fff0db' } }).withMetadata({ orientation: 6 }).jpeg().toBuffer();
  const imageFile = await upload(drawing, imageBytes, '方向验收图纸.jpg', 'image/jpeg');
  const path = `/api/drawing-library/files/${file.id}/display-settings`;
  const imagePath = `/api/drawing-library/files/${imageFile.id}/display-settings`;
  const before = await db.drawingLibraryFile.findUniqueOrThrow({ where: { id: file.id } });
  assert.deepEqual((await expected(path, 'reader', null, 'GET', 200)).pageRotations, {});
  assert.equal((await expected(path, 'reader', null, 'GET', 200)).canSave, false);
  await expected(path, null, null, 'GET', 401);
  await expected(path, 'reader', { revision: 0, pageRotations: { '1': 90 } }, 'PATCH', 403);
  await expected(path, 'editor', { revision: 0, pageRotations: { '1': 45 } }, 'PATCH', 400);
  await expected(path, 'editor', { revision: 0, pageRotations: { '3': 90 } }, 'PATCH', 400);
  const saved = await expected(path, 'editor', { revision: 0, pageRotations: { '1': 90, '2': 270 } }, 'PATCH', 200);
  assert.equal(saved.revision, 1);
  await expected(path, 'editor', { revision: 0, pageRotations: {} }, 'PATCH', 409);
  assert.deepEqual((await expected(path, 'reader', null, 'GET', 200)).pageRotations, saved.pageRotations);
  assert.equal(hash((await request(file.contentUrl, 'reader', null, 'GET', true)).data), hash(original));
  const after = await db.drawingLibraryFile.findUniqueOrThrow({ where: { id: file.id } });
  assert.equal(after.updatedAt.toISOString(), before.updatedAt.toISOString());
  assert.equal(after.version, before.version);
  assert.equal(after.objectKey, before.objectKey);
  const exported = await request(path + '?download=1', 'reader', null, 'GET', true);
  assert.equal(exported.status, 200);
  assert.deepEqual((await PDFDocument.load(exported.data)).getPages().map(page => page.getRotation().angle), [180, 270]);
  const originalDownload = await request(`/api/drawing-library/files/${file.id}/download`, 'reader');
  assert.equal(originalDownload.status, 307);
  const originalUrl = originalDownload.headers.get('location');
  assert.ok(originalUrl);
  assert.equal(hash(Buffer.from(await (await fetch(originalUrl)).arrayBuffer())), hash(original));
  results.push('authorization, invalid-page rejection, intrinsic rotation, saved export, original-byte and file-version preservation');

  const workOrder = await db.workOrder.create({ data: { code: 'QA-ORIENTATION-WO', productName: '横竖混排验收', specification: 'ORIENTATION-2026', stage: '前工序', drawingLibraryItemId: item.id, productionTargetQty: 100,
    processRoute: { create: { templateName: '方向验收工序', templateVersion: 1, status: 'in_progress', steps: { create: { processCode: 'QA-CUT', processName: '切线', stageGroup: '前工序', position: 1, unitLabel: '套', standardMillisecondsPerUnit: 18000 } } } } }, include: { processRoute: true } });
  const resource = await db.resourceFile.create({ data: { workOrderId: workOrder.id, categoryId: sop.id, originalName: before.originalName, mimeType: before.mimeType, fileType: 'pdf', fileSize: before.size, objectKey: before.objectKey, status: 'uploaded', version: 'V1.0' } });
  await db.drawingLibraryFile.update({ where: { id: file.id }, data: { sourceResourceFileId: resource.id } });
  const alias = `/api/resource-files/${resource.id}/display-settings`;
  assert.deepEqual((await expected(alias, 'admin', null, 'GET', 200)).pageRotations, saved.pageRotations);
  await expected(alias, 'business', { revision: 1, pageRotations: {} }, 'PATCH', 403);
  const concurrent = await Promise.all([request(path, 'editor', { revision: 1, pageRotations: { '1': 270 } }, 'PATCH'), request(alias, 'admin', { revision: 1, pageRotations: { '2': 90 } }, 'PATCH')]);
  assert.deepEqual(concurrent.map(result => result.status).sort(), [200, 409]);
  const current = await expected(path, 'editor', null, 'GET', 200);
  assert.equal(current.revision, 2);
  assert.deepEqual((await expected(alias, 'admin', null, 'GET', 200)).pageRotations, current.pageRotations);
  const defaultDirection = await expected(path, 'editor', { revision: 2, pageRotations: { '1': 270 } }, 'PATCH', 200);
  await expected(imagePath, 'editor', { revision: 0, pageRotations: { '1': 90 } }, 'PATCH', 200);
  const exportedImage = await request(imagePath + '?download=1', 'reader', null, 'GET', true);
  assert.equal(exportedImage.status, 200);
  const dimensions = await sharp(exportedImage.data).metadata();
  assert.deepEqual([dimensions.width, dimensions.height], [640, 960]);
  results.push('shared work-order/library settings, cross-namespace permission boundary, concurrent-save conflict, EXIF plus user rotation');

  const print = await expected('/api/work-order-qr/prints', 'admin', { workOrderIds: [workOrder.id], mode: 'CUSTOM', materials: ['SOP', 'DRAWING'], copies: 1 }, 'POST', 200);
  const printId = print.data.printIds[0];
  const snapshot = (await db.workOrderQrPrint.findUniqueOrThrow({ where: { id: printId } })).snapshot;
  assert.deepEqual(snapshot.documentOrientations[file.id], { revision: defaultDirection.revision, pageRotations: { '1': 270 } });
  await expected(path, 'editor', { revision: defaultDirection.revision, pageRotations: { '2': 90 } }, 'PATCH', 200);
  for (const [material, expectedAngles] of [['sop', [0, 0]], ['drawing', [90]]]) {
    const printed = await request(`/api/work-order-qr/prints/${printId}/${material}`, 'admin', null, 'GET', true);
    assert.equal(printed.status, 200, printed.data.toString().slice(0, 150));
    assert.deepEqual((await PDFDocument.load(printed.data)).getPages().map(page => page.getRotation().angle), expectedAngles);
  }
  const packetForm = new FormData(); packetForm.set('target', 'sop'); packetForm.set('printIds', printId);
  const packet = await request('/api/work-order-qr/prints/packet', 'admin', packetForm, 'POST', true);
  assert.equal(packet.status, 200, packet.data.toString().slice(0, 150));
  assert.deepEqual((await PDFDocument.load(packet.data)).getPages().map(page => page.getRotation().angle), [0, 0]);
  results.push('new print snapshots freeze directions; separate and combined historical reprints ignore later edits');

  const nextVersion = await upload(sop, original, '方向验收SOP.pdf', 'application/pdf');
  assert.equal((await expected(`/api/drawing-library/files/${nextVersion.id}/display-settings`, 'reader', null, 'GET', 200)).revision, 0);
  assert.deepEqual((await expected(`/api/drawing-library/files/${nextVersion.id}/display-settings`, 'reader', null, 'GET', 200)).pageRotations, {});
  await db.drawingLibraryFile.update({ where: { id: nextVersion.id }, data: { deletedAt: new Date() } });
  await expected(`/api/drawing-library/files/${nextVersion.id}/display-settings`, 'reader', null, 'GET', 404);
  await db.drawingLibraryFile.update({ where: { id: nextVersion.id }, data: { deletedAt: null } });
  assert.ok(await db.operationLog.count({ where: { action: 'save_document_orientation', targetId: file.id } }) >= 3);
  results.push('new versions start at intrinsic direction, deleted files are inaccessible, orientation changes are audited');
  await mkdir(dirname(evidence), { recursive: true });
  await writeFile(evidence, JSON.stringify({ ok: true, base, results, fixture: { itemId: item.id, fileId: file.id, newFileId: nextVersion.id, imageFileId: imageFile.id, resourceId: resource.id, workOrderId: workOrder.id, printId }, accounts: ['editor', 'reader', 'admin'].map(name => `qa_orientation_${name}`) }, null, 2));
  console.log(JSON.stringify({ ok: true, results, evidence }));
} finally { await db.$disconnect(); }
