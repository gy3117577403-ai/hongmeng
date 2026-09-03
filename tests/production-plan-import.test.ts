import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildProductionPlanImportRows,
  findProductionPlanImportHeaderRow,
  summarizeProductionPlanImport,
  type ProductionPlanImportCandidate,
  type ProductionPlanImportExistingOrder,
} from '../lib/production-plan-import';

const headers = [
  '来源订单号*', '订单行号*', '订单日期*', '客户名称*', '产品名称*', '型号/规格*',
  '订单总量*', '本周排产量*', '客户交期*', '计划完成日期', '图纸库编号',
  '客户等级', '业务员', '备注',
];

const values = [
  'SO-1001', '1', '2026-09-03', '示例客户', '示例线束', 'ABC-001',
  '1000', '300', '2026-09-30', '2026-09-13', '', 'A', '张三', '',
];

function candidate(input: Partial<ProductionPlanImportCandidate> & Pick<ProductionPlanImportCandidate, 'id'>): ProductionPlanImportCandidate {
  return {
    id: input.id,
    libraryKey: input.libraryKey || '示例客户::ABC-001',
    customerName: input.customerName || '示例客户',
    productName: input.productName || '示例线束',
    specification: input.specification || 'ABC-001',
    deletedAt: input.deletedAt || null,
    drawingFileCount: input.drawingFileCount || 0,
    sopFileCount: input.sopFileCount || 0,
    productTimeVersion: input.productTimeVersion || null,
  };
}

function build(libraryItems: ProductionPlanImportCandidate[], existingOrders: ProductionPlanImportExistingOrder[] = []) {
  return buildProductionPlanImportRows({
    headers,
    rows: [values],
    startRowNo: 5,
    targetWeekStartDate: '2026-09-07',
    targetWeekEndDate: '2026-09-13',
    libraryItems,
    existingOrders,
  })[0];
}

test('recognizes the simplified template including required-field stars', () => {
  assert.equal(findProductionPlanImportHeaderRow([['说明'], headers]), 1);
});

test('reuses one existing active drawing library without creating a duplicate', () => {
  const row = build([candidate({ id: 'drawing-1', drawingFileCount: 1, sopFileCount: 1, productTimeVersion: 4 })]);
  assert.equal(row.status, 'ready');
  assert.equal(row.productAction, 'reuse');
  assert.equal(row.matchedDrawingLibraryItemId, 'drawing-1');
});

test('restores the unique archived drawing library and preserves its identity', () => {
  const row = build([candidate({ id: 'drawing-archived', deletedAt: '2026-09-01T00:00:00.000Z' })]);
  assert.equal(row.status, 'ready');
  assert.equal(row.productAction, 'restore');
  assert.equal(row.matchedDrawingLibraryItemId, 'drawing-archived');
});

test('creates only when no existing active or archived product matches', () => {
  const row = build([]);
  assert.equal(row.status, 'ready');
  assert.equal(row.productAction, 'create');
  assert.equal(row.matchedDrawingLibraryItemId, null);
});

test('multiple existing libraries are a visible conflict instead of creating a third library', () => {
  const row = build([
    candidate({ id: 'drawing-1', libraryKey: 'legacy-1', drawingFileCount: 1 }),
    candidate({ id: 'drawing-2', libraryKey: 'legacy-2', productTimeVersion: 2 }),
  ]);
  assert.equal(row.status, 'conflict');
  assert.equal(row.productAction, 'conflict');
  assert.equal(row.candidates.length, 2);
});

test('an existing order link has priority and a target-week duplicate is skipped', () => {
  const existing: ProductionPlanImportExistingOrder = {
    id: 'plan-1', sourceOrderNo: 'SO-1001', sourceLineNo: 1,
    drawingLibraryItemId: 'drawing-2', customerDueDate: '2026-09-30', status: 'scheduled',
    deletedAt: null, batchWeekStartDates: [],
  };
  const linked = build([
    candidate({ id: 'drawing-1', libraryKey: 'legacy-1' }),
    candidate({ id: 'drawing-2', libraryKey: 'legacy-2' }),
  ], [existing]);
  assert.equal(linked.status, 'ready');
  assert.equal(linked.matchedDrawingLibraryItemId, 'drawing-2');

  const duplicate = build([candidate({ id: 'drawing-2' })], [{ ...existing, batchWeekStartDates: ['2026-09-07'] }]);
  assert.equal(duplicate.status, 'duplicate');
  assert.equal(summarizeProductionPlanImport([duplicate]).duplicateCount, 1);
});

test('keeps order total and target-week planned quantity as separate validated values', () => {
  const row = build([]);
  assert.equal(row.input?.orderQuantity, 1000);
  assert.equal(row.input?.plannedQuantity, 300);
});
