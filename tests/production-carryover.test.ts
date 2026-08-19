import assert from 'node:assert/strict';
import test from 'node:test';
import {
  activeProductionCarryoverBatchWhere,
  activeProductionCarryoverLinkWhere,
  activeProductionCarryoverWorkOrderWhere,
  productionCarryoverDayWindow,
} from '../lib/production-carryovers';
import { workflowItemMatchesWeekScope } from '../lib/workflows';

test('carryover query is pinned to one target week and an active preserved batch', () => {
  const batchWhere = activeProductionCarryoverBatchWhere('2026-08-10');
  assert.equal(batchWhere.deletedAt, null);
  assert.deepEqual(batchWhere.releaseState, { in: ['active', 'preparation', 'archived'] });
  assert.deepEqual(batchWhere.workOrderId, { not: null });
  assert.deepEqual(batchWhere.workOrder, {
    is: {
      deletedAt: null,
      completedAt: null,
      NOT: {
        OR: [
          { stage: { in: ['completed', 'complete', 'done', '已完成'] } },
          { status: { in: ['completed', 'complete', 'done', '已完成'] } },
        ],
      },
    },
  });
  assert.deepEqual(batchWhere.carryovers, {
    some: {
      targetWeekStartDate: productionCarryoverDayWindow('2026-08-10'),
      status: 'ACTIVE',
    },
  });
  assert.equal(Array.isArray(activeProductionCarryoverWorkOrderWhere('2026-08-10').OR), true);

  const linkWhere = activeProductionCarryoverLinkWhere('2026-08-10');
  assert.equal(linkWhere.status, 'ACTIVE');
  assert.deepEqual(linkWhere.targetWeekStartDate, productionCarryoverDayWindow('2026-08-10'));
  assert.equal((linkWhere.productionPlanBatch as { deletedAt?: unknown }).deletedAt, null);
  assert.equal((linkWhere.workOrder as { deletedAt?: unknown }).deletedAt, null);
});

test('workflow current scope accepts a carried order while history keeps its original week', () => {
  const item = {
    entityType: 'production' as const,
    weekStartDate: '2026-07-20T04:00:00.000Z',
    weekEndDate: '2026-07-26T04:00:00.000Z',
    carryover: {
      id: 'carryover-1',
      sourceWeekStartDate: '2026-08-03',
      targetWeekStartDate: '2026-08-10',
      originalWeekStartDate: '2026-07-20',
      inclusionType: 'AUTO_PREVIOUS_WEEK',
    },
  };
  const now = new Date('2026-08-10T04:00:00.000Z');
  assert.equal(workflowItemMatchesWeekScope(item, 'current', now), true);
  assert.equal(workflowItemMatchesWeekScope(item, 'history', now, '2026-07-20'), true);
  assert.equal(workflowItemMatchesWeekScope(item, 'history', now, '2026-08-03'), false);
});
