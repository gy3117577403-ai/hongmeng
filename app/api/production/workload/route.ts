import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { resolveProductionEntityScope, ProductionAccessScopeError } from '@/lib/production-access-scope';
import { loadProductionWorkload } from '@/lib/production-workload-service';
import { chinaDateKey } from '@/lib/china-date';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const data = await loadProductionWorkload(req.nextUrl.searchParams.get('weekStart') || chinaDateKey(new Date()), resolveProductionEntityScope(user));
    return NextResponse.json({ ok: true, data }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof ProductionAccessScopeError) return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    if (error instanceof RangeError) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    console.error('production workload read failed', error);
    return NextResponse.json({ ok: false, error: '生产工时加载失败，请重试' }, { status: 500 });
  }
}
