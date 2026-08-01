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

export function selectCanonicalDrawingItem(
  order: Pick<PlanningProductLinkOrder, 'drawingLibraryItemId' | 'customerName' | 'specification'>,
  items: PlanningProductLinkItem[],
): PlanningProductLinkItem | null {
  const identity = planningProductIdentity(order.customerName, order.specification);
  const matches = items.filter(item => planningProductIdentity(item.customerName, item.specification) === identity);
  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0];

  const withDrawing = matches.filter(item => item.drawingFileCount > 0);
  const expectedKey = drawingLibraryKey(order.customerName, order.specification);
  const exactKey = matches.find(item => item.libraryKey === expectedKey) || null;
  if (withDrawing.length === 1 && (!exactKey || exactKey.drawingFileCount === 0)) return withDrawing[0];
  if (exactKey) return exactKey;

  const exactFields = matches.filter(item => (
    item.customerName === order.customerName && item.specification === order.specification
  ));
  if (exactFields.length === 1) return exactFields[0];

  return matches.find(item => item.id === order.drawingLibraryItemId) || null;
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

  let linkedOrders = 0;
  let unchangedOrders = 0;
  let unresolvedOrders = 0;
  const canonicalByPlanOrderId = new Map<string, PlanningProductLinkItem>();
  for (const order of orders) {
    const canonical = selectCanonicalDrawingItem(order, items);
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
      const canonical = items.find(item => item.id === drawingLibraryItemId);
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
