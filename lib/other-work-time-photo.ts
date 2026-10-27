import sharp from 'sharp';
import { getObjectStream, putObject } from '@/lib/s3';

const pending = new Map<string, Promise<Buffer>>();
const maxBytes = 15 * 1024 * 1024;
async function read(key: string) {
  const stream = await getObjectStream(key), chunks: Buffer[] = [];
  let bytes = 0;
  try {
    for await (const chunk of stream) {
      const buffer = Buffer.from(chunk); bytes += buffer.length;
      if (bytes > maxBytes) throw new Error('Photo exceeds preview limit');
      chunks.push(buffer);
    }
    return Buffer.concat(chunks);
  } finally { stream.destroy(); }
}
export async function resizeOtherWorkPhoto(source: Buffer) {
  return sharp(source, { limitInputPixels: 40_000_000, animated: false }).rotate().resize({ width: 256, height: 256, fit: 'inside', withoutEnlargement: true }).webp({ quality: 72 }).toBuffer();
}
// Derived files live beside their original in object storage, never on disk.
// The authenticated attachment route checks the original's access/deletion state
// on every request, including conditional 304 responses.
export async function otherWorkPhotoThumbnail(objectKey: string) {
  const existing = pending.get(objectKey);
  if (existing) return existing;
  const task = (async () => {
    const key = objectKey + '.preview-256-v1.webp';
    try { return await read(key); }
    catch (error) { if (!(error instanceof Error) || !['NoSuchKey', 'NotFound'].includes(error.name)) throw error; }
    const preview = await resizeOtherWorkPhoto(await read(objectKey));
    await putObject({ key, body: preview, contentType: 'image/webp', originalName: 'preview.webp' });
    return preview;
  })();
  pending.set(objectKey, task);
  try { return await task; } finally { pending.delete(objectKey); }
}
