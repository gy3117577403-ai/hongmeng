import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canSubmitProcessRouteChangeProposal,
  millisecondsFromSeconds,
  normalizeOptionalProcessRouteChangeNote,
  processRouteChangeDTO,
  processRouteChangeIdempotencyKey,
  processRouteChangeReviewNoteError,
  resolveProcessRouteChangeDefinitionBinding,
  processRouteStepChangeSnapshots,
  processRouteStepChangeLabel,
  secondsFromMilliseconds,
} from '../lib/process-route-change-contract';

test('field notes and review comments are optional for approval and rejection', () => {
  assert.equal(normalizeOptionalProcessRouteChangeNote('   '), null);
  assert.equal(normalizeOptionalProcessRouteChangeNote('  现场暂时没有补充  '), '现场暂时没有补充');
  assert.equal(processRouteChangeReviewNoteError('approve', ''), null);
  assert.equal(processRouteChangeReviewNoteError('reject', '  '), null);
  assert.equal(processRouteChangeReviewNoteError('reject', '工序定义重复'), null);
});

test('a valid mobile proposal remains submittable with no field note', () => {
  assert.equal(canSubmitProcessRouteChangeProposal({
    saving: false,
    employeeAvailable: true,
    affectedQty: 10,
    includesInsert: true,
    insertBeforeStepId: 'step-4',
    newProcessName: '剥皮',
    newStandardMillisecondsPerUnit: 12_000,
    includesTime: false,
    timeChangesValid: false,
    includesMove: false,
    moveStepId: '',
    moveIsNoop: false,
  }), true);
});

test('review definition binding auto-selects one exact match and requires a choice for duplicate names', () => {
  const unique = resolveProcessRouteChangeDefinitionBinding('剥皮', null, [
    { id: 'cut', code: 'CUT', name: '裁线' },
    { id: 'strip', code: 'STRIP', name: '剥皮' },
  ]);
  assert.equal(unique.selectedId, 'strip');
  assert.equal(unique.requiresExplicitSelection, false);
  assert.equal(unique.createsNewDefinition, false);

  const duplicates = resolveProcessRouteChangeDefinitionBinding('剥皮', null, [
    { id: 'strip-a', code: 'STRIP-A', name: '剥皮' },
    { id: 'strip-b', code: 'STRIP-B', name: '剥皮' },
  ]);
  assert.equal(duplicates.selectedId, '');
  assert.equal(duplicates.requiresExplicitSelection, true);
  assert.deepEqual(duplicates.exactMatches.map(item => item.id), ['strip-a', 'strip-b']);

  const explicit = resolveProcessRouteChangeDefinitionBinding('剥皮', 'strip-b', duplicates.exactMatches);
  assert.equal(explicit.selectedId, 'strip-b');
  assert.equal(explicit.requiresExplicitSelection, false);
});

test('review definition binding leaves a free new name empty so the service can create it', () => {
  const binding = resolveProcessRouteChangeDefinitionBinding('全新工序', null, [
    { id: 'strip', code: 'STRIP', name: '剥皮' },
  ]);
  assert.equal(binding.selectedId, '');
  assert.equal(binding.requiresExplicitSelection, false);
  assert.equal(binding.createsNewDefinition, true);
});

test('inserted process definition identity round-trips into the review DTO', () => {
  const dto = processRouteChangeDTO({
    id: 'change-insert',
    routeId: 'route-1',
    status: 'SUBMITTED',
    version: 1,
    baseRouteVersion: 3,
    createdAt: '2026-08-11T00:00:00.000Z',
    diffs: [{
      kind: 'INSERT_STEP',
      targetStepId: 'step-4',
      afterData: {
        processDefinitionId: 'definition-strip',
        processName: '剥皮',
        standardMillisecondsPerUnit: 12_000,
      },
    }],
  });
  assert.equal(dto.payload.newProcessDefinitionId, 'definition-strip');
});

