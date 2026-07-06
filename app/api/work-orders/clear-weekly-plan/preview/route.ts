import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { parseClearWeek, summarizeWeeklyPlanClear } from '../shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    await requireUser();
    const body = await req.json().catch(() => ({}));
    const weekStartDate = parseClearWeek(body.weekStartDate);
    if (!weekStartDate) return NextResponse.json({ ok: false, error: '请选择有效的周开始日期' }, { status: 400 });

    const summary = await summarizeWeeklyPlanClear(weekStartDate);
    return NextResponse.json({ ok: true, summary });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorized();
    console.error(e);
    return NextResponse.json({ ok: false, error: '清除预览失败' }, { status: 500 });
  }
}
