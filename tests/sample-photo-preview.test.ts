import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import sharp from 'sharp';
import { normalizeSamplePreview, samplePhotoPreview } from '../lib/sample-photo-preview';

test('large mobile originals become bounded sRGB JPEGs with EXIF orientation applied', async () => {
  const original = await sharp({ create: { width: 8000, height: 6000, channels: 3, background: '#ee8833' } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
  const result = await normalizeSamplePreview(Readable.from(original), 'screen');
  const meta = await sharp(result).metadata();
  assert.equal(meta.format, 'jpeg'); assert.equal(meta.width, 1200); assert.equal(meta.height, 1600);
  assert.ok(!meta.orientation || meta.orientation === 1);
  const hd = await sharp(await normalizeSamplePreview(Readable.from(original), 'hd')).metadata();
  assert.equal(hd.height, 2560); assert.equal(hd.width, 1920);
});

test('transparent and mislabeled bytes normalize without relying on uploaded MIME', async () => {
  const original = await sharp({ create: { width: 400, height: 200, channels: 4, background: '#00000000' } }).png().toBuffer();
  const image = await normalizeSamplePreview(Readable.from(original), 'screen');
  const { data, info } = await sharp(image).raw().toBuffer({ resolveWithObject: true });
  assert.equal(info.width, 400); assert.equal(info.height, 200);
  assert.ok(data[0] > 250 && data[1] > 250 && data[2] > 250, 'transparent background becomes white');
  await assert.rejects(normalizeSamplePreview(Readable.from('corrupt image bytes'), 'screen'));
  await assert.rejects(normalizeSamplePreview(Readable.from((async function* () { throw Error('storage disconnected'); })()), 'screen'));
});

test('preview work is deduplicated and version changes never reuse old image bytes', async () => {
  const a = await sharp({ create: { width: 30, height: 20, channels: 3, background: 'red' } }).png().toBuffer();
  const b = await sharp({ create: { width: 30, height: 20, channels: 3, background: 'blue' } }).png().toBuffer();
  let calls = 0;
  const source = async () => { calls++; return Readable.from(a); };
  const [first, second] = await Promise.all([samplePhotoPreview('fixture:hash-a:v1', 'screen', source), samplePhotoPreview('fixture:hash-a:v1', 'screen', source)]);
  assert.equal(calls, 1); assert.deepEqual(first, second);
  const changed = await samplePhotoPreview('fixture:hash-b:v2', 'screen', async () => Readable.from(b));
  assert.notDeepEqual(first, changed);
});
