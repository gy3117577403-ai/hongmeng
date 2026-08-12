import {
  AccessGrantType,
  AccessProfileKey,
  AccountStatus,
  LaborAccessRole,
  Prisma,
} from '@prisma/client';
import { requiresAdminPasswordSetup } from '@/lib/login-security';
import { productionEmployeeWhere } from '@/lib/production-workforce';

export { requiresAdminPasswordSetup } from '@/lib/login-security';

export const adminUserInclude = {
  employee: {
    select: {
      id: true,
      employeeNo: true,
      name: true,
      department: true,
      departmentId: true,
      position: true,
      team: true,
      mobile: true,
      isActive: true,
      fieldReportPinCredential: {
        select: {
          isActive: true,
          lockedUntil: true,
          lastUsedAt: true,
          resetAt: true,
          updatedAt: true,
        },
      },
      departmentRef: { select: { id: true, code: true, name: true } },
    },
  },
  accessGrants: {
    include: { department: { select: { id: true, code: true, name: true } } },
    orderBy: [{ isActive: 'desc' }, { grantType: 'asc' }, { effectiveFrom: 'desc' }],
  },
} satisfies Prisma.UserInclude;

export type AdminUserRecord = Prisma.UserGetPayload<{ include: typeof adminUserInclude }>;

export const departmentListSelect = {
  id: true,
  code: true,
  name: true,
  isActive: true,
  sortOrder: true,
} as const;

export type ProductionTeamIdentity = {
  id: string;
  code: string;
  name: string;
  legacyTeamName: string | null;
};

type TeamGrantSyncRecord = {
  profile: AccessProfileKey;
  grantType: AccessGrantType;
  scopeKey: string;
};

function normalizedTeamIdentity(value: unknown): string {
  return String(value ?? '').normalize('NFKC').trim().toLocaleLowerCase('zh-CN');
}

/**
 * Reports HR-team drift without changing the effective grant. The explicit
 * TEAM grant remains the sole authorization source until an administrator
 * confirms and replaces it.
 */
export function primaryTeamGrantSyncPending(
  employeeTeam: string | null | undefined,
  activeGrants: readonly TeamGrantSyncRecord[],
  productionTeams: readonly ProductionTeamIdentity[],
): boolean {
  const primaryTeamGrants = activeGrants.filter(grant => (
    grant.profile === AccessProfileKey.WORKSHOP_TEAM_LEADER
    && grant.grantType === AccessGrantType.PRIMARY
  ));
  if (!primaryTeamGrants.length) return false;
  if (primaryTeamGrants.length !== 1) return true;

  const employeeTeamKey = normalizedTeamIdentity(employeeTeam);
  if (!employeeTeamKey) return true;
  const employeeProductionTeam = productionTeams.find(team => (
    [team.id, team.code, team.name, team.legacyTeamName]
      .some(value => normalizedTeamIdentity(value) === employeeTeamKey)
  ));
  if (!employeeProductionTeam) return true;

  const grantTeamKey = normalizedTeamIdentity(
    primaryTeamGrants[0]!.scopeKey.startsWith('TEAM:')
      ? primaryTeamGrants[0]!.scopeKey.slice('TEAM:'.length)
      : '',
  );
  return ![employeeProductionTeam.id, employeeProductionTeam.code, employeeProductionTeam.name,
    employeeProductionTeam.legacyTeamName]
    .some(value => normalizedTeamIdentity(value) === grantTeamKey);
}

export function serializeAccessGrant(grant: AdminUserRecord['accessGrants'][number]) {
  return {
    id: grant.id,
    profileKey: grant.profile,
    departmentId: grant.departmentId,
    department: grant.department,
    scopeKey: grant.scopeKey,
    grantType: grant.grantType,
    effectiveFrom: grant.effectiveFrom.toISOString(),
    effectiveTo: grant.effectiveTo?.toISOString() || null,
    isActive: grant.isActive,
    version: grant.version,
    grantedById: grant.grantedById,
    createdAt: grant.createdAt.toISOString(),
    updatedAt: grant.updatedAt.toISOString(),
  };
}

