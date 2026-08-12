import bcrypt from 'bcryptjs';
import { AccessProfileKey, LaborAccessRole, Prisma } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import {
  forbidden,
  ForbiddenError,
  requireAdmin,
  unauthorized,
  UnauthorizedError,
} from '@/lib/auth';
import { logOp } from '@/lib/logs';
import { FIELD_REPORT_DEFAULT_PASSWORD } from '@/lib/login-security';
import { validateNewPassword } from '@/lib/password-policy';
import { prisma } from '@/lib/prisma';
import { assertSameOriginMutationRequest } from '@/lib/request-origin';
import { createSystemNotification } from '@/lib/system-notifications';
import {
  AccessGrantInputError,
  adminUserInclude,
  departmentListSelect,
  legacyLaborRoleForProfile,
  parseAccessProfileKey,
  prepareAccessGrant,
  serializeAdminUser,
  syncAccountFieldReportGrant,
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

function inferredProfile(
  requestedProfile: unknown,
  legacyRole: LaborAccessRole,
  departmentCode?: string | null,
): AccessProfileKey {
  const explicit = parseAccessProfileKey(requestedProfile);
  if (explicit) return explicit;
  if (legacyRole === LaborAccessRole.ADMIN) return AccessProfileKey.ADMIN_GLOBAL;
  if (legacyRole === LaborAccessRole.TEAM_LEAD) return AccessProfileKey.WORKSHOP_TEAM_LEADER;
  if (departmentCode === 'FINANCE') return AccessProfileKey.FINANCE_ACCOUNT_ONLY;
  if (departmentCode === 'GM_OFFICE') return AccessProfileKey.GM_OFFICE_READER_APPROVER;
  if (departmentCode === 'PROCESS') return AccessProfileKey.PROCESS_SPECIALIST;
  if (departmentCode === 'PRODUCTION') return AccessProfileKey.FIELD_REPORTER;
  return AccessProfileKey.DEPARTMENT_FULL;
}

export async function GET() {
  try {
    await requireAdmin();
    const [users, departments, productionTeams] = await Promise.all([
      prisma.user.findMany({
        include: adminUserInclude,
        orderBy: [{ isActive: 'desc' }, { createdAt: 'asc' }],
      }),
      prisma.department.findMany({
        select: departmentListSelect,
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      }),
      prisma.productionTeam.findMany({
        where: { isActive: true },
        select: { id: true, code: true, name: true, legacyTeamName: true },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      }),
    ]);
    return NextResponse.json({
      ok: true,
      users: users.map(user => serializeAdminUser(user, { productionTeams })),
      departments,
      productionTeams,
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof ForbiddenError) return forbidden('只有管理员可以查看账号');
    console.error('account list failed', error);
    return NextResponse.json({ ok: false, error: '账号列表加载失败' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    assertSameOriginMutationRequest(request);
    const current = await requireAdmin();
    const body = await request.json().catch(() => ({})) as {
      username?: string;
      displayName?: string;
      password?: string;
      fieldReportEnabled?: unknown;
      mustChangePassword?: unknown;
      laborRole?: unknown;
      employeeId?: unknown;
    } & AccessGrantInput;
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    const employeeId = String(body.employeeId || '').trim() || null;
    if (!username) return NextResponse.json({ ok: false, error: '账号不能为空' }, { status: 400 });
    const user = await prisma.$transaction(async tx => {
      const employee = employeeId
        ? await tx.employee.findFirst({
          where: { id: employeeId, isActive: true },
          select: {
            id: true,
            name: true,
            departmentId: true,
            team: true,
            departmentRef: { select: { code: true } },
          },
        })
        : null;
      if (employeeId && !employee) throw new AccessGrantInputError('请选择有效的在职员工档案');
      const legacyRole = parseLaborRole(body.laborRole) || LaborAccessRole.EMPLOYEE;
      const profile = inferredProfile(body.profileKey, legacyRole, employee?.departmentRef?.code);
      if (profile !== AccessProfileKey.FIELD_REPORTER) {
        const passwordError = validateNewPassword(password, username);
        if (passwordError) throw new AccessGrantInputError(passwordError);
      }
      const grant = await prepareAccessGrant(tx, { ...body, profileKey: profile }, employee);
      if (grant.grantType !== 'PRIMARY') {
        throw new AccessGrantInputError('新账号必须先建立主部门权限，兼岗和代班请在账号开通后追加');
      }
      const resolvedRole = legacyLaborRoleForProfile(profile);
      const isFieldOnlyAccount = profile === AccessProfileKey.FIELD_REPORTER;
      const fieldReportEnabled = isFieldOnlyAccount || body.fieldReportEnabled === true;
      const mustChangePassword = !isFieldOnlyAccount && body.mustChangePassword === true;
      const passwordMaterial = isFieldOnlyAccount ? FIELD_REPORT_DEFAULT_PASSWORD : password;
      const created = await tx.user.create({
        data: {
          username,
          displayName: (String(body.displayName || '').trim() || employee?.name || username).slice(0, 80),
          passwordHash: await bcrypt.hash(passwordMaterial, 10),
          isActive: true,
          accountStatus: 'ACTIVE',
          mustChangePassword,
          fieldPasswordOnly: isFieldOnlyAccount,
          laborRole: resolvedRole,
          employeeId: profile === AccessProfileKey.ADMIN_GLOBAL ? null : employeeId,
        },
      });
      await tx.userAccessGrant.create({
        data: {
          userId: created.id,
          ...grant,
          grantedById: current.id,
        },
      });
      await syncAccountFieldReportGrant(tx, {
        userId: created.id,
        employee,
        enabled: fieldReportEnabled,
        primaryProfile: profile,
        departmentId: grant.departmentId,
        effectiveFrom: body.effectiveFrom,
        grantedById: current.id,
      });
      if (profile !== AccessProfileKey.FIELD_REPORTER) {
        await createSystemNotification(tx, {
          eventType: 'ACCOUNT_CREATED',
          dedupeKey: `account:${created.id}:created`,
          category: 'ACCOUNT',
          priority: 'HIGH',
          title: '你的系统账号已开通',
          body: mustChangePassword
            ? '首次登录后请先修改临时密码，再进入已授权的工作台。'
            : `账号已开通，可使用${fieldReportEnabled ? '后台工作台和扫码报工' : '后台工作台'}。`,
          targetRoute: '/account',
          sourceType: 'user',
          sourceId: created.id,
          actorId: current.id,
          recipientUserIds: [created.id],
        });
      }
      return tx.user.findUniqueOrThrow({ where: { id: created.id }, include: adminUserInclude });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    await logOp({
      userId: current.id,
      action: 'create_user',
      targetType: 'user',
      targetId: user.id,
      detail: {
        username,
        laborRole: user.laborRole,
        employeeId: user.employeeId,
        profileKey: user.accessGrants[0]?.profile,
        departmentId: user.accessGrants[0]?.departmentId,
        fieldReportEnabled: user.accessGrants.some(grant => grant.profile === AccessProfileKey.FIELD_REPORTER),
      },
    });
    return NextResponse.json({ ok: true, user: serializeAdminUser(user) }, { status: 201 });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof ForbiddenError) return forbidden('只有管理员可以新增账号');
    if (error instanceof AccessGrantInputError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    if ((error as { code?: string }).code === 'P2002') {
      return NextResponse.json({ ok: false, error: '账号已存在，或该员工已绑定其他账号' }, { status: 409 });
    }
    console.error('create account failed', error);
    return NextResponse.json({ ok: false, error: '新增账号失败' }, { status: 500 });
  }
}
