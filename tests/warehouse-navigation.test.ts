import assert from 'node:assert/strict';
import test from 'node:test';
import {
  warehouseWorkbenchPath,
  warehouseWorkbenchStateFromSearch,
} from '../lib/warehouse-navigation';

test('warehouse opens the pending queue by default and an explicit task in all statuses', () => {
  assert.equal(warehouseWorkbenchStateFromSearch('').status, 'pending');
  assert.equal(warehouseWorkbenchStateFromSearch('?taskId=task-1').status, 'all');
  assert.equal(warehouseWorkbenchStateFromSearch('?taskId=task-1&status=exception').status, 'exception');
});

test('returning from material follow-up restores warehouse task and active filters', () => {
  const current = {
    taskId: 'task-1', scope: 'history' as const, week: '2026-09-14', status: 'exception' as const,
    source: 'CUSTOMER' as const, overdue: true, query: '壳体 A', page: 3,
  };
  const path = warehouseWorkbenchPath(current);
  assert.match(path, /^\/workspace\/warehouse\?/);
  assert.deepEqual(warehouseWorkbenchStateFromSearch(new URL(path, 'http://localhost').search), current);
});
