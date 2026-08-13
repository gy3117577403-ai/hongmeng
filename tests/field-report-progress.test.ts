import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveFieldReportStepPresentation } from '../lib/field-report-progress';

test('advance reporting shows reported-full immediately while preserving pending coverage', () => {
  const state = resolveFieldReportStepPresentation({
    status: 'current',
    reportedQty: 50,
    coveredReportedQty: 0,
    pendingCoverageQty: 50,
    targetQty: 50,
  });
  assert.deepEqual(state, {
    label: '已报满 · 待覆盖',
    tone: 'coverage',
    reportingComplete: true,
    reportingPercent: 100,
    coveragePercent: 0,
  });
});

test('partial upstream coverage does not reopen a fully reported step', () => {
  const state = resolveFieldReportStepPresentation({
    status: 'current',
    reportedQty: 50,
    coveredReportedQty: 20,
    pendingCoverageQty: 30,
    targetQty: 50,
  });
  assert.equal(state.label, '已报满 · 待覆盖');
  assert.equal(state.reportingPercent, 100);
  assert.equal(state.coveragePercent, 40);
});

test('fully covered reporting remains the real process completion state', () => {
  const state = resolveFieldReportStepPresentation({
    status: 'completed',
    reportedQty: 50,
    coveredReportedQty: 50,
    pendingCoverageQty: 0,
    targetQty: 50,
  });
  assert.equal(state.label, '已报完成');
  assert.equal(state.tone, 'completed');
});

test('a zero target is not presented as completed without an explicit completed state', () => {
  const state = resolveFieldReportStepPresentation({
    status: 'pending',
    reportedQty: 0,
    coveredReportedQty: 0,
    pendingCoverageQty: 0,
    targetQty: 0,
  });
  assert.equal(state.label, '可选择报工');
  assert.equal(state.tone, 'ready');
  assert.equal(state.reportingComplete, false);
});
