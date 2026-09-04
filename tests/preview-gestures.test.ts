import assert from 'node:assert/strict';
import test from 'node:test';
import { documentDisplaySettingsUrl, parsePageRotations, rotateDocumentPages, samePageRotations, orientationFromPrintSnapshot } from '../lib/document-orientation';

test('document rotations preserve mixed-page direction and use sparse relative quarter turns', () => {
  assert.deepEqual(rotateDocumentPages({ '2': 90 }, 1, -90, 3), { '1': 270, '2': 90 });
  assert.deepEqual(rotateDocumentPages({ '2': 90 }, 1, -90, 3, true), { '1': 270, '3': 270 });
  assert.ok(samePageRotations({ '1': 0 }, {}));
  assert.deepEqual(parsePageRotations({ '1': 0, '2': 90 }, 2), { '2': 90 });
  for (const value of [null, [], { '0': 90 }, { '01': 90 }, { '3': 90 }, { '1': 45 }, { '1': '90' }, { '1': -90 }]) {
    assert.throws(() => parsePageRotations(value, 2));
  }
});

test('document settings identify stable file endpoints without confusing other resource namespaces', () => {
  assert.equal(documentDisplaySettingsUrl('/api/drawing-library/files/a/content?reload=1'), '/api/drawing-library/files/a/display-settings');
  assert.equal(documentDisplaySettingsUrl('/api/resource-files/b/content'), '/api/resource-files/b/display-settings');
  assert.equal(documentDisplaySettingsUrl('/api/sample-photos/c/content'), '/api/sample-photos/c/display-settings');
  assert.equal(documentDisplaySettingsUrl('/api/connector-assembly-manual-assets/a/content'), null);
  assert.deepEqual(orientationFromPrintSnapshot({}, 'a'), { revision: 0, pageRotations: {} });
  assert.deepEqual(orientationFromPrintSnapshot({ documentOrientations: { a: { revision: 2, pageRotations: { '2': 270 } } } }, 'a'), { revision: 2, pageRotations: { '2': 270 } });
});
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
