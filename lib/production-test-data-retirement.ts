import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { chinaDateKey } from '@/lib/china-date';
import { productionBatchWeekStartWindow } from '@/lib/production-week';

export const TEST_RETIREMENT_WEEKS = ['2026-07-20', '2026-07-27'] as const;
export const TEST_RETIREMENT_CONFIRMATION = '删除测试订单但保留产品资料';

export class ProductionTestRetirementError extends Error {
  constructor(message: string, public code: string, public status = 400) {
    super(message);
  }
}

function weekWhere() {
  return {
    OR: TEST_RETIREMENT_WEEKS.map(week => {
      const range = productionBatchWeekStartWindow(week);
      return { weekStartDate: { gte: range.gte, lt: range.lt } };
    }),
  };
}

async function previewWithClient(tx: Prisma.TransactionClient | typeof prisma) {
  const [batches, standaloneWorkOrders] = await Promise.all([
    tx.productionPlanBatch.findMany({
      where: { deletedAt: null, planOrder: { deletedAt: null }, ...weekWhere() },
      select: {
        id: true,
        updatedAt: true,
        planOrderId: true,
        workOrderId: true,
        quantity: true,
        weekStartDate: true,
        releaseState: true,
        planOrder: {
          select: {
            specification: true,
            drawingLibraryItemId: true,
            drawingLibraryItem: {
              select: {
                id: true,
                _count: { select: { files: true, productTimeProfiles: true } },
              },
            },
          },
        },
        workOrder: {
          select: {
            id: true,
            code: true,
            stage: true,
            completedAt: true,
            _count: {
              select: {
                resourceFiles: true,
                progressLogs: true,
                dailyProcessTasks: true,
                dailyShipmentItems: true,
              },
            },
          },
        },
      },
      orderBy: [{ weekStartDate: 'asc' }, { createdAt: 'asc' }],
    }),
    tx.workOrder.findMany({
      where: {
        deletedAt: null,
        productionPlanBatch: null,
        parentWorkOrderId: null,
        ...weekWhere(),
      },
      select: { id: true, code: true, updatedAt: true, weekStartDate: true, stage: true, completedAt: true },
      orderBy: [{ weekStartDate: 'asc' }, { createdAt: 'asc' }],
    }),
  ]);
  const fingerprint = createHash('sha256').update(JSON.stringify({
    batches: batches.map(batch => [batch.id, batch.updatedAt.toISOString(), batch.workOrderId]),
    standalone: standaloneWorkOrders.map(order => [order.id, order.updatedAt.toISOString()]),
  })).digest('hex');
  const drawingItemIds = new Set(batches.map(batch => batch.planOrder.drawingLibraryItemId).filter(Boolean));
  return {
    weeks: [...TEST_RETIREMENT_WEEKS],
    fingerprint,
    batchCount: batches.length,
    workOrderCount: new Set([
      ...batches.map(batch => batch.workOrderId).filter((id): id is string => Boolean(id)),
      ...standaloneWorkOrders.map(order => order.id),
    ]).size,
    completedWorkOrderCount: batches.filter(batch => Boolean(batch.workOrder?.completedAt)).length
      + standaloneWorkOrders.filter(order => Boolean(order.completedAt)).length,
    startedOrLedgerCount: batches.filter(batch => Boolean(
      batch.workOrder
      && (
        batch.workOrder.stage !== 'not_issued'
        || batch.workOrder._count.progressLogs
        || batch.workOrder._count.dailyProcessTasks
        || batch.workOrder._count.dailyShipmentItems
      )
    )).length,
    totalQuantity: batches.reduce((sum, batch) => sum + batch.quantity, 0),
    drawingLibraryItemCount: drawingItemIds.size,
    drawingLibraryFileCount: batches.reduce((sum, batch) => sum + (batch.planOrder.drawingLibraryItem?._count.files || 0), 0),
    productTimeProfileCount: batches.reduce((sum, batch) => sum + (batch.planOrder.drawingLibraryItem?._count.productTimeProfiles || 0), 0),
    workOrderResourceFileCount: batches.reduce((sum, batch) => sum + (batch.workOrder?._count.resourceFiles || 0), 0),
    preservation: {
      drawingLibraryItems: true,
      drawingLibraryFiles: true,
      productTimeProfiles: true,
      objectStorageFiles: true,
      processAndProgressLedgers: true,
      warehouseAndShipmentAudit: true,
    },
    items: batches.map(batch => ({
      batchId: batch.id,
      workOrderId: batch.workOrderId,
      code: batch.workOrder?.code || batch.planOrder.specification,
      specification: batch.planOrder.specification,
      weekStartDate: chinaDateKey(batch.weekStartDate),
      quantity: batch.quantity,
      releaseState: batch.releaseState,
      status: batch.workOrder?.completedAt ? 'completed' : batch.workOrder ? 'linked' : 'draft',
    })),
    standaloneItems: standaloneWorkOrders.map(order => ({
      workOrderId: order.id,
      code: order.code,
      weekStartDate: order.weekStartDate ? chinaDateKey(order.weekStartDate) : null,
      status: order.completedAt ? 'completed' : order.stage,
    })),
  };
}

