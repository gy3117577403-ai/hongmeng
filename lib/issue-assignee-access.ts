import { Prisma } from '@prisma/client';
import {
  DEPARTMENT_CODES,
  hasCapability,
  resolveAccessContext,
  type AccessGrant,
  type AccessProfileCode,
  type DepartmentCode,
} from '@/lib/department-access';
import { legacyFallbackGrants } from '@/lib/legacy-access-policy';

type IssueAssigneeTx = Pick<Prisma.TransactionClient, 'employee'>;

const issueAssigneeSelect = Prisma.validator<Prisma.EmployeeSelect>()({
  id: true,
  employeeNo: true,
  name: true,
  department: true,
  position: true,
  team: true,
  isActive: true,
  resignedAt: true,
  departmentRef: { select: { code: true, name: true } },
  user: {
    select: {
      id: true,
      isActive: true,
      accountStatus: true,
      laborRole: true,
      employeeId: true,
      accessGrants: {
        select: {
          id: true,
          profile: true,
          grantType: true,
          scopeKey: true,
          isActive: true,
          effectiveFrom: true,
          effectiveTo: true,
          department: { select: { code: true } },
        },
      },
    },
  },
});

type IssueAssigneeRecord = Prisma.EmployeeGetPayload<{ select: typeof issueAssigneeSelect }>;

function departmentCode(value?: string | null): DepartmentCode | undefined {
  return DEPARTMENT_CODES.includes(value as DepartmentCode) ? value as DepartmentCode : undefined;
}

function canHandleIssue(record: IssueAssigneeRecord, now = new Date()): boolean {
  const user = record.user;
  if (!record.isActive || record.resignedAt || !user?.isActive || user.accountStatus !== 'ACTIVE') return false;
  const storedGrants: AccessGrant[] = user.accessGrants.map(grant => ({
    id: grant.id,
    profile: grant.profile as AccessProfileCode,
    grantType: grant.grantType,
    departmentCode: departmentCode(grant.department?.code),
    scopeKey: grant.scopeKey,
    isActive: grant.isActive,
    effectiveFrom: grant.effectiveFrom,
    effectiveTo: grant.effectiveTo,
  }));
  const compatibility = legacyFallbackGrants({
    laborRole: user.laborRole,
    employeeId: record.id,
    employee: {
      id: record.id,
      departmentRef: record.departmentRef ? { code: record.departmentRef.code } : null,
    },
  });
  const access = resolveAccessContext(
    storedGrants.length
      ? [...storedGrants, ...(user.laborRole === 'ADMIN' ? compatibility : [])]
      : compatibility,
    { accountActive: true, now },
  );
  const issueHandler = hasCapability(access, 'ISSUE_MANAGEMENT', 'UPDATE')
    && hasCapability(access, 'ISSUE_MANAGEMENT', 'EXECUTE_WORKFLOW');
  const qualityHandler = hasCapability(access, 'QUALITY', 'UPDATE')
    && hasCapability(access, 'QUALITY', 'EXECUTE_WORKFLOW');
  return issueHandler || qualityHandler;
}

export class IssueAssigneeAccessError extends Error {
  status: number;

  constructor(message: string, status = 409) {
    super(message);
    this.name = 'IssueAssigneeAccessError';
    this.status = status;
  }
}

export async function listIssueAssigneeOptions(tx: IssueAssigneeTx) {
  const employees = await tx.employee.findMany({
    where: { isActive: true, resignedAt: null },
    select: issueAssigneeSelect,
    orderBy: [{ employeeNo: 'asc' }, { name: 'asc' }],
  });
  return employees.filter(employee => canHandleIssue(employee)).map(employee => ({
    id: employee.id,
    employeeNo: employee.employeeNo,
    name: employee.name,
    department: employee.departmentRef?.name || employee.department,
    position: employee.position,
    team: employee.team,
    isActive: employee.isActive,
  }));
}

export async function requireIssueAssigneeReady(
  tx: IssueAssigneeTx,
  employeeId: string | null | undefined,
): Promise<{ employeeId: string; userId: string } | null> {
  if (!employeeId) return null;
  const employee = await tx.employee.findFirst({
    where: { id: employeeId, isActive: true, resignedAt: null },
    select: issueAssigneeSelect,
  });
  if (!employee) throw new IssueAssigneeAccessError('负责人不存在、已离职或已停用', 404);
  if (!employee.user?.isActive || employee.user.accountStatus !== 'ACTIVE') {
    throw new IssueAssigneeAccessError('该负责人没有可用登录账号，不能接收问题任务');
  }
  if (!canHandleIssue(employee)) {
    throw new IssueAssigneeAccessError('该负责人尚未开通问题处理权限，请先完成账号授权');
  }
  return { employeeId: employee.id, userId: employee.user.id };
}
