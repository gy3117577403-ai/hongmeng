import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { resizeOtherWorkPhoto } from '../lib/other-work-time-photo';
test('approval thumbnail respects orientation, bounds and leaves original bytes intact', async () => {
  const source = await sharp({ create: { width: 1600, height: 1200, channels: 3, background: '#ef6b00' } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
  const copy = Buffer.from(source), thumbnail = await resizeOtherWorkPhoto(source), metadata = await sharp(thumbnail).metadata();
  assert.equal(metadata.format, 'webp'); assert.equal(metadata.height, 256); assert.equal(metadata.width, 192);
  assert.ok(thumbnail.length < source.length); assert.deepEqual(source, copy);
});
