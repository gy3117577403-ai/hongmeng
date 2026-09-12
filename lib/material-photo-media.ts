import crypto from 'node:crypto';
import sharp from 'sharp';
import { prisma } from '@/lib/prisma';
import { getObjectStream, putObject } from '@/lib/s3';

export async function renderMaterialPhotoRenditions(bytes: Buffer) {
  const image = sharp(bytes, { failOn: 'error', limitInputPixels: 60_000_000 }).rotate();
  const thumbnail = await image.clone().resize({ width: 384, height: 384, fit: 'inside', withoutEnlargement: true }).webp({ quality: 78 }).toBuffer();
  const preview = await image.clone().resize({ width: 1920, height: 1920, fit: 'inside', withoutEnlargement: true }).webp({ quality: 86 }).toBuffer();
  return { thumbnail, preview };
}

export async function createMaterialPhotoRenditions(bytes: Buffer, prefix: string) {
  const { thumbnail, preview } = await renderMaterialPhotoRenditions(bytes);
  const thumbnailKey = `${prefix}/thumb-v1.webp`, previewKey = `${prefix}/preview-v1.webp`;
  await putObject({ key: thumbnailKey, body: thumbnail, contentType: 'image/webp', originalName: 'thumbnail.webp' });
  await putObject({ key: previewKey, body: preview, contentType: 'image/webp', originalName: 'preview.webp' });
  return { thumbnailKey, thumbnailSize: thumbnail.length, previewKey, previewSize: preview.length, mediaStatus: 'READY', mediaError: null };
}

// One photo per poll; durable leases coordinate multiple application replicas.
export async function processMaterialPhotoMedia() {
  const now = new Date(), lease = crypto.randomUUID();
  const candidates = await prisma.materialLibraryPhoto.findMany({
    where: { deletedAt: null, materialItem: { deletedAt: null }, mediaStatus: { not: 'READY' }, mediaNextAt: { lte: now }, OR: [{ mediaLeaseUntil: null }, { mediaLeaseUntil: { lt: now } }] },
    orderBy: [{ mediaNextAt: 'asc' }, { createdAt: 'desc' }], take: 4,
  });
  for (const photo of candidates) {
    const claimed = await prisma.materialLibraryPhoto.updateMany({
      where: { id: photo.id, deletedAt: null, mediaStatus: { not: 'READY' }, OR: [{ mediaLeaseUntil: null }, { mediaLeaseUntil: { lt: now } }] },
      data: { mediaLease: lease, mediaLeaseUntil: new Date(Date.now() + 120_000), mediaAttempts: { increment: 1 } },
    });
    if (!claimed.count) continue;
    try {
      const stream = await getObjectStream(photo.objectKey, { abortSignal: AbortSignal.timeout(20_000) });
      const chunks: Buffer[] = []; let size = 0;
      for await (const chunk of stream) {
        const buffer = Buffer.from(chunk); size += buffer.length;
        if (size > 50 * 1024 * 1024) { stream.destroy(); throw new Error('IMAGE_TOO_LARGE'); }
        chunks.push(buffer);
      }
      const media = await createMaterialPhotoRenditions(Buffer.concat(chunks), `${photo.objectKey}.derived`);
      await prisma.materialLibraryPhoto.updateMany({ where: { id: photo.id, mediaLease: lease }, data: { ...media, mediaLease: null, mediaLeaseUntil: null } });
      return { processed: 1, failed: 0 };
    } catch {
      await prisma.materialLibraryPhoto.updateMany({ where: { id: photo.id, mediaLease: lease }, data: {
        mediaStatus: 'FAILED', mediaError: '照片预览生成失败，将自动重试', mediaLease: null, mediaLeaseUntil: null,
        mediaNextAt: new Date(Date.now() + Math.min(6 * 3600_000, 60_000 * 2 ** Math.min(photo.mediaAttempts, 8))),
      } });
      return { processed: 0, failed: 1 };
    }
  }
  return { processed: 0, failed: 0 };
}
