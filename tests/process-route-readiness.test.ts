import assert from 'node:assert/strict';
import test from 'node:test';
import { processRouteExecutionReadiness } from '../lib/process-route-readiness';

const validStep = {
  processName: '裁线',
  status: 'pending',
  timeBasis: 'per_unit',
  unitLabel: '套',
  standardMillisecondsPerUnit: 3_000,
  setupMilliseconds: 0,
  unitsPerProduct: 1,
};

test('published process steps with complete standard time are executable', () => {
  assert.deepEqual(processRouteExecutionReadiness([validStep]), {
    ready: true,
    missingStepNames: [],
  });
});

test('missing standard time blocks execution and identifies the affected process', () => {
  assert.deepEqual(processRouteExecutionReadiness([
    validStep,
    { ...validStep, processName: '压接', standardMillisecondsPerUnit: 0 },
  ]), {
    ready: false,
    missingStepNames: ['压接'],
  });
});

test('skipped steps do not block execution while an empty route does', () => {
  assert.equal(processRouteExecutionReadiness([
    validStep,
    { ...validStep, processName: '检验', status: 'skipped', standardMillisecondsPerUnit: null },
  ]).ready, true);
  assert.equal(processRouteExecutionReadiness([]).ready, false);
});
