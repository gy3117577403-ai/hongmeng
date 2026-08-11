import assert from 'node:assert/strict';
import test from 'node:test';
import {
  countProductTimeDeploymentDiffs,
  failedProductTimeDeploymentRoutes,
  productTimeDeploymentProgress,
  productTimeDeploymentRouteStateText,
  productTimeDeploymentRouteStatusText,
} from '@/lib/product-time-deployment-presenter';
import type { ProductTimeDeploymentRouteDTO } from '@/types';

const route = (status: ProductTimeDeploymentRouteDTO['status']): ProductTimeDeploymentRouteDTO => ({
  workOrderId: `id-${status}`,
  workOrderCode: `WO-${status}`,
  state: 'in_progress',
  status,
  qrUpdated: status === 'succeeded',
});

test('product time deployment diff counts keep every change class visible', () => {
  const counts = countProductTimeDeploymentDiffs([
    { kind: 'insert', occurrenceKey: 'insert', processName: '剥皮' },
    { kind: 'move', occurrenceKey: 'move', processName: '压接' },
    { kind: 'update_time', occurrenceKey: 'time-a', processName: '合压' },
    { kind: 'update_time', occurrenceKey: 'time-b', processName: '裁线' },
    { kind: 'delete', occurrenceKey: 'delete', processName: '检验' },
  ]);
  assert.deepEqual(counts, { insert: 1, move: 1, updateTime: 2, delete: 1 });
});

test('deployment progress includes terminal failures without reporting them as success', () => {
  const routes = [route('succeeded'), route('failed'), route('blocked'), route('applying')];
  assert.deepEqual(productTimeDeploymentProgress({ routes }), { completed: 3, total: 4, percent: 75 });
  assert.deepEqual(failedProductTimeDeploymentRoutes({ routes }).map(item => item.status), ['failed', 'blocked']);
});

test('route labels distinguish production state from synchronization result', () => {
  assert.equal(productTimeDeploymentRouteStateText('unstarted'), '未报工');
  assert.equal(productTimeDeploymentRouteStateText('in_progress'), '在制');
  assert.equal(productTimeDeploymentRouteStateText('completed'), '已完成');
  assert.equal(productTimeDeploymentRouteStatusText('succeeded'), '已同步');
  assert.equal(productTimeDeploymentRouteStatusText('blocked'), '冲突阻断');
});
