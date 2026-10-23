import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { prisma } from '../lib/prisma';
import { readMaterialOrder, mutateMaterialOrder } from '../lib/material-order-service';
import { poolCommand } from '../lib/order-pool-service';

test('batch verification closes pool preparation only with explicit sets; rollback, idempotence and partial shortages', { skip: process.env.RUN_DB_INTEGRATION !== '1', timeout: 60000 }, async () => {
  const db = new URL(process.env.DATABASE_URL!);
  assert.ok(['127.0.0.1', 'localhost'].includes(db.hostname) && /(_ci|_test)$/.test(db.pathname));
  const marker = 'batch-material-' + randomUUID();
  const actor = await prisma.user.create({ data: { username: marker, displayName: '隔离验收', passwordHash: 'test' } });
  const created = await poolCommand({ action: 'create', requestKey: randomUUID(), row: {
    customerName: marker, specification: marker, productName: '线束', sourceOrderNo: marker, sourceLineNo: 1, orderQuantity: 25, preparationQuantity: 25, unitMinutes: 1,
  } }, actor.id) as { ids: string[] };
  const task = await prisma.warehouseMaterialTask.findUniqueOrThrow({ where: { planOrderId: created.ids[0] } });
  let order = await readMaterialOrder(task.id);
  const change = async (action: string, body: Record<string, unknown> = {}, canConfirm = true) => order = await mutateMaterialOrder(task.id, { action, version: order.version, requestKey: randomUUID(), ...body }, actor.id, canConfirm);
  for (const [model, quantity] of [['A', 50], ['B', 50], ['C', 100]] as const) {
    await change('report_exception', { materialModel: model, supplySource: 'PURCHASED', shortageQuantity: quantity, unit: '个', exceptionType: 'shortage' });
    const item = order.events.find(e => e.model === model)!;
    await change('record_shipment', { exceptionId: item.id, quantity, logisticsMode: 'PICKUP' }, false);
    const batch = order.events.find(e => e.id === item.id)!.arrivals[0];
    assert.equal(batch.status, 'SHIPPED');
    await assert.rejects(change('verify_arrivals', { entries: [{ arrivalId: batch.id, acceptedQuantity: quantity }] }), /尚未报到/);
    await change('report_arrival', { exceptionId: item.id, arrivalId: batch.id }, false);
  }
  const entries = order.events.map(e => ({ arrivalId: e.arrivals[0].id, acceptedQuantity: e.required }));
  await assert.rejects(change('verify_arrivals', { entries }, false), /权限/);
  await assert.rejects(change('verify_arrivals', { entries: [...entries, entries[0]] }), /重复/);
  await assert.rejects(change('verify_arrivals', { entries: [entries[0], { arrivalId: randomUUID(), acceptedQuantity: 1 }] }), /不属于/);
  assert.equal((await readMaterialOrder(task.id)).events[0].usable, 0, 'invalid sibling rolls back the complete batch');
  await assert.rejects(change('verify_arrivals', { entries, confirmComplete: true, physicalConfirmed: true, preparedQuantity: 50 }), /数量|目标/);
  assert.equal((await readMaterialOrder(task.id)).events[0].usable, 0);
  const request = { action: 'verify_arrivals', entries, version: order.version, requestKey: randomUUID(), confirmComplete: true, physicalConfirmed: true, preparedQuantity: 25 };
  order = await mutateMaterialOrder(task.id, request, actor.id, true);
  await mutateMaterialOrder(task.id, request, actor.id, true);
  assert.equal(order.preparedQuantity, 25); assert.equal(order.openCount, 0); assert.equal(order.state, 'READY');
  assert.equal(await prisma.materialArrivalBatch.count({ where: { exceptionId: { in: order.events.map(e => e.id) }, status: 'VERIFIED' } }), 3);
  await change('reopen', { note: '继续核验另一项' });
  await change('report_exception', { materialModel: 'D', supplySource: 'PURCHASED', shortageQuantity: 10, unit: '个', exceptionType: 'shortage' });
  const d = order.events.find(e => e.model === 'D')!;
  await change('report_arrival', { exceptionId: d.id, quantity: 10, logisticsMode: 'PICKUP' }, false);
  const arrival = order.events.find(e => e.id === d.id)!.arrivals[0];
  await assert.rejects(change('verify_arrivals', { entries: [{ arrivalId: arrival.id }] }), /数量/);
  await change('verify_arrivals', { entries: [{ arrivalId: arrival.id, acceptedQuantity: 8 }], note: '2 件不合格待补' });
  assert.equal(order.events.find(e => e.id === d.id)!.remaining, 2); assert.equal(order.openCount, 1);
  await assert.rejects(change('confirm_prepared', { preparedQuantity: 25 }), /缺料/);
  await prisma.$disconnect();
});
