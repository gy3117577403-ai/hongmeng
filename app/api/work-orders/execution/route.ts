import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import {
  loadProductionExecution,
  parseProductionExecutionView,
  productionFiltersFromSearchParams,
  resolveProductionWeek,
} from '@/lib/production-execution';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function positiveInt(value: string | null, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export async function GET(req: NextRequest) {
  try {
    await requireUser();
    const params = req.nextUrl.searchParams;
    const week = await resolveProductionWeek(params.get('weekStart'), params.get('weekEnd'), params.get('scope'));
    const data = await loadProductionExecution({
      week,
      filters: productionFiltersFromSearchParams(params),
      view: parseProductionExecutionView(params.get('view')),
      page: positiveInt(params.get('page'), 1),
      pageSize: Math.min(500, positiveInt(params.get('pageSize'), 500)),
    });
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    const message = error instanceof Error ? error.message : '生产看板加载失败';
    return NextResponse.json({ ok: false, error: message }, { status: message.includes('日期') ? 400 : 500 });
  }
}
