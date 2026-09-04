import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import {
  loadProductionExecution,
  parseProductionExecutionView,
  productionFiltersFromSearchParams,
  productionWeekSelector,
  resolveProductionWeek,
} from '@/lib/production-execution';
import {
  buildProductionDispatchDocumentRows,
  renderProductionDispatchPrintHtml,
} from '@/lib/production-dispatch-document';
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

function selectedIds(request: NextRequest): string[] {
  return request.nextUrl.searchParams.getAll('selectedWorkOrderId')
    .flatMap(value => value.split(','))
    .map(value => value.trim())
    .filter(Boolean);
}

export async function GET(request: NextRequest) {
  const requestId = randomUUID();
  try {
    const user = await requireUser();
    const productionScope = resolveProductionEntityScope(user);
    assertProductionScopeRead(productionScope);
    const params = request.nextUrl.searchParams;
    const weekInput = [params.get('weekStart'), params.get('weekEnd'), params.get('scope')] as const;
    const weekSelector = productionWeekSelector(...weekInput);
    const filters = productionFiltersFromSearchParams(params);
    const view = parseProductionExecutionView(params.get('view'));
    const selection = selectedIds(request);
    const readResult = await productionReadCoordinator.run({
      requestId,
      operation: 'dispatch_print',
      key: productionReadKey('dispatch_print', productionScope, { requestId, weekSelector }),
    }, async () => {
      const week = await resolveProductionWeek(...weekInput);
      const data = await loadProductionExecution({
        week,
        filters,
        view,
        page: 1,
        pageSize: 5000,
        productionScope,
      });
      const rows = buildProductionDispatchDocumentRows(data.items, selection);
      const rangeText = data.weekStartDate && data.weekEndDate
        ? `${data.weekStartDate} 至 ${data.weekEndDate}`
        : '当前筛选范围';
      return renderProductionDispatchPrintHtml({ rows, rangeText });
    });
    if (!readResult.started) {
      const response = NextResponse.json({
        ok: false,
        error: '生产调度排班打印繁忙，请稍后重试',
        code: 'PRODUCTION_DISPATCH_PRINT_BUSY',
        requestId,
        retryAfterSeconds: 2,
      }, { status: 503 });
      response.headers.set('Cache-Control', 'private, no-store');
      response.headers.set('Retry-After', '2');
      response.headers.set('X-Request-Id', requestId);
      return response;
    }
    const response = new Response(readResult.value, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'private, no-store, max-age=0',
        'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'",
        'X-Content-Type-Options': 'nosniff',
      },
    });
    response.headers.set('X-Request-Id', requestId);
    return response;
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof ProductionAccessScopeError) {
      return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: error.status });
    }
    console.error('production dispatch print failed', error);
    return NextResponse.json({ ok: false, error: '生产调度排班打印失败', requestId }, { status: 500 });
  }
}
