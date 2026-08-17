import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeProductTimeInsertPolicies,
  processSupplementActualRequiredQty,
  processSupplementRemainingQty,
  projectProductTimeCoverage,
} from '../lib/process-supplement-coverage';

test('completed historical routes are system-covered without reopening or labor targets', () => {
  const projection = projectProductTimeCoverage({
    routeTargetQty: 24,
    routeHasFacts: true,
    routeCompleted: true,
    hasNextExistingStep: true,
    downstreamHasFacts: true,
    boundaryProgressQty: 24,
    policy: 'AUTO_BY_PROGRESS',
  });

  assert.deepEqual(projection, {
    execution: 'supplement',
    policy: 'AUTO_BY_PROGRESS',
    fulfillmentMode: 'SYSTEM_COVERED',
    routeTargetQty: 24,
    obligationRequiredQty: 24,
    systemCoveredQty: 24,
    actualRequiredQty: 0,
    obligationStatus: 'FULFILLED',
    shouldReopenCompletedRoute: false,
    excludedFromExistingRoute: false,
  });
});

test('in-progress routes split at the real boundary and report only unfinished quantity', () => {
  const projection = projectProductTimeCoverage({
    routeTargetQty: 24,
    routeHasFacts: true,
    routeCompleted: false,
    hasNextExistingStep: true,
    downstreamHasFacts: true,
    boundaryProgressQty: 15,
    policy: 'AUTO_BY_PROGRESS',
  });

  assert.equal(projection.fulfillmentMode, 'MIXED');
  assert.equal(projection.systemCoveredQty, 15);
  assert.equal(projection.actualRequiredQty, 9);
  assert.equal(projection.obligationStatus, 'ACTIVE');
  assert.equal(projection.shouldReopenCompletedRoute, false);
  assert.equal(processSupplementActualRequiredQty({
    requiredQty: 24,
    systemCoveredQty: 15,
    fulfillmentMode: 'MIXED',
  }), 9);
  assert.equal(processSupplementRemainingQty({
    requiredQty: 24,
    systemCoveredQty: 15,
    reportedQty: 4,
    fulfillmentMode: 'MIXED',
  }), 5);
});

test('unstarted routes receive the full new process as a normal route step', () => {
  const projection = projectProductTimeCoverage({
    routeTargetQty: 24,
    routeHasFacts: false,
    routeCompleted: false,
    hasNextExistingStep: true,
    downstreamHasFacts: false,
    boundaryProgressQty: 0,
    policy: 'AUTO_BY_PROGRESS',
  });

  assert.equal(projection.execution, 'normal');
  assert.equal(projection.actualRequiredQty, 24);
  assert.equal(projection.systemCoveredQty, 0);
});

test('critical-process policies explicitly distinguish future-only from recall rework', () => {
  const futureOnly = projectProductTimeCoverage({
    routeTargetQty: 24,
    routeHasFacts: true,
    routeCompleted: true,
    hasNextExistingStep: true,
    downstreamHasFacts: true,
    boundaryProgressQty: 24,
    policy: 'FUTURE_ONLY',
  });
  const recall = projectProductTimeCoverage({
    routeTargetQty: 24,
    routeHasFacts: true,
    routeCompleted: true,
    hasNextExistingStep: true,
    downstreamHasFacts: true,
    boundaryProgressQty: 24,
    policy: 'RECALL_REWORK',
  });

  assert.equal(futureOnly.fulfillmentMode, 'FUTURE_ONLY');
  assert.equal(futureOnly.actualRequiredQty, 0);
  assert.equal(futureOnly.shouldReopenCompletedRoute, false);
  assert.equal(processSupplementActualRequiredQty({
    requiredQty: futureOnly.obligationRequiredQty,
    systemCoveredQty: futureOnly.systemCoveredQty,
    fulfillmentMode: futureOnly.fulfillmentMode,
  }), 0);
  assert.equal(recall.fulfillmentMode, 'RECALL_REQUIRED');
  assert.equal(recall.actualRequiredQty, 24);
  assert.equal(recall.shouldReopenCompletedRoute, true);
});

test('policy input accepts only supported values and stable occurrence keys', () => {
  assert.deepEqual(normalizeProductTimeInsertPolicies({
    criticalA: 'future_only',
    criticalB: 'RECALL_REWORK',
    ignored: 'ADMIN_COMPLETE',
  }), {
    criticalA: 'FUTURE_ONLY',
    criticalB: 'RECALL_REWORK',
  });
});
