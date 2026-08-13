import assert from 'node:assert/strict';
import test from 'node:test';
import {
  deriveProcessRouteChangeDiffSource,
  normalizeProcessRouteChangeDiffs,
  planProcessRouteGroupMove,
  parseProcessSupplementCompletionTiming,
  PROCESS_SUPPLEMENT_RELEASE_POLICY,
  previewProcessRouteTimeChangeImpact,
  processSupplementCompletionReleasePlan,
  processSupplementObligationState,
  ProcessRouteChangeServiceError,
} from '../lib/process-route-change-service';

test('supplement completion timing matches normal-report date and duration constraints', () => {
  const parsed = parseProcessSupplementCompletionTiming({
    workDate: '2026-08-11',
    workStartedAt: '2026-08-11T01:00:00.000Z',
    workEndedAt: '2026-08-11T03:00:00.000Z',
  });
  assert.equal(parsed.workDate.toISOString(), '2026-08-11T00:00:00.000Z');
  assert.equal(parsed.workStartedAt?.toISOString(), '2026-08-11T01:00:00.000Z');
  assert.equal(parsed.workEndedAt?.toISOString(), '2026-08-11T03:00:00.000Z');

  const cases: Array<[Parameters<typeof parseProcessSupplementCompletionTiming>[0], string]> = [
    [{ workDate: '2026-02-30' }, 'PROCESS_SUPPLEMENT_WORK_DATE_INVALID'],
    [{ workDate: '2026-08-11', workStartedAt: '2026-08-11T01:00:00.000Z' }, 'PROCESS_SUPPLEMENT_TIME_RANGE_REQUIRED'],
    [{
      workDate: '2026-08-11',
      workStartedAt: '2026-08-11T03:00:00.000Z',
      workEndedAt: '2026-08-11T01:00:00.000Z',
    }, 'PROCESS_SUPPLEMENT_TIME_RANGE_INVALID'],
    [{
      workDate: '2026-08-11',
      workStartedAt: '2026-08-08T00:00:00.000Z',
      workEndedAt: '2026-08-11T00:00:00.001Z',
    }, 'PROCESS_SUPPLEMENT_TIME_RANGE_TOO_LONG'],
  ];
  for (const [input, code] of cases) {
    assert.throws(
      () => parseProcessSupplementCompletionTiming(input),
      (error: unknown) => error instanceof ProcessRouteChangeServiceError
        && error.status === 400
        && error.code === code,
    );
  }
});

test('route move planner relocates complete parallel groups without splitting accounting boundaries', () => {
  const plan = planProcessRouteGroupMove({
    steps: [
      { id: 'cut', position: 1, sequenceGroup: 1, executionMode: 'NORMAL' },
      { id: 'press-a', position: 2, sequenceGroup: 2, executionMode: 'NORMAL' },
      { id: 'press-b', position: 3, sequenceGroup: 2, executionMode: 'NORMAL' },
      { id: 'inspect', position: 4, sequenceGroup: 3, executionMode: 'NORMAL' },
      { id: 'pack', position: 5, sequenceGroup: 4, executionMode: 'NORMAL' },
    ],
    stepId: 'pack',
    beforeStepId: 'press-a',
  });

  assert.deepEqual(plan.orderedSteps.map(step => [step.id, step.position, step.sequenceGroup]), [
    ['cut', 1, 1],
    ['pack', 2, 2],
    ['press-a', 3, 3],
    ['press-b', 4, 3],
    ['inspect', 5, 4],
  ]);
  assert.deepEqual(plan.affectedSequenceGroups, [2, 3, 4]);
  assert.deepEqual(new Set(plan.affectedStepIds), new Set(['pack', 'press-a', 'press-b', 'inspect']));
});

