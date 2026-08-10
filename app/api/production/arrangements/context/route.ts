import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import { dailyPlanError, dailyPlanSuccess } from '@/lib/daily-plan-api';
import { assertDailyPlanEnabled } from '@/lib/daily-plan-feature';
import { productionPlanningDateBoundary } from '@/lib/production-planning-date';
import { getProductionArrangementContext } from '@/lib/daily-plan-service';
import { assertProductionScopeRead, resolveProductionEntityScope } from '@/lib/production-access-scope';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function workOrderIds(request: NextRequest): string[] {
  return request.nextUrl.searchParams.getAll('workOrderId')
    .flatMap(value => value.split(','))
    .map(value => value.trim())
    .filter(Boolean);
}

export async function GET(request: NextRequest) {
  try {
    assertDailyPlanEnabled();
    const user = await requireUser();
    assertProductionScopeRead(resolveProductionEntityScope(user));
    const params = request.nextUrl.searchParams;
    const data = await getProductionArrangementContext({
      actorUserId: user.id,
      workOrderIds: workOrderIds(request),
      workDate: params.get('workDate') || productionPlanningDateBoundary(),
      shiftCode: params.get('shiftCode') || 'DAY',
      teamId: params.get('teamId'),
      includeWaitingUpstream: params.get('includeWaitingUpstream') !== '0',
    });
    return dailyPlanSuccess(data);
  } catch (error) {
    return dailyPlanError(error, 'load production arrangement context');
  }
}
