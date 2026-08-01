'use client';

import type {
  PdfOverlayAnnotation,
  PdfOverlayDocument,
  PdfOverlayPageImage,
  PdfOverlayPageSize,
} from './pdf-overlay-editor-types';

type ExportOptions = {
  /** Raster density relative to PDF points. Defaults to 2 for print clarity. */
  scale?: number;
};

type LoadedImage = CanvasImageSource & { close?: () => void };

function applyStroke(context: CanvasRenderingContext2D, annotation: PdfOverlayAnnotation, baseScale: number): void {
  context.strokeStyle = annotation.style.stroke;
  context.lineWidth = Math.max(1, annotation.style.strokeWidth * baseScale);
  context.lineCap = 'round';
  context.lineJoin = 'round';
}

function drawWrappedText(
  context: CanvasRenderingContext2D,
  annotation: PdfOverlayAnnotation,
  canvasWidth: number,
  canvasHeight: number,
  baseScale: number,
): void {
  const x = annotation.x * canvasWidth;
  const y = annotation.y * canvasHeight;
  const width = Math.max(1, annotation.width * canvasWidth);
  const height = Math.max(1, annotation.height * canvasHeight);
  const fontSize = Math.max(8, annotation.style.fontSize * baseScale);
  const lineHeight = fontSize * 1.32;
  const text = annotation.text || '';
  context.fillStyle = annotation.style.textColor;
  context.font = `${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif`;
  context.textBaseline = 'top';

  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    let current = '';
    for (const character of paragraph || ' ') {
      const candidate = `${current}${character}`;
      if (current && context.measureText(candidate).width > width) {
        lines.push(current);
        current = character;
      } else {
        current = candidate;
      }
    }
    lines.push(current);
  }

  context.save();
  context.beginPath();
  context.rect(x, y, width, height);
  context.clip();
  lines.forEach((line, index) => {
    const lineY = y + index * lineHeight;
    if (lineY <= y + height) context.fillText(line, x, lineY);
  });
  context.restore();
}

async function loadImage(source: string): Promise<LoadedImage> {
  try {
    const response = await fetch(source, { credentials: 'include' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    if (typeof createImageBitmap === 'function') return await createImageBitmap(blob);

    const objectUrl = URL.createObjectURL(blob);
    try {
      const image = new Image();
      image.decoding = 'async';
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error('图片解码失败'));
        image.src = objectUrl;
      });
      return image;
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : '未知错误';
    throw new Error(`批注图片无法导出：${detail}`);
  }
}
async function drawAnnotation(
  context: CanvasRenderingContext2D,
  annotation: PdfOverlayAnnotation,
  canvasWidth: number,
  canvasHeight: number,
  baseScale: number,
  imageCache: Map<string, Promise<LoadedImage>>,
): Promise<void> {
  context.save();
  context.globalAlpha = Math.max(0, Math.min(1, annotation.style.opacity));
  applyStroke(context, annotation, baseScale);

  const x = annotation.x * canvasWidth;
  const y = annotation.y * canvasHeight;
  const width = annotation.width * canvasWidth;
  const height = annotation.height * canvasHeight;

  if (annotation.kind === 'text') {
    drawWrappedText(context, annotation, canvasWidth, canvasHeight, baseScale);
  } else if (annotation.kind === 'image' && annotation.imageSrc) {
    let imagePromise = imageCache.get(annotation.imageSrc);
    if (!imagePromise) {
      imagePromise = loadImage(annotation.imageSrc);
      imageCache.set(annotation.imageSrc, imagePromise);
    }
    const image = await imagePromise;
    context.drawImage(image, x, y, width, height);
  } else if (annotation.kind === 'rectangle' || annotation.kind === 'cover') {
    if (annotation.style.fill !== 'transparent') {
      context.fillStyle = annotation.style.fill;
      context.fillRect(x, y, width, height);
    }
    if (annotation.style.stroke !== 'transparent') context.strokeRect(x, y, width, height);
  } else if (annotation.kind === 'arrow') {
    const endX = (annotation.endX ?? annotation.x + annotation.width) * canvasWidth;
    const endY = (annotation.endY ?? annotation.y + annotation.height) * canvasHeight;
    context.beginPath();
    context.moveTo(x, y);
    context.lineTo(endX, endY);
    context.stroke();
    const angle = Math.atan2(endY - y, endX - x);
    const head = Math.max(8, annotation.style.strokeWidth * baseScale * 4);
    context.beginPath();
    context.moveTo(endX, endY);
    context.lineTo(endX - head * Math.cos(angle - Math.PI / 6), endY - head * Math.sin(angle - Math.PI / 6));
    context.moveTo(endX, endY);
    context.lineTo(endX - head * Math.cos(angle + Math.PI / 6), endY - head * Math.sin(angle + Math.PI / 6));
    context.stroke();
  } else if ((annotation.kind === 'pen' || annotation.kind === 'highlight') && annotation.points?.length) {
    const points = annotation.points;
    context.beginPath();
    context.moveTo(points[0].x * canvasWidth, points[0].y * canvasHeight);
    for (const point of points.slice(1)) context.lineTo(point.x * canvasWidth, point.y * canvasHeight);
    context.stroke();
  }

  context.restore();
}

/**
 * Rasterizes only the user-created overlay layer. The source PDF is deliberately
 * excluded so the publishing service can preserve it as the original vector PDF.
 */
export async function exportPdfOverlayPngs(
  document: PdfOverlayDocument,
  pageSizes: PdfOverlayPageSize[],
  options: ExportOptions = {},
): Promise<PdfOverlayPageImage[]> {
  const scale = Math.max(1, Math.min(4, options.scale || 2));
  const imageCache = new Map<string, Promise<LoadedImage>>();
  const output: PdfOverlayPageImage[] = [];

  try {
    for (const pageSize of pageSizes) {
      const pageAnnotations = document.annotations
        .filter(annotation => annotation.page === pageSize.page && !annotation.hidden)
        .sort((first, second) => first.zIndex - second.zIndex);
      if (pageAnnotations.length === 0) continue;

      const canvas = window.document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(pageSize.width * scale));
      canvas.height = Math.max(1, Math.round(pageSize.height * scale));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('浏览器不支持透明批注导出');
      context.clearRect(0, 0, canvas.width, canvas.height);
      const baseScale = canvas.width / 1000;
      for (const annotation of pageAnnotations) {
        await drawAnnotation(context, annotation, canvas.width, canvas.height, baseScale, imageCache);
      }
      output.push({
        page: pageSize.page,
        width: pageSize.width,
        height: pageSize.height,
        pngDataUrl: canvas.toDataURL('image/png'),
      });
    }
    return output;
  } finally {
    for (const promise of imageCache.values()) {
      void promise.then(image => image.close?.()).catch(() => undefined);
    }
  }
}