test('route move planner rejects no-op, same-group anchors, and supplemental display routes', () => {
  const steps = [
    { id: 'a', position: 1, sequenceGroup: 1, executionMode: 'NORMAL' },
    { id: 'b-1', position: 2, sequenceGroup: 2, executionMode: 'NORMAL' },
    { id: 'b-2', position: 3, sequenceGroup: 2, executionMode: 'NORMAL' },
    { id: 'c', position: 4, sequenceGroup: 3, executionMode: 'NORMAL' },
  ];
  assert.throws(
    () => planProcessRouteGroupMove({ steps, stepId: 'a', beforeStepId: 'b-1' }),
    (error: unknown) => error instanceof ProcessRouteChangeServiceError
      && error.code === 'PROCESS_ROUTE_CHANGE_MOVE_NOOP',
  );
  assert.throws(
    () => planProcessRouteGroupMove({ steps, stepId: 'b-1', beforeStepId: 'b-2' }),
    (error: unknown) => error instanceof ProcessRouteChangeServiceError
      && error.code === 'PROCESS_ROUTE_CHANGE_MOVE_SAME_GROUP',
  );
  assert.throws(
    () => planProcessRouteGroupMove({
      steps: [...steps, { id: 'supplement', position: 5, sequenceGroup: 4, executionMode: 'SUPPLEMENTAL_OBLIGATION' }],
      stepId: 'c',
      beforeStepId: 'a',
    }),
    (error: unknown) => error instanceof ProcessRouteChangeServiceError
      && error.code === 'PROCESS_ROUTE_CHANGE_MOVE_SUPPLEMENT_CONFLICT',
  );
});

test('route change diff normalization derives NEW only for inserted steps', () => {
  const [inserted, timeChanged, moved] = normalizeProcessRouteChangeDiffs([
    {
      kind: 'INSERT_STEP',
      processDefinitionId: ' process-new ',
      targetStepId: ' step-four ',
      afterData: {
        processCode: ' NEW-04 ',
        processName: ' supplemental operation ',
        stageGroup: ' backend ',
        standardMillisecondsPerUnit: 6_750,
        timeBasis: 'per_unit',
        unitLabel: 'set',
        unitsPerProduct: 96,
        reportQuantityBasis: 'action',
        reportUnitLabel: 'terminal',
        requiredQty: 80,
      },
    },
    {
      kind: 'UPDATE_TIME',
      targetStepId: 'step-two',
      afterData: { standardMillisecondsPerUnit: 8_000 },
    },
    {
      kind: 'MOVE_STEP',
      targetStepId: 'step-three',
      afterData: { position: 4, sequenceGroup: 4 },
    },
  ]);

  assert.equal(deriveProcessRouteChangeDiffSource('INSERT_STEP'), 'NEW');
  assert.equal(deriveProcessRouteChangeDiffSource('UPDATE_TIME'), 'EXISTING');
  assert.equal(deriveProcessRouteChangeDiffSource('MOVE_STEP'), 'EXISTING');
  assert.deepEqual(
    [inserted.source, timeChanged.source, moved.source],
    ['NEW', 'EXISTING', 'EXISTING'],
  );
  assert.equal(inserted.position, 0);
  assert.equal(inserted.processDefinitionId, 'process-new');
  assert.equal(inserted.targetStepId, 'step-four');
  assert.equal(inserted.afterData.standardMillisecondsPerUnit, 6_750);
  assert.equal(inserted.afterData.unitsPerProduct, 96);
  assert.equal(inserted.afterData.reportQuantityBasis, 'action');
  assert.equal(inserted.afterData.reportUnitLabel, 'terminal');
  assert.equal('requiredQty' in inserted.afterData ? inserted.afterData.requiredQty : null, 80);
});

