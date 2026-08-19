import { abnormalTimeScopedEmployeeIds, type AbnormalTimeAccessActor } from '@/lib/abnormal-time-access';
import { hasCapability } from '@/lib/department-access';
import { prisma } from '@/lib/prisma';
import { productionEmployeeWhere, type AttendanceWorkforceScope } from '@/lib/production-workforce';

export type AttendanceAccessActor = AbnormalTimeAccessActor;

export type AttendanceAccessBoundary = {
  employeeIds: string[] | null;
  allowedWorkforceScopes: AttendanceWorkforceScope[];
  scopeLabel: string;
  unrestricted: boolean;
};

/**
 * HR keeps company-wide attendance access. Production supervisors are limited
 * to active production staff and team leaders to their resolved team members.
 * A missing team mapping fails closed instead of falling back to all employees.
 */
export async function resolveAttendanceAccessBoundary(
  actor: AttendanceAccessActor,
): Promise<AttendanceAccessBoundary> {
  if (hasCapability(actor.access, 'HR', 'READ')) {
    return {
      employeeIds: null,
      allowedWorkforceScopes: ['PRODUCTION', 'OTHER', 'ALL'],
      scopeLabel: '全公司',
      unrestricted: true,
    };
  }

  if (actor.access.productionScope === 'WORKSHOP' || actor.access.productionScope === 'GLOBAL') {
    const employeeIds = (await prisma.employee.findMany({
      where: productionEmployeeWhere(),
      select: { id: true },
    })).map(employee => employee.id);
    return {
      employeeIds,
      allowedWorkforceScopes: ['PRODUCTION'],
      scopeLabel: '生产车间',
      unrestricted: false,
    };
  }

  const employeeIds = await abnormalTimeScopedEmployeeIds(actor) ?? [];
  return {
    employeeIds,
    allowedWorkforceScopes: ['PRODUCTION'],
    scopeLabel: actor.access.productionScope === 'TEAM' ? '本人班组' : '本人',
    unrestricted: false,
  };
}

export function attendanceEmployeeAllowed(
  boundary: AttendanceAccessBoundary,
  employeeId: string,
): boolean {
  return boundary.employeeIds === null || boundary.employeeIds.includes(employeeId);
}

export function effectiveAttendanceWorkforceScope(
  boundary: AttendanceAccessBoundary,
  requested: AttendanceWorkforceScope,
): AttendanceWorkforceScope {
  return boundary.allowedWorkforceScopes.includes(requested)
    ? requested
    : boundary.allowedWorkforceScopes[0] || 'PRODUCTION';
}
