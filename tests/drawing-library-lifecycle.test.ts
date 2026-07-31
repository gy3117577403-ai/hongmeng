import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DRAWING_LIBRARY_MASTER_IMMUTABLE_CODE,
  DRAWING_LIBRARY_MASTER_IMMUTABLE_MESSAGE,
  activeDrawingLibraryFileCount,
  drawingLibraryDeletionBlockers,
} from '../lib/drawing-library-lifecycle';

test('soft-deleted drawing library parents do not advertise active drawing files', () => {
  assert.equal(activeDrawingLibraryFileCount({ deletedAt: null, drawingFileCount: 3 }), 3);
  assert.equal(activeDrawingLibraryFileCount({
    deletedAt: new Date('2026-08-01T00:00:00.000Z'),
    drawingFileCount: 3,
  }), 0);
  assert.equal(activeDrawingLibraryFileCount({
    deletedAt: '2026-08-01T00:00:00.000Z',
    drawingFileCount: 1,
  }), 0);
});

test('active planning and production references block parent archive deletion', () => {
  assert.deepEqual(drawingLibraryDeletionBlockers({
    activePlanOrders: 2,
    activePlanBatches: 1,
    activeWorkOrders: 3,
  }), [
    '2 条活动计划仍在使用',
    '1 个活动批次仍在使用',
    '3 张未完成生产工单仍在使用',
  ]);
});

test('an empty impact is diagnostic only and never authorizes master deletion', () => {
  assert.deepEqual(drawingLibraryDeletionBlockers({
    activePlanOrders: 0,
    activePlanBatches: 0,
    activeWorkOrders: 0,
  }), []);
  assert.equal(DRAWING_LIBRARY_MASTER_IMMUTABLE_CODE, 'DRAWING_LIBRARY_MASTER_IMMUTABLE');
  assert.match(DRAWING_LIBRARY_MASTER_IMMUTABLE_MESSAGE, /主档.*不允许删除/);
});
