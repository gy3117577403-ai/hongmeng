import assert from 'node:assert/strict';
import test from 'node:test';
import {
  productionRouteFallback,
  resolveWorkflowRouteState,
  workflowItemMatchesWeekScope,
  workflowWeekNavigationFromBatches,
  workflowWeekRanges,
} from '../lib/workflows';
import type { WorkflowItemDTO, WorkflowStepDTO, WorkflowWeekScope } from '../types';

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

test('workflow week scopes match the planning center four-week model', () => {
  const now = new Date('2026-07-28T04:00:00.000Z');
  const ranges = workflowWeekRanges(now);
  const scopeStarts: Record<WorkflowWeekScope, string> = {
    history: '2026-07-20',
    current: '2026-07-27',
    next: '2026-08-03',
    afterNext: '2026-08-10',
  };

  for (const scope of Object.keys(scopeStarts) as WorkflowWeekScope[]) {
    assert.equal(ranges[scope].start.toISOString().slice(0, 10), scopeStarts[scope]);
  }
});

test('history scope defaults to previous week and supports an exact selected historical week', () => {
  const now = new Date('2026-07-28T04:00:00.000Z');
  const item = (weekStartDate: string, weekEndDate: string) => ({
    entityType: 'production',
    weekStartDate,
    weekEndDate,
  }) as Pick<WorkflowItemDTO, 'entityType' | 'weekStartDate' | 'weekEndDate'>;

  assert.equal(workflowItemMatchesWeekScope(
    item('2026-07-20T04:00:00.000Z', '2026-07-26T04:00:00.000Z'),
    'history',
    now,
  ), true);
  assert.equal(workflowItemMatchesWeekScope(
    item('2026-07-13T04:00:00.000Z', '2026-07-19T04:00:00.000Z'),
    'history',
    now,
  ), false);
  assert.equal(workflowItemMatchesWeekScope(
    item('2026-07-13T04:00:00.000Z', '2026-07-19T04:00:00.000Z'),
    'history',
    now,
    '2026-07-13',
  ), true);
  assert.equal(workflowItemMatchesWeekScope(
    item('2026-08-10T04:00:00.000Z', '2026-08-16T04:00:00.000Z'),
    'afterNext',
    now,
  ), true);
  assert.equal(workflowItemMatchesWeekScope(
    {
      entityType: 'issue',
      weekStartDate: '2026-07-20T04:00:00.000Z',
      weekEndDate: '2026-07-26T04:00:00.000Z',
    },
    'history',
    now,
  ), false);
});

test('workflow history navigation is derived from canonical planning batches', () => {
  const now = new Date('2026-07-28T04:00:00.000Z');
  const navigation = workflowWeekNavigationFromBatches([
    { weekStartDate: new Date('2026-07-19T16:00:00.000Z'), weekEndDate: new Date('2026-07-25T16:00:00.000Z') },
    { weekStartDate: new Date('2026-07-19T16:00:00.000Z'), weekEndDate: new Date('2026-07-25T16:00:00.000Z') },
    { weekStartDate: new Date('2026-07-26T16:00:00.000Z'), weekEndDate: new Date('2026-08-01T16:00:00.000Z') },
    { weekStartDate: new Date('2026-08-02T16:00:00.000Z'), weekEndDate: new Date('2026-08-08T16:00:00.000Z') },
  ], now);

  assert.equal(navigation.history[0]?.weekStartDate, '2026-07-20');
  assert.equal(navigation.history[0]?.count, 2);
  assert.equal(navigation.current.count, 1);
  assert.equal(navigation.next.count, 1);
});
