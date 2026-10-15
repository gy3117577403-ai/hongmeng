import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { prisma } from '../lib/prisma';
import { mutateMaterialOrder, readMaterialOrder } from '../lib/material-order-service';
import { materialOrderFilterWhere } from '../lib/material-order-filters';
import { poolWarehouseQueue } from '../lib/order-pool-warehouse';

test('arrival outcomes, duplicate audit and shared queue counts', { skip: process.env.RUN_DB_INTEGRATION !== '1' }, async t => {
  const marker = 'arrival272-' + randomUUID();
  const actor = await prisma.user.create({ data: { username: marker, displayName: marker, passwordHash: 'test-only' } });
  const plan = await prisma.productionPlanOrder.create({ data: { sourceOrderNo: marker, sourceLineNo: 1, productName: marker, specification: marker, customerName: marker, orderQuantity: 30, orderDate: new Date(), customerDueDate: new Date() } });
  let order = await readMaterialOrder((await prisma.warehouseMaterialTask.create({ data: { planOrderId: plan.id } })).id);
  const change = async (action: string, values: Record<string, unknown> = {}, canConfirm = true) => {
    order = await mutateMaterialOrder(order.id, { action, version: order.version, requestKey: randomUUID(), exceptionType: 'shortage', ...values }, actor.id, canConfirm);
    return order;
  };
  const sqlCount = (status: string, source = 'ALL') => prisma.warehouseMaterialTask.count({ where: { AND: [{ id: order.id }, materialOrderFilterWhere(status, source)] } });
  const poolCount = async (status: string, source = 'ALL') => (await poolWarehouseQueue(new URLSearchParams({ q: marker, status, source, view: 'tracking' }))).pagination.total;
  let first = '';
  try {
    await t.test('legacy unknown-quantity receipt becomes pending confirmation, not an asserted shortage', async () => {
      await change('report_exception', { materialModel: '定子', supplySource: 'PURCHASED', shortageQuantity: '', unit: '件' });
      first = order.events[0].id;
      await change('confirm_arrival', { exceptionId: first, quantity: 20 });
      assert.equal(order.events[0].phase, 'NEEDS_COMPLETION');
      assert.equal(order.shortageCount, 0); assert.equal(order.completionCount, 1);
      assert.equal(order.state, 'COMPLETION');
      for (const status of ['shortage', 'unknown', 'late']) {
        assert.equal(await sqlCount(status), 0); assert.equal(await poolCount(status), 0);
      }
      assert.equal(await sqlCount('completion'), 1); assert.equal(await poolCount('completion'), 1);
      await assert.rejects(change('confirm_outcome', { exceptionId: first, arrivalOutcome: 'COMPLETE', note: '实物核对' }, false), /权限/);
    });
    await t.test('explicit partial arrival remains missing; completion cannot ignore shipments', async () => {
      await change('confirm_outcome', { exceptionId: first, arrivalOutcome: 'PARTIAL', note: '另有 60 件待补' });
      assert.equal(order.events[0].phase, 'PARTIAL'); assert.equal(order.shortageCount, 1);
      assert.equal(await sqlCount('shortage'), 1); assert.equal(await poolCount('shortage'), 1);
      assert.equal(await sqlCount('completion'), 0);
      await change('record_shipment', { exceptionId: first, quantity: 60, logisticsMode: 'PICKUP' });
      await assert.rejects(change('confirm_outcome', { exceptionId: first, arrivalOutcome: 'COMPLETE', note: '不能漏掉批次' }), /批次/);
      const batch = order.events[0].arrivals.find(b => b.status === 'SHIPPED')!;
      const input = { action: 'confirm_arrival', version: order.version, requestKey: randomUUID(), exceptionId: first, arrivalId: batch.id, quantity: 60, arrivalOutcome: 'COMPLETE' };
      order = await mutateMaterialOrder(order.id, input, actor.id, true);
      await mutateMaterialOrder(order.id, input, actor.id, true);
      assert.equal(order.events[0].status, 'RESOLVED'); assert.equal(order.events[0].usable, 80);
      assert.equal(order.events[0].arrivals.length, 2); assert.equal(order.shortageCount, 0);
      assert.notEqual(order.state, 'READY', 'material pieces cannot automatically become prepared product sets');
    });
    await t.test('same model different sources stays independent until an audited duplicate correction', async () => {
      await change('report_exception', { materialModel: '定子', supplySource: 'CUSTOMER', shortageQuantity: '', unit: '件' });
      const duplicate = order.events[1].id;
      assert.equal(order.openCount, 1); assert.equal(order.shortageCount, 1);
      assert.equal(await sqlCount('shortage', 'PURCHASED'), 0); assert.equal(await poolCount('shortage', 'CUSTOMER'), 1);
      await assert.rejects(change('cancel_duplicate', { exceptionId: duplicate, referenceExceptionId: first, note: '核对重复' }), /确认/);
      await change('cancel_duplicate', { exceptionId: duplicate, referenceExceptionId: first, confirmDuplicate: true, note: '核对为同一需求，采购事项已到 80 件' });
      assert.equal(order.events[1].status, 'CANCELLED'); assert.equal(order.events[0].usable, 80);
      assert.equal(order.openCount, 0); assert.equal(await poolCount('shortage'), 0);
      const follow = await prisma.materialFollowUpTask.findUniqueOrThrow({ where: { warehouseExceptionId: duplicate } });
      assert.equal(follow.status, 'CANCELLED'); assert.ok(follow.resolvedAt);
      assert.ok(order.activities.some(a => a.action === 'cancel_duplicate' && a.content.includes('同一需求')));
    });
    await t.test('fully arrived known quantity waits for verification; rejected material remains missing', async () => {
      await change('report_exception', { materialModel: '连接器', supplySource: 'PURCHASED', shortageQuantity: 10, unit: '件' });
      const id = order.events[2].id;
      await change('report_arrival', { exceptionId: id, quantity: 10, logisticsMode: 'PICKUP' }, false);
      assert.equal(order.events[2].phase, 'WAITING_VERIFY'); assert.equal(order.shortageCount, 0);
      assert.equal(await sqlCount('shortage'), 0); assert.equal(await poolCount('shortage'), 0);
      assert.equal(await sqlCount('waiting'), 1); assert.equal(await poolCount('waiting'), 1);
      await change('confirm_arrival', { exceptionId: id, arrivalId: order.events[2].arrivals[0].id, quantity: 10, acceptedQuantity: 8, note: '两件错料待补' });
      assert.equal(order.shortageCount, 1); assert.equal(order.events[2].missing, 2);
      await assert.rejects(change('cancel_duplicate', { exceptionId: id, referenceExceptionId: first, confirmDuplicate: true, note: '不同型号' }), /同型号/);
      await change('confirm_arrival', { exceptionId: id, quantity: 2 });
      assert.equal(order.events[2].status, 'RESOLVED'); assert.equal(await sqlCount('shortage'), 0);
    });
    await t.test('a same-model item containing receipts cannot be erased as an empty duplicate', async () => {
      await change('report_exception', { materialModel: '定子', supplySource: 'CUSTOMER', shortageQuantity: '', unit: '件' });
      const id = order.events.at(-1)!.id;
      await change('confirm_arrival', { exceptionId: id, quantity: 1, arrivalOutcome: 'PARTIAL' });
      await assert.rejects(change('cancel_duplicate', { exceptionId: id, referenceExceptionId: first, confirmDuplicate: true, note: '不能丢失到料' }), /已有发货或到料/);
      assert.equal((await readMaterialOrder(order.id)).events.at(-1)!.usable, 1);
    });
  } finally {
    await prisma.warehouseMaterialTask.delete({ where: { id: order.id } });
    await prisma.productionPlanOrder.delete({ where: { id: plan.id } });
    await prisma.operationLog.deleteMany({ where: { userId: actor.id } });
    await prisma.user.delete({ where: { id: actor.id } });
    await prisma.$disconnect();
  }
});
