import assert from 'node:assert/strict';
import test from 'node:test';
import { serializeMaterialExecutionControl } from '../lib/material-execution-control';

function batch(input: { status: string; taskVersion: number; allowed: boolean; authorizedVersion: number | null; releaseState?: string }) {
  return {
    id: 'batch-1',
    planOrderId: 'plan-1',
    releaseState: input.releaseState || 'active',
    workOrderId: 'work-order-1',
    deletedAt: null,
    materialExecutionAllowed: input.allowed,
    materialExecutionTaskVersion: input.authorizedVersion,
    materialExecutionDecisionAt: new Date('2026-08-31T00:00:00.000Z'),
    materialExecutionReason: '计划确认先行生产',
    materialExecutionDecisionBy: { id: 'user-1', displayName: '计划员' },
    workOrder: { completedAt: null, materialTask: { id: 'task-1', status: input.status, version: input.taskVersion } },
  } as Parameters<typeof serializeMaterialExecutionControl>[0];
}

test('material states and historical decisions are warning-only compatibility data', () => {
  const pending = serializeMaterialExecutionControl(batch({
    status: 'pending', taskVersion: 3, allowed: true, authorizedVersion: 3,
  }));
  assert.equal(pending.required, false);
  assert.equal(pending.effectiveAllowed, true);
  assert.equal(pending.stale, false);
  assert.equal(pending.storedAllowed, true);

  const changed = serializeMaterialExecutionControl(batch({
    status: 'exception', taskVersion: 4, allowed: true, authorizedVersion: 3,
  }));
  assert.equal(changed.effectiveAllowed, true);
  assert.equal(changed.stale, false);

  const carryover = serializeMaterialExecutionControl(batch({
    status: 'pending', taskVersion: 4, allowed: false, authorizedVersion: null, releaseState: 'archived',
  }));
  assert.equal(carryover.required, false, 'carryovers are never gated by material state');
  assert.equal(carryover.effectiveAllowed, true);

  const completed = serializeMaterialExecutionControl(batch({
    status: 'completed', taskVersion: 5, allowed: false, authorizedVersion: null,
  }));
  assert.equal(completed.required, false);
  assert.equal(completed.effectiveAllowed, true);
});
