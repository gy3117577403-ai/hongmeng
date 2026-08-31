import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  executeBoundedQualityWarningProjection,
  executeProductionPlanningMaintenancePhases,
  nextAutomaticReleaseCursor,
  selectFairAutomaticReleaseCandidates,
} from '../lib/production-planning-maintenance';

const root = process.cwd();

function source(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('planning and production GET routes remain read-only and expose stable diagnostic codes', () => {
  const planning = source('app/api/planning/orders/route.ts');
  const execution = source('app/api/work-orders/execution/route.ts');
  const summary = source('app/api/dashboard/production-summary/route.ts');

  for (const [name, route] of [
    ['planning', planning],
    ['execution', execution],
    ['summary', summary],
  ] as const) {
    assert.doesNotMatch(route, /reconcileAutomaticallyReleasedProductionPlanBatches/,
      `${name} GET must not run automatic release writes`);
    assert.doesNotMatch(route, /reconcileFutureActiveProductionPlanWeeks/,
      `${name} GET must not run week repair writes`);
    assert.doesNotMatch(route, /reconcileProductionCarryovers/,
      `${name} GET must not run carryover writes`);
    assert.doesNotMatch(route, /maxWait:\s*10_000[\s\S]*timeout:\s*180_000/,
      `${name} GET must not contain the old long maintenance transaction`);
  }

  assert.match(planning, /PLANNING_ORDER_READ_FAILED/);
  assert.match(planning, /Promise\.allSettled/);
  assert.match(execution, /PRODUCTION_EXECUTION_READ_FAILED/);
  assert.match(summary, /PRODUCTION_SUMMARY_READ_FAILED/);

  const executionDomain = source('lib/production-execution.ts');
  assert.doesNotMatch(executionDomain, /materializeProductQualityWarning/,
    'loadProductionExecution and its domain module must remain pure reads');
});

test('maintenance phases isolate failures and continue later work', async () => {
  const calls: string[] = [];
  const previousConsoleError = console.error;
  console.error = () => undefined;
  try {
    const results = await executeProductionPlanningMaintenancePhases([
      {
        phase: 'future_week_alignment',
        execute: async () => {
          calls.push('first');
          throw Object.assign(new Error('transaction timed out'), { code: 'P2028' });
        },
      },
      {
        phase: 'current_week_carryover',
        execute: async () => {
          calls.push('second');
          return { status: 'completed', result: { createdCount: 2 } };
        },
      },
    ]);

    assert.deepEqual(calls, ['first', 'second']);
    assert.equal(results[0].status, 'failed');
    assert.equal(results[0].errorCode, 'P2028');
    assert.equal(results[1].status, 'completed');
  } finally {
    console.error = previousConsoleError;
  }
});

test('automatic release selection alternates week priority and cannot starve preparation batches', () => {
  const active = ['active-1', 'active-2', 'active-3'].map(id => ({
    id,
    weekStartDate: new Date('2026-08-30T16:00:00.000Z'),
    releaseState: 'draft',
    workOrderId: null,
  }));
  const preparation = ['next-1', 'next-2'].map(id => ({
    id,
    weekStartDate: new Date('2026-09-06T16:00:00.000Z'),
    releaseState: 'draft',
    workOrderId: null,
  }));

  const first = selectFairAutomaticReleaseCandidates({ active, preparation, limit: 1, prefer: 'active' });
  assert.deepEqual(first.candidates.map(item => item.id), ['active-1']);
  assert.equal(first.nextPrefer, 'preparation');
  const second = selectFairAutomaticReleaseCandidates({ active, preparation, limit: 1, prefer: first.nextPrefer });
  assert.deepEqual(second.candidates.map(item => item.id), ['next-1']);
  assert.equal(nextAutomaticReleaseCursor({
    current: 'active-before',
    scanned: active,
    eligible: active,
    selected: [],
  }), 'active-before', 'an eligible pool that lost this bounded turn is not skipped');
  assert.equal(nextAutomaticReleaseCursor({
    current: 'active-before',
    scanned: active,
    eligible: active,
    selected: first.candidates,
  }), 'active-1');
  const mixed = selectFairAutomaticReleaseCandidates({ active, preparation, limit: 4, prefer: 'active' });
  assert.deepEqual(mixed.candidates.map(item => item.id), ['active-1', 'next-1', 'active-2', 'next-2']);
});

test('quality-warning maintenance is bounded and isolates a bad projection pair', async () => {
  const calls: string[] = [];
  const previousConsoleError = console.error;
  console.error = () => undefined;
  try {
    const result = await executeBoundedQualityWarningProjection({
      limit: 2,
      candidates: [
        { reportId: 'report-1', workOrderId: 'order-1' },
        { reportId: 'report-2', workOrderId: 'order-2' },
        { reportId: 'report-3', workOrderId: 'order-3' },
      ],
      project: async candidate => {
        calls.push(`${candidate.reportId}:${candidate.workOrderId}`);
        if (candidate.reportId === 'report-1') throw new Error('retry later');
        return 'created';
      },
    });

    assert.deepEqual(calls, ['report-1:order-1', 'report-2:order-2']);
    assert.equal(result.status, 'partial');
    assert.equal(result.errorCode, 'QUALITY_WARNING_PROJECTION_PARTIAL');
    assert.deepEqual(result.failedItemIds, ['report-1:order-1']);
    assert.deepEqual(result.result, {
      candidateCount: 2,
      created: 1,
      existing: 0,
      ineligible: 0,
      skippedLocked: 0,
      failedCount: 1,
    });
  } finally {
    console.error = previousConsoleError;
  }
});

test('internal maintenance worker is token guarded, non-blocking, bounded and system attributed', () => {
  const route = source('app/api/internal/production-planning-maintenance/route.ts');
  const helper = source('lib/production-planning-maintenance.ts');
  const entrypoint = source('docker-entrypoint.sh');
  const planningDomain = source('lib/production-planning.ts');
  const routeService = source('lib/process-route-service.ts');

  assert.match(route, /timingSafeEqual/);
  assert.match(route, /expected\.length < 32/);
  assert.match(helper, /pg_try_advisory_xact_lock/);
  assert.match(helper, /automaticReleaseLimit \?\? 2/);
  assert.match(helper, /actorId: null/g);
  assert.match(helper, /skipped_locked/);
  assert.match(helper, /failedItemIds/);
  assert.match(helper, /quality_warning_projection/);
  assert.match(helper, /materializeProductQualityWarningForWorkOrder/);
  assert.match(helper, /boundedLimit \+ 1/);
  assert.match(helper, /The scan transaction ends before any projection pair starts/);
  assert.match(entrypoint, /api\/internal\/production-planning-maintenance/);
  assert.match(entrypoint, /AbortSignal\.timeout\(12000\)/);
  assert.match(entrypoint, /phase=automatic_start_finalize&release=0&limit=2/);
  assert.match(entrypoint, /phase=quality_warning_projection&release=0&limit=2/);
  assert.match(entrypoint, /AbortSignal\.timeout\(8000\)/);
  assert.match(entrypoint, /reads remain available/);
  assert.match(planningDomain, /actorId: string \| null/);
  assert.match(routeService, /userId: string \| null/);
});
