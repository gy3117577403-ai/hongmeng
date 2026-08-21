export type PickerRect = {
  top: number;
  right: number;
  bottom: number;
  left: number;
  width: number;
};

export type PickerPopoverLayout = {
  side: 'up' | 'down';
  top: number | null;
  bottom: number | null;
  left: number;
  width: number;
  maxHeight: number;
};

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

export function calculatePickerPopoverLayout({
  anchor,
  boundary,
  viewportWidth,
  viewportHeight,
  preferredMinWidth = 320,
  preferredMaxHeight = 330,
  boundaryPadding = 8,
  viewportPadding = 12,
  gap = 6,
  comfortableHeight = 180,
}: {
  anchor: PickerRect;
  boundary: Omit<PickerRect, 'width'>;
  viewportWidth: number;
  viewportHeight: number;
  preferredMinWidth?: number;
  preferredMaxHeight?: number;
  boundaryPadding?: number;
  viewportPadding?: number;
  gap?: number;
  comfortableHeight?: number;
}): PickerPopoverLayout {
  const safeLeft = Math.max(viewportPadding, boundary.left + boundaryPadding);
  const safeRight = Math.min(viewportWidth - viewportPadding, boundary.right - boundaryPadding);
  const safeTop = Math.max(viewportPadding, boundary.top + boundaryPadding);
  const safeBottom = Math.min(viewportHeight - viewportPadding, boundary.bottom - boundaryPadding);
  const availableWidth = Math.max(0, safeRight - safeLeft);
  const width = Math.min(Math.max(anchor.width, preferredMinWidth), availableWidth);
  const left = clamp(anchor.right - width, safeLeft, safeRight - width);
  const spaceBelow = Math.max(0, safeBottom - anchor.bottom - gap);
  const spaceAbove = Math.max(0, anchor.top - gap - safeTop);
  const side = spaceBelow >= comfortableHeight || spaceBelow >= spaceAbove ? 'down' : 'up';
  const maxHeight = Math.min(preferredMaxHeight, side === 'down' ? spaceBelow : spaceAbove);

  return {
    side,
    top: side === 'down' ? anchor.bottom + gap : null,
    bottom: side === 'up' ? viewportHeight - anchor.top + gap : null,
    left,
    width,
    maxHeight,
  };
}
