import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildPlanningDrawingLibraryHref,
  buildPlanningReturnPath,
  planningReturnContextFromSearch,
  safePlanningReturnPath,
} from '../lib/planning-navigation';

test('builds a drawing-library link that keeps the source plan batch and week', () => {
  const href = buildPlanningDrawingLibraryHref({
    drawingLibraryItemId: 'drawing-1',
    customerName: '福尔达',
    specification: 'F129951528',
    productName: '前门板氛围灯线束组件',
    batchId: 'batch-63',
    weekStartDate: '2026-08-03',
    weekEndDate: '2026-08-09',
  });
  const url = new URL(href, 'http://hongmeng.local');
  assert.equal(url.pathname, '/drawing-library');
  assert.equal(url.searchParams.get('itemId'), 'drawing-1');
  assert.equal(url.searchParams.get('from'), 'planning');
  assert.equal(url.searchParams.get('batchId'), 'batch-63');
  assert.equal(
    url.searchParams.get('returnTo'),
    '/weekly-plan-center?restore=1&week=2026-08-03&batchId=batch-63',
  );
});

test('keeps create parameters when the plan product has no drawing archive yet', () => {
  const href = buildPlanningDrawingLibraryHref({
    customerName: '杭州昆泰',
    specification: 'M009A0173',
    productName: '空调预充线',
    batchId: 'batch-new',
    weekStartDate: '2026-08-03',
    weekEndDate: '2026-08-09',
  });
  const url = new URL(href, 'http://hongmeng.local');
  assert.equal(url.searchParams.get('create'), '1');
  assert.equal(url.searchParams.get('customerName'), '杭州昆泰');
  assert.equal(url.searchParams.get('specification'), 'M009A0173');
});

test('accepts only a local planning-center path for the planning return action', () => {
  const fallback = buildPlanningReturnPath({ batchId: 'batch-1', weekStartDate: '2026-08-03' });
  assert.equal(
    safePlanningReturnPath('/weekly-plan-center?restore=1&week=2026-08-03', fallback),
    '/weekly-plan-center?restore=1&week=2026-08-03',
  );
  assert.equal(safePlanningReturnPath('https://example.com/weekly-plan-center', fallback), fallback);
  assert.equal(safePlanningReturnPath('//example.com/weekly-plan-center', fallback), fallback);
  assert.equal(safePlanningReturnPath('/production', fallback), fallback);
  assert.equal(safePlanningReturnPath('/weekly-plan-center\\evil', fallback), fallback);
});

test('parses a copied planning deep link and reconstructs a safe fallback', () => {
  const context = planningReturnContextFromSearch(
    '?from=planning&returnTo=https%3A%2F%2Fevil.example&batchId=batch-9&weekStartDate=2026-08-03&weekEndDate=2026-08-09',
  );
  assert.deepEqual(context, {
    returnTo: '/weekly-plan-center?restore=1&week=2026-08-03&batchId=batch-9',
    batchId: 'batch-9',
    weekStartDate: '2026-08-03',
    weekEndDate: '2026-08-09',
  });
  assert.equal(planningReturnContextFromSearch('?itemId=drawing-1'), null);
});