export function serializeAdminUser(
  user: AdminUserRecord,
  options: {
    now?: Date;
    productionTeams?: readonly ProductionTeamIdentity[];
  } = {},
) {
  const now = options.now?.getTime() ?? Date.now();
  const activeGrants = user.accessGrants.filter(grant => (
    grant.isActive
    && grant.effectiveFrom.getTime() <= now
    && (!grant.effectiveTo || grant.effectiveTo.getTime() > now)
  ));
  const primaryDepartmentGrant = activeGrants.find(grant => (
    grant.grantType === 'PRIMARY'
    && grant.departmentId
  ));
  const profiles = new Set(activeGrants.map(grant => grant.profile));
  const departmentNeedsSync = Boolean(
    user.employee
    && user.employee.isActive
    && !profiles.has(AccessProfileKey.ADMIN_GLOBAL)
    && (
      !primaryDepartmentGrant
      || primaryDepartmentGrant.departmentId !== user.employee.departmentId
    ),
  );
  const teamNeedsSync = Boolean(
    user.employee
    && user.employee.isActive
    && options.productionTeams
    && primaryTeamGrantSyncPending(
      user.employee.team,
      activeGrants,
      options.productionTeams,
    )
  );
  const pinCredential = user.employee?.fieldReportPinCredential ?? null;
  const pinLockedUntil = pinCredential?.lockedUntil ?? null;
  const fieldPin = {
    configured: Boolean(pinCredential),
    isActive: Boolean(pinCredential?.isActive),
    isLocked: Boolean(pinLockedUntil && pinLockedUntil.getTime() > now),
    lockedUntil: pinLockedUntil?.toISOString() || null,
    lastUsedAt: pinCredential?.lastUsedAt?.toISOString() || null,
    resetAt: pinCredential?.resetAt.toISOString() || null,
    updatedAt: pinCredential?.updatedAt.toISOString() || null,
  };
  const employee = user.employee ? {
    id: user.employee.id,
    employeeNo: user.employee.employeeNo,
    name: user.employee.name,
    department: user.employee.department,
    departmentId: user.employee.departmentId,
    position: user.employee.position,
    team: user.employee.team,
    isActive: user.employee.isActive,
    departmentRef: user.employee.departmentRef,
  } : null;
  const passwordSetupRequired = requiresAdminPasswordSetup({
    isActive: user.isActive,
    accountStatus: user.accountStatus,
    mustChangePassword: user.mustChangePassword,
    fieldPasswordOnly: user.fieldPasswordOnly,
    lastLoginAt: user.lastLoginAt,
    accessGrants: user.accessGrants,
  }, new Date(now));
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    isActive: user.isActive,
    accountStatus: user.accountStatus,
    mustChangePassword: user.mustChangePassword,
    fieldPasswordOnly: user.fieldPasswordOnly,
    passwordSetupRequired,
    lastLoginAt: user.lastLoginAt?.toISOString() || null,
    laborRole: user.laborRole,
    employeeId: user.employeeId,
    employee: employee ? {
      ...employee,
      departmentRecord: employee.departmentRef,
    } : null,
    fieldPin,
    accessMethods: {
      workbench: !passwordSetupRequired
        && activeGrants.some(grant => grant.profile !== AccessProfileKey.FIELD_REPORTER),
      fieldReport: profiles.has(AccessProfileKey.FIELD_REPORTER),
      pin: fieldPin.configured && fieldPin.isActive && profiles.has(AccessProfileKey.FIELD_REPORTER),
    },
    permissionSyncPending: departmentNeedsSync || teamNeedsSync,
    accessGrants: user.accessGrants.map(serializeAccessGrant),
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}

export class AccessGrantInputError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

type EmployeeRebindGrant = {
  grantType: AccessGrantType;
  isActive: boolean;
};

/** Explicit additional grants must be revoked before an account changes owner. */
export function assertEmployeeRebindAllowed(
  currentEmployeeId: string | null,
  nextEmployeeId: string | null,
  grants: readonly EmployeeRebindGrant[],
): void {
  if (currentEmployeeId === nextEmployeeId) return;
  const hasActiveAdditionalGrant = grants.some(grant => (
    grant.isActive
    && (grant.grantType === AccessGrantType.CONCURRENT || grant.grantType === AccessGrantType.ACTING)
  ));
  if (hasActiveAdditionalGrant) {
    throw new AccessGrantInputError('该账号仍有启用的兼岗或代班授权，请先撤销后再更换绑定员工', 409);
  }
}

