import sharp from 'sharp';

export type QualityImageGeometry = { imageWidth: number; imageHeight: number; imageOrientation: number };

/** Decode metadata only. Never crop, recompress or replace the original evidence. */
export async function readQualityImageGeometry(bytes: Uint8Array): Promise<QualityImageGeometry> {
  const meta = await sharp(bytes, { failOn: 'error', limitInputPixels: 60_000_000 }).metadata();
  const width = meta.width || 0;
  const height = meta.pageHeight || meta.height || 0;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw new Error('图片缺少有效尺寸');
  }
  if ((meta.pages || 1) > 1) throw new Error('打印证据请使用静态图片，不支持多帧图片');
  const imageOrientation = meta.orientation || 1;
  const swapped = imageOrientation >= 5 && imageOrientation <= 8;
  return { imageWidth: swapped ? height : width, imageHeight: swapped ? width : height, imageOrientation };
}
