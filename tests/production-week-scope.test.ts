import assert from 'node:assert/strict';
import test from 'node:test';
import { chinaDateKey } from '../lib/china-date';
import {
  hasRequiredProductionDocuments,
  isRootProductionOrder,
  naturalProductionWeek,
  productionFiltersFromSearchParams,
  productionRootWeekWhere,
  productionWeekWhere,
} from '../lib/production-execution';
import {
  alignProductionPlanBatchWeek,
  buildPlanningDrawingLibraryItemData,
  chinaDate,
  effectivePlanningUnitMilliseconds,
  parseProductionPlanBatchInput,
  parseProductionPlanOrderInput,
  planBatchSnapshot,
  previewProductionPlanRelease,
  productionPlanTargetWeek,
  resolveOrCreatePlanningProduct,
} from '../lib/production-planning';
import { countWeeklyOrdersMissingPublishedProductTime } from '../lib/weekly-work-orders';

test('natural production week is Monday through Sunday in China time', () => {
  const week = naturalProductionWeek(new Date('2026-07-20T04:00:00.000Z'));
  assert.equal(chinaDateKey(week.start), '2026-07-20');
  assert.equal(chinaDateKey(week.end), '2026-07-26');
});

test('production week scopes keep current, next, and carryover queries separate', () => {
  const start = new Date('2026-07-19T16:00:00.000Z');
  const end = new Date('2026-07-25T16:00:00.000Z');
  const current = JSON.stringify(productionWeekWhere({ scope: 'current', weekStart: start, weekEnd: end }));
  const next = JSON.stringify(productionWeekWhere({ scope: 'next', weekStart: start, weekEnd: end }));
  const carryover = JSON.stringify(productionWeekWhere({ scope: 'carryover', weekStart: start, weekEnd: end }));

  assert.match(current, /"planActive":true/);
  assert.match(current, /"gte":"2026-07-19T16:00:00.000Z"/);
  assert.match(next, /"planActive":false/);
  assert.match(next, /"planClearedAt":null/);
  assert.match(carryover, /"lt":"2026-07-19T16:00:00.000Z"/);
  assert.doesNotMatch(carryover, /"planActive"/);
});

test('production list scope keeps branch rows while root summary scope excludes them', () => {
  const start = new Date('2026-07-19T16:00:00.000Z');
  const end = new Date('2026-07-25T16:00:00.000Z');
  const listWhere = JSON.stringify(productionWeekWhere({ scope: 'current', weekStart: start, weekEnd: end }));
  const summaryWhere = JSON.stringify(productionRootWeekWhere({ scope: 'current', weekStart: start, weekEnd: end }));

  assert.doesNotMatch(listWhere, /"parentWorkOrderId"/);
  assert.match(summaryWhere, /"parentWorkOrderId":null/);
  assert.equal(isRootProductionOrder({ parentWorkOrderId: null }), true);
  assert.equal(isRootProductionOrder({ parentWorkOrderId: 'branch-parent-1' }), false);
});

test('production execution accepts an exact work-order deep-link target', () => {
  const filters = productionFiltersFromSearchParams(new URLSearchParams({
    workOrderId: 'work-order-branch-1',
    keyword: 'ignored only when it does not match the target',
  }));
  assert.equal(filters.workOrderId, 'work-order-branch-1');
  assert.equal(filters.keyword, 'ignored only when it does not match the target');
});

test('production documents require an original drawing but not every optional category', () => {
  type Input = Parameters<typeof hasRequiredProductionDocuments>[0];
  const originalOnly = {
    drawingLibraryItem: { files: [{ category: { code: 'drawing' } }] },
  } as Input;
  const sopOnly = {
    drawingLibraryItem: { files: [{ category: { code: 'sop' } }] },
  } as Input;
  assert.equal(hasRequiredProductionDocuments(originalOnly), true);
  assert.equal(hasRequiredProductionDocuments(sopOnly), false);
});

test('weekly activation blocks orders without a non-empty published product time profile', () => {
  const orders = [
    { drawingLibraryItem: null },
    { drawingLibraryItem: { productTimeProfiles: [] } },
    { drawingLibraryItem: { productTimeProfiles: [{ entries: [] }] } },
    { drawingLibraryItem: { productTimeProfiles: [{ entries: [{ id: 'entry-1' }] }] } },
  ];
  assert.equal(countWeeklyOrdersMissingPublishedProductTime(orders), 3);
});

