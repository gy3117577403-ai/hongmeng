import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveProductionLifecycle } from '../lib/production-lifecycle';

test('completed route remains locked while the aggregate work order waits for branches', () => {
  assert.deepEqual(resolveProductionLifecycle({
    routeCompleted: true,
    workOrderCompletedAt: null,
  }), {
    routeLocked: true,
    aggregateCompleted: false,
    awaitingBranchClosure: true,
  });
});

test('only the aggregate work-order completion timestamp closes production', () => {
  assert.deepEqual(resolveProductionLifecycle({
    routeCompleted: true,
    workOrderCompletedAt: new Date('2026-07-23T08:00:00.000Z'),
  }), {
    routeLocked: true,
    aggregateCompleted: true,
    awaitingBranchClosure: false,
  });
});
