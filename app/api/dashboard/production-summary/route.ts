import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import {
  reconcileAutomaticallyReleasedProductionPlanBatches,
  reconcileFutureActiveProductionPlanWeeks,
} from '@/lib/production-planning';
import { loadProductionWeekNavigation, resolveProductionWeek, summarizeProduction } from '@/lib/production-execution';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    await prisma.$transaction(async tx => {
      await reconcileFutureActiveProductionPlanWeeks(tx, { actorId: user.id });
      await reconcileAutomaticallyReleasedProductionPlanBatches(tx, { actorId: user.id });
    }, { maxWait: 10_000, timeout: 180_000 });
    const week = await resolveProductionWeek(
      req.nextUrl.searchParams.get('weekStart'),
      req.nextUrl.searchParams.get('weekEnd'),
      req.nextUrl.searchParams.get('scope'),
    );
    const [data, navigation] = await Promise.all([summarizeProduction(week), loadProductionWeekNavigation()]);
    return NextResponse.json({ ok: true, data: { ...data, navigation } });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    const message = error instanceof Error ? error.message : '生产摘要加载失败';
    return NextResponse.json({ ok: false, error: message }, { status: message.includes('日期') ? 400 : 500 });
  }
}
