import assert from 'node:assert/strict';
import test from 'node:test';
import {
  productTimeConfigurationRoute,
  productTimeReturnContextFromSearch,
  safeProductTimeReturnPath,
} from '../lib/workflow-routes';

test('product-time configuration always uses the product-time workspace', () => {
  assert.equal(productTimeConfigurationRoute(), '/workspace/product-times');
  const deepLink = new URL(productTimeConfigurationRoute('drawing/item 1'), 'http://hongmeng.local');
  assert.equal(deepLink.pathname, '/workspace/product-times');
  assert.equal(deepLink.searchParams.get('itemId'), 'drawing/item 1');
  assert.doesNotMatch(productTimeConfigurationRoute('drawing-1'), /warehouse/);
});

test('product-time configuration preserves an allow-listed module return context', () => {
  const route = productTimeConfigurationRoute('drawing/item 1', {
    scope: 'next',
    from: 'workflow',
    returnTo: '/workspace/workflows?workOrderId=wo-1&weekScope=next',
    returnKey: 'return-1',
    workOrderId: 'wo-1',
    stepId: 'step-1',
  });
  const url = new URL(route, 'http://hongmeng.local');
  assert.equal(url.pathname, '/workspace/product-times');
  assert.equal(url.searchParams.get('itemId'), 'drawing/item 1');
  assert.equal(url.searchParams.get('scope'), 'next');
  assert.equal(url.searchParams.get('from'), 'workflow');
  assert.equal(url.searchParams.get('returnTo'), '/workspace/workflows?workOrderId=wo-1&weekScope=next');
  assert.equal(url.searchParams.get('returnKey'), 'return-1');
  assert.equal(url.searchParams.get('workOrderId'), 'wo-1');
  assert.equal(url.searchParams.get('stepId'), 'step-1');
});

test('product-time return context rejects external and unrelated module routes', () => {
  assert.equal(safeProductTimeReturnPath('https://example.com/production'), null);
  assert.equal(safeProductTimeReturnPath('//example.com/production'), null);
  assert.equal(safeProductTimeReturnPath('/workspace/warehouse'), null);
  assert.equal(safeProductTimeReturnPath('/production?scope=current'), '/production?scope=current');
  assert.equal(productTimeReturnContextFromSearch('?from=workflow&returnTo=%2Fworkspace%2Fwarehouse'), null);
  assert.deepEqual(
    productTimeReturnContextFromSearch('?from=planning&returnTo=%2Fweekly-plan-center%3Frestore%3D1'),
    {
      origin: 'planning',
      returnTo: '/weekly-plan-center?restore=1',
      returnKey: '',
      label: '返回计划中心原位置',
    },
  );
});

test('drawing-library can preserve a nested planning return while opening product time', () => {
  const drawingReturn = '/drawing-library?itemId=item-7&from=planning&returnTo=%2Fweekly-plan-center%3FbatchId%3Dbatch-7';
  const route = productTimeConfigurationRoute('item-7', {
    from: 'drawing',
    returnTo: drawingReturn,
  });
  const url = new URL(route, 'http://hongmeng.local');
  const context = productTimeReturnContextFromSearch(url.search);
  assert.deepEqual(context, {
    origin: 'drawing',
    returnTo: drawingReturn,
    returnKey: '',
    label: '返回图纸资料库',
  });
});
