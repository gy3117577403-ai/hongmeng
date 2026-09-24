import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isTrackedWarehouseException,
  materialFollowUpRisk,
  prepareMaterialFollowUpTransition,
  type MaterialFollowUpTransitionState,
} from '../lib/material-follow-up';

function state(status: MaterialFollowUpTransitionState['status'] = 'PENDING'): MaterialFollowUpTransitionState {
  return { status, ownerId: null, expectedAt: null };
}

test('every warehouse material exception enters the synchronized follow-up queue', () => {
  assert.equal(isTrackedWarehouseException('shortage'), true);
  assert.equal(isTrackedWarehouseException('insufficient_quantity'), true);
  assert.equal(isTrackedWarehouseException('wrong_material'), true);
  assert.equal(isTrackedWarehouseException('quality_issue'), true);
  assert.equal(isTrackedWarehouseException('other'), true);
  assert.equal(isTrackedWarehouseException(null), false);
});

test('claim assigns the current actor and starts follow-up', () => {
  const now = new Date('2026-07-25T02:00:00.000Z');
  const result = prepareMaterialFollowUpTransition(state(), { action: 'claim' }, 'user-1', now);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.next.ownerId, 'user-1');
  assert.equal(result.next.status, 'IN_PROGRESS');
  assert.equal(result.next.lastFollowedAt, now);
});

test('waiting for material requires an expected date and a traceable note', () => {
  const current = { ...state('IN_PROGRESS'), ownerId: 'user-1' };
  const missingDate = prepareMaterialFollowUpTransition(current, {
    action: 'update', status: 'WAITING_ARRIVAL', ownerId: 'user-1', note: '已经联系相关人员',
  }, 'user-1', new Date('2026-07-25T02:00:00.000Z'));
  assert.equal(missingDate.ok, false);

  const missingNote = prepareMaterialFollowUpTransition(current, {
    action: 'update', status: 'IN_PROGRESS', ownerId: 'user-1',
  }, 'user-1', new Date('2026-07-25T02:00:00.000Z'));
  assert.equal(missingNote.ok, false);
});

test('progress update keeps only feedback fields and no purchase document fields', () => {
  const result = prepareMaterialFollowUpTransition({ ...state('IN_PROGRESS'), ownerId: 'user-2' }, {
    action: 'update',
    status: 'WAITING_ARRIVAL',
    ownerId: 'user-2',
    expectedAt: '2026-07-28',
    note: '物料正在调拨，预计周二到仓',
  }, 'user-1', new Date('2026-07-25T02:00:00.000Z'));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.next.ownerId, 'user-2');
  assert.equal(result.next.status, 'WAITING_ARRIVAL');
  assert.equal(result.next.latestProgress, '物料正在调拨，预计周二到仓');
  assert.equal('purchaseOrderNo' in result.next, false);
  assert.equal('supplier' in result.next, false);
});

test('assignment waits for the named colleague and retains the existing ETA', () => {
  const now = new Date('2026-09-25T01:00:00Z');
  const expectedAt = new Date('2026-09-30T04:00:00Z');
  const result = prepareMaterialFollowUpTransition({ ...state('WAITING_ARRIVAL'), ownerId: 'old-owner', expectedAt }, { action: 'assign', ownerId: 'new-owner', note: '交接采购进展' }, 'manager', now);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.next.status, 'PENDING');
  assert.equal(result.next.ownerId, 'new-owner');
  assert.equal(result.next.expectedAt, expectedAt);
  assert.equal(result.next.assignedAt, now);
  assert.equal(result.next.acceptedAt, null);
  assert.match(result.content, /交接采购进展/);
});

test('only the assigned colleague can accept; acceptance needs no made-up ETA or note', () => {
  const current = { ...state(), ownerId: 'recipient' };
  const denied = prepareMaterialFollowUpTransition(current, { action: 'claim' }, 'manager');
  assert.equal(denied.ok, false);
  if (!denied.ok) assert.equal(denied.statusCode, 403);
  const accepted = prepareMaterialFollowUpTransition(current, { action: 'claim' }, 'recipient');
  assert.equal(accepted.ok, true);
  if (!accepted.ok) return;
  assert.equal(accepted.next.status, 'IN_PROGRESS');
  assert.ok(accepted.next.acceptedAt instanceof Date);
  assert.equal(accepted.next.expectedAt, null);
});

test('progress cannot substitute for acceptance or quietly change ownership', () => {
  for (const current of [state(), { ...state('IN_PROGRESS'), ownerId: 'existing-owner' }]) {
    const result = prepareMaterialFollowUpTransition(current, { action: 'update', status: 'IN_PROGRESS', ownerId: 'other-owner', note: '绕过分配' }, 'manager');
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.statusCode, 409);
  }
});

test('repeat acceptance, unchanged assignment and closed assignment do not reset progress', () => {
  assert.equal(prepareMaterialFollowUpTransition({ ...state('IN_PROGRESS'), ownerId: 'user' }, { action: 'claim' }, 'user').ok, false);
  assert.equal(prepareMaterialFollowUpTransition({ ...state(), ownerId: 'user' }, { action: 'assign', ownerId: 'user' }, 'manager').ok, false);
  for (const status of ['RESOLVED', 'CANCELLED', 'WAITING_WAREHOUSE'] as const) {
    assert.equal(prepareMaterialFollowUpTransition(state(status), { action: 'assign', ownerId: 'user' }, 'manager').ok, false);
  }
});

test('resolved feedback can only be reopened from a new warehouse exception', () => {
  const result = prepareMaterialFollowUpTransition(state('RESOLVED'), {
    action: 'update', status: 'IN_PROGRESS', ownerId: 'user-1', note: '继续处理',
  }, 'user-1');
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.statusCode, 409);
});

test('risk prioritizes overdue and unassigned tasks', () => {
  const now = new Date('2026-07-25T02:00:00.000Z');
  assert.equal(materialFollowUpRisk('WAITING_ARRIVAL', 'user-1', new Date('2026-07-24T04:00:00.000Z'), now).risk, 'overdue');
  assert.equal(materialFollowUpRisk('WAITING_WAREHOUSE', 'user-1', new Date('2026-07-24T04:00:00.000Z'), now).risk, 'normal');
  assert.equal(materialFollowUpRisk('PENDING', null, null, now).risk, 'unassigned');
  assert.equal(materialFollowUpRisk('RESOLVED', null, null, now).risk, 'closed');
});
