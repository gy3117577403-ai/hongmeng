import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import { assertDailyPlanMutationRequest, dailyPlanError, dailyPlanSuccess, readIdempotencyKey } from '@/lib/daily-plan-api';
import { assertDailyPlanEnabled } from '@/lib/daily-plan-feature';
import { asOptionalString, asRecord, asString, asStringArray, resolveDailyPlanTeamId } from '@/lib/daily-plan-route-support';
import { createDailyProductionPlan } from '@/lib/daily-plan-service';

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
    const result = await createDailyProductionPlan({
      actorUserId: user.id,
      workDate,
      shiftCode,
      teamId,
      idempotencyKey: asString(readIdempotencyKey(request, body)),
      workOrderIds: asStringArray(body.workOrderIds),
      includeWaitingUpstream: body.includeWaitingUpstream !== false,
    }) as Record<string, unknown>;
    const plan = asRecord(result.plan);
    return dailyPlanSuccess({
      planId: asString(plan.id),
      version: Number(plan.version || 0),
      createdTaskCount: Number(result.createdTaskCount || 0),
      blocked: result.blocked,
    }, 201);
  } catch (error) {
    return dailyPlanError(error, 'create daily plan');
  }
}
