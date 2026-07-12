import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveLocalImportHelperBinding, type LocalImportPairingState } from '../lib/local-import-pairing-state';

const now = new Date('2026-07-13T04:00:00.000Z');
const helperA = 'helper-instance-aaaaaaaaaaaaaaaa';
const helperB = 'helper-instance-bbbbbbbbbbbbbbbb';

function waitingTask(overrides: Partial<LocalImportPairingState> = {}): LocalImportPairingState {
  return {
    expiresAt: '2026-07-13T04:10:00.000Z',
    state: 'waiting',
    ...overrides,
  };
}

test('首次配对在一个状态转换中绑定助手、连接任务并消费任务码', () => {
  const result = resolveLocalImportHelperBinding(waitingTask(), helperA, now);

  assert.equal(result.outcome, 'connected');
  if (!('detail' in result)) return;
  assert.equal(result.detail.state, 'connected');
  assert.equal(result.detail.helperInstanceId, helperA);
  assert.equal(result.detail.helperConnectedAt, now.toISOString());
  assert.equal(result.detail.pairingUsedAt, now.toISOString());
});

test('同一助手重复配对幂等返回当前任务', () => {
  const first = resolveLocalImportHelperBinding(waitingTask(), helperA, now);
  assert.ok('detail' in first);
  if (!('detail' in first)) return;

  const retry = resolveLocalImportHelperBinding(first.detail, helperA, new Date(now.getTime() + 1_000));
  assert.equal(retry.outcome, 'already_connected');
  assert.ok('detail' in retry);
  if (!('detail' in retry)) return;
  assert.equal(retry.detail.pairingUsedAt, now.toISOString());
});

test('双击连接不会重复消费任务码', () => {
  const first = resolveLocalImportHelperBinding(waitingTask(), helperA, now);
  assert.ok('detail' in first);
  if (!('detail' in first)) return;
  const second = resolveLocalImportHelperBinding(first.detail, helperA, now);

  assert.equal(second.outcome, 'already_connected');
});

test('协议唤起和手动连接使用同一助手实例时第二条路径幂等成功', () => {
  const protocol = resolveLocalImportHelperBinding(waitingTask(), helperA, now);
  assert.ok('detail' in protocol);
  if (!('detail' in protocol)) return;
  const manual = resolveLocalImportHelperBinding(protocol.detail, helperA, new Date(now.getTime() + 10));

  assert.equal(manual.outcome, 'already_connected');
});

test('事务提交前网络失败不会修改原状态，任务码仍可重试', () => {
  const original = waitingTask();
  resolveLocalImportHelperBinding(original, helperA, now);
  assert.equal(original.state, 'waiting');
  assert.equal(original.pairingUsedAt, undefined);

  const retry = resolveLocalImportHelperBinding(original, helperA, new Date(now.getTime() + 1_000));
  assert.equal(retry.outcome, 'connected');
});

test('任务码被其他助手成功使用后拒绝当前助手', () => {
  const first = resolveLocalImportHelperBinding(waitingTask(), helperB, now);
  assert.ok('detail' in first);
  if (!('detail' in first)) return;

  const rejected = resolveLocalImportHelperBinding(first.detail, helperA, new Date(now.getTime() + 1_000));
  assert.equal(rejected.outcome, 'used_by_other_helper');
});

test('过期任务不能配对且不会消费任务码', () => {
  const expired = waitingTask({ expiresAt: '2026-07-13T03:59:59.000Z' });
  const result = resolveLocalImportHelperBinding(expired, helperA, now);

  assert.equal(result.outcome, 'expired');
  assert.equal(expired.pairingUsedAt, undefined);
});
