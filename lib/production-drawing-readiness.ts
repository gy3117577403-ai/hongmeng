function normalizedDrawingStatus(value?: string | null): string {
  return String(value || '').trim();
}

export function isExplicitlyUnissuedDrawingStatus(value?: string | null): boolean {
  return /未发|待发|未下发/.test(normalizedDrawingStatus(value));
}

export function hasEffectiveIssuedDrawing(
  drawingStatus: string | null | undefined,
  hasOriginalDrawing: boolean,
): boolean {
  const status = normalizedDrawingStatus(drawingStatus);
  if (hasOriginalDrawing) return true;
  if (!status || status === '-' || status.includes('未设置')) return false;
  if (isExplicitlyUnissuedDrawingStatus(status)) return false;
  return true;
}

export function shouldSynchronizeDrawingReleaseStatus(value?: string | null): boolean {
  const status = normalizedDrawingStatus(value);
  return !status
    || status === '-'
    || status.includes('未设置')
    || isExplicitlyUnissuedDrawingStatus(status);
}

export function productionDrawingStageLabel(input: {
  drawingStatus?: string | null;
  hasOriginalDrawing: boolean;
  planActive: boolean;
}): string {
  const status = normalizedDrawingStatus(input.drawingStatus);
  if (/样品|客户|变更|返工/.test(status)) return status;
  if (!hasEffectiveIssuedDrawing(status, input.hasOriginalDrawing)) return '图纸待补';
  return '等待工序配置';
}
