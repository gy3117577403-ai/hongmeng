import assert from 'node:assert/strict';
import test from 'node:test';
import {
  matchesPlanningReadiness,
  orderLevelReadinessFilters,
  planningReadinessState,
} from '../lib/planning-readiness';
import type { ProductionPlanBatchDTO, ProductionPlanOrderDTO } from '../types';

function order(overrides: Partial<ProductionPlanOrderDTO> = {}): ProductionPlanOrderDTO {
  return {
    id: 'order-1',
    sourceOrderNo: 'PLAN-001',
    sourceLineNo: 1,
    customerName: '测试客户',
    salesperson: '业务员',
    productName: '测试产品',
    specification: 'SPEC-001',
    drawingLibraryItemId: 'drawing-1',
    drawingFileCount: 0,
    sopFileCount: 0,
    sopStage: null,
    sopDrawingStatus: null,
    sopRemark: null,
    sopMetadataUpdatedAt: null,
    orderQuantity: 100,
    planningUnitMilliseconds: null,
    effectiveUnitMilliseconds: null,
    planningTotalMilliseconds: null,
    allocatedQuantity: 100,
    remainingQuantity: 0,
    orderDate: '2026-07-20',
    customerDueDate: '2026-07-25',
    priority: 'normal',
    status: 'scheduled',
    remark: null,
    currentUnitMilliseconds: null,
    currentProductTimeVersion: null,
    batches: [],
    createdAt: '2026-07-20T00:00:00.000Z',
    updatedAt: '2026-07-20T00:00:00.000Z',
    ...overrides,
  };
}

function batch(overrides: Partial<ProductionPlanBatchDTO> = {}): ProductionPlanBatchDTO {
  return {
    id: 'batch-1',
    planOrderId: 'order-1',
    batchNo: 1,
    quantity: 100,
    weekStartDate: '2026-07-20',
    weekEndDate: '2026-07-26',
    plannedCompletionDate: '2026-07-25',
    releaseState: 'draft',
    workOrderId: null,
    productTimeProfileId: null,
    productTimeProfileVersion: null,
    unitMillisecondsSnapshot: null,
    totalMillisecondsSnapshot: null,
    warehouseStatus: 'not_created',
    processStatus: 'not_created',
    releasedAt: null,
    activatedAt: null,
    createdAt: '2026-07-20T00:00:00.000Z',
    updatedAt: '2026-07-20T00:00:00.000Z',
    ...overrides,
  };
}

test('identifies missing drawing and time before preparation is ready', () => {
  const missing = planningReadinessState(order());
  assert.equal(missing.missing_time, true);
  assert.equal(missing.missing_drawing, true);
  assert.equal(missing.missing_sop, true);
  assert.equal(missing.ready_preparation, false);

  const ready = planningReadinessState(order({ drawingFileCount: 1, sopFileCount: 1, planningUnitMilliseconds: 30_000 }));
  assert.equal(ready.missing_time, false);
  assert.equal(ready.missing_drawing, false);
  assert.equal(ready.ready_preparation, true);
});

test('accepts a frozen batch time snapshot as effective planning time', () => {
  const state = planningReadinessState(
    order({ drawingFileCount: 1, sopFileCount: 1 }),
    batch({ unitMillisecondsSnapshot: 18_000 }),
  );
  assert.equal(state.missing_time, false);
  assert.equal(state.ready_preparation, true);
});

test('separates material exception from material not prepared', () => {
  const pending = planningReadinessState(order(), batch({ warehouseStatus: 'pending' }));
  assert.equal(pending.missing_material, true);
  assert.equal(pending.material_exception, false);

  const exception = planningReadinessState(order(), batch({ warehouseStatus: 'exception' }));
  assert.equal(exception.missing_material, false);
  assert.equal(exception.material_exception, true);
});

test('treats only confirmed or started process routes as arranged', () => {
  assert.equal(planningReadinessState(order(), batch({ processStatus: 'draft' })).missing_process, true);
  assert.equal(planningReadinessState(order(), batch({ processStatus: 'confirmed' })).missing_process, false);
  assert.equal(planningReadinessState(order(), batch({ processStatus: 'in_progress' })).missing_process, false);
});

test('marks production ready only when all preparation departments are ready', () => {
  const preparedOrder = order({ drawingFileCount: 1, sopFileCount: 1, currentUnitMilliseconds: 20_000 });
  const ready = planningReadinessState(preparedOrder, batch({ warehouseStatus: 'completed', processStatus: 'confirmed' }));
  assert.equal(ready.ready_production, true);

  const waitingWarehouse = planningReadinessState(preparedOrder, batch({ warehouseStatus: 'pending', processStatus: 'confirmed' }));
  assert.equal(waitingWarehouse.ready_production, false);
});

test('combines deficiency filters with OR matching', () => {
  const drawingMissing = order({ drawingFileCount: 0, sopFileCount: 1, planningUnitMilliseconds: 20_000 });
  assert.equal(matchesPlanningReadiness(drawingMissing, undefined, ['missing_time', 'missing_drawing']), true);

  const prepared = order({ drawingFileCount: 1, sopFileCount: 1, planningUnitMilliseconds: 20_000 });
  assert.equal(matchesPlanningReadiness(prepared, undefined, ['missing_time', 'missing_drawing']), false);
});

test('keeps SOP file readiness separate from the SOP lifecycle stage', () => {
  const validatingWithFile = planningReadinessState(order({
    drawingFileCount: 1,
    sopFileCount: 1,
    planningUnitMilliseconds: 20_000,
    sopStage: 'validating',
  }));
  assert.equal(validatingWithFile.missing_sop, false);
  assert.equal(validatingWithFile.sop_validating, true);
  assert.equal(validatingWithFile.ready_preparation, true);

  const validatingWithoutFile = planningReadinessState(order({
    drawingFileCount: 1,
    sopFileCount: 0,
    planningUnitMilliseconds: 20_000,
    sopStage: 'validating',
  }));
  assert.equal(validatingWithoutFile.missing_sop, true);
  assert.equal(validatingWithoutFile.sop_validating, true);
  assert.equal(validatingWithoutFile.ready_preparation, false);
});

test('classifies new-product and unregistered SOP metadata independently', () => {
  assert.equal(planningReadinessState(order({ sopStage: 'new_product' })).sop_new_product, true);
  assert.equal(planningReadinessState(order({ sopStage: 'new_product' })).sop_unregistered, false);
  assert.equal(planningReadinessState(order({ sopStage: null })).sop_unregistered, true);
});

test('limits order-pool readiness filters to order-level information', () => {
  assert.deepEqual(
    orderLevelReadinessFilters([
      'missing_time',
      'missing_sop',
      'sop_validating',
      'sop_new_product',
      'sop_unregistered',
      'missing_material',
      'missing_process',
      'ready_preparation',
    ]),
    ['missing_time', 'missing_sop', 'sop_validating', 'sop_new_product', 'sop_unregistered', 'ready_preparation'],
  );
});

test('tracks physical print confirmation separately from preview generation', () => {
  assert.equal(planningReadinessState(order(), batch({ travelerPrintStatus: 'generated' })).print_not_confirmed, true);
  assert.equal(planningReadinessState(order(), batch({ travelerPrintStatus: 'partial' })).print_not_confirmed, true);
  assert.equal(planningReadinessState(order(), batch({ travelerPrintStatus: 'printed' })).print_confirmed, true);
  assert.equal(planningReadinessState(order(), batch({ travelerPrintStatus: 'needs_reprint' })).print_needs_reprint, true);
});
