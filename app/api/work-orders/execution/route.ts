import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { reconcileDraftProductTimeRoutes } from '@/lib/process-routing';
import { reconcileFutureActiveProductionPlanWeeks } from '@/lib/production-planning';
import {
  loadProductionExecution,
  parseProductionExecutionView,
  productionWeekWhere,
  productionFiltersFromSearchParams,
  resolveProductionWeek,
} from '@/lib/production-execution';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function positiveInt(value: string | null, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    await prisma.$transaction(tx => reconcileFutureActiveProductionPlanWeeks(tx, { actorId: user.id }));
    const params = req.nextUrl.searchParams;
    const week = await resolveProductionWeek(params.get('weekStart'), params.get('weekEnd'), params.get('scope'));
    const filters = productionFiltersFromSearchParams(params);
    await prisma.$transaction(tx => reconcileDraftProductTimeRoutes(tx, {
      workOrderWhere: filters.workOrderId
        ? { id: filters.workOrderId, deletedAt: null }
        : productionWeekWhere(week),
      actorId: user.id,
    }));
    const data = await loadProductionExecution({
      week,
      filters,
      view: parseProductionExecutionView(params.get('view')),
      page: positiveInt(params.get('page'), 1),
      pageSize: Math.min(500, positiveInt(params.get('pageSize'), 500)),
    });
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    const message = error instanceof Error ? error.message : '生产看板加载失败';
    return NextResponse.json({ ok: false, error: message }, { status: message.includes('日期') ? 400 : 500 });
  }
}
