import assert from 'node:assert/strict';
import test from 'node:test';
import { completedProductionDeliveryRisk, productionDispatchLifecycle } from '../lib/production-dispatch-status';

test('completion on the customer delivery date remains on time, independent of the current date', () => {
  assert.equal(completedProductionDeliveryRisk({ completedAt: '2026-09-03T10:00:00+08:00', customerDeliveryDate: '2026-09-03' }).label, '按期完成');
  assert.equal(completedProductionDeliveryRisk({ completedAt: '2026-09-01T10:00:00+08:00', customerDeliveryDate: '2026-09-03' }).label, '按期完成');
});

test('late completion compares Beijing calendar dates across a UTC midnight boundary', () => {
  const risk = completedProductionDeliveryRisk({ completedAt: '2026-09-03T16:05:00Z', customerDeliveryDate: '2026-09-03' });
  assert.equal(risk.label, '延期 1 天完成');
  assert.equal(risk.tone, 'warning');
  assert.match(risk.detail, /完成 2026-09-04/);
});

test('missing or invalid historical completion timestamps do not invent an on-time result', () => {
  for (const completedAt of [null, '', 'invalid', '2026-02-31']) {
    assert.equal(completedProductionDeliveryRisk({ completedAt, customerDeliveryDate: '2026-09-03' }).label, '已完成（完成时间待核实）');
  }
  assert.equal(completedProductionDeliveryRisk({ completedAt: '2026-09-03', customerDeliveryDate: null }).label, '已完成（客户交期待补）');
});

test('completed and superseded continuation facts do not await the source order closure', () => {
  for (const continuationStatus of ['COMPLETED', 'SUPERSEDED']) {
    assert.deepEqual(productionDispatchLifecycle({ continuationStatus, routeCompleted: false, workOrderCompletedAt: null }), {
      routeLocked: true, aggregateCompleted: true, awaitingBranchClosure: false,
    });
  }
});

test('an active continuation does not inherit the source order completed timestamp', () => {
  assert.deepEqual(productionDispatchLifecycle({ continuationStatus: 'IN_PROGRESS', routeCompleted: true, workOrderCompletedAt: '2026-09-03T10:00:00Z' }), {
    routeLocked: false, aggregateCompleted: false, awaitingBranchClosure: false,
  });
});

test('ordinary orders retain the existing route versus branch-closure distinction', () => {
  assert.deepEqual(productionDispatchLifecycle({ routeCompleted: true, workOrderCompletedAt: null }), {
    routeLocked: true, aggregateCompleted: false, awaitingBranchClosure: true,
  });
});
