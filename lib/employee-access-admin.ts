import { AccessGrantType, AccessProfileKey, Prisma } from '@prisma/client';
import {
  DEPARTMENT_CODES,
  type DepartmentCode,
} from '@/lib/department-access';
import { requiresAdminPasswordSetup } from '@/lib/login-security';
import { serializeEmployee } from '@/lib/process-time';

export const departmentRecordSelect = {
  id: true,
  code: true,
  name: true,
  isActive: true,
} as const;

export const employeeAccessAdminInclude = {
  departmentRef: { select: departmentRecordSelect },
  fieldReportPinCredential: {
    select: {
      isActive: true,
      lockedUntil: true,
      lastUsedAt: true,
      resetAt: true,
      updatedAt: true,
    },
  },
  user: {
    select: {
      id: true,
      username: true,
      displayName: true,
      isActive: true,
      accountStatus: true,
      mustChangePassword: true,
      lastLoginAt: true,
      accessGrants: {
        select: {
          id: true,
          profile: true,
          departmentId: true,
          scopeKey: true,
          grantType: true,
          effectiveFrom: true,
          effectiveTo: true,
          isActive: true,
          department: { select: departmentRecordSelect },
        },
        orderBy: [
          { isActive: 'desc' as const },
          { grantType: 'asc' as const },
          { effectiveFrom: 'desc' as const },
        ],
      },
    },
  },
} satisfies Prisma.EmployeeInclude;

export type EmployeeAccessAdminRecord = Prisma.EmployeeGetPayload<{
  include: typeof employeeAccessAdminInclude;
}>;

export type EmployeeDepartmentRecord = {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
};

type DepartmentLookup = {
  id?: string;
  code?: DepartmentCode;
  name?: string;
};

export type ActiveDepartmentFinder = (
  lookup: DepartmentLookup,
) => Promise<EmployeeDepartmentRecord | null>;

export type ResolvedEmployeeDepartment = {
  departmentId: string | null;
  department: string | null;
  departmentRecord: EmployeeDepartmentRecord | null;
};

export class EmployeeDepartmentInputError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export async function disableLinkedEmployeeAccess(
  tx: Pick<
    Prisma.TransactionClient,
    'user' | 'userAccessGrant' | 'employeeFieldReportPinCredential' | 'fieldReportPinSession'
  >,
  employeeId: string,
): Promise<{
  linkedAccount: boolean;
  disabledAccessGrants: number;
  sessionInvalidated: boolean;
  pinCredentialDisabled: boolean;
  pinSessionsRevoked: number;
}> {
  const now = new Date();
  const [pinCredential, revokedPinSessions] = await Promise.all([
    tx.employeeFieldReportPinCredential.updateMany({
      where: { employeeId, isActive: true },
      data: {
        isActive: false,
        credentialVersion: { increment: 1 },
        failedAttempts: 0,
        lockedUntil: null,
      },
    }),
    tx.fieldReportPinSession.updateMany({
      where: { employeeId, consumedAt: null, revokedAt: null },
      data: { revokedAt: now },
    }),
  ]);
  const linkedUser = await tx.user.findUnique({
    where: { employeeId },
    select: { id: true },
  });
  if (!linkedUser) {
    return {
      linkedAccount: false,
      disabledAccessGrants: 0,
      sessionInvalidated: false,
      pinCredentialDisabled: pinCredential.count > 0,
      pinSessionsRevoked: revokedPinSessions.count,
    };
  }

  const disabledGrants = await tx.userAccessGrant.updateMany({
    where: { userId: linkedUser.id, isActive: true },
    data: { isActive: false, version: { increment: 1 } },
  });
  await tx.user.update({
    where: { id: linkedUser.id },
    data: {
      accountStatus: 'DISABLED',
      isActive: false,
      sessionVersion: { increment: 1 },
    },
  });
  return {
    linkedAccount: true,
    disabledAccessGrants: disabledGrants.count,
    sessionInvalidated: true,
    pinCredentialDisabled: pinCredential.count > 0,
    pinSessionsRevoked: revokedPinSessions.count,
  };
}

