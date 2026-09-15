import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { loadPlanningTimeReferences } from '../lib/planning-time-reference';
import { productionPlanOrderInclude, releaseProductionPlanBatch, serializeProductionPlanOrder } from '../lib/production-planning';
import { productionExecutionInclude, serializeProductionOrder } from '../lib/production-execution';

const enabled = process.env.RUN_DB_INTEGRATION === '1';
class Rollback extends Error {}
async function fixture(tx: Prisma.TransactionClient) {
  const key = randomUUID();
  const user = await tx.user.create({ data: { username: `time-${key}`, displayName: '工时验收员', passwordHash: 'test-only' } });
  const drawing = await tx.drawingLibraryItem.create({ data: { customerName: '工时一致验收', productName: '线束', specification: key, libraryKey: key } });
  const definition = await tx.processDefinition.create({ data: { code: key, name: '裁线', stageGroup: 'frontend' } });
  const profile = await tx.productTimeProfile.create({ data: { drawingLibraryItemId: drawing.id, version: 1, status: 'published',
    entries: { create: { processDefinitionId: definition.id, position: 1, sequenceGroup: 1, timeBasis: 'per_unit', unitLabel: '件', unitMilliseconds: 1630000 } } } });
  const order = await tx.productionPlanOrder.create({ data: { sourceOrderNo: key, sourceLineNo: 1, customerName: drawing.customerName,
    productName: '线束', specification: key, drawingLibraryItemId: drawing.id, orderQuantity: 1000,
    planningUnitMilliseconds: 600000, orderDate: new Date('2026-09-04'), customerDueDate: new Date('2026-10-16') } });
  const batchData = { planOrderId: order.id, quantity: 300, weekStartDate: new Date('2026-09-14T04:00:00Z'),
    weekEndDate: new Date('2026-09-20T04:00:00Z'), plannedCompletionDate: new Date('2026-09-20T04:00:00Z'),
    productTimeProfileId: profile.id, productTimeProfileVersion: 1 };
  return { user, drawing, profile, order, batchData };
}

test('uploaded plan survives release, standard changes and stale execution writes; candidates follow the selected batch', { skip: !enabled }, async () => {
  await assert.rejects(prisma.$transaction(async tx => {
    const f = await fixture(tx);
    const batch = await tx.productionPlanBatch.create({ data: { ...f.batchData, batchNo: 1, unitMillisecondsSnapshot: 600000,
      importedUnitMilliseconds: 600000, planTimeSource: 'import', totalMillisecondsSnapshot: 1n } });
    assert.equal(batch.totalMillisecondsSnapshot, 180000000n);
    const released = await releaseProductionPlanBatch(tx, { batchId: batch.id, target: 'active', actorId: f.user.id, now: new Date('2026-09-15') });
    const work = await tx.workOrder.findUniqueOrThrow({ where: { id: released.workOrderId }, include: productionExecutionInclude });
    assert.equal(Number(work.unitWorkHours) * 60, 10);
    assert.equal(Number(work.totalWorkHours), 50);
    const execution = serializeProductionOrder(work);
    assert.equal(execution.planUnitMilliseconds, 600000);
    assert.equal(execution.planTotalMilliseconds, '180000000');
    const plan = serializeProductionPlanOrder(await tx.productionPlanOrder.findUniqueOrThrow({ where: { id: f.order.id }, include: productionPlanOrderInclude }));
    assert.equal(plan.effectiveUnitMilliseconds, 600000);
    assert.equal(plan.currentUnitMilliseconds, 1630000);
    assert.equal(plan.batches[0].totalMillisecondsSnapshot, execution.planTotalMilliseconds);
    await tx.productProcessTimeEntry.updateMany({ where: { profileId: f.profile.id }, data: { unitMilliseconds: 618000 } });
    await tx.workOrder.update({ where: { id: work.id }, data: { unitWorkHours: '99', totalWorkHours: '999' } });
    let saved = await tx.workOrder.findUniqueOrThrow({ where: { id: work.id } });
    assert.equal(Number(saved.totalWorkHours), 50);
    await tx.productionPlanBatch.update({ where: { id: batch.id }, data: { unitMillisecondsSnapshot: 1630000 } });
    assert.equal((await tx.productionPlanBatch.findUniqueOrThrow({ where: { id: batch.id } })).unitMillisecondsSnapshot, 600000);
    await tx.productionPlanBatch.update({ where: { id: batch.id }, data: { quantity: 200, unitMillisecondsSnapshot: 900000, planTimeSource: 'manual' } });
    saved = await tx.workOrder.findUniqueOrThrow({ where: { id: work.id } });
    assert.equal(Number(saved.unitWorkHours) * 60, 15);
    assert.equal(Number(saved.totalWorkHours), 50);
    const next = await tx.productionPlanBatch.create({ data: { ...f.batchData, batchNo: 2, quantity: 30,
      weekStartDate: new Date('2026-09-21T04:00:00Z'), weekEndDate: new Date('2026-09-27T04:00:00Z'), plannedCompletionDate: new Date('2026-09-27T04:00:00Z'),
      unitMillisecondsSnapshot: 1200000, importedUnitMilliseconds: 1200000, planTimeSource: 'import' } });
    await tx.productionPlanBatch.update({ where: { id: batch.id }, data: { updatedAt: new Date('2030-01-01') } });
    assert.equal((await loadPlanningTimeReferences(tx, [f.drawing.id])).get(f.drawing.id)?.batchId, next.id);
    const selected = (await loadPlanningTimeReferences(tx, [f.drawing.id], { batchId: batch.id })).get(f.drawing.id)!;
    assert.equal(selected.unitMilliseconds, 900000); assert.equal(selected.quantity, 200); assert.equal(selected.weekStartDate, '2026-09-14');
    assert.equal((await loadPlanningTimeReferences(tx, [f.drawing.id], { scoped: true, batchIds: [batch.id] })).get(f.drawing.id)?.batchId, batch.id);
    assert.equal((await tx.productProcessTimeEntry.findFirstOrThrow({ where: { profileId: f.profile.id } })).unitMilliseconds, 618000);
    assert.equal(await tx.processCompletion.count({ where: { workOrderId: work.id } }), 0);
    throw new Rollback();
  }, { timeout: 60000 }), Rollback);
});

