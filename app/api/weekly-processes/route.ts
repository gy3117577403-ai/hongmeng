import { NextRequest } from 'next/server';
import { ForbiddenError, requireUser } from '@/lib/auth';
import { dailyPlanError, dailyPlanSuccess } from '@/lib/daily-plan-api';
import { assertDailyPlanEnabled } from '@/lib/daily-plan-feature';
import { productionPlanningDateBoundary } from '@/lib/production-planning-date';
import { getWeeklyProcessOverview } from '@/lib/weekly-process-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    assertDailyPlanEnabled();
    const user = await requireUser();
    if (!user.canAccessDailyPlans) throw new ForbiddenError('当前账号不能访问生产排程');
    const requestedDate = request.nextUrl.searchParams.get('date');
    if (requestedDate && !/^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) {
      throw Object.assign(new Error('周日期必须为 YYYY-MM-DD'), { status: 400, code: 'WEEK_DATE_INVALID' });
    }
    const result = await getWeeklyProcessOverview({
      weekDate: requestedDate || productionPlanningDateBoundary(),
      teamId: request.nextUrl.searchParams.get('teamId') || undefined,
      search: request.nextUrl.searchParams.get('search') || undefined,
      state: request.nextUrl.searchParams.get('state') || undefined,
    });
    return dailyPlanSuccess(result);
  } catch (error) {
    return dailyPlanError(error, 'weekly process overview');
  }
}
