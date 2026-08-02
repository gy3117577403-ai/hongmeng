import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import { dailyPlanError } from '@/lib/daily-plan-api';
import { assertDailyPlanEnabled } from '@/lib/daily-plan-feature';
import { renderDailyPlanPrintHtml, type DailyPlanPrintMode } from '@/lib/daily-plan-print';
import { getDailyPlanPrintSnapshot } from '@/lib/daily-plan-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    assertDailyPlanEnabled();
    const user = await requireUser();
    const rawMode = request.nextUrl.searchParams.get('mode') || 'team';
    if (rawMode !== 'team' && rawMode !== 'employee') {
      throw Object.assign(new Error('打印类型无效'), { status: 400, code: 'DAILY_PLAN_PRINT_MODE_INVALID' });
    }
    const employeeId = request.nextUrl.searchParams.get('employeeId') || undefined;
    if (rawMode === 'employee' && !employeeId) {
      throw Object.assign(new Error('员工任务单必须指定员工'), { status: 400, code: 'DAILY_PLAN_PRINT_EMPLOYEE_REQUIRED' });
    }
    const snapshot = await getDailyPlanPrintSnapshot({ actorUserId: user.id, planId: params.id, employeeId });
    const html = renderDailyPlanPrintHtml(snapshot as unknown as Parameters<typeof renderDailyPlanPrintHtml>[0], rawMode as DailyPlanPrintMode);
    return new Response(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'private, no-store, max-age=0',
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'self'",
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    return dailyPlanError(error, 'print daily plan');
  }
}
