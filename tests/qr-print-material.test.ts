import assert from 'node:assert/strict';
import test from 'node:test';
import { WorkOrderQrPrintMaterial, WorkOrderQrPrintMode } from '@prisma/client';
import {
  drawingImagePaperSizeFromSnapshot,
  resolveTravelerPrintMaterialReadiness,
  resolveWorkOrderQrPrintMaterials,
  WorkOrderQrServiceError,
  type TravelerPrintResourceContext,
} from '../lib/work-order-qr-service';

test('print presets resolve to the intended material groups', () => {
  assert.deepEqual(resolveWorkOrderQrPrintMaterials(WorkOrderQrPrintMode.TRAVELER_ONLY), [
    WorkOrderQrPrintMaterial.TRAVELER,
  ]);
  assert.deepEqual(resolveWorkOrderQrPrintMaterials(WorkOrderQrPrintMode.TRAVELER_QUALITY_WARNING), [
    WorkOrderQrPrintMaterial.TRAVELER,
    WorkOrderQrPrintMaterial.QUALITY_WARNING,
  ]);
  assert.deepEqual(resolveWorkOrderQrPrintMaterials(WorkOrderQrPrintMode.TRAVELER_SOP_DUPLEX), [
    WorkOrderQrPrintMaterial.TRAVELER,
    WorkOrderQrPrintMaterial.SOP,
  ]);
  assert.deepEqual(resolveWorkOrderQrPrintMaterials(WorkOrderQrPrintMode.DRAWING_SOP_TRAVELER_SEPARATE), [
    WorkOrderQrPrintMaterial.TRAVELER,
    WorkOrderQrPrintMaterial.SOP,
    WorkOrderQrPrintMaterial.DRAWING,
  ]);
  assert.deepEqual(resolveWorkOrderQrPrintMaterials(WorkOrderQrPrintMode.DRAWING_SEPARATE_TRAVELER_SOP_DUPLEX), [
    WorkOrderQrPrintMaterial.TRAVELER,
    WorkOrderQrPrintMaterial.SOP,
    WorkOrderQrPrintMaterial.DRAWING,
  ]);
});

test('custom reprint keeps only supported materials in stable order', () => {
  assert.deepEqual(resolveWorkOrderQrPrintMaterials(WorkOrderQrPrintMode.CUSTOM, ['drawing', 'QUALITY_WARNING', 'TRAVELER', 'drawing']), [
    WorkOrderQrPrintMaterial.TRAVELER,
    WorkOrderQrPrintMaterial.QUALITY_WARNING,
    WorkOrderQrPrintMaterial.DRAWING,
  ]);
  assert.throws(
    () => resolveWorkOrderQrPrintMaterials(WorkOrderQrPrintMode.CUSTOM, ['unsupported']),
    (error: unknown) => error instanceof WorkOrderQrServiceError && error.code === 'QR_PRINT_MATERIAL_REQUIRED',
  );
});

function resourceContext(overrides: Partial<TravelerPrintResourceContext> = {}): TravelerPrintResourceContext {
  return {
    label: 'D0199999-9152-V01',
    hasLibraryItem: true,
    files: [],
    sopDocument: null,
    ...overrides,
  };
}

test('published SOP pointer wins over a newer manual file', () => {
  const readiness = resolveTravelerPrintMaterialReadiness(resourceContext({
    sopDocument: {
      currentPublishedVersionId: 'published-v2',
      versions: [{ id: 'published-v2', status: 'published', deletedAt: null }],
    },
    files: [
      {
        id: 'manual-newer', categoryCode: 'sop', originalName: '现场照片.png', mimeType: 'image/png',
        sourceSopVersionId: null, isCurrent: true, deletedAt: null, updatedAt: '2026-08-14T08:00:00Z',
      },
      {
        id: 'published-file', categoryCode: 'sop', originalName: 'SOP-v2.pdf', mimeType: 'application/pdf',
        version: 'V2.0', sourceSopVersionId: 'published-v2', isCurrent: true, deletedAt: null, updatedAt: '2026-08-13T08:00:00Z',
      },
    ],
  }), 'sop');
  assert.equal(readiness.ready, true);
  assert.equal(readiness.fileId, 'published-file');
  assert.equal(readiness.fileVersion, 'V2.0');
});

