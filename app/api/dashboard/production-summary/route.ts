import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { resolveProductionWeek, summarizeProduction } from '@/lib/production-execution';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    await requireUser();
    const week = await resolveProductionWeek(req.nextUrl.searchParams.get('weekStart'), req.nextUrl.searchParams.get('weekEnd'));
    const data = await summarizeProduction(week);
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    const message = error instanceof Error ? error.message : '生产摘要加载失败';
    return NextResponse.json({ ok: false, error: message }, { status: message.includes('日期') ? 400 : 500 });
  }
}
