import type { Prisma } from '@prisma/client';
import { chinaDateKey } from '@/lib/china-date';
import { parseWeekStartDate } from '@/lib/work-order-import';
import { prisma } from '@/lib/prisma';
import { loadWeeklyPlanDiff } from '@/lib/weekly-plan-diff';

const REQUIRED_CATEGORY_CODES = new Set(['drawing', 'sop', 'product']);

export type WeeklyCloseSummary = {
  weekStartDate: string;
  weekEndDate: string;
  workOrderCount: number;
  workOrdersWithFiles: number;
  missingWorkOrders: number;
  fileCount: number;
  archiveCount: number;
  drawingLibraryItemCount: number;
  drawingLibraryFileCount: number;
  connectorParameterCount: number;
  willDeleteResourceFiles: 0;
  willDeleteDrawingLibraryItems: 0;
  willDeleteConnectorParameters: 0;
  clearedCount?: number;
};

export type WeeklyActivateSummary = {
  weekStartDate: string;
  weekEndDate: string;
  currentArchiveCount: number;
  nextActivateCount: number;
  missingWorkOrders: number;
  anomalyCount: number;
  newCount: number;
  continuedCount: number;
  changedCount: number;
  removedCount: number;
  duplicateCount: number;
  invalidCount: number;
  blockingAnomalyCount: number;
  warningCount: number;
  drawingWithFilesCount: number;
  drawingWithoutFilesCount: number;
  missingProductTimeProfiles: number;
  fileCount: number;
  activatedCount?: number;
  archivedCount?: number;
};

type WeeklyProductTimeOrder = {
  drawingLibraryItem: {
    productTimeProfiles: Array<{ entries: Array<{ id: string }> }>;
  } | null;
};

export function addDays(date: Date, days: number) {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export function ymd(date: Date) {
  return chinaDateKey(date);
}

export function parseWeek(value: unknown) {
  const parsed = parseWeekStartDate(String(value || '').trim());
  if (!parsed || Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function sameWeekDateWhere(weekStartDate: Date) {
  return {
    gte: weekStartDate,
    lt: addDays(weekStartDate, 1),
  };
}

export function activeWeeklyWhere(weekStartDate?: Date): Prisma.WorkOrderWhereInput {
  return {
    deletedAt: null,
    planType: 'weekly_plan',
    planActive: true,
    ...(weekStartDate ? { weekStartDate: sameWeekDateWhere(weekStartDate) } : {}),
  };
}

export function draftWeeklyWhere(weekStartDate: Date): Prisma.WorkOrderWhereInput {
  return {
    deletedAt: null,
    planType: 'weekly_plan',
    planActive: false,
    planClearedAt: null,
    weekStartDate: sameWeekDateWhere(weekStartDate),
  };
}

function countMissingWorkOrders(
  categories: Array<{ id: string; code: string }>,
  orders: Array<{ resourceFiles: Array<{ categoryId: string }> }>,
) {
  const requiredIds = categories.filter(category => REQUIRED_CATEGORY_CODES.has(category.code)).map(category => category.id);
  return orders.filter(order => requiredIds.some(id => !order.resourceFiles.some(file => file.categoryId === id))).length;
}

export function countWeeklyOrdersMissingPublishedProductTime(orders: WeeklyProductTimeOrder[]): number {
  return orders.filter(order => {
    const profile = order.drawingLibraryItem?.productTimeProfiles[0];
    return !profile || profile.entries.length === 0;
  }).length;
}

export async function summarizeWeeklyClose(weekStartDate: Date): Promise<WeeklyCloseSummary> {
  const [categories, workOrders, drawingLibraryItemCount, drawingLibraryFileCount, connectorParameterCount] = await Promise.all([
    prisma.resourceCategory.findMany({ select: { id: true, code: true } }),
    prisma.workOrder.findMany({
      where: activeWeeklyWhere(weekStartDate),
      select: {
        id: true,
        resourceFiles: {
          where: { deletedAt: null, status: 'uploaded' },
          select: { id: true, categoryId: true },
        },
      },
    }),
    prisma.drawingLibraryItem.count({ where: { deletedAt: null } }),
    prisma.drawingLibraryFile.count({ where: { deletedAt: null } }),
    prisma.connectorParameter.count({ where: { deletedAt: null } }),
  ]);

  const fileCount = workOrders.reduce((sum, order) => sum + order.resourceFiles.length, 0);
  return {
    weekStartDate: ymd(weekStartDate),
    weekEndDate: ymd(addDays(weekStartDate, 6)),
    workOrderCount: workOrders.length,
    workOrdersWithFiles: workOrders.filter(order => order.resourceFiles.length > 0).length,
    missingWorkOrders: countMissingWorkOrders(categories, workOrders),
    fileCount,
    archiveCount: workOrders.length,
    drawingLibraryItemCount,
    drawingLibraryFileCount,
    connectorParameterCount,
    willDeleteResourceFiles: 0,
    willDeleteDrawingLibraryItems: 0,
    willDeleteConnectorParameters: 0,
  };
}

export async function summarizeWeeklyActivateNext(weekStartDate: Date): Promise<WeeklyActivateSummary> {
  const [categories, currentOrders, nextOrders, diff] = await Promise.all([
    prisma.resourceCategory.findMany({ select: { id: true, code: true } }),
    prisma.workOrder.findMany({
      where: activeWeeklyWhere(),
      select: {
        id: true,
        resourceFiles: { where: { deletedAt: null, status: 'uploaded' }, select: { id: true, categoryId: true } },
      },
    }),
    prisma.workOrder.findMany({
      where: draftWeeklyWhere(weekStartDate),
      select: {
        id: true,
        resourceFiles: { where: { deletedAt: null, status: 'uploaded' }, select: { id: true, categoryId: true } },
        drawingLibraryItem: {
          select: {
            productTimeProfiles: {
              where: { status: 'published' },
              orderBy: { version: 'desc' },
              take: 1,
              select: { entries: { select: { id: true } } },
            },
          },
        },
      },
    }),
    loadWeeklyPlanDiff({ nextWeekStart: weekStartDate }),
  ]);

  const fileCount = nextOrders.reduce((sum, order) => sum + order.resourceFiles.length, 0);
  return {
    weekStartDate: ymd(weekStartDate),
    weekEndDate: ymd(addDays(weekStartDate, 6)),
    currentArchiveCount: currentOrders.length,
    nextActivateCount: nextOrders.length,
    missingWorkOrders: countMissingWorkOrders(categories, nextOrders),
    anomalyCount: diff.summary.blockingAnomalyCount,
    newCount: diff.summary.newCount,
    continuedCount: diff.summary.continuedCount,
    changedCount: diff.summary.changedCount,
    removedCount: diff.summary.removedCount,
    duplicateCount: diff.summary.duplicateCount,
    invalidCount: diff.summary.invalidCount,
    blockingAnomalyCount: diff.summary.blockingAnomalyCount,
    warningCount: diff.summary.warningCount,
    drawingWithFilesCount: diff.summary.drawingWithFilesCount,
    drawingWithoutFilesCount: diff.summary.drawingWithoutFilesCount,
    missingProductTimeProfiles: countWeeklyOrdersMissingPublishedProductTime(nextOrders),
    fileCount,
  };
}