test('MOVE_STEP persistence data round-trips into the field and review contract', () => {
  const dto = processRouteChangeDTO({
    id: 'change-move',
    routeId: 'route-1',
    status: 'SUBMITTED',
    version: 1,
    baseRouteVersion: 3,
    createdAt: '2026-08-11T00:00:00.000Z',
    routeSnapshot: {
      steps: [
        { id: 'step-pack', processName: '包装' },
        { id: 'step-test', processName: '测试' },
      ],
    },
    diffs: [{
      kind: 'MOVE_STEP',
      targetStepId: 'step-pack',
      beforeData: { processName: '包装' },
      afterData: { position: 2, beforeStepId: 'step-test', beforeProcessName: '测试' },
    }],
    impactSnapshot: {
      affectedQty: 10,
      moveAffectedStepCount: 2,
      moveAffectedSequenceGroups: [2, 3],
    },
  });
  assert.equal(dto.payload.changeType, 'MOVE_STEP');
  assert.equal(dto.payload.moveStepId, 'step-pack');
  assert.equal(dto.payload.moveBeforeStepId, 'step-test');
  assert.equal(dto.payload.movedProcessName, '包装');
  assert.equal(dto.payload.moveBeforeProcessName, '测试');
  assert.equal(dto.impact?.moveAffectedStepCount, 2);
  assert.deepEqual(dto.impact?.moveAffectedSequenceGroups, [2, 3]);
});

test('route change notices derive a visible NEW marker only for changed steps', () => {
  assert.equal(processRouteStepChangeLabel(null), null);
  assert.equal(processRouteStepChangeLabel({ tag: 'NONE', routeVersion: 9 }), null);

  for (const tag of ['ADDED', 'TIME_CHANGED', 'ADDED_AND_TIME_CHANGED'] as const) {
    const label = processRouteStepChangeLabel({ tag, routeVersion: 10 });
    assert.ok(label?.startsWith('NEW'), `${tag} should expose a NEW marker`);
  }
});

test('route change time inputs round-trip between seconds and integer milliseconds', () => {
  assert.equal(millisecondsFromSeconds('6.75'), 6_750);
  assert.equal(secondsFromMilliseconds(6_750), '6.8');
  assert.equal(secondsFromMilliseconds(6_000), '6');
  assert.equal(millisecondsFromSeconds(0), null);
  assert.equal(millisecondsFromSeconds(Number.POSITIVE_INFINITY), null);
});

test('route change mutation keys retain the operation-specific prefix', () => {
  const key = processRouteChangeIdempotencyKey('activate-route-change');
  assert.match(key, /^activate-route-change-.+/);
});

test('step NEW markers survive later unrelated active changes and retain the latest related time diff', () => {
  const snapshots = processRouteStepChangeSnapshots([
    { id: 'step-old-time', changeSource: 'EXISTING' },
    { id: 'step-added', changeSource: 'NEW' },
    { id: 'step-unrelated', changeSource: 'EXISTING' },
  ], [
    {
      id: 'change-older-related',
      activatedRouteVersion: 5,
      diffs: [{
        kind: 'UPDATE_TIME',
        targetStepId: 'step-old-time',
        beforeData: { standardMillisecondsPerUnit: 2_000 },
      }],
    },
    {
      id: 'future-only-change',
      activatedRouteVersion: null,
      diffs: [{
        kind: 'UPDATE_TIME',
        targetStepId: 'step-added',
        beforeData: { standardMillisecondsPerUnit: 99_000 },
      }],
    },
    {
      id: 'change-latest-related',
      activatedRouteVersion: 7,
      diffs: [{
        kind: 'UPDATE_TIME',
        targetStepId: 'step-old-time',
        beforeData: { standardMillisecondsPerUnit: 2_500 },
      }],
    },
    {
      id: 'change-latest-unrelated',
      activatedRouteVersion: 8,
      diffs: [{
        kind: 'UPDATE_TIME',
        targetStepId: 'step-unrelated',
        beforeData: { standardMillisecondsPerUnit: 7_000 },
      }],
    },
  ]);

  assert.deepEqual(snapshots.get('step-old-time'), {
    tag: 'TIME_CHANGED',
    changeVersion: 7,
    sourceChangeId: 'change-latest-related',
    previousStandardMillisecondsPerUnit: 2_500,
  });
  assert.deepEqual(snapshots.get('step-added'), {
    tag: 'ADDED',
    changeVersion: null,
    sourceChangeId: null,
    previousStandardMillisecondsPerUnit: null,
  });
  assert.equal(snapshots.get('step-unrelated')?.sourceChangeId, 'change-latest-unrelated');
});