test('supplement obligation state exposes exact quantity progress without release semantics', () => {
  assert.deepEqual(processSupplementObligationState({ requiredQty: 100, reportedQty: 0 }), {
    requiredQty: 100,
    reportedQty: 0,
    remainingQty: 100,
    status: 'ACTIVE',
    releasePolicy: 'NONE',
  });
  assert.deepEqual(processSupplementObligationState({ requiredQty: 100, reportedQty: 40 }), {
    requiredQty: 100,
    reportedQty: 40,
    remainingQty: 60,
    status: 'ACTIVE',
    releasePolicy: 'NONE',
  });
  assert.deepEqual(processSupplementObligationState({ requiredQty: 100, reportedQty: 100 }), {
    requiredQty: 100,
    reportedQty: 100,
    remainingQty: 0,
    status: 'FULFILLED',
    releasePolicy: 'NONE',
  });

  assert.throws(
    () => processSupplementObligationState({ requiredQty: 100, reportedQty: 101 }),
    (error: unknown) => error instanceof ProcessRouteChangeServiceError
      && error.code === 'PROCESS_SUPPLEMENT_REPORTED_QTY_EXCEEDED',
  );
});

test('supplement completions are explicitly forbidden from changing quantity flow or finished goods', () => {
  assert.equal(PROCESS_SUPPLEMENT_RELEASE_POLICY, 'NONE');
  assert.deepEqual(processSupplementCompletionReleasePlan(), {
    releasePolicy: 'NONE',
    createQuantityMovement: false,
    completedQtyDelta: 0,
    releasedGoodQtyDelta: 0,
  });
});

test('time change impact preview exposes exact batch labor and affected historical records', () => {
  assert.deepEqual(previewProcessRouteTimeChangeImpact({
    previousStandardMillisecondsPerUnit: 2_000,
    nextStandardMillisecondsPerUnit: 3_000,
    affectedQty: 40,
    affectedCompletionCount: 3,
    affectedClaimCount: 5,
    affectedEmployeeCount: 4,
  }), {
    previousStandardMillisecondsPerUnit: 2_000,
    nextStandardMillisecondsPerUnit: 3_000,
    affectedQty: 40,
    previousStandardLaborMilliseconds: 80_000,
    nextStandardLaborMilliseconds: 120_000,
    deltaStandardLaborMilliseconds: 40_000,
    affectedCompletionCount: 3,
    affectedClaimCount: 5,
    affectedEmployeeCount: 4,
  });

  const decrease = previewProcessRouteTimeChangeImpact({
    previousStandardMillisecondsPerUnit: 5_000,
    nextStandardMillisecondsPerUnit: 3_000,
    affectedQty: 10,
  });
  assert.equal(decrease.deltaStandardLaborMilliseconds, -20_000);
  assert.equal(decrease.affectedCompletionCount, 0);
  assert.equal(decrease.affectedClaimCount, 0);
  assert.equal(decrease.affectedEmployeeCount, 0);
});

test('route change diff normalization rejects ambiguous or impossible commands', () => {
  assert.throws(
    () => normalizeProcessRouteChangeDiffs([]),
    (error: unknown) => error instanceof ProcessRouteChangeServiceError
      && error.code === 'PROCESS_ROUTE_CHANGE_DIFFS_INVALID',
  );
  assert.throws(
    () => normalizeProcessRouteChangeDiffs([{
      kind: 'INSERT_STEP',
      processDefinitionId: '',
      afterData: { standardMillisecondsPerUnit: 1_000 },
    }]),
    (error: unknown) => error instanceof ProcessRouteChangeServiceError
      && error.code === 'PROCESS_ROUTE_CHANGE_DIFF_INVALID',
  );
  assert.throws(
    () => normalizeProcessRouteChangeDiffs([{
      kind: 'INSERT_STEP',
      processDefinitionId: 'action-step',
      afterData: {
        standardMillisecondsPerUnit: 9_000,
        timeBasis: 'per_unit',
        unitsPerProduct: 1,
        reportQuantityBasis: 'action',
        reportUnitLabel: 'terminal',
      },
    }]),
    (error: unknown) => error instanceof ProcessRouteChangeServiceError
      && error.code === 'PROCESS_ROUTE_CHANGE_DIFF_INVALID',
  );
});
