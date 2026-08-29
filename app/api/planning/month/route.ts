import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { chinaDate } from '@/lib/production-planning';
import { loadPlanningCapacity } from '@/lib/planning-capacity';
import { planningMonthRange, parsePlanningDateRange } from '@/lib/planning-date-range';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    await requireUser();
    const range = planningMonthRange(request.nextUrl.searchParams.get('month'));
    const batches = await prisma.productionPlanBatch.findMany({
      where: {
        deletedAt: null,
        plannedCompletionDate: { gte: range.start, lt: range.endExclusive },
        planOrder: { deletedAt: null },
      },
      select: { weekStartDate: true, weekEndDate: true, quantity: true },
      orderBy: [{ weekStartDate: 'asc' }, { plannedCompletionDate: 'asc' }],
    });
    const weekMap = new Map<string, { weekStartDate: string; weekEndDate: string; totalQuantity: number }>();
    for (const batch of batches) {
      const key = chinaDate(batch.weekStartDate);
      const current = weekMap.get(key) || {
        weekStartDate: key,
        weekEndDate: chinaDate(batch.weekEndDate),
        totalQuantity: 0,
      };
      current.totalQuantity += batch.quantity;
      weekMap.set(key, current);
    }
    const capacity = await loadPlanningCapacity(range);
    const weeks = await Promise.all([...weekMap.values()].map(async week => {
      const startDate = week.weekStartDate < range.startDate ? range.startDate : week.weekStartDate;
      const endDate = week.weekEndDate > range.endDate ? range.endDate : week.weekEndDate;
      return {
        ...week,
        ...(await loadPlanningCapacity(parsePlanningDateRange(startDate, endDate))),
      };
    }));
    return NextResponse.json({
      ok: true,
      month: { month: range.month, startDate: range.startDate, endDate: range.endDate, capacity, weeks },
    }, { headers: { 'Cache-Control': 'private, no-store, max-age=0' } });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof Error && /日期|月份|自然日/.test(error.message)) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }
    console.error('planning month failed', error);
    return NextResponse.json({ ok: false, error: '月度排产加载失败' }, { status: 500 });
  }
}
