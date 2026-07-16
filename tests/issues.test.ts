import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canTransitionIssue,
  issueCode,
  issueFingerprint,
  parseIssueInput,
  priorityForAlert,
  transitionIssueData,
  typeForAlert,
} from '../lib/issues';

test('manual issue input uses safe defaults and validates title', () => {
  const valid = parseIssueInput({ title: '图纸尺寸与现场实物不一致' });
  assert.deepEqual(valid.errors, []);
  assert.equal(valid.data.type, 'production');
  assert.equal(valid.data.priority, 'normal');
  const invalid = parseIssueInput({ title: 'a', type: 'invalid', priority: 'unknown' });
  assert.equal(invalid.errors.length, 3);
});

test('issue codes and production fingerprints are stable', () => {
  assert.equal(issueCode(7), 'ISS-000007');
  assert.equal(issueFingerprint('work-order-1', 'MATERIAL_NOT_READY'), 'production_alert:work-order-1:MATERIAL_NOT_READY');
});

test('status transitions follow the accepted processing loop', () => {
  assert.equal(canTransitionIssue('pending', 'processing'), true);
  assert.equal(canTransitionIssue('processing', 'verifying'), true);
  assert.equal(canTransitionIssue('verifying', 'closed'), true);
  assert.equal(canTransitionIssue('verifying', 'processing'), true);
  assert.equal(canTransitionIssue('closed', 'processing'), true);
  assert.equal(canTransitionIssue('pending', 'closed'), false);
});

test('submitting for verification requires a solution', () => {
  const missing = transitionIssueData({ status: 'processing', solution: null, verificationResult: null }, 'verifying', {});
  assert.equal(missing.error, '提交验证前请填写处理方案');
  const valid = transitionIssueData({ status: 'processing', solution: null, verificationResult: null }, 'verifying', { solution: '更换端子并复核首件' }, new Date('2026-07-16T00:00:00.000Z'));
  assert.equal(valid.error, null);
  assert.equal(valid.data.status, 'verifying');
  assert.equal(valid.data.solution, '更换端子并复核首件');
});

test('closing requires verification and reopening clears closure timestamps', () => {
  const missing = transitionIssueData({ status: 'verifying', solution: '已处理', verificationResult: null }, 'closed', {});
  assert.equal(missing.error, '关闭问题前请填写验证结果');
  const closed = transitionIssueData({ status: 'verifying', solution: '已处理', verificationResult: null }, 'closed', { verificationResult: '抽检通过' });
  assert.equal(closed.error, null);
  assert.equal(closed.data.status, 'closed');
  const reopened = transitionIssueData({ status: 'closed', solution: '已处理', verificationResult: '抽检通过' }, 'processing', {});
  assert.equal(reopened.error, null);
  assert.equal(reopened.data.closedAt, null);
  assert.equal(reopened.data.verifiedAt, null);
});

test('production alert mapping preserves urgency and ownership domain', () => {
  assert.equal(priorityForAlert({ code: 'OVERDUE', label: '逾期2天', tone: 'red' }), 'urgent');
  assert.equal(priorityForAlert({ code: 'MATERIAL_NOT_READY', label: '配料未齐', tone: 'orange' }), 'high');
  assert.equal(typeForAlert('MATERIAL_NOT_READY'), 'material');
  assert.equal(typeForAlert('DRAWING_CHANGE_REQUIRED'), 'technical');
  assert.equal(typeForAlert('REWORK'), 'quality');
});
