import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { prisma } from '../lib/prisma';
import { mutateQualityFixture, assertFixturePrintReady, lockFixtureBusiness } from '../lib/quality-fixture-service';
import { syncProductDocuments } from '../lib/quality-fixture-sync';
import { loadDocumentReturns } from '../lib/quality-document-returns';
import { loadQualityFixtures, qualityFixtureBadges } from '../lib/quality-fixture-queries';
import type { PcInput } from '../lib/purchasing-domain';

test('document review stays actionable across pending replacement and legacy return chains', { skip: process.env.RUN_DB_INTEGRATION !== '1' }, async t => {
  const tag = 'REVIEW253-' + randomUUID().slice(0, 8);
  const makeUser = (role: string) => prisma.user.create({ data: { username: tag + role, displayName: role, passwordHash: 'disposable', ...(role === 'admin' ? { laborRole: 'ADMIN' } : {}) } });
  const [admin, tech, supervisor, quality] = await Promise.all(['admin', 'tech', 'supervisor', 'quality'].map(makeUser));
  const cmd = (input: PcInput, actor = tech, key = randomUUID()) => mutateQualityFixture(input, actor, key) as Promise<any>;
  const setting = await prisma.qfSettings.findUnique({ where: { id: 'quality-fixtures' } });
  await cmd({ action: 'SAVE_SETTINGS', version: setting?.version, supervisorIds: [supervisor.id], qualityIds: [quality.id], technicalIds: [tech.id] }, admin);
  const cats = await Promise.all(['drawing', 'sop'].map(code => prisma.resourceCategory.upsert({ where: { code }, update: {}, create: { code, name: code, sortOrder: 0 } })));
  const pack = (id: string) => prisma.qfPackage.findUniqueOrThrow({ where: { id } });
  const issue = (id: string) => prisma.qfDocumentReturn.findUniqueOrThrow({ where: { id } });
  async function create() {
    const key = tag + randomUUID().slice(0, 6);
    const product = await prisma.drawingLibraryItem.create({ data: { libraryKey: key, customerName: tag, specification: key, fixtureRequired: false,
      files: { create: cats.map(c => ({ categoryId: c.id, originalName: c.code + '.pdf', mimeType: 'application/pdf', objectKey: key + '/' + c.code, size: 10, version: 'V1', uploadedById: tech.id })) } }, include: { files: true } });
    const order = await prisma.workOrder.create({ data: { code: key, productName: key, stage: 'frontend', drawingLibraryItemId: product.id, documentReviewRequired: true, planActive: true, weekStartDate: new Date('2026-09-28T00:00:00+08:00') } });
    const p = await cmd({ action: 'SAVE_PACKAGE', libraryItemId: product.id, revision: 'V1.0', needFixture: false,
      drawingFileIds: product.files.filter(f => f.categoryId === cats[0].id).map(f => f.id), sopFileIds: product.files.filter(f => f.categoryId === cats[1].id).map(f => f.id) });
    await cmd({ action: 'SUBMIT', id: p.id, version: p.version });
    return { product, order, p, sop: product.files.find(f => f.categoryId === cats[1].id)! };
  }
  async function reject(f: Awaited<ReturnType<typeof create>>) {
    await cmd({ action: 'RETURN', id: f.p.id, version: (await pack(f.p.id)).version, reviewRole: 'QUALITY', reason: 'SOP 流程不明确', fileIds: [f.sop.id] }, quality);
    return prisma.qfDocumentReturn.findFirstOrThrow({ where: { sourcePackageId: f.p.id } });
  }
  const reply = async (id: string, extra = {}) => cmd({ action: 'RESPOND_RETURN', id, version: (await issue(id)).version, mode: 'EXPLAIN', reason: '已核对工艺流程并补充解释', ...extra });
  const resubmit = async (id: string) => { const items = await prisma.qfDocumentReturn.findMany({ where: { libraryItemId: id, status: { not: 'RESOLVED' } } }); return cmd({ action: 'RESUBMIT_RETURNS', libraryItemId: id, versions: Object.fromEntries(items.map(i => [i.id, i.version])) }); };
  const sign = async (id: string, role: 'SUPERVISOR' | 'QUALITY') => cmd({ action: 'APPROVE', id, version: (await pack(id)).version, reviewRole: role, confirmed: true }, role === 'SUPERVISOR' ? supervisor : quality);
  async function replace(f: Awaited<ReturnType<typeof create>>, sync: boolean) {
    return prisma.$transaction(async tx => {
      await lockFixtureBusiness(tx);
      await tx.drawingLibraryFile.update({ where: { id: f.sop.id }, data: { isCurrent: false } });
      const file = await tx.drawingLibraryFile.create({ data: { libraryItemId: f.product.id, categoryId: cats[1].id, originalName: 'SOP-V2.pdf', objectKey: f.sop.objectKey + '-v2', mimeType: 'application/pdf', size: 15, version: 'V2', supersedesFileId: f.sop.id, uploadedById: tech.id } });
      if (sync) await syncProductDocuments(tx, f.product.id, tech);
      return file;
    });
  }
  await t.test('return → resubmit → one signature → replacement → fresh dual review → matching plan and return states', async () => {
    const f = await create(), r = await reject(f); await reply(r.id);
    const second = await resubmit(f.product.id); await sign(second.id, 'SUPERVISOR');
    const newFile = await replace(f, true);
    assert.equal((await pack(second.id)).status, 'STALE'); assert.equal((await pack(second.id)).supervisorId, supervisor.id);
    assert.equal((await issue(r.id)).status, 'OPEN'); assert.ok((await issue(r.id)).responseText);
    assert.equal((await loadDocumentReturns(f.product.id)).review.state, 'RETURN_OPEN');
    await assert.rejects(() => sign(second.id, 'QUALITY'), /不在待审核/);
    await assert.rejects(() => resubmit(f.product.id), /先逐项/);
    await reply(r.id, { mode: 'REPLACE', fileId: newFile.id, reason: '修订 SOP 后重新核对' });
    const third = await resubmit(f.product.id);
    assert.equal((await pack(third.id)).supervisorAt, null); assert.equal((await pack(third.id)).qualityAt, null);
    await sign(third.id, 'QUALITY'); await assert.rejects(() => assertFixturePrintReady(prisma, f.order.id), /双方审核/);
    await sign(third.id, 'SUPERVISOR'); assert.equal((await issue(r.id)).status, 'RESOLVED');
    assert.ok(await assertFixturePrintReady(prisma, f.order.id));
    const badge = (await qualityFixtureBadges([f.order.id], 'orders'))[0]; assert.equal(badge.reviewLabel, '资料已审核'); assert.equal(badge.printAllowed, true);
    const board = await loadQualityFixtures(new URLSearchParams({ product: f.product.id }), tech); assert.equal(board.reviewDecision.state, 'APPROVED');
  });
  await t.test('legacy whole-package REVIEWING + newer draft repairs without fake approval or duplicate rounds', async () => {
    const f = await create(), r = await reject(f);
    await prisma.qfDocumentReturn.update({ where: { id: r.id }, data: { kind: 'package', fileId: null, fileSnapshot: { name: '历史整包退回', version: 'V1.0' } } });
    await reply(r.id); const second = await resubmit(f.product.id), old = await pack(second.id);
    const draft = await prisma.qfPackage.create({ data: { libraryItemId: old.libraryItemId, sequence: old.sequence + 1, revision: old.revision, needFixture: old.needFixture,
      drawingFiles: old.drawingFiles!, sopFiles: old.sopFiles!, sourceSignature: old.sourceSignature, fingerprint: old.fingerprint, bomRows: [], createdById: tech.id } });
    assert.equal((await loadDocumentReturns(f.product.id)).review.state, 'REPAIR');
    const body = { action: 'RECONCILE_REVIEW', libraryItemId: f.product.id, id: draft.id, version: draft.version }, key = randomUUID();
    await cmd(body, tech, key); await cmd(body, tech, key);
    assert.equal((await issue(r.id)).status, 'READY'); assert.equal((await pack(draft.id)).status, 'DRAFT');
    assert.equal((await loadDocumentReturns(f.product.id)).review.actionLabel, '重新提交审核');
    const third = await resubmit(f.product.id); assert.equal(third.id, draft.id);
    const filtered = await loadQualityFixtures(new URLSearchParams({ product: f.product.id, status: 'RETURNED' }), tech);
    assert.equal(filtered.product?.id, f.product.id, 'submitted product stays open after leaving the returned filter');
    assert.equal(filtered.reviewDecision.action, 'REVIEW');
    const before = await issue(r.id); await cmd({ action: 'RECONCILE_REVIEW', libraryItemId: f.product.id });
    assert.equal((await issue(r.id)).version, before.version, 'valid pending review is unchanged');
    assert.equal((await loadDocumentReturns(f.product.id)).review.action, 'REVIEW');
    await sign(third.id, 'SUPERVISOR'); await sign(third.id, 'QUALITY'); assert.equal((await issue(r.id)).status, 'RESOLVED');
  });
  await t.test('source change rejects a stale approval even before queued synchronization', async () => {
    const f = await create(); await sign(f.p.id, 'SUPERVISOR'); await replace(f, false);
    await assert.rejects(() => sign(f.p.id, 'QUALITY'), /已有更新/);
    assert.equal((await pack(f.p.id)).qualityAt, null);
  });
  await t.test('a stopped current round can be resubmitted even when its files have not changed', async () => {
    const f = await create(), r = await reject(f); await reply(r.id);
    const second = await resubmit(f.product.id);
    await prisma.qfDocumentReturn.update({ where: { id: r.id }, data: { status: 'READY' } });
    await cmd({ action: 'RECONCILE_REVIEW', libraryItemId: f.product.id });
    assert.equal((await pack(second.id)).status, 'STALE');
    const next = await resubmit(f.product.id);
    assert.notEqual(next.id, second.id);
    assert.equal((await pack(next.id)).status, 'REVIEWING');
  });
});
test.after(() => prisma.$disconnect());
