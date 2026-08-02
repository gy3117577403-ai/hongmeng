import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import { assertDailyPlanMutationRequest, dailyPlanError, dailyPlanSuccess, readIdempotencyKey } from '@/lib/daily-plan-api';
import { assertDailyPlanEnabled } from '@/lib/daily-plan-feature';
import { asNumber, asOptionalString, asRecord, asString } from '@/lib/daily-plan-route-support';
import { requestDailyCrossTeamAssignment } from '@/lib/daily-plan-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    assertDailyPlanEnabled();
    assertDailyPlanMutationRequest(request);
    const user = await requireUser({ write: 'self' });
    const body = asRecord(await request.json());
    const result = asRecord(await requestDailyCrossTeamAssignment({
      actorUserId: user.id,
      taskId: params.id,
      targetTeamId: asString(body.targetTeamId),
      employeeId: asOptionalString(body.employeeId),
      quantity: asNumber(body.quantity),
      reason: asString(body.reason),
      idempotencyKey: asString(readIdempotencyKey(request, body)),
    }));
    return dailyPlanSuccess({ revisionId: asString(result.id) }, 201);
  } catch (error) {
    return dailyPlanError(error, 'request daily cross team assignment');
  }
}
