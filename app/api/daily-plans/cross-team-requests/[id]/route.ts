import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import {
  assertDailyPlanMutationRequest,
  dailyPlanError,
  dailyPlanSuccess,
  readExpectedVersion,
  readIdempotencyKey,
} from '@/lib/daily-plan-api';
import { assertDailyPlanEnabled } from '@/lib/daily-plan-feature';
import { asNumber, asOptionalString, asRecord, asString } from '@/lib/daily-plan-route-support';
import { reviewDailyCrossTeamRequest } from '@/lib/daily-plan-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    assertDailyPlanEnabled();
    assertDailyPlanMutationRequest(request);
    const user = await requireUser({ write: 'self' });
    const body = asRecord(await request.json());
    const decision = asString(body.decision).toUpperCase();
    if (decision !== 'APPROVE' && decision !== 'REJECT') {
      throw Object.assign(new Error('审批结果必须为批准或驳回'), { status: 400, code: 'DAILY_PLAN_CROSS_TEAM_DECISION_INVALID' });
    }
    const reviewed = asRecord(await reviewDailyCrossTeamRequest({
      actorUserId: user.id,
      requestId: params.id,
      expectedVersion: asNumber(readExpectedVersion(body), -1),
      decision,
      reviewNote: asOptionalString(body.reviewNote) || null,
      idempotencyKey: asString(readIdempotencyKey(request, body)),
    }));
    return dailyPlanSuccess({ version: asNumber(reviewed.version) });
  } catch (error) {
    return dailyPlanError(error, 'review daily cross team request');
  }
}