type FieldReportPinLifecycleTransaction = Pick<
  Prisma.TransactionClient,
  'employee' | 'employeeFieldReportPinCredential' | 'fieldReportPinSession'
>;

export type FieldReportPinEligibilityReconcileResult = {
  eligible: boolean;
  pinCredentialDisabled: boolean;
  pinSessionsRevoked: number;
};

/**
 * Fail closed when account or grant administration removes an employee's
 * effective, employee-scoped FIELD_REPORTER access. This helper never
 * re-enables a credential; restoring PIN access always requires an explicit
 * administrator reset.
 */
export async function reconcileFieldReportPinEligibility(
  tx: FieldReportPinLifecycleTransaction,
  employeeId: string | null | undefined,
  options: { now?: Date; resetById?: string | null } = {},
): Promise<FieldReportPinEligibilityReconcileResult> {
  if (!employeeId) {
    return { eligible: false, pinCredentialDisabled: false, pinSessionsRevoked: 0 };
  }

  const now = options.now ?? new Date();
  const employee = await tx.employee.findFirst({
    where: {
      id: employeeId,
      ...productionEmployeeWhere(),
    },
    select: {
      user: {
        select: {
          isActive: true,
          accountStatus: true,
          accessGrants: {
            where: {
              profile: AccessProfileKey.FIELD_REPORTER,
              scopeKey: `EMPLOYEE:${employeeId}`,
              isActive: true,
              effectiveFrom: { lte: now },
              OR: [
                { effectiveTo: null },
                { effectiveTo: { gt: now } },
              ],
            },
            select: { id: true },
            take: 1,
          },
        },
      },
    },
  });
  const eligible = Boolean(
    employee?.user?.isActive
    && employee.user.accountStatus === AccountStatus.ACTIVE
    && employee.user.accessGrants.length > 0,
  );
  if (eligible) {
    return { eligible: true, pinCredentialDisabled: false, pinSessionsRevoked: 0 };
  }

  const [credential, sessions] = await Promise.all([
    tx.employeeFieldReportPinCredential.updateMany({
      where: { employeeId, isActive: true },
      data: {
        isActive: false,
        credentialVersion: { increment: 1 },
        failedAttempts: 0,
        lockedUntil: null,
        resetAt: now,
        ...(options.resetById !== undefined ? { resetById: options.resetById } : {}),
      },
    }),
    tx.fieldReportPinSession.updateMany({
      where: { employeeId, consumedAt: null, revokedAt: null },
      data: { revokedAt: now },
    }),
  ]);
  return {
    eligible: false,
    pinCredentialDisabled: credential.count > 0,
    pinSessionsRevoked: sessions.count,
  };
}

export type AccessGrantInput = {
  profileKey?: unknown;
  departmentId?: unknown;
  targetTeamId?: unknown;
  grantType?: unknown;
  effectiveFrom?: unknown;
  effectiveTo?: unknown;
};

export type AccessGrantEmployee = {
  id: string;
  departmentId: string | null;
  team: string | null;
};

const ACCESS_PROFILE_VALUES = new Set<string>(Object.values(AccessProfileKey));
const ACCESS_GRANT_TYPE_VALUES = new Set<string>(Object.values(AccessGrantType));
const PRODUCTION_ACCESS_PROFILES: readonly AccessProfileKey[] = [
  AccessProfileKey.FIELD_REPORTER,
  AccessProfileKey.WORKSHOP_SUPERVISOR,
  AccessProfileKey.WORKSHOP_TEAM_LEADER,
];

export function parseAccessProfileKey(value: unknown): AccessProfileKey | null {
  const normalized = String(value || '').trim();
  return ACCESS_PROFILE_VALUES.has(normalized) ? normalized as AccessProfileKey : null;
}

export function parseAccessGrantType(value: unknown): AccessGrantType | null {
  const normalized = String(value || '').trim();
  return ACCESS_GRANT_TYPE_VALUES.has(normalized) ? normalized as AccessGrantType : null;
}

