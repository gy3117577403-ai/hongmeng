export type PlanningImportTime = {
  unitMilliseconds: number | null;
  totalMilliseconds: string | null;
  source: 'import' | 'published' | 'order' | 'missing';
};

export function resolvePlanningImportTime(input: {
  imported?: number | null;
  published?: number | null;
  order?: number | null;
  quantity: number;
}): PlanningImportTime {
  for (const source of ['import', 'published', 'order'] as const) {
    const value = source === 'import' ? input.imported : input[source];
    if (Number.isSafeInteger(value) && Number(value) > 0) {
      return { unitMilliseconds: value!, totalMilliseconds: (BigInt(value!) * BigInt(input.quantity)).toString(), source };
    }
  }
  return { unitMilliseconds: null, totalMilliseconds: null, source: 'missing' };
}

export const planningImportTimeSourceText = { import: '本次导入', published: '已发布产品工时', order: '已有订单工时', missing: '待维护' };
import type { ProductionPlanImportRow } from './production-plan-import';

export function productionPlanImportNeedsProductDecision(row: ProductionPlanImportRow, orderChoice?: string): boolean {
  if (row.status !== 'conflict' || orderChoice === 'skip') return false;
  return !row.orderCandidates?.find(order => order.id === orderChoice)?.drawingLibraryItemId;
}
