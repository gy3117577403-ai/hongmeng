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

test('only shortage feedback enters the material follow-up queue', () => {
  assert.equal(isTrackedWarehouseException('shortage'), true);
  assert.equal(isTrackedWarehouseException('insufficient_quantity'), true);
  assert.equal(isTrackedWarehouseException('wrong_material'), false);
  assert.equal(isTrackedWarehouseException('quality_issue'), false);
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
  const result = prepareMaterialFollowUpTransition(state('IN_PROGRESS'), {
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
  assert.equal(materialFollowUpRisk('PENDING', null, null, now).risk, 'unassigned');
  assert.equal(materialFollowUpRisk('RESOLVED', null, null, now).risk, 'closed');
});
