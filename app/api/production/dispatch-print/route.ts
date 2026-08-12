import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import {
  loadProductionExecution,
  parseProductionExecutionView,
  productionFiltersFromSearchParams,
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

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function selectedIds(request: NextRequest): string[] {
  return request.nextUrl.searchParams.getAll('selectedWorkOrderId')
    .flatMap(value => value.split(','))
    .map(value => value.trim())
    .filter(Boolean);
}

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser();
    const productionScope = resolveProductionEntityScope(user);
    assertProductionScopeRead(productionScope);
    const params = request.nextUrl.searchParams;
    const week = await resolveProductionWeek(params.get('weekStart'), params.get('weekEnd'), params.get('scope'));
    const data = await loadProductionExecution({
      week,
      filters: productionFiltersFromSearchParams(params),
      view: parseProductionExecutionView(params.get('view')),
      page: 1,
      pageSize: 5000,
      productionScope,
    });
    const rows = buildProductionDispatchDocumentRows(data.items, selectedIds(request));
    const rangeText = data.weekStartDate && data.weekEndDate
      ? `${data.weekStartDate} 至 ${data.weekEndDate}`
      : '当前筛选范围';
    const html = renderProductionDispatchPrintHtml({ rows, rangeText });
    return new Response(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'private, no-store, max-age=0',
        'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'",
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof ProductionAccessScopeError) {
      return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: error.status });
    }
    console.error('production dispatch print failed', error);
    return NextResponse.json({ ok: false, error: '生产调度排班打印失败' }, { status: 500 });
  }
}
