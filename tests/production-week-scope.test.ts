import assert from 'node:assert/strict';
import test from 'node:test';
import { chinaDateKey } from '../lib/china-date';
import {
  hasOriginalProductionDrawing,
  hasNextProductionProcess,
  hasProductionSop,
  hasRequiredProductionDocuments,
  isProductionDueSoon,
  isRootProductionOrder,
  naturalProductionWeek,
  productionFiltersFromSearchParams,
  productionRootWeekWhere,
  productionSummaryInclude,
  productionWeekWhere,
} from '../lib/production-execution';
import {
  alignProductionPlanBatchWeek,
  automaticProductionPlanReleaseTarget,
  buildPlanningDrawingLibraryItemData,
  chinaDate,
  effectivePlanningUnitMilliseconds,
  parseProductionPlanBatchInput,
  parseProductionPlanOrderInput,
  planBatchSnapshot,
  previewProductionPlanRelease,
  productionPlanTargetWeek,
  releaseProductionPlanBatch,
  resolveOrCreatePlanningProduct,
} from '../lib/production-planning';
import { countWeeklyOrdersMissingPublishedProductTime } from '../lib/weekly-work-orders';

const requiredProductionResourceFiles = [
  {
    id: 'drawing-file-1',
    version: 'V1',
    updatedAt: new Date('2026-07-19T04:00:00.000Z'),
    category: { code: 'drawing' },
  },
  {
    id: 'sop-file-1',
    version: 'V1',
    updatedAt: new Date('2026-07-19T04:00:00.000Z'),
    category: { code: 'sop' },
  },
];

test('natural production week is Monday through Sunday in China time', () => {
  const week = naturalProductionWeek(new Date('2026-07-20T04:00:00.000Z'));
  assert.equal(chinaDateKey(week.start), '2026-07-20');
  assert.equal(chinaDateKey(week.end), '2026-07-26');
});

test('current and next week scheduling automatically enters the matching production view', () => {
  const now = new Date('2026-08-03T04:00:00.000Z');
  const currentWeek = new Date('2026-08-03T04:00:00.000Z');
  const nextWeek = new Date('2026-08-10T04:00:00.000Z');
  const afterNextWeek = new Date('2026-08-17T04:00:00.000Z');

  assert.equal(automaticProductionPlanReleaseTarget({
    weekStartDate: currentWeek,
    releaseState: 'draft',
    workOrderId: null,
  }, now), 'active');
  assert.equal(automaticProductionPlanReleaseTarget({
    weekStartDate: currentWeek,
    releaseState: 'preparation',
    workOrderId: 'work-order-1',
  }, now), 'active');
  assert.equal(automaticProductionPlanReleaseTarget({
    weekStartDate: currentWeek,
    releaseState: 'active',
    workOrderId: 'work-order-1',
  }, now), null);
  assert.equal(automaticProductionPlanReleaseTarget({
    weekStartDate: currentWeek,
    releaseState: 'active',
    workOrderId: null,
  }, now), 'active');
  assert.equal(automaticProductionPlanReleaseTarget({
    weekStartDate: nextWeek,
    releaseState: 'draft',
    workOrderId: null,
  }, now), 'preparation');
  assert.equal(automaticProductionPlanReleaseTarget({
    weekStartDate: nextWeek,
    releaseState: 'preparation',
    workOrderId: 'work-order-2',
  }, now), null);
  assert.equal(automaticProductionPlanReleaseTarget({
    weekStartDate: nextWeek,
    releaseState: 'preparation',
    workOrderId: null,
  }, now), 'preparation');
  assert.equal(automaticProductionPlanReleaseTarget({
    weekStartDate: afterNextWeek,
    releaseState: 'draft',
    workOrderId: null,
  }, now), null);
  assert.equal(automaticProductionPlanReleaseTarget({
    weekStartDate: currentWeek,
    releaseState: 'archived',
    workOrderId: null,
  }, now), null);
});

