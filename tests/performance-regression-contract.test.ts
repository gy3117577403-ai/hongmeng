import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..');
const source = (path: string) => readFileSync(resolve(root, path), 'utf8');

test('product time hot path is read-only, bounded, cancellable, and recoverable', () => {
  const route = source('app/api/product-time-profiles/route.ts');
  const shell = source('components/ProductTimeShell.tsx');
  assert.doesNotMatch(route, /reconcileProductionPlanDrawingLinks|reconcileFutureActiveProductionPlanWeeks/);
  assert.match(route, /Math\.min\(100, positiveInt/);
  assert.match(route, /take: pageSize/);
  assert.match(route, /PRODUCT_TIME_LIST_FAILED/);
  assert.match(shell, /listRequestRef\.current\?\.controller\.abort\(\)/);
  assert.match(shell, /timeoutMs: 12_000/);
  assert.match(shell, /if \(!referenceOpen\)/);
  assert.match(shell, /未获取到最新数据，已保留当前列表/);
});

test('production execution loads server pages progressively instead of downloading the whole week', () => {
  const shell = source('components/ProductionExecutionCenter.tsx');
  assert.match(shell, /fetchProductionBoardPage/);
  assert.match(shell, /includeSummary: false/);
  assert.match(shell, /offset = board\.items\.length/);
  assert.doesNotMatch(shell, /remainingOffsets|chunkSize = 500/);
});

test('drawing files support byte ranges and reuse object-storage clients', () => {
  const route = source('app/api/drawing-library/files/[fileId]/content/route.ts');
  const storage = source('lib/s3.ts');
  const shell = source('components/DrawingLibraryShell.tsx');
  assert.match(route, /export async function HEAD/);
  assert.match(route, /status: range \? 206 : 200/);
  assert.match(route, /Content-Range/);
  assert.match(storage, /let internalClient:S3Client\|undefined/);
  assert.match(storage, /Range:options\.range/);
  assert.match(shell, /skipInitialServerReloadRef/);
});

test('database performance controls and migrations remain part of the release', () => {
  const prisma = source('lib/prisma.ts');
  const migration = source('prisma/migrations/202609030001_response_performance_indexes/migration.sql');
  assert.match(prisma, /DB_CONNECTION_LIMIT/);
  assert.match(prisma, /DB_SLOW_QUERY_MS/);
  assert.match(migration, /drawing_library_active_updated_idx/);
  assert.match(migration, /production_plan_active_dispatch_idx/);
  assert.match(migration, /work_order_dispatch_idx/);
});

