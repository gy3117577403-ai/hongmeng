import type { Prisma } from '@prisma/client';
import { drawingLibraryKey } from '@/lib/drawing-library';

export type PlanningProductLinkOrder = {
  id: string;
  drawingLibraryItemId: string | null;
  customerName: string;
  specification: string;
};

export type PlanningProductLinkItem = {
  id: string;
  libraryKey: string;
  customerName: string;
  specification: string;
  drawingFileCount: number;
};

export type PlanningProductLinkResult = {
  checkedOrders: number;
  linkedOrders: number;
  unchangedOrders: number;
  unresolvedOrders: number;
};

export function normalizePlanningProductText(value: string): string {
  return value
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('zh-CN');
}

export function planningProductIdentity(customerName: string, specification: string): string {
  return `${normalizePlanningProductText(customerName)}::${normalizePlanningProductText(specification)}`;
}

type PlanningProductLinkExactFieldMatch = {
  first: PlanningProductLinkItem;
  count: number;
};

type PlanningProductLinkIdentityMatches = {
  first: PlanningProductLinkItem;
  count: number;
  firstDrawingMatch: PlanningProductLinkItem | null;
  drawingMatchCount: number;
  firstByLibraryKey: Map<string, PlanningProductLinkItem>;
  exactFields: Map<string, Map<string, PlanningProductLinkExactFieldMatch>>;
  firstById: Map<string, PlanningProductLinkItem>;
};

export class PlanningProductLinkItemIndex {
  private readonly matchesByIdentity = new Map<string, PlanningProductLinkIdentityMatches>();
  private readonly firstById = new Map<string, PlanningProductLinkItem>();

  constructor(items: readonly PlanningProductLinkItem[]) {
    for (const item of items) {
      const identity = planningProductIdentity(item.customerName, item.specification);
      let matches = this.matchesByIdentity.get(identity);
      if (!matches) {
        matches = {
          first: item,
          count: 0,
          firstDrawingMatch: null,
          drawingMatchCount: 0,
          firstByLibraryKey: new Map(),
          exactFields: new Map(),
          firstById: new Map(),
        };
        this.matchesByIdentity.set(identity, matches);
      }

      matches.count += 1;
      if (item.drawingFileCount > 0) {
        matches.drawingMatchCount += 1;
        matches.firstDrawingMatch ||= item;
      }
      if (!matches.firstByLibraryKey.has(item.libraryKey)) {
        matches.firstByLibraryKey.set(item.libraryKey, item);
      }
      if (!matches.firstById.has(item.id)) matches.firstById.set(item.id, item);
      if (!this.firstById.has(item.id)) this.firstById.set(item.id, item);

      let specifications = matches.exactFields.get(item.customerName);
      if (!specifications) {
        specifications = new Map();
        matches.exactFields.set(item.customerName, specifications);
      }
      const exactFields = specifications.get(item.specification);
      if (exactFields) exactFields.count += 1;
      else specifications.set(item.specification, { first: item, count: 1 });
    }
  }

  selectCanonicalDrawingItem(
    order: Pick<PlanningProductLinkOrder, 'drawingLibraryItemId' | 'customerName' | 'specification'>,
  ): PlanningProductLinkItem | null {
    const identity = planningProductIdentity(order.customerName, order.specification);
    const matches = this.matchesByIdentity.get(identity);
    if (!matches) return null;
    if (matches.count === 1) return matches.first;

    const expectedKey = drawingLibraryKey(order.customerName, order.specification);
    const exactKey = matches.firstByLibraryKey.get(expectedKey) || null;
    if (
      matches.drawingMatchCount === 1
      && matches.firstDrawingMatch
      && (!exactKey || exactKey.drawingFileCount === 0)
    ) {
      return matches.firstDrawingMatch;
    }
    if (exactKey) return exactKey;

    const exactFields = matches.exactFields
      .get(order.customerName)
      ?.get(order.specification);
    if (exactFields?.count === 1) return exactFields.first;

    return order.drawingLibraryItemId === null
      ? null
      : matches.firstById.get(order.drawingLibraryItemId) || null;
  }

  findItemById(id: string): PlanningProductLinkItem | null {
    return this.firstById.get(id) || null;
  }
}

export function selectCanonicalDrawingItem(
  order: Pick<PlanningProductLinkOrder, 'drawingLibraryItemId' | 'customerName' | 'specification'>,
  items: PlanningProductLinkItem[],
): PlanningProductLinkItem | null {
  return new PlanningProductLinkItemIndex(items).selectCanonicalDrawingItem(order);
}

