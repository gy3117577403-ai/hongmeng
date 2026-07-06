'use client';

type ImageOptimizeOptions = {
  force?: boolean;
  fileName?: string;
  maxSize?: number;
  quality?: number;
};

const DEFAULT_MAX_SIZE = 2560;
const DEFAULT_QUALITY = 0.9;
const MIN_COMPRESS_BYTES = 1024 * 1024;

function isImageFile(file: File): boolean {
  return file.type.startsWith('image/') || /\.(png|jpe?g|webp)$/i.test(file.name);
}

function extensionFromType(type: string): string {
  if (type.includes('png')) return 'png';
  if (type.includes('webp')) return 'webp';
  return 'jpg';
}

function readableCameraName(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `workorder-camera-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.jpg`;
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise(resolve => canvas.toBlob(resolve, type, quality));
}

function loadImageElement(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('image load failed'));
    };
    image.src = url;
  });
}

async function loadBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(file);
    } catch {
      return loadImageElement(file);
    }
  }
  return loadImageElement(file);
}

export async function compressImageForUpload(file: File, options: ImageOptimizeOptions = {}): Promise<File> {
  if (!isImageFile(file)) return file;
  if (!options.force && file.size < MIN_COMPRESS_BYTES) return file;

  let bitmap: ImageBitmap | HTMLImageElement;
  try {
    bitmap = await loadBitmap(file);
  } catch {
    return file;
  }
  const sourceWidth = bitmap instanceof HTMLImageElement ? bitmap.naturalWidth : bitmap.width;
  const sourceHeight = bitmap instanceof HTMLImageElement ? bitmap.naturalHeight : bitmap.height;
  if (!sourceWidth || !sourceHeight) {
    if ('close' in bitmap) bitmap.close();
    return file;
  }

  const maxSize = options.maxSize || DEFAULT_MAX_SIZE;
  const scale = Math.min(1, maxSize / Math.max(sourceWidth, sourceHeight));
  if (!options.force && scale >= 1 && file.size < MIN_COMPRESS_BYTES * 2) return file;

  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) {
    if ('close' in bitmap) bitmap.close();
    return file;
  }
  context.drawImage(bitmap, 0, 0, width, height);

  const outputType = file.type === 'image/png' && file.size < MIN_COMPRESS_BYTES * 2 ? 'image/png' : 'image/jpeg';
  const blob = await canvasToBlob(canvas, outputType, options.quality || DEFAULT_QUALITY);
  if ('close' in bitmap) {
    bitmap.close();
  }
  if (!blob) return file;
  if (!options.force && blob.size >= file.size) return file;

  const ext = extensionFromType(outputType);
  const fallbackName = file.name.replace(/\.[^.]+$/, `.${ext}`) || `image.${ext}`;
  const name = options.fileName || fallbackName;
  return new File([blob], name, { type: outputType, lastModified: Date.now() });
}

export async function normalizeCapturedImage(file: File): Promise<File> {
  return compressImageForUpload(file, {
    force: true,
    fileName: readableCameraName(),
    maxSize: DEFAULT_MAX_SIZE,
    quality: DEFAULT_QUALITY,
  });
}
