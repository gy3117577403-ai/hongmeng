import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { prisma } from '../lib/prisma';
import { loadWorkflowCenter, loadWorkflowNavigation } from '../lib/workflows';
import { loadPlanningRows } from '../lib/planning-reads';
import { chinaWeekRange, chinaDate } from '../lib/production-planning';

const enabled = process.env.RUN_DB_INTEGRATION === '1';
const scope = { level: 'GLOBAL' as const, canRead: true, canWrite: true, canReconcile: true, readOnly: false, teamKeys: [] };
const shift = (date: Date, days: number) => new Date(date.getTime() + days * 86400000);

test('scoped flow pages, details, permissions and planning totals agree across weeks', { skip: !enabled }, async t => {
  const prefix = `IT-PERF-${randomUUID()}`;
  const week = chinaWeekRange(new Date());
  const ids = Array.from({ length: 55 }, () => randomUUID());
  const batchIds = Array.from({ length: 55 }, () => randomUUID());
  const planId = randomUUID();
  const issue = await prisma.issue.create({ data: { title: `${prefix} issue`, status: 'pending' } });
  try {
    await prisma.workOrder.createMany({ data: ids.map((id, i) => ({ id, code: `${prefix}-${i}`, customerName: prefix,
      productName: prefix, specification: `${prefix}-${i}`, stage: 'frontend', status: 'processing', planActive: true,
      productionTargetQty: 10, uncompletedQty: '10', completedQty: '0',
      weekStartDate: shift(week.start, i < 52 ? 0 : i === 52 ? -7 : 7), weekEndDate: shift(week.end, i < 52 ? 0 : i === 52 ? -7 : 7),
    })) });
    await prisma.productionPlanOrder.create({ data: { id: planId, sourceOrderNo: prefix, sourceLineNo: 1,
      customerName: prefix, productName: prefix, specification: prefix, orderQuantity: 600,
      orderDate: week.start, customerDueDate: week.end, planningUnitMilliseconds: 1000,
      batches: { create: ids.map((id, i) => ({ id: batchIds[i], batchNo: i + 1, quantity: 10,
        weekStartDate: shift(week.start, i < 52 ? 0 : i === 52 ? -7 : 7), weekEndDate: shift(week.end, i < 52 ? 0 : i === 52 ? -7 : 7),
        plannedCompletionDate: week.end, releaseState: 'active', workOrderId: id,
        deletedAt: i === 54 ? new Date() : null,
      })) },
    } });
    await prisma.productionCarryover.create({ data: { productionPlanBatchId: batchIds[52], workOrderId: ids[52],
      sourceWeekStartDate: shift(week.start, -7), targetWeekStartDate: week.start, inclusionType: 'AUTO_PREVIOUS_WEEK' } });
    const route = await prisma.workOrderProcessRoute.create({ data: { workOrderId: ids[0], templateName: 'test', templateVersion: 1,
      status: 'completed', routeSource: 'product_time_profile', productTimeProfileVersion: 1, startedAt: new Date(),
      steps: { create: [{ processCode: 'QA', processName: '检验', stageGroup: 'finish', position: 1, sequenceGroup: 1,
        inputQty: 10, processedQty: 10, goodOutputQty: 10, releasedGoodQty: 10, status: 'completed', standardMillisecondsPerUnit: 1000 }] },
    } });
    const base = { productionScope: scope, keyword: prefix, entityType: 'production' as const, weekScope: 'current' as const, pageSize: 40 };
    await t.test('list is bounded, has no detail ledgers, and preserves active carryovers without next-week leakage', async () => {
      const first = await loadWorkflowCenter({ ...base, page: 1 });
      const second = await loadWorkflowCenter({ ...base, page: 2 });
      assert.equal(first.items.length, 40); assert.equal(second.items.length, 13);
      assert.equal(first.pagination.total, 53);
      const keys = [...first.items, ...second.items].map(row => row.id);
      assert.equal(new Set(keys).size, 53);
      assert.ok(keys.includes(`production-plan:${batchIds[52]}`));
      assert.ok(!keys.includes(`production-plan:${batchIds[53]}`));
      assert.ok(first.items.every(row => row.steps.length === 0 && row.activities.length === 0));
      const selected = [...first.items, ...second.items].find(row => row.processRouteId === route.id)!;
      const detail = await loadWorkflowCenter({ ...base, mode: 'detail', detailId: selected.id });
      assert.equal(detail.items.length, 1); assert.equal(detail.items[0].steps.length, 1);
      assert.equal(detail.items[0].currentStep, '主路线完成 · 待分支闭环');
      assert.equal(selected.currentStep, detail.items[0].currentStep);
      assert.equal(selected.processStatus, detail.items[0].processStatus);
      assert.ok(Buffer.byteLength(JSON.stringify(first.items)) < 150000);
    });
    await t.test('filtered and empty lists do not hydrate other categories and deep links stay reachable', async () => {
      const issueOnly = await loadWorkflowCenter({ ...base, entityType: 'issue' });
      assert.deepEqual(issueOnly.items.map(row => row.id), [`issue:${issue.id}`]);
      const empty = await loadWorkflowCenter({ ...base, weekScope: 'afterNext' });
      assert.equal(empty.items.length, 0); assert.equal(empty.pagination.total, 0);
      const pinned = await loadWorkflowCenter({ ...base, batchId: batchIds[53] });
      assert.equal(pinned.items[0].id, `production-plan:${batchIds[53]}`);
      const denied = await loadWorkflowCenter({ ...base, mode: 'detail', detailId: `production-plan:${batchIds[0]}`, allowedEntityTypes: ['issue'] });
      assert.equal(denied.items.length, 0);
      const teamDenied = await loadWorkflowCenter({ ...base, productionScope: { ...scope, level: 'TEAM', teamKeys: [prefix] } });
      assert.equal(teamDenied.items.length, 0);
      const navigation = await loadWorkflowNavigation({ productionScope: scope });
      assert.ok(navigation.current.count >= 52); assert.ok(navigation.carryoverCount >= 1);
      const totals = await loadWorkflowCenter({ ...base, mode: 'summary', entityType: 'issue' });
      assert.equal(totals.items.length, 0); assert.ok(totals.summary.production >= 53);
    });
    await t.test('week-scoped planning keeps all-week allocations and legacy metadata counts', async () => {
      // Public GET accepts a China-midnight week key, while legacy batches can use UTC midnight.
      const selectedWeek = new Date(`${chinaDate(week.start)}T00:00:00+08:00`);
      const weekly = await loadPlanningRows('week', selectedWeek);
      const full = await loadPlanningRows('all');
      const metadata = await loadPlanningRows('metadata');
      const row = weekly.orders.find(order => order.id === planId)!;
      const all = full.orders.find(order => order.id === planId)!;
      const meta = metadata.orders.find(order => order.id === planId)!;
      assert.equal(row.batches.length, 52); assert.equal(all.batches.length, 54);
      assert.equal(row.allocatedQuantity, 540); assert.equal(row.remainingQuantity, 60);
      for (const key of ['orderQuantity', 'allocatedQuantity', 'remainingQuantity', 'effectiveUnitMilliseconds', 'drawingFileCount', 'sopFileCount', 'status'] as const) {
        assert.equal(meta[key], all[key]); assert.equal(row[key], all[key]);
      }
      assert.deepEqual(meta.batches.map(batch => [batch.id, batch.warehouseStatus, batch.processStatus, batch.releaseState, batch.workOrderCompletedAt]),
        all.batches.map(batch => [batch.id, batch.warehouseStatus, batch.processStatus, batch.releaseState, batch.workOrderCompletedAt]));
      const onlyOptions = await loadPlanningRows('options');
      assert.deepEqual(onlyOptions, { orders: [], wipContinuations: [] });
    });
  } finally {
    await prisma.issue.delete({ where: { id: issue.id } });
    await prisma.productionCarryover.deleteMany({ where: { productionPlanBatchId: { in: batchIds } } });
    await prisma.productionPlanOrder.deleteMany({ where: { id: planId } });
    await prisma.workOrder.deleteMany({ where: { id: { in: ids } } });
  }
});
