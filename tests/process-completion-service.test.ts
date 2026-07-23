import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateCappedParallelGroupRelease,
  parseProcessCompletionCommand,
  planDefectBranchRoute,
  ProcessCompletionServiceError,
  resolveCompletedQuantityDelta,
} from '../lib/process-completion-service';

function command(overrides: Record<string, unknown> = {}) {
  return {
    routeId: 'route-001',
    stepId: 'step-002',
    processedQty: 80,
    defectQty: 5,
    defectDisposition: 'rework',
    workDate: '2026-07-23',
    workStartedAt: '2026-07-23T00:30:00.000Z',
    workEndedAt: '2026-07-23T02:30:00.000Z',
    employeeIds: ['employee-002', 'employee-001', 'employee-002'],
    team: ' 前端一组 ',
    workstation: ' 裁线 C-03 ',
    remark: ' 换线后复核 ',
    idempotencyKey: 'completion-request-001',
    expectedRouteVersion: 7,
    userId: 'user-001',
    actor: '测试账号',
    ...overrides,
  };
}

test('completion command normalizes the API disposition and preserves the session user', () => {
  const parsed = parseProcessCompletionCommand(command());
  assert.equal(parsed.routeId, 'route-001');
  assert.equal(parsed.stepId, 'step-002');
  assert.equal(parsed.processedQty, 80);
  assert.equal(parsed.defectQty, 5);
  assert.equal(parsed.defectDisposition, 'rework');
  assert.equal(parsed.databaseDefectDisposition, 'REWORK');
  assert.equal(parsed.workDateKey, '2026-07-23');
  assert.deepEqual(parsed.employeeIds, ['employee-002', 'employee-001']);
  assert.equal(parsed.workStartedAt?.toISOString(), '2026-07-23T00:30:00.000Z');
  assert.equal(parsed.workEndedAt?.toISOString(), '2026-07-23T02:30:00.000Z');
  assert.equal(parsed.team, '前端一组');
  assert.equal(parsed.workstation, '裁线 C-03');
  assert.equal(parsed.remark, '换线后复核');
  assert.equal(parsed.expectedRouteVersion, 7);
  assert.equal(parsed.userId, 'user-001');
});

test('completion command requires a disposition only when defects exist', () => {
  const clean = parseProcessCompletionCommand(command({
    defectQty: 0,
    defectDisposition: undefined,
  }));
  assert.equal(clean.defectDisposition, null);
  assert.equal(clean.databaseDefectDisposition, null);

  assert.throws(
    () => parseProcessCompletionCommand(command({
      defectQty: 1,
      defectDisposition: undefined,
    })),
    (error: unknown) => error instanceof ProcessCompletionServiceError
      && error.code === 'PROCESS_DEFECT_DISPOSITION_REQUIRED',
  );
});

test('quality-pending submissions stay disabled until a release decision flow exists', () => {
  assert.throws(
    () => parseProcessCompletionCommand(command({ defectDisposition: 'quality_pending' })),
    (error: unknown) => error instanceof ProcessCompletionServiceError
      && error.code === 'PROCESS_QUALITY_PENDING_NOT_AVAILABLE',
  );
});

test('completion command rejects impossible quantities, stale-shaped dates, and weak request ids', () => {
  assert.throws(
    () => parseProcessCompletionCommand(command({ processedQty: 10, defectQty: 11 })),
    (error: unknown) => error instanceof ProcessCompletionServiceError
      && error.code === 'DEFECT_QTY_EXCEEDS_PROCESSED',
  );
  assert.throws(
    () => parseProcessCompletionCommand(command({ workDate: '2026-02-30' })),
    (error: unknown) => error instanceof ProcessCompletionServiceError
      && error.code === 'PROCESS_COMPLETION_WORK_DATE_INVALID',
  );
  assert.throws(
    () => parseProcessCompletionCommand(command({ idempotencyKey: 'short' })),
    (error: unknown) => error instanceof ProcessCompletionServiceError
      && error.code === 'PROCESS_COMPLETION_IDEMPOTENCY_INVALID',
  );
});