test('production week scopes keep canonical current, future, and carryover queries separate', () => {
  const start = new Date('2026-07-19T16:00:00.000Z');
  const end = new Date('2026-07-25T16:00:00.000Z');
  const current = JSON.stringify(productionWeekWhere({ scope: 'current', weekStart: start, weekEnd: end }));
  const next = JSON.stringify(productionWeekWhere({ scope: 'next', weekStart: start, weekEnd: end }));
  const afterNext = JSON.stringify(productionWeekWhere({ scope: 'afterNext', weekStart: start, weekEnd: end }));
  const carryover = JSON.stringify(productionWeekWhere({ scope: 'carryover', weekStart: start, weekEnd: end }));

  assert.match(current, /"planActive":true/);
  assert.match(current, /"productionPlanBatch"/);
  assert.match(current, /"releaseState":\{"in":\["active","preparation"\]\}/);
  assert.match(current, /"gte":"2026-07-19T16:00:00.000Z"/);
  assert.match(next, /"planActive":false/);
  assert.match(next, /"planClearedAt":null/);
  assert.match(afterNext, /"planActive":false/);
  assert.match(afterNext, /"productionPlanBatch"/);
  assert.match(carryover, /"lt":"2026-07-19T16:00:00.000Z"/);
  assert.doesNotMatch(carryover, /"planActive"/);
  assert.match(carryover, /"productionPlanBatch"/);
  assert.match(carryover, /"releaseState":\{"in":\["active","preparation","archived"\]\}/);
  assert.match(carryover, /"completedAt":null/);
  assert.match(carryover, /"planOrder":\{"deletedAt":null\}/);
});

