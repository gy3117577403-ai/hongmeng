import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { reconcileDraftProductTimeRoutes } from '@/lib/process-routing';
import {
  reconcileAutomaticallyReleasedProductionPlanBatches,
  reconcileFutureActiveProductionPlanWeeks,
} from '@/lib/production-planning';
import {
  loadProductionExecution,
  loadProductionWeekNavigation,
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

function nonNegativeInt(value: string | null) {
  if (value === null || value === '') return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

export async function GET(req: NextRequest) {
  try {
    const requestStartedAt = performance.now();
    const user = await requireUser();
    const authenticatedAt = performance.now();
    const params = req.nextUrl.searchParams;
    const page = positiveInt(params.get('page'), 1);
    const includeSummary = page === 1 && params.get('includeSummary') === '1';
    const skipReconcile = params.get('skipReconcile') === '1';
    if (!skipReconcile) {
      await prisma.$transaction(async tx => {
        await reconcileFutureActiveProductionPlanWeeks(tx, { actorId: user.id });
        await reconcileAutomaticallyReleasedProductionPlanBatches(tx, { actorId: user.id });
      }, { maxWait: 10_000, timeout: 180_000 });
    }
    const week = await resolveProductionWeek(params.get('weekStart'), params.get('weekEnd'), params.get('scope'));
    const filters = productionFiltersFromSearchParams(params);
    if (!skipReconcile) {
      await prisma.$transaction(tx => reconcileDraftProductTimeRoutes(tx, {
        workOrderWhere: filters.workOrderId
          ? { id: filters.workOrderId, deletedAt: null }
          : productionWeekWhere(week),
        actorId: user.id,
      }));
    }
    const reconciledAt = performance.now();
    const navigationPromise = includeSummary ? loadProductionWeekNavigation() : Promise.resolve(null);
    const [data, navigation] = await Promise.all([
      loadProductionExecution({
        week,
        filters,
        view: parseProductionExecutionView(params.get('view')),
        page,
        pageSize: Math.min(500, positiveInt(params.get('pageSize'), 120)),
        offset: nonNegativeInt(params.get('offset')),
        includeSummary,
      }),
      navigationPromise,
    ]);
    const responseData = navigation && data.summary
      ? { ...data, summary: { ...data.summary, navigation } }
      : data;
    const loadedAt = performance.now();
    const response = NextResponse.json({ ok: true, data: responseData });
    response.headers.set('Cache-Control', 'private, no-store');
    response.headers.set('Server-Timing', [
      `auth;dur=${(authenticatedAt - requestStartedAt).toFixed(1)}`,
      `reconcile;dur=${(reconciledAt - authenticatedAt).toFixed(1)}`,
      `load;dur=${(loadedAt - reconciledAt).toFixed(1)}`,
      `total;dur=${(loadedAt - requestStartedAt).toFixed(1)}`,
    ].join(', '));
    return response;
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    const message = error instanceof Error ? error.message : '生产看板加载失败';
    return NextResponse.json({ ok: false, error: message }, { status: message.includes('日期') ? 400 : 500 });
  }
}
