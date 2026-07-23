import assert from 'node:assert/strict';
import test from 'node:test';
import { planningFlowStepStates, resolvePlanningFlow } from '../lib/planning-flow';
import type { PlanningFlowFacts } from '../lib/planning-flow';

function facts(overrides: Partial<PlanningFlowFacts> = {}): PlanningFlowFacts {
  return {
    releaseState: 'draft',
    drawingReady: true,
    timeReady: true,
    warehouseStatus: 'completed',
    processStatus: 'confirmed',
    ...overrides,
  };
}

test('planning flow prioritizes preparation blockers in business order', () => {
  assert.equal(resolvePlanningFlow(facts({ warehouseStatus: 'exception', drawingReady: false })).status, 'material_exception');
  assert.equal(resolvePlanningFlow(facts({ drawingReady: false, timeReady: false })).status, 'missing_drawing');
  assert.equal(resolvePlanningFlow(facts({ timeReady: false, warehouseStatus: 'pending' })).status, 'missing_time');
  assert.equal(resolvePlanningFlow(facts({ warehouseStatus: 'pending', processStatus: 'draft' })).status, 'pending_material');
  assert.equal(resolvePlanningFlow(facts({ processStatus: 'draft' })).status, 'pending_process');
});

test('planning flow distinguishes release, preparation, production, and completion', () => {
  assert.equal(resolvePlanningFlow(facts()).status, 'ready_release');
  assert.equal(resolvePlanningFlow(facts({ releaseState: 'preparation' })).status, 'next_preparation');
  assert.equal(resolvePlanningFlow(facts({ releaseState: 'active' })).status, 'current_execution');
  assert.equal(resolvePlanningFlow(facts({ releaseState: 'active', currentProcessName: '压接' })).label, '生产中 · 压接');
  const awaitingBranches = resolvePlanningFlow(facts({ releaseState: 'active', processStatus: 'completed' }));
  assert.equal(awaitingBranches.status, 'pending_archive');
  assert.equal(awaitingBranches.label, '主路线完成 · 待分支闭环');
  assert.equal(awaitingBranches.workflowStatus, 'processing');
  assert.equal(awaitingBranches.nextStep, '处理返工/补产分支');
  assert.notEqual(resolvePlanningFlow(facts({
    releaseState: 'archived',
    processStatus: 'completed',
    processCompletedAt: new Date(),
  })).status, 'completed');
  assert.equal(resolvePlanningFlow(facts({ releaseState: 'active', workOrderCompletedAt: new Date() })).status, 'completed');
});

test('planning flow stepper exposes one current node until completion', () => {
  const blocked = planningFlowStepStates(facts({ drawingReady: false }));
  assert.deepEqual(blocked.slice(0, 4), ['done', 'current', 'done', 'done']);
  assert.equal(blocked.filter(state => state === 'current').length, 1);

  const active = planningFlowStepStates(facts({ releaseState: 'active', currentProcessName: '组装' }));
  assert.equal(active[6], 'current');
  assert.equal(active[7], 'pending');

  const completed = planningFlowStepStates(facts({ releaseState: 'archived', workOrderCompletedAt: new Date() }));
  assert.equal(completed.every(state => state === 'done'), true);
});