export async function previewProductionTestDataRetirement() {
  return previewWithClient(prisma);
}

export async function previewProductionTestDataRetirementInTransaction(tx: Prisma.TransactionClient) {
  return previewWithClient(tx);
}

export async function retireProductionTestDataInTransaction(tx: Prisma.TransactionClient, input: {
  actorId: string;
  fingerprint: string;
}) {
  const preview = await previewWithClient(tx);
  if (!input.fingerprint || input.fingerprint !== preview.fingerprint) {
    throw new ProductionTestRetirementError('测试订单范围已经变化，请重新预检', 'TEST_RETIREMENT_STALE', 409);
  }
  const now = new Date();
  const batchIds = preview.items.map(item => item.batchId);
  const rootWorkOrderIds = [
    ...preview.items.map(item => item.workOrderId).filter((id): id is string => Boolean(id)),
    ...preview.standaloneItems.map(item => item.workOrderId),
  ];
  const branchIds = rootWorkOrderIds.length
    ? (await tx.workOrder.findMany({
        where: {
          deletedAt: null,
          OR: [
            { parentWorkOrderId: { in: rootWorkOrderIds } },
            { rootWorkOrderId: { in: rootWorkOrderIds } },
          ],
        },
        select: { id: true },
      })).map(item => item.id)
    : [];
  const allWorkOrderIds = [...new Set([...rootWorkOrderIds, ...branchIds])];

  if (batchIds.length) {
    await tx.productionCarryover.updateMany({
      where: { productionPlanBatchId: { in: batchIds }, status: 'ACTIVE' },
      data: { status: 'DISMISSED', dismissedAt: now, reason: '测试周订单已安全退役' },
    });
    await tx.productionPlanBatch.updateMany({
      where: { id: { in: batchIds }, deletedAt: null },
      data: { deletedAt: now },
    });
  }
  if (allWorkOrderIds.length) {
    await tx.workOrder.updateMany({
      where: { id: { in: allWorkOrderIds }, deletedAt: null },
      data: {
        deletedAt: now,
        planActive: false,
        planClearedAt: now,
        planClearedBy: '测试数据安全退役',
      },
    });
  }
  const affectedPlanOrders = batchIds.length
    ? await tx.productionPlanBatch.findMany({
        where: { id: { in: batchIds } },
        select: { planOrderId: true },
      })
    : [];
  const affectedPlanOrderIds = [...new Set(affectedPlanOrders.map(item => item.planOrderId))];
  let retiredPlanOrderCount = 0;
  if (affectedPlanOrderIds.length) {
    retiredPlanOrderCount = (await tx.productionPlanOrder.updateMany({
      where: {
        id: { in: affectedPlanOrderIds },
        deletedAt: null,
        batches: { none: { deletedAt: null } },
      },
      data: { deletedAt: now },
    })).count;
  }
  await tx.operationLog.create({
    data: {
      userId: input.actorId,
      action: 'retire_production_test_weeks',
      targetType: 'production_plan_week_range',
      targetId: '2026-07-20..2026-08-02',
      detail: {
        batchCount: batchIds.length,
        workOrderCount: allWorkOrderIds.length,
        planOrderCount: retiredPlanOrderCount,
        fingerprint: preview.fingerprint,
        preservation: preview.preservation,
      },
    },
  });
  return {
    retiredBatchCount: batchIds.length,
    retiredWorkOrderCount: allWorkOrderIds.length,
    retiredPlanOrderCount,
    preservation: preview.preservation,
  };
}

export async function retireProductionTestData(input: {
  actorId: string;
  fingerprint: string;
}) {
  return prisma.$transaction(tx => retireProductionTestDataInTransaction(tx, input), { timeout: 60_000 });
}
