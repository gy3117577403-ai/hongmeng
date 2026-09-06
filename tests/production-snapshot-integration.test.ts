import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { prisma } from '../lib/prisma';
import { loadProductionExecution, loadProductionWeekNavigation } from '../lib/production-execution';
import { chinaWeekRange } from '../lib/production-planning';
import { readProductionSnapshot } from '../lib/production-execution-snapshot';
import { mergeProductionBoardPage } from '../lib/production-board-pagination';

const enabled = process.env.RUN_DB_INTEGRATION === '1';
const scope = { level: 'GLOBAL' as const, canRead: true, canWrite: true, canReconcile: true, readOnly: false, teamKeys: [] };

test('database snapshot pages stay ordered through intervening writes and enforce query scope and expiration', { skip: !enabled }, async () => {
  const prefix = `IT-SNAPSHOT-${randomUUID()}`;
  const range = chinaWeekRange(new Date('2040-01-09T12:00:00Z'));
  const week = { scope: 'history' as const, weekStart: range.start, weekEnd: range.end };
  const actor = await prisma.user.create({ data: { username: prefix, displayName: prefix, passwordHash: 'test-only' } });
  const ids = Array.from({ length: 76 }, () => randomUUID());
  await prisma.workOrder.createMany({ data: ids.map((id, index) => ({ id, code: `${prefix}-${index}`, customerName: prefix,
    productName: prefix, specification: prefix, stage: 'frontend', status: 'processing', planActive: true, planType: 'managed_plan',
    weekStartDate: range.start, weekEndDate: range.end, productionTargetQty: 40, uncompletedQty: '40', completedQty: '0' })) });
  const plan = await prisma.productionPlanOrder.create({ data: {
    sourceOrderNo: prefix, sourceLineNo: 1, customerName: prefix, productName: prefix, specification: prefix,
    orderQuantity: 3040, orderDate: range.start, customerDueDate: range.end, createdById: actor.id, updatedById: actor.id,
    batches: { create: ids.map((id, index) => ({ batchNo: index + 1, quantity: 40, weekStartDate: range.start,
      weekEndDate: range.end, plannedCompletionDate: range.end, releaseState: 'active', workOrderId: id })) },
  } });
  let token: string | null = null;
  try {
    const input = { week, filters: { keyword: prefix }, productionScope: scope, pageSize: 60, snapshotMode: true };
    const first = await loadProductionExecution(input);
    token = first.pagination.snapshotToken;
    assert.ok(token); assert.equal(first.items.length, 60); assert.equal(first.pagination.total, 76);
    const lastIds = ids.filter(id => !first.items.some(item => item.id === id));
    // This priority edit would move an unread row ahead of page one in a new
    // offset query. The continuation must still return it exactly once.
    await prisma.workOrder.update({ where: { id: lastIds[0] }, data: { priority: 'urgent' } });
    const second = await loadProductionExecution({ ...input, offset: 60, snapshotToken: token });
    assert.equal(second.items.length, 16); assert.equal(second.pagination.loadedOffset, 76);
    assert.deepEqual(new Set(mergeProductionBoardPage(first, second).items.map(item => item.id)), new Set(ids));
    const rows = await prisma.productionExecutionSnapshotRow.count({ where: { snapshotId: token } });
    assert.equal(rows, 76);
    await assert.rejects(loadProductionExecution({ ...input, offset: 60, snapshotToken: token, filters: { keyword: 'different' } }), { code: 'PRODUCTION_SNAPSHOT_EXPIRED' });
    await assert.rejects(loadProductionExecution({ ...input, offset: 60, snapshotToken: token, productionScope: { ...scope, level: 'TEAM', teamKeys: ['different'] } }), { code: 'PRODUCTION_SNAPSHOT_EXPIRED' });
    await prisma.workOrder.update({ where: { id: lastIds[1] }, data: { deletedAt: new Date() } });
    const afterDelete = await loadProductionExecution({ ...input, offset: 60, snapshotToken: token });
    assert.equal(afterDelete.items.length, 15); assert.equal(afterDelete.pagination.loadedOffset, 76);
    assert.equal(mergeProductionBoardPage(first, afterDelete).pagination.loadedOffset, 76, 'consumed snapshot slots, not visible item count');
    await prisma.productionExecutionSnapshot.update({ where: { id: token }, data: { expiresAt: new Date(0) } });
    await assert.rejects(readProductionSnapshot({ token, queryKey: '', offset: 60, pageSize: 60 }), { code: 'PRODUCTION_SNAPSHOT_EXPIRED' });
  } finally {
    if (token) await prisma.productionExecutionSnapshot.delete({ where: { id: token } });
    await prisma.productionPlanOrder.delete({ where: { id: plan.id } });
    await prisma.workOrder.deleteMany({ where: { id: { in: ids } } });
    await prisma.user.delete({ where: { id: actor.id } });
  }
});

test('history week aggregation includes batches beyond the old 5000-row cutoff', { skip: !enabled }, async () => {
  const prefix = `IT-HISTORY-${randomUUID()}`;
  const actor = await prisma.user.create({ data: { username: prefix, displayName: prefix, passwordHash: 'test-only' } });
  const oldWeek = new Date('2000-12-25T00:00:00Z'); const oldEnd = new Date('2000-12-31T00:00:00Z');
  const nextWeek = new Date('2001-01-01T00:00:00Z'); const nextEnd = new Date('2001-01-07T00:00:00Z');
  const before = await loadProductionWeekNavigation(new Date(), scope);
  const countBefore = before.history.find(item => item.weekStartDate === '2000-12-25')?.normalBatchCount || 0;
  const plan = await prisma.productionPlanOrder.create({ data: { sourceOrderNo: prefix, sourceLineNo: 1,
    customerName: prefix, productName: prefix, specification: prefix, orderQuantity: 5002, orderDate: oldWeek, customerDueDate: nextEnd,
    createdById: actor.id, updatedById: actor.id } });
  try {
    for (let start = 0; start < 5002; start += 500) await prisma.productionPlanBatch.createMany({
      data: Array.from({ length: Math.min(500, 5002 - start) }, (_, index) => ({ planOrderId: plan.id, batchNo: start + index + 1,
        quantity: 1, weekStartDate: start + index === 0 ? oldWeek : nextWeek,
        weekEndDate: start + index === 0 ? oldEnd : nextEnd, plannedCompletionDate: nextEnd, releaseState: 'active' })),
    });
    const after = await loadProductionWeekNavigation(new Date(), scope);
    assert.equal(after.history.find(item => item.weekStartDate === '2000-12-25')?.normalBatchCount, countBefore + 1);
    assert.ok((after.history.find(item => item.weekStartDate === '2001-01-01')?.normalBatchCount || 0) >= 5001);
  } finally { await prisma.productionPlanOrder.delete({ where: { id: plan.id } }); await prisma.user.delete({ where: { id: actor.id } }); }
});
