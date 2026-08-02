import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import { assertDailyPlanMutationRequest, dailyPlanError, dailyPlanSuccess } from '@/lib/daily-plan-api';
import { assertDailyPlanEnabled } from '@/lib/daily-plan-feature';
import { presentDailyPlanSuggestion } from '@/lib/daily-plan-presenter';
import { asOptionalString, asRecord, asString, resolveDailyPlanTeamId } from '@/lib/daily-plan-route-support';
import { previewDailyPlanSuggestions } from '@/lib/daily-plan-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    assertDailyPlanEnabled();
    assertDailyPlanMutationRequest(request);
    const user = await requireUser({ write: 'self' });
    const body = asRecord(await request.json());
    const workDate = asString(body.workDate);
    const shiftCode = asOptionalString(body.shiftCode) || 'DAY';
    const teamId = await resolveDailyPlanTeamId({
      actorUserId: user.id,
      workDate,
      shiftCode,
      teamId: asOptionalString(body.teamId),
    });
    const preview = await previewDailyPlanSuggestions({
      actorUserId: user.id,
      workDate,
      shiftCode,
      teamId,
      includeWaitingUpstream: body.includeWaitingUpstream !== false,
    });
    return dailyPlanSuccess(presentDailyPlanSuggestion(preview));
  } catch (error) {
    return dailyPlanError(error, 'daily plan suggestion preview');
  }
}
