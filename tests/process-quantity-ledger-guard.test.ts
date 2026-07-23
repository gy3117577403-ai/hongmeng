import assert from 'node:assert/strict';
import test from 'node:test';
import {
  genericWorkOrderPatchBlockReason,
  processQuantityLedgerIsLocked,
  type ProcessQuantityLedgerRouteState,
} from '../lib/process-quantity-ledger-guard';

function routeState(
  overrides: Partial<ProcessQuantityLedgerRouteState> = {},
): ProcessQuantityLedgerRouteState {
  return {
    id: 'route-1',
    status: 'draft',
    startedAt: null,
    steps: [{
      inputQty: 0,
      processedQty: 0,
      goodOutputQty: 0,
      defectOutputQty: 0,
      releasedGoodQty: 0,
    }],
    _count: { completions: 0 },
    ...overrides,
  };
}

test('quantity adjustment remains available before a draft route initializes its ledger', () => {
  assert.equal(processQuantityLedgerIsLocked(null), false);
  assert.equal(processQuantityLedgerIsLocked(routeState()), false);
  assert.equal(processQuantityLedgerIsLocked(routeState({ status: 'confirmed' })), false);
});

test('generic work-order patch never owns plan lifecycle and cannot rewrite routed product identity', () => {
  assert.match(
    genericWorkOrderPatchBlockReason({ planActive: true }, false) || '',
    /专用流程/,
  );
  assert.match(
    genericWorkOrderPatchBlockReason({ weekStartDate: '2026-07-20' }, false) || '',
    /专用流程/,
  );
  assert.match(
    genericWorkOrderPatchBlockReason({ productName: 'B 产品' }, true) || '',
    /产品身份/,
  );
  assert.match(
    genericWorkOrderPatchBlockReason({ specification: 'B-100' }, true) || '',
    /产品身份/,
  );
  assert.match(
    genericWorkOrderPatchBlockReason({ progress: 50 }, true) || '',
    /生产数量账本/,
  );
  assert.equal(genericWorkOrderPatchBlockReason({ remark: 'safe edit' }, true), null);
  assert.equal(genericWorkOrderPatchBlockReason({ productName: 'B 产品' }, false), null);
});

test('started, migrated, and completed routes lock direct quantity changes', () => {
  assert.equal(processQuantityLedgerIsLocked(routeState({ status: 'in_progress' })), true);
  assert.equal(processQuantityLedgerIsLocked(routeState({ startedAt: new Date() })), true);
  assert.equal(processQuantityLedgerIsLocked(routeState({
    steps: [{
      inputQty: 100,
      processedQty: 100,
      goodOutputQty: 95,
      defectOutputQty: 5,
      releasedGoodQty: 95,
    }],
  })), true);
  assert.equal(processQuantityLedgerIsLocked(routeState({
    _count: { completions: 1 },
  })), true);
});
