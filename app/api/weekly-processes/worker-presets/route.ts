import { NextRequest } from 'next/server';
import { ForbiddenError, requireUser } from '@/lib/auth';
import {
  assertDailyPlanMutationRequest,
  dailyPlanError,
  dailyPlanSuccess,
} from '@/lib/daily-plan-api';
import { assertDailyPlanEnabled } from '@/lib/daily-plan-feature';
import { productionPlanningDateBoundary } from '@/lib/production-planning-date';
import {
  listWeeklyProcessWorkerPresets,
  saveWeeklyProcessWorkerPreset,
} from '@/lib/weekly-process-worker-preset-service';
import { assertProductionScopeRead, resolveProductionEntityScope } from '@/lib/production-access-scope';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function validDate(value: unknown): string {
  const date = String(value || productionPlanningDateBoundary()).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw Object.assign(new Error('周日期必须为 YYYY-MM-DD'), {
      status: 400,
      code: 'WEEK_DATE_INVALID',
    });
  }
  return date;
}

async function authorizedUser() {
  assertDailyPlanEnabled();
  const user = await requireUser();
  const productionScope = resolveProductionEntityScope(user);
  assertProductionScopeRead(productionScope);
  if (!user.canAccessDailyPlans) throw new ForbiddenError('当前账号不能访问生产排程');
  return { user, productionScope };
}

export async function GET(request: NextRequest) {
  try {
    await authorizedUser();
    const weekDate = validDate(request.nextUrl.searchParams.get('date'));
    return dailyPlanSuccess(await listWeeklyProcessWorkerPresets(weekDate));
  } catch (error) {
    return dailyPlanError(error, 'weekly process worker preset list');
  }
}

export async function PUT(request: NextRequest) {
  try {
    assertDailyPlanMutationRequest(request);
    const { user, productionScope } = await authorizedUser();
    if (productionScope.level === 'TEAM') {
      throw new ForbiddenError('班组长不能修改影响全车间的工序预选人员');
    }
    const body = await request.json() as Record<string, unknown>;
    const data = await saveWeeklyProcessWorkerPreset({
      weekDate: validDate(body.weekDate || body.date),
      processKey: body.processKey,
      stepId: body.stepId,
      employeeIds: body.employeeIds,
      expectedVersion: body.expectedVersion,
      actorId: user.id,
    });
    return dailyPlanSuccess(data);
  } catch (error) {
    return dailyPlanError(error, 'weekly process worker preset save');
  }
}

export async function DELETE(request: NextRequest) {
  try {
    assertDailyPlanMutationRequest(request);
    const { user, productionScope } = await authorizedUser();
    if (productionScope.level === 'TEAM') {
      throw new ForbiddenError('班组长不能修改影响全车间的工序预选人员');
    }
    const data = await saveWeeklyProcessWorkerPreset({
      weekDate: validDate(request.nextUrl.searchParams.get('date')),
      processKey: request.nextUrl.searchParams.get('processKey'),
      stepId: request.nextUrl.searchParams.get('stepId'),
      employeeIds: [],
      expectedVersion: request.nextUrl.searchParams.get('expectedVersion'),
      actorId: user.id,
    });
    return dailyPlanSuccess(data);
  } catch (error) {
    return dailyPlanError(error, 'weekly process worker preset delete');
  }
}