test('external completion submissions require workers and a valid work interval', () => {
  assert.throws(
    () => parseProcessCompletionCommand(command({
      employeeIds: [],
      requireParticipants: true,
    })),
    (error: unknown) => error instanceof ProcessCompletionServiceError
      && error.code === 'PROCESS_COMPLETION_EMPLOYEE_REQUIRED',
  );
  assert.throws(
    () => parseProcessCompletionCommand(command({
      workStartedAt: '2026-07-23T03:00:00.000Z',
      workEndedAt: '2026-07-23T02:30:00.000Z',
      requireParticipants: true,
    })),
    (error: unknown) => error instanceof ProcessCompletionServiceError
      && error.code === 'PROCESS_COMPLETION_TIME_RANGE_INVALID',
  );
  assert.throws(
    () => parseProcessCompletionCommand(command({
      workStartedAt: '2026-07-20T00:00:00.000Z',
      workEndedAt: '2026-07-23T02:30:00.000Z',
      requireParticipants: true,
    })),
    (error: unknown) => error instanceof ProcessCompletionServiceError
      && error.code === 'PROCESS_COMPLETION_TIME_RANGE_TOO_LONG',
  );
});

const routeSteps = [
  { id: 'cut', position: 1, sequenceGroup: 1 },
  { id: 'press-a', position: 2, sequenceGroup: 2 },
  { id: 'press-b', position: 3, sequenceGroup: 2 },
  { id: 'inspect', position: 4, sequenceGroup: 3 },
  { id: 'pack', position: 5, sequenceGroup: 4 },
];

test('rework branches contain only the failing step before returning to the original route', () => {
  const rework = planDefectBranchRoute(routeSteps, 'press-b', 'rework');
  assert.deepEqual(rework.map(step => step.sourceStepId), ['press-b']);
  assert.deepEqual(rework.map(step => step.position), [1]);
  assert.deepEqual(rework.map(step => step.sequenceGroup), [1]);
});

test('quality-pending branches retain their downstream review context', () => {
  const qualityPending = planDefectBranchRoute(routeSteps, 'press-b', 'quality_pending');
  assert.deepEqual(
    qualityPending.map(step => [step.sourceStepId, step.sequenceGroup]),
    [
      ['press-b', 1],
      ['inspect', 2],
      ['pack', 3],
    ],
  );
});

test('scrap replenishment clones the full route and preserves parallel grouping', () => {
  const replenishment = planDefectBranchRoute(routeSteps, 'inspect', 'scrap_replenish');
  assert.deepEqual(
    replenishment.map(step => [step.sourceStepId, step.sequenceGroup]),
    [
      ['cut', 1],
      ['press-a', 2],
      ['press-b', 2],
      ['inspect', 3],
      ['pack', 4],
    ],
  );
});

test('completed quantity accepts the exact target and rejects every overrun', () => {
  assert.equal(resolveCompletedQuantityDelta({
    previousCompletedQty: 80,
    targetQty: 100,
    finishedGoodDelta: 20,
  }), 100);
  assert.throws(
    () => resolveCompletedQuantityDelta({
      previousCompletedQty: 80,
      targetQty: 100,
      finishedGoodDelta: 21,
    }),
    (error: unknown) => error instanceof ProcessCompletionServiceError
      && error.code === 'PROCESS_COMPLETED_QTY_EXCEEDS_TARGET',
  );
});

test('scrap reservations cap normal parallel release without allowing the cap to move backward', () => {
  assert.deepEqual(calculateCappedParallelGroupRelease({
    stepGoodOutputQuantities: [90, 80],
    alreadyReleasedQty: 0,
    directRouteCap: 70,
  }), {
    releasableGoodQty: 70,
    alreadyReleasedQty: 0,
    releaseDeltaQty: 70,
  });
  assert.deepEqual(calculateCappedParallelGroupRelease({
    stepGoodOutputQuantities: [90, 80],
    alreadyReleasedQty: 50,
    directRouteCap: 70,
  }), {
    releasableGoodQty: 70,
    alreadyReleasedQty: 50,
    releaseDeltaQty: 20,
  });
  assert.throws(
    () => calculateCappedParallelGroupRelease({
      stepGoodOutputQuantities: [100, 100],
      alreadyReleasedQty: 90,
      directRouteCap: 80,
    }),
    (error: unknown) => error instanceof ProcessCompletionServiceError
      && error.code === 'PROCESS_SCRAP_RESERVATION_BELOW_RELEASED',
  );
});
