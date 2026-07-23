import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveWorkflowRouteState } from '../lib/workflows';
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
