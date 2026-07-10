import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
  compareWeeklyPlans,
  type WeeklyPlanDiffItem,
  type WeeklyPlanDiffSummary,
} from '@/lib/weekly-plan-diff-core';

export * from '@/lib/weekly-plan-diff-core';

const weeklyPlanDiffOrderSelect = {
  id: true,
  code: true,
  customerName: true,
  productName: true,
  specification: true,
  processName: true,
  sourceOrderNo: true,
  uncompletedQty: true,
  unitWorkHours: true,
  totalWorkHours: true,
  drawingStatus: true,
  deliveryDay: true,
  plannedAt: true,
  materialStatus: true,
  salesperson: true,
  remark: true,
  weekStartDate: true,
  weekEndDate: true,
  importBatchId: true,
  drawingLibraryItemId: true,
  drawingLibraryItem: {
    select: {
      id: true,
      deletedAt: true,
      files: {
        where: { deletedAt: null },
        select: { categoryId: true },
      },
    },
  },
} satisfies Prisma.WorkOrderSelect;

type WeeklyPlanDiffOrderRecord = Prisma.WorkOrderGetPayload<{ select: typeof weeklyPlanDiffOrderSelect }>;

export type WeeklyPlanWeekMeta = {
  weekStartDate: string | null;
  weekEndDate: string | null;
  importBatchIds: string[];
  count: number;
};

export type WeeklyPlanDiffResult = {
  currentWeek: WeeklyPlanWeekMeta;
  nextWeek: WeeklyPlanWeekMeta;
  summary: WeeklyPlanDiffSummary;
  items: WeeklyPlanDiffItem[];
};

export type WeeklyPlanDiffQuery = {
  currentWeekStart?: Date | null;
  nextWeekStart?: Date | null;
  currentBatchId?: string | null;
  nextBatchId?: string | null;
};

function addDays(date: Date, days: number) {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function dayRange(date: Date) {
  return { gte: date, lt: addDays(date, 1) };
}

function ymd(value?: Date | null) {
  return value && !Number.isNaN(value.getTime()) ? value.toISOString().slice(0, 10) : null;
}

async function resolveCurrentWeekStart(query: WeeklyPlanDiffQuery) {
  if (query.currentWeekStart) return query.currentWeekStart;
  const match = await prisma.workOrder.findFirst({
    where: {
      deletedAt: null,
      planType: 'weekly_plan',
      ...(query.currentBatchId
        ? { importBatchId: query.currentBatchId }
        : { planActive: true }),
      weekStartDate: { not: null },
    },
    orderBy: { weekStartDate: 'desc' },
    select: { weekStartDate: true },
  });
  return match?.weekStartDate || null;
}

async function resolveNextWeekStart(query: WeeklyPlanDiffQuery, currentWeekStart: Date | null) {
  if (query.nextWeekStart) return query.nextWeekStart;
  const baseWhere: Prisma.WorkOrderWhereInput = {
    deletedAt: null,
    planType: 'weekly_plan',
    ...(query.nextBatchId
      ? { importBatchId: query.nextBatchId }
      : { planActive: false, planClearedAt: null }),
    weekStartDate: { not: null, ...(currentWeekStart ? { gt: currentWeekStart } : {}) },
  };
  let match = await prisma.workOrder.findFirst({
    where: baseWhere,
    orderBy: { weekStartDate: 'asc' },
    select: { weekStartDate: true },
  });
  if (!match && currentWeekStart && !query.nextBatchId) {
    match = await prisma.workOrder.findFirst({
      where: {
        deletedAt: null,
        planType: 'weekly_plan',
        planActive: false,
        planClearedAt: null,
        weekStartDate: { not: null },
      },
      orderBy: { weekStartDate: 'asc' },
      select: { weekStartDate: true },
    });
  }
  return match?.weekStartDate || null;
}

function weeklyOrdersWhere(
  kind: 'current' | 'next',
  weekStartDate: Date | null,
  importBatchId?: string | null,
): Prisma.WorkOrderWhereInput {
  return {
    deletedAt: null,
    planType: 'weekly_plan',
    ...(importBatchId
      ? { importBatchId }
      : kind === 'current'
        ? { planActive: true }
        : { planActive: false, planClearedAt: null }),
    ...(importBatchId ? {} : weekStartDate ? { weekStartDate: dayRange(weekStartDate) } : { id: '__no_week_selected__' }),
  };
}

function weekMeta(orders: WeeklyPlanDiffOrderRecord[], resolvedStart: Date | null): WeeklyPlanWeekMeta {
  const first = orders[0];
  const start = resolvedStart || first?.weekStartDate || null;
  const end = first?.weekEndDate || (start ? addDays(start, 6) : null);
  return {
    weekStartDate: ymd(start),
    weekEndDate: ymd(end),
    importBatchIds: Array.from(new Set(orders.map(order => order.importBatchId).filter((value): value is string => !!value))),
    count: orders.length,
  };
}

export async function loadWeeklyPlanDiff(query: WeeklyPlanDiffQuery = {}): Promise<WeeklyPlanDiffResult> {
  const currentWeekStart = await resolveCurrentWeekStart(query);
  const nextWeekStart = await resolveNextWeekStart(query, currentWeekStart);
  const [configuredCategoryCount, currentOrders, nextOrders] = await Promise.all([
    prisma.resourceCategory.count(),
    prisma.workOrder.findMany({
      where: weeklyOrdersWhere('current', currentWeekStart, query.currentBatchId),
      select: weeklyPlanDiffOrderSelect,
      orderBy: [{ sourceRowNo: 'asc' }, { code: 'asc' }],
    }),
    prisma.workOrder.findMany({
      where: weeklyOrdersWhere('next', nextWeekStart, query.nextBatchId),
      select: weeklyPlanDiffOrderSelect,
      orderBy: [{ sourceRowNo: 'asc' }, { code: 'asc' }],
    }),
  ]);
  const compared = compareWeeklyPlans(currentOrders, nextOrders, configuredCategoryCount);
  return {
    currentWeek: weekMeta(currentOrders, currentWeekStart),
    nextWeek: weekMeta(nextOrders, nextWeekStart),
    summary: compared.summary,
    items: compared.items,
  };
}
