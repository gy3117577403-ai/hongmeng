import { NextRequest, NextResponse } from 'next/server';
import { requireUser, UnauthorizedError, unauthorized } from '@/lib/auth';
import { listSamplePlans, SampleQueryError } from '@/lib/sample-plan-query';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser(), params = new URLSearchParams(req.nextUrl.searchParams);
    params.set('warehouse', 'true'); params.set('summary', 'true'); params.set('purpose', 'PRODUCTION');
    return NextResponse.json(await listSamplePlans(params, user.employeeId));
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized(error);
    if (error instanceof SampleQueryError) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    console.error('warehouse sample list failed', error);
    return NextResponse.json({ ok: false, error: '样品配料加载失败，请重试' }, { status: 500 });
  }
}
