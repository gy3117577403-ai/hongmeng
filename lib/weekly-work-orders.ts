import type { Prisma } from '@prisma/client';
import { parseWeekStartDate } from '@/lib/work-order-import';
import { prisma } from '@/lib/prisma';

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
  fileCount: number;
  activatedCount?: number;
  archivedCount?: number;
};

export function addDays(date: Date, days: number) {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export function ymd(date: Date) {
  return date.toISOString().slice(0, 10);
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

function countAnomalies(
  orders: Array<{ customerName: string | null; productName: string | null; specification: string | null; code: string | null }>,
) {
  return orders.filter(order => !order.customerName?.trim() || !order.productName?.trim() || !(order.specification?.trim() || order.code?.trim())).length;
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
  const [categories, currentOrders, nextOrders] = await Promise.all([
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
        code: true,
        customerName: true,
        productName: true,
        specification: true,
        resourceFiles: { where: { deletedAt: null, status: 'uploaded' }, select: { id: true, categoryId: true } },
      },
    }),
  ]);

  const fileCount = nextOrders.reduce((sum, order) => sum + order.resourceFiles.length, 0);
  return {
    weekStartDate: ymd(weekStartDate),
    weekEndDate: ymd(addDays(weekStartDate, 6)),
    currentArchiveCount: currentOrders.length,
    nextActivateCount: nextOrders.length,
    missingWorkOrders: countMissingWorkOrders(categories, nextOrders),
    anomalyCount: countAnomalies(nextOrders),
    fileCount,
  };
}
