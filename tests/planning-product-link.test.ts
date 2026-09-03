import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizePlanningProductText,
  planningProductIdentity,
  PlanningProductLinkItemIndex,
  reconcileProductionPlanDrawingLinks,
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

test('pre-indexed canonical lookup preserves exact-key, exact-field, and current-link priority', () => {
  const order = {
    drawingLibraryItemId: 'current-link',
    customerName: '福尔达',
    specification: 'F319951035',
  };

  const exactKey = item({
    id: 'exact-key',
    customerName: ' 福尔达',
    libraryKey: '福尔达::F319951035',
    drawingFileCount: 1,
  });
  const exactFields = item({
    id: 'exact-fields',
    libraryKey: 'non-canonical-key',
    drawingFileCount: 1,
  });
  const currentLink = item({
    id: 'current-link',
    customerName: '福尔达 ',
    specification: 'Ｆ319951035',
    libraryKey: 'another-key',
    drawingFileCount: 1,
  });

  assert.equal(
    new PlanningProductLinkItemIndex([currentLink, exactFields, exactKey])
      .selectCanonicalDrawingItem(order)?.id,
    exactKey.id,
  );
  assert.equal(
    new PlanningProductLinkItemIndex([currentLink, exactFields])
      .selectCanonicalDrawingItem(order)?.id,
    exactFields.id,
  );
  assert.equal(
    new PlanningProductLinkItemIndex([
      currentLink,
      item({
        id: 'other-normalized-match',
        customerName: ' 福尔达',
        specification: 'F319951035 ',
        libraryKey: 'other-key',
        drawingFileCount: 1,
      }),
    ]).selectCanonicalDrawingItem(order)?.id,
    currentLink.id,
  );
});

test('pre-indexes the full drawing-link scan once for repeated normalized lookups', () => {
  const items = Array.from({ length: 5000 }, (_, index) => item({
    id: `drawing-${index}`,
    customerName: `客户 ${index}`,
    specification: `ＭＯＤＥＬ-${index}`,
    drawingFileCount: 1,
  }));
  const index = new PlanningProductLinkItemIndex(items);

  // Lookups must be served by the index rather than rescanning the source collection.
  items.length = 0;
  let matched = 0;
  for (let offset = 0; offset < 5000; offset += 1) {
    const canonical = index.selectCanonicalDrawingItem({
      drawingLibraryItemId: null,
      customerName: `  客户 ${offset}  `,
      specification: `model-${offset}`,
    });
    if (canonical?.id === `drawing-${offset}`) matched += 1;
  }
  assert.equal(matched, 5000);
});

test('reconciliation propagates an uploaded original drawing to an existing released work order', async () => {
  const workOrderUpdates: Array<{ where: unknown; data: unknown }> = [];
  const tx = {
    drawingLibraryItem: {
      findFirst: async () => ({
        id: 'drawing-1',
        customerName: '福尔达',
        specification: 'F319951035',
      }),
      findMany: async () => [{
        id: 'drawing-1',
        libraryKey: '福尔达::F319951035',
        customerName: '福尔达',
        specification: 'F319951035',
        _count: { files: 1 },
      }],
    },
    productionPlanOrder: {
      findMany: async () => [{
        id: 'plan-order-1',
        drawingLibraryItemId: 'drawing-1',
        customerName: '福尔达',
        specification: 'F319951035',
      }],
      update: async () => ({}),
    },
    productionPlanBatch: {
      findMany: async () => [{
        planOrderId: 'plan-order-1',
        workOrderId: 'work-order-1',
      }],
    },
    workOrder: {
      updateMany: async (input: { where: unknown; data: unknown }) => {
        workOrderUpdates.push(input);
        return { count: 1 };
      },
    },
  } as unknown as Parameters<typeof reconcileProductionPlanDrawingLinks>[0];

  const result = await reconcileProductionPlanDrawingLinks(tx, { drawingLibraryItemId: 'drawing-1' });
  assert.equal(result.unchangedOrders, 1);
  assert.equal(workOrderUpdates.length, 2);
  assert.deepEqual(workOrderUpdates[0]?.data, { drawingLibraryItemId: 'drawing-1' });
  assert.equal((workOrderUpdates[1]?.data as { drawingStatus?: string }).drawingStatus, '已发');
  assert.ok((workOrderUpdates[1]?.data as { drawingIssuedAt?: Date }).drawingIssuedAt instanceof Date);
});
