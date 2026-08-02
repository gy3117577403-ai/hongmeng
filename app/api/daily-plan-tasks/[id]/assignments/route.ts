import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import { assertDailyPlanMutationRequest, dailyPlanError, dailyPlanSuccess, readExpectedVersion, readIdempotencyKey } from '@/lib/daily-plan-api';
import { assertDailyPlanEnabled } from '@/lib/daily-plan-feature';
import { asNumber, asOptionalString, asRecord, asString } from '@/lib/daily-plan-route-support';
import {
  assignDailyProcessTask,
  cancelDailyTaskAssignment,
  reorderEmployeeDailyTaskAssignments,
  updateDailyTaskAssignment,
} from '@/lib/daily-plan-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type AssignmentBody = { assignmentId?: unknown; expectedVersion?: unknown; employeeId?: unknown; quantity?: unknown; sortOrder?: unknown; regularStartAt?: unknown; regularEndAt?: unknown; overtimeStartAt?: unknown; overtimeEndAt?: unknown };

function assignmentsFrom(value: unknown): AssignmentBody[] {
  return Array.isArray(value) ? value.map(item => asRecord(item)) : [];
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    assertDailyPlanEnabled();
    assertDailyPlanMutationRequest(request);
    const user = await requireUser({ write: 'self' });
    const body = asRecord(await request.json());
    const result = asRecord(await assignDailyProcessTask({
      actorUserId: user.id,
      taskId: params.id,
      expectedVersion: asNumber(readExpectedVersion(body), -1),
      idempotencyKey: asString(readIdempotencyKey(request, body)),
      assignments: assignmentsFrom(body.assignments).map((item, index) => ({
        employeeId: asString(item.employeeId),
        quantity: asNumber(item.quantity),
        sortOrder: asNumber(item.sortOrder, index + 1),
        regularStartAt: asOptionalString(item.regularStartAt),
        regularEndAt: asOptionalString(item.regularEndAt),
        overtimeStartAt: asOptionalString(item.overtimeStartAt),
        overtimeEndAt: asOptionalString(item.overtimeEndAt),
      })),
    }));
    return dailyPlanSuccess({ version: asNumber(result.version) }, 201);
  } catch (error) {
    return dailyPlanError(error, 'assign daily process task');
  }
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    assertDailyPlanEnabled();
    assertDailyPlanMutationRequest(request);
    const user = await requireUser({ write: 'self' });
    const body = asRecord(await request.json());
    const action = asString(body.action).toLowerCase();
    const rows = assignmentsFrom(body.assignments);
    const idempotencyKey = asString(readIdempotencyKey(request, body));
    const expectedTaskVersion = asNumber(readExpectedVersion(body), -1);
    if (action === 'reorder') {
      const result = asRecord(await reorderEmployeeDailyTaskAssignments({
        actorUserId: user.id,
        anchorTaskId: params.id,
        expectedTaskVersion,
        reason: asString(body.reason),
        idempotencyKey,
        assignments: rows.map(item => ({
          assignmentId: asString(item.assignmentId),
          expectedVersion: asNumber(item.expectedVersion, -1),
          sortOrder: asNumber(item.sortOrder),
        })),
      }));
      return dailyPlanSuccess({ version: asNumber(result.version) });
    }
    const row = rows[0];
    const assignmentId = asString(row?.assignmentId);
    if (!assignmentId) {
      throw Object.assign(new Error('任务分配记录不存在'), { status: 404, code: 'DAILY_PLAN_ASSIGNMENT_NOT_FOUND' });
    }
    const assignmentExpectedVersion = asNumber(row?.expectedVersion, -1);
    if (action === 'withdraw') {
      const result = asRecord(await cancelDailyTaskAssignment({
        actorUserId: user.id,
        taskId: params.id,
        expectedTaskVersion,
        assignmentId,
        expectedVersion: assignmentExpectedVersion,
        reason: asString(body.reason),
        idempotencyKey,
      }));
      return dailyPlanSuccess({ version: asNumber(result.version) });
    }
    if (action === 'adjust') {
      const result = asRecord(await updateDailyTaskAssignment({
        actorUserId: user.id,
        taskId: params.id,
        expectedTaskVersion,
        assignmentId,
        expectedVersion: assignmentExpectedVersion,
        employeeId: asOptionalString(row.employeeId),
        quantity: row.quantity === undefined ? undefined : asNumber(row.quantity),
        sortOrder: row.sortOrder === undefined ? undefined : asNumber(row.sortOrder),
        regularStartAt: row.regularStartAt === undefined ? undefined : asOptionalString(row.regularStartAt) || null,
        regularEndAt: row.regularEndAt === undefined ? undefined : asOptionalString(row.regularEndAt) || null,
        overtimeStartAt: row.overtimeStartAt === undefined ? undefined : asOptionalString(row.overtimeStartAt) || null,
        overtimeEndAt: row.overtimeEndAt === undefined ? undefined : asOptionalString(row.overtimeEndAt) || null,
        reason: asString(body.reason),
        idempotencyKey,
      }));
      return dailyPlanSuccess({ version: asNumber(result.version) });
    }
    throw Object.assign(new Error('不支持的任务分配操作'), { status: 400, code: 'DAILY_PLAN_ACTION_INVALID' });
  } catch (error) {
    return dailyPlanError(error, 'mutate daily task assignments');
  }
}
