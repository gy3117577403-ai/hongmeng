import assert from 'node:assert/strict';
import test from 'node:test';
import { orientedImageSize } from '../lib/image-orientation';

test('EXIF orientations 5 through 8 swap the stored display dimensions', () => {
  assert.deepEqual(orientedImageSize({ width: 4032, height: 3024, orientation: 1 }), { width: 4032, height: 3024 });
  assert.deepEqual(orientedImageSize({ width: 4032, height: 3024, orientation: 6 }), { width: 3024, height: 4032 });
  assert.deepEqual(orientedImageSize({ width: 4032, height: 3024, orientation: 8 }), { width: 3024, height: 4032 });
});

test('invalid image dimensions cannot enter the material photo metadata', () => {
  assert.equal(orientedImageSize({ width: 0, height: 3024, orientation: 1 }), null);
  assert.equal(orientedImageSize({ width: 4032, height: Number.NaN, orientation: 1 }), null);
});
