import assert from 'node:assert/strict';
import test from 'node:test';
import { productionRouteFallback, resolveWorkflowRouteState } from '../lib/workflows';
import type { WorkflowStepDTO } from '../types';

const completedSteps: WorkflowStepDTO[] = [{
  key: 'cutting',
  label: '裁线',
  state: 'done',
  sequenceGroup: 1,
  status: 'completed',
}];

test('workflow route completion waits for branch closure until the work order completes', () => {
  const state = resolveWorkflowRouteState({
    status: 'completed',
    startedAt: new Date('2026-07-23T08:00:00.000Z'),
  }, completedSteps, null);

  assert.deepEqual(state, {
    processStatus: 'processing',
    currentStep: '主路线完成 · 待分支闭环',
    nextStep: '处理返工/补产分支',
    closed: false,
  });
});

test('workflow closes only after the aggregate work order completes', () => {
  const state = resolveWorkflowRouteState({
    status: 'completed',
    startedAt: new Date('2026-07-23T08:00:00.000Z'),
  }, completedSteps, new Date('2026-07-23T09:00:00.000Z'));

  assert.deepEqual(state, {
    processStatus: 'closed',
    currentStep: '全部工序完成',
    nextStep: null,
    closed: true,
  });
});

test('production without a published route never falls back to legacy front or back stages', () => {
  const pending = productionRouteFallback({ completed: false, started: false });
  const historical = productionRouteFallback({ completed: false, started: true });
  const completed = productionRouteFallback({ completed: true, started: true });
  const labels = [...pending.steps, ...historical.steps, ...completed.steps].map(step => step.label);

  assert.deepEqual(pending, {
    currentStep: '工艺路线待配置',
    nextStep: '维护产品工序',
    steps: [{ key: 'route-configuration-required', label: '工艺路线待配置', state: 'current' }],
  });
  assert.equal(historical.currentStep, '历史工艺待补齐');
  assert.equal(completed.currentStep, '生产已完成');
  assert.equal(labels.some(label => ['未发图', '在前端', '在后端'].includes(label)), false);
});
