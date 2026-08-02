import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import {
  assertDailyPlanMutationRequest,
  dailyPlanError,
  dailyPlanSuccess,
  readIdempotencyKey,
} from '@/lib/daily-plan-api';
import { assertDailyPlanEnabled } from '@/lib/daily-plan-feature';
import { presentOrganization } from '@/lib/daily-plan-presenter';
import { asNumber, asOptionalString, asRecord, asString } from '@/lib/daily-plan-route-support';
import {
  listProductionPlanningOrganization,
  upsertProductionPlanningMembership,
  upsertProductionTeam,
} from '@/lib/daily-plan-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    assertDailyPlanEnabled();
    const user = await requireUser();
    const organization = await listProductionPlanningOrganization({
      actorUserId: user.id,
      workDate: request.nextUrl.searchParams.get('date') || undefined,
      includeInactive: request.nextUrl.searchParams.get('includeInactive') === 'true',
    });
    return dailyPlanSuccess(presentOrganization(organization));
  } catch (error) {
    return dailyPlanError(error, 'list daily plan organization');
  }
}

export async function PUT(request: NextRequest) {
  try {
    assertDailyPlanEnabled();
    assertDailyPlanMutationRequest(request);
    const user = await requireUser({ write: 'self' });
    const body = asRecord(await request.json());
    const action = asString(body.action);
    const idempotencyKey = asString(readIdempotencyKey(request, body));
    const expectedVersion = body.expectedVersion === undefined
      ? undefined
      : asNumber(body.expectedVersion, -1);

    if (action === 'upsertTeam') {
      await upsertProductionTeam({
        actorUserId: user.id,
        teamId: asOptionalString(body.teamId),
        code: asString(body.code),
        name: asString(body.name),
        legacyTeamName: asOptionalString(body.legacyTeamName) || null,
        isActive: body.isActive === undefined ? undefined : Boolean(body.isActive),
        sortOrder: body.sortOrder === undefined ? undefined : asNumber(body.sortOrder),
        expectedVersion,
        idempotencyKey,
      });
    } else if (action === 'upsertMembership') {
      const role = asString(body.role);
      if (role !== 'WORKSHOP_SUPERVISOR' && role !== 'TEAM_LEADER' && role !== 'MEMBER') {
        throw Object.assign(new Error('生产排程角色无效'), { status: 400, code: 'DAILY_PLAN_ROLE_INVALID' });
      }
      await upsertProductionPlanningMembership({
        actorUserId: user.id,
        membershipId: asOptionalString(body.membershipId),
        employeeId: asString(body.employeeId),
        teamId: asOptionalString(body.teamId) || null,
        role,
        isActive: body.isActive === undefined ? undefined : Boolean(body.isActive),
        effectiveFrom: asString(body.effectiveFrom),
        effectiveTo: asOptionalString(body.effectiveTo) || null,
        expectedVersion,
        idempotencyKey,
      });
    } else {
      throw Object.assign(new Error('不支持的生产组织操作'), { status: 400, code: 'DAILY_PLAN_ORGANIZATION_ACTION_INVALID' });
    }

    const organization = await listProductionPlanningOrganization({
      actorUserId: user.id,
      includeInactive: true,
    });
    return dailyPlanSuccess(presentOrganization(organization));
  } catch (error) {
    return dailyPlanError(error, 'update daily plan organization');
  }
}
