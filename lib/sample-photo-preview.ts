import sharp from 'sharp';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';

export type SamplePreviewSize = 'thumb' | 'screen' | 'hd';
const edge = { thumb: 440, screen: 1600, hd: 2560 } as const;
const cache = new Map<string, { bytes: Buffer; until: number }>();
const pending = new Map<string, Promise<Buffer>>();
const MAX_CACHE_BYTES = 32 * 1024 * 1024;
let cacheBytes = 0;
let active = 0;
const waiting: Array<() => void> = [];
export class SamplePreviewBusyError extends Error {}

/** Decode actual bytes, apply EXIF orientation and publish a bounded image. */
export async function normalizeSamplePreview(source: Readable, size: SamplePreviewSize): Promise<Buffer> {
  const image = sharp({ limitInputPixels: 100_000_000, sequentialRead: true })
    .rotate().resize(edge[size], edge[size], { fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' }).toColourspace('srgb');
  if (size === 'thumb') image.webp({ quality: 72 });
  else image.jpeg({ quality: size === 'hd' ? 88 : 82, progressive: false });
  const [, bytes] = await Promise.all([pipeline(source, image), image.toBuffer()]);
  return bytes;
}

/** Authorized callers only. Versioned keys prevent replacement reusing an old derivative. */
export async function samplePhotoPreview(key: string, size: SamplePreviewSize, source: () => Promise<Readable>): Promise<Buffer> {
  const cacheKey = size + ':' + key, now = Date.now();
  for (const [entryKey, value] of cache) if (value.until < now) { cache.delete(entryKey); cacheBytes -= value.bytes.length; }
  const hit = cache.get(cacheKey);
  if (hit) { cache.delete(cacheKey); cache.set(cacheKey, hit); return hit.bytes; }
  const running = pending.get(cacheKey);
  if (running) return running;
  const work = (async () => {
    if (active >= 2) {
      if (waiting.length >= 16) throw new SamplePreviewBusyError('预览繁忙');
      await new Promise<void>(resolve => waiting.push(resolve));
    } else active++;
    try {
      const bytes = await normalizeSamplePreview(await source(), size);
      while (cacheBytes + bytes.length > MAX_CACHE_BYTES && cache.size) {
        const oldest = cache.keys().next().value!;
        cacheBytes -= cache.get(oldest)!.bytes.length; cache.delete(oldest);
      }
      if (bytes.length <= MAX_CACHE_BYTES) { cache.set(cacheKey, { bytes, until: Date.now() + 60_000 }); cacheBytes += bytes.length; }
      return bytes;
    } finally { const next = waiting.shift(); if (next) next(); else active--; }
  })();
  pending.set(cacheKey, work);
  try { return await work; } finally { pending.delete(cacheKey); }
}
