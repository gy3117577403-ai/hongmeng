import { prisma } from '@/lib/prisma';
import { getObjectStream } from '@/lib/s3';
import { PrintableDocumentError, readPrintableSourceStream } from '@/lib/printable-document';
import { readQualityImageGeometry } from '@/lib/quality-image-metadata';

type ImageSource = {
  id: string; displayName: string; mimeType: string; printIncluded?: boolean;
  imageWidth?: number | null; imageHeight?: number | null; imageOrientation?: number | null;
};

/** Lazy, bounded backfill for legacy files; only technical metadata changes, never archive snapshots. */
export async function resolveQualityPrintImages<T extends ImageSource>(images: T[]): Promise<T[]> {
  const resolved: T[] = [];
  for (const image of images) {
    if (!image.mimeType.startsWith('image/') || image.printIncluded === false ||
      (Number(image.imageWidth) > 0 && Number(image.imageHeight) > 0)) {
      resolved.push(image); continue;
    }
    try {
      const stored = await prisma.internalQualityRiskAttachment.findUniqueOrThrow({ where: { id: image.id } });
      const geometry = stored.imageWidth && stored.imageHeight
        ? { imageWidth: stored.imageWidth, imageHeight: stored.imageHeight, imageOrientation: stored.imageOrientation || 1 }
        : await readQualityImageGeometry(await readPrintableSourceStream(await getObjectStream(stored.objectKey), { fileName: image.displayName, maxBytes: 50 * 1024 * 1024 }));
      if (!stored.imageWidth || !stored.imageHeight) {
        // Preserve business updatedAt: this cache does not represent an evidence edit.
        await prisma.internalQualityRiskAttachment.update({ where: { id: image.id }, data: { ...geometry, updatedAt: stored.updatedAt } });
      }
      resolved.push({ ...image, ...geometry });
    } catch {
      throw new PrintableDocumentError(`无法读取「${image.displayName}」的原图尺寸，请检查文件后重试；不会用方形占位图替代或漏印`, 409, 'QUALITY_PRINT_IMAGE_GEOMETRY_UNAVAILABLE');
    }
  }
  return resolved;
}
