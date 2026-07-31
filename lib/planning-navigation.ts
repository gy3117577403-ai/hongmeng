export type PlanningDrawingNavigationInput = {
  drawingLibraryItemId?: string | null;
  customerName: string;
  specification: string;
  productName: string;
  batchId: string;
  weekStartDate: string;
  weekEndDate: string;
};

export type PlanningReturnContext = {
  returnTo: string;
  batchId: string;
  weekStartDate: string;
  weekEndDate: string;
};

export function buildPlanningReturnPath({
  batchId,
  weekStartDate,
}: Pick<PlanningDrawingNavigationInput, 'batchId' | 'weekStartDate'>): string {
  const params = new URLSearchParams({ restore: '1' });
  if (weekStartDate) params.set('week', weekStartDate);
  if (batchId) params.set('batchId', batchId);
  return `/weekly-plan-center?${params.toString()}`;
}

export function safePlanningReturnPath(value: string | null | undefined, fallback: string): string {
  const route = String(value || '').trim();
  if (!route.startsWith('/') || route.startsWith('//') || route.includes('\\') || /[\u0000-\u001f]/.test(route)) {
    return fallback;
  }
  try {
    const parsed = new URL(route, 'http://hongmeng.local');
    if (parsed.origin !== 'http://hongmeng.local' || parsed.pathname !== '/weekly-plan-center') return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}

export function buildPlanningDrawingLibraryHref(input: PlanningDrawingNavigationInput): string {
  const returnTo = buildPlanningReturnPath(input);
  const params = new URLSearchParams({
    from: 'planning',
    returnTo,
    batchId: input.batchId,
    weekStartDate: input.weekStartDate,
    weekEndDate: input.weekEndDate,
  });
  if (input.drawingLibraryItemId) {
    params.set('itemId', input.drawingLibraryItemId);
  } else {
    params.set('create', '1');
    params.set('customerName', input.customerName);
    params.set('specification', input.specification);
    params.set('productName', input.productName);
  }
  return `/drawing-library?${params.toString()}`;
}

export function planningReturnContextFromSearch(search: string): PlanningReturnContext | null {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  if (params.get('from') !== 'planning') return null;
  const batchId = params.get('batchId')?.trim() || '';
  const weekStartDate = params.get('weekStartDate')?.trim() || '';
  const weekEndDate = params.get('weekEndDate')?.trim() || '';
  const fallback = buildPlanningReturnPath({ batchId, weekStartDate });
  return {
    returnTo: safePlanningReturnPath(params.get('returnTo'), fallback),
    batchId,
    weekStartDate,
    weekEndDate,
  };
}