test('an inserted step combines its durable ADDED marker with its latest applied time change', () => {
  const snapshots = processRouteStepChangeSnapshots(
    [{ id: 'step-added', changeSource: 'NEW' }],
    [{
      id: 'change-time',
      activatedRouteVersion: 11,
      diffs: [{
        kind: 'UPDATE_TIME',
        targetStepId: 'step-added',
        beforeData: { standardMillisecondsPerUnit: 4_000 },
      }],
    }],
  );

  assert.deepEqual(snapshots.get('step-added'), {
    tag: 'ADDED_AND_TIME_CHANGED',
    changeVersion: 11,
    sourceChangeId: 'change-time',
    previousStandardMillisecondsPerUnit: 4_000,
  });
});

test('product-time deployment insert exposes a durable NEW marker', () => {
  const snapshots = processRouteStepChangeSnapshots([{
    id: 'step-product-insert',
    changeSource: 'NEW',
    productTimeDeploymentRoute: {
      id: 'deployment-route-1',
      status: 'SUCCEEDED',
      routeVersionAfter: 12,
      result: {
        stepChanges: [{ stepId: 'step-product-insert', kind: 'insert' }],
      },
      deployment: { id: 'deployment-1', status: 'ACTIVE' },
    },
  }], []);

  assert.deepEqual(snapshots.get('step-product-insert'), {
    tag: 'ADDED',
    changeVersion: null,
    sourceChangeId: 'product-time-deployment:deployment-1',
    previousStandardMillisecondsPerUnit: null,
  });
});

test('product-time deployment time update exposes previous standard time', () => {
  const snapshots = processRouteStepChangeSnapshots([{
    id: 'step-product-time',
    changeSource: 'EXISTING',
    productTimeDeploymentRoute: {
      id: 'deployment-route-2',
      status: 'SUCCEEDED',
      routeVersionAfter: 13,
      result: {
        stepChanges: [{
          stepId: 'step-product-time',
          kind: 'update_time',
          previousStandardMillisecondsPerUnit: 2_000,
        }],
      },
      deployment: { id: 'deployment-2', status: 'ACTIVE' },
    },
  }], []);

  assert.deepEqual(snapshots.get('step-product-time'), {
    tag: 'TIME_CHANGED',
    changeVersion: 13,
    sourceChangeId: 'product-time-deployment:deployment-2',
    previousStandardMillisecondsPerUnit: 2_000,
  });
});

test('move plus time update uses the time diff and pure move does not claim a time change', () => {
  const route = {
    id: 'deployment-route-3',
    status: 'SUCCEEDED',
    routeVersionAfter: 14,
    result: {
      stepChanges: [
        { stepId: 'step-both', kind: 'move', previousStandardMillisecondsPerUnit: null },
        { stepId: 'step-both', kind: 'update_time', previousStandardMillisecondsPerUnit: 3_000 },
        { stepId: 'step-move-only', kind: 'move', previousStandardMillisecondsPerUnit: null },
      ],
    },
    deployment: { id: 'deployment-3', status: 'ACTIVE' },
  };
  const snapshots = processRouteStepChangeSnapshots([
    { id: 'step-both', changeSource: 'EXISTING', productTimeDeploymentRoute: route },
    { id: 'step-move-only', changeSource: 'EXISTING', productTimeDeploymentRoute: route },
  ], []);

  assert.equal(snapshots.get('step-both')?.tag, 'TIME_CHANGED');
  assert.equal(snapshots.get('step-both')?.previousStandardMillisecondsPerUnit, 3_000);
  assert.equal(snapshots.get('step-move-only')?.tag, 'NONE');
});
