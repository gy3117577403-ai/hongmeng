import assert from 'node:assert/strict';
import test from 'node:test';
import {
  changeQueueSection,
  changeScopeQuery,
  genericChangeProgress,
  processRouteChangeProgress,
} from '../lib/change-management-presenter';

test('change inbox scopes map to stable server filters', () => {
  assert.deepEqual(changeScopeQuery('mine', 'user-1'), { ownerId: 'user-1', openOnly: 'true' });
  assert.deepEqual(changeScopeQuery('all', 'user-1'), {});
  assert.deepEqual(changeScopeQuery('closed', 'user-1'), { status: 'closed' });
});

test('generic change progress exposes one current step until closed', () => {
  assert.deepEqual(genericChangeProgress('implementing').map(item => item.state), ['done', 'done', 'current', 'pending']);
  assert.ok(genericChangeProgress('closed').every(item => item.state === 'done'));
});

test('process route progress leaves employee reporting current after activation', () => {
  assert.deepEqual(processRouteChangeProgress('ACTIVE').map(item => item.state), ['done', 'done', 'done', 'current']);
  assert.equal(processRouteChangeProgress('SUBMITTED')[1].state, 'current');
});

test('closed changes are grouped separately from active work', () => {
  assert.equal(changeQueueSection('closed'), 'closed');
  assert.equal(changeQueueSection('verifying'), 'active');
});
