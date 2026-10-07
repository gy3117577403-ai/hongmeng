import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { prisma } from '../lib/prisma';
import { poolCommand, previewPoolRows } from '../lib/order-pool-service';
import { matchPoolDrawing, PoolDrawingError } from '../lib/order-pool-drawings';

test('pool drawing selection: ambiguity, explicit identity, trash, immutable order binding and atomic import', {
  skip: process.env.RUN_DB_INTEGRATION !== '1', timeout: 120000,
}, async () => {
  const database = new URL(process.env.DATABASE_URL || 'postgresql://invalid/invalid');
  assert.ok(['127.0.0.1', 'localhost'].includes(database.hostname) && /(_ci|_test)$/.test(database.pathname));
  const marker = 'pool-drawing-' + randomUUID();
  const actor = await prisma.user.create({ data: { username: marker, passwordHash: 'disposable-only', displayName: '订单池资料验证' } });
  const customerName = marker + '（天津）', specification = 'GRQ20-LIDARB-V1', keys: string[] = [];
  const run = async (input: Record<string, unknown>) => {
    const requestKey = randomUUID(); keys.push(requestKey);
    return poolCommand({ ...input, requestKey }, actor.id) as Promise<{ ids: string[]; created: number; updated: number; skipped: number }>;
  };
  const row = { customerName, specification, orderQuantity: 200, unitMinutes: 5 };
  const archive = (suffix: string, extra = {}) => prisma.drawingLibraryItem.create({ data: {
    customerName, specification, productName: '原始档案', remark: '原图及工艺保留', libraryKey: marker + '-' + suffix, ...extra,
  } });
  try {
    const a = await archive('A'), b = await archive('B');
    const ambiguous = await matchPoolDrawing(row);
    assert.equal(ambiguous.matchStatus, 'CONFIRM'); assert.equal(ambiguous.candidates.length, 2);
    await assert.rejects(run({ action: 'create', row }), e => e instanceof PoolDrawingError && e.itemIds.length === 2);
    assert.equal(await prisma.productionPlanOrder.count({ where: { customerName } }), 0);
    const chosen = await matchPoolDrawing({ ...row, drawingLibraryItemId: b.id });
    assert.equal(chosen.matchStatus, 'REUSE'); assert.equal(chosen.matchedItemId, b.id);
    const result = await run({ action: 'create', row: { ...row, drawingLibraryItemId: b.id, sourceOrderNo: marker } });
    const created = await prisma.productionPlanOrder.findUniqueOrThrow({ where: { id: result.ids[0] }, include: { batches: true, poolMaterialTask: true } });
    assert.equal(created.drawingLibraryItemId, b.id); assert.equal(created.batches.length, 0);
    assert.equal(created.poolMaterialTask?.preparedQuantity, 0); assert.equal(created.customerDueDateConfirmed, false);
    assert.deepEqual(await prisma.drawingLibraryItem.findUnique({ where: { id: b.id } }), b, 'association cannot mutate source archive');
    const different = await archive('OTHER-CUSTOMER', { customerName: marker });
    const differentSpec = await archive('OTHER-SPEC', { specification: 'GRQ20-LIDARB-V2' });
    for (const id of [different.id, differentSpec.id, 'nonexistent']) {
      assert.equal((await matchPoolDrawing({ ...row, drawingLibraryItemId: id })).matchStatus, 'BLOCKED');
      await assert.rejects(run({ action: 'create', row: { ...row, drawingLibraryItemId: id } }));
    }
    const preview = await previewPoolRows([{ ...row, sourceOrderNo: marker }, { ...row, sourceOrderNo: marker + '-new' }], marker);
    assert.equal(preview[0].drawingLocked, true); assert.equal(preview[0].drawing?.matchedItemId, b.id);
    assert.equal(preview[1].drawing?.matchStatus, 'CONFIRM');
    await assert.rejects(run({ action: 'import', rows: [preview[1]] }), e => e instanceof PoolDrawingError && e.line === 2);
    const input = { ...preview[1], input: { ...preview[1].input, drawingLibraryItemId: a.id } };
    const imported = await run({ action: 'import', rows: [input] }); assert.equal(imported.created, 1);
    const repeat = await previewPoolRows([input.input], marker);
    assert.equal(repeat[0].action, 'skip'); assert.equal(repeat[0].drawing?.matchedItemId, a.id);
    assert.equal((await run({ action: 'import', rows: repeat })).skipped, 1);
    const update = await previewPoolRows([{ ...row, sourceOrderNo: marker, orderQuantity: 300 }], marker);
    await assert.rejects(run({ action: 'import', rows: [{ ...update[0], input: { ...update[0].input, drawingLibraryItemId: a.id } }], updateExisting: true }), /原订单/);
    assert.equal((await run({ action: 'import', rows: update, updateExisting: true })).updated, 1);
    assert.equal((await prisma.productionPlanOrder.findUniqueOrThrow({ where: { id: created.id } })).drawingLibraryItemId, b.id);
    await prisma.drawingLibraryItem.updateMany({ where: { id: { in: [a.id, b.id] } }, data: { deletedAt: new Date() } });
    assert.equal((await matchPoolDrawing(row)).matchStatus, 'BLOCKED');
    await assert.rejects(run({ action: 'create', row }), /回收站/);
    await assert.rejects(run({ action: 'create', row: { ...row, drawingLibraryItemId: a.id } }), /回收站/);
    const fresh = { ...row, specification: 'NEVER-EXISTED' };
    assert.equal((await matchPoolDrawing(fresh)).matchStatus, 'CREATE');
    // A stale choice in a later row rolls back earlier rows as well.
    await assert.rejects(run({ action: 'import', rows: [{ action: 'create', input: fresh }, { action: 'create', input: { ...row, drawingLibraryItemId: a.id } }] }), /回收站/);
    assert.equal(await prisma.productionPlanOrder.count({ where: { customerName, specification: fresh.specification } }), 0);
    assert.equal(await prisma.drawingLibraryItem.count({ where: { customerName, specification: fresh.specification } }), 0);
    const unique = { ...row, specification: 'UNIQUE' }; const c = await archive('C', { specification: unique.specification });
    assert.equal((await matchPoolDrawing(unique)).matchedItemId, c.id);
    await archive('C-NEW', { specification: unique.specification });
    await assert.rejects(run({ action: 'create', row: unique }), /多个/);
    const explicit = await run({ action: 'create', row: { ...unique, drawingLibraryItemId: c.id } }); assert.equal(explicit.created, 1);
  } finally {
    const orders = await prisma.productionPlanOrder.findMany({ where: { customerName }, select: { id: true } });
    await prisma.warehouseMaterialTask.deleteMany({ where: { planOrderId: { in: orders.map(o => o.id) } } });
    await prisma.productionPlanOrder.deleteMany({ where: { customerName } });
    await prisma.orderPoolCommand.deleteMany({ where: { key: { in: keys } } });
    await prisma.drawingLibraryItem.deleteMany({ where: { libraryKey: { startsWith: marker } } });
    await prisma.operationLog.deleteMany({ where: { userId: actor.id } });
    await prisma.user.delete({ where: { id: actor.id } });
  }
});
