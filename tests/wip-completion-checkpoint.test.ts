import assert from 'node:assert/strict';
import test from 'node:test';
import { wipEntryCheckpointClosesRoute } from '../lib/wip-completion-checkpoint';

test('removing the last pending WIP operation closes only a lot with complete entry evidence', () => {
  assert.equal(wipEntryCheckpointClosesRoute({ completedStepIds: ['cut', 'crimp'], liveStepIds: ['crimp', 'cut'] }), true);
  assert.equal(wipEntryCheckpointClosesRoute({ completedStepIds: ['cut'], liveStepIds: ['cut', 'inspect'] }), false);
  assert.equal(wipEntryCheckpointClosesRoute({ completedStepIds: [], liveStepIds: [] }), false);
  assert.equal(wipEntryCheckpointClosesRoute({ completedStepIds: null, liveStepIds: ['cut'] }), false);
});
