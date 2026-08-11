import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isProcessRouteChangeManaged,
  PROCESS_ROUTE_CHANGE_MANAGED_TRANSITION_ERROR,
  processRouteChangeManagedTransitionBlock,
  processRouteChangeWorkflowHref,
} from '../lib/change-process-route-link';

test('linked process route changes are managed outside the generic transition state machine', () => {
  assert.equal(isProcessRouteChangeManaged({ processRouteChange: null }), false);
  assert.equal(isProcessRouteChangeManaged({ processRouteChange: { id: 'route-change-1' } }), true);
  assert.match(PROCESS_ROUTE_CHANGE_MANAGED_TRANSITION_ERROR, /流程中心审核并启用/);
  assert.deepEqual(processRouteChangeManagedTransitionBlock({ processRouteChange: { id: 'route-change-1' } }), {
    status: 409,
    body: {
      ok: false,
      error: PROCESS_ROUTE_CHANGE_MANAGED_TRANSITION_ERROR,
      code: 'PROCESS_ROUTE_CHANGE_MANAGED',
    },
  });
  assert.equal(processRouteChangeManagedTransitionBlock({ processRouteChange: null }), null);
});

test('the generic change view builds a stable deep link to the exact process review', () => {
  assert.equal(
    processRouteChangeWorkflowHref('route/change 1', 'work/order 2'),
    '/workspace/workflows?processRouteChangeId=route%2Fchange+1&workOrderId=work%2Forder+2',
  );
});
