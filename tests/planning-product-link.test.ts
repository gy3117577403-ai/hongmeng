import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizePlanningProductText,
  planningProductIdentity,
  selectCanonicalDrawingItem,
  type PlanningProductLinkItem,
} from '../lib/planning-product-link';

function item(input: Partial<PlanningProductLinkItem> & Pick<PlanningProductLinkItem, 'id'>): PlanningProductLinkItem {
  return {
    id: input.id,
    customerName: input.customerName || '福尔达',
    specification: input.specification || 'F319951035',
    libraryKey: input.libraryKey || `${input.customerName || '福尔达'}::${input.specification || 'F319951035'}`,
    drawingFileCount: input.drawingFileCount || 0,
  };
}

test('normalizes harmless full-width and whitespace differences for cross-module identity', () => {
  assert.equal(normalizePlanningProductText('  Ｆ319951035  '), 'f319951035');
  assert.equal(
    planningProductIdentity('福尔达 ', ' F319951035'),
    planningProductIdentity('福尔达', 'Ｆ319951035'),
  );
});

test('links an unlinked plan order to its unique drawing product', () => {
  const canonical = item({ id: 'drawing-1', drawingFileCount: 1 });
  assert.equal(selectCanonicalDrawingItem({
    drawingLibraryItemId: null,
    customerName: '福尔达',
    specification: 'F319951035',
  }, [canonical])?.id, canonical.id);
});

test('prefers the only matching record with a real drawing over an empty stale duplicate', () => {
  const stale = item({ id: 'drawing-empty', libraryKey: '福尔达::F319951035', drawingFileCount: 0 });
  const uploaded = item({ id: 'drawing-file', customerName: '福尔达 ', libraryKey: '福尔达 ::F319951035', drawingFileCount: 1 });
  assert.equal(selectCanonicalDrawingItem({
    drawingLibraryItemId: stale.id,
    customerName: '福尔达',
    specification: 'F319951035',
  }, [stale, uploaded])?.id, uploaded.id);
});

test('keeps an ambiguous identity unresolved instead of relinking arbitrarily', () => {
  const first = item({ id: 'drawing-1', customerName: '福尔达 ', libraryKey: 'a', drawingFileCount: 1 });
  const second = item({ id: 'drawing-2', customerName: ' 福尔达', libraryKey: 'b', drawingFileCount: 1 });
  assert.equal(selectCanonicalDrawingItem({
    drawingLibraryItemId: null,
    customerName: '福尔达',
    specification: 'F319951035',
  }, [first, second]), null);
});
