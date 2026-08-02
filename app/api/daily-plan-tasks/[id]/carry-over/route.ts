import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import { assertDailyPlanMutationRequest, dailyPlanError, dailyPlanSuccess, readExpectedVersion, readIdempotencyKey } from '@/lib/daily-plan-api';
import { assertDailyPlanEnabled } from '@/lib/daily-plan-feature';
import { asNumber, asOptionalString, asRecord, asString } from '@/lib/daily-plan-route-support';
import { carryOverDailyProcessTask } from '@/lib/daily-plan-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    assertDailyPlanEnabled();
    assertDailyPlanMutationRequest(request);
    const user = await requireUser({ write: 'self' });
    const body = asRecord(await request.json());
    const result = asRecord(await carryOverDailyProcessTask({
      actorUserId: user.id,
      taskId: params.id,
      expectedVersion: asNumber(readExpectedVersion(body), -1),
      targetDate: asString(body.targetDate),
      shiftCode: asOptionalString(body.shiftCode),
      reason: asString(body.reason),
      idempotencyKey: asString(readIdempotencyKey(request, body)),
    }));
    return dailyPlanSuccess({ revisionId: asString(result.carriedTaskId || result.taskId || result.planId) }, 201);
  } catch (error) {
    return dailyPlanError(error, 'carry over daily process task');
  }
}