test('production execution uses linked batch facts only for legacy scheduling metadata gaps', () => {
  const currentStart = new Date('2026-08-30T16:00:00.000Z');
  const currentEnd = new Date('2026-09-05T16:00:00.000Z');
  const nextStart = new Date('2026-09-06T16:00:00.000Z');
  const nextEnd = new Date('2026-09-12T16:00:00.000Z');
  const historyStart = new Date('2026-08-23T16:00:00.000Z');
  const historyEnd = new Date('2026-08-29T16:00:00.000Z');

  const current = JSON.stringify(productionWeekWhere({ scope: 'current', weekStart: currentStart, weekEnd: currentEnd }));
  const next = JSON.stringify(productionWeekWhere({ scope: 'next', weekStart: nextStart, weekEnd: nextEnd }));
  const history = JSON.stringify(productionWeekWhere({ scope: 'history', weekStart: historyStart, weekEnd: historyEnd }));
  const carryover = JSON.stringify(productionWeekWhere({ scope: 'carryover', weekStart: currentStart, weekEnd: currentEnd }));

  assert.match(current, /"releaseState":\{"in":\["active","preparation"\]\}/);
  assert.match(next, /"releaseState":"preparation"/);
  assert.match(history, /"weekStartDate":\{"gte":"2026-08-23T16:00:00.000Z"/);
  assert.match(carryover, /"releaseState":\{"in":\["active","preparation","archived"\]\}/);
  assert.match(carryover, /"weekStartDate":\{"lt":"2026-08-30T16:00:00.000Z"\}/);
  assert.match(carryover, /"parentWorkOrder"/);
  assert.match(carryover, /"rootWorkOrder"/);
  assert.match(carryover, /"completedAt":null/);
  for (const where of [current, next, history, carryover]) {
    assert.match(where, /"productionPlanBatch"/);
    assert.match(where, /"planOrder":\{"deletedAt":null\}/);
    assert.match(where, /"deletedAt":null/);
    assert.doesNotMatch(where, /"plannedAt"/, 'dates alone never turn an unlinked legacy order into a scheduled order');
  }
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

test('production execution accepts exact dispatch metric quick filters', () => {
  const filters = productionFiltersFromSearchParams(new URLSearchParams({
    quick: 'in_production,not_started,due_soon,has_next_process,waiting_transfer,not-a-filter',
  }));
  assert.deepEqual(filters.quick, ['in_production', 'not_started', 'due_soon', 'has_next_process', 'waiting_transfer']);
});

test('lightweight production scan excludes execution ledgers and keeps route status fields needed by filters', () => {
  const stepSelect = productionSummaryInclude.processRoute.select.steps.select;
  assert.deepEqual(stepSelect, { status: true, sequenceGroup: true });
  assert.equal('executions' in stepSelect, false);
  assert.equal('completions' in stepSelect, false);
});

test('next-process filter matches the serialized route transition semantics', () => {
  const order = (stage: string, steps: Array<{ status: string; sequenceGroup: number }>) => ({
    stage,
    status: 'active',
    processRoute: { steps },
  }) as Parameters<typeof hasNextProductionProcess>[0];

  assert.equal(hasNextProductionProcess(order('frontend', [
    { status: 'current', sequenceGroup: 1 },
    { status: 'pending', sequenceGroup: 2 },
  ])), true);
  assert.equal(hasNextProductionProcess(order('frontend', [
    { status: 'current', sequenceGroup: 2 },
    { status: 'pending', sequenceGroup: 1 },
  ])), false);
  assert.equal(hasNextProductionProcess(order('not_issued', [
    { status: 'pending', sequenceGroup: 1 },
  ])), true);
  assert.equal(hasNextProductionProcess(order('completed', [
    { status: 'pending', sequenceGroup: 2 },
  ])), false);
});

test('due-soon uses the customer delivery day and a stable China-time 0-2 day window', () => {
  const now = new Date('2026-08-03T04:00:00.000Z');
  const order = (deliveryDay: string | null, stage = 'frontend', plannedAt = new Date('2026-08-20T04:00:00.000Z')) => ({
    stage,
    status: 'active',
    deliveryDay,
    plannedAt,
  }) as Parameters<typeof isProductionDueSoon>[0];

  assert.equal(isProductionDueSoon(order('2026-08-03'), now), true);
  assert.equal(isProductionDueSoon(order('2026-08-05'), now), true);
  assert.equal(isProductionDueSoon(order('2026-08-06'), now), false);
  assert.equal(isProductionDueSoon(order('2026-08-02'), now), false);
  assert.equal(isProductionDueSoon(order('2026-08-05', 'completed'), now), false);
  assert.equal(isProductionDueSoon(order(null, 'frontend', new Date('2026-08-04T04:00:00.000Z')), now), false, 'internal dates are not a customer promise');
});

test('production documents require both an original drawing and an SOP', () => {
  type Input = Parameters<typeof hasRequiredProductionDocuments>[0];
  const originalOnly = {
    drawingLibraryItem: { files: [{ category: { code: 'drawing' } }] },
  } as Input;
  const sopOnly = {
    drawingLibraryItem: { files: [{ category: { code: 'sop' } }] },
  } as Input;
  const drawingAndSop = {
    drawingLibraryItem: { files: [{ category: { code: 'drawing' } }, { category: { code: 'sop' } }] },
  } as Input;
  assert.equal(hasOriginalProductionDrawing(originalOnly), true);
  assert.equal(hasProductionSop(originalOnly), false);
  assert.equal(hasOriginalProductionDrawing(sopOnly), false);
  assert.equal(hasProductionSop(sopOnly), true);
  assert.equal(hasRequiredProductionDocuments(originalOnly), false);
  assert.equal(hasRequiredProductionDocuments(sopOnly), false);
  assert.equal(hasRequiredProductionDocuments(drawingAndSop), true);
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
      findMany: async () => state === 'active' ? [{
        id: 'drawing-1',
        libraryKey: '杭州测试(10999)::PLAN-NEW-002',
        customerName: parsed.data.customerName,
        specification: parsed.data.specification,
        _count: { files: 0 },
      }] : [],
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

test('missing product process profile can release for warehouse preparation but remains a production warning', async () => {
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
        files: requiredProductionResourceFiles,
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
    assert.equal(preview.blockers, 0);
    assert.equal(preview.items[0].blockers.length, 0);
    const productTimeWarning = preview.items[0].warnings.find(message => message.includes('产品工序与工时尚未发布'));
    assert.ok(productTimeWarning);
    assert.match(productTimeWarning, /可先下达仓库配料/);
    assert.match(productTimeWarning, /生产启动前必须补齐/);
  }
});

test('validating SOP remains schedulable and is surfaced as a release warning', async () => {
  const tx = {
    productionPlanBatch: {
      findMany: async () => [{
        id: 'batch-validating-sop',
        quantity: 10,
        releaseState: 'draft',
        weekStartDate: new Date('2026-08-24T04:00:00.000Z'),
        unitMillisecondsSnapshot: 20_000,
        planOrder: {
          drawingLibraryItemId: 'drawing-validating-sop',
          customerName: '验证客户',
          productName: '验证产品',
          specification: 'SOP-VALIDATING-001',
          planningUnitMilliseconds: 20_000,
        },
      }],
    },
    drawingLibraryItem: {
      findFirst: async () => ({
        id: 'drawing-validating-sop',
        customerName: '验证客户',
        productName: '验证产品',
        specification: 'SOP-VALIDATING-001',
        files: requiredProductionResourceFiles,
        productTimeProfiles: [{
          id: 'profile-validating-sop',
          version: 1,
          entries: [{ unitMilliseconds: 20_000 }],
        }],
        sopDocument: {
          sopStage: 'validating',
          drawingStatus: 'available',
          remark: '样品参数需验证',
          deletedAt: null,
          updatedAt: new Date('2026-08-22T03:43:00.000Z'),
        },
      }),
    },
  } as unknown as Parameters<typeof previewProductionPlanRelease>[0];

  const preview = await previewProductionPlanRelease(tx, {
    batchIds: ['batch-validating-sop'],
    target: 'preparation',
    now: new Date('2026-08-22T04:00:00.000Z'),
  });

  assert.equal(preview.blockers, 0);
  assert.equal(preview.validatingSopCount, 1);
  assert.equal(preview.items[0].sopStage, 'validating');
  assert.equal(preview.items[0].sopValidationRequired, true);
  assert.equal(preview.items[0].sopRemark, '样品参数需验证');
  assert.equal(preview.items[0].sopMetadataUpdatedAt, '2026-08-22T03:43:00.000Z');
  assert.match(preview.items[0].warnings.join('；'), /SOP处于验证中/);
  assert.match(preview.items[0].warnings.join('；'), /样品参数需验证/);
});

test('releasing without product time still creates a warehouse task and a pending production route', async () => {
  let createdWorkOrder: Record<string, unknown> | null = null;
  let warehouseTask: Record<string, unknown> | null = null;
  let createdRoute: Record<string, unknown> | null = null;
  const batch = {
    id: 'batch-1',
    batchNo: 1,
    planOrderId: 'order-1',
    quantity: 20,
    releaseState: 'draft',
    weekStartDate: new Date('2026-07-20T04:00:00.000Z'),
    weekEndDate: new Date('2026-07-26T04:00:00.000Z'),
    plannedCompletionDate: new Date('2026-07-24T04:00:00.000Z'),
    unitMillisecondsSnapshot: null,
    workOrderId: null,
    workOrder: null,
    deletedAt: null,
    releasedAt: null,
    releasedById: null,
    activatedAt: null,
    activatedById: null,
    planOrder: {
      deletedAt: null,
      drawingLibraryItemId: 'drawing-product-1',
      sourceOrderNo: 'SO-001',
      sourceLineNo: 1,
      customerName: '测试客户',
      salesperson: '测试业务员',
      productName: '测试产品',
      specification: 'TEST-001',
      priority: 'normal',
      remark: null,
      orderDate: new Date('2026-07-18T04:00:00.000Z'),
      customerDueDate: new Date('2026-07-30T04:00:00.000Z'),
      planningUnitMilliseconds: null,
    },
  };
  const tx = {
    $executeRaw: async () => 0,
    productionPlanBatch: {
      findUnique: async () => batch,
      update: async () => ({}),
    },
    drawingLibraryItem: {
      findFirst: async () => ({
        id: 'drawing-product-1',
        customerName: '测试客户',
        productName: '测试产品',
        specification: 'TEST-001',
        _count: { files: 1 },
        files: requiredProductionResourceFiles,
        productTimeProfiles: [],
      }),
    },
    workOrder: {
      findMany: async () => [],
      create: async ({ data }: { data: Record<string, unknown> }) => {
        createdWorkOrder = data;
        return { id: 'work-order-1' };
      },
      findUnique: async () => ({
        id: 'work-order-1',
        drawingLibraryItemId: 'drawing-product-1',
        specification: 'TEST-001',
        stage: 'not_issued',
        status: 'pending',
        uncompletedQty: '20',
        productionTargetQty: 20,
      }),
    },
    warehouseMaterialTask: {
      upsert: async ({ create }: { create: Record<string, unknown> }) => {
        warehouseTask = create;
        return {};
      },
    },
    productTimeProfile: {
      findFirst: async () => null,
    },
    workOrderProcessRoute: {
      findUnique: async () => null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        createdRoute = data;
        return { id: 'route-1' };
      },
    },
    productionPlanOrder: {
      findUnique: async () => ({
        orderQuantity: 20,
        status: 'pending',
        batches: [{ quantity: 20, releaseState: 'active' }],
      }),
      update: async () => ({}),
    },
    productionPlanChange: {
      create: async () => ({}),
    },
    operationLog: {
      create: async () => ({}),
    },
  } as unknown as Parameters<typeof releaseProductionPlanBatch>[0];

  const result = await releaseProductionPlanBatch(tx, {
    batchId: 'batch-1',
    target: 'active',
    actorId: 'user-1',
    now: new Date('2026-07-20T04:00:00.000Z'),
  });

  assert.equal(createdWorkOrder?.['planActive'], true);
  assert.equal(createdWorkOrder?.['drawingStatus'], '已发');
  assert.equal(
    (createdWorkOrder?.['drawingIssuedAt'] as Date | undefined)?.toISOString(),
    '2026-07-20T04:00:00.000Z',
  );
  assert.equal(createdWorkOrder?.['unitWorkHours'], null);
  assert.equal(warehouseTask?.['workOrderId'], 'work-order-1');
  assert.equal(warehouseTask?.['status'], 'pending');
  assert.equal(createdRoute?.['routeSource'], 'product_time_pending');
  assert.equal(createdRoute?.['status'], 'draft');
  assert.match(result.warnings.join('；'), /仓库可先配料/);
  assert.match(result.warnings.join('；'), /生产启动前必须发布/);
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
        files: requiredProductionResourceFiles,
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
  assert.equal(preview.warnings, 0);
});
