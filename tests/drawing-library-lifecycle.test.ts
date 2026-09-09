import assert from 'node:assert/strict';
import test from 'node:test';
import {
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

test('empty archives can be deleted after authorization and a full reference check', () => {
  assert.deepEqual(drawingLibraryDeletionBlockers({
    activePlanOrders: 0,
    activePlanBatches: 0,
    activeWorkOrders: 0,
  }), []);
  assert.equal(drawingLibraryDeletionBlockers({ activePlanOrders: 0, activePlanBatches: 0, activeWorkOrders: 0, activeFiles: 1 }).length, 1);
  assert.equal(drawingLibraryDeletionBlockers({ activePlanOrders: 0, activePlanBatches: 0, activeWorkOrders: 0, structuredReferences: 1 }).length, 1);
  assert.equal(drawingLibraryDeletionBlockers({ activePlanOrders: 0, activePlanBatches: 0, activeWorkOrders: 0, productTimeProfiles: 1 }).length, 1);
});
