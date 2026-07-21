import assert from 'node:assert/strict';
import test from 'node:test';
import {
  drawingLibraryItemAnomalyReason,
  isAutoImportedEmptyDrawingLibraryItem,
  isVisibleDrawingLibraryItem,
} from '../lib/drawing-library';

const legacyEmptyItem = {
  specification: 'F120451123',
  libraryKey: '福尔达::F120451123',
  remark: null,
  lastImportedAt: new Date('2026-07-20T00:00:00.000Z'),
  lastWorkOrderId: 'work-order-1',
  files: [] as Array<{ id: string }>,
};

test('active planning links keep legacy empty drawing records visible and protected', () => {
  const linkedItem = {
    ...legacyEmptyItem,
    productionPlanOrders: [{ id: 'plan-order-1' }],
  };

  assert.equal(isVisibleDrawingLibraryItem(linkedItem), true);
  assert.equal(isAutoImportedEmptyDrawingLibraryItem(linkedItem), false);
  assert.equal(drawingLibraryItemAnomalyReason(linkedItem), '');
});

test('unlinked legacy auto-import empty records remain cleanup candidates', () => {
  assert.equal(isVisibleDrawingLibraryItem(legacyEmptyItem), false);
  assert.equal(isAutoImportedEmptyDrawingLibraryItem(legacyEmptyItem), true);
  assert.equal(drawingLibraryItemAnomalyReason(legacyEmptyItem), '无文件空记录');
});
