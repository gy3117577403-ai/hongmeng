import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import {
  assertProductionScopeRead,
  ProductionAccessScopeError,
  resolveProductionEntityScope,
} from '@/lib/production-access-scope';
import {
  reconcileAutomaticallyReleasedProductionPlanBatches,
  reconcileFutureActiveProductionPlanWeeks,
} from '@/lib/production-planning';
import { loadProductionWeekNavigation, resolveProductionWeek, summarizeProduction } from '@/lib/production-execution';
import { reconcileProductionCarryovers } from '@/lib/production-carryovers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const requestStartedAt = performance.now();
    const user = await requireUser();
    const authenticatedAt = performance.now();
    const productionScope = resolveProductionEntityScope(user, { allowBasicSummary: true });
    assertProductionScopeRead(productionScope);
    const canReconcile = productionScope.canReconcile;
    if (canReconcile && req.nextUrl.searchParams.get('skipReconcile') !== '1') {
      await prisma.$transaction(async tx => {
        await reconcileFutureActiveProductionPlanWeeks(tx, { actorId: user.id });
        await reconcileAutomaticallyReleasedProductionPlanBatches(tx, { actorId: user.id });
      }, { maxWait: 10_000, timeout: 180_000 });
    }
    const reconciledAt = performance.now();
    const week = await resolveProductionWeek(
      req.nextUrl.searchParams.get('weekStart'),
      req.nextUrl.searchParams.get('weekEnd'),
      req.nextUrl.searchParams.get('scope'),
    );
    if (canReconcile && req.nextUrl.searchParams.get('skipReconcile') !== '1' && week.scope === 'current' && week.weekStart) {
      await prisma.$transaction(
        tx => reconcileProductionCarryovers(tx, { targetWeekStart: week.weekStart!, actorId: user.id }),
        { maxWait: 10_000, timeout: 180_000 },
      );
    }
    const [data, navigation] = await Promise.all([
      summarizeProduction(week, productionScope),
      loadProductionWeekNavigation(new Date(), productionScope),
    ]);
    const loadedAt = performance.now();
    const response = NextResponse.json({ ok: true, data: { ...data, navigation } });
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
    if (error instanceof ProductionAccessScopeError) {
      return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : '生产摘要加载失败';
    return NextResponse.json({ ok: false, error: message }, { status: message.includes('日期') ? 400 : 500 });
  }
}
