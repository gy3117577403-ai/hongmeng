import type { Prisma } from '@prisma/client';

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
  const activeOriginalFiles = await tx.drawingLibraryFile.count({
    where: {
      libraryItemId: drawingLibraryItemId,
      deletedAt: null,
      category: { code: 'drawing' },
    },
  });
  if (activeOriginalFiles === 0) return 0;

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
  return result.count;
}