export async function reconcileProductionPlanDrawingLinks(
  tx: Prisma.TransactionClient,
  options: { drawingLibraryItemId?: string } = {},
): Promise<PlanningProductLinkResult> {
  const targetItem = options.drawingLibraryItemId
    ? await tx.drawingLibraryItem.findFirst({
        where: { id: options.drawingLibraryItemId, deletedAt: null },
        select: { id: true, customerName: true, specification: true },
      })
    : null;
  if (options.drawingLibraryItemId && !targetItem) {
    return { checkedOrders: 0, linkedOrders: 0, unchangedOrders: 0, unresolvedOrders: 0 };
  }

  const [orders, rawItems] = await Promise.all([
    tx.productionPlanOrder.findMany({
      where: {
        deletedAt: null,
        ...(targetItem
          ? {
              OR: [
                { drawingLibraryItemId: targetItem.id },
                { specification: { equals: targetItem.specification, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      select: { id: true, drawingLibraryItemId: true, customerName: true, specification: true },
      take: 5000,
    }),
    tx.drawingLibraryItem.findMany({
      where: {
        deletedAt: null,
        ...(targetItem
          ? {
              OR: [
                { id: targetItem.id },
                { specification: { equals: targetItem.specification, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        libraryKey: true,
        customerName: true,
        specification: true,
        _count: {
          select: {
            files: {
              where: { deletedAt: null, isCurrent: true, category: { code: 'drawing' } },
            },
          },
        },
      },
      take: 5000,
    }),
  ]);
  const items: PlanningProductLinkItem[] = rawItems.map(item => ({
    id: item.id,
    libraryKey: item.libraryKey,
    customerName: item.customerName,
    specification: item.specification,
    drawingFileCount: item._count.files,
  }));
  const itemIndex = new PlanningProductLinkItemIndex(items);

  let linkedOrders = 0;
  let unchangedOrders = 0;
  let unresolvedOrders = 0;
  const canonicalByPlanOrderId = new Map<string, PlanningProductLinkItem>();
  for (const order of orders) {
    const canonical = itemIndex.selectCanonicalDrawingItem(order);
    if (!canonical) {
      unresolvedOrders += 1;
      continue;
    }
    canonicalByPlanOrderId.set(order.id, canonical);
    if (canonical.id === order.drawingLibraryItemId) {
      unchangedOrders += 1;
      continue;
    }
    await tx.productionPlanOrder.update({
      where: { id: order.id },
      data: { drawingLibraryItemId: canonical.id },
    });
    linkedOrders += 1;
  }

  const matchedPlanOrderIds = [...canonicalByPlanOrderId.keys()];
  if (matchedPlanOrderIds.length > 0) {
    const batches = await tx.productionPlanBatch.findMany({
      where: {
        deletedAt: null,
        planOrderId: { in: matchedPlanOrderIds },
        workOrderId: { not: null },
      },
      select: { planOrderId: true, workOrderId: true },
      take: 10_000,
    });
    const workOrderIdsByDrawingItemId = new Map<string, Set<string>>();
    for (const batch of batches) {
      if (!batch.workOrderId) continue;
      const canonical = canonicalByPlanOrderId.get(batch.planOrderId);
      if (!canonical) continue;
      const workOrderIds = workOrderIdsByDrawingItemId.get(canonical.id) || new Set<string>();
      workOrderIds.add(batch.workOrderId);
      workOrderIdsByDrawingItemId.set(canonical.id, workOrderIds);
    }

    const now = new Date();
    for (const [drawingLibraryItemId, workOrderIdSet] of workOrderIdsByDrawingItemId) {
      const workOrderIds = [...workOrderIdSet];
      if (!workOrderIds.length) continue;
      await tx.workOrder.updateMany({
        where: { id: { in: workOrderIds }, deletedAt: null },
        data: { drawingLibraryItemId },
      });
      const canonical = itemIndex.findItemById(drawingLibraryItemId);
      if (!canonical?.drawingFileCount) continue;
      await tx.workOrder.updateMany({
        where: {
          id: { in: workOrderIds },
          deletedAt: null,
          OR: [
            { drawingStatus: null },
            { drawingStatus: '' },
            { drawingStatus: '-' },
            { drawingStatus: { contains: '未设置' } },
            { drawingStatus: { contains: '未发' } },
            { drawingStatus: { contains: '待发' } },
            { drawingStatus: { contains: '未下发' } },
          ],
        },
        data: { drawingStatus: '已发', drawingIssuedAt: now },
      });
    }
  }

  return { checkedOrders: orders.length, linkedOrders, unchangedOrders, unresolvedOrders };
}
