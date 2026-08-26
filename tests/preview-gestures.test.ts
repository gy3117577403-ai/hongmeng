import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_PREVIEW_ZOOM,
  MIN_PREVIEW_ZOOM,
  clampPreviewZoom,
  constrainPreviewPan,
  normalizePreviewRotation,
  previewFitZoom,
  rotatedPreviewSize,
} from '../lib/preview-gestures';

test('manual zoom keeps a fitted technical drawing proportional below 40 percent', () => {
  const fittedZoom = previewFitZoom(
    'fit-height',
    { width: 1926, height: 1126 },
    { width: 589, height: 398 },
  );
  const nextZoom = clampPreviewZoom(fittedZoom * 1.15);

  assert.ok(fittedZoom < 0.4);
  assert.ok(Math.abs(nextZoom - fittedZoom * 1.15) < 1e-10);
  assert.ok(nextZoom > fittedZoom);
});

test('preview zoom still has stable lower and upper safety bounds', () => {
  assert.equal(MIN_PREVIEW_ZOOM, 0.02);
  assert.equal(clampPreviewZoom(0), MIN_PREVIEW_ZOOM);
  assert.equal(clampPreviewZoom(99), MAX_PREVIEW_ZOOM);
});

test('fit-window uses the rotated bounding box for portrait and landscape photos', () => {
  const source = { width: 3024, height: 4032 };
  const viewport = { width: 1370, height: 760 };
  const rotated = rotatedPreviewSize(source, 90);
  const fittedZoom = previewFitZoom('fit-window', rotated, viewport);

  assert.deepEqual(rotated, { width: 4032, height: 3024 });
  assert.ok(rotated.width * fittedZoom <= viewport.width - 36 + 0.001);
  assert.ok(rotated.height * fittedZoom <= viewport.height - 36 + 0.001);
  assert.equal(previewFitZoom('actual-size', rotated, viewport), 1);
});

test('rotation normalization and pan limits remain stable across repeated viewer actions', () => {
  assert.equal(normalizePreviewRotation(-90), 270);
  assert.equal(normalizePreviewRotation(450), 90);
  assert.equal(normalizePreviewRotation(Number.NaN), 0);

  assert.deepEqual(
    constrainPreviewPan({ panX: 999, panY: -999 }, { width: 4032, height: 3024 }, { width: 1370, height: 760 }, 0.5),
    { panX: 371, panY: -424 },
  );
});
