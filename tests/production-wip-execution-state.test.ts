import assert from 'node:assert/strict';
import test from 'node:test';
import { productionWipExecutionState } from '../lib/production-execution';
import type { WipContinuationProjection } from '../lib/wip-continuations';

const source = { stage: 'frontend', status: 'in_progress', productionPausedAt: null };
const continuation = (status: string, remaining = [40, 40]) => ({
  status,
  steps: remaining.map(remainingQty => ({ remainingQty })) as WipContinuationProjection['steps'],
});

test('unstarted continuation does not inherit the already-started source order state', () => {
  assert.deepEqual(productionWipExecutionState(source, continuation('ACTIVE')), {
    stage: 'not_issued', paused: false, withNextProcess: true,
  });
  assert.equal(productionWipExecutionState(source, continuation('IN_PROGRESS')).stage, 'frontend');
  assert.equal(productionWipExecutionState({ ...source, stage: 'backend' }, continuation('IN_PROGRESS')).stage, 'backend');
});

test('completed and superseded historical WIP facts remain complete while their source order is open or paused', () => {
  for (const status of ['COMPLETED', 'SUPERSEDED']) {
    assert.deepEqual(productionWipExecutionState({ ...source, productionPausedAt: new Date() }, continuation(status, [0])), {
      stage: 'completed', paused: false, withNextProcess: false,
    });
  }
});

test('paused continuation is not also counted as active production or as having an actionable next process', () => {
  assert.deepEqual(productionWipExecutionState({ ...source, productionPausedAt: new Date() }, continuation('IN_PROGRESS')), {
    stage: 'frontend', paused: true, withNextProcess: false,
  });
  assert.equal(productionWipExecutionState(source, continuation('IN_PROGRESS', [0, 40])).withNextProcess, false);
});
