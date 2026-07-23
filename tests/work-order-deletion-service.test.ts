import assert from 'node:assert/strict';
import test from 'node:test';
import { workOrderDeletionLockReason } from '../lib/work-order-deletion-service';

const emptyState = {
  isBranch: false,
  hasActiveDescendants: false,
  routeStatus: null,
  completionCount: 0,
  movementCount: 0,
  laborPoolCount: 0,
};

test('ordinary unused work order remains deletable', () => {
  assert.equal(workOrderDeletionLockReason(emptyState), null);
});

test('branch work orders cannot bypass branch closure through ordinary delete', () => {
  assert.match(
    workOrderDeletionLockReason({ ...emptyState, isBranch: true }) || '',
    /分支工单/,
  );
});

test('active descendants and production ledgers lock ordinary deletion', () => {
  assert.match(
    workOrderDeletionLockReason({ ...emptyState, hasActiveDescendants: true }) || '',
    /未闭环分支/,
  );
  assert.match(
    workOrderDeletionLockReason({ ...emptyState, routeStatus: 'in_progress' }) || '',
    /工艺路线/,
  );
  assert.match(
    workOrderDeletionLockReason({ ...emptyState, completionCount: 1 }) || '',
    /生产数量或工时账本/,
  );
  assert.match(
    workOrderDeletionLockReason({ ...emptyState, movementCount: 1 }) || '',
    /生产数量或工时账本/,
  );
  assert.match(
    workOrderDeletionLockReason({ ...emptyState, laborPoolCount: 1 }) || '',
    /生产数量或工时账本/,
  );
});
