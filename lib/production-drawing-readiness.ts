function normalizedDrawingStatus(value?: string | null): string {
  return String(value || '').trim();
}

export function isExplicitlyUnissuedDrawingStatus(value?: string | null): boolean {
  return /未发|待发|未下发/.test(normalizedDrawingStatus(value));
}

export function hasEffectiveIssuedDrawing(
  _drawingStatus: string | null | undefined,
  hasOriginalDrawing: boolean,
): boolean {
  // A cached work-order label must never advertise a drawing that has been
  // soft-deleted. The active original file is the cross-module source of truth.
  return hasOriginalDrawing;
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
