import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { loadProductionExecution, resolveProductionWeek, type ProductionExecutionFilters } from '@/lib/production-execution';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function positiveInt(value: string | null, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const params = req.nextUrl.searchParams;
    const week = await resolveProductionWeek(params.get('weekStart'), params.get('weekEnd'));
    const viewParam = params.get('view');
    const view = viewParam === 'today' || viewParam === 'exceptions' ? viewParam : 'board';
    const filters: ProductionExecutionFilters = {
      keyword: params.get('keyword') || '',
      quick: (params.get('quick') || '').split(',').map(item => item.trim()).filter(Boolean),
      customer: params.get('customer') || '',
      specification: params.get('specification') || '',
      productName: params.get('productName') || '',
      productionOwner: params.get('productionOwner') || '',
      workstation: params.get('workstation') || '',
      stage: params.get('stage') || '',
      priority: params.get('priority') || '',
      deliveryFrom: params.get('deliveryFrom') || '',
      deliveryTo: params.get('deliveryTo') || '',
      completeness: params.get('completeness') || '',
      currentUserName: user.displayName || user.username,
    };
    const data = await loadProductionExecution({
      week,
      filters,
      view,
      page: positiveInt(params.get('page'), 1),
      pageSize: positiveInt(params.get('pageSize'), 120),
    });
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    const message = error instanceof Error ? error.message : '生产看板加载失败';
    return NextResponse.json({ ok: false, error: message }, { status: message.includes('日期') ? 400 : 500 });
  }
}
