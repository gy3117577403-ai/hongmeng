import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import { assertDailyPlanMutationRequest, dailyPlanError, dailyPlanSuccess, readExpectedVersion, readIdempotencyKey } from '@/lib/daily-plan-api';
import { assertDailyPlanEnabled } from '@/lib/daily-plan-feature';
import { asNumber, asOptionalString, asRecord, asString } from '@/lib/daily-plan-route-support';
import { confirmDailyProductionPlan, upsertDailyCapacityOverride } from '@/lib/daily-plan-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    assertDailyPlanEnabled();
    assertDailyPlanMutationRequest(request);
    const user = await requireUser({ write: 'self' });
    const body = asRecord(await request.json());
    const idempotencyKey = asString(readIdempotencyKey(request, body));
    const expectedVersion = asNumber(readExpectedVersion(body), -1);
    const action = asString(body.action).toUpperCase();
    if (action === 'CONFIRM') {
      const plan = asRecord(await confirmDailyProductionPlan({ actorUserId: user.id, planId: params.id, expectedVersion, idempotencyKey }));
      return dailyPlanSuccess({ version: asNumber(plan.version) });
    }
    if (action === 'UPDATE_CAPACITY') {
      const capacityMinutes = asNumber(body.capacityMinutes, -1);
      const regularMinutes = Math.min(480, Math.max(0, capacityMinutes));
      const overtimeMinutes = Math.max(0, capacityMinutes - regularMinutes);
      const plan = asRecord(await upsertDailyCapacityOverride({
        actorUserId: user.id,
        planId: params.id,
        employeeId: asString(body.employeeId),
        regularMilliseconds: regularMinutes * 60_000,
        overtimeMilliseconds: overtimeMinutes * 60_000,
        overtimeStartAt: asOptionalString(body.overtimeStart) || null,
        overtimeEndAt: asOptionalString(body.overtimeEnd) || null,
        reason: asOptionalString(body.reason) || null,
        expectedVersion,
        idempotencyKey,
      }));
      return dailyPlanSuccess({ version: asNumber(plan.version) });
    }
    const error = Object.assign(new Error('不支持的日计划操作'), { status: 400, code: 'DAILY_PLAN_ACTION_INVALID' });
    throw error;
  } catch (error) {
    return dailyPlanError(error, 'update daily plan');
  }
}
