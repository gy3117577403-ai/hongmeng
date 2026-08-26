export type ImageMetadataSize = {
  width?: number | null;
  height?: number | null;
  orientation?: number | null;
};

export type ImageDisplaySize = {
  width: number;
  height: number;
};

export function orientedImageSize(metadata: ImageMetadataSize): ImageDisplaySize | null {
  const width = Number(metadata.width);
  const height = Number(metadata.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  const orientation = Number(metadata.orientation || 1);
  return orientation >= 5 && orientation <= 8
    ? { width: Math.round(height), height: Math.round(width) }
    : { width: Math.round(width), height: Math.round(height) };
}
