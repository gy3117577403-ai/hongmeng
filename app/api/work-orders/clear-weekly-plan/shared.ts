import type { Prisma } from '@prisma/client';
import { parseWeekStartDate } from '@/lib/work-order-import';
import { prisma } from '@/lib/prisma';

export type WeeklyPlanClearSummary = {
  weekStartDate: string;
  weekEndDate: string;
  workOrderCount: number;
  workOrdersWithFiles: number;
  fileCount: number;
  connectorParameterCount: number;
};

export function addDays(date: Date, days: number) {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export function ymd(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function parseClearWeek(value: unknown) {
  const parsed = parseWeekStartDate(String(value || '').trim());
  if (!parsed || Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

export function weeklyPlanWhere(weekStartDate: Date): Prisma.WorkOrderWhereInput {
  return {
    deletedAt: null,
    planType: 'weekly_plan',
    planActive: true,
    weekStartDate: {
      gte: weekStartDate,
      lt: addDays(weekStartDate, 1),
    },
  };
}

export async function summarizeWeeklyPlanClear(weekStartDate: Date): Promise<WeeklyPlanClearSummary> {
  const workOrders = await prisma.workOrder.findMany({
    where: weeklyPlanWhere(weekStartDate),
    select: {
      id: true,
      resourceFiles: {
        where: { deletedAt: null, status: 'uploaded' },
        select: { id: true },
      },
    },
  });
  const fileCount = workOrders.reduce((sum, order) => sum + order.resourceFiles.length, 0);
  const connectorParameterCount = await prisma.connectorParameter.count({ where: { deletedAt: null } });
  return {
    weekStartDate: ymd(weekStartDate),
    weekEndDate: ymd(addDays(weekStartDate, 6)),
    workOrderCount: workOrders.length,
    workOrdersWithFiles: workOrders.filter(order => order.resourceFiles.length > 0).length,
    fileCount,
    connectorParameterCount,
  };
}
