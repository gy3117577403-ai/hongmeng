import assert from 'node:assert/strict';
import test from 'node:test';
import { ProcessMovementType } from '@prisma/client';
import {
  planQuantityMovementReversals,
  ProcessCompletionWithdrawalError,
} from '../lib/process-completion-withdrawal-service';

function movement(input: {
  id: string;
  quantity: number;
  createdAt: string;
  targetStepId?: string | null;
  reversedQty?: number;
}) {
  return {
    id: input.id,
    completionId: `completion-${input.id}`,
    workOrderId: 'order-1',
    sourceStepId: 'step-cut',
    targetStepId: input.targetStepId === undefined ? 'step-crimp' : input.targetStepId,
    branchWorkOrderId: null,
    type: input.targetStepId === null
      ? ProcessMovementType.FINISHED_GOOD
      : ProcessMovementType.GOOD_TRANSFER,
    quantity: input.quantity,
    sourceSequenceGroup: 1,
    targetSequenceGroup: input.targetStepId === null ? null : 2,
    createdAt: new Date(input.createdAt),
    reversals: input.reversedQty ? [{ quantity: input.reversedQty }] : [],
  };
}

test('withdrawal reverses the newest effective movements and supports partial reversal', () => {
  const plans = planQuantityMovementReversals({
    movements: [
      movement({ id: 'old', quantity: 30, createdAt: '2026-08-03T01:00:00Z' }),
      movement({ id: 'new', quantity: 50, reversedQty: 10, createdAt: '2026-08-03T02:00:00Z' }),
    ],
    targetStepId: 'step-crimp',
    requiredQty: 55,
  });
  assert.deepEqual(plans.map(plan => [plan.original.id, plan.quantity]), [
    ['new', 40],
    ['old', 15],
  ]);
});

test('withdrawal refuses to invent quantity when the movement ledger is insufficient', () => {
  assert.throws(
    () => planQuantityMovementReversals({
      movements: [movement({ id: 'only', quantity: 20, createdAt: '2026-08-03T01:00:00Z' })],
      targetStepId: 'step-crimp',
      requiredQty: 21,
    }),
    (error: unknown) => error instanceof ProcessCompletionWithdrawalError
      && error.code === 'PROCESS_COMPLETION_MOVEMENT_LEDGER_INSUFFICIENT',
  );
});

test('finished-good reversal is isolated from downstream transfer channels', () => {
  const plans = planQuantityMovementReversals({
    movements: [
      movement({ id: 'transfer', quantity: 10, createdAt: '2026-08-03T01:00:00Z' }),
      movement({ id: 'finished', quantity: 10, targetStepId: null, createdAt: '2026-08-03T02:00:00Z' }),
    ],
    targetStepId: null,
    requiredQty: 10,
  });
  assert.deepEqual(plans.map(plan => plan.original.id), ['finished']);
});