test('planning order input keeps drawing product identity and salesperson without exposing source order fields', () => {
  const parsed = parseProductionPlanOrderInput({
    drawingLibraryItemId: 'drawing-product-1',
    customerName: '测试客户',
    salesperson: '业务员甲',
    productName: '测试产品',
    specification: 'TEST-001',
    orderQuantity: 20,
    planningUnitMilliseconds: 120_000,
    orderDate: '2026-07-20',
    customerDueDate: '2026-07-24',
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.data.drawingLibraryItemId, 'drawing-product-1');
  assert.equal(parsed.data.salesperson, '业务员甲');
  assert.equal(parsed.data.planningUnitMilliseconds, 120_000);
  assert.match(parsed.data.sourceOrderNo, /^PLAN-/);
  assert.equal(parsed.data.sourceLineNo, 1);
});

test('new planning orders may enter the order pool without unit labor time', () => {
  const parsed = parseProductionPlanOrderInput({
    drawingLibraryItemId: 'drawing-product-1',
    customerName: '测试客户',
    productName: '测试产品',
    specification: 'TEST-001',
    orderQuantity: 20,
    orderDate: '2026-07-20',
    customerDueDate: '2026-07-24',
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.data.planningUnitMilliseconds, null);
});

test('planning orders still reject an explicitly invalid unit labor time', () => {
  const parsed = parseProductionPlanOrderInput({
    drawingLibraryItemId: 'drawing-product-1',
    customerName: '测试客户',
    productName: '测试产品',
    specification: 'TEST-001',
    orderQuantity: 20,
    planningUnitMilliseconds: 0,
    orderDate: '2026-07-20',
    customerDueDate: '2026-07-24',
  });
  assert.equal(parsed.ok, false);
  if (parsed.ok) return;
  assert.match(parsed.error, /单件产品工时/);
});

test('a new plan product can be parsed without an existing drawing library id', () => {
  const parsed = parseProductionPlanOrderInput({
    customerName: '杭州测试(10999)',
    salesperson: '业务员甲',
    productName: '测试线束',
    specification: 'PLAN-NEW-001',
    orderQuantity: 20,
    planningUnitMilliseconds: 90_000,
    orderDate: '2026-07-20',
    customerDueDate: '2026-07-24',
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.data.drawingLibraryItemId, null);
  const drawing = buildPlanningDrawingLibraryItemData(parsed.data);
  assert.equal(drawing.ok, true);
  if (!drawing.ok) return;
  assert.equal(drawing.data.customerCode, '10999');
  assert.equal(drawing.data.libraryKey, '杭州测试(10999)::PLAN-NEW-001');
  assert.match(drawing.data.remark, /计划中心自动建档/);
});

test('planning product creation is idempotent and requires confirmation before restoring a deleted item', async () => {
  const parsed = parseProductionPlanOrderInput({
    customerName: '杭州测试(10999)',
    productName: '测试线束',
    specification: 'PLAN-NEW-002',
    orderQuantity: 20,
    planningUnitMilliseconds: 90_000,
    orderDate: '2026-07-20',
    customerDueDate: '2026-07-24',
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;

  let state: 'missing' | 'active' | 'deleted' = 'missing';
  let upsertCount = 0;
  const tx = {
    drawingLibraryItem: {
      findFirst: async () => state === 'active' ? {
        id: 'drawing-1',
        customerName: parsed.data.customerName,
        productName: parsed.data.productName,
        specification: parsed.data.specification,
        productTimeProfiles: [],
      } : null,
      findUnique: async () => state === 'missing' ? null : {
        id: 'drawing-1',
        deletedAt: state === 'deleted' ? new Date('2026-07-20T00:00:00.000Z') : null,
      },
      updateMany: async () => ({ count: state === 'active' ? 1 : 0 }),
      upsert: async () => {
        upsertCount += 1;
        state = 'active';
        return { id: 'drawing-1' };
      },
    },
  } as unknown as Parameters<typeof resolveOrCreatePlanningProduct>[0];

  const created = await resolveOrCreatePlanningProduct(tx, parsed.data, { createIfMissing: true, restoreIfDeleted: false });
  assert.equal(created.status, 'resolved');
  assert.equal(created.action, 'created');
  assert.equal(upsertCount, 1);

  const repeated = await resolveOrCreatePlanningProduct(tx, parsed.data, { createIfMissing: true, restoreIfDeleted: false });
  assert.equal(repeated.status, 'resolved');
  assert.equal(repeated.action, 'existing');
  assert.equal(upsertCount, 1);

  state = 'deleted';
  const blockedRestore = await resolveOrCreatePlanningProduct(tx, parsed.data, { createIfMissing: true, restoreIfDeleted: false });
  assert.equal(blockedRestore.status, 'restore_required');
  assert.equal(upsertCount, 1);

  const restored = await resolveOrCreatePlanningProduct(tx, parsed.data, { createIfMissing: true, restoreIfDeleted: true });
  assert.equal(restored.status, 'resolved');
  assert.equal(restored.action, 'restored');
  assert.equal(upsertCount, 2);
});

test('planning batches accept and snapshot an explicit unit labor time', () => {
  const parsed = parseProductionPlanBatchInput({
    quantity: 8500,
    unitMilliseconds: 20_000,
    weekStartDate: '2026-07-27',
    plannedCompletionDate: '2026-08-02',
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.data.unitMilliseconds, 20_000);
  assert.equal(planBatchSnapshot(parsed.data).unitMilliseconds, 20_000);
});

test('planning batches may remain drafts without unit labor time', () => {
  const parsed = parseProductionPlanBatchInput({
    quantity: 8500,
    weekStartDate: '2026-07-27',
    plannedCompletionDate: '2026-08-02',
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.data.unitMilliseconds, null);
  assert.equal(planBatchSnapshot(parsed.data).unitMilliseconds, null);
});

test('planning batches reject zero unit labor time', () => {
  const parsed = parseProductionPlanBatchInput({
    quantity: 8500,
    unitMilliseconds: 0,
    weekStartDate: '2026-07-27',
    plannedCompletionDate: '2026-08-02',
  });
  assert.equal(parsed.ok, false);
  if (parsed.ok) return;
  assert.match(parsed.error, /单根工时/);
});

test('current-week release aligns a next-week batch and keeps its completion weekday', () => {
  const now = new Date('2026-07-20T04:00:00.000Z');
  const target = productionPlanTargetWeek('active', now);
  const aligned = alignProductionPlanBatchWeek({
    weekStartDate: new Date('2026-07-27T04:00:00.000Z'),
    plannedCompletionDate: new Date('2026-08-02T04:00:00.000Z'),
  }, 'active', now);

  assert.equal(chinaDate(target.start), '2026-07-20');
  assert.equal(chinaDate(target.end), '2026-07-26');
  assert.equal(chinaDate(aligned.weekStartDate), '2026-07-20');
  assert.equal(chinaDate(aligned.weekEndDate), '2026-07-26');
  assert.equal(chinaDate(aligned.plannedCompletionDate), '2026-07-26');
});

test('next-week preparation aligns a current-week batch to the natural next week', () => {
  const now = new Date('2026-07-20T04:00:00.000Z');
  const target = productionPlanTargetWeek('preparation', now);
  const aligned = alignProductionPlanBatchWeek({
    weekStartDate: new Date('2026-07-20T04:00:00.000Z'),
    plannedCompletionDate: new Date('2026-07-22T04:00:00.000Z'),
  }, 'preparation', now);

  assert.equal(chinaDate(target.start), '2026-07-27');
  assert.equal(chinaDate(target.end), '2026-08-02');
  assert.equal(chinaDate(aligned.weekStartDate), '2026-07-27');
  assert.equal(chinaDate(aligned.weekEndDate), '2026-08-02');
  assert.equal(chinaDate(aligned.plannedCompletionDate), '2026-07-29');
});

test('batch labor time overrides product and order defaults', () => {
  assert.equal(effectivePlanningUnitMilliseconds(20_000, 30_000, 40_000), 20_000);
  assert.equal(effectivePlanningUnitMilliseconds(null, 30_000, 40_000), 30_000);
  assert.equal(effectivePlanningUnitMilliseconds(null, null, 40_000), 40_000);
  assert.equal(effectivePlanningUnitMilliseconds(null, null, null), null);
});

test('both current and next week releases require a published product process profile', async () => {
  const tx = {
    productionPlanBatch: {
      findMany: async () => [{
        id: 'batch-1',
        quantity: 20,
        releaseState: 'draft',
        weekStartDate: new Date('2026-07-20T04:00:00.000Z'),
        unitMillisecondsSnapshot: 20_000,
        planOrder: {
          drawingLibraryItemId: 'drawing-product-1',
          customerName: '测试客户',
          productName: '测试产品',
          specification: 'TEST-001',
          planningUnitMilliseconds: 20_000,
        },
      }],
    },
    drawingLibraryItem: {
      findFirst: async () => ({
        id: 'drawing-product-1',
        customerName: '测试客户',
        productName: '测试产品',
        specification: 'TEST-001',
        productTimeProfiles: [],
      }),
    },
  } as unknown as Parameters<typeof previewProductionPlanRelease>[0];

  for (const target of ['active', 'preparation'] as const) {
    const preview = await previewProductionPlanRelease(tx, {
      batchIds: ['batch-1'],
      target,
      now: new Date('2026-07-20T04:00:00.000Z'),
    });
    assert.equal(preview.blockers, 1);
    assert.match(preview.items[0].blockers[0], /产品工序与工时尚未发布/);
  }
});

test('published product process profile satisfies weekly release labor requirement', async () => {
  const tx = {
    productionPlanBatch: {
      findMany: async () => [{
        id: 'batch-1',
        quantity: 20,
        releaseState: 'draft',
        weekStartDate: new Date('2026-07-20T04:00:00.000Z'),
        unitMillisecondsSnapshot: null,
        planOrder: {
          drawingLibraryItemId: 'drawing-product-1',
          customerName: '测试客户',
          productName: '测试产品',
          specification: 'TEST-001',
          planningUnitMilliseconds: null,
        },
      }],
    },
    drawingLibraryItem: {
      findFirst: async () => ({
        id: 'drawing-product-1',
        customerName: '测试客户',
        productName: '测试产品',
        specification: 'TEST-001',
        productTimeProfiles: [{
          id: 'profile-1',
          version: 1,
          entries: [{ unitMilliseconds: 12_000 }, { unitMilliseconds: 8_000 }],
        }],
      }),
    },
  } as unknown as Parameters<typeof previewProductionPlanRelease>[0];

  const preview = await previewProductionPlanRelease(tx, {
    batchIds: ['batch-1'],
    target: 'active',
    now: new Date('2026-07-20T04:00:00.000Z'),
  });
  assert.equal(preview.blockers, 0);
  assert.equal(preview.items[0].blockers.length, 0);
});
