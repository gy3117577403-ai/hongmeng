import { AccessProfileKey, AccountStatus, LaborAccessRole, Prisma } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import {
  forbidden,
  ForbiddenError,
  requireAdmin,
  unauthorized,
  UnauthorizedError,
} from '@/lib/auth';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';
import { assertSameOriginMutationRequest } from '@/lib/request-origin';
import { createSystemNotification } from '@/lib/system-notifications';
import {
  AccessGrantInputError,
  adminUserInclude,
  assertEmployeeRebindAllowed,
  legacyLaborRoleForProfile,
  parseAccessProfileKey,
  prepareAccessGrant,
  reconcileFieldReportPinEligibility,
  serializeAdminUser,
  type AccessGrantInput,
} from '@/lib/user-access-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function parseLaborRole(value: unknown): LaborAccessRole | null {
  return value === LaborAccessRole.ADMIN
    || value === LaborAccessRole.TEAM_LEAD
    || value === LaborAccessRole.EMPLOYEE
    ? value
    : null;
}

function parseAccountStatus(value: unknown): AccountStatus | null {
  return Object.values(AccountStatus).includes(value as AccountStatus) ? value as AccountStatus : null;
}

function inferProfile(
  role: LaborAccessRole,
  departmentCode?: string | null,
): AccessProfileKey {
  if (role === LaborAccessRole.ADMIN) return AccessProfileKey.ADMIN_GLOBAL;
  if (role === LaborAccessRole.TEAM_LEAD) return AccessProfileKey.WORKSHOP_TEAM_LEADER;
  if (departmentCode === 'FINANCE') return AccessProfileKey.FINANCE_ACCOUNT_ONLY;
  if (departmentCode === 'GM_OFFICE') return AccessProfileKey.GM_OFFICE_READER_APPROVER;
  if (departmentCode === 'PRODUCTION') return AccessProfileKey.FIELD_REPORTER;
  return AccessProfileKey.DEPARTMENT_FULL;
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    assertSameOriginMutationRequest(request);
    const current = await requireAdmin();
    const body = await request.json().catch(() => ({})) as {
      displayName?: string;
      isActive?: boolean;
      accountStatus?: unknown;
      laborRole?: unknown;
      employeeId?: unknown;
    } & AccessGrantInput;
    let changedFields: string[] = [];
    let disabledByRequest = false;

    const user = await prisma.$transaction(async tx => {
      const old = await tx.user.findUnique({ where: { id: params.id }, include: adminUserInclude });
      if (!old) return NextResponse.json({ ok: false, error: '账号不存在' }, { status: 404 });

      const requestedRole = body.laborRole === undefined ? null : parseLaborRole(body.laborRole);
      if (body.laborRole !== undefined && !requestedRole) {
        return NextResponse.json({ ok: false, error: '兼容账号角色不正确' }, { status: 400 });
      }
      const requestedStatus = body.accountStatus === undefined ? null : parseAccountStatus(body.accountStatus);
      if (body.accountStatus !== undefined && !requestedStatus) {
        return NextResponse.json({ ok: false, error: '账号状态不正确' }, { status: 400 });
      }
      const requestedEmployeeId = body.employeeId === undefined
        ? old.employeeId
        : String(body.employeeId || '').trim() || null;
      const employee = requestedEmployeeId
        ? await tx.employee.findFirst({
          where: { id: requestedEmployeeId, isActive: true },
          select: {
            id: true,
            departmentId: true,
            team: true,
            departmentRef: { select: { code: true } },
          },
        })
        : null;
      if (requestedEmployeeId && !employee) {
        return NextResponse.json({ ok: false, error: '请选择有效的在职员工档案' }, { status: 400 });
      }

      const currentPrimary = old.accessGrants.find(grant => grant.grantType === 'PRIMARY' && grant.isActive);
      const explicitProfile = body.profileKey === undefined ? null : parseAccessProfileKey(body.profileKey);
      if (body.profileKey !== undefined && !explicitProfile) {
        return NextResponse.json({ ok: false, error: '请选择有效的权限模板' }, { status: 400 });
      }
      const compatibilityRole = requestedRole || old.laborRole;
      const profile = explicitProfile
        || currentPrimary?.profile
        || inferProfile(compatibilityRole, employee?.departmentRef?.code);
      const nextRole = legacyLaborRoleForProfile(profile);
      const nextEmployeeId = profile === AccessProfileKey.ADMIN_GLOBAL ? null : requestedEmployeeId;
      if (profile !== AccessProfileKey.ADMIN_GLOBAL && !nextEmployeeId) {
        return NextResponse.json({ ok: false, error: '普通账号必须绑定在职员工档案' }, { status: 400 });
      }
      assertEmployeeRebindAllowed(old.employeeId, nextEmployeeId, old.accessGrants);

      const nextIsActive = body.isActive === undefined
        ? requestedStatus
          ? requestedStatus === AccountStatus.ACTIVE
          : old.isActive
        : body.isActive;
      const nextStatus = requestedStatus
        || (nextIsActive ? AccountStatus.ACTIVE : AccountStatus.DISABLED);
      const removesActiveAdmin = old.isActive
        && old.laborRole === LaborAccessRole.ADMIN
        && (!nextIsActive || nextRole !== LaborAccessRole.ADMIN);
      if (removesActiveAdmin) {
        const activeAdminCount = await tx.user.count({
          where: {
            isActive: true,
            accountStatus: AccountStatus.ACTIVE,
            laborRole: LaborAccessRole.ADMIN,
            id: { not: old.id },
          },
        });
        if (activeAdminCount <= 0) {
          return NextResponse.json({ ok: false, error: '不能禁用或降级最后一个启用的管理员账号' }, { status: 400 });
        }
      }

      const accessChanged = body.profileKey !== undefined
        || body.departmentId !== undefined
        || body.grantType !== undefined
        || body.effectiveFrom !== undefined
        || body.effectiveTo !== undefined
        || body.employeeId !== undefined
        || body.laborRole !== undefined;
      const securityChanged = accessChanged
        || nextIsActive !== old.isActive
        || nextStatus !== old.accountStatus;
      const data: Prisma.UserUncheckedUpdateInput = {
        ...(body.displayName !== undefined
          ? { displayName: String(body.displayName || '').trim().slice(0, 80) || old.username }
          : {}),
        isActive: nextIsActive,
        accountStatus: nextStatus,
        laborRole: nextRole,
        employeeId: nextEmployeeId,
        ...(securityChanged ? { sessionVersion: { increment: 1 } } : {}),
      };
      changedFields = [
        ...(body.displayName !== undefined ? ['displayName'] : []),
        ...(securityChanged ? ['account', 'access', 'sessionVersion'] : []),
      ];
      disabledByRequest = !nextIsActive;
      await tx.user.update({ where: { id: old.id }, data });

      if (accessChanged) {
        const grant = await prepareAccessGrant(tx, { ...body, profileKey: profile }, employee);
        if (grant.grantType !== 'PRIMARY') {
          throw new AccessGrantInputError('主权限编辑不能改为兼岗或代班，请使用追加授权');
        }
        await tx.userAccessGrant.updateMany({
          where: { userId: old.id, grantType: 'PRIMARY', isActive: true },
          data: { isActive: false, version: { increment: 1 } },
        });
        await tx.userAccessGrant.create({
          data: {
            userId: old.id,
            ...grant,
            grantedById: current.id,
          },
        });
      }

      if (securityChanged) {
        const lifecycleNow = new Date();
        await reconcileFieldReportPinEligibility(tx, old.employeeId, {
          now: lifecycleNow,
          resetById: current.id,
        });
        if (nextEmployeeId !== old.employeeId) {
          await reconcileFieldReportPinEligibility(tx, nextEmployeeId, {
            now: lifecycleNow,
            resetById: current.id,
          });
        }
      }

      const saved = await tx.user.findUniqueOrThrow({ where: { id: old.id }, include: adminUserInclude });
      if (securityChanged && saved.isActive && saved.accountStatus === AccountStatus.ACTIVE) {
        await createSystemNotification(tx, {
          eventType: nextIsActive !== old.isActive ? 'ACCOUNT_REENABLED' : 'ACCOUNT_ACCESS_UPDATED',
          dedupeKey: `account:${saved.id}:security-version:${saved.sessionVersion}`,
          category: 'ACCOUNT',
          priority: 'HIGH',
          title: nextIsActive !== old.isActive ? '你的系统账号已重新启用' : '你的账号权限已更新',
          body: '权限变更已生效，请按当前部门、兼岗或代班范围使用系统。',
          targetRoute: '/account',
          sourceType: 'user',
          sourceId: saved.id,
          actorId: current.id,
          recipientUserIds: [saved.id],
        });
      }
      return saved;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    if (user instanceof NextResponse) return user;
    await logOp({
      userId: current.id,
      action: disabledByRequest ? 'disable_user' : 'update_user',
      targetType: 'user',
      targetId: user.id,
      detail: {
        username: user.username,
        laborRole: user.laborRole,
        employeeId: user.employeeId,
        accountStatus: user.accountStatus,
        profileKey: user.accessGrants.find(grant => grant.grantType === 'PRIMARY' && grant.isActive)?.profile,
        fields: changedFields,
      },
    });
    return NextResponse.json({ ok: true, user: serializeAdminUser(user) });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof ForbiddenError) return forbidden('只有管理员可以编辑账号');
    if (error instanceof AccessGrantInputError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    if ((error as { code?: string }).code === 'P2002') {
      return NextResponse.json({ ok: false, error: '该员工已绑定其他账号，或授权记录重复' }, { status: 409 });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
      return NextResponse.json({ ok: false, error: '账号权限已被其他操作更新，请刷新后重试' }, { status: 409 });
    }
    console.error('update account failed', error);
    return NextResponse.json({ ok: false, error: '保存账号失败' }, { status: 500 });
  }
}