export function legacyLaborRoleForProfile(profile: AccessProfileKey): LaborAccessRole {
  if (profile === AccessProfileKey.ADMIN_GLOBAL) return LaborAccessRole.ADMIN;
  if (
    profile === AccessProfileKey.WORKSHOP_SUPERVISOR
    || profile === AccessProfileKey.WORKSHOP_TEAM_LEADER
  ) return LaborAccessRole.TEAM_LEAD;
  return LaborAccessRole.EMPLOYEE;
}

export function accountStatusForActive(isActive: boolean): AccountStatus {
  return isActive ? AccountStatus.ACTIVE : AccountStatus.DISABLED;
}

export function parseAccessStartDate(value: unknown): Date {
  if (value == null || value === '') return new Date();
  const raw = String(value).trim();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(raw)
    ? new Date(`${raw}T00:00:00.000+08:00`)
    : new Date(raw);
  if (!Number.isFinite(date.getTime())) throw new AccessGrantInputError('授权开始时间不正确');
  return date;
}

export function parseAccessEndDate(value: unknown): Date | null {
  if (value == null || value === '') return null;
  const raw = String(value).trim();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(raw)
    ? new Date(`${raw}T23:59:59.999+08:00`)
    : new Date(raw);
  if (!Number.isFinite(date.getTime())) throw new AccessGrantInputError('授权结束时间不正确');
  return date;
}

export async function prepareAccessGrant(
  tx: Prisma.TransactionClient,
  input: AccessGrantInput,
  employee: AccessGrantEmployee | null,
) {
  const profile = parseAccessProfileKey(input.profileKey);
  if (!profile) throw new AccessGrantInputError('请选择有效的权限模板');
  const grantType = parseAccessGrantType(input.grantType) || AccessGrantType.PRIMARY;
  if (profile === AccessProfileKey.ADMIN_GLOBAL && grantType !== AccessGrantType.PRIMARY) {
    throw new AccessGrantInputError('管理员权限不能作为兼岗或代班授权');
  }
  if (profile !== AccessProfileKey.ADMIN_GLOBAL && !employee) {
    throw new AccessGrantInputError('普通账号必须绑定在职员工档案');
  }

  const requestedDepartmentId = String(input.departmentId || '').trim() || null;
  const departmentId = profile === AccessProfileKey.ADMIN_GLOBAL
    ? null
    : requestedDepartmentId || employee?.departmentId || null;
  const department = departmentId
    ? await tx.department.findFirst({ where: { id: departmentId, isActive: true } })
    : null;
  const requiresDepartment = profile !== AccessProfileKey.ADMIN_GLOBAL;
  if (requiresDepartment && !department) {
    throw new AccessGrantInputError('员工尚未设置有效部门，无法开通部门权限');
  }
  if (
    profile === AccessProfileKey.DEPARTMENT_FULL
    && ['PRODUCTION', 'FINANCE', 'GM_OFFICE'].includes(department!.code)
  ) {
    throw new AccessGrantInputError('生产、财务和总经办必须使用对应的专用权限模板');
  }
  if (profile === AccessProfileKey.FINANCE_ACCOUNT_ONLY && department!.code !== 'FINANCE') {
    throw new AccessGrantInputError('财务账号模板只能绑定财务部员工');
  }
  if (profile === AccessProfileKey.GM_OFFICE_READER_APPROVER && department!.code !== 'GM_OFFICE') {
    throw new AccessGrantInputError('总经办模板只能绑定总经办员工');
  }
  if (
    PRODUCTION_ACCESS_PROFILES.includes(profile)
    && department!.code !== 'PRODUCTION'
  ) {
    throw new AccessGrantInputError('生产权限必须选择生产部作为权限部门');
  }
  let targetTeam: { id: string } | null = null;
  if (profile === AccessProfileKey.WORKSHOP_TEAM_LEADER) {
    const requestedTeamId = String(input.targetTeamId || '').trim();
    const employeeTeam = String(employee?.team || '').trim();
    targetTeam = requestedTeamId
      ? await tx.productionTeam.findFirst({
        where: { id: requestedTeamId, isActive: true },
        select: { id: true },
      })
      : employeeTeam
        ? await tx.productionTeam.findFirst({
          where: {
            isActive: true,
            OR: [
              { id: employeeTeam },
              { code: employeeTeam },
              { name: employeeTeam },
              { legacyTeamName: employeeTeam },
            ],
          },
          select: { id: true },
        })
        : null;
    if (!targetTeam) {
      throw new AccessGrantInputError('车间组长权限必须选择有效的目标班组');
    }
  }

  const effectiveFrom = parseAccessStartDate(input.effectiveFrom);
  const effectiveTo = parseAccessEndDate(input.effectiveTo);
  if (grantType === AccessGrantType.ACTING && !effectiveTo) {
    throw new AccessGrantInputError('代班授权必须设置结束日期');
  }
  if (effectiveTo && effectiveTo.getTime() <= effectiveFrom.getTime()) {
    throw new AccessGrantInputError('授权结束时间必须晚于开始时间');
  }

  let scopeKey = department ? `DEPARTMENT:${department.code}` : 'GLOBAL';
  if (profile === AccessProfileKey.FIELD_REPORTER) scopeKey = `EMPLOYEE:${employee!.id}`;
  if (profile === AccessProfileKey.WORKSHOP_SUPERVISOR) scopeKey = 'WORKSHOP:PRODUCTION';
  if (profile === AccessProfileKey.WORKSHOP_TEAM_LEADER) scopeKey = `TEAM:${targetTeam!.id}`;

  return {
    profile,
    departmentId: department?.id || null,
    scopeKey,
    grantType,
    effectiveFrom,
    effectiveTo,
  };
}

