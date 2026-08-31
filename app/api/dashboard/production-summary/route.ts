import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import {
  assertProductionScopeRead,
  ProductionAccessScopeError,
  resolveProductionEntityScope,
} from '@/lib/production-access-scope';
import { loadProductionWeekNavigation, resolveProductionWeek, summarizeProduction } from '@/lib/production-execution';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const requestId = randomUUID();
  const requestStartedAt = performance.now();
  try {
    const user = await requireUser();
    const authenticatedAt = performance.now();
    const productionScope = resolveProductionEntityScope(user, { allowBasicSummary: true });
    assertProductionScopeRead(productionScope);
    const week = await resolveProductionWeek(
      req.nextUrl.searchParams.get('weekStart'),
      req.nextUrl.searchParams.get('weekEnd'),
      req.nextUrl.searchParams.get('scope'),
    );
    const preparedAt = performance.now();
    const [dataResult, navigationResult] = await Promise.allSettled([
      summarizeProduction(week, productionScope),
      loadProductionWeekNavigation(new Date(), productionScope),
    ]);
    if (dataResult.status === 'rejected') throw dataResult.reason;
    const data = dataResult.value;
    const navigation = navigationResult.status === 'fulfilled' ? navigationResult.value : null;
    const warnings: Array<{ code: string; message: string }> = [];
    if (navigationResult.status === 'rejected') {
      warnings.push({ code: 'PRODUCTION_WEEK_NAVIGATION_UNAVAILABLE', message: '生产周导航暂时不可用' });
      console.error('production summary auxiliary read failed', {
        requestId,
        part: 'week_navigation',
        error: navigationResult.reason,
      });
    }
    const loadedAt = performance.now();
    const response = NextResponse.json({ ok: true, requestId, data: { ...data, navigation }, warnings });
    response.headers.set('Cache-Control', 'private, no-store');
    response.headers.set('Server-Timing', [
      `auth;dur=${(authenticatedAt - requestStartedAt).toFixed(1)}`,
      `prepare;dur=${(preparedAt - authenticatedAt).toFixed(1)}`,
      `load;dur=${(loadedAt - preparedAt).toFixed(1)}`,
      `total;dur=${(loadedAt - requestStartedAt).toFixed(1)}`,
    ].join(', '));
    return response;
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof ProductionAccessScopeError) {
      return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : '生产摘要加载失败';
    if (message.includes('日期')) {
      return NextResponse.json({
        ok: false,
        error: message,
        code: 'PRODUCTION_SUMMARY_INVALID_DATE',
        requestId,
      }, { status: 400 });
    }
    console.error('production summary read failed', {
      requestId,
      code: 'PRODUCTION_SUMMARY_READ_FAILED',
      durationMs: Number((performance.now() - requestStartedAt).toFixed(1)),
      error,
    });
    return NextResponse.json({
      ok: false,
      error: '生产摘要加载失败，请稍后重试',
      code: 'PRODUCTION_SUMMARY_READ_FAILED',
      requestId,
    }, { status: 500 });
  }
}
