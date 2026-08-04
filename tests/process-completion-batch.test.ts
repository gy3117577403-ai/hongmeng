import assert from 'node:assert/strict';
import test from 'node:test';
import {
  completeProcessStepsBatch,
  ProcessCompletionServiceError,
  type CompleteProcessStepsBatchCommand,
} from '../lib/process-completion-service';

const baseCommand: Omit<CompleteProcessStepsBatchCommand, 'items'> = {
  routeId: 'route-for-validation',
  workDate: '2026-08-04',
  employeeIds: [],
  requireParticipants: false,
  allowAdvanceReporting: true,
  autoAssignLabor: true,
  idempotencyKey: 'qr-batch-validation-key',
  expectedRouteVersion: 1,
  userId: 'user-for-validation',
  actor: 'validation test',
};

test('batch completion requires at least two processes', async () => {
  await assert.rejects(
    completeProcessStepsBatch({
      ...baseCommand,
      items: [{ stepId: 'step-1', processedQty: 10, defectQty: 0 }],
    }),
    (error: unknown) => error instanceof ProcessCompletionServiceError
      && error.code === 'PROCESS_COMPLETION_BATCH_ITEMS_REQUIRED',
  );
});

test('batch completion rejects the same process twice before any data is written', async () => {
  await assert.rejects(
    completeProcessStepsBatch({
      ...baseCommand,
      items: [
        { stepId: 'step-1', processedQty: 10, defectQty: 0 },
        { stepId: 'step-1', processedQty: 10, defectQty: 0 },
      ],
    }),
    (error: unknown) => error instanceof ProcessCompletionServiceError
      && error.code === 'PROCESS_COMPLETION_BATCH_STEP_DUPLICATE',
  );
});

test('batch completion caps a single mobile submission at twenty processes', async () => {
  await assert.rejects(
    completeProcessStepsBatch({
      ...baseCommand,
      items: Array.from({ length: 21 }, (_, index) => ({
        stepId: `step-${index + 1}`,
        processedQty: 10,
        defectQty: 0,
      })),
    }),
    (error: unknown) => error instanceof ProcessCompletionServiceError
      && error.code === 'PROCESS_COMPLETION_BATCH_ITEMS_LIMIT',
  );
});
