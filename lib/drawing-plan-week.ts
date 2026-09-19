import type { Prisma } from '@prisma/client';

/** Calendar dates are interpreted in Shanghai, independently of the browser timezone. */
export function planWeekStart(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('计划周日期无效');
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error('计划周日期无效');
  date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
  return date.toISOString().slice(0, 10);
}

export function shiftPlanWeek(week: string, offset: number): string {
  const date = new Date(`${planWeekStart(week)}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset * 7);
  return date.toISOString().slice(0, 10);
}

export function currentPlanWeek(now = new Date()): string {
  return planWeekStart(new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10));
}

export function planWeekLabel(week: string): string {
  const start = planWeekStart(week);
  const end = new Date(`${start}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 6);
  return `${start} — ${end.toISOString().slice(0, 10)}`;
}

export function drawingPlanWeekScope(week: string, reviewRequired = false): Prisma.DrawingLibraryItemWhereInput {
  const weekStartDate = new Date(`${planWeekStart(week)}T00:00:00+08:00`);
  return { OR: [
    { productionPlanOrders: { some: { deletedAt: null, status: { not: 'cancelled' }, batches: { some: {
      deletedAt: null, weekStartDate, releaseState: { notIn: ['cancelled', 'archived'] }, ...(reviewRequired ? { documentReviewRequired: true } : {}),
    } } } } },
    // Older plans without a batch still belong to their recorded plan week.
    { workOrders: { some: { deletedAt: null, planActive: true, status: { not: 'cancelled' }, weekStartDate, productionPlanBatch: { is: null }, ...(reviewRequired ? { documentReviewRequired: true } : {}) } } },
  ] };
}
