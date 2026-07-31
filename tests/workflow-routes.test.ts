import assert from 'node:assert/strict';
import test from 'node:test';
import { productTimeConfigurationRoute } from '../lib/workflow-routes';

test('product-time configuration always uses the product-time workspace', () => {
  assert.equal(productTimeConfigurationRoute(), '/workspace/product-times');
  assert.equal(
    productTimeConfigurationRoute('drawing/item 1'),
    '/workspace/product-times?itemId=drawing%2Fitem%201',
  );
  assert.doesNotMatch(productTimeConfigurationRoute('drawing-1'), /warehouse/);
});