export type AccountFieldReportGrantSyncInput = {
  userId: string;
  employee: AccessGrantEmployee | null;
  enabled: boolean;
  primaryProfile: AccessProfileKey;
  departmentId?: unknown;
  effectiveFrom?: unknown;
  grantedById: string;
};

/**
 * Keeps the employee-scoped reporting capability independent from the primary
 * workbench profile. A FIELD_REPORTER primary grant already supplies that
 * capability; every other primary profile receives at most one concurrent
 * reporting grant.
 */
export async function syncAccountFieldReportGrant(
  tx: Prisma.TransactionClient,
  input: AccountFieldReportGrantSyncInput,
): Promise<{ created: boolean; disabledCount: number }> {
  const additionalReporterWhere: Prisma.UserAccessGrantWhereInput = {
    userId: input.userId,
    profile: AccessProfileKey.FIELD_REPORTER,
    grantType: { not: AccessGrantType.PRIMARY },
    isActive: true,
  };

  if (!input.enabled || input.primaryProfile === AccessProfileKey.FIELD_REPORTER) {
    const disabled = await tx.userAccessGrant.updateMany({
      where: additionalReporterWhere,
      data: { isActive: false, version: { increment: 1 }, grantedById: input.grantedById },
    });
    return { created: false, disabledCount: disabled.count };
  }

  if (!input.employee) {
    throw new AccessGrantInputError('扫码报工必须绑定在职员工档案');
  }

  const now = new Date();
  const retained = await tx.userAccessGrant.findFirst({
    where: {
      ...additionalReporterWhere,
      OR: [
        { effectiveTo: null },
        { effectiveTo: { gt: now } },
      ],
    },
    orderBy: [{ effectiveFrom: 'asc' }, { createdAt: 'asc' }],
    select: { id: true },
  });

  if (retained) {
    const disabled = await tx.userAccessGrant.updateMany({
      where: { ...additionalReporterWhere, id: { not: retained.id } },
      data: { isActive: false, version: { increment: 1 }, grantedById: input.grantedById },
    });
    return { created: false, disabledCount: disabled.count };
  }

  const disabled = await tx.userAccessGrant.updateMany({
    where: additionalReporterWhere,
    data: { isActive: false, version: { increment: 1 }, grantedById: input.grantedById },
  });
  const grant = await prepareAccessGrant(tx, {
    profileKey: AccessProfileKey.FIELD_REPORTER,
    departmentId: input.departmentId,
    grantType: AccessGrantType.CONCURRENT,
    effectiveFrom: input.effectiveFrom,
  }, input.employee);
  await tx.userAccessGrant.create({
    data: {
      userId: input.userId,
      ...grant,
      grantedById: input.grantedById,
    },
  });
  return { created: true, disabledCount: disabled.count };
}
