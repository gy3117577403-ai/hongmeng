import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { prisma } from '../lib/prisma';
import { changeDrawingLibraryLifecycle } from '../lib/drawing-library-admin';
import { findDrawingProductCandidates, resolveOrCreateDrawingProduct } from '../lib/drawing-library-resolution';

const enabled = process.env.DRAWING_LIBRARY_QA_ALLOW === 'disposable-drawing-runtime';
test('drawing archive identity, deletion, restore and concurrent references in PostgreSQL', { skip: !enabled }, async t => {
  assert.ok(['127.0.0.1', 'localhost'].includes(new URL(process.env.DATABASE_URL!).hostname), 'isolated local database required');
  const prefix = `DRAWING-QA-${randomUUID().slice(0, 8)}`;
  const actor = await prisma.user.create({ data: { username: prefix, displayName: '图纸规则验收', passwordHash: 'unused-for-http', laborRole: 'ADMIN' } });
  const category = await prisma.resourceCategory.create({ data: { code: prefix, name: '验收文件', sortOrder: 99 } });
  const create = (spec: string, customerName = prefix) => prisma.$transaction(tx => resolveOrCreateDrawingProduct(tx, { customerName, specification: spec, productName: '测试线束' }));
  const file = (libraryItemId: string, extra = {}) => prisma.drawingLibraryFile.create({ data: { libraryItemId, categoryId: category.id, originalName: 'qa.pdf', mimeType: 'application/pdf', size: 4, objectKey: `qa/${randomUUID()}.pdf`, ...extra } });
  try {
    await t.test('concurrent alias creation reuses one archive without renaming it', async () => {
      const spec = prefix + '-RACE';
      const [a, b] = await Promise.all([create(spec, prefix + '(10199)'), create(spec, prefix)]);
      assert.equal(a.id, b.id);
      assert.equal(await prisma.drawingLibraryItem.count({ where: { specification: spec } }), 1);
    });
    await t.test('normalized matching is not truncated to 100 candidate records', async () => {
      const spec = prefix + '-FULL';
      await prisma.drawingLibraryItem.createMany({ data: Array.from({ length: 105 }, (_, i) => ({ customerName: prefix + i, specification: spec, libraryKey: prefix + i + spec })) });
      const original = await create(spec, prefix + '(10033)');
      const found = await findDrawingProductCandidates(prisma, { customerName: prefix, specification: spec.toLowerCase() });
      assert.equal(found.length, 1); assert.equal(found[0].id, original.id);
    });
    await t.test('empty archive delete and restore preserve ID and write audit reasons', async () => {
      const item = await create(prefix + '-EMPTY');
      await assert.rejects(changeDrawingLibraryLifecycle(item.id, actor.id, 'delete', ' '), /操作原因/);
      await changeDrawingLibraryLifecycle(item.id, actor.id, 'delete', '清理空档案');
      assert.ok((await prisma.drawingLibraryItem.findUniqueOrThrow({ where: { id: item.id } })).deletedAt);
      await assert.rejects(create(item.specification), /管理员先恢复/);
      await changeDrawingLibraryLifecycle(item.id, actor.id, 'restore', '恢复误删');
      assert.equal((await prisma.drawingLibraryItem.findUniqueOrThrow({ where: { id: item.id } })).deletedAt, null);
      const logs = await prisma.operationLog.findMany({ where: { targetId: item.id }, orderBy: { createdAt: 'asc' } });
      assert.deepEqual(logs.map(log => log.action), ['delete_drawing_library_item', 'restore_drawing_library_item']);
      assert.equal((logs[1].detail as { reason: string }).reason, '恢复误删');
    });
    await t.test('a noncurrent undeleted file blocks archive deletion; deleted files stay deleted after restore', async () => {
      const item = await create(prefix + '-HISTORY');
      const stored = await file(item.id, { isCurrent: false, sha256: 'a'.repeat(64) });
      await assert.rejects(changeDrawingLibraryLifecycle(item.id, actor.id, 'delete', '历史版本检查'), /未删除文件/);
      await prisma.drawingLibraryFile.update({ where: { id: stored.id }, data: { deletedAt: new Date() } });
      await changeDrawingLibraryLifecycle(item.id, actor.id, 'delete', '资料已删除');
      await assert.rejects(file(item.id), /DRAWING_LIBRARY_DELETED/);
      await assert.rejects(prisma.drawingLibraryFile.update({ where: { id: stored.id }, data: { deletedAt: null } }), /DRAWING_LIBRARY_DELETED/);
      await changeDrawingLibraryLifecycle(item.id, actor.id, 'restore', '恢复档案');
      const after = await prisma.drawingLibraryFile.findUniqueOrThrow({ where: { id: stored.id } });
      assert.ok(after.deletedAt); assert.equal(after.objectKey, stored.objectKey); assert.equal(after.sha256, stored.sha256);
    });
    await t.test('active plans and product time definitions block deletion', async () => {
      const planned = await create(prefix + '-PLAN');
      await prisma.productionPlanOrder.create({ data: { sourceOrderNo: prefix, sourceLineNo: 1, customerName: prefix, productName: '测试', specification: planned.specification, drawingLibraryItemId: planned.id, orderQuantity: 5, orderDate: new Date(), customerDueDate: new Date() } });
      await assert.rejects(changeDrawingLibraryLifecycle(planned.id, actor.id, 'delete', '引用检查'), /活动计划/);
      const timed = await create(prefix + '-TIME');
      await prisma.productTimeProfile.create({ data: { drawingLibraryItemId: timed.id, version: 1 } });
      await assert.rejects(changeDrawingLibraryLifecycle(timed.id, actor.id, 'delete', '工时引用检查'), /工时配置/);
    });
    await t.test('restore refuses a new conflicting active archive', async () => {
      const item = await create(prefix + '-CONFLICT', prefix + '(10033)');
      await changeDrawingLibraryLifecycle(item.id, actor.id, 'delete', '暂时停用');
      await prisma.drawingLibraryItem.create({ data: { customerName: prefix, specification: item.specification, libraryKey: prefix + item.specification } });
      await assert.rejects(changeDrawingLibraryLifecycle(item.id, actor.id, 'restore', '检查冲突'), /活动档案/);
      assert.ok((await prisma.drawingLibraryItem.findUniqueOrThrow({ where: { id: item.id } })).deletedAt);
    });
    await t.test('deletion waits for an in-flight attachment then refuses to hide it', async () => {
      const item = await create(prefix + '-UPLOAD-RACE');
      let release!: () => void; let attached!: () => void;
      const gate = new Promise<void>(resolve => { release = resolve; });
      const ready = new Promise<void>(resolve => { attached = resolve; });
      const upload = prisma.$transaction(async tx => {
        await tx.drawingLibraryFile.create({ data: { libraryItemId: item.id, categoryId: category.id, originalName: 'race.pdf', mimeType: 'application/pdf', size: 4, objectKey: 'qa/' + randomUUID() } });
        attached(); await gate;
      });
      await ready;
      const deletion = changeDrawingLibraryLifecycle(item.id, actor.id, 'delete', '并发引用检查');
      const rejected = assert.rejects(deletion, /未删除文件/);
      release(); await upload; await rejected;
      assert.equal((await prisma.drawingLibraryItem.findUniqueOrThrow({ where: { id: item.id } })).deletedAt, null);
    });
  } finally { await prisma.$disconnect(); }
});
