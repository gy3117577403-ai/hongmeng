import assert from 'node:assert/strict';
import test from 'node:test';
import { chinaDateKey } from '../lib/china-date';
import {
  hasRequiredProductionDocuments,
  naturalProductionWeek,
  productionWeekWhere,
} from '../lib/production-execution';
import {
  effectivePlanningUnitMilliseconds,
  parseProductionPlanBatchInput,
  parseProductionPlanOrderInput,
  planBatchSnapshot,
} from '../lib/production-planning';

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

test('new planning orders require a positive unit labor time', () => {
  const parsed = parseProductionPlanOrderInput({
    drawingLibraryItemId: 'drawing-product-1',
    customerName: '测试客户',
    productName: '测试产品',
    specification: 'TEST-001',
    orderQuantity: 20,
    orderDate: '2026-07-20',
    customerDueDate: '2026-07-24',
  });
  assert.equal(parsed.ok, false);
  if (parsed.ok) return;
  assert.match(parsed.error, /单件产品工时/);
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

test('batch labor time overrides product and order defaults', () => {
  assert.equal(effectivePlanningUnitMilliseconds(20_000, 30_000, 40_000), 20_000);
  assert.equal(effectivePlanningUnitMilliseconds(null, 30_000, 40_000), 30_000);
  assert.equal(effectivePlanningUnitMilliseconds(null, null, 40_000), 40_000);
  assert.equal(effectivePlanningUnitMilliseconds(null, null, null), null);
});
