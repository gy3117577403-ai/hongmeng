import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { prisma } from '../lib/prisma';
import { chinaWeekRange } from '../lib/production-planning';
import { enterWipWarehouse, listWipWarehouse, previewWipEntry } from '../lib/wip-warehouse';
import type { ProductionEntityScope } from '../lib/production-access-scope';

const enabled = process.env.RUN_DB_INTEGRATION === '1';
const productionScope: ProductionEntityScope = {
  level: 'GLOBAL', canRead: true, canWrite: true, canReconcile: true, readOnly: false, teamKeys: [],
};

// Represent the persisted result of a v126 publication: display order is B,A,
// while the reported batch still moves material through A,B.
async function fixture(options: { fulfilledSupplement?: boolean; parallelTerminal?: boolean } = {}) {
  const prefix = `IT-WIP-MATERIAL-${randomUUID()}`;
  const week = chinaWeekRange(new Date());
  const actor = await prisma.user.create({ data: { username: prefix, passwordHash: 'fixture-only', displayName: prefix } });
  const definition = await prisma.processDefinition.create({ data: { code: prefix, name: '补充检验', stageGroup: 'backend' } });
  const common = { stageGroup: 'frontend', timeBasis: 'per_unit', unitLabel: '件', standardMillisecondsPerUnit: 1000, unitsPerProduct: 1 };
  const order = await prisma.workOrder.create({ data: {
    code: prefix, productName: prefix, planType: 'managed_plan', planActive: true, stage: 'frontend', status: 'processing',
    productionTargetQty: 10, uncompletedQty: '10', completedQty: options.parallelTerminal ? '2' : '0', startedAt: week.start,
    processRoute: { create: {
      templateName: prefix, templateVersion: 1, status: 'in_progress', confirmedAt: week.start, startedAt: week.start,
      steps: { create: [
        { ...common, processCode: `${prefix}-B`, processName: '物料末工序B', position: 1, sequenceGroup: 1, materialSequenceGroup: 2,
          status: 'current', inputQty: 10, processedQty: options.parallelTerminal ? 2 : 0, goodOutputQty: options.parallelTerminal ? 2 : 0 },
        { ...common, processCode: `${prefix}-A`, processName: '物料首工序A', position: 2, sequenceGroup: 2, materialSequenceGroup: 1,
          status: 'completed', inputQty: 10, processedQty: 10, goodOutputQty: 10, releasedGoodQty: 10 },
        ...(options.parallelTerminal ? [{ ...common, processCode: `${prefix}-C`, processName: '并行末工序C',
          position: 3, sequenceGroup: 3, materialSequenceGroup: 2, status: 'current', inputQty: 10, processedQty: 4, goodOutputQty: 4 }] : []),
        ...(options.fulfilledSupplement ? [{ ...common, processCode: definition.code, processDefinitionId: definition.id,
          processName: definition.name, position: 4, sequenceGroup: 4, executionMode: 'SUPPLEMENTAL_OBLIGATION' as const, status: 'completed' }] : []),
      ] },
    } },
  }, include: { processRoute: { include: { steps: true } } } });
  const route = order.processRoute!;
  if (options.fulfilledSupplement) {
    const step = route.steps.find(item => item.executionMode === 'SUPPLEMENTAL_OBLIGATION')!;
    await prisma.processSupplementObligation.create({ data: {
      reconciliationKey: `existing-route:${step.id}`, workOrderId: order.id, routeId: route.id, displayStepId: step.id,
      processDefinitionId: definition.id, source: 'EXISTING', processCode: definition.code, processName: definition.name,
      stageGroup: 'backend', displayPosition: step.position, intendedSequenceGroup: step.sequenceGroup,
      requiredQty: 10, reportedQty: 10, reportedUnitQty: 10, reportedGoodUnitQty: 10,
      status: 'FULFILLED', fulfillmentMode: 'ACTUAL', fulfilledAt: week.start, standardMillisecondsPerUnit: 1000,
    } });
  }
  const plan = await prisma.productionPlanOrder.create({ data: {
    sourceOrderNo: prefix, sourceLineNo: 1, customerName: prefix, productName: prefix, specification: prefix,
    orderQuantity: 10, orderDate: week.start, customerDueDate: week.end, createdById: actor.id, updatedById: actor.id,
    batches: { create: { batchNo: 1, quantity: 10, weekStartDate: week.start, weekEndDate: week.end,
      plannedCompletionDate: week.end, releaseState: 'active', workOrderId: order.id } },
  }, include: { batches: true } });
  const batch = plan.batches[0];
  async function cleanup() {
    await prisma.semiFinishedLot.deleteMany({ where: { productionPlanBatchId: batch.id } });
    await prisma.operationLog.deleteMany({ where: { userId: actor.id } });
    await prisma.processSupplementObligation.deleteMany({ where: { routeId: route.id } });
    await prisma.productionPlanOrder.delete({ where: { id: plan.id } });
    await prisma.workOrder.delete({ where: { id: order.id } });
    await prisma.processDefinition.delete({ where: { id: definition.id } });
    await prisma.user.delete({ where: { id: actor.id } });
  }
  return { prefix, actor, order, route, batch, cleanup };
}

