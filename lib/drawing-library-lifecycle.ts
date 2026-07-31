import type { Prisma } from '@prisma/client';

export const DRAWING_LIBRARY_MASTER_IMMUTABLE_CODE = 'DRAWING_LIBRARY_MASTER_IMMUTABLE';
export const DRAWING_LIBRARY_MASTER_IMMUTABLE_MESSAGE = '产品资料主档为长期业务标识，不允许删除；请删除或替换主档下的具体文件。';

export type DrawingLibraryReferenceImpact = {
  linkedPlanOrders: number;
  activePlanOrders: number;
  activePlanBatches: number;
  linkedWorkOrders: number;
  activeWorkOrders: number;
  activeFiles: number;
  activeOriginalFiles: number;
  productTimeProfiles: number;
  blocked: boolean;
  blockers: string[];
};

type DrawingLibraryLifecycleClient = Pick<
  Prisma.TransactionClient,
  'productionPlanOrder' | 'productionPlanBatch' | 'workOrder' | 'drawingLibraryFile' | 'productTimeProfile'
>;

export function drawingLibraryDeletionBlockers(
  impact: Pick<DrawingLibraryReferenceImpact, 'activePlanOrders' | 'activePlanBatches' | 'activeWorkOrders'>,
): string[] {
  const blockers: string[] = [];
  if (impact.activePlanOrders > 0) blockers.push(`${impact.activePlanOrders} 条活动计划仍在使用`);
  if (impact.activePlanBatches > 0) blockers.push(`${impact.activePlanBatches} 个活动批次仍在使用`);
  if (impact.activeWorkOrders > 0) blockers.push(`${impact.activeWorkOrders} 张未完成生产工单仍在使用`);
  return blockers;
}

export function activeDrawingLibraryFileCount(input: {
  deletedAt?: Date | string | null;
  drawingFileCount: number;
}): number {
  return input.deletedAt ? 0 : input.drawingFileCount;
}

export async function getDrawingLibraryReferenceImpact(
  tx: DrawingLibraryLifecycleClient,
  drawingLibraryItemId: string,
): Promise<DrawingLibraryReferenceImpact> {
  const [
    linkedPlanOrders,
    activePlanOrders,
    activePlanBatches,
    linkedWorkOrders,
    activeWorkOrders,
    activeFiles,
    activeOriginalFiles,
    productTimeProfiles,
  ] = await Promise.all([
    tx.productionPlanOrder.count({
      where: { drawingLibraryItemId, deletedAt: null },
    }),
    tx.productionPlanOrder.count({
      where: {
        drawingLibraryItemId,
        deletedAt: null,
        status: { notIn: ['completed', 'cancelled'] },
      },
    }),
    tx.productionPlanBatch.count({
      where: {
        deletedAt: null,
        releaseState: { not: 'archived' },
        planOrder: { drawingLibraryItemId, deletedAt: null },
      },
    }),
    tx.workOrder.count({
      where: { drawingLibraryItemId, deletedAt: null },
    }),
    tx.workOrder.count({
      where: {
        drawingLibraryItemId,
        deletedAt: null,
        completedAt: null,
        planActive: true,
        status: { notIn: ['completed', 'cancelled', 'archived'] },
      },
    }),
    tx.drawingLibraryFile.count({
      where: { libraryItemId: drawingLibraryItemId, deletedAt: null },
    }),
    tx.drawingLibraryFile.count({
      where: {
        libraryItemId: drawingLibraryItemId,
        deletedAt: null,
        category: { code: 'drawing' },
      },
    }),
    tx.productTimeProfile.count({
      where: { drawingLibraryItemId },
    }),
  ]);

  const blockers = drawingLibraryDeletionBlockers({ activePlanOrders, activePlanBatches, activeWorkOrders });
  return {
    linkedPlanOrders,
    activePlanOrders,
    activePlanBatches,
    linkedWorkOrders,
    activeWorkOrders,
    activeFiles,
    activeOriginalFiles,
    productTimeProfiles,
    blocked: blockers.length > 0,
    blockers,
  };
}

export async function refreshRestoredDrawingWorkOrders(
  tx: Pick<Prisma.TransactionClient, 'drawingLibraryFile' | 'workOrder'>,
  drawingLibraryItemId: string,
): Promise<number> {
  const result = await synchronizeDrawingLibraryWorkOrderStatus(tx, drawingLibraryItemId);
  return result.refreshedWorkOrders;
}

export type DrawingLibraryWorkOrderSyncResult = {
  activeOriginalFiles: number;
  drawingReady: boolean;
  refreshedWorkOrders: number;
};

/**
 * Active original-drawing files are the source of truth for drawing readiness.
 * Only statuses managed automatically by the drawing library are rewritten;
 * explicit business holds such as sample/customer/change/rework are preserved.
 */
export async function synchronizeDrawingLibraryWorkOrderStatus(
  tx: Pick<Prisma.TransactionClient, 'drawingLibraryFile' | 'workOrder'>,
  drawingLibraryItemId: string,
): Promise<DrawingLibraryWorkOrderSyncResult> {
  const activeOriginalFiles = await tx.drawingLibraryFile.count({
    where: {
      libraryItemId: drawingLibraryItemId,
      deletedAt: null,
      category: { code: 'drawing' },
    },
  });

  if (activeOriginalFiles === 0) {
    const result = await tx.workOrder.updateMany({
      where: {
        drawingLibraryItemId,
        deletedAt: null,
        drawingStatus: { in: ['已发', '已确认', '已下发'] },
      },
      data: { drawingStatus: '待发', drawingIssuedAt: null },
    });
    return {
      activeOriginalFiles,
      drawingReady: false,
      refreshedWorkOrders: result.count,
    };
  }

  const result = await tx.workOrder.updateMany({
    where: {
      drawingLibraryItemId,
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
    data: { drawingStatus: '已发', drawingIssuedAt: new Date() },
  });
  return {
    activeOriginalFiles,
    drawingReady: true,
    refreshedWorkOrders: result.count,
  };
}
