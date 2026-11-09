import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { prisma } from '../lib/prisma';
import { ensureSampleWarehouse } from '../lib/sample-plan-operations';
import { reportSampleShortages } from '../lib/material-exception-service';
import { readMaterialOrder, mutateMaterialOrder } from '../lib/material-order-service';

test('sample arrival uses the shared physical ledger, supports optional quantity and atomically confirms the last item', { skip: process.env.RUN_DB_INTEGRATION !== '1' }, async () => {
  const db = new URL(process.env.DATABASE_URL!); assert.ok(['127.0.0.1', 'localhost'].includes(db.hostname) && /_test$|_ci$/.test(db.pathname));
  const tag = 'SAMPLE-ARRIVAL-' + randomUUID().slice(0, 8);
  const user = await prisma.user.create({ data: { username: tag, displayName: '样品到料验收', passwordHash: 'not-a-login' } });
  const item = await prisma.drawingLibraryItem.create({ data: { libraryKey: tag, specification: tag, customerName: '测试客户' } });
  const task = await prisma.sampleTask.create({ data: { code: tag, qrCode: tag, drawingLibraryItemId: item.id, customerNameSnapshot: '测试客户', specificationSnapshot: tag, taskType: 'REPEAT', sampleQuantity: 3, createdById: user.id, createdByName: user.displayName } });
  const warehouse = await prisma.$transaction(tx => ensureSampleWarehouse(tx, task));
  assert.ok(warehouse);
  let order = await readMaterialOrder(warehouse.id);
  const change = async (action: string, values: Record<string, unknown> = {}) => { order = await mutateMaterialOrder(order.id, { action, version: order.version, requestKey: randomUUID(), workspace: 'warehouse', ...values }, user.id, true); return order; };
  const baseline = await prisma.sampleTask.findUniqueOrThrow({ where: { id: task.id } });
  try {
    await reportSampleShortages(task.id, { version: order.version, shortages: [{ materialModel: '客供连接器', supplySource: 'CUSTOMER', shortageQuantity: 3, unit: '个' }, { materialModel: '采购胶管', supplySource: 'PURCHASED', shortageQuantity: null, unit: '米' }] }, user.id, true);
    order = await readMaterialOrder(order.id); const [known, unknown] = order.events;
    await assert.rejects(change('complete'), /缺料/);
    await assert.rejects(change('confirm_arrival', { exceptionId: known.id, quantity: 4 }), /超过/);
    await change('confirm_arrival', { exceptionId: known.id, quantity: 1 });
    assert.equal(order.events[0].missing, 2);
    const pending = { action: 'confirm_arrival', exceptionId: known.id, quantity: '', version: order.version, requestKey: randomUUID() };
    order = await mutateMaterialOrder(order.id, pending, user.id, true); await mutateMaterialOrder(order.id, pending, user.id, true);
    const batch = order.events[0].arrivals.find(a => a.status === 'QUANTITY_PENDING')!;
    assert.ok(batch); assert.equal(batch.quantity, null); assert.equal(order.events[0].usable, 1);
    await assert.rejects(change('complete'), /缺料/);
    await assert.rejects(change('confirm_arrival', { exceptionId: known.id, arrivalId: batch.id, quantity: '', confirmComplete: true }), /待补录/);
    await change('confirm_arrival', { exceptionId: known.id, arrivalId: batch.id, quantity: 2 });
    assert.equal(order.events[0].status, 'RESOLVED'); assert.equal(order.status, 'exception');
    const final = { action: 'confirm_arrival', exceptionId: unknown.id, quantity: '', itemComplete: true, confirmComplete: true, note: '现场核对胶管已全部补齐', version: order.version, requestKey: randomUUID() };
    const twice = await Promise.all([mutateMaterialOrder(order.id, final, user.id, true), mutateMaterialOrder(order.id, final, user.id, true)]);
    assert.equal(twice[0].status, 'completed'); assert.equal(twice[1].version, twice[0].version);
    assert.equal(twice[0].events[0].usable, 3); assert.equal(twice[0].events[1].arrivals.length, 0, 'unknown required amount is not invented');
    const after = await prisma.sampleTask.findUniqueOrThrow({ where: { id: task.id } });
    assert.equal(after.status, baseline.status); assert.equal(after.completedQuantity, baseline.completedQuantity); assert.equal(after.completedAt, null);
    assert.equal(await prisma.materialFollowUpTask.count({ where: { warehouseTaskId: order.id, status: { not: 'RESOLVED' } } }), 0);
  } finally {
    await prisma.warehouseMaterialTask.delete({ where: { id: warehouse.id } });
    await prisma.sampleTask.delete({ where: { id: task.id } });
    await prisma.drawingLibraryItem.delete({ where: { id: item.id } });
    await prisma.user.delete({ where: { id: user.id } }); await prisma.$disconnect();
  }
});
