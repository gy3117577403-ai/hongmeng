import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PdfOverlayRequestError,
  emptyPdfOverlayDocument,
  validatePdfOverlayDocument,
} from '../lib/pdf-overlay';

const identity = { itemId: 'item_123456', fileId: 'file_123456', pageCount: 2 };

test('creates a file-bound empty PDF overlay document', () => {
  const document = emptyPdfOverlayDocument({
    itemId: identity.itemId,
    fileId: identity.fileId,
    fileName: 'SOP.pdf',
    pageCount: identity.pageCount,
  });

  assert.equal(document.sourceId, identity.itemId);
  assert.equal(document.baseFileId, identity.fileId);
  assert.equal(document.pageCount, 2);
  assert.deepEqual(document.annotations, []);
  assert.equal(document.revision, 0);
});

test('rejects a draft created for a different product or PDF version', () => {
  const document = emptyPdfOverlayDocument({
    itemId: identity.itemId,
    fileId: identity.fileId,
    fileName: 'SOP.pdf',
    pageCount: identity.pageCount,
  });

  assert.throws(
    () => validatePdfOverlayDocument(document, { ...identity, fileId: 'file_654321' }),
    (error: unknown) => error instanceof PdfOverlayRequestError
      && error.status === 409
      && error.code === 'PDF_OVERLAY_IDENTITY_CONFLICT',
  );
});

test('accepts server-backed image overlays and rejects external image URLs', () => {
  const base = emptyPdfOverlayDocument({
    itemId: identity.itemId,
    fileId: identity.fileId,
    fileName: 'SOP.pdf',
    pageCount: identity.pageCount,
  });
  const imageAnnotation = {
    id: 'annotation_123456',
    page: 1,
    kind: 'image' as const,
    x: 0.1,
    y: 0.2,
    width: 0.3,
    height: 0.4,
    imageAssetId: 'asset_123456',
    imageSrc: '/api/drawing-library/sop-pdf-overlay-assets/asset_123456',
    style: {
      stroke: '#ef6c00',
      fill: 'transparent',
      textColor: '#172033',
      opacity: 1,
      strokeWidth: 2,
      fontSize: 16,
    },
    zIndex: 0,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  };

  const valid = validatePdfOverlayDocument({ ...base, annotations: [imageAnnotation] }, identity);
  assert.equal(valid.annotations[0]?.imageAssetId, 'asset_123456');

  assert.throws(
    () => validatePdfOverlayDocument({
      ...base,
      annotations: [{ ...imageAnnotation, imageSrc: 'https://example.com/untrusted.png' }],
    }, identity),
    (error: unknown) => error instanceof PdfOverlayRequestError,
  );
});
