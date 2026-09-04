import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import {
  assertProductionScopeRead,
  ProductionAccessScopeError,
  resolveProductionEntityScope,
} from '@/lib/production-access-scope';
import {
  loadProductionWeekNavigation,
  productionWeekSelector,
  resolveProductionWeek,
  summarizeProduction,
} from '@/lib/production-execution';
import {
  productionReadCoordinator,
  productionReadKey,
} from '@/lib/production-read-coordinator';

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
    const weekInput = [
      req.nextUrl.searchParams.get('weekStart'),
      req.nextUrl.searchParams.get('weekEnd'),
      req.nextUrl.searchParams.get('scope'),
    ] as const;
    const weekSelector = productionWeekSelector(...weekInput);
    const preparedAt = performance.now();
    const readResult = await productionReadCoordinator.run({
      requestId,
      operation: 'summary',
      key: productionReadKey('summary', productionScope, { weekSelector }),
    }, async () => {
      const week = await resolveProductionWeek(...weekInput);
      const data = await summarizeProduction(week, productionScope);
      let navigation: Awaited<ReturnType<typeof loadProductionWeekNavigation>> | null = null;
      const warnings: Array<{ code: string; message: string }> = [];
      try {
        navigation = await loadProductionWeekNavigation(new Date(), productionScope);
      } catch (error) {
        warnings.push({ code: 'PRODUCTION_WEEK_NAVIGATION_UNAVAILABLE', message: '生产周导航暂时不可用' });
        console.error('production summary auxiliary read failed', {
          requestId,
          part: 'week_navigation',
          error,
        });
      }
      return { data: { ...data, navigation }, warnings };
    });
    if (!readResult.started) {
      console.warn('production summary read rejected while busy', {
        requestId,
        code: 'PRODUCTION_SUMMARY_BUSY',
        activeOperation: readResult.active.operation,
        activeForMs: readResult.activeForMs,
      });
      const response = NextResponse.json({
        ok: false,
        error: '生产摘要繁忙，请稍后重试',
        code: 'PRODUCTION_SUMMARY_BUSY',
        requestId,
        retryAfterSeconds: 2,
      }, { status: 503 });
      response.headers.set('Cache-Control', 'private, no-store');
      response.headers.set('Retry-After', '2');
      response.headers.set('X-Request-Id', requestId);
      return response;
    }
    const loadedAt = performance.now();
    const response = NextResponse.json({
      ok: true,
      requestId,
      data: readResult.value.data,
      warnings: readResult.value.warnings,
    });
    response.headers.set('Cache-Control', 'private, no-store');
    response.headers.set('X-Request-Id', requestId);
    response.headers.set('X-Production-Read-Mode', readResult.shared ? 'joined' : 'leader');
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