const DEPARTMENT_ALIASES: Record<DepartmentCode, readonly string[]> = {
  PRODUCTION: ['PRODUCTION', '生产', '生产部', '生产车间', '车间', '制造部'],
  BUSINESS: ['BUSINESS', '业务', '业务部', '商务', '商务部', '销售', '销售部'],
  PROCUREMENT: ['PROCUREMENT', '采购', '采购部'],
  WAREHOUSE: ['WAREHOUSE', '仓储', '仓储部', '仓库', '仓库部', '物料仓库'],
  ENGINEERING: ['ENGINEERING', '工程', '工程部', '技术', '技术部', '研发', '研发部'],
  QUALITY: ['QUALITY', '质量', '质量部', '品质', '品质部', '质检', '质检部'],
  GM_OFFICE: ['GM_OFFICE', '总经办', '总经理办公室', '总经理办', '经理办'],
  FINANCE: ['FINANCE', '财务', '财务部', '会计', '会计部'],
  PROCESS: ['PROCESS', '工艺', '工艺部', '工艺技术部'],
  PLANNING: ['PLANNING', '计划', '计划部', '生产计划', '生产计划部', '计划物控部'],
  HR: ['HR', '人事', '人事部', '人力资源', '人力资源部', '行政人事', '行政人事部'],
};

function normalizedDepartmentKey(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/\s+/g, '')
    .trim()
    .toUpperCase();
}

const DEPARTMENT_CODE_BY_ALIAS = new Map<string, DepartmentCode>(
  DEPARTMENT_CODES.flatMap(code =>
    DEPARTMENT_ALIASES[code].map(alias => [normalizedDepartmentKey(alias), code] as const),
  ),
);

export function departmentCodeFromLegacyText(value: unknown): DepartmentCode | null {
  return DEPARTMENT_CODE_BY_ALIAS.get(normalizedDepartmentKey(value)) ?? null;
}

function owns(input: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(input, key);
}

/**
 * Resolves either the stable departmentId or a legacy Chinese department name
 * and always returns the canonical Department.id/name pair. An explicit empty
 * value clears both fields. When neither field is supplied, undefined means
 * "do not change" to PATCH callers.
 */
export async function resolveEmployeeDepartmentInput(
  input: Record<string, unknown>,
  findActiveDepartment: ActiveDepartmentFinder,
): Promise<ResolvedEmployeeDepartment | undefined> {
  const hasDepartmentId = owns(input, 'departmentId');
  const hasLegacyText = owns(input, 'department');
  if (!hasDepartmentId && !hasLegacyText) return undefined;

  const requestedId = hasDepartmentId ? String(input.departmentId ?? '').trim() : '';
  const requestedText = hasLegacyText
    ? String(input.department ?? '').normalize('NFKC').trim().slice(0, 80)
    : '';

  if (!requestedId && !requestedText) {
    return { departmentId: null, department: null, departmentRecord: null };
  }

  let department: EmployeeDepartmentRecord | null = null;
  if (requestedId) {
    department = await findActiveDepartment({ id: requestedId });
  } else {
    const code = departmentCodeFromLegacyText(requestedText);
    department = code
      ? await findActiveDepartment({ code })
      : await findActiveDepartment({ name: requestedText });
  }

  if (!department?.isActive) {
    throw new EmployeeDepartmentInputError('请选择有效部门');
  }

  return {
    departmentId: department.id,
    department: department.name,
    departmentRecord: department,
  };
}

type AccessGrantSummaryRecord = EmployeeAccessAdminRecord['user'] extends infer UserRecord
  ? NonNullable<UserRecord> extends { accessGrants: infer Grants }
    ? Grants extends readonly (infer Grant)[] ? Grant : never
    : never
  : never;