test('broken published SOP snapshot is blocked instead of falling back to an unrelated manual file', () => {
  const readiness = resolveTravelerPrintMaterialReadiness(resourceContext({
    sopDocument: {
      currentPublishedVersionId: 'published-v2',
      versions: [{ id: 'published-v2', status: 'published', deletedAt: null }],
    },
    files: [{
      id: 'manual-old', categoryCode: 'sop', originalName: '旧版SOP.pdf', mimeType: 'application/pdf',
      sourceSopVersionId: null, isCurrent: true, deletedAt: null, updatedAt: '2026-08-12T08:00:00Z',
    }],
  }), 'sop');
  assert.equal(readiness.ready, false);
  assert.equal(readiness.code, 'QR_SOP_PUBLISHED_FILE_MISSING');
  assert.match(readiness.message, /重新发布/);
});

test('draft-only SOP reports the actionable publish requirement', () => {
  const readiness = resolveTravelerPrintMaterialReadiness(resourceContext({
    sopDocument: {
      currentPublishedVersionId: null,
      versions: [{ id: 'draft-v1', status: 'draft', deletedAt: null }],
    },
  }), 'sop');
  assert.equal(readiness.ready, false);
  assert.equal(readiness.code, 'QR_SOP_NOT_PUBLISHED');
  assert.match(readiness.message, /只有草稿/);
});

test('legacy manual PDF remains printable when no online SOP was published', () => {
  const readiness = resolveTravelerPrintMaterialReadiness(resourceContext({
    files: [{
      id: 'manual-sop', categoryCode: 'sop', originalName: '受控SOP.pdf', mimeType: 'application/pdf',
      sourceSopVersionId: null, isCurrent: true, deletedAt: null, updatedAt: '2026-08-14T08:00:00Z',
    }],
  }), 'sop');
  assert.equal(readiness.ready, true);
  assert.equal(readiness.fileId, 'manual-sop');
});

for (const source of [
  { id: 'manual-jpeg', name: '现场SOP.jpg', mimeType: 'image/jpeg' },
  { id: 'manual-png', name: '现场SOP.png', mimeType: 'image/png' },
  { id: 'manual-webp', name: '现场SOP.webp', mimeType: 'image/webp' },
]) {
  test(`legacy manual ${source.mimeType} SOP is printable when no online SOP was published`, () => {
    const readiness = resolveTravelerPrintMaterialReadiness(resourceContext({
      files: [{
        id: source.id, categoryCode: 'sop', originalName: source.name, mimeType: source.mimeType,
        sourceSopVersionId: null, isCurrent: true, deletedAt: null, updatedAt: '2026-08-14T08:00:00Z',
      }],
    }), 'sop');
    assert.equal(readiness.ready, true);
    assert.equal(readiness.fileId, source.id);
    assert.match(readiness.message, /可打印/);
  });
}

test('image drawing is printable while an unsupported office document is blocked', () => {
  const image = resolveTravelerPrintMaterialReadiness(resourceContext({
    files: [{
      id: 'drawing-webp', categoryCode: 'drawing', originalName: '原图.webp', mimeType: 'image/webp',
      isCurrent: true, deletedAt: null, updatedAt: '2026-08-14T08:00:00Z',
    }],
  }), 'drawing');
  assert.equal(image.ready, true);
  assert.equal(image.fileId, 'drawing-webp');

  const office = resolveTravelerPrintMaterialReadiness(resourceContext({
    files: [{
      id: 'drawing-docx', categoryCode: 'drawing', originalName: '原图.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      isCurrent: true, deletedAt: null, updatedAt: '2026-08-14T08:00:00Z',
    }],
  }), 'drawing');
  assert.equal(office.ready, false);
  assert.equal(office.code, 'QR_DRAWING_FORMAT_UNSUPPORTED');
  assert.match(office.message, /PDF、JPG、JPEG、PNG、WebP/);
});

test('drawing image paper size is read safely from the immutable print snapshot', () => {
  assert.equal(drawingImagePaperSizeFromSnapshot({ printRendering: { drawingImagePaperSize: 'A3' } }), 'A3');
  assert.equal(drawingImagePaperSizeFromSnapshot({ printRendering: { drawingImagePaperSize: 'A4' } }), 'A4');
  assert.equal(drawingImagePaperSizeFromSnapshot({ printRendering: { drawingImagePaperSize: 'A2' } }), 'A4');
  assert.equal(drawingImagePaperSizeFromSnapshot({}), 'A4');
});

test('deleted or non-current source files never pass readiness', () => {
  const readiness = resolveTravelerPrintMaterialReadiness(resourceContext({
    files: [{
      id: 'deleted-drawing', categoryCode: 'drawing', originalName: '原图.pdf', mimeType: 'application/pdf',
      isCurrent: true, deletedAt: '2026-08-14T08:00:00Z', updatedAt: '2026-08-14T08:00:00Z',
    }],
  }), 'drawing');
  assert.equal(readiness.ready, false);
  assert.equal(readiness.code, 'QR_DRAWING_REQUIRED');
});
