import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
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
  assert.match(entrypoint, /phase=automatic_start_finalize&release=0&limit=2/);
  assert.match(entrypoint, /phase=quality_warning_projection&release=0&limit=2/);
  assert.match(entrypoint, /policy=single_flight_fail_fast/);
  assert.match(entrypoint, /elif ! run_maintenance_step/);
  assert.match(entrypoint, /maintenance_failed_step/);
  assert.match(entrypoint, /maintenance_delay_seconds=\$\(\(maintenance_delay_seconds \* 2\)\)/);
  assert.match(entrypoint, /maintenance_max_backoff_seconds=300/);
  assert.match(entrypoint, /event=cycle_failed/);
  assert.match(entrypoint, /http_server_process_running=true read_availability=unknown/);
  assert.doesNotMatch(entrypoint, /reads_available=true/);
  assert.match(entrypoint, /BACKGROUND_MAINTENANCE_REQUEST_TIMEOUT_MS:-60000/);
  assert.match(entrypoint, /signal:\s*AbortSignal\.timeout\(requestTimeoutMs\)/);
  assert.match(planningDomain, /actorId: string \| null/);
  assert.match(routeService, /userId: string \| null/);
});

test('maintenance request watchdog exits while the server handler keeps running', { timeout: 30_000 }, async t => {
  const entrypoint = source('docker-entrypoint.sh');
  const workerScript = entrypoint.match(/node -e '\r?\n(?<script>[\s\S]*?)\r?\n    '\r?\n\}/)?.groups?.script;
  assert.ok(workerScript, 'inline maintenance request helper must remain extractable');

  let handlerFinished = false;
  let markHandlerStarted!: () => void;
  const handlerStarted = new Promise<void>(resolve => {
    markHandlerStarted = resolve;
  });
  let releaseHandler!: () => void;
  const handlerRelease = new Promise<void>(resolve => {
    releaseHandler = resolve;
  });
  let finishHandler: (() => void) | undefined;
  const handlerDone = new Promise<void>(resolve => {
    finishHandler = resolve;
  });
  const server = createServer((_request, response) => {
    markHandlerStarted();
    void handlerRelease.then(() => {
      handlerFinished = true;
      if (!response.destroyed) {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ ok: true }));
      }
      finishHandler?.();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  let child: ReturnType<typeof spawn> | undefined;
  t.after(async () => {
    releaseHandler();
    child?.kill();
    const closed = new Promise<void>(resolve => {
      server.close(() => resolve());
    });
    server.closeAllConnections();
    await closed;
  });

  const port = String((server.address() as AddressInfo).port);
  const resultPromise = new Promise<{ code: number | null; stderr: string }>((resolve, reject) => {
    const spawnedChild = spawn(process.execPath, ['-e', workerScript], {
      env: {
        ...process.env,
        PORT: port,
        MAINTENANCE_STEP_NAME: 'watchdog_contract',
        MAINTENANCE_STEP_PATH: '/delayed',
        PROCESS_ROUTE_CHANGE_OUTBOX_WORKER_TOKEN: 'x'.repeat(32),
        BACKGROUND_MAINTENANCE_REQUEST_TIMEOUT_MS: '1000',
      },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    child = spawnedChild;
    const childStderr = spawnedChild.stderr;
    if (!childStderr) {
      reject(new Error('maintenance worker stderr pipe is unavailable'));
      return;
    }
    let stderr = '';
    childStderr.setEncoding('utf8');
    childStderr.on('data', chunk => {
      stderr += chunk;
    });
    spawnedChild.once('error', reject);
    spawnedChild.once('close', code => resolve({ code, stderr }));
  });
  const firstEvent = await Promise.race([
    handlerStarted.then(() => ({ kind: 'handler_started' as const })),
    resultPromise.then(result => ({ kind: 'child_exited' as const, result })),
  ]);
  assert.equal(firstEvent.kind, 'handler_started',
    `watchdog fired before the request reached the server: ${
      firstEvent.kind === 'child_exited' ? firstEvent.result.stderr : ''
    }`);
  const result = await resultPromise;

  assert.equal(result.code, 1);
  assert.match(result.stderr, /event=step_failed/);
  assert.match(result.stderr, /error_name="TimeoutError"/);
  assert.equal(handlerFinished, false,
    'client watchdog expiry must not be mistaken for server-side handler cancellation');
  releaseHandler();
  await handlerDone;
  assert.equal(handlerFinished, true);
});
