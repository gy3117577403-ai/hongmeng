import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { MaintenanceSingleFlightGate } from '../lib/maintenance-single-flight';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

test('maintenance single-flight rejects overlap and exposes the active phase', async () => {
  const gate = new MaintenanceSingleFlightGate();
  const pending = deferred<string>();
  const first = gate.run({
    requestId: 'request-1',
    phase: 'drawing_links',
    now: new Date('2026-09-03T01:00:00.000Z'),
  }, () => pending.promise);

  const overlap = await gate.run({
    requestId: 'request-2',
    phase: 'automatic_start_finalize',
  }, async () => 'must-not-run');

  assert.equal(overlap.started, false);
  if (!overlap.started) {
    assert.deepEqual(overlap.active, {
      requestId: 'request-1',
      phase: 'drawing_links',
      startedAt: '2026-09-03T01:00:00.000Z',
    });
    assert.ok(overlap.activeForMs >= 0);
  }

  pending.resolve('done');
  assert.deepEqual(await first, { started: true, value: 'done' });

  const afterRelease = await gate.run({ requestId: 'request-3', phase: 'automatic_start_finalize' }, async () => 'next');
  assert.deepEqual(afterRelease, { started: true, value: 'next' });
});

test('maintenance single-flight releases the gate after a failure', async () => {
  const gate = new MaintenanceSingleFlightGate();
  await assert.rejects(
    gate.run({ requestId: 'request-1', phase: 'drawing_links' }, async () => {
      throw new Error('failed phase');
    }),
    /failed phase/,
  );

  const retry = await gate.run({ requestId: 'request-2', phase: 'drawing_links' }, async () => 'recovered');
  assert.deepEqual(retry, { started: true, value: 'recovered' });
});

test('all background maintenance routes share one gate and reject overlap with retry metadata', () => {
  const routes = [
    '../app/api/internal/process-route-change-outbox/route.ts',
    '../app/api/internal/production-planning-maintenance/route.ts',
    '../app/api/internal/quality-risk-outbox/route.ts',
  ].map(relativePath => readFileSync(resolve(import.meta.dirname, relativePath), 'utf8'));

  for (const route of routes) {
    assert.match(route, /backgroundMaintenanceGate\.run/);
    assert.match(route, /BACKGROUND_MAINTENANCE_ALREADY_RUNNING/);
    assert.match(route, /\{ status: 409 \}/);
    assert.match(route, /response\.headers\.set\('Retry-After', '30'\)/);
  }
});
