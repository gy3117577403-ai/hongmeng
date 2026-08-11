import assert from 'node:assert/strict';
import test from 'node:test';
import { processRouteChangeErrorResponse } from '../lib/process-route-change-api';
import { ProcessRouteChangeServiceError } from '../lib/process-route-change-service';

test('route change conflicts expose the authoritative status and version', async () => {
  const response = processRouteChangeErrorResponse(new ProcessRouteChangeServiceError(
    '当前状态不能执行approve',
    409,
    'PROCESS_ROUTE_CHANGE_STATUS_CONFLICT',
    {
      currentStatus: 'APPROVED',
      currentVersion: 2,
      expectedStatus: 'SUBMITTED',
      updatedAt: '2026-08-11T12:00:00.000Z',
    },
  ), '工艺审核失败');
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: '当前状态不能执行approve',
    code: 'PROCESS_ROUTE_CHANGE_STATUS_CONFLICT',
    currentStatus: 'APPROVED',
    currentVersion: 2,
    expectedStatus: 'SUBMITTED',
    updatedAt: '2026-08-11T12:00:00.000Z',
  });
});
