import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import {
  assertDailyPlanMutationRequest,
  dailyPlanError,
  dailyPlanSuccess,
  readIdempotencyKey,
} from '@/lib/daily-plan-api';
import { assertDailyPlanEnabled } from '@/lib/daily-plan-feature';
import { asNumber, asOptionalString, asRecord, asString, asStringArray } from '@/lib/daily-plan-route-support';
import { reassignProductionArrangementRemaining } from '@/lib/daily-plan-service';
import { assertProductionScopeWrite, resolveProductionEntityScope } from '@/lib/production-access-scope';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function expectedTasks(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map(item => {
    const row = asRecord(item);
    return {
      taskId: asString(row.taskId),
      taskVersion: asNumber(row.taskVersion, -1),
      planVersion: asNumber(row.planVersion, -1),
      completedQty: asNumber(row.completedQty, -1),
      assignmentVersions: Array.isArray(row.assignmentVersions)
        ? row.assignmentVersions.map(assignment => {
            const assignmentRow = asRecord(assignment);
            return {
              assignmentId: asString(assignmentRow.assignmentId),
              version: asNumber(assignmentRow.version, -1),
            };
          })
        : [],
    };
  });
}

export async function POST(request: NextRequest) {
  try {
    assertDailyPlanEnabled();
    assertDailyPlanMutationRequest(request);
    const user = await requireUser({ write: 'self' });
    assertProductionScopeWrite(resolveProductionEntityScope(user));
    const body = asRecord(await request.json());
    const data = await reassignProductionArrangementRemaining({
      actorUserId: user.id,
      taskIds: asStringArray(body.taskIds) || [],
      sourceEmployeeId: asOptionalString(body.sourceEmployeeId),
      targetEmployeeIds: asStringArray(body.targetEmployeeIds) || [],
      expectedTasks: expectedTasks(body.expectedTasks),
      reasonCode: asOptionalString(body.reasonCode),
      reason: asOptionalString(body.reason),
      idempotencyKey: asString(readIdempotencyKey(request, body)),
    });
    return dailyPlanSuccess(data);
  } catch (error) {
    return dailyPlanError(error, 'reassign production arrangement remaining quantity');
  }
}
