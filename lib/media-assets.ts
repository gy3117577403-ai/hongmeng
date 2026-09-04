import sharp from 'sharp';

export type MediaImageMetadata = {
  width: number | null;
  height: number | null;
  orientation: number | null;
};

export async function inspectMediaImage(bytes: Buffer, mimeType: string): Promise<MediaImageMetadata> {
  if (!mimeType.startsWith('image/')) return { width: null, height: null, orientation: null };
  const metadata = await sharp(bytes, { failOn: 'error', limitInputPixels: 60_000_000 }).metadata();
  return {
    width: metadata.width || null,
    height: metadata.height || null,
    orientation: metadata.orientation || null,
  };
}
