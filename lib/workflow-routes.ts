export type ProductTimeRouteOrigin = 'planning' | 'production' | 'workflow' | 'drawing';
export type ProductTimeRouteScope = 'current' | 'next' | 'carryover' | 'history';

export type ProductTimeRouteContext = {
  scope?: ProductTimeRouteScope | null;
  from?: ProductTimeRouteOrigin | null;
  returnTo?: string | null;
  returnKey?: string | null;
  batchId?: string | null;
  workOrderId?: string | null;
  stepId?: string | null;
  weekStartDate?: string | null;
  weekEndDate?: string | null;
};

export type ProductTimeReturnContext = {
  origin: ProductTimeRouteOrigin;
  returnTo: string;
  returnKey: string;
  label: string;
};

const allowedProductTimeReturnPaths = new Set([
  '/production',
  '/weekly-plan-center',
  '/workspace/workflows',
  '/drawing-library',
]);

function appendValue(params: URLSearchParams, key: string, value?: string | null): void {
  const normalized = String(value || '').trim();
  if (normalized) params.set(key, normalized);
}

export function safeProductTimeReturnPath(value: string | null | undefined): string | null {
  const route = String(value || '').trim();
  if (!route.startsWith('/') || route.startsWith('//') || route.includes('\\') || /[\u0000-\u001f]/.test(route)) {
    return null;
  }
  try {
    const parsed = new URL(route, 'http://hongmeng.local');
    if (parsed.origin !== 'http://hongmeng.local' || !allowedProductTimeReturnPaths.has(parsed.pathname)) return null;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}

export function productTimeConfigurationRoute(
  drawingLibraryItemId?: string | null,
  context: ProductTimeRouteContext = {},
): string {
  const params = new URLSearchParams();
  appendValue(params, 'itemId', drawingLibraryItemId);
  appendValue(params, 'scope', context.scope);
  appendValue(params, 'from', context.from);
  const safeReturnTo = safeProductTimeReturnPath(context.returnTo);
  if (safeReturnTo) params.set('returnTo', safeReturnTo);
  appendValue(params, 'returnKey', context.returnKey);
  appendValue(params, 'batchId', context.batchId);
  appendValue(params, 'workOrderId', context.workOrderId);
  appendValue(params, 'stepId', context.stepId);
  appendValue(params, 'weekStartDate', context.weekStartDate);
  appendValue(params, 'weekEndDate', context.weekEndDate);
  const query = params.toString();
  return `/workspace/product-times${query ? `?${query}` : ''}`;
}

export function productTimeReturnContextFromSearch(search: string): ProductTimeReturnContext | null {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const origin = params.get('from');
  if (origin !== 'planning' && origin !== 'production' && origin !== 'workflow' && origin !== 'drawing') return null;
  const returnTo = safeProductTimeReturnPath(params.get('returnTo'));
  if (!returnTo) return null;
  const labels: Record<ProductTimeRouteOrigin, string> = {
    planning: '返回计划中心原位置',
    production: '返回生产执行原位置',
    workflow: '返回流程中心',
    drawing: '返回图纸资料库',
  };
  return {
    origin,
    returnTo,
    returnKey: String(params.get('returnKey') || '').trim(),
    label: labels[origin],
  };
}
