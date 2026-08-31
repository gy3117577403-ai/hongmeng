import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import {
  loadProductionExecution,
  loadProductionWeekNavigation,
  parseProductionExecutionView,
  productionFiltersFromSearchParams,
  resolveProductionWeek,
} from '@/lib/production-execution';
import {
  assertProductionScopeRead,
  ProductionAccessScopeError,
  resolveProductionEntityScope,
} from '@/lib/production-access-scope';

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
  const requestId = randomUUID();
  const requestStartedAt = performance.now();
  try {
    const user = await requireUser();
    const productionScope = resolveProductionEntityScope(user);
    assertProductionScopeRead(productionScope);
    const authenticatedAt = performance.now();
    const params = req.nextUrl.searchParams;
    const page = positiveInt(params.get('page'), 1);
    const includeSummary = page === 1 && params.get('includeSummary') === '1';
    const week = await resolveProductionWeek(params.get('weekStart'), params.get('weekEnd'), params.get('scope'));
    const filters = productionFiltersFromSearchParams(params);
    const preparedAt = performance.now();
    const navigationPromise = includeSummary
      ? loadProductionWeekNavigation(new Date(), productionScope)
      : Promise.resolve(null);
    const [dataResult, navigationResult] = await Promise.allSettled([
      loadProductionExecution({
        week,
        filters,
        view: parseProductionExecutionView(params.get('view')),
        page,
        pageSize: Math.min(500, positiveInt(params.get('pageSize'), 120)),
        offset: nonNegativeInt(params.get('offset')),
        includeSummary,
        productionScope,
      }),
      navigationPromise,
    ]);
    if (dataResult.status === 'rejected') throw dataResult.reason;
    const data = dataResult.value;
    const navigation = navigationResult.status === 'fulfilled' ? navigationResult.value : null;
    const warnings: Array<{ code: string; message: string }> = [];
    if (navigationResult.status === 'rejected') {
      warnings.push({ code: 'PRODUCTION_WEEK_NAVIGATION_UNAVAILABLE', message: '生产周导航暂时不可用' });
      console.error('production execution auxiliary read failed', {
        requestId,
        part: 'week_navigation',
        error: navigationResult.reason,
      });
    }
    const responseData = navigation && data.summary
      ? { ...data, summary: { ...data.summary, navigation } }
      : data;
    const loadedAt = performance.now();
    const response = NextResponse.json({ ok: true, requestId, data: responseData, warnings });
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
    const message = error instanceof Error ? error.message : '生产看板加载失败';
    if (message.includes('日期')) {
      return NextResponse.json({
        ok: false,
        error: message,
        code: 'PRODUCTION_EXECUTION_INVALID_DATE',
        requestId,
      }, { status: 400 });
    }
    console.error('production execution read failed', {
      requestId,
      code: 'PRODUCTION_EXECUTION_READ_FAILED',
      durationMs: Number((performance.now() - requestStartedAt).toFixed(1)),
      error,
    });
    return NextResponse.json({
      ok: false,
      error: '生产执行加载失败，请稍后重试',
      code: 'PRODUCTION_EXECUTION_READ_FAILED',
      requestId,
    }, { status: 500 });
  }
}