test('migration restores original import evidence, preserves explicit adjustments and leaves unknown legacy values intact', { skip: !enabled }, async () => {
  await assert.rejects(prisma.$transaction(async tx => {
    const f = await fixture(tx);
    const imported = await tx.productionPlanBatch.create({ data: { ...f.batchData, batchNo: 1, unitMillisecondsSnapshot: 1630000 } });
    const manual = await tx.productionPlanBatch.create({ data: { ...f.batchData, batchNo: 2, unitMillisecondsSnapshot: 900000 } });
    const legacy = await tx.productionPlanBatch.create({ data: { ...f.batchData, batchNo: 3, unitMillisecondsSnapshot: 1630000 } });
    const unknown = await tx.productionPlanBatch.create({ data: { ...f.batchData, batchNo: 4, unitMillisecondsSnapshot: 1230000 } });
    const originalFile = await tx.productionPlanBatch.create({ data: { ...f.batchData, batchNo: 5, unitMillisecondsSnapshot: 1630000 } });
    const importFile = await tx.productionPlanImportBatch.create({ data: {
      requestId: randomUUID(), previewToken: randomUUID(), status: 'completed', sourceFileName: '原始计划.xlsx', sourceFileHash: randomUUID(),
      targetWeekStartDate: f.batchData.weekStartDate, targetWeekEndDate: f.batchData.weekEndDate,
      previewData: { rows: [{ rowNo: 8, input: { planningUnitMilliseconds: 127500 } }, { rowNo: 9, input: { planningUnitMilliseconds: 600000 } }] },
    } });
    await tx.productionPlanChange.create({ data: { planOrderId: f.order.id, batchId: originalFile.id,
      action: 'bulk_import_plan_week', impactData: { importBatchId: importFile.id, sourceRowNo: 8 } } });
    const auditDate = new Date('2026-09-10');
    for (const b of [imported, manual, legacy]) {
      await tx.productionPlanChange.create({ data: { planOrderId: f.order.id, batchId: b.id, action: 'bulk_import_plan_week',
        afterData: { unitMilliseconds: b.unitMillisecondsSnapshot }, createdAt: auditDate,
        impactData: b.id === legacy.id ? {} : { planningTime: { importedUnitMilliseconds: 600000, source: 'import' } } } });
    }
    await tx.productionPlanChange.create({ data: { planOrderId: f.order.id, batchId: manual.id, action: 'update_released_plan_batch',
      beforeData: { unitMilliseconds: 600000 }, afterData: { unitMilliseconds: 900000 }, createdAt: new Date('2026-09-11') } });
    const migration = readFileSync(new URL('../prisma/migrations/202609150001_planning_time_consistency/migration.sql', import.meta.url), 'utf8');
    const reconciliation = migration.slice(migration.indexOf('CREATE FUNCTION pg_temp.plan_ms'), migration.indexOf('-- Keep integer milliseconds'));
    for (const statement of reconciliation.split(/\n(?=CREATE (?:FUNCTION|TEMP TABLE)|INSERT INTO|UPDATE production_plan_batches)/)) {
      await tx.$executeRawUnsafe(statement);
    }
    const repaired = await tx.productionPlanBatch.findUniqueOrThrow({ where: { id: imported.id } });
    assert.equal(repaired.unitMillisecondsSnapshot, 600000); assert.equal(repaired.importedUnitMilliseconds, 600000);
    assert.equal(repaired.totalMillisecondsSnapshot, 180000000n); assert.equal(repaired.planTimeSource, 'import');
    assert.equal((await tx.productionPlanBatch.findUniqueOrThrow({ where: { id: manual.id } })).unitMillisecondsSnapshot, 900000);
    assert.equal((await tx.productionPlanBatch.findUniqueOrThrow({ where: { id: legacy.id } })).unitMillisecondsSnapshot, 600000);
    assert.equal((await tx.productionPlanBatch.findUniqueOrThrow({ where: { id: unknown.id } })).unitMillisecondsSnapshot, 1230000);
    const restoredFile = await tx.productionPlanBatch.findUniqueOrThrow({ where: { id: originalFile.id } });
    assert.equal(restoredFile.unitMillisecondsSnapshot, 127500);
    assert.equal(restoredFile.totalMillisecondsSnapshot, 38250000n);
    assert.equal(await tx.productionPlanChange.count({ where: { batchId: imported.id, action: 'repair_plan_time_consistency' } }), 1);
    assert.equal(await tx.productProcessTimeEntry.count({ where: { profileId: f.profile.id, unitMilliseconds: 1630000 } }), 1);
    throw new Rollback();
  }, { timeout: 60000 }), Rollback);
});
