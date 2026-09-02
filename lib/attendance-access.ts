import type { Prisma } from '@prisma/client';
import { abnormalTimeScopedEmployeeIds, type AbnormalTimeAccessActor } from '@/lib/abnormal-time-access';
import { hasCapability } from '@/lib/department-access';
import { prisma } from '@/lib/prisma';
import {
  attendanceRecordScopeWhere,
  productionEmployeeWhere,
  type AttendanceWorkforceScope,
} from '@/lib/production-workforce';

export type AttendanceAccessActor = AbnormalTimeAccessActor;

export type AttendanceAccessBoundary = {
  /** Current active roster that may be changed through normal attendance flows. */
  employeeIds: string[] | null;
  /** Historical facts are scoped independently from the current active roster. */
  historicalRecordWhere: Prisma.AttendanceRecordWhereInput;
  allowedWorkforceScopes: AttendanceWorkforceScope[];
  scopeLabel: string;
  unrestricted: boolean;
};

export type DepartedAttendanceCorrectionError = {
  status: 400 | 403 | 409;
  error: string;
};

/**
 * Departed staff are immutable in normal attendance flows. HR may correct an
 * existing pre-departure fact only when the reason can be retained in the
 * same transaction as the before/after audit snapshot.
 */
export function departedAttendanceCorrectionError(input: {
  hasHrUpdate: boolean;
  existingRecord: boolean;
  correctionReason: string;
}): DepartedAttendanceCorrectionError | null {
  if (!input.hasHrUpdate) {
    return { status: 403, error: '离职员工的历史考勤仅限人事更新权限纠正' };
  }
  if (!input.existingRecord) {
    return { status: 409, error: '离职后不能补新建考勤；只能纠正离职前已有记录' };
  }
  if (!input.correctionReason.trim()) {
    return { status: 400, error: '纠正离职员工历史考勤必须填写原因' };
  }
  return null;
}

function noHistoricalAttendanceRecords(): Prisma.AttendanceRecordWhereInput {
  return { employeeId: { in: [] } };
}

export function attendanceHistoricalRecordWhere(input: {
  unrestricted: boolean;
  productionScope: AbnormalTimeAccessActor['access']['productionScope'];
  employeeId?: string | null;
  teamValues?: readonly string[];
}): Prisma.AttendanceRecordWhereInput {
  if (input.unrestricted) return {};
  if (input.productionScope === 'WORKSHOP' || input.productionScope === 'GLOBAL') {
    return attendanceRecordScopeWhere('PRODUCTION');
  }
  if (input.productionScope === 'TEAM') {
    const teamValues = [...new Set((input.teamValues || []).map(value => String(value).trim()).filter(Boolean))];
    if (!teamValues.length) return noHistoricalAttendanceRecords();
    return {
      OR: [
        { teamSnapshot: { in: teamValues } },
        {
          teamSnapshot: null,
          employee: { team: { in: teamValues } },
        },
      ],
    };
  }
  return input.employeeId
    ? { employeeId: input.employeeId }
    : noHistoricalAttendanceRecords();
}

function productionTeamKeys(actor: AttendanceAccessActor): string[] {
  return [...new Set(actor.access.scopeHints.flatMap(hint => {
    if (hint.module !== 'PRODUCTION' || hint.level !== 'TEAM') return [];
    const key = String(hint.teamId || hint.scopeKey.replace(/^TEAM:/i, '') || '').trim();
    return key ? [key] : [];
  }))];
}

async function historicalTeamValues(actor: AttendanceAccessActor): Promise<string[]> {
  const keys = productionTeamKeys(actor);
  if (!keys.length) return [];
  const teams = await prisma.productionTeam.findMany({
    where: {
      OR: [
        { id: { in: keys } },
        { code: { in: keys } },
        { name: { in: keys } },
        { legacyTeamName: { in: keys } },
      ],
    },
    select: { id: true, code: true, name: true, legacyTeamName: true },
  });
  return [...new Set([
    ...keys,
    ...teams.flatMap(team => [team.id, team.code, team.name, team.legacyTeamName])
      .filter((value): value is string => Boolean(value)),
  ])];
}

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
      historicalRecordWhere: {},
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
      historicalRecordWhere: attendanceHistoricalRecordWhere({
        unrestricted: false,
        productionScope: actor.access.productionScope,
      }),
      allowedWorkforceScopes: ['PRODUCTION'],
      scopeLabel: '生产车间',
      unrestricted: false,
    };
  }

  const employeeIds = await abnormalTimeScopedEmployeeIds(actor) ?? [];
  const teamValues = actor.access.productionScope === 'TEAM'
    ? await historicalTeamValues(actor)
    : [];
  return {
    employeeIds,
    historicalRecordWhere: attendanceHistoricalRecordWhere({
      unrestricted: false,
      productionScope: actor.access.productionScope,
      employeeId: actor.employee?.id,
      teamValues,
    }),
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