test('WIP uses the retained material endpoint after process display order changes', { skip: !enabled }, async () => {
  const f = await fixture();
  try {
    const preview = await previewWipEntry({ batchId: f.batch.id, quantity: 6, productionScope });
    assert.equal(preview.availableQuantity, 10);
    assert.deepEqual(preview.completedSteps.map(step => step.processName), ['物料首工序A']);
    assert.deepEqual(preview.remainingSteps.map(step => [step.processName, step.remainingQty]), [['物料末工序B', 6]]);
    assert.equal(preview.remainingStandardMilliseconds, 6000);
    const listing = await listWipWarehouse({ batchId: f.batch.id, productionScope });
    assert.equal(listing.candidates.find(item => item.id === f.batch.id)?.availableQuantity, 10);
    await enterWipWarehouse({ batchId: f.batch.id, quantity: 6, reason: '保留材料顺序转仓验证',
      actorId: f.actor.id, actorName: f.prefix, idempotencyKey: `${f.prefix}:enter`, productionScope });
    assert.equal((await previewWipEntry({ batchId: f.batch.id, quantity: 4, productionScope })).availableQuantity, 4);
    await assert.rejects(previewWipEntry({ batchId: f.batch.id, quantity: 5, productionScope }), { code: 'WIP_QUANTITY_EXCEEDS_AVAILABLE' });
    assert.equal((await prisma.workOrder.findUniqueOrThrow({ where: { id: f.order.id } })).completedQty, '0');
  } finally { await f.cleanup(); }
});

test('WIP does not recreate fulfilled supplemental work as an unreported ordinary process', { skip: !enabled }, async () => {
  const f = await fixture({ fulfilledSupplement: true });
  try {
    const preview = await previewWipEntry({ batchId: f.batch.id, quantity: 6, productionScope });
    assert.equal(preview.availableQuantity, 10);
    assert.deepEqual(preview.remainingSteps.map(step => step.processName), ['物料末工序B']);
    assert.ok(preview.completedSteps.some(step => step.processName === '补充检验'));
    assert.equal(preview.remainingStandardMilliseconds, 6000);
    const lot = await enterWipWarehouse({ batchId: f.batch.id, quantity: 6, reason: '补充检验不得重复计划',
      actorId: f.actor.id, actorName: f.prefix, idempotencyKey: `${f.prefix}:enter`, productionScope });
    assert.deepEqual((await prisma.semiFinishedLotStep.findMany({ where: { lotId: lot.id } })).map(step => step.processName), ['物料末工序B']);
  } finally { await f.cleanup(); }
});

test('parallel material endpoints require every operation before treating output as finished', { skip: !enabled }, async () => {
  const f = await fixture({ parallelTerminal: true });
  try {
    const preview = await previewWipEntry({ batchId: f.batch.id, quantity: 8, productionScope });
    assert.equal(preview.availableQuantity, 8, '2 finished products, not the last display step with 4 good outputs');
    assert.deepEqual(preview.remainingSteps.map(step => [step.processName, step.remainingQty]), [['物料末工序B', 8], ['并行末工序C', 6]]);
    assert.equal(preview.remainingStandardMilliseconds, 14000);
  } finally { await f.cleanup(); }
});
