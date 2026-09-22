import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { assertSampleDrawingApproved, completeSampleRepeat, ensureSampleWarehouse, transferSampleCompletion } from '../lib/sample-plan-operations';
import { mutateQualityFixture } from '../lib/quality-fixture-service';
import { syncProductDocuments } from '../lib/quality-fixture-sync';
import { drawingPlanWeekScope } from '../lib/drawing-plan-week';
import { listSamplePlans } from '../lib/sample-plan-query';
import { loadFinishedGoods, mutateFinishedGoods } from '../lib/finished-goods-service';
import { mutateWarehouseException } from '../lib/material-exception-service';

test('sample branches retain drawing review, independent material events and atomic finished stock', { skip: process.env.RUN_DB_INTEGRATION !== '1' }, async t => {
  const tag = 'SAMPLE-BRANCH-' + randomUUID().slice(0,8);
  const user = await prisma.user.create({ data: { username: tag, displayName: '样品验收管理员', passwordHash: 'not-a-login', laborRole: 'ADMIN' } });
  const actor = { id: user.id, name: user.displayName };
  const category = await prisma.resourceCategory.upsert({ where: { code: 'drawing' }, update: {}, create: { code: 'drawing', name: '原图', sortOrder: 0 } });
  const item = await prisma.drawingLibraryItem.create({ data: { libraryKey: tag, specification: tag, customerName: tag, productName: '样品连接线', fixtureRequired: true,
    files: { create: { categoryId: category.id, objectKey: tag+'/drawing', originalName: 'drawing.pdf', mimeType: 'application/pdf', version: 'V1', size: 10, uploadedById: user.id } } }, include: { files: true } });
  const task = await prisma.sampleTask.create({ data: { code: tag, qrCode: tag, drawingLibraryItemId: item.id, customerNameSnapshot: tag, specificationSnapshot: tag, taskType: 'REPEAT', sampleQuantity: 5, documentReviewRequired: true, planWeekStartDate: new Date('2026-09-21'), dueDate: new Date('2026-09-29'), createdById: user.id, createdByName: user.displayName } });
  const warehouse = await prisma.$transaction(tx => ensureSampleWarehouse(tx, task));
  const getTask = () => prisma.sampleTask.findUniqueOrThrow({ where: { id: task.id } });
  const complete = (input: Record<string, unknown>) => prisma.$transaction(tx => completeSampleRepeat(tx, task.id, input, actor), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  const qf = (input: Record<string, unknown>) => mutateQualityFixture(input, user, randomUUID()) as Promise<any>;
  const settings = await prisma.qfSettings.findUnique({ where: { id: 'quality-fixtures' } });
  try {
    await qf({ action: 'SAVE_SETTINGS', version: settings?.version, supervisorIds: [user.id], qualityIds: [user.id] });
    const pack = await prisma.$transaction(tx => syncProductDocuments(tx, item.id, user));
    assert.ok(pack);
    const getPack = () => prisma.qfPackage.findUniqueOrThrow({ where: { id: pack!.id } });
    const sign = async (role: string) => qf({ action: 'APPROVE', id: pack!.id, version: (await getPack()).version, reviewRole: role, confirmed: true });
    await t.test('sample plan alone enters weekly drawing library and review without a production order', async () => {
      assert.equal(await prisma.workOrder.count({ where: { drawingLibraryItemId: item.id } }), 0);
      assert.equal(await prisma.drawingLibraryItem.count({ where: { id: item.id, ...drawingPlanWeekScope('2026-09-23', true) } }), 1);
      assert.equal(pack!.status, 'REVIEWING'); assert.equal((pack!.sopFiles as any[]).length, 0);
      const result = await listSamplePlans(new URLSearchParams({ keyword: tag, taskType: 'REPEAT', week: '2026-09-21', summary: 'true' }));
      assert.equal(result.pagination.total, 1); assert.deepEqual((result.tasks[0] as any).entries, []);
      assert.equal((await listSamplePlans(new URLSearchParams({ keyword: tag, taskType: 'NEW', week: '2026-09-21' }))).pagination.total, 0);
      assert.equal((await listSamplePlans(new URLSearchParams({ keyword: tag, taskType: 'REPEAT', week: '2026-09-28', carry: 'true' }))).pagination.total, 1);
      assert.equal((await getTask()).dueDate!.toISOString().slice(0,10), '2026-09-29');
    });
    await t.test('quality may review first; both signatures needed while BOM and warehouse remain pending', async () => {
      await assert.rejects(() => prisma.$transaction(async tx => assertSampleDrawingApproved(tx, await getTask())), /双方审核/);
      await sign('QUALITY');
      await assert.rejects(() => complete({ expectedVersion: task.version, mutationId: 'too-early', quantity: 1 }), /双方审核/);
      await sign('SUPERVISOR');
      await prisma.$transaction(async tx => assertSampleDrawingApproved(tx, await getTask(), false));
      assert.equal((await getTask()).approvedPackageId, null, 'read-only print readiness does not bind');
      assert.equal((await getPack()).bomFileId, null);
      assert.equal(warehouse!.status, 'pending');
    });
    await t.test('purchased and customer shortages create separate sample events and retain warehouse confirmation', async () => {
      for (const source of ['PURCHASED','CUSTOMER']) {
        const w = await prisma.warehouseMaterialTask.findUniqueOrThrow({ where: { id: warehouse!.id } });
        await mutateWarehouseException(w.id, { action: 'report_exception', version: w.version, exceptionType: 'shortage', exceptionNote: '等待样品备料', supplySource: source, materialModel: source+'-CN', shortageQuantity: 2, unit: '个' }, user.id, true);
      }
      const events = await prisma.warehouseMaterialExceptionCase.findMany({ where: { warehouseTaskId: warehouse!.id }, include: { followUpTask: true } });
      assert.equal(events.length, 2); assert.ok(events.every(e => e.followUpTask));
      const w = await prisma.warehouseMaterialTask.findUniqueOrThrow({ where: { id: warehouse!.id } });
      await assert.rejects(() => mutateWarehouseException(w.id, { action: 'complete', version: w.version }, user.id, true), /配料清单/);
    });
    await t.test('partial completion is atomic, preserves actual review and adds sample pending stock exactly once', async () => {
      const body = { expectedVersion: task.version, mutationId: 'part-one', quantity: 2, workDate: '2026-09-21', note: '第一批' };
      await complete(body); await complete(body);
      await assert.rejects(() => complete({ ...body, quantity: 1 }), /不能变更/);
      const current = await getTask(); assert.equal(current.status, 'IN_PROGRESS'); assert.equal(current.completedQuantity, 2);
      assert.equal(current.approvedPackageId, pack!.id);
      const completions = await prisma.sampleCompletion.findMany({ where: { taskId: task.id } });
      assert.equal(completions.length, 1); assert.equal(completions[0].approvedPackageId, pack!.id);
      const lots = await prisma.fgLot.findMany({ where: { sampleTaskId: task.id } });
      assert.equal(lots.length, 1); assert.equal(lots[0].pending, 2); assert.equal(lots[0].available, 0); assert.equal(lots[0].workOrderId, null);
      assert.match(lots[0].note, /^样品完成/); assert.equal(lots[0].productionWorkDate!.toISOString().slice(0,10), '2026-09-21');
      assert.ok(lots[0].transferredAt);
      const rows = await loadFinishedGoods({ sampleTaskId: task.id, filter: 'all', scope: 'all' });
      assert.equal(rows.rows.length, 1); assert.equal(rows.rows[0].sampleTaskId, task.id);
    });
    await t.test('over-completion and failed transaction cannot leave orphan stock', async () => {
      const current = await getTask();
      await assert.rejects(() => complete({ expectedVersion: current.version, mutationId: 'over', quantity: 4 }), /整数/);
      await assert.rejects(() => prisma.$transaction(async tx => { await transferSampleCompletion(tx, current, actor, { mutationId: 'rollback', quantity: 1 }); throw new Error('forced rollback'); }), /forced rollback/);
      assert.equal((await getTask()).completedQuantity, 2); assert.equal(await prisma.fgLot.count({ where: { sampleTaskId: task.id } }), 1);
    });
    await t.test('concurrent final completion allows only one transfer and closes plan', async () => {
      const current = await getTask();
      const results = await Promise.allSettled(['last-a','last-b'].map(mutationId => complete({ expectedVersion: current.version, mutationId, quantity: 3, workDate: '2026-09-21' })));
      assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
      assert.equal((await getTask()).completedQuantity, 5); assert.equal((await getTask()).status, 'COMPLETED');
      const lots = await prisma.fgLot.findMany({ where: { sampleTaskId: task.id } }); assert.equal(lots.reduce((n,l) => n+l.pending,0), 5);
      await mutateFinishedGoods({ action: 'RECEIVE', lotId: lots[0].id, quantity: lots[0].pending, version: lots[0].version, checked: true }, user, randomUUID());
      const received = await prisma.fgLot.findUniqueOrThrow({ where: { id: lots[0].id } }); assert.equal(received.pending,0); assert.equal(received.available,lots[0].pending); assert.match(received.note,/样品完成/);
    });
  } finally {
    await prisma.fgLedger.deleteMany({ where: { lot: { sampleTaskId: task.id } } });
    await prisma.fgLot.deleteMany({ where: { sampleTaskId: task.id } });
    await prisma.sampleCompletion.deleteMany({ where: { taskId: task.id } });
    if (warehouse) { await prisma.materialFollowUpActivity.deleteMany({ where: { task: { warehouseTaskId: warehouse.id } } }); await prisma.materialFollowUpTask.deleteMany({ where: { warehouseTaskId: warehouse.id } }); await prisma.warehouseMaterialTask.delete({ where: { id: warehouse.id } }); }
    await prisma.sampleTask.delete({ where: { id: task.id } });
    // Keep isolated QF audit evidence; remove its active sample source from subsequent counts.
    await prisma.drawingLibraryItem.update({ where: { id: item.id }, data: { deletedAt: new Date() } });
    if (settings) await prisma.qfSettings.update({ where: { id: settings.id }, data: { supervisorIds: settings.supervisorIds, qualityIds: settings.qualityIds } });
  }
});
