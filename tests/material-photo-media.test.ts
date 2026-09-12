import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { renderMaterialPhotoRenditions } from '../lib/material-photo-media';

test('material previews honor camera orientation, bound dimensions and leave original bytes unchanged', async () => {
  const original = await sharp({ create: { width: 2400, height: 1600, channels: 3, background: '#ca6c31' } }).jpeg({ quality: 95 }).withMetadata({ orientation: 6 }).toBuffer();
  const before = Buffer.from(original);
  const { thumbnail, preview } = await renderMaterialPhotoRenditions(original);
  const thumb = await sharp(thumbnail).metadata(), clear = await sharp(preview).metadata();
  assert.equal(thumb.format, 'webp'); assert.equal(thumb.height, 384); assert.equal(thumb.width, 256);
  assert.equal(clear.height, 1920); assert.equal(clear.width, 1280); assert.equal(clear.orientation, undefined);
  assert.deepEqual(original, before); assert.ok(thumbnail.length < original.length); assert.ok(preview.length < original.length);
});
test('material previews do not enlarge small images and reject broken image content', async () => {
  const original = await sharp({ create: { width: 120, height: 80, channels: 3, background: '#fff' } }).png().toBuffer();
  const { thumbnail, preview } = await renderMaterialPhotoRenditions(original);
  assert.equal((await sharp(thumbnail).metadata()).width, 120);
  assert.equal((await sharp(preview).metadata()).width, 120);
  await assert.rejects(renderMaterialPhotoRenditions(Buffer.from('broken image')));
});
