import { NextRequest, NextResponse } from 'next/server';
import {
  ForbiddenError,
  forbidden,
  requireCapability,
  unauthorized,
  UnauthorizedError,
} from '@/lib/auth';
import { parseWeek, summarizeWeeklyClose } from '@/lib/weekly-work-orders';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    await requireCapability('PLANNING', 'READ');
    const body = await req.json().catch(() => ({}));
    const weekStartDate = parseWeek(body.weekStartDate);
    if (!weekStartDate) return NextResponse.json({ ok: false, error: '请选择有效的周开始日期' }, { status: 400 });

    const summary = await summarizeWeeklyClose(weekStartDate);
    return NextResponse.json({ ok: true, summary });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorized();
    if (e instanceof ForbiddenError) return forbidden('仅计划部、只读管理层或管理员可以预览结束当前周的影响');
    console.error(e);
    return NextResponse.json({ ok: false, error: '结束本周预览失败' }, { status: 500 });
  }
}
