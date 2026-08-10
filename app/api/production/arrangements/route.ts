import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import {
  assertDailyPlanMutationRequest,
  dailyPlanError,
  dailyPlanSuccess,
  readIdempotencyKey,
} from '@/lib/daily-plan-api';
import { assertDailyPlanEnabled } from '@/lib/daily-plan-feature';
import { asOptionalString, asRecord, asString, asStringArray } from '@/lib/daily-plan-route-support';
import {
  continueProductionArrangement,
  scheduleProductionArrangements,
} from '@/lib/daily-plan-service';
import { assertProductionScopeWrite, resolveProductionEntityScope } from '@/lib/production-access-scope';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    assertDailyPlanEnabled();
    assertDailyPlanMutationRequest(request);
    const user = await requireUser({ write: 'self' });
    assertProductionScopeWrite(resolveProductionEntityScope(user));
    const body = asRecord(await request.json());
    const action = asString(body.action || 'schedule').toLowerCase();
    const idempotencyKey = asString(readIdempotencyKey(request, body));
    if (action === 'continue') {
      const result = asRecord(await continueProductionArrangement({
        actorUserId: user.id,
        sourceTaskIds: asStringArray(body.sourceTaskIds) || [],
        targetDate: asString(body.workDate || body.targetDate),
        shiftCode: asOptionalString(body.shiftCode),
        employeeIds: asStringArray(body.employeeIds) || [],
        reason: asOptionalString(body.reason),
        idempotencyKey,
      }));
      return dailyPlanSuccess({
        planId: asString(asRecord(result.plan).id),
        taskIds: result.taskIds,
      }, 201);
    }
    if (action !== 'schedule') {
      throw Object.assign(new Error('不支持的生产安排操作'), { status: 400, code: 'DAILY_PLAN_ACTION_INVALID' });
    }
    const result = asRecord(await scheduleProductionArrangements({
      actorUserId: user.id,
      workDate: asString(body.workDate),
      shiftCode: asOptionalString(body.shiftCode),
      teamId: asString(body.teamId),
      workOrderIds: asStringArray(body.workOrderIds) || [],
      employeeIds: asStringArray(body.employeeIds) || [],
      stepIds: asStringArray(body.stepIds),
      includeWaitingUpstream: body.includeWaitingUpstream !== false,
      reason: asOptionalString(body.reason),
      idempotencyKey,
    }));
    return dailyPlanSuccess({
      planId: asString(asRecord(result.plan).id),
      taskIds: result.taskIds,
      warnings: result.warnings,
    }, 201);
  } catch (error) {
    return dailyPlanError(error, 'save production arrangements');
  }
}
