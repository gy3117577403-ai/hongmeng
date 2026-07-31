export function productTimeConfigurationRoute(drawingLibraryItemId?: string | null): string {
  const itemId = String(drawingLibraryItemId || '').trim();
  return `/workspace/product-times${itemId ? `?itemId=${encodeURIComponent(itemId)}` : ''}`;
}
