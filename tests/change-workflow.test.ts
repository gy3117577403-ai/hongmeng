import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canTransitionChange,
  parseChangeInput,
  transitionChangeData,
} from '../lib/changes';
import { workflowTemplates } from '../lib/workflows';

const baseChange = {
  status: 'draft',
  reason: null,
  impactAreas: [] as string[],
  impactScope: null,
  implementationPlan: null,
  implementationResult: null,
  validationResult: null,
};

test('change input requires a meaningful title and validates enums', () => {
  const invalid = parseChangeInput({ title: 'A', type: 'unsupported', priority: 'critical' });
  assert.equal(invalid.errors.length, 3);

  const valid = parseChangeInput({
    title: '更新工艺图纸版本',
    type: 'drawing',
    priority: 'high',
    impactAreas: ['drawing', 'production'],
  });
  assert.deepEqual(valid.errors, []);
  assert.deepEqual(valid.data.impactAreas, ['drawing', 'production']);
});

test('change state machine only accepts declared transitions', () => {
  assert.equal(canTransitionChange('draft', 'assessing'), true);
  assert.equal(canTransitionChange('draft', 'implementing'), false);
  assert.equal(canTransitionChange('verifying', 'implementing'), true);
  assert.equal(canTransitionChange('closed', 'assessing'), true);
});

test('assessment transition requires reason, impact area and impact scope', () => {
  const invalid = transitionChangeData(baseChange, 'assessing', {});
  assert.match(invalid.error || '', /变更原因/);

  const valid = transitionChangeData(baseChange, 'assessing', {
    reason: '客户图纸版本更新',
    impactAreas: ['drawing', 'production'],
    impactScope: '影响当前工单及后续生产资料',
  });
  assert.equal(valid.error, null);
  assert.deepEqual(valid.data.impactAreas, ['drawing', 'production']);
});

test('implementation, verification and closure enforce their completion evidence', () => {
  const assessment = { ...baseChange, status: 'assessing', reason: '原因', impactAreas: ['drawing'], impactScope: '范围' };
  assert.match(transitionChangeData(assessment, 'implementing', {}).error || '', /实施方案/);
  assert.equal(transitionChangeData(assessment, 'implementing', { implementationPlan: '按版本窗口切换' }).error, null);

  const implementing = { ...assessment, status: 'implementing', implementationPlan: '按版本窗口切换' };
  assert.match(transitionChangeData(implementing, 'verifying', {}).error || '', /实施结果/);
  assert.equal(transitionChangeData(implementing, 'verifying', { implementationResult: '已完成替换' }).error, null);

  const verifying = { ...implementing, status: 'verifying', implementationResult: '已完成替换' };
  assert.match(transitionChangeData(verifying, 'closed', {}).error || '', /验证结果/);
  assert.equal(transitionChangeData(verifying, 'closed', { validationResult: '抽检通过' }).error, null);
});

test('workflow center exposes only real source modules', () => {
  assert.deepEqual(workflowTemplates.map(item => item.key), ['issue', 'change', 'production']);
  assert.deepEqual(workflowTemplates.map(item => item.route), ['/workspace/issues', '/workspace/changes', '/weekly-plan-center']);
});
