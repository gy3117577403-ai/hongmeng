import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { loadProductionWeekReconciliation } from '@/lib/production-week-reconciliation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    await requireUser();
    const data = await loadProductionWeekReconciliation(req.nextUrl.searchParams.get('weekStart'));
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    const message = error instanceof Error ? error.message : '生产周协同对账失败';
    return NextResponse.json(
      { ok: false, error: message },
      { status: message.includes('日期') ? 400 : 500 },
    );
  }
}
