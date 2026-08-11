import assert from 'node:assert/strict';
import test from 'node:test';
import {
  millisecondsFromSeconds,
  processRouteChangeDTO,
  processRouteChangeIdempotencyKey,
  processRouteStepChangeSnapshots,
  processRouteStepChangeLabel,
  secondsFromMilliseconds,
} from '../lib/process-route-change-contract';

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
