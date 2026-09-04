import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { runTasksWithConcurrencyLimit } from '../lib/promise-concurrency';
import {
  ProductionReadCoordinator,
  productionReadKey,
} from '../lib/production-read-coordinator';
import type { ProductionEntityScope } from '../lib/production-access-scope';
import { productionWeekSelector } from '../lib/production-execution';

function deferred<T>() {
  let resolvePromise!: (value: T) => void;
  let rejectPromise!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

test('bounded task runner caps active work and preserves input order', async () => {
  let active = 0;
  let maximumActive = 0;
  const completed: number[] = [];
  const values = await runTasksWithConcurrencyLimit(2, Array.from({ length: 8 }, (_, index) => async () => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    await new Promise(resolveDelay => setTimeout(resolveDelay, (8 - index) * 2));
    completed.push(index);
    active -= 1;
    return `value-${index}`;
  }));

  assert.equal(maximumActive, 2);
  assert.notDeepEqual(completed, [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(values, Array.from({ length: 8 }, (_, index) => `value-${index}`));
  assert.deepEqual(await runTasksWithConcurrencyLimit(0, []), []);
  assert.deepEqual(await runTasksWithConcurrencyLimit(Number.NaN, [async () => 'safe']), ['safe']);
});

test('bounded task runner drains active work but preserves the first failure', async () => {
  await assert.rejects(
    runTasksWithConcurrencyLimit(2, [
      async () => {
        await new Promise(resolveDelay => setTimeout(resolveDelay, 5));
        throw new Error('first failure');
      },
      async () => {
        await new Promise(resolveDelay => setTimeout(resolveDelay, 20));
        throw new Error('later failure');
      },
      async () => 'must-not-start',
    ] as const),
    /first failure/,
  );
});

test('production read coordinator joins identical work and rejects distinct overlap', async () => {
  const coordinator = new ProductionReadCoordinator();
  const pending = deferred<{ total: number }>();
  let calls = 0;
  const leader = coordinator.run({
    key: 'same',
    requestId: 'leader',
    operation: 'execution',
  }, async () => {
    calls += 1;
    return pending.promise;
  });
  await Promise.resolve();

  const joined = coordinator.run({
    key: 'same',
    requestId: 'joined',
    operation: 'execution',
  }, async () => {
    calls += 1;
    return { total: -1 };
  });
  const busy = await coordinator.run({
    key: 'different',
    requestId: 'busy',
    operation: 'summary',
  }, async () => ({ total: -2 }));

  assert.equal(busy.started, false);
  if (!busy.started) {
    assert.equal(busy.active.requestId, 'leader');
    assert.equal(busy.active.operation, 'execution');
    assert.ok(busy.activeForMs >= 0);
  }
  pending.resolve({ total: 7 });
  assert.deepEqual(await leader, { started: true, shared: false, value: { total: 7 } });
  assert.deepEqual(await joined, { started: true, shared: true, value: { total: 7 } });
  assert.equal(calls, 1);

  const afterRelease = await coordinator.run({
    key: 'different',
    requestId: 'after',
    operation: 'summary',
  }, async () => ({ total: 9 }));
  assert.deepEqual(afterRelease, { started: true, shared: false, value: { total: 9 } });
});

test('production read coordinator releases the process slot after a shared failure', async () => {
  const coordinator = new ProductionReadCoordinator();
  const pending = deferred<string>();
  const leader = coordinator.run({
    key: 'failure',
    requestId: 'leader',
    operation: 'execution',
  }, () => pending.promise);
  await Promise.resolve();
  const joined = coordinator.run({
    key: 'failure',
    requestId: 'joined',
    operation: 'execution',
  }, async () => 'must-not-run');
  pending.reject(new Error('database unavailable'));
  await assert.rejects(leader, /database unavailable/);
  await assert.rejects(joined, /database unavailable/);

  const recovered = await coordinator.run({
    key: 'recovered',
    requestId: 'recovered',
    operation: 'summary',
  }, async () => 'ok');
  assert.deepEqual(recovered, { started: true, shared: false, value: 'ok' });
});

test('production read keys are stable for equal scopes and isolated across access boundaries', () => {
  const teamScope = (teamKeys: string[], readOnly = false): ProductionEntityScope => ({
    level: 'TEAM',
    canRead: true,
    canWrite: !readOnly,
    canReconcile: false,
    readOnly,
    teamKeys,
  });
  const input = { page: 1, filters: { keyword: 'A' } };
  assert.equal(
    productionReadKey('execution', teamScope(['team-b', 'team-a']), input),
    productionReadKey('execution', teamScope(['team-a', 'team-b']), input),
  );
  assert.notEqual(
    productionReadKey('execution', teamScope(['team-a']), input),
    productionReadKey('execution', teamScope(['team-b']), input),
  );
  assert.notEqual(
    productionReadKey('execution', teamScope(['team-a']), input),
    productionReadKey('execution', teamScope(['team-a'], true), input),
  );
  const globalScope: ProductionEntityScope = {
    level: 'GLOBAL',
    canRead: true,
    canWrite: false,
    canReconcile: false,
    readOnly: true,
    teamKeys: [],
  };
  assert.notEqual(
    productionReadKey('execution', teamScope(['team-a'], true), input),
    productionReadKey('execution', globalScope, input),
  );
});

test('production week selector normalizes database-free scopes and preserves history identity', () => {
  assert.deepEqual(
    productionWeekSelector('2026-01-01', '2026-12-31', 'current'),
    { scope: 'current', weekStartInput: null, weekEndInput: null },
  );
  assert.deepEqual(
    productionWeekSelector(null, '2026-12-31', 'history'),
    { scope: 'history', weekStartInput: null, weekEndInput: null },
  );
  assert.deepEqual(
    productionWeekSelector('2026-08-31', null, null),
    { scope: 'history', weekStartInput: '2026-08-31', weekEndInput: null },
  );
});

test('all coordinated production execution and export routes use shared admission control', () => {
  const root = resolve(import.meta.dirname, '..');
  const routes = [
    'app/api/work-orders/execution/route.ts',
    'app/api/dashboard/production-summary/route.ts',
    'app/api/export/production-execution.csv/route.ts',
    'app/api/export/production-dispatch.xlsx/route.ts',
    'app/api/production/dispatch-print/route.ts',
  ];
  for (const route of routes) {
    const source = readFileSync(resolve(root, route), 'utf8');
    assert.match(source, /productionReadCoordinator\.run/);
    assert.match(source, /productionReadKey/);
    assert.match(source, /status: 503/);
    assert.match(source, /Retry-After', '2'/);
    assert.ok(
      source.indexOf('productionReadCoordinator.run') < source.indexOf('const week = await resolveProductionWeek'),
      `${route} must admit the expensive read before history:auto resolves through Prisma`,
    );
  }
  const executionRoute = readFileSync(resolve(root, routes[0]), 'utf8');
  assert.match(executionRoute, /quick: \[\.\.\.new Set\(filters\.quick \|\| \[\]\)\]\.sort\(\)/);
  assert.match(executionRoute, /customers: \[\.\.\.\(filters\.customers \|\| \[\]\)\]\.sort\(\)/);
});

test('hot production loaders explicitly cap database fan-out at two', () => {
  const root = resolve(import.meta.dirname, '..');
  const execution = readFileSync(resolve(root, 'lib/production-execution.ts'), 'utf8');
  const warehouse = readFileSync(resolve(root, 'lib/wip-warehouse.ts'), 'utf8');
  const continuations = readFileSync(resolve(root, 'lib/wip-continuations.ts'), 'utf8');
  assert.match(execution, /runTasksWithConcurrencyLimit\(2/);
  assert.match(warehouse, /runTasksWithConcurrencyLimit\(2/);
  assert.match(continuations, /runTasksWithConcurrencyLimit\(2/);
  assert.doesNotMatch(execution, /map\.set\(key, \[\.\.\.\(map\.get\(key\) \|\| \[\]\), task\]\)/);
});
