import assert from 'node:assert/strict';
import test from 'node:test';
import { buildProductionWeekReconciliation } from '../lib/production-week-reconciliation';

const weekStart = new Date('2026-07-19T16:00:00.000Z');

test('week reconciliation reports aligned plan, production and workflow counts', () => {
  const result = buildProductionWeekReconciliation({
    weekStartDate: '2026-07-20',
    weekEndDate: '2026-07-26',
    batches: [{
      id: 'batch-1',
      specification: 'A-001',
      releaseState: 'active',
      workOrderId: 'work-1',
      workOrder: {
        id: 'work-1',
        code: 'WO-1',
        specification: 'A-001',
        parentWorkOrderId: null,
        rootWorkOrderId: null,
        weekStartDate: weekStart,
        planType: 'weekly_plan',
        planActive: true,
        planClearedAt: null,
        deletedAt: null,
      },
    }],
    workOrders: [{
      id: 'work-1',
      code: 'WO-1',
      specification: 'A-001',
      weekStartDate: weekStart,
      planActive: false,
      productionPlanBatch: {
        id: 'batch-1',
        weekStartDate: weekStart,
        deletedAt: null,
        planOrder: { deletedAt: null },
      },
    }],
  });

  assert.equal(result.aligned, true);
  assert.deepEqual(
    [result.planBatchCount, result.productionWorkOrderCount, result.workflowInstanceCount],
    [1, 1, 1],
  );
  assert.equal(result.differenceCount, 0);
});

test('week reconciliation separates legacy work orders from the selected plan week', () => {
  const result = buildProductionWeekReconciliation({
    weekStartDate: '2026-07-20',
    weekEndDate: '2026-07-26',
    batches: [{
      id: 'batch-1',
      specification: 'A-001',
      releaseState: 'preparation',
      workOrderId: null,
      workOrder: null,
    }],
    workOrders: [{
      id: 'legacy-1',
      code: 'WO-LEGACY',
      specification: 'LEGACY-001',
      weekStartDate: weekStart,
      planActive: true,
      productionPlanBatch: null,
    }],
  });

  assert.equal(result.aligned, false);
  assert.equal(result.planBatchCount, 1);
  assert.equal(result.productionWorkOrderCount, 0);
  assert.equal(result.workflowInstanceCount, 1);
  assert.equal(result.issues.find(item => item.code === 'plan_missing_work_order')?.count, 1);
  assert.equal(result.issues.find(item => item.code === 'work_order_missing_plan')?.count, 1);
});

test('week reconciliation counts preparation and legacy active batches as current execution rows', () => {
  const result = buildProductionWeekReconciliation({
    weekStartDate: '2026-07-20',
    weekEndDate: '2026-07-26',
    checkExecutionEligibility: true,
    batches: [{
      id: 'batch-active-legacy',
      specification: 'ACTIVE-LEGACY',
      releaseState: 'active',
      workOrderId: 'work-active-legacy',
      workOrder: {
        id: 'work-active-legacy',
        code: 'WO-ACTIVE',
        specification: 'ACTIVE-LEGACY',
        parentWorkOrderId: null,
        rootWorkOrderId: null,
        weekStartDate: null,
        planType: null,
        planActive: false,
        planClearedAt: null,
        deletedAt: null,
      },
    }, {
      id: 'batch-preparation',
      specification: 'PREPARATION-ONLY',
      releaseState: 'preparation',
      workOrderId: 'work-preparation',
      workOrder: {
        id: 'work-preparation',
        code: 'WO-PREPARATION',
        specification: 'PREPARATION-ONLY',
        parentWorkOrderId: null,
        rootWorkOrderId: null,
        weekStartDate: weekStart,
        planType: 'weekly_plan',
        planActive: false,
        planClearedAt: null,
        deletedAt: null,
      },
    }],
    workOrders: [{
      id: 'work-active-legacy',
      code: 'WO-ACTIVE',
      specification: 'ACTIVE-LEGACY',
      weekStartDate: weekStart,
      planActive: false,
      productionPlanBatch: {
        id: 'batch-active-legacy', weekStartDate: weekStart, deletedAt: null, planOrder: { deletedAt: null },
      },
    }, {
      id: 'work-preparation',
      code: 'WO-PREPARATION',
      specification: 'PREPARATION-ONLY',
      weekStartDate: weekStart,
      planActive: false,
      productionPlanBatch: {
        id: 'batch-preparation', weekStartDate: weekStart, deletedAt: null, planOrder: { deletedAt: null },
      },
    }],
  });

  assert.equal(result.productionWorkOrderCount, 1);
  assert.equal(result.executableWorkOrderCount, 2);
  assert.equal(result.aligned, false);
  assert.equal(result.issues.find(item => item.code === 'work_order_week_mismatch')?.count, 1);
  assert.equal(result.issues.find(item => item.code === 'workflow_missing_work_order'), undefined);
  assert.equal(result.issues.find(item => item.code === 'work_order_not_executable'), undefined);
});