export function isEffectiveEmployeeGrant(
  grant: Pick<AccessGrantSummaryRecord, 'isActive' | 'effectiveFrom' | 'effectiveTo'>,
  now: Date = new Date(),
): boolean {
  return grant.isActive
    && grant.effectiveFrom.getTime() <= now.getTime()
    && (!grant.effectiveTo || grant.effectiveTo.getTime() > now.getTime());
}

export function employeePermissionSyncPending(
  employee: Pick<EmployeeAccessAdminRecord, 'departmentId' | 'isActive' | 'user'>,
  now: Date = new Date(),
): boolean {
  if (!employee.user) return false;
  // Offboarding intentionally disables the linked account and every grant.
  // It is a completed security action, not a permission-sync task. Once the
  // employee is reinstated, isActive becomes true and the inactive grants are
  // correctly surfaced for administrator confirmation again.
  if (!employee.isActive) return false;
  const activeGrants = employee.user.accessGrants.filter(grant =>
    isEffectiveEmployeeGrant(grant, now),
  );
  if (activeGrants.some(grant => grant.profile === AccessProfileKey.ADMIN_GLOBAL)) return false;

  const primaryDepartmentGrants = activeGrants.filter(grant =>
    grant.grantType === AccessGrantType.PRIMARY && Boolean(grant.departmentId),
  );
  if (!employee.departmentId) return primaryDepartmentGrants.length > 0;
  return !primaryDepartmentGrants.some(grant => grant.departmentId === employee.departmentId);
}

export function serializeEmployeeAccessAdmin(
  employee: EmployeeAccessAdminRecord,
  now: Date = new Date(),
) {
  const permissionSyncPending = employeePermissionSyncPending(employee, now);
  const activeGrants = employee.user?.accessGrants.filter(grant =>
    isEffectiveEmployeeGrant(grant, now),
  ) ?? [];
  const profiles = [...new Set(activeGrants.map(grant => grant.profile))].sort();
  const departmentCodes = [...new Set(
    activeGrants
      .map(grant => grant.department?.code)
      .filter((code): code is string => Boolean(code)),
  )].sort();
  const pinCredential = employee.fieldReportPinCredential;
  const pinLockedUntil = pinCredential?.lockedUntil ?? null;
  const passwordSetupRequired = employee.user ? requiresAdminPasswordSetup({
    isActive: employee.user.isActive,
    accountStatus: employee.user.accountStatus,
    mustChangePassword: employee.user.mustChangePassword,
    lastLoginAt: employee.user.lastLoginAt,
    accessGrants: employee.user.accessGrants,
  }, now) : false;

  return {
    ...serializeEmployee(employee),
    departmentId: employee.departmentId,
    departmentRecord: employee.departmentRef,
    permissionSyncPending,
    linkedUser: employee.user ? {
      id: employee.user.id,
      username: employee.user.username,
      displayName: employee.user.displayName,
      isActive: employee.user.isActive,
      accountStatus: employee.user.accountStatus,
      mustChangePassword: employee.user.mustChangePassword,
      passwordSetupRequired,
      lastLoginAt: employee.user.lastLoginAt?.toISOString() || null,
      permissionSummary: {
        configuredGrantCount: employee.user.accessGrants.length,
        activeGrantCount: activeGrants.length,
        profiles,
        departmentCodes,
        fieldReportEnabled: activeGrants.some(
          grant => grant.profile === AccessProfileKey.FIELD_REPORTER,
        ),
        pin: {
          configured: Boolean(pinCredential),
          isActive: Boolean(pinCredential?.isActive),
          isLocked: Boolean(pinLockedUntil && pinLockedUntil.getTime() > now.getTime()),
          lockedUntil: pinLockedUntil?.toISOString() || null,
          lastUsedAt: pinCredential?.lastUsedAt?.toISOString() || null,
          resetAt: pinCredential?.resetAt.toISOString() || null,
          updatedAt: pinCredential?.updatedAt.toISOString() || null,
        },
        permissionSyncPending,
      },
    } : null,
  };
}
