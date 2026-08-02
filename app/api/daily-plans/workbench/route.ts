import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import { dailyPlanError, dailyPlanSuccess } from '@/lib/daily-plan-api';
import { assertDailyPlanEnabled } from '@/lib/daily-plan-feature';
import { presentDailyPlanWorkbench } from '@/lib/daily-plan-presenter';
import { getDailyPlanWorkbench } from '@/lib/daily-plan-service';
import { productionPlanningDateBoundary } from '@/lib/production-planning-date';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    assertDailyPlanEnabled();
    const user = await requireUser();
    const workDate = request.nextUrl.searchParams.get('date') || productionPlanningDateBoundary();
    const shiftCode = request.nextUrl.searchParams.get('shiftCode') || 'DAY';
    const teamId = request.nextUrl.searchParams.get('teamId') || undefined;
    const workbench = await getDailyPlanWorkbench({
      actorUserId: user.id,
      workDate,
      shiftCode,
      teamId,
    });
    return dailyPlanSuccess(presentDailyPlanWorkbench(workbench));
  } catch (error) {
    return dailyPlanError(error, 'daily plan workbench');
  }
}
