import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { prisma } from '../lib/prisma';
import { materialOrderFilterWhere } from '../lib/material-order-filters';
import { poolWarehouseQueue } from '../lib/order-pool-warehouse';

test('shortage filters bind source to the same open item in weekly orders and the order pool', { skip: process.env.RUN_DB_INTEGRATION !== '1' }, async () => {
  const marker = 'shortage271-' + randomUUID();
  const taskIds: string[] = [], workIds: string[] = [], poolIds: string[] = [];
  try {
    for (const pool of [false, true]) {
      for (let i = 0; i < 3; i++) {
        const code = `${marker}-${pool}-${i}`;
        const parent = pool ? await prisma.productionPlanOrder.create({ data: { sourceOrderNo: code, sourceLineNo: 1, productName: marker, specification: code, customerName: '验收', orderQuantity: 10, orderDate: new Date(), customerDueDate: new Date() } }) : await prisma.workOrder.create({ data: { code, productName: marker, specification: code, stage: 'not_issued' } });
        (pool ? poolIds : workIds).push(parent.id);
        const task = await prisma.warehouseMaterialTask.create({ data: { ...(pool ? { planOrderId: parent.id } : { workOrderId: parent.id }), status: i === 2 ? 'pending' : 'exception' } });
        taskIds.push(task.id);
        if (i === 0) await prisma.warehouseMaterialExceptionCase.createMany({ data: [
          { warehouseTaskId: task.id, sequence: 1, exceptionType: 'shortage', exceptionNote: marker, supplySource: 'PURCHASED', status: 'RESOLVED', shortageQuantity: 10 },
          { warehouseTaskId: task.id, sequence: 2, exceptionType: 'shortage', exceptionNote: marker, supplySource: 'CUSTOMER', status: 'OPEN', shortageQuantity: null },
        ] });
        if (i === 1) await prisma.warehouseMaterialExceptionCase.create({ data: { warehouseTaskId: task.id, sequence: 1, exceptionType: 'shortage', exceptionNote: marker, supplySource: 'PURCHASED', status: 'OPEN', shortageQuantity: 10 } });
      }
    }
    const matching = async (source: string) => (await prisma.warehouseMaterialTask.findMany({ where: { AND: [{ id: { in: taskIds } }, materialOrderFilterWhere('shortage', source)] } })).map(t => t.id);
    assert.deepEqual((await matching('PURCHASED')).sort(), [taskIds[1], taskIds[4]].sort());
    assert.deepEqual((await matching('CUSTOMER')).sort(), [taskIds[0], taskIds[3]].sort());
    assert.equal((await matching('ALL')).length, 4, 'unknown shortage quantities remain shortages, unchecked tasks do not');
    for (const source of ['PURCHASED', 'CUSTOMER']) {
      const q = await poolWarehouseQueue(new URLSearchParams({ scope: 'pool', status: 'shortage', source, q: marker }));
      assert.equal(q.pagination.total, 1); assert.equal(q.summary.shortage, 1);
      assert.equal(q.orders[0].id, source === 'PURCHASED' ? taskIds[4] : taskIds[3]);
    }
  } finally {
    await prisma.warehouseMaterialTask.deleteMany({ where: { id: { in: taskIds } } });
    await prisma.workOrder.deleteMany({ where: { id: { in: workIds } } });
    await prisma.productionPlanOrder.deleteMany({ where: { id: { in: poolIds } } });
    await prisma.$disconnect();
  }
});
