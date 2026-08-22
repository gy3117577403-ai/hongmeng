import assert from 'node:assert/strict';
import test from 'node:test';
import {
  serializeDrawingLibraryItem,
  type DrawingLibraryItemWithFiles,
} from '@/lib/drawing-library';

function itemFixture(overrides: Partial<DrawingLibraryItemWithFiles> = {}): DrawingLibraryItemWithFiles {
  const now = new Date('2026-08-22T02:00:00.000Z');
  return {
    id: 'item-1',
    customerName: '测试客户',
    customerCode: '10001',
    productName: '测试线束',
    specification: 'TEST-SOP-001',
    libraryKey: '测试客户::TEST-SOP-001',
    remark: null,
    lastWorkOrderId: null,
    lastImportedAt: null,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
    files: [],
    productionPlanOrders: [],
    productDataRecords: [],
    connectorBindings: [],
    ...overrides,
  };
}

test('drawing library serialization exposes live SOP metadata and PDF control mode', () => {
  const now = new Date('2026-08-22T02:00:00.000Z');
  const serialized = serializeDrawingLibraryItem(itemFixture({
    sopDocument: {
      id: 'sop-1',
      sopStage: 'validating',
      drawingStatus: 'missing',
      remark: '新品参数等待验证',
      deletedAt: null,
      updatedAt: now,
    },
    files: [{
      id: 'file-1',
      libraryItemId: 'item-1',
      categoryId: 'category-sop',
      originalName: 'sop.pdf',
      displayName: 'sop.pdf',
      remark: null,
      mimeType: 'application/pdf',
      size: 1024,
      objectKey: 'drawing-library/item-1/sop.pdf',
      version: 'V1.1',
      uploadedById: null,
      sourceResourceFileId: null,
      sourceSopVersionId: null,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
      sourcePdfOverlayVersionId: 'overlay-1',
      supersedesFileId: null,
      isCurrent: true,
      sourcePdfOverlayVersion: { controlMode: 'controlled' },
    }],
  }), [{ id: 'category-sop', name: 'SOP指导书', code: 'sop', sortOrder: 2 }]);

  assert.deepEqual(serialized.sopMetadata, {
    id: 'sop-1',
    sopStage: 'validating',
    drawingStatus: 'missing',
    remark: '新品参数等待验证',
    updatedAt: now.toISOString(),
  });
  assert.equal(serialized.files[0]?.controlMode, 'controlled');
});

test('legacy files and deleted SOP metadata are not mislabeled', () => {
  const now = new Date('2026-08-22T02:00:00.000Z');
  const serialized = serializeDrawingLibraryItem(itemFixture({
    sopDocument: {
      id: 'sop-deleted',
      sopStage: 'standard',
      drawingStatus: 'available',
      remark: null,
      deletedAt: now,
      updatedAt: now,
    },
    files: [{
      id: 'file-legacy',
      libraryItemId: 'item-1',
      categoryId: 'category-sop',
      originalName: 'legacy.pdf',
      displayName: null,
      remark: null,
      mimeType: 'application/pdf',
      size: 512,
      objectKey: 'drawing-library/item-1/legacy.pdf',
      version: 'V1.0',
      uploadedById: null,
      sourceResourceFileId: null,
      sourceSopVersionId: null,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
      sourcePdfOverlayVersionId: null,
      supersedesFileId: null,
      isCurrent: true,
    }],
  }), [{ id: 'category-sop', name: 'SOP指导书', code: 'sop', sortOrder: 2 }]);

  assert.equal(serialized.sopMetadata, null);
  assert.equal(serialized.files[0]?.controlMode, null);
});

test('files are never guessed as uncontrolled when version metadata was not joined', () => {
  const now = new Date('2026-08-22T02:00:00.000Z');
  const serialized = serializeDrawingLibraryItem(itemFixture({
    files: [{
      id: 'file-overlay-without-relation',
      libraryItemId: 'item-1',
      categoryId: 'category-sop',
      originalName: 'controlled.pdf',
      displayName: null,
      remark: null,
      mimeType: 'application/pdf',
      size: 512,
      objectKey: 'drawing-library/item-1/controlled.pdf',
      version: 'V1.1',
      uploadedById: null,
      sourceResourceFileId: null,
      sourceSopVersionId: null,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
      sourcePdfOverlayVersionId: 'overlay-controlled',
      supersedesFileId: null,
      isCurrent: true,
    }],
  }), [{ id: 'category-sop', name: 'SOP指导书', code: 'sop', sortOrder: 2 }]);

  assert.equal(serialized.files[0]?.controlMode, null);
});

test('rich SOP publications expose their own controlled status', () => {
  const now = new Date('2026-08-22T02:00:00.000Z');
  const serialized = serializeDrawingLibraryItem(itemFixture({
    files: [{
      id: 'file-rich-sop',
      libraryItemId: 'item-1',
      categoryId: 'category-sop',
      originalName: 'rich-sop.pdf',
      displayName: null,
      remark: null,
      mimeType: 'application/pdf',
      size: 512,
      objectKey: 'drawing-library/item-1/rich-sop.pdf',
      version: 'V1.2',
      uploadedById: null,
      sourceResourceFileId: null,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
      sourceSopVersionId: 'sop-version-1',
      sourcePdfOverlayVersionId: null,
      supersedesFileId: null,
      isCurrent: true,
      sourceSopVersion: { controlMode: 'controlled' },
    }],
  }), [{ id: 'category-sop', name: 'SOP指导书', code: 'sop', sortOrder: 2 }]);

  assert.equal(serialized.files[0]?.controlMode, 'controlled');
});
