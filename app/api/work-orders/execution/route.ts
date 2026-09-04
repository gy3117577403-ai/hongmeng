import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import {
  loadProductionExecution,
  loadProductionWeekNavigation,
  parseProductionExecutionView,
  productionFiltersFromSearchParams,
  productionWeekSelector,
  resolveProductionWeek,
} from '@/lib/production-execution';
import {
  assertProductionScopeRead,
  ProductionAccessScopeError,
  resolveProductionEntityScope,
} from '@/lib/production-access-scope';
import {
  productionReadCoordinator,
  productionReadKey,
} from '@/lib/production-read-coordinator';

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
    const weekInput = [params.get('weekStart'), params.get('weekEnd'), params.get('scope')] as const;
    const weekSelector = productionWeekSelector(...weekInput);
    const filters = productionFiltersFromSearchParams(params);
    const keyFilters = {
      ...filters,
      quick: [...new Set(filters.quick || [])].sort(),
      customers: [...(filters.customers || [])].sort(),
    };
    const view = parseProductionExecutionView(params.get('view'));
    const pageSize = Math.min(500, positiveInt(params.get('pageSize'), 120));
    const offset = nonNegativeInt(params.get('offset'));
    const preparedAt = performance.now();
    const readResult = await productionReadCoordinator.run({
      requestId,
      operation: 'execution',
      key: productionReadKey('execution', productionScope, {
        weekSelector,
        filters: keyFilters,
        view,
        page,
        pageSize,
        offset,
        includeSummary,
      }),
    }, async () => {
      const week = await resolveProductionWeek(...weekInput);
      const data = await loadProductionExecution({
        week,
        filters,
        view,
        page,
        pageSize,
        offset,
        includeSummary,
        productionScope,
      });
      let navigation: Awaited<ReturnType<typeof loadProductionWeekNavigation>> | null = null;
      const warnings: Array<{ code: string; message: string }> = [];
      if (includeSummary) {
        try {
          navigation = await loadProductionWeekNavigation(new Date(), productionScope);
        } catch (error) {
          warnings.push({ code: 'PRODUCTION_WEEK_NAVIGATION_UNAVAILABLE', message: '生产周导航暂时不可用' });
          console.error('production execution auxiliary read failed', {
            requestId,
            part: 'week_navigation',
            error,
          });
        }
      }
      return {
        data: navigation && data.summary
          ? { ...data, summary: { ...data.summary, navigation } }
          : data,
        warnings,
      };
    });
    if (!readResult.started) {
      console.warn('production execution read rejected while busy', {
        requestId,
        code: 'PRODUCTION_EXECUTION_BUSY',
        activeOperation: readResult.active.operation,
        activeForMs: readResult.activeForMs,
      });
      const response = NextResponse.json({
        ok: false,
        error: '生产看板繁忙，请稍后重试',
        code: 'PRODUCTION_EXECUTION_BUSY',
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
