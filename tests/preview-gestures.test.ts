import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_PREVIEW_ZOOM,
  MIN_PREVIEW_ZOOM,
  clampPreviewZoom,
  previewFitZoom,
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
