import { Readable } from 'node:stream';
import { getObjectStream } from '@/lib/s3';

function asciiFilename(filename: string): string {
  return filename.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_') || 'showcase-image';
}

export async function capabilityShowcaseMediaResponse(media: {
  objectKey: string;
  originalName: string;
  displayName: string | null;
  mimeType: string;
  size: bigint;
}) {
  const filename = media.displayName?.trim() || media.originalName;
  const stream = await getObjectStream(media.objectKey);
  const body = Readable.toWeb(stream as Readable) as unknown as BodyInit;
  return new Response(body, {
    headers: {
      'Content-Type': media.mimeType,
      'Content-Length': String(media.size),
      'Content-Disposition': `inline; filename="${asciiFilename(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'Cache-Control': 'private, max-age=300',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    },
  });
}
