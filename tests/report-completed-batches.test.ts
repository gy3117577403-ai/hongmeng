import assert from 'node:assert/strict';
import test from 'node:test';
import {
  deriveCompletedBatchState,
  summarizeCompletedBatches,
} from '@/lib/report-completed-batches';
import type { ReportCompletedBatchRowDTO } from '@/types';

const due = new Date('2026-08-20T00:00:00+08:00');
const cutoff = new Date('2026-08-24T12:00:00+08:00');

test('batch completion uses the earliest final-step threshold and caps quantity', () => {
  const state = deriveCompletedBatchState({
    quantity: 100,
    plannedCompletionDate: due,
    cutoffAt: cutoff,
    releaseState: 'active',
    workOrderId: 'wo-1',
    hasFinalRouteStep: true,
    started: true,
    completions: [
      { completedAt: new Date('2026-08-19T10:00:00+08:00'), goodQty: 60 },
      { completedAt: new Date('2026-08-20T18:00:00+08:00'), goodQty: 50 },
      { completedAt: new Date('2026-08-21T09:00:00+08:00'), goodQty: 20 },
    ],
  });
  assert.equal(state.completedQuantity, 100);
  assert.equal(state.actualCompletionAt?.toISOString(), new Date('2026-08-20T18:00:00+08:00').toISOString());
  assert.equal(state.status, 'completed_on_time');
  assert.equal(state.overdue, false);
});

test('late, overdue, unreleased, and route-missing states remain distinguishable', () => {
  const common = { quantity: 10, plannedCompletionDate: due, cutoffAt: cutoff, completions: [] };
  assert.equal(deriveCompletedBatchState({ ...common, releaseState: 'active', workOrderId: 'wo', hasFinalRouteStep: true, started: true }).status, 'overdue');
  const unreleased = deriveCompletedBatchState({ ...common, releaseState: 'draft', workOrderId: null, hasFinalRouteStep: false, started: false });
  assert.equal(unreleased.status, 'unreleased');
  assert.equal(unreleased.overdue, true);
  const missing = deriveCompletedBatchState({ ...common, releaseState: 'active', workOrderId: 'wo', hasFinalRouteStep: false, started: false });
  assert.equal(missing.status, 'route_missing');
  assert.equal(missing.overdue, true);
  const late = deriveCompletedBatchState({
    ...common,
    releaseState: 'active',
    workOrderId: 'wo',
    hasFinalRouteStep: true,
    started: true,
    completions: [{ completedAt: new Date('2026-08-21T08:00:00+08:00'), goodQty: 10 }],
  });
  assert.equal(late.status, 'completed_late');
});

test('summary uses all filtered rows instead of the paginated slice', () => {
  const base: ReportCompletedBatchRowDTO = {
    id: 'a', sourceOrderNo: 'SO', sourceLineNo: 1, batchNo: 1, batchLabel: 'SO-1-1',
    workOrderId: 'wo', workOrderCode: 'WO', customerName: '客户', productName: '产品',
    specification: '规格', quantity: 100, completedQuantity: 100, quantityBasisPoints: 10_000,
    plannedCompletionDate: due.toISOString(), actualCompletionAt: due.toISOString(),
    status: 'completed_on_time', statusLabel: '按期完成', overdue: false,
    currentProcess: null, owner: null, releaseState: 'active',
  };
  const rows = [
    base,
    { ...base, id: 'b', batchNo: 2, status: 'completed_late' as const, statusLabel: '延期完成', overdue: false },
    { ...base, id: 'c', batchNo: 3, status: 'unreleased' as const, statusLabel: '未下发', completedQuantity: 0, quantityBasisPoints: 0, actualCompletionAt: null, overdue: true },
  ];
  const summary = summarizeCompletedBatches(rows);
  assert.equal(summary.dueBatches, 3);
  assert.equal(summary.completedBatches, 2);
  assert.equal(summary.onTimeCompletedBatches, 1);
  assert.equal(summary.overdueBatches, 1);
  assert.equal(summary.onTimeAttainmentBasisPoints, 3333);
  assert.equal(summary.batchCompletionBasisPoints, 6667);
  assert.equal(summary.quantityAttainmentBasisPoints, 6667);
});
