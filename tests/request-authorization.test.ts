import assert from 'node:assert/strict';
import test from 'node:test';
import { canUseRequestMethod } from '@/lib/request-authorization';

test('all active roles can use read requests', () => {
  for (const role of ['ADMIN', 'TEAM_LEAD', 'EMPLOYEE'] as const) {
    assert.equal(canUseRequestMethod(role, 'GET'), true);
    assert.equal(canUseRequestMethod(role, 'HEAD'), true);
    assert.equal(canUseRequestMethod(role, 'OPTIONS'), true);
  }
});

test('generic mutations are admin only', () => {
  assert.equal(canUseRequestMethod('ADMIN', 'PATCH'), true);
  assert.equal(canUseRequestMethod('TEAM_LEAD', 'PATCH'), false);
  assert.equal(canUseRequestMethod('EMPLOYEE', 'DELETE'), false);
});

test('production mutations allow supervisors but not employees', () => {
  assert.equal(canUseRequestMethod('ADMIN', 'POST', 'production'), true);
  assert.equal(canUseRequestMethod('TEAM_LEAD', 'POST', 'production'), true);
  assert.equal(canUseRequestMethod('EMPLOYEE', 'POST', 'production'), false);
});

test('labor and self-service mutations reach their scoped domain checks', () => {
  for (const role of ['ADMIN', 'TEAM_LEAD', 'EMPLOYEE'] as const) {
    assert.equal(canUseRequestMethod(role, 'POST', 'labor'), true);
    assert.equal(canUseRequestMethod(role, 'POST', 'self'), true);
  }
});
