import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { prisma } from '../lib/prisma';
import { retireReplacedDrawing, syncDrawingReplacement } from '../lib/drawing-replacement';
import { assertFixturePrintReady, lockFixtureBusiness, mutateQualityFixture } from '../lib/quality-fixture-service';
import type { PcInput } from '../lib/purchasing-domain';

test('quick document replacement retires exactly one file and creates independent review evidence', { skip: process.env.RUN_DB_INTEGRATION !== '1' }, async t => {
  const tag = 'REPLACE-' + randomUUID().slice(0, 8);
  const admin = await prisma.user.create({ data: { username: tag, displayName: '更换验收管理员', passwordHash: 'fixture-only', laborRole: 'ADMIN' } });
  const category = await prisma.resourceCategory.upsert({ where: { code: 'sop' }, update: {}, create: { code: 'sop', name: 'SOP', sortOrder: 0 } });
  const cmd = (input: PcInput) => mutateQualityFixture(input, admin, randomUUID()) as Promise<any>;
  const settings = await prisma.qfSettings.findUnique({ where: { id: 'quality-fixtures' } });
  await cmd({ action: 'SAVE_SETTINGS', version: settings?.version, supervisorIds: [admin.id], qualityIds: [admin.id] });
  async function fixture() {
    const key = tag + '-' + randomUUID();
    const product = await prisma.drawingLibraryItem.create({ data: { libraryKey: key, customerName: tag, specification: key, fixtureRequired: true } });
    const file = await prisma.drawingLibraryFile.create({ data: { libraryItemId: product.id, categoryId: category.id, originalName: '旧SOP.pdf', mimeType: 'application/pdf', objectKey: key + '/old', size: 10, uploadedById: admin.id } });
    const order = await prisma.workOrder.create({ data: { code: key, productName: key, stage: 'frontend', drawingLibraryItemId: product.id, specification: key, weekStartDate: new Date('2026-09-21T00:00:00+08:00') } });
    const p = await cmd({ action: 'SAVE_PACKAGE', libraryItemId: product.id, revision: 'A', needFixture: true, drawingFileIds: [], sopFileIds: [file.id] });
    return { product, file, order, p };
  }
  async function replace(old: Awaited<ReturnType<typeof fixture>>['file']) {
    return prisma.$transaction(async tx => {
      await lockFixtureBusiness(tx);
      const next = await tx.drawingLibraryFile.create({ data: { libraryItemId: old.libraryItemId, categoryId: old.categoryId, originalName: '新SOP.pdf', mimeType: 'application/pdf', size: 20, objectKey: tag + '/' + randomUUID(), supersedesFileId: old.id, uploadedById: admin.id, version: 'V2' } });
      await retireReplacedDrawing(tx, old, next, admin, '更新尺寸');
      return next;
    });
  }
  const refresh = (id: string) => prisma.qfPackage.findUniqueOrThrow({ where: { id } });
  async function sign(id: string, role: string) { return cmd({ action: 'APPROVE', id, version: (await refresh(id)).version, reviewRole: role, confirmed: true }); }
  for (const status of ['DRAFT', 'REVIEWING', 'SUPERVISOR', 'QUALITY', 'APPROVED', 'RETURNED', 'REVOKED', 'SUPERSEDED']) await t.test('replacement available in ' + status, async () => {
    const f = await fixture();
    await prisma.qfPackage.update({ where: { id: f.p.id }, data: { status } });
    const other = await prisma.drawingLibraryFile.create({ data: { libraryItemId: f.product.id, categoryId: category.id, originalName: '其他SOP.pdf', mimeType: 'application/pdf', objectKey: tag + randomUUID(), size: 5 } });
    const next = await replace(f.file);
    const old = await prisma.drawingLibraryFile.findUniqueOrThrow({ where: { id: f.file.id } });
    assert.ok(old.deletedAt && old.retiredForReplacementAt); assert.equal(old.isCurrent, false);
    assert.equal((await prisma.drawingLibraryFile.findUniqueOrThrow({ where: { id: other.id } })).deletedAt, null);
    assert.equal(next.isCurrent, true);
    const job = await prisma.drawingReplacementJob.findUniqueOrThrow({ where: { sourceFileId: old.id } });
    assert.equal(job.syncPending, true); assert.equal(job.purgePending, true);
  });
  await t.test('old approval cannot authorize new file; active bindings move and both roles re-sign without BOM', async () => {
    const f = await fixture();
    await cmd({ action: 'SUBMIT', id: f.p.id, version: f.p.version });
    await sign(f.p.id, 'QUALITY'); await sign(f.p.id, 'SUPERVISOR');
    await prisma.qfPlanBinding.create({ data: { workOrderId: f.order.id, packageId: f.p.id, selectedById: admin.id } });
    assert.ok(await assertFixturePrintReady(prisma, f.order.id));
    const next = await replace(f.file);
    await assert.rejects(() => assertFixturePrintReady(prisma, f.order.id));
    const job = await prisma.drawingReplacementJob.findUniqueOrThrow({ where: { sourceFileId: f.file.id } });
    await prisma.$transaction(async tx => { await lockFixtureBusiness(tx); await syncDrawingReplacement(tx, job); });
    const p = await prisma.qfPackage.findFirstOrThrow({ where: { libraryItemId: f.product.id }, orderBy: { sequence: 'desc' } });
    assert.notEqual(p.id, f.p.id); assert.equal(p.supervisorId, null); assert.equal(p.qualityId, null);
    assert.equal(p.bomFileId, null); assert.equal(p.status, 'REVIEWING');
    assert.equal((p.sopFiles as any[])[0].id, next.id);
    assert.equal((await prisma.qfPlanBinding.findUniqueOrThrow({ where: { workOrderId: f.order.id } })).packageId, p.id);
    await sign(p.id, 'SUPERVISOR'); await assert.rejects(() => assertFixturePrintReady(prisma, f.order.id));
    await sign(p.id, 'QUALITY'); assert.ok(await assertFixturePrintReady(prisma, f.order.id));
  });
  await t.test('a returned SOP is replaced and resubmitted while retaining its reason and completed facts', async () => {
    const f = await fixture();
    const submitted = await cmd({ action: 'SUBMIT', id: f.p.id, version: f.p.version });
    await cmd({ action: 'RETURN', id: submitted.id, version: submitted.version, reviewRole: 'QUALITY', fileIds: [f.file.id], reason: '尺寸错误' });
    const done = await prisma.workOrder.create({ data: { code: tag + randomUUID(), productName: '历史完成', stage: 'frontend', drawingLibraryItemId: f.product.id, status: 'completed', completedAt: new Date() } });
    await prisma.qfPlanBinding.create({ data: { workOrderId: done.id, packageId: f.p.id, selectedById: admin.id } });
    const next = await replace(f.file);
    await prisma.$transaction(async tx => { await lockFixtureBusiness(tx); await syncDrawingReplacement(tx, await tx.drawingReplacementJob.findUniqueOrThrow({ where: { sourceFileId: f.file.id } })); });
    const issue = await prisma.qfDocumentReturn.findFirstOrThrow({ where: { fileId: f.file.id } });
    assert.equal(issue.reason, '尺寸错误'); assert.equal(issue.responseFileId, next.id); assert.equal(issue.status, 'REVIEWING');
    assert.equal((await refresh(issue.submittedPackageId!)).status, 'REVIEWING');
    assert.equal((await prisma.qfPlanBinding.findUniqueOrThrow({ where: { workOrderId: done.id } })).packageId, f.p.id);
    assert.equal((await prisma.workOrder.findUniqueOrThrow({ where: { id: done.id } })).status, 'completed');
    await sign(issue.submittedPackageId!, 'QUALITY'); await sign(issue.submittedPackageId!, 'SUPERVISOR');
    assert.equal((await prisma.qfDocumentReturn.findUniqueOrThrow({ where: { id: issue.id } })).status, 'RESOLVED');
  });
  await t.test('generated SOP retires its publishing pointer without blocking replacement', async () => {
    const f = await fixture();
    const doc = await prisma.sopDocument.create({ data: { drawingLibraryItemId: f.product.id, title: '在线SOP', sopStage: 'validating' } });
    const version = await prisma.sopVersion.create({ data: { documentId: doc.id, version: 1, title: '在线SOP', content: {}, status: 'published' } });
    await prisma.sopDocument.update({ where: { id: doc.id }, data: { currentPublishedVersionId: version.id } });
    const file = await prisma.drawingLibraryFile.update({ where: { id: f.file.id }, data: { sourceSopVersionId: version.id } });
    await replace(file);
    const document = await prisma.sopDocument.findUniqueOrThrow({ where: { id: doc.id } });
    assert.equal(document.currentPublishedVersionId, null); assert.equal(document.sopStage, 'validating');
    assert.ok((await prisma.sopVersion.findUniqueOrThrow({ where: { id: version.id } })).deletedAt);
  });
  await t.test('queued review failure cannot roll back the committed file switch', async () => {
    const f = await fixture(), next = await replace(f.file);
    await assert.rejects(() => prisma.$transaction(async tx => { await syncDrawingReplacement(tx, await tx.drawingReplacementJob.findUniqueOrThrow({ where: { sourceFileId: f.file.id } })); throw new Error('injected downstream failure'); }));
    assert.equal((await prisma.drawingLibraryFile.findUniqueOrThrow({ where: { id: next.id } })).deletedAt, null);
    assert.ok((await prisma.drawingLibraryFile.findUniqueOrThrow({ where: { id: f.file.id } })).retiredForReplacementAt);
    assert.equal((await prisma.drawingReplacementJob.findUniqueOrThrow({ where: { sourceFileId: f.file.id } })).syncPending, true);
  });
  await prisma.$disconnect();
});
