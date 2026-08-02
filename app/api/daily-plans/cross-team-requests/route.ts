import { DailyCrossTeamRequestStatus } from '@prisma/client';
import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import { dailyPlanError, dailyPlanSuccess } from '@/lib/daily-plan-api';
import { assertDailyPlanEnabled } from '@/lib/daily-plan-feature';
import { presentCrossTeamRequests } from '@/lib/daily-plan-presenter';
import { listDailyCrossTeamRequests } from '@/lib/daily-plan-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    assertDailyPlanEnabled();
    const user = await requireUser();
    const rawStatus = request.nextUrl.searchParams.get('status');
    const status = rawStatus && Object.values(DailyCrossTeamRequestStatus).includes(rawStatus as DailyCrossTeamRequestStatus)
      ? rawStatus as DailyCrossTeamRequestStatus
      : undefined;
    if (rawStatus && !status) {
      throw Object.assign(new Error('跨组申请状态无效'), { status: 400, code: 'DAILY_PLAN_CROSS_TEAM_STATUS_INVALID' });
    }
    const requests = await listDailyCrossTeamRequests({
      actorUserId: user.id,
      workDate: request.nextUrl.searchParams.get('date') || undefined,
      planId: request.nextUrl.searchParams.get('planId') || undefined,
      teamId: request.nextUrl.searchParams.get('teamId') || undefined,
      status,
    });
    return dailyPlanSuccess({ requests: presentCrossTeamRequests(requests) });
  } catch (error) {
    return dailyPlanError(error, 'list daily cross team requests');
  }
}
