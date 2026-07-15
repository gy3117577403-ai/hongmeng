export const MIN_PREVIEW_ZOOM = 0.4;
export const MAX_PREVIEW_ZOOM = 5;
export const PREVIEW_EDGE_MARGIN = 48;

export type PreviewFitMode = 'fit-height' | 'fit-window' | 'fit-width' | 'actual-size' | 'manual';

export type PreviewPoint = {
  x: number;
  y: number;
};

export type PreviewSize = {
  width: number;
  height: number;
};

export type PreviewPan = {
  panX: number;
  panY: number;
};

export function clampPreviewZoom(value: number): number {
  return Math.max(MIN_PREVIEW_ZOOM, Math.min(MAX_PREVIEW_ZOOM, value));
}

export function previewDistance(first: PreviewPoint, second: PreviewPoint): number {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

export function previewMidpoint(first: PreviewPoint, second: PreviewPoint): PreviewPoint {
  return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
}

export function rotatedPreviewSize(size: PreviewSize, rotation: number): PreviewSize {
  return Math.abs(rotation % 180) === 90
    ? { width: size.height, height: size.width }
    : size;
}

export function previewFitZoom(
  mode: Exclude<PreviewFitMode, 'manual'>,
  contentSize: PreviewSize,
  viewportSize: PreviewSize,
  padding = 36,
): number {
  if (mode === 'actual-size') return 1;
  if (contentSize.width <= 0 || contentSize.height <= 0 || viewportSize.width <= 0 || viewportSize.height <= 0) return 1;
  const widthScale = Math.max(0.01, (viewportSize.width - padding) / contentSize.width);
  const heightScale = Math.max(0.01, (viewportSize.height - padding) / contentSize.height);
  const scale = mode === 'fit-width'
    ? widthScale
    : mode === 'fit-height'
      ? contentSize.width * heightScale <= viewportSize.width - padding ? heightScale : Math.min(widthScale, heightScale)
      : Math.min(widthScale, heightScale);
  return Math.max(0.02, Math.min(MAX_PREVIEW_ZOOM, scale));
}

export function previewPanForFocalZoom(
  current: PreviewPan,
  focalPoint: PreviewPoint,
  currentZoom: number,
  nextZoom: number,
): PreviewPan {
  const ratio = nextZoom / Math.max(0.001, currentZoom);
  return {
    panX: focalPoint.x - (focalPoint.x - current.panX) * ratio,
    panY: focalPoint.y - (focalPoint.y - current.panY) * ratio,
  };
}

export function constrainPreviewPan(
  pan: PreviewPan,
  contentSize: PreviewSize,
  viewportSize: PreviewSize,
  zoom: number,
  edgeMargin = PREVIEW_EDGE_MARGIN,
): PreviewPan {
  const displayWidth = contentSize.width * zoom;
  const displayHeight = contentSize.height * zoom;
  const maxX = displayWidth > viewportSize.width
    ? Math.max(0, (displayWidth - viewportSize.width) / 2 + edgeMargin)
    : 0;
  const maxY = displayHeight > viewportSize.height
    ? Math.max(0, (displayHeight - viewportSize.height) / 2 + edgeMargin)
    : 0;
  return {
    panX: Math.max(-maxX, Math.min(maxX, pan.panX)),
    panY: Math.max(-maxY, Math.min(maxY, pan.panY)),
  };
}

export function previewCanPan(contentSize: PreviewSize, viewportSize: PreviewSize, zoom: number): boolean {
  return contentSize.width * zoom > viewportSize.width + 1 || contentSize.height * zoom > viewportSize.height + 1;
}
