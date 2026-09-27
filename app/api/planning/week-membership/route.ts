import { NextRequest, NextResponse } from 'next/server';
import { requireUser, UnauthorizedError, unauthorized, forbidden } from '@/lib/auth';
import { PlanningWeekError, previewPlanningWeek, commitPlanningWeek } from '@/lib/planning-week-service';
export const dynamic = 'force-dynamic';
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    if (!user.access.capabilities.includes('PLANNING:UPDATE')) return forbidden();
    const input = await req.json();
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new PlanningWeekError('请求格式不正确');
    const result = input.commit === true ? await commitPlanningWeek(input, user) : await previewPlanningWeek(input);
    return NextResponse.json({ ok: true, result });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorized();
    if (e instanceof PlanningWeekError) return NextResponse.json({ ok: false, error: e.message }, { status: e.status });
    console.error('planning week membership', e);
    return NextResponse.json({ ok: false, error: '周计划未变更，请稍后重试' }, { status: 500 });
  }
}
